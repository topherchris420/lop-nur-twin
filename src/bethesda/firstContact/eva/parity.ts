/**
 * Parity of the TypeScript port with Eva's Python service, step for step: the
 * fixture format `scripts/eva-parity.py` writes, and the replay that compares
 * the port with it. The criterion: discrete fields exact at every step;
 * continuous fields within 1e-9 absolute at every step and at every
 * checkpoint (full state, plasticity memory and `/state` snapshot).
 *
 * Used by `eva.test.ts` (research gardens born for each fixture) and by
 * `scripts/first-contact-twins.ts` (a research twin restored from a copy of a
 * life). Research identities only: `birth` and `EvaGarden.restore` refuse
 * anything else.
 */
import { birth, EvaGarden, type EvaState } from "./garden.js";
import type { Weather } from "./learning.js";
import { sidecarMemory, type PlasticityMemory } from "./plasticity.js";

export const TOLERANCE = 1e-9;

export interface Run {
  name: string;
  seed: number;
  seed_string: string;
  life_id: string;
  born: number;
  plasticity: "off" | "shadow" | "active";
  weather?: Weather;
  body?: Record<string, number>;
  outage?: [number, number, number];
  /** Steps after the start (from a copy: after its tick). */
  ticks: number;
  /**
   * A research twin restored from a copy of a life (`eva-parity.py
   * from-copy`), instead of a garden born for the run: `born` is then the
   * copy's last step time, and the replay restores the first checkpoint.
   */
  from_copy?: {
    start_tick: number;
    /** Her world row as stored in the copy (only `life_id` changed). */
    stored_state: EvaState;
    /** Her sidecar file as copied (only `life_id` changed), or null without one. */
    stored_sidecar: unknown;
    /** The latest moments in the copy, oldest first: `[id, at, words]`. */
    kept_moments: [number, number, string][];
  };
}

export interface Checkpoint {
  tick: number;
  state: EvaState;
  memory: PlasticityMemory | null;
  snapshot: unknown;
  moments: number;
  flat: Record<string, unknown>;
  needs: [number, number, number];
  born_moments?: [number, number, string][];
}

export interface Fixture {
  run: Run;
  python: { version: string; platform: string };
  summary: { ticks: number; plasticity: Record<string, number> | null };
  steps: {
    d: Record<string, unknown>;
    n?: [number, number, number];
    nm?: [number, number, string][];
  }[];
  checkpoints: Checkpoint[];
}

export const CONTINUOUS = new Set([
  "x",
  "y",
  "distance",
  "next_decision",
  "next_moment",
  "body",
]);
export const isContinuousKey = (k: string) =>
  CONTINUOUS.has(k) || k.startsWith("g:") || k.startsWith("pm:");

/** The per-step values `scripts/eva-parity.py` records (`flat`). */
export function flat(
  s: EvaState,
  memory: PlasticityMemory | null,
  hasPlasticity: boolean,
): Record<string, unknown> {
  const L = s.learning;
  const tr = s.travel;
  const last = L.last;
  const out: Record<string, unknown> = {
    place: s.place,
    activity: s.activity,
    journeys: s.journeys,
    was_day: s.was_day,
    travel:
      tr === null
        ? null
        : [tr.destination, tr.started_at, tr.ends_at, tr.paused_until ?? null],
    visits: s.visits,
    trials: L.trials,
    surprises: L.surprises,
    last: last === null ? null : [last.action, last.condition, last.success],
    x: s.position[0],
    y: s.position[1],
    distance: s.distance,
    next_decision: s.next_decision,
    next_moment: s.next_moment,
    body: [s.body.wing_integrity, s.body.leg_integrity, s.body.wetness],
  };
  for (const [k, m] of Object.entries(L.models)) {
    out["m:" + k] = [m.samples, m.successes];
    out["g:" + k] = m.gain;
  }
  for (const [k, o] of Object.entries(L.objects)) out["o:" + k] = o.samples;
  if (hasPlasticity) {
    out.p =
      memory === null
        ? null
        : [
            memory.samples,
            memory.discarded,
            memory.duplicates,
            memory.overrides,
            memory.would_override,
            memory.last_tick,
            memory.mode,
          ];
    out.plo = memory === null ? null : memory.last_override;
    for (const [k, st] of Object.entries(memory?.stats ?? {})) {
      out["pn:" + k] = st.n;
      out["pm:" + k] = st.mean;
    }
  }
  return out;
}

