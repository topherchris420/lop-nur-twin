/**
 * The interaction bridge: the one channel by which one research subject can
 * perceive another.
 *
 * Two subjects keep two worlds, two clocks, two controllers and two
 * histories. Nothing is merged. Each subject's world is wrapped in a
 * `BridgedWorld`, which answers every question exactly as the wrapped world
 * does and adds one thing: when the bridge has delivered a percept of the
 * other fly, the other fly is listed among the world's moving things, so the
 * receiver's own eyes can see it. Moving things are seen, never touched
 * (world.ts): no ray, perch, solidity, odour, food or wind test includes
 * them, so the other fly can only be perceived, never collided with or
 * pushed, and neither subject can change the other's world.
 *
 * The bridge is bounded:
 * - it carries only `ForeignPercept`s (percept.ts): a body of a fly's size at
 *   a place, mapped from the sender's frame into the receiver's by a declared
 *   `FrameMap`;
 * - it delivers only when the encounter clock says both subjects are
 *   synchronized, and a receiver sees the sender as it was `latencyS` ago,
 *   interpolated between two delivered samples and never extrapolated;
 * - a sender that would have moved faster than `maxSpeedMS` between two
 *   exchanges is refused, and the receiver sees nothing until the next valid
 *   sample (never interpolated across the jump);
 * - it has a delivery budget, closes on the first refusal it cannot recover
 *   from, and can be closed at any time; closed, it delivers nothing;
 * - it runs only between research subjects: both ids pass `refuseOriginal`,
 *   and the authorization must name exactly those two subjects;
 * - every event is appended to a SHA-256 hash chain (`BridgeLog`).
 *
 * With nothing delivered, a bridged world is the wrapped world: the
 * subject's state hash steps exactly as without the wrapper (bridge.test.ts).
 */
import { sha256, sha256Json } from "../../rain/sha256.js";
import type { V3 } from "../fly/units.js";
import type {
  FlyWorld,
  FoodPatch,
  Hit,
  LandingSite,
  Landmark,
  LightSample,
  Mover,
  Perch,
  WorldInputs,
} from "../fly/world.js";
import type { SyncRecord } from "./clock.js";
import { applyMap, checkFrameMap, type FrameMap } from "./frames.js";
import { refuseOriginal } from "./originals.js";
import { FLY_EQUIVALENT_RADIUS_M, percept, type ForeignPercept } from "./percept.js";

export const BRIDGE_SCHEMA = "first-contact-bridge/v1" as const;
/** The id the other fly carries among a receiver's moving things. */
export const BRIDGE_MOVER_ID = "bridge-0";

// ---------------------------------------------------------------- the log

export interface BridgeEvent {
  seq: number;
  /** Encounter time (s). */
  tau: number;
  kind: "open" | "close" | "refuse" | "desync" | "budget" | "presentation" | "summary";
  detail: Record<string, unknown>;
  /** The previous event's hash ("" for the first). */
  prev: string;
  hash: string;
}

/** An append-only SHA-256 chain of a bridge's events. */
export class BridgeLog {
  private readonly items: BridgeEvent[] = [];

  append(tau: number, kind: BridgeEvent["kind"], detail: Record<string, unknown>) {
    const prev = this.items.at(-1)?.hash ?? "";
    const body = { seq: this.items.length, tau, kind, detail, prev };
    const event: BridgeEvent = Object.freeze({ ...body, hash: sha256Json(body) });
    this.items.push(event);
    return event;
  }

  get events(): readonly BridgeEvent[] {
    return this.items;
  }

  get head(): string {
    return this.items.at(-1)?.hash ?? "";
  }
}

/** Re-derives every hash of a chain; returns the first broken sequence number, or null. */
export function verifyChain(events: readonly BridgeEvent[]): number | null {
  let prev = "";
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const body = { seq: e.seq, tau: e.tau, kind: e.kind, detail: e.detail, prev: e.prev };
    if (e.seq !== i || e.prev !== prev || sha256Json(body) !== e.hash) return i;
    prev = e.hash;
  }
  return null;
}

// ------------------------------------------------------------ the channel

interface Delivered {
  tau: number;
  p: ForeignPercept;
}

export interface ChannelStats {
  delivered: number;
  /** Queries answered by interpolating two delivered samples. */
  interpolated: number;
  /** Queries answered exactly by one sample. */
  exact: number;
  /** Queries before the first sample, or after a break: nothing seen. */
  empty: number;
  /** Queries beyond the newest sample: refused rather than extrapolated. */
  beyond: number;
}

