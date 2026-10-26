import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mulberry32, seekStream, streamPosition } from "../../lib/noise";
import type { Mode } from "../fly/neural";
import type { Config } from "../simulation";
import {
  birth,
  checkpointErrors,
  checkpointLife,
  divergence,
  restoreLife,
  twinCheckpoint,
  type LifeCheckpoint,
} from "./continuity";
import { BETHESDA_LIFE, headlessGenesis, type HeadlessBethesdaLife } from "./headless";
import {
  GENESIS,
  live,
  trainingLife,
  YARD_LIFE,
  type YardGenesis,
  type YardLife,
} from "./individuality";
import { indexGraph, restoreGraph, snapshotGraph } from "./snapshot";
import { LEASE_MS, LifeStore } from "./store";

const NONCE = "0123456789abcdef0123456789abcdef";
const NONCE2 = "fedcba9876543210fedcba9876543210";

class Pair {
  left: Pair | null = null;
  constructor(public n: number) {}
}

describe("graph snapshots", () => {
  it("record and restore shared objects, cycles, collections, odd numbers and streams in place", () => {
    const build = () => {
      const shared = { k: 1 };
      const p = new Pair(2);
      p.left = p;
      return {
        a: shared,
        b: shared,
        p,
        m: new Map<string, unknown>([["x", shared]]),
        s: new Set([1, 2]),
        f: new Float64Array([1, NaN, -0]),
        odd: [-0, NaN, Infinity, -Infinity, undefined, null],
        frozen: Object.freeze({ z: 1 }),
        rng: mulberry32(9),
        list: [] as Pair[],
      };
    };
    const live = build();
    for (let k = 0; k < 5; k++) live.rng();
    live.a.k = 7;
    live.list.push(new Pair(3), live.p);
    live.m.set("y", live.p);
    const snap = JSON.parse(JSON.stringify(snapshotGraph(live, indexGraph(build()))));
    const fresh = build();
    const keptRng = fresh.rng;
    const back = restoreGraph(snap, fresh);
    expect(back).toBe(fresh);
    // Identity is kept: the fresh stream, refilled; aliases still aliases; the cycle still a cycle.
    expect(back.rng).toBe(keptRng);
    expect(back.rng()).toBe(live.rng());
    expect(back.a).toBe(back.b);
    expect(back.m.get("x")).toBe(back.a);
    expect(back.p.left).toBe(back.p);
    expect(back.list[1]).toBe(back.p);
    expect(back.list[0]).toBeInstanceOf(Pair);
    expect(back.m.get("y")).toBe(back.p);
    expect(back.a.k).toBe(7);
    expect(Object.is(back.odd[0], -0)).toBe(true);
    expect(back.odd.slice(1)).toEqual([NaN, Infinity, -Infinity, undefined, null]);
    expect(Object.is(back.f[2], -0) && Number.isNaN(back.f[1])).toBe(true);
    expect(Object.isFrozen(back.frozen)).toBe(true);
    expect(JSON.stringify(snapshotGraph(back, indexGraph(build())))).toBe(
      JSON.stringify(snapshotGraph(live, indexGraph(build()))),
    );
  });

  it("refuses what it cannot hold, saying where", () => {
    expect(() => snapshotGraph({ a: { b: Symbol("x") } })).toThrow(/\.a\.b is a symbol/);
    expect(() => snapshotGraph({ d: new Date(0) })).toThrow(/\.d is a Date/);
    const sparse = [1, 2, 3];
    delete sparse[1];
    expect(() => snapshotGraph({ sparse })).toThrow(/not a dense array/);
    const accessor = {};
    Object.defineProperty(accessor, "x", { get: () => 1, enumerable: true });
    expect(() => snapshotGraph({ accessor })).toThrow(/accessor/);
    // A function the fresh graph does not hold where the snapshot had one cannot be restored.
    const snap = snapshotGraph({ f: () => 1 });
    expect(() => restoreGraph(snap, {})).toThrow(/no function/);
  });

  it("reads and sets a stream's position without drawing", () => {
    const a = mulberry32(42),
      b = mulberry32(42);
    for (let k = 0; k < 10; k++) a();
    const at = streamPosition(a)!;
    for (let k = 0; k < 10; k++) b();
    expect(streamPosition(b)).toBe(at);
    const c = mulberry32(1);
    seekStream(c, at);
    expect([c(), c()]).toEqual([a(), a()]);
    expect(streamPosition(() => 0)).toBeNull();
    expect(() => seekStream(() => 0, 1)).toThrow();
  });
});

