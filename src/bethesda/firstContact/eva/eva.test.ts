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
  EvaGarden,
  seasonalWeather,
  weatherName,
  type EvaState,
} from "./garden.js";
import type { Point, Weather } from "./learning.js";
import { newYork } from "./newYork.js";
import { pyDist, pyHypot, pyRound, pyRoundInt } from "./pyMath.js";
import { replay, TOLERANCE, type Fixture } from "./parity.js";
import { sidecarMemory } from "./plasticity.js";
import { PyRandom } from "./pyRandom.js";
import { sha512 } from "./sha512.js";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const load = <T>(name: string): T =>
  JSON.parse(gunzipSync(readFileSync(new URL(name, FIXTURES))).toString("utf8")) as T;

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

// A copy of a life (Stage 4's twins): her database row and sidecar file as
// stored, restored by the port itself and lived on, against her service doing
// the same (`eva-parity.py copies`: research gardens, never Eva).
const copyFiles = readdirSync(FIXTURES)
  .filter((f) => f.startsWith("copy-") && f.endsWith(".json.gz"))
  .sort();
const stored = (fx: Fixture) => fx.run.from_copy!;
const sidecarOf = (fx: Fixture) => stored(fx).stored_sidecar as Record<string, unknown>;

describe("a copy of a life, restored as stored and lived on", () => {
  it("covers active and shadow copies made mid-learning, with their sidecar files", () => {
    const fxs = copyFiles.map((f) => load<Fixture>(f));
    expect(new Set(fxs.map((fx) => fx.run.plasticity))).toEqual(
      new Set(["shadow", "active"]),
    );
    for (const fx of fxs) {
      const c = stored(fx);
      expect(fx.run.life_id.startsWith("research-")).toBe(true);
      expect(c.stored_state.life_id).toBe(fx.run.life_id);
      expect(c.start_tick).toBeGreaterThan(0);
      expect(c.kept_moments.length).toBeGreaterThan(0);
      // Her sidecar as a file: its daily copies' bookkeeping, a tick a little behind hers.
      expect(Object.keys(sidecarOf(fx).snapshots as object).length).toBeGreaterThan(0);
      expect(sidecarOf(fx).last_tick as number).toBeLessThanOrEqual(c.start_tick);
    }
    // The restored memory goes on deciding: swaps (or counted swaps) after the copy.
    const after = (fx: Fixture, key: "overrides" | "would_override") =>
      (fx.summary.plasticity?.[key] ?? 0) - (sidecarOf(fx)[key] as number);
    expect(fxs.some((fx) => after(fx, "overrides") > 0)).toBe(true);
    expect(fxs.some((fx) => after(fx, "would_override") > 0)).toBe(true);
  });

  for (const file of copyFiles) {
    it(`replays ${file} from its stored row and sidecar`, { timeout: 300_000 }, () => {
      const fx = load<Fixture>(file);
      const { ledger, steps, checkpoints, momentsChecked } = replay(fx);
      console.info(
        `${fx.run.name} (${fx.run.plasticity}, Python ${fx.python.version}): from tick ` +
          `${stored(fx).start_tick}, ${steps} steps, ${checkpoints} checkpoints, ` +
          `${momentsChecked} moments, discrete mismatches ${ledger.discreteCount}, ` +
          `max deviation ${ledger.maxDeviation.toExponential(3)}`,
      );
      expect(steps).toBe(fx.run.ticks);
      expect(steps).toBe(fx.steps.length);
      expect(ledger.discrete).toEqual([]);
      expect(ledger.continuousOver).toEqual([]);
      expect(ledger.maxDeviation).toBeLessThanOrEqual(TOLERANCE);
      expect(checkpoints).toBe(fx.checkpoints.length);
    });
  }

  it("notices a changed byte of the stored row or sidecar at the restore itself", () => {
    const base = load<Fixture>(copyFiles[0]!);
    const tick = stored(base).start_tick;
    const changed = (edit: (fx: Fixture) => void) => {
      const fx = structuredClone(base);
      fx.run.ticks = 1;
      edit(fx);
      return replay(fx).ledger;
    };
    const moved = changed((fx) => {
      stored(fx).stored_state.position[0] += 1e-6;
    });
    expect(moved.continuousOver.some((m) => m.startsWith(`tick ${tick} x`))).toBe(true);
    const key = Object.keys(sidecarOf(base).stats as object)[0]!;
    const believed = changed((fx) => {
      (sidecarOf(fx).stats as Record<string, { mean: number }>)[key]!.mean += 1e-6;
    });
    expect(
      believed.continuousOver.some((m) => m.startsWith(`tick ${tick} pm:${key}`)),
    ).toBe(true);
    const counted = changed((fx) => {
      (sidecarOf(fx) as { samples: number }).samples += 1;
    });
    expect(counted.discrete.some((m) => m.startsWith(`tick ${tick} p:`))).toBe(true);
    expect(changed(() => {}).discreteCount).toBe(0);
  });

  it("refuses what her extension refuses, and keeps everything but the file bookkeeping", () => {
    const fx = load<Fixture>(copyFiles[0]!);
    const c = stored(fx);
    const file = sidecarOf(fx);
    const memory = sidecarMemory(file);
    const { snapshots: _files, ...rest } = file;
    expect(memory).toEqual(rest);
    const restore = (state: EvaState, m = memory) =>
      EvaGarden.restore(state, { plasticity: fx.run.plasticity, memory: m });
    expect(restore(c.stored_state).ticks).toBe(c.start_tick);
    expect(() =>
      restore(c.stored_state, { ...memory, last_tick: c.start_tick + 1 }),
    ).toThrow(
      `the sidecar has learned up to tick ${c.start_tick + 1}, past her tick ${c.start_tick}`,
    );
    expect(() =>
      restore(c.stored_state, { ...memory, born_at: memory.born_at + 1 }),
    ).toThrow("the plasticity memory belongs to a different life");
    expect(() => restore({ ...c.stored_state, life_id: EVA.id })).toThrow(
      OriginalRefused,
    );
    const bad = (patch: Record<string, unknown>) => () =>
      sidecarMemory({ ...file, ...patch });
    expect(bad({ schema: "x" })).toThrow("not an eva-embodied-plasticity/v1 sidecar");
    expect(bad({ life_id: "" })).toThrow("sidecar has no life ID");
    expect(bad({ last_tick: 1.5 })).toThrow("sidecar tick is not a count");
    expect(bad({ mode: "off" })).toThrow("sidecar mode is unknown");
    expect(bad({ stats: { "swim/x": { n: 1, mean: 0, m2: 0 } } })).toThrow(
      "sidecar estimate 'swim/x' is not motion/condition",
    );
    expect(bad({ stats: { "fly/x": { n: 2001, mean: 0, m2: 0 } } })).toThrow(
      "sidecar estimate 'fly/x' is out of bounds",
    );
    expect(bad({ samples: -1 })).toThrow("sidecar samples is not a count");
    expect(bad({ recent: null })).toThrow("sidecar history is malformed");
  });
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