/**
 * What one receiver has been sent of the other fly: samples stamped in
 * encounter time. `at(tau)` answers with the sender as it was `latencyS`
 * before `tau`.
 */
export class PerceptChannel {
  readonly latencyS: number;
  private samples: Delivered[] = [];
  private readonly keepS: number;
  readonly stats: ChannelStats = {
    delivered: 0,
    interpolated: 0,
    exact: 0,
    empty: 0,
    beyond: 0,
  };

  constructor(latencyS: number, keepS = 1) {
    if (!(latencyS >= 0 && latencyS <= 1)) throw new Error("latency must be in [0, 1] s");
    this.latencyS = latencyS;
    this.keepS = Math.max(keepS, latencyS + 0.1);
  }

  push(tau: number, p: ForeignPercept): void {
    const last = this.samples.at(-1);
    if (last && tau <= last.tau)
      throw new Error("percepts arrive in encounter-time order");
    this.samples.push({ tau, p });
    this.stats.delivered++;
    const oldest = tau - this.keepS;
    let drop = 0;
    while (drop < this.samples.length - 2 && this.samples[drop]!.tau < oldest) drop++;
    if (drop) this.samples.splice(0, drop);
  }

  /** Forgets everything: the receiver sees nothing until the next delivery. */
  break(): void {
    this.samples = [];
  }

  get newestTau(): number | null {
    return this.samples.at(-1)?.tau ?? null;
  }

  at(tau: number): ForeignPercept | null {
    const q = tau - this.latencyS;
    const s = this.samples;
    if (!s.length || q < s[0]!.tau - 1e-9) {
      this.stats.empty++;
      return null;
    }
    const last = s.at(-1)!;
    if (q > last.tau + 1e-9) {
      this.stats.beyond++;
      return null;
    }
    // The newest sample at or before q.
    let i = s.length - 1;
    while (i > 0 && s[i]!.tau > q + 1e-9) i--;
    const a = s[i]!;
    if (Math.abs(a.tau - q) <= 1e-9 || i === s.length - 1) {
      this.stats.exact++;
      return a.p;
    }
    const b = s[i + 1]!;
    const u = (q - a.tau) / (b.tau - a.tau);
    this.stats.interpolated++;
    return {
      center: [
        a.p.center[0] + (b.p.center[0] - a.p.center[0]) * u,
        a.p.center[1] + (b.p.center[1] - a.p.center[1]) * u,
        a.p.center[2] + (b.p.center[2] - a.p.center[2]) * u,
      ],
      radius: a.p.radius,
    };
  }
}

// --------------------------------------------------------- the bridged world

export const BRIDGED_INPUT =
  "another fly, through the first-contact bridge: seen as a moving thing, never touched";

/**
 * A subject's own world with the other fly added to its moving things. Every
 * other question is the wrapped world's own answer.
 */
export class BridgedWorld implements FlyWorld {
  readonly id: string;
  readonly home: FlyWorld["home"];
  readonly inputs: WorldInputs;
  // `declare`: with useDefineForClassFields a plain optional field would put
  // an own `wind` property on every bridged world, even in still air.
  declare readonly wind?: (p: V3, t: number) => V3;
  readonly inner: FlyWorld;
  private readonly channel: PerceptChannel;
  private readonly tauOf: (flyT: number) => number;

  constructor(inner: FlyWorld, channel: PerceptChannel, tauOf: (flyT: number) => number) {
    this.inner = inner;
    this.channel = channel;
    this.tauOf = tauOf;
    this.id = `${inner.id}+first-contact`;
    this.home = inner.home;
    this.inputs = {
      supported: [...inner.inputs.supported, BRIDGED_INPUT],
      proxies: [...inner.inputs.proxies],
      unsupported: [...inner.inputs.unsupported],
    };
    // A world without wind has still air: only forward it when there is one.
    if (inner.wind) {
      const wind = inner.wind.bind(inner);
      this.wind = (p, t) => wind(p, t);
    }
  }

