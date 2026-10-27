import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { birth, checkpointLife, restoreLife, twinCheckpoint } from "../continuity.js";
import { BETHESDA_LIFE, headlessGenesis } from "../headless.js";
import { LifeStore, LEASE_MS } from "../store.js";
import { MushroomBodyController } from "../../fly/mushroomBody/controller.js";
import {
  IMMORTAL_RESEARCH_LIFE as KIND,
  ImmortalLife,
  researchGenesis,
  HISTORY_LIMIT,
  OUTBOX_LIMIT,
} from "./life.js";
import { Physiology } from "./physiology.js";
import { checkpointResearch } from "./checkpoint.js";
import { proceduralChallenge } from "./challenges.js";

const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "echo-immortal-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const genesis = () => ({
  ...researchGenesis(),
  flags: { immortality: true, associativeLearning: true, predictiveSelfModel: true },
});
const newborn = (g = genesis()) => {
  const life = KIND.build(g);
  const first = checkpointLife(KIND, life, {
    genesis: g,
    birth: birth(KIND.id, g, randomBytes(16).toString("hex")),
    previous: null,
  });
  return { g, life, first };
};

describe("recoverable tissue physiology", () => {
  it("gradually recovers total depletion and accounts for external joules", () => {
    const p = new Physiology(true);
    Object.assign(p.state, { atp: 0, water: 0, fatigue: 1, stress: 1 });
    let reserve = 0;
    const initial = { ...p.state };
    reserve += p.advance(0.1, { mode: "rest", reserve, capacity: 1.41 });
    expect(p.state.protective).toBe(true);
    expect(reserve).toBeLessThan(0.001);
    expect(p.state.water).toBeLessThan(0.001);
    for (let k = 0; k < 6000; k++) {
      reserve = Math.max(0, reserve - 0.000025 * 0.1);
      reserve += p.advance(0.1, { mode: "rest", reserve, capacity: 1.41 });
    }
    expect(p.state.protective).toBe(false);
    expect(p.state.atp).toBeGreaterThan(0.7);
    expect(p.state.fatigue).toBeLessThan(initial.fatigue);
    expect(p.state.maintenanceJ).toBeGreaterThan(reserve);
    expect(p.state.recoveryBouts).toBe(1);
  });
  it("does not supply artificial energy when the flag is off", () => {
    const p = new Physiology(false);
    for (let i = 0; i < 1000; i++)
      expect(p.advance(1, { mode: "flight", reserve: 0, capacity: 1 })).toBe(0);
    expect(p.state.maintenanceJ).toBe(0);
    expect(p.state.protective).toBe(false);
  });
  it("couples activity to fatigue and rest to recovery", () => {
    const p = new Physiology(true);
    for (let i = 0; i < 500; i++)
      p.advance(1, { mode: "flight", reserve: 1, capacity: 1.41 });
    const active = p.state.fatigue;
    for (let i = 0; i < 500; i++)
      p.advance(1, { mode: "rest", reserve: 1, capacity: 1.41 });
    expect(active).toBeGreaterThan(0.1);
    expect(p.state.fatigue).toBeLessThan(active / 10);
  });
  it("fails on nonfinite state instead of fabricating a recovered organism", () => {
    const p = new Physiology(true);
    p.state.atp = NaN;
    expect(() => p.advance(0.1, { mode: "rest", reserve: 0, capacity: 1 })).toThrow(
      /no reset/,
    );
  });
});

