/**
 * The observer's view of time: which server state is on screen, and when.
 *
 * The garden's simulation steps every five seconds (`updated_at` is always the
 * birth time plus whole steps), and a step is published some seconds later,
 * when the server's clock loop wakes. The page never extrapolates past a
 * state it has received. Instead it presents the garden a fixed
 * `BROADCAST_DELAY_S` behind the server's clock and interpolates between the
 * two published states that bracket that moment. Because the delay is
 * measured on the server's clock, every visitor sees the same moment of the
 * same life at the same time, whatever their polling phase.
 *
 * Nothing here can change a state: observations are frozen as they enter.
 */
import { sameLife, type Observation } from "./observation.js";

/**
 * Presentation lag behind the server's clock, seconds. A step's state is
 * published up to one step (5 s) late, by the server loop's drifting wake
 * phase, and is needed one step before its own time to animate toward it:
 * 10 s, plus a request's margin and one quick retry.
 */
export const BROADCAST_DELAY_S = 12;
/** Server step length, seconds (`server.py` advances in five-second steps). */
export const STEP_S = 5;
/** Two states further apart than this are not animated across: the garden was catching up after an outage. */
export const MAX_ANIMATED_GAP_S = 60;
/** How many states to keep: about three minutes. */
const KEEP = 40;

const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
};

/**
 * Server-clock estimate from response timestamps: NTP's midpoint rule, keeping
 * the sample with the smallest round trip of the recent ones, and slewing
 * small corrections so the presented time never jumps backward.
 */
export class ServerClock {
  private samples: { offset: number; rtt: number }[] = [];
  private offset: number | null = null;

  /** `serverTime` (s) was read by the server between `sentMs` and `receivedMs` (local ms). */
  update(serverTime: number, sentMs: number, receivedMs: number): void {
    if (!(receivedMs >= sentMs)) return;
    const rtt = (receivedMs - sentMs) / 1000;
    const offset = serverTime - (sentMs + receivedMs) / 2000;
    this.samples.push({ offset, rtt });
    if (this.samples.length > 12) this.samples.shift();
    // The fastest reply wins; among equals, the newest.
    const best = this.samples.reduce((a, b) => (b.rtt <= a.rtt ? b : a));
    if (this.offset === null || Math.abs(best.offset - this.offset) > 2)
      this.offset = best.offset;
    // Small disagreements are slewed: at most 0.25 s per update.
    else this.offset += Math.max(-0.25, Math.min(0.25, best.offset - this.offset));
  }

  /** Server unix seconds at local time `localMs`, or null before the first response. */
  now(localMs: number): number | null {
    return this.offset === null ? null : localMs / 1000 + this.offset;
  }
}

/** One stretch of presented time: the change from `prev` to `next`, `tau` of the way through. */
export interface Interval {
  prev: Observation;
  next: Observation;
  /** 0 at prev.updatedAt, 1 at next.updatedAt; held at 1 while the next state is late. */
  tau: number;
  /** Presented seconds past `next` for which no newer state has arrived (0 when on time). */
  late: number;
  /** True when the two states are too far apart to animate between. */
  discontinuous: boolean;
}

export type PushResult = "added" | "duplicate" | "older" | "new-life";

export class Timeline {
  private items: Observation[] = [];
  /** Identity changes seen this session, oldest first. */
  readonly lifeChanges: { from: Observation; to: Observation }[] = [];

  /** Adds a parsed observation. A different life is never blended with the old one. */
  push(o: Observation): PushResult {
    const last = this.items.at(-1);
    if (last && !sameLife(last, o)) {
      this.lifeChanges.push({ from: last, to: freeze(o) });
      this.items = [o];
      return "new-life";
    }
    if (this.items.some((x) => x.ticks === o.ticks || x.updatedAt === o.updatedAt))
      return "duplicate";
    if (last && o.updatedAt < last.updatedAt) return "older";
    this.items.push(freeze(o));
    if (this.items.length > KEEP) this.items.splice(0, this.items.length - KEEP);
    return "added";
  }

  latest(): Observation | null {
    return this.items.at(-1) ?? null;
  }

  get size(): number {
    return this.items.length;
  }

  /** The states around presented time `t` (server seconds). */
  at(t: number): Interval | null {
    const items = this.items;
    if (items.length === 0) return null;
    const first = items[0]!;
    if (items.length === 1 || t <= first.updatedAt)
      return {
        prev: first,
        next: first,
        tau: 1,
        late: Math.max(0, t - first.updatedAt),
        discontinuous: false,
      };
    const last = items.at(-1)!;
    if (t >= last.updatedAt) {
      const prev = items.at(-2)!;
      return {
        prev,
        next: last,
        tau: 1,
        late: t - last.updatedAt,
        discontinuous: last.updatedAt - prev.updatedAt > MAX_ANIMATED_GAP_S,
      };
    }
    let k = items.length - 1;
    while (k > 0 && items[k - 1]!.updatedAt >= t) k--;
    const prev = items[k - 1]!,
      next = items[k]!;
    const span = next.updatedAt - prev.updatedAt;
    return {
      prev,
      next,
      tau: Math.min(1, Math.max(0, (t - prev.updatedAt) / span)),
      late: 0,
      discontinuous: span > MAX_ANIMATED_GAP_S,
    };
  }

  /** The state in force at presented time `t`: `next` once its moment is reached. */
  stateAt(t: number): Observation | null {
    const i = this.at(t);
    if (!i) return null;
    return i.tau >= 1 ? i.next : i.prev;
  }
}

/**
 * Presented time for a local clock reading. It runs forward at real speed,
 * gaining or losing at most 3% to follow the server-clock estimate, and jumps
 * only when it is more than three seconds off (a laptop waking from sleep,
 * say), which it reports so the scene can cut instead of animating the gap.
 */
export class PresentationClock {
  private shown: number | null = null;
  private lastLocal = 0;
  jumped = false;

  constructor(private readonly delayS = BROADCAST_DELAY_S) {}

  /** Presented server time, or null until the server clock is known. */
  tick(localMs: number, serverNow: number | null): number | null {
    if (serverNow === null) return this.shown;
    const target = serverNow - this.delayS;
    this.jumped = false;
    if (this.shown === null || Math.abs(target - this.shown) > 3) {
      this.jumped = this.shown !== null;
      this.shown = target;
    } else {
      const dt = Math.max(0, (localMs - this.lastLocal) / 1000);
      const error = target - this.shown;
      this.shown += dt + Math.max(-0.03 * dt, Math.min(0.03 * dt, error));
    }
    this.lastLocal = localMs;
    return this.shown;
  }
}