describe("a fly's life restored", () => {
  const born = (genesis = GENESIS) => birth(YARD_LIFE.id, genesis, NONCE);
  const fed = (): {
    life: YardLife;
    journal: ReturnType<typeof trainingLife>["journal"];
  } => {
    const { journal } = trainingLife("east", 11);
    return { life: YARD_LIFE.build(structuredClone(GENESIS)), journal };
  };

  it("continues exactly from checkpoints taken in flight, landing, grooming and feeding", () => {
    const { life, journal } = fed();
    const want: Mode[] = ["flight", "land", "groom", "feed"];
    const caught = new Set<Mode>();
    let checked = 0;
    while (caught.size < want.length && life.tick < 20_000) {
      live(life, journal, life.tick + 1);
      const mode = life.fly.state.mode;
      if (!want.includes(mode) || caught.has(mode)) continue;
      caught.add(mode);
      const c = checkpointLife(YARD_LIFE, life, {
        genesis: GENESIS,
        birth: born(),
        previous: null,
      });
      const restored = restoreLife(YARD_LIFE, JSON.parse(JSON.stringify(c)) as typeof c);
      // A copy that diverges is caught at the first interval it differs.
      const original = YARD_LIFE.build(structuredClone(GENESIS));
      restoreGraph(c.graph!, original);
      expect(divergence(YARD_LIFE, original, restored, [1, 7, 50, 400, 1500])).toBeNull();
      expect(JSON.stringify(snapshotGraph(restored))).toBe(
        JSON.stringify(snapshotGraph(original)),
      );
      checked++;
    }
    expect([...caught].sort()).toEqual([...want].sort());
    expect(checked).toBe(4);
  }, 60_000);

  it("is a different individual for every birth, and a twin is never the same fly", () => {
    const a = born(),
      b = birth(YARD_LIFE.id, GENESIS, NONCE2);
    expect(a.individual).not.toBe(b.individual);
    const other: YardGenesis = { ...GENESIS, seed: GENESIS.seed + 1 };
    expect(birth(YARD_LIFE.id, other, NONCE).individual).not.toBe(a.individual);
    const { life } = fed();
    life.step(500);
    const c = checkpointLife(YARD_LIFE, life, {
      genesis: GENESIS,
      birth: a,
      previous: null,
    });
    const twin = twinCheckpoint(c, NONCE2);
    expect(twin.birth.individual).not.toBe(a.individual);
    expect(twin.birth.twinOf).toEqual({
      individual: a.individual,
      sequence: 0,
      digest: c.digest,
    });
    expect(checkpointErrors(YARD_LIFE, twin)).toEqual([]);
    // The same state, so the same fly's body and mind: a twin, which only starts identical.
    expect(YARD_LIFE.hash(restoreLife(YARD_LIFE, twin))).toBe(c.stateHash);
  });

  it("refuses a changed byte, version, genesis, kind or a forged individual", () => {
    const { life } = fed();
    life.step(300);
    const c = checkpointLife(YARD_LIFE, life, {
      genesis: GENESIS,
      birth: born(),
      previous: null,
    });
    const tamper = (f: (c: LifeCheckpoint<YardGenesis>) => void) => {
      const t = structuredClone(c);
      f(t);
      return () => restoreLife(YARD_LIFE, t);
    };
    expect(tamper((t) => t.graph!.nodes.push({ t: "fn" }))).toThrow(/a byte was changed/);
    expect(tamper((t) => (t.tick += 1))).toThrow(/seal/);
    expect(tamper((t) => (t.versions.fly = "digital-fly/0"))).toThrow(/digital-fly\/0/);
    expect(tamper((t) => (t.genesis.seed = 1))).toThrow(/genesis was changed/);
    expect(tamper((t) => (t.kind = "another"))).toThrow(/not a fly-yard-life/);
    expect(tamper((t) => (t.birth.individual = "a".repeat(64)))).toThrow(
      /does not follow/,
    );
    expect(tamper((t) => (t.graph = null))).toThrow(/compacted/);
    expect(() =>
      checkpointLife(YARD_LIFE, life, {
        genesis: { ...GENESIS, seed: 5 },
        birth: born(),
        previous: null,
      }),
    ).toThrow(/does not belong/);
  });
});

const TEST_CITY: Config = {
  seed: 393977,
  pedestrians: 12,
  vehicles: 2,
  buses: 1,
  statisticalPopulation: 30,
};