describe("one research individual, whole-state recovery", () => {
  it("restores and steps body, ECHO, tissue, synapses and every RNG exactly", () => {
    const { g, life, first } = newborn();
    KIND.apply!(life, {
      tick: 0,
      kind: "food",
      data: { food: { site: "east", at: [0, 0] } },
    });
    life.advanceTicks(120);
    const saved = checkpointLife(KIND, life, {
      genesis: g,
      birth: first.birth,
      previous: first,
    });
    const restored = restoreLife(KIND, JSON.parse(JSON.stringify(saved)));
    expect(restored.inspect()).toEqual(life.inspect());
    for (const ticks of [1, 17, 53]) {
      life.advanceTicks(ticks);
      restored.advanceTicks(ticks);
      expect(KIND.hash(restored)).toBe(KIND.hash(life));
    }
    expect(saved.birth).toEqual(first.birth);
    const inner = life.adapter.inner;
    expect(inner).toBeInstanceOf(MushroomBodyController);
    if (inner instanceof MushroomBodyController)
      expect(inner.circuit.state.trials).toBeGreaterThan(0);
  });
  it("keeps a Bethesda research home and its city independent of the adapter", () => {
    const config = {
      seed: 42,
      pedestrians: 2,
      vehicles: 0,
      buses: 0,
      statisticalPopulation: 2,
    };
    const g = { ...genesis(), home: headlessGenesis(config, "echo") };
    const { life, first } = newborn(g);
    const plain = BETHESDA_LIFE.build(g.home);
    life.advanceTicks(10);
    plain.advanceTicks(10);
    expect(life.home?.city.stateHash()).toBe(plain.city.stateHash());
    const saved = checkpointLife(KIND, life, {
      genesis: g,
      birth: first.birth,
      previous: first,
    });
    const back = restoreLife(KIND, saved);
    life.advanceTicks(10);
    back.advanceTicks(10);
    expect(KIND.hash(back)).toBe(KIND.hash(life));
  }, 30_000);
  it("separates a new birth or research twin from continuation", () => {
    const { first } = newborn();
    const twin = twinCheckpoint(first, randomBytes(16).toString("hex"));
    expect(twin.birth.individual).not.toBe(first.birth.individual);
    expect(twin.birth.twinOf?.individual).toBe(first.birth.individual);
    expect(() => restoreLife(BETHESDA_LIFE, first as never)).toThrow();
  });
  it("recovers from process termination after the lease expires without replacing the fly", () => {
    const { life, first } = newborn();
    let clock = Date.now();
    const dir = temp();
    const store = LifeStore.create(dir, KIND, first, {
      now: () => clock,
      holder: "terminated",
    });
    life.advanceTicks(30);
    const committed = checkpointResearch(life, store, first);
    life.advanceTicks(10); // uncommitted ticks must not be fabricated on restore
    clock += LEASE_MS + 1;
    const next = LifeStore.open(dir, KIND, { now: () => clock, holder: "restarted" });
    next.acquire();
    const back = restoreLife(KIND, next.head());
    expect(back.tick).toBe(30);
    expect(next.head().birth.individual).toBe(first.birth.individual);
    expect(() => checkpointResearch(life, store, committed)).toThrow(/fenced/);
    expect(life.tick).toBe(40);
  });
  it("refuses corrupt checkpoints and ignores unfinished temporary files", () => {
    const { first } = newborn();
    const dir = temp();
    const store = LifeStore.create(dir, KIND, first);
    store.release();
    writeFileSync(join(dir, "checkpoints", "000000000001.json.interrupted.tmp"), "{");
    expect(LifeStore.open(dir, KIND).head().digest).toBe(first.digest);
    const path = join(dir, "checkpoints", "000000000000.json");
    const data = JSON.parse(readFileSync(path, "utf8"));
    data.checkpoint.stateHash = "changed";
    writeFileSync(path, JSON.stringify(data));
    expect(() => LifeStore.open(dir, KIND)).toThrow(/corrupt/);
  });
  it("bounds working history and archives events before dropping their payloads", () => {
    const { life, first } = newborn();
    const store = LifeStore.create(temp(), KIND, first, { keepGraphs: 1 });
    for (let i = 0; i < 120; i++) life.record("experience", { index: i });
    expect(life.recent.length).toBe(HISTORY_LIMIT);
    const saved = checkpointResearch(life, store, first);
    expect(life.outbox).toHaveLength(0);
    expect(store.events().filter((e) => e.kind === "experience")).toHaveLength(120);
    expect(saved.birth).toEqual(first.birth);
    for (let i = 0; i < OUTBOX_LIMIT; i++) life.record("experience", { index: i });
    expect(() => life.advanceTicks(1)).toThrow(/backpressure/);
    expect(life.outbox).toHaveLength(OUTBOX_LIMIT);
  });
  it("recovers depletion without changing its learned synapses or identity", () => {
    const { life, g, first } = newborn();
    const a = life.adapter;
    if (!(a.inner instanceof MushroomBodyController)) throw new Error("expected circuit");
    a.inner.circuit.trial("test-cue", 1, "meal");
    const prediction = a.inner.circuit.predict("test-cue");
    const weights = [...a.inner.circuit.state.wPlus];
    life.fly.state.reserve = 0;
    Object.assign(a.physiology.state, { atp: 0, water: 0, fatigue: 1, stress: 1 });
    life.advanceTicks(6000);
    expect(a.physiology.state.protective).toBe(false);
    expect(a.inner.circuit.state.wPlus).toEqual(weights);
    expect(a.inner.circuit.predict("test-cue")).toBe(prediction);
    const saved = checkpointLife(KIND, life, {
      genesis: g,
      birth: first.birth,
      previous: first,
    });
    expect(restoreLife(KIND, saved).inspect()).toEqual(life.inspect());
    expect(saved.birth.individual).toBe(first.birth.individual);
    expect(life.fly.state.counts.rejected).toBe(0);
  }, 30000);
  it("replays procedural interventions and sensory disturbances deterministically", () => {
    const g = {
      ...genesis(),
      perturbation: {
        schema: "fly-perturbation/v1" as const,
        episodes: [
          { id: "unseen", cause: "self" as const, from: 1, until: 3, speedGain: 0.5 },
        ],
      },
    };
    const a = new ImmortalLife(g),
      b = new ImmortalLife(g);
    const challenge = proceduralChallenge(92, "held-out");
    for (const life of [a, b]) {
      KIND.apply!(life, { tick: 0, kind: "challenge", data: { challenge } });
      life.advanceTicks(30);
    }
    expect(KIND.hash(a)).toBe(KIND.hash(b));
    const before = KIND.hash(a);
    a.inspect();
    a.inspect();
    expect(KIND.hash(a)).toBe(before);
    expect(a.fly.state.counts.rejected).toBe(0);
  });
  it("keeps development and evaluation domains distinct", () => {
    for (let s = 1; s < 100; s++) {
      expect(proceduralChallenge(s, "development").layout).toBeLessThan(4);
      expect(proceduralChallenge(s, "held-out").layout).toBeGreaterThanOrEqual(4);
      expect(proceduralChallenge(s, "development").light).toBeGreaterThan(0.5);
      expect(proceduralChallenge(s, "held-out").light).toBeLessThanOrEqual(0.5);
    }
  });
  it("crosses a century clock offset without age-triggered termination", () => {
    const { life } = newborn();
    const age = 100 * 365.25 * 86400;
    life.fly.state.t = age;
    life.advanceTicks(10);
    expect(life.fly.state.t - age).toBeCloseTo(1, 3);
    expect(life.tick).toBe(10);
  });
});
