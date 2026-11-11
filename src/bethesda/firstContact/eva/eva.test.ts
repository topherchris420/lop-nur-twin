/**
 * The TypeScript port of Eva's controller against her own Python code.
 *
 * Every fixture in `fixtures/` was written by `scripts/eva-parity.py`, which
 * runs her unchanged sources (research gardens in temporary directories,
 * never Eva). The parity criterion: discrete fields exact at every step;
 * continuous fields within 1e-9 absolute at every step and at every
 * checkpoint (full state, plasticity memory and `/state` snapshot).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { OriginalRefused, EVA } from "../originals.js";
import {
  birth,
  daylight,
  seasonalWeather,
  weatherName,
  type EvaGarden,
  type EvaState,
} from "./garden.js";
import type { Point, Weather } from "./learning.js";
import { newYork } from "./newYork.js";
import type { PlasticityMemory } from "./plasticity.js";
import { pyDist, pyHypot, pyRound, pyRoundInt } from "./pyMath.js";
import { PyRandom } from "./pyRandom.js";
import { sha512 } from "./sha512.js";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const load = <T>(name: string): T =>
  JSON.parse(gunzipSync(readFileSync(new URL(name, FIXTURES))).toString("utf8")) as T;

const TOLERANCE = 1e-9;

/** Distance in units in the last place between two doubles. */
function ulps(a: number, b: number): number {
  if (Object.is(a, b)) return 0;
  const view = new DataView(new ArrayBuffer(16));
  view.setFloat64(0, a);
  view.setFloat64(8, b);
  const order = (o: number) => {
    const bits = view.getBigInt64(o);
    return bits < 0n ? -(bits & 0x7fffffffffffffffn) : bits;
  };
  const d = order(0) - order(8);
  return Number(d < 0n ? -d : d);
}

interface Vectors {
  python: string;
  platform: string;
  random: {
    script: [string, ...number[]][];
    seeds: { seed: string | { int: string }; results: (number | string)[] }[];
  };
  round: [number, number, number][];
  round_int: [number, number][];
  hypot: [number, number, number][];
  dist: [Point, Point, number][];
  clock: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    string,
    number,
    number,
    boolean,
    boolean,
  ][];
  weather_name: [number, string][];
  trig: [number, number, number][];
}

const vectors = load<Vectors>("vectors.json.gz");

describe("CPython's pieces, against vectors written by real Python", () => {
  it("SHA-512 is Node's", () => {
    let seed = 1;
    for (let length = 0; length < 300; length++) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++)
        bytes[i] = (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
      const ours = Buffer.from(sha512(bytes)).toString("hex");
      expect(ours).toBe(createHash("sha512").update(bytes).digest("hex"));
    }
  });

  it("random.Random: seeding from str and int, random, uniform, choice, getrandbits", () => {
    const { script, seeds } = vectors.random;
    expect(seeds.length).toBeGreaterThan(10);
    for (const { seed, results } of seeds) {
      const rng = new PyRandom(typeof seed === "string" ? seed : BigInt(seed.int));
      script.forEach((op, i) => {
        const want = results[i];
        const [name, a, b] = op;
        if (name === "random") expect(rng.random()).toBe(want);
        else if (name === "uniform") expect(rng.uniform(a!, b!)).toBe(want);
        else if (name === "choice") expect(rng.randbelow(a!)).toBe(want);
        else expect(rng.getrandbits(a!).toString()).toBe(want);
      });
    }
  });

  it("round(x, n) exactly, ties to even on the exact binary value", () => {
    let ties = 0;
    for (const [x, n, want] of vectors.round) {
      const got = pyRound(x, n);
      if (!Object.is(got, want))
        throw new Error(`round(${x}, ${n}) = ${want}, port ${got}`);
      const scaled = x * 10 ** n;
      if (n >= 0 && n < 8 && Math.abs(scaled - Math.trunc(scaled)) === 0.5) ties++;
    }
    expect(ties).toBeGreaterThan(100);
    expect(pyRound(0.015625, 5)).toBe(0.01562);
    for (const [x, want] of vectors.round_int) expect(pyRoundInt(x)).toBe(want);
  });

  it("math.hypot and math.dist bit for bit (CPython's vector_norm)", () => {
    for (const [a, b, want] of vectors.hypot) expect(pyHypot(a, b)).toBe(want);
    for (const [p, q, want] of vectors.dist) expect(pyDist(p, q)).toBe(want);
  });

  it("the New York clock, seasonal weather and daylight", () => {
    for (const [
      t,
      y,
      mo,
      d,
      h,
      mi,
      s,
      yday,
      date,
      dst,
      temp,
      day,
      sunDay,
    ] of vectors.clock) {
      const local = newYork(t);
      expect([
        local.year,
        local.month,
        local.day,
        local.hour,
        local.minute,
        local.second,
      ]).toEqual([y, mo, d, h, mi, s]);
      expect([local.yday, local.date, local.dst]).toEqual([yday, date, dst]);
      expect(seasonalWeather(t).temperature).toBe(temp);
      expect(daylight(t, seasonalWeather(t))).toBe(day);
      const sun: Weather = { temperature: 0, code: 0, wind: 0, rain: 0, sun: COLD_SUN };
      expect(daylight(t, sun)).toBe(sunDay);
    }
    for (const [code, name] of vectors.weather_name) expect(weatherName(code)).toBe(name);
  });

  it("sin and cos: V8 and this Python's libm agree to one unit in the last place", () => {
    let differ = 0;
    let worst = 0;
    for (const [x, s, c] of vectors.trig) {
      const d = Math.max(ulps(Math.sin(x), s), ulps(Math.cos(x), c));
      worst = Math.max(worst, d);
      if (d) differ++;
    }
    console.info(
      `trig: ${differ} of ${vectors.trig.length} arguments differ (worst ${worst} ulp) between V8 and Python ${vectors.python} on ${vectors.platform}`,
    );
    expect(worst).toBeLessThanOrEqual(1);
  });
});