/**
 * Her learner's counting rule, as `derived` in `scripts/eva-parity.py`: one
 * more trial, one more sample of each tracked object, and one more sample (and
 * success) of the executed action's model. The fixture records every value
 * that differs from it, and the full counters are compared at checkpoints.
 */
export function derive(expected: Map<string, unknown>, recordedLast: unknown): void {
  const trials = expected.get("trials");
  if (typeof trials === "number") expected.set("trials", trials + 1);
  for (const [k, v] of expected)
    if (k.startsWith("o:")) expected.set(k, (v as number) + 1);
  if (Array.isArray(recordedLast)) {
    const [action, condition, success] = recordedLast as [string, string, boolean];
    const key = `m:${action}/${condition}`;
    const [n, ok] = (expected.get(key) as [number, number] | undefined) ?? [0, 0];
    expected.set(key, [n + 1, ok + (success ? 1 : 0)]);
  }
}

/** Her needs, from the fixture's integers in units of 1e-5 (exact: she rounds to five places). */
export const fromUnits = (k: number) => Number.parseFloat(`${k}e-5`);

/** Exact equality of JSON values (key order ignored, -0 equal to 0). */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object")
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

export class Ledger {
  discrete: string[] = [];
  discreteCount = 0;
  continuousOver: string[] = [];
  continuousOverCount = 0;
  compared = 0;
  identical = 0;
  maxDeviation = 0;
  where = "";

  near(path: string, want: unknown, got: unknown): void {
    if (typeof want === "number" && typeof got === "number") {
      this.compared++;
      const d = Math.abs(want - got);
      if (want === got) this.identical++;
      if (d > this.maxDeviation || Number.isNaN(d)) {
        this.maxDeviation = Number.isNaN(d) ? Infinity : d;
        this.where = path;
      }
      if (!(d <= TOLERANCE)) {
        this.continuousOverCount++;
        if (this.continuousOver.length < 20)
          this.continuousOver.push(`${path}: python ${want}, port ${got}`);
      }
      return;
    }
    if (Array.isArray(want) && Array.isArray(got) && want.length === got.length) {
      want.forEach((w, i) => this.near(`${path}[${i}]`, w, got[i]));
      return;
    }
    this.exact(path, want, got);
  }

  exact(path: string, want: unknown, got: unknown): void {
    if (same(want, got)) return;
    this.discreteCount++;
    if (this.discrete.length < 20)
      this.discrete.push(
        `${path}: python ${JSON.stringify(want)}, port ${JSON.stringify(got)}`,
      );
  }
}

// Leaves of her state, memory and snapshot that are counts, labels or clock
// times: compared exactly. Every other number is continuous.
export const DISCRETE_LEAVES = new Set([
  "version",
  "ticks",
  "journeys",
  "trials",
  "surprises",
  "samples",
  "successes",
  "created_tick",
  "last_tick",
  "since_tick",
  "overrides",
  "would_override",
  "discarded",
  "duplicates",
  "tick",
  "born_at",
  "updated_at",
  "started_at",
  "ends_at",
  "paused_until",
  "at",
  "id",
  "moments_count",
  "places_visited",
  "temperature",
  "code",
  "wind",
  "rain",
  "fetched_at",
]);

export function compareTree(
  ledger: Ledger,
  path: string,
  want: unknown,
  got: unknown,
): void {
  if (
    want !== null &&
    typeof want === "object" &&
    got !== null &&
    typeof got === "object"
  ) {
    if (Array.isArray(want) !== Array.isArray(got)) return ledger.exact(path, want, got);
    const keys = new Set([...Object.keys(want), ...Object.keys(got)]);
    for (const k of keys)
      compareTree(
        ledger,
        `${path}.${k}`,
        (want as Record<string, unknown>)[k],
        (got as Record<string, unknown>)[k],
      );
    return;
  }
  const leaf = path.slice(path.lastIndexOf(".") + 1);
  const parent = path.split(".").slice(-2, -1)[0];
  const discrete =
    DISCRETE_LEAVES.has(leaf) ||
    parent === "visits" ||
    (leaf === "n" && path.includes(".stats."));
  if (typeof want === "number" && typeof got === "number" && !discrete)
    return ledger.near(path, want, got);
  ledger.exact(path, want, got);
}

export function withoutWallClock(memory: PlasticityMemory | null): unknown {
  if (memory === null) return null;
  const { created_at: _created, ...rest } = structuredClone(memory);
  return { ...rest, mode_history: rest.mode_history.map(({ at: _at, ...h }) => h) };
}