describe("the city and its fly restored", () => {
  for (const controller of ["reduced-order", "echo"] as const)
    it(`continues byte for byte with the ${controller} controller, the city untouched`, () => {
      const genesis = headlessGenesis(TEST_CITY, controller);
      const b = birth(BETHESDA_LIFE.id, genesis, NONCE);
      const life: HeadlessBethesdaLife = BETHESDA_LIFE.build(structuredClone(genesis));
      BETHESDA_LIFE.step(life, 400);
      const c = checkpointLife(BETHESDA_LIFE, life, {
        genesis,
        birth: b,
        previous: null,
      });
      const restored = restoreLife(
        BETHESDA_LIFE,
        JSON.parse(JSON.stringify(c)) as typeof c,
      );
      expect(divergence(BETHESDA_LIFE, life, restored, [1, 10, 100, 500])).toBeNull();
      expect(restored.status()).toEqual(life.status());
    }, 120_000);
});

describe("the store", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const fresh = () => {
    const d = mkdtempSync(join(tmpdir(), "life-store-"));
    dirs.push(d);
    return join(d, "fly");
  };
  const first = () => {
    const life = YARD_LIFE.build(structuredClone(GENESIS));
    const b = birth(YARD_LIFE.id, GENESIS, NONCE);
    return {
      life,
      b,
      c: checkpointLife(YARD_LIFE, life, { genesis: GENESIS, birth: b, previous: null }),
    };
  };

  it("keeps a verified chain, refuses forks, fences a replaced writer and compacts old graphs", () => {
    let now = 1_000_000;
    const clock = () => now;
    const dir = fresh();
    const { life, b, c } = first();
    const store = LifeStore.create(dir, YARD_LIFE, c, {
      now: clock,
      holder: "a",
      keepGraphs: 2,
    });
    let prev = c;
    for (let k = 0; k < 4; k++) {
      life.step(50);
      const next = checkpointLife(YARD_LIFE, life, {
        genesis: GENESIS,
        birth: b,
        previous: prev,
        events: [{ tick: life.tick, kind: "note", data: { k } }],
      });
      store.commit(next);
      prev = next;
    }
    expect(store.verify()).toEqual({ checkpoints: 5, head: 4, events: 4 });
    expect(store.events().map((e) => e.data.k)).toEqual([0, 1, 2, 3]);
    // Only the newest two keep their graphs; the chain still verifies.
    const graphs = [0, 1, 2, 3, 4].map(
      (s) =>
        JSON.parse(
          readFileSync(
            join(dir, "checkpoints", `${String(s).padStart(12, "0")}.json`),
            "utf8",
          ),
        ).checkpoint.graph === null,
    );
    expect(graphs).toEqual([true, true, true, false, false]);

    // A second continuation of the same parent is a fork: refused.
    life.step(10);
    const fork = checkpointLife(YARD_LIFE, life, {
      genesis: GENESIS,
      birth: b,
      previous: store.head(),
    });
    store.commit(fork);
    const other = YARD_LIFE.build(structuredClone(GENESIS));
    const fork2 = checkpointLife(YARD_LIFE, other, {
      genesis: GENESIS,
      birth: b,
      previous: prev,
    });
    expect(() => store.commit(fork2)).toThrow(/fork/);

    // Another writer waits while the lease holds, takes it once it lapses, and fences the first.
    const second = LifeStore.open(dir, YARD_LIFE, { now: clock, holder: "b" });
    expect(() => second.acquire()).toThrow(/held by a/);
    now += LEASE_MS + 1;
    expect(second.acquire()).toBe(2);
    life.step(10);
    const late = checkpointLife(YARD_LIFE, life, {
      genesis: GENESIS,
      birth: b,
      previous: fork,
    });
    expect(() => store.commit(late)).toThrow(/fenced/);
    second.commit(late);
    expect(restoreLife(YARD_LIFE, second.head()).tick).toBe(life.tick);

    // A twin is someone else: its checkpoints do not go into this store.
    const twin = twinCheckpoint(second.head(), NONCE2);
    const twinLife = restoreLife(YARD_LIFE, twin);
    twinLife.step(1);
    expect(() =>
      second.commit(
        checkpointLife(YARD_LIFE, twinLife, {
          genesis: GENESIS,
          birth: twin.birth,
          previous: twin,
        }),
      ),
    ).toThrow(/another individual/);
  }, 60_000);

  it("stops on corruption instead of starting someone new", () => {
    const dir = fresh();
    const { c } = first();
    LifeStore.create(dir, YARD_LIFE, c).release();
    const path = join(dir, "checkpoints", `${"0".repeat(12)}.json`);
    const text = readFileSync(path, "utf8");
    writeFileSync(path, text.replace(/"tick":0/, '"tick":1'));
    expect(() => LifeStore.open(dir, YARD_LIFE)).toThrow(/corrupt/);
    writeFileSync(path, text);
    expect(LifeStore.open(dir, YARD_LIFE).verify().checkpoints).toBe(1);
    // A store holds one individual, from its birth.
    expect(() => LifeStore.create(dir, YARD_LIFE, c)).toThrow(/not empty/);
  });
});