// The sunrise/sunset dict of the cold-rain run (scripts/eva-parity.py COLD_RAIN).
const COLD_SUN: Record<string, number[]> = {
  "2026-11-09": [
    Date.UTC(2026, 10, 9, 11, 41) / 1000,
    Date.UTC(2026, 10, 9, 21, 58) / 1000,
  ],
  "2026-11-10": [
    Date.UTC(2026, 10, 10, 11, 42) / 1000,
    Date.UTC(2026, 10, 10, 21, 57) / 1000,
  ],
  "2026-11-11": [
    Date.UTC(2026, 10, 11, 11, 43) / 1000,
    Date.UTC(2026, 10, 11, 21, 56) / 1000,
  ],
};

// ------------------------------------------------------------------ parity

interface Run {
  name: string;
  seed: number;
  seed_string: string;
  life_id: string;
  born: number;
  plasticity: "off" | "shadow" | "active";
  weather?: Weather;
  body?: Record<string, number>;
  outage?: [number, number, number];
  ticks: number;
}

interface Checkpoint {
  tick: number;
  state: EvaState;
  memory: PlasticityMemory | null;
  snapshot: unknown;
  moments: number;
  flat: Record<string, unknown>;
  needs: [number, number, number];
  born_moments?: [number, number, string][];
}