export interface Replay {
  ledger: Ledger;
  steps: number;
  checkpoints: number;
  momentsChecked: number;
  garden: EvaGarden;
}

export function replay(fx: Fixture): Replay {
  const run = fx.run;
  const ledger = new Ledger();
  const expected = new Map<string, unknown>();
  const born = fx.checkpoints[0]!;
  const copy = run.from_copy;
  const startTick = copy?.start_tick ?? 0;
  for (const [k, v] of Object.entries(born.flat)) expected.set(k, v);
  const checkpoints = new Map(fx.checkpoints.map((c) => [c.tick, c]));
  const hasPlasticity = run.plasticity !== "off";
  let steps = 0;
  let seenMoments = copy ? born.moments : 0;
  let momentsChecked = 0;
  let checked = 0;

  let units = [...born.needs];
  const compareStep = (g: EvaGarden, tick: number, entry?: Fixture["steps"][number]) => {
    if (entry) {
      derive(expected, "last" in entry.d ? entry.d.last : expected.get("last"));
      for (const [k, v] of Object.entries(entry.d)) expected.set(k, v);
      if (entry.n) units = units.map((u, i) => u + entry.n![i]!);
    }
    const state = g.state();
    const actual = flat(state, g.plasticityMemory(), hasPlasticity);
    (["energy", "fullness", "water"] as const).forEach((key, i) =>
      ledger.near(`tick ${tick} ${key}`, fromUnits(units[i]!), state[key]),
    );
    const keys = new Set([...expected.keys(), ...Object.keys(actual)]);
    for (const k of keys) {
      const path = `tick ${tick} ${k}`;
      if (!expected.has(k) || !(k in actual))
        ledger.exact(path, expected.get(k) ?? "(absent)", actual[k] ?? "(absent)");
      else if (isContinuousKey(k)) ledger.near(path, expected.get(k), actual[k]);
      else ledger.exact(path, expected.get(k), actual[k]);
    }
    const fresh = g.moments().filter((m) => m.id > seenMoments);
    const want = entry ? (entry.nm ?? []) : (born.born_moments ?? []);
    ledger.exact(
      `tick ${tick} moments`,
      want,
      fresh.map((m) => [m.id, m.at, m.text]),
    );
    momentsChecked += fresh.length;
    if (fresh.length) seenMoments = fresh[fresh.length - 1]!.id;
    const cp = checkpoints.get(tick);
    if (cp && (entry || tick === startTick)) {
      checked++;
      compareTree(ledger, `tick ${tick} state`, cp.state, g.state());
      compareTree(
        ledger,
        `tick ${tick} memory`,
        withoutWallClock(cp.memory),
        withoutWallClock(g.plasticityMemory()),
      );
      compareTree(ledger, `tick ${tick} snapshot`, cp.snapshot, g.snapshot());
      ledger.exact(`tick ${tick} moments_count`, cp.moments, g.momentsCount);
    }
  };

  const onStep = (g: EvaGarden) => {
    steps++;
    compareStep(g, g.ticks, fx.steps[steps - 1]);
  };
  const garden = copy
    ? EvaGarden.restore(copy.stored_state, {
        plasticity: run.plasticity,
        memory:
          copy.stored_sidecar === null ? undefined : sidecarMemory(copy.stored_sidecar),
        moments: {
          count: born.moments,
          kept: copy.kept_moments.map(([id, at, text]) => ({ id, at, text })),
        },
        onStep,
      })
    : birth({
        seed: run.seed_string,
        bornAt: run.born,
        lifeId: run.life_id,
        plasticity: run.plasticity,
        body: run.body,
        onStep,
      });
  compareStep(garden, startTick);

  const outage = run.outage;
  let resumed = false;
  let t = run.born;
  while (garden.ticks < startTick + run.ticks) {
    t += 5;
    if (outage && outage[0] < t - run.born && t - run.born <= outage[0] + outage[1])
      continue;
    if (outage && !resumed && t - run.born > outage[0] + outage[1]) {
      resumed = true;
      garden.advance(run.born + outage[0] + outage[1] + outage[2]);
    }
    if (run.weather && (t - run.born) % 3600 === 5)
      garden.setWeather({ ...run.weather, fetched_at: t });
    garden.advance(t);
  }
  return { ledger, steps, checkpoints: checked, momentsChecked, garden };
}