  perchAt(x: number, z: number, maxY: number): Perch | null {
    return this.inner.perchAt(x, z, maxY);
  }
  raycast(origin: V3, dir: V3, maxT: number, visible?: boolean): Hit | null {
    return this.inner.raycast(origin, dir, maxT, visible);
  }
  solid(p: V3): boolean {
    return this.inner.solid(p);
  }
  light(p: V3): LightSample {
    return this.inner.light(p);
  }
  landingSites(near: V3, radius: number, out: LandingSite[]): void {
    this.inner.landingSites(near, radius, out);
  }
  foodAt(p: V3): FoodPatch | null {
    return this.inner.foodAt(p);
  }
  odour(p: V3): number {
    return this.inner.odour(p);
  }
  landmarks(near: V3, radius: number, out: Landmark[]): void {
    this.inner.landmarks(near, radius, out);
  }
  movers(near: V3, radius: number, out: Mover[], t: number): void {
    this.inner.movers(near, radius, out, t);
    const p = this.channel.at(this.tauOf(t));
    if (!p) return;
    const d = Math.hypot(
      p.center[0] - near[0],
      p.center[1] - near[1],
      p.center[2] - near[2],
    );
    if (d > radius + p.radius) return;
    out.push({
      id: BRIDGE_MOVER_ID,
      kind: "stimulus",
      center: [p.center[0], p.center[1], p.center[2]],
      radius: p.radius,
    });
  }
}

// --------------------------------------------------------------- the bridge

export interface BridgeConfig {
  /** Encounter-time period between exchanges (s). */
  exchangeS: number;
  /** A receiver sees the sender as it was this long ago (s); at least one exchange. */
  latencyS: number;
  /** A sender that would move faster than this between exchanges is refused (m/s). */
  maxSpeedMS: number;
  /** Deliveries per direction before the bridge closes itself. */
  maxDeliveries: number;
  /** The other fly's equivalent-sphere radius (m). */
  radiusM: number;
}

export const DEFAULT_BRIDGE: Readonly<BridgeConfig> = Object.freeze({
  exchangeS: 0.01,
  latencyS: 0.01,
  // Above the body's flight limit and its escape jump, so only a jump in the
  // record (a restart, a teleport, a frame error) is refused.
  maxSpeedMS: 3,
  maxDeliveries: 2_000_000,
  radiusM: FLY_EQUIVALENT_RADIUS_M,
});

export function checkBridgeConfig(c: BridgeConfig): BridgeConfig {
  if (!(c.exchangeS > 0 && c.exchangeS <= 0.1))
    throw new Error("bridge: the exchange period must be in (0, 0.1] s");
  if (!(c.latencyS >= c.exchangeS - 1e-12 && c.latencyS <= 1))
    throw new Error(
      "bridge: the latency must be at least one exchange period (a receiver never sees a sample that has not arrived) and at most 1 s",
    );
  if (!(c.maxSpeedMS > 0 && c.maxSpeedMS <= 20))
    throw new Error("bridge: the speed bound must be in (0, 20] m/s");
  if (!(Number.isInteger(c.maxDeliveries) && c.maxDeliveries > 0))
    throw new Error("bridge: the delivery budget must be a positive integer");
  percept({ center: [0, 0, 0], radius: c.radiusM });
  return c;
}

/** Who allowed a bridge, for what, between whom. Research subjects only. */
export interface BridgeAuthorization {
  by: string;
  purpose: string;
  subjects: [string, string];
  scope: "research-subjects-only";
}

/** One side of a bridge: a research subject, read through an accessor and never written. */
export interface BridgeEndpoint {
  id: string;
  frame: string;
  /** Where its body is now, in its own world frame (m). */
  position(): V3;
}

interface Direction {
  sender: 0 | 1;
  receiver: 0 | 1;
  map: FrameMap;
  channel: PerceptChannel;
  last: { tau: number; p: V3 } | null;
  delivered: number;
  refused: number;
  /** Compact record of every delivery, for the summary's digest. */
  record: number[];
}

/**
 * A bounded two-way bridge between two research subjects. `maps[0]` places
 * subject 1 in subject 0's frame (what subject 0 sees); `maps[1]` places
 * subject 0 in subject 1's frame.
 */
export class EncounterBridge {
  readonly config: BridgeConfig;
  readonly authorization: BridgeAuthorization;
  readonly endpoints: readonly [BridgeEndpoint, BridgeEndpoint];
  readonly log = new BridgeLog();
  private readonly dirs: [Direction, Direction];
  private state: "new" | "open" | "closed" = "new";
  private closedReason: string | null = null;