interface Fixture {
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

const CONTINUOUS = new Set([
  "x",
  "y",
  "distance",
  "next_decision",
  "next_moment",
  "body",
]);
const isContinuousKey = (k: string) =>
  CONTINUOUS.has(k) || k.startsWith("g:") || k.startsWith("pm:");

/** The per-step values `scripts/eva-parity.py` records (`flat`). */
function flat(
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
function derive(expected: Map<string, unknown>, recordedLast: unknown): void {
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
const fromUnits = (k: number) => Number.parseFloat(`${k}e-5`);

/** Exact equality of JSON values (key order ignored, -0 equal to 0). */
function same(a: unknown, b: unknown): boolean {
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

class Ledger {
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
const DISCRETE_LEAVES = new Set([
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

function compareTree(ledger: Ledger, path: string, want: unknown, got: unknown): void {
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

function withoutWallClock(memory: PlasticityMemory | null): unknown {
  if (memory === null) return null;
  const { created_at: _created, ...rest } = structuredClone(memory);
  return { ...rest, mode_history: rest.mode_history.map(({ at: _at, ...h }) => h) };
}

interface Replay {
  ledger: Ledger;
  steps: number;
  checkpoints: number;
  momentsChecked: number;
  garden: EvaGarden;
}

function replay(fx: Fixture): Replay {
  const run = fx.run;
  const ledger = new Ledger();
  const expected = new Map<string, unknown>();
  const born = fx.checkpoints[0]!;
  for (const [k, v] of Object.entries(born.flat)) expected.set(k, v);
  const checkpoints = new Map(fx.checkpoints.map((c) => [c.tick, c]));
  const hasPlasticity = run.plasticity !== "off";
  let steps = 0;
  let seenMoments = 0;
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
    if (cp && (entry || tick === 0)) {
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

  const garden = birth({
    seed: run.seed_string,
    bornAt: run.born,
    lifeId: run.life_id,
    plasticity: run.plasticity,
    body: run.body,
    onStep: (g) => {
      steps++;
      compareStep(g, g.ticks, fx.steps[steps - 1]);
    },
  });
  compareStep(garden, 0);

  const outage = run.outage;
  let resumed = false;
  let t = run.born;
  while (garden.ticks < run.ticks) {
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

const runFiles = readdirSync(FIXTURES)
  .filter((f) => f.startsWith("run-") && f.endsWith(".json.gz"))
  .sort();

describe("parity with her Python service, step for step", () => {
  it("covers off, shadow and active, three seeds, day and night births, a DST change and a swap", () => {
    const runs = runFiles.map((f) => load<Fixture>(f));
    expect(runs.length).toBeGreaterThanOrEqual(5);
    expect(new Set(runs.map((r) => r.run.plasticity))).toEqual(
      new Set(["off", "shadow", "active"]),
    );
    expect(new Set(runs.map((r) => r.run.seed)).size).toBeGreaterThanOrEqual(3);
    const bornByDay = runs.map((r) => daylight(r.run.born, seasonalWeather(r.run.born)));
    expect(bornByDay).toContain(true);
    expect(bornByDay).toContain(false);
    expect(
      runs.some(
        (r) => newYork(r.run.born).dst !== newYork(r.run.born + 5 * r.run.ticks).dst,
      ),
    ).toBe(true);
    expect(runs.some((r) => r.run.weather)).toBe(true);
    expect(runs.some((r) => r.run.outage)).toBe(true);
    expect(runs.some((r) => (r.summary.plasticity?.overrides ?? 0) > 0)).toBe(true);
    for (const r of runs) expect(r.run.life_id.startsWith("research-")).toBe(true);
  });

  it(
    "the replay notices a discrete or a continuous difference",
    { timeout: 300_000 },
    () => {
      const fx = load<Fixture>(runFiles[0]!);
      const step = fx.steps.findIndex((s, i) => i > 1000 && "x" in s.d);
      fx.steps[999]!.d.place = "nowhere";
      fx.steps[step]!.d.x = (fx.steps[step]!.d.x as number) + 1e-6;
      const { ledger } = replay(fx);
      expect(ledger.discrete.some((m) => m.startsWith("tick 1000 place"))).toBe(true);
      expect(ledger.continuousOver.some((m) => m.startsWith(`tick ${step + 1} x`))).toBe(
        true,
      );
    },
  );

  for (const file of runFiles) {
    it(`replays ${file}`, { timeout: 300_000 }, () => {
      const fx = load<Fixture>(file);
      const { ledger, steps, checkpoints, momentsChecked, garden } = replay(fx);
      const s = garden.state();
      console.info(
        `${fx.run.name} (${fx.run.plasticity}, Python ${fx.python.version} ${fx.python.platform}): ` +
          `${steps} steps, ${checkpoints} checkpoints, ${momentsChecked} moments, ` +
          `${s.journeys} journeys, ${ledger.compared} continuous comparisons ` +
          `(${ledger.identical} bit-identical), discrete mismatches ${ledger.discreteCount}, ` +
          `max deviation ${ledger.maxDeviation.toExponential(3)}${ledger.where ? ` at ${ledger.where}` : ""}, ` +
          `plasticity ${JSON.stringify(fx.summary.plasticity)}`,
      );
      expect(steps).toBe(fx.steps.length);
      expect(steps).toBeGreaterThanOrEqual(20000);
      expect(ledger.discrete).toEqual([]);
      expect(ledger.continuousOver).toEqual([]);
      expect(ledger.maxDeviation).toBeLessThanOrEqual(TOLERANCE);
      expect(checkpoints).toBe(fx.checkpoints.length);
    });
  }
});

// ------------------------------------------------------------------ seams

const DAY = Date.UTC(2026, 10, 7, 15, 0) / 1000; // 10:00 in Bethesda
const run = (g: EvaGarden, from: number, steps: number) => {
  for (let i = 1; i <= steps; i++) g.advance(from + 5 * i);
};

describe("research seams", () => {
  it("refuses an original and any id that is not a research id", () => {
    const base = { seed: "s", bornAt: DAY };
    expect(() => birth({ ...base, lifeId: EVA.id })).toThrow(OriginalRefused);
    expect(() => birth({ ...base, lifeId: `research-${EVA.id.slice(0, 8)}` })).toThrow(
      OriginalRefused,
    );
    expect(() => birth({ ...base, lifeId: "eva-copy" })).toThrow(OriginalRefused);
    expect(birth({ ...base, lifeId: "research-ok" }).lifeId).toBe("research-ok");
  });

  it("inert seams leave her byte for byte as without them", () => {
    const opts = {
      seed: "seam-test",
      bornAt: DAY,
      lifeId: "research-seams",
      plasticity: "active" as const,
    };
    const bare = birth(opts);
    let calls = 0;
    const inert = birth({
      ...opts,
      perceive: () => ({}),
      obstruct: (_start, end) => end,
      onStep: () => {
        calls++;
      },
    });
    run(bare, DAY, 3000);
    run(inert, DAY, 3000);
    expect(calls).toBe(3000);
    expect(JSON.stringify(inert.state())).toBe(JSON.stringify(bare.state()));
    expect(JSON.stringify(inert.plasticityMemory())).toBe(
      JSON.stringify(bare.plasticityMemory()),
    );
    expect(JSON.stringify(inert.snapshot())).toBe(JSON.stringify(bare.snapshot()));
  });

  it("an obstruction stops her where it says, and her learned gain sees the shortfall", () => {
    // A wall at x = 0.6 that she cannot cross from the right (she is born at the asters, x 0.68).
    const WALL = 0.6;
    const opts = { seed: "wall-test", bornAt: DAY, lifeId: "research-wall" };
    const free = birth(opts);
    let blocked: { tick: number; action: string } | null = null;
    const walled = birth({
      ...opts,
      obstruct: (start, end, action) => {
        if (start[0] >= WALL && end[0] < WALL) {
          blocked ??= { tick: walled?.ticks ?? 0, action };
          return [WALL, end[1]];
        }
        return end;
      },
    });
    let first: { tick: number; key: string; free: number; walled: number } | null = null;
    for (let i = 1; i <= 8000 && !first; i++) {
      free.advance(DAY + 5 * i);
      walled.advance(DAY + 5 * i);
      if (blocked && !first) {
        const a = free.state();
        const b = walled.state();
        const last = b.learning.last!;
        const key = `${last.action}/${last.condition}`;
        first = {
          tick: b.ticks,
          key,
          free: a.learning.models[key]!.gain,
          walled: b.learning.models[key]!.gain,
        };
      }
    }
    expect(first).not.toBeNull();
    const f = first!;
    // Identical until the wall bites; at that step her estimate drops below her free twin's.
    expect(f.walled).toBeLessThan(f.free);
    expect(walled.position[0]).toBeGreaterThanOrEqual(WALL);
    expect(walled.position[0]).not.toBe(free.position[0]);
    // Kept up, she never crosses it.
    for (let i = 8001; i <= 14000; i++) {
      walled.advance(DAY + 5 * i);
      expect(walled.position[0]).toBeGreaterThanOrEqual(0.03);
      expect(walled.position[0]).toBeGreaterThanOrEqual(WALL);
    }
  });

  it("a perceived thing is tracked by her own tracker and judged independent by her own rule", () => {
    const opts = { seed: "perceive-test", bornAt: DAY, lifeId: "research-perceive" };
    const bare = birth(opts);
    const seen = birth({
      ...opts,
      perceive: (now) => ({
        "still-thing-1": [0.5, 0.5],
        "moving-thing-0": [
          0.5 + 0.1 * Math.sin(now / 40),
          0.45 + 0.05 * Math.cos(now / 29),
        ],
      }),
    });
    run(bare, DAY, 400);
    run(seen, DAY, 400);
    const nearby = seen.snapshot().learning.nearby;
    expect(nearby.map((n) => n.name)).toEqual([
      "drifting_midge",
      "swaying_leaf",
      "moving-thing-0",
      "still-thing-1",
    ]);
    for (const n of nearby) {
      expect(n.samples).toBe(400);
      expect(n.independent).toBe(
        (n.samples ?? 0) >= 10 && (n.external_motion ?? 0) > 0.0003,
      );
    }
    expect(nearby.find((n) => n.name === "moving-thing-0")!.independent).toBe(true);
    expect(nearby.find((n) => n.name === "still-thing-1")!.independent).toBe(false);
    // Seeing more changes nothing she does: her state is the bare garden's but for the new tracks.
    const a = bare.state();
    const b = seen.state();
    delete b.learning.objects["moving-thing-0"];
    delete b.learning.objects["still-thing-1"];
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(() =>
      run(birth({ ...opts, perceive: () => ({ drifting_midge: [0.1, 0.1] }) }), DAY, 1),
    ).toThrow(/her own/);
  });
});
