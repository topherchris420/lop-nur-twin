import { describe, expect, it } from "vitest";
import { OrganismAdapter } from "../organism.js";
import { ceilingLayout, SEARCH_ARMS } from "./ceiling.js";
import {
  noRangingMemory,
  Ranging,
  RANGING_PARAMS as P,
  RANGING_SETTINGS,
  RangingAdapter,
} from "./ranging.js";
import { YardSubject } from "./yard.js";

/** Give each way `n` blocks of about this return on a joule, a little apart. */
function teach(r: Ranging, returns: readonly [number, number], n = 10) {
  for (let i = 0; i < n; i++)
    for (const way of [0, 1]) {
      const spent = 0.2 + (i % 2) * 0.02;
      r.credit(way, spent * returns[way]! + (i % 2 ? 0.002 : -0.002), spent);
    }
}

function trajectory(
  adapter: ConstructorParameters<typeof YardSubject>[0]["adapter"],
  prepare?: (s: YardSubject) => void,
) {
  const sub = new YardSubject({ seed: 3, layout: ceilingLayout(3), adapter });
  prepare?.(sub);
  const out: number[] = [];
  for (let t = 0; t < 900; t += 30) {
    sub.step(300);
    out.push(sub.fly.state.p[0], sub.fly.state.p[2], sub.fly.state.reserve);
  }
  return out;
}

describe("ranging", () => {
  it("starts knowing nothing, and its first way is the fly's own", () => {
    const r = new Ranging(1);
    expect(r.state.blocks).toEqual([0, 0]);
    expect(r.clearance()).toBe(0);
    expect(r.best()).toBe(0);
    expect(RANGING_SETTINGS[0]).toEqual(SEARCH_ARMS.default);
    expect(r.setting).toEqual(SEARCH_ARMS.default);
  });

  it("favors whichever way repays its energy, and stays put when they tie", () => {
    const wide = new Ranging(1);
    teach(wide, [0.5, 1.0]);
    expect(wide.best()).toBe(1);

    const own = new Ranging(1);
    teach(own, [1.0, 0.5]);
    expect(own.best()).toBe(0);

    const tied = new Ranging(1);
    teach(tied, [0.8, 0.8]);
    expect(tied.best()).toBe(0);
  });

  it("judges by return per joule, not by what is left over", () => {
    const r = new Ranging(1);
    // The wider way ends each block further behind, and still repays each joule better.
    for (let i = 0; i < 12; i++) {
      r.credit(0, 0.1 + (i % 2) * 0.01, 0.2);
      r.credit(1, 0.45 + (i % 2) * 0.01, 0.6);
    }
    expect(r.average(1)!).toBeGreaterThan(r.average(0)!);
    expect(r.best()).toBe(1);
  });

  it("has no opinion before each way has had its blocks", () => {
    const r = new Ranging(1);
    for (let i = 0; i < P.minBlocks - 1; i++) {
      r.credit(0, 0.05, 0.2);
      r.credit(1, 0.4 + i * 0.01, 0.2);
    }
    expect(r.clearance()).toBe(0);
    r.credit(0, 0.06, 0.2);
    r.credit(1, 0.4, 0.2);
    expect(r.clearance()).toBeGreaterThan(P.clearBy);
  });

  it("can change its mind when later evidence runs the other way", () => {
    const r = new Ranging(1);
    teach(r, [0.5, 1.0], 20);
    expect(r.best()).toBe(1);
    teach(r, [1.0, 0.5], 80);
    expect(r.best()).toBe(0);
  });

  it("tallies a block's energy in and out from the body, then starts the next", () => {
    const r = new Ranging(1);
    r.observe(0, 1.0);
    const way = r.state.way;
    r.observe(10, 0.9); // spent 0.1
    r.observe(20, 1.2); // gained 0.3
    r.observe(P.blockS - 1, 1.1); // spent 0.1
    expect(r.state.blocks).toEqual([0, 0]);
    r.observe(P.blockS, 1.1);
    expect(r.state.blocks[way]).toBe(1);
    expect(r.state.gain[way]).toBeCloseTo(0.3, 9);
    expect(r.state.spent[way]).toBeCloseTo(0.2, 9);
    expect(r.average(way)).toBeCloseTo(1.5, 9);
    expect(r.state.blockGain).toBe(0);
    expect(r.state.blockSpent).toBe(0);
  });

  it("gives both ways their blocks, then still tries both", () => {
    const r = new Ranging(7);
    let t = 0;
    let energy = 10;
    const used = [0, 0];
    r.observe(t, energy);
    // The wider way repays better, so it settles there and still checks the fly's own.
    for (let i = 0; i < 200; i++) {
      used[r.state.way]!++;
      const spent = 0.2 + (i % 2) * 0.02;
      energy -= spent;
      r.observe(t + 1, energy);
      energy += spent * (r.state.way === 1 ? 1 : 0.5) + (i % 3 ? 0.004 : -0.008);
      t += P.blockS;
      r.observe(t, energy);
    }
    expect(used[1]).toBeGreaterThan(used[0]!);
    expect(used[0]).toBeGreaterThan(P.minBlocks);
    expect(r.best()).toBe(1);
  });

  it("does not learn while held, and acts at once on what it is given", () => {
    const r = new Ranging(1);
    teach(r, [0.5, 1.0]);
    const memory = r.memory();
    r.hold(noRangingMemory());
    expect(r.state.way).toBe(0);
    r.hold(memory);
    expect(r.state.way).toBe(1);
    r.observe(0, 0);
    r.observe(10, 3);
    r.observe(P.blockS, 1);
    expect(r.memory()).toEqual(memory);
    expect(r.state.way).toBe(1);
  });

  it("is the organism exactly while held with nothing learned", () => {
    const plain = trajectory((a, s, seed) => new OrganismAdapter(a, s, seed));
    const held = trajectory(
      (a, s, seed) => new RangingAdapter(a, s, seed),
      (sub) => (sub.organism as RangingAdapter).ranging.hold(noRangingMemory()),
    );
    expect(held).toEqual(plain);
  }, 120_000);

  it("counts maintenance as no gain of its own", () => {
    const sub = new YardSubject({
      seed: 3,
      layout: ceilingLayout(3),
      adapter: (a, s, seed) => new RangingAdapter(a, s, seed),
    });
    const adapter = sub.organism as RangingAdapter;
    const seen: number[] = [];
    const observe = adapter.ranging.observe.bind(adapter.ranging);
    adapter.ranging.observe = (t, energyJ) => {
      seen.push(energyJ);
      observe(t, energyJ);
    };
    sub.step(20);
    expect(seen.length).toBeGreaterThan(0);
    const before = seen[seen.length - 1]!;
    const count = seen.length;
    adapter.physiology.state.maintenanceJ += 0.5;
    // The fly decides less often than it ticks.
    sub.step(50);
    expect(seen.length).toBeGreaterThan(count);
    expect(seen[seen.length - 1]! - before).toBeLessThan(-0.4);
  }, 60_000);
});