  constructor(
    endpoints: readonly [BridgeEndpoint, BridgeEndpoint],
    maps: readonly [FrameMap, FrameMap],
    authorization: BridgeAuthorization,
    config: BridgeConfig = DEFAULT_BRIDGE,
  ) {
    for (const e of endpoints) refuseOriginal(e.id, "bridge endpoint");
    for (const s of authorization.subjects) refuseOriginal(s, "authorized subject");
    if (endpoints[0].id === endpoints[1].id)
      throw new Error("bridge: two different subjects are needed");
    if (authorization.scope !== "research-subjects-only")
      throw new Error("bridge: authorization covers research subjects only");
    if (!authorization.by.trim() || !authorization.purpose.trim())
      throw new Error("bridge: an authorization names who gave it and why");
    const named = [...authorization.subjects].sort().join(" ");
    if (named !== [endpoints[0].id, endpoints[1].id].sort().join(" "))
      throw new Error("bridge: the authorization names other subjects");
    for (const [i, m] of maps.entries()) {
      checkFrameMap(m);
      const sender = endpoints[1 - i]!,
        receiver = endpoints[i]!;
      if (m.from !== sender.frame || m.to !== receiver.frame)
        throw new Error(
          `bridge: map ${m.id} goes ${m.from} → ${m.to}, not ${sender.frame} → ${receiver.frame}`,
        );
    }
    this.config = checkBridgeConfig({ ...config });
    this.authorization = { ...authorization, subjects: [...authorization.subjects] };
    this.endpoints = endpoints;
    const dir = (receiver: 0 | 1): Direction => ({
      sender: receiver === 0 ? 1 : 0,
      receiver,
      map: maps[receiver],
      channel: new PerceptChannel(this.config.latencyS),
      last: null,
      delivered: 0,
      refused: 0,
      record: [],
    });
    this.dirs = [dir(0), dir(1)];
  }

  /** What subject `i` receives: hand it to `BridgedWorld`. */
  channel(i: 0 | 1): PerceptChannel {
    return this.dirs[i].channel;
  }

  get isOpen(): boolean {
    return this.state === "open";
  }

  get reason(): string | null {
    return this.closedReason;
  }

  open(tau: number): void {
    if (this.state !== "new")
      throw new Error(`bridge: cannot open a ${this.state} bridge`);
    this.state = "open";
    this.log.append(tau, "open", {
      schema: BRIDGE_SCHEMA,
      subjects: this.endpoints.map((e) => ({ id: e.id, frame: e.frame })),
      authorization: this.authorization,
      config: this.config,
      maps: this.dirs.map((d) => d.map),
    });
  }

  close(tau: number, reason: string): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.closedReason = reason;
    for (const d of this.dirs) d.channel.break();
    this.log.append(tau, "close", { reason });
    this.log.append(tau, "summary", this.summary());
  }

  summary(): Record<string, unknown> {
    return {
      directions: this.dirs.map((d) => ({
        to: this.endpoints[d.receiver].id,
        from: this.endpoints[d.sender].id,
        delivered: d.delivered,
        refused: d.refused,
        channel: { ...d.channel.stats },
        deliveries: sha256(JSON.stringify(d.record)),
      })),
    };
  }

  /**
   * Carries each subject's current position to the other, at encounter time
   * `tau`, if the clock says they are synchronized.
   */
  exchange(tau: number, sync: SyncRecord): void {
    if (this.state !== "open") return;
    if (!sync.synchronized || Math.abs(sync.tau - tau) > 1e-9) {
      for (const d of this.dirs) d.channel.break();
      this.log.append(tau, "desync", { skewS: sync.skewS, syncTau: sync.tau });
      this.close(tau, "the subjects' clocks are not synchronized");
      return;
    }
    for (const d of this.dirs) {
      if (d.delivered >= this.config.maxDeliveries) {
        this.log.append(tau, "budget", { to: this.endpoints[d.receiver].id });
        this.close(tau, "delivery budget spent");
        return;
      }
      const raw = this.endpoints[d.sender].position();
      const p = applyMap(d.map, raw);
      if (!p.every(Number.isFinite)) {
        d.refused++;
        d.channel.break();
        d.last = null;
        this.log.append(tau, "refuse", {
          to: this.endpoints[d.receiver].id,
          why: "not finite",
        });
        continue;
      }
      if (d.last) {
        const dt = tau - d.last.tau;
        const v =
          Math.hypot(p[0] - d.last.p[0], p[1] - d.last.p[1], p[2] - d.last.p[2]) / dt;
        if (!(v <= this.config.maxSpeedMS)) {
          d.refused++;
          d.channel.break();
          d.last = { tau, p };
          this.log.append(tau, "refuse", {
            to: this.endpoints[d.receiver].id,
            why: "jump",
            speedMS: v,
          });
          continue;
        }
      }
      d.channel.push(tau, percept({ center: p, radius: this.config.radiusM }));
      d.last = { tau, p };
      d.delivered++;
      d.record.push(
        Math.round(tau * 1e4),
        Math.round(p[0] * 1e6),
        Math.round(p[1] * 1e6),
        Math.round(p[2] * 1e6),
      );
    }
  }
}
