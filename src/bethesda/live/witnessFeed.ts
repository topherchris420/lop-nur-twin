/**
 * The viewer's side of the witness (life/observation.ts): where the one living
 * life is served, and how a page follows it. A viewer only presents what it
 * received. It interpolates between two observations for smooth drawing and
 * never runs, steps or predicts the fly; when the witness is not live it says
 * so, and it never draws a fly of its own in the shared one's place.
 */
import { parseWitness, type LifeObservation, type Witness } from "../life/observation";

/**
 * The observer on the life's VM (deploy/bethesda-life/public.sh). Every CSP
 * copy's `connect-src` allows it, and nothing else of the life.
 */
export const WITNESS_ORIGIN = "https://129-213-139-78.sslip.io";

/** How far behind the newest observation the fly is drawn, so two are always at hand. */
export const PRESENT_DELAY_MS = 1200;
/** No message for this long and the page says it has lost the observer. */
export const SILENT_AFTER_MS = 5000;
/** Observations further apart than this are a jump (a pause, a restart): never interpolated across. */
const JUMP_TICKS = 50;
const JUMP_M = 20;

/** The fly's pose in one observation, with the viewer's clock when it arrived. */
export interface Sample {
  at: number;
  tick: number;
  x: number;
  z: number;
  yaw: number;
}

/** `samples` with the observation's pose received at `at`; a tick already held changes nothing. */
export function addSample(
  samples: readonly Sample[],
  o: LifeObservation,
  at: number,
  keep = 8,
): Sample[] {
  const last = samples.at(-1);
  if (last && o.tick <= last.tick) return [...samples];
  const [x, , z] = o.fly.position;
  return [...samples, { at, tick: o.tick, x, z, yaw: o.fly.yaw }].slice(-keep);
}

/** The shorter way round from `a` to `b`, `t` of the way. */
function turn(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

/**
 * Where to draw the fly at `now`: between the two samples either side of
 * `now - delay`, the oldest before them, and the newest held after it. Never
 * beyond the newest observation, and never across a jump.
 */
export function presentPose(
  samples: readonly Sample[],
  now: number,
  delay = PRESENT_DELAY_MS,
): { x: number; z: number; yaw: number } | null {
  if (!samples.length) return null;
  const when = now - delay;
  const first = samples[0]!,
    last = samples.at(-1)!;
  if (when <= first.at) return { x: first.x, z: first.z, yaw: first.yaw };
  if (when >= last.at) return { x: last.x, z: last.z, yaw: last.yaw };
  const i = samples.findIndex((s) => s.at > when);
  const a = samples[i - 1]!,
    b = samples[i]!;
  if (b.tick - a.tick > JUMP_TICKS || Math.hypot(b.x - a.x, b.z - a.z) > JUMP_M)
    return { x: b.x, z: b.z, yaw: b.yaw };
  const t = (when - a.at) / (b.at - a.at);
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: turn(a.yaw, b.yaw, t),
  };
}

/** What the page shows: the witness as served, or why the page has none. */
export type Feed =
  | { kind: "connecting" }
  | { kind: "witness"; witness: Witness; at: number }
  | { kind: "lost"; reason: string; last: Witness | null };

/**
 * Follows the witness stream, calling `onFeed` with every witness and every
 * loss. The browser retries a dropped stream itself; one it refuses (a 429, a
 * proxy error) is opened again after `retryMs`. Returns a function that stops.
 */
export function followWitness(
  onFeed: (feed: Feed) => void,
  { origin = WITNESS_ORIGIN, retryMs = 15_000, now = () => performance.now() } = {},
): () => void {
  let source: EventSource | null = null,
    retry: ReturnType<typeof setTimeout> | undefined,
    last: Witness | null = null,
    stopped = false;
  const open = () => {
    source = new EventSource(`${origin}/v1/stream`);
    source.onmessage = (e: MessageEvent<string>) => {
      try {
        last = parseWitness(JSON.parse(e.data));
        onFeed({ kind: "witness", witness: last, at: now() });
      } catch (err) {
        onFeed({
          kind: "lost",
          reason: `the observer sent a witness this page cannot read (${err instanceof Error ? err.message : String(err)})`,
          last: null,
        });
      }
    };
    source.onerror = () => {
      onFeed({ kind: "lost", reason: "the observer cannot be reached; retrying", last });
      if (source?.readyState === EventSource.CLOSED && !stopped) {
        source.close();
        retry = setTimeout(open, retryMs);
      }
    };
  };
  onFeed({ kind: "connecting" });
  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    source?.close();
  };
}

/** "3 min", "2 h 5 min", "4 d 1 h": a span of seconds as people say it. */
export function span(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60),
    h = Math.floor(m / 60),
    d = Math.floor(h / 24);
  if (d) return `${d} d ${h % 24} h`;
  if (h) return `${h} h ${m % 60} min`;
  return `${m} min`;
}
