/**
 * The research ecology: it lives on its own, deterministically; its books
 * close; its transport matches the exact solution it approximates; and a fly
 * changes it only through recorded interactions, which reproduce it exactly.
 */
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../lib/noise";
import { OriginalRefused } from "../firstContact/originals";
import { indexGraph, restoreGraph, snapshotGraph } from "../life/snapshot";
import { Atmosphere } from "./atmosphere";
import { Ecosystem, referenceYard, type EcosystemSpec } from "./ecosystem";
import { OdourField } from "./field";
import { cloneEcosystem, EcologicalLife, replay, spinUp } from "./life";
import { P } from "./params";

const DAY = 86_400;

/** A random but valid yard: trees, flowers and rocks placed by a seeded stream. */
function randomYard(seed: number): EcosystemSpec {
  const rng = mulberry32(seed);
  const at = () => -9 + 18 * rng();
  const rocks = [0, 1].map((k) => ({
    id: `rock-${k}`,
    x: at(),
    z: at(),
    half: 0.4 + rng(),
    height: 0.3,
  }));
  const clear = (x: number, z: number) =>
    rocks.every(
      (r) => Math.abs(x - r.x) > r.half + 0.6 || Math.abs(z - r.z) > r.half + 0.6,
    );
  const place = (prefix: string, n: number) => {
    const out = [];
    while (out.length < n) {
      const x = at(),
        z = at();
      if (clear(x, z)) out.push({ id: `${prefix}-${out.length}`, x, z });
    }
    return out;
  };
  return {
    seed,
    startHour: 24 * rng(),
    windHeading: 2 * Math.PI * rng(),
    half: 10,
    trees: place("tree", 3),
    flowers: place("flower", 5),
    rocks,
  };
}

function books(e: Ecosystem) {
  const s = e.sugar,
    o = e.odour.books,
    w = e.water;
  return {
    sugar: s.produced - (e.sugarStock() + s.consumed + s.fermented + s.rotted),
    sugarScale: Math.max(1, s.produced),
    odour: o.emitted + o.rounding - o.lost - o.out - e.odour.total(),
    odourScale: Math.max(1, o.emitted),
    water: w.rained + w.sprung - w.evaporated - w.drained - w.drunk - e.waterStock(),
    waterScale: Math.max(1, w.rained),
  };
}

describe("the atmosphere", () => {
  const a = new Atmosphere({ seed: 3, startHour: 0, windHeading: 0 });
  it("is a pure function of the time, within its ranges", () => {
    const ts = Array.from({ length: 200 }, (_, k) => k * 3_791.3);
    const forward = ts.map((t) => a.at(t));
    const backward = [...ts]
      .reverse()
      .map((t) => a.at(t))
      .reverse();
    expect(backward).toEqual(forward);
    expect(new Atmosphere({ seed: 3, startHour: 0, windHeading: 0 }).at(12_345)).toEqual(
      a.at(12_345),
    );
    for (const w of forward) {
      expect(w.light).toBeGreaterThanOrEqual(P("nightLight"));
      expect(w.light).toBeLessThanOrEqual(1 + 1e-12);
      expect(w.cloud).toBeGreaterThanOrEqual(0);
      expect(w.cloud).toBeLessThanOrEqual(1);
      expect(w.humidity).toBeGreaterThanOrEqual(0.1);
      expect(w.humidity).toBeLessThanOrEqual(1);
      expect(w.rainMmH).toBeGreaterThanOrEqual(0);
      expect(w.wind[1]).toBe(0);
    }
  });
  it("has days and nights", () => {
    const noon = a.at(12 * 3600),
      midnight = a.at(0);
    expect(noon.light).toBeGreaterThan(0.2);
    expect(midnight.light).toBe(P("nightLight"));
    expect(a.at(15 * 3600).tempC).toBeGreaterThan(a.at(3 * 3600).tempC);
  });
});

describe("odour transport", () => {
  const grid = { nx: 120, nz: 120, h: 0.25, x0: -15, z0: -15 };
  it(
    "carries a puff with the wind and spreads it as the exact solution does",
    { timeout: 60_000 },
    () => {
      const f = new OdourField(grid);
      const c0 = f.cellAt(-5.1, 0.1);
      f.mass[c0] = 1000;
      const u = 0.6,
        D = 0.05,
        T = 10;
      for (let k = 0; k < T; k++) f.step(1, u, 0, D, 0, null);
      let m = 0,
        mx = 0,
        mz = 0;
      for (let iz = 0; iz < grid.nz; iz++)
        for (let ix = 0; ix < grid.nx; ix++) {
          const w = f.mass[iz * grid.nx + ix]!;
          m += w;
          mx += w * (grid.x0 + (ix + 0.5) * grid.h);
          mz += w * (grid.z0 + (iz + 0.5) * grid.h);
        }
      mx /= m;
      mz /= m;
      let vx = 0,
        vz = 0;
      for (let iz = 0; iz < grid.nz; iz++)
        for (let ix = 0; ix < grid.nx; ix++) {
          const w = f.mass[iz * grid.nx + ix]!;
          vx += w * (grid.x0 + (ix + 0.5) * grid.h - mx) ** 2;
          vz += w * (grid.z0 + (iz + 0.5) * grid.h - mz) ** 2;
        }
      vx /= m;
      vz /= m;
      const start = grid.x0 + ((c0 % grid.nx) + 0.5) * grid.h;
      // The centroid moves at the wind's speed (first-order upwind moves it exactly).
      expect(mx - start).toBeCloseTo(u * T, 9);
      // Across the wind the spread is 2·D·t; along it the scheme adds |u|·h/2·(1 − Courant).
      const courant = (u * (1 / f.lastSubsteps)) / grid.h;
      const numerical = ((u * grid.h) / 2) * (1 - courant);
      expect(vz).toBeCloseTo(2 * D * T, 2);
      expect(vx).toBeCloseTo(2 * (D + numerical) * T, 1);
      expect(m).toBeCloseTo(1000, 9);
    },
  );

  it(
    "never enters an obstacle, never goes negative, and keeps its books",
    { timeout: 60_000 },
    () => {
      const blocked = new Uint8Array(grid.nx * grid.nz);
      for (let iz = 50; iz < 70; iz++)
        for (let ix = 70; ix < 74; ix++) blocked[iz * grid.nx + ix] = 1;
      const f = new OdourField(grid, blocked);
      const emit = new Float64Array(grid.nx * grid.nz);
      emit[f.cellAt(1, 0)] = 2;
      const rng = mulberry32(5);
      for (let k = 0; k < 150; k++) {
        f.step(1, 1.5 * (rng() - 0.3), 1.5 * (rng() - 0.5), 0.05, 1 / 300, emit);
        for (let i = 0; i < f.mass.length; i++) {
          expect(f.mass[i]).toBeGreaterThanOrEqual(0);
          if (blocked[i]) expect(f.mass[i]).toBe(0);
        }
      }
      const b = f.books;
      expect(Math.abs(b.emitted + b.rounding - b.lost - b.out - f.total())).toBeLessThan(
        1e-9 * b.emitted,
      );
      expect(() => {
        const bad = new Float64Array(grid.nx * grid.nz);
        bad[60 * grid.nx + 71] = 1;
        f.step(1, 0, 0, 0.05, 0, bad);
      }).toThrow(/inside an obstacle/);
    },
  );

  it("shadows the lee of an obstacle", { timeout: 60_000 }, () => {
    const blocked = new Uint8Array(grid.nx * grid.nz);
    for (let iz = 40; iz < 80; iz++)
      for (let ix = 64; ix < 66; ix++) blocked[iz * grid.nx + ix] = 1;
    const f = new OdourField(grid, blocked);
    const emit = new Float64Array(grid.nx * grid.nz);
    emit[f.cellAt(0, 0)] = 1;
    for (let k = 0; k < 120; k++) f.step(1, 0.5, 0, 0.05, 1 / 300, emit);
    // Downwind of the wall the air is cleaner than at the same distance beside it.
    expect(f.concentrationAt(2.5, 0)).toBeLessThan(0.2 * f.concentrationAt(2.5, 6));
  });
});

describe("the ecosystem on its own", () => {
  it(
    "evolves deterministically from its seed, without any fly",
    { timeout: 120_000 },
    () => {
      const a = new Ecosystem(referenceYard(42)),
        b = new Ecosystem(referenceYard(42)),
        c = new Ecosystem(referenceYard(43));
      a.run(DAY / 4);
      b.run(DAY / 4);
      c.run(DAY / 4);
      expect(a.stateHash()).toBe(b.stateHash());
      expect(c.stateHash()).not.toBe(a.stateHash());
      expect(a.fruits.length).toBeGreaterThan(0);
      expect(a.odour.total()).toBeGreaterThan(0);
    },
  );

  it(
    "keeps its sugar, water and odour books, and nothing goes negative (random yards)",
    { timeout: 180_000 },
    () => {
      for (const seed of [1, 2, 3]) {
        const e = new Ecosystem(randomYard(seed));
        for (let k = 0; k < 4; k++) {
          e.run(DAY / 16);
          const b = books(e);
          expect(Math.abs(b.sugar)).toBeLessThan(1e-10 * b.sugarScale);
          expect(Math.abs(b.odour)).toBeLessThan(1e-9 * b.odourScale);
          expect(Math.abs(b.water)).toBeLessThan(1e-10 * b.waterScale);
          for (const f of e.fruits) expect(f.sugarMg).toBeGreaterThan(0);
          for (const f of e.flowers) {
            expect(f.sugarMg).toBeGreaterThanOrEqual(0);
            expect(f.waterUl).toBeLessThanOrEqual(P("nectarMaxUl") + 1e-12);
          }
          for (const v of e.soil) expect(v).toBeGreaterThanOrEqual(0);
        }
      }
    },
  );

  it(
    "ripens, ferments and rots its fruit (and, books apart, needs no odour to)",
    { timeout: 120_000 },
    () => {
      // Fruit and soil never read the odour field, so this study of them leaves it off.
      const e = new Ecosystem(referenceYard(42), { transport: false });
      e.run(8 * DAY);
      const b = books(e);
      expect(Math.abs(b.sugar)).toBeLessThan(1e-10 * b.sugarScale);
      expect(e.history.gone).toBeGreaterThan(0);
      expect(e.sugar.fermented).toBeGreaterThan(0);
      expect(e.sugar.rotted).toBeGreaterThan(0);
      const ripe = e.fruits.filter((f) => f.ripeness >= 1);
      const fresh = e.fruits.filter((f) => f.ripeness < 0.5);
      expect(ripe.length).toBeGreaterThan(0);
      // Yeast grows only on ripe fruit.
      for (const f of fresh) expect(f.yeast).toBe(P("yeastStart"));
      for (const f of ripe) expect(f.yeast).toBeGreaterThan(P("yeastStart"));
    },
  );

  it(
    "restores from a whole-graph snapshot and lives on identically",
    { timeout: 120_000 },
    () => {
      const live = new Ecosystem(referenceYard(9));
      live.run(DAY / 8);
      const snap = JSON.parse(
        JSON.stringify(snapshotGraph(live, indexGraph(new Ecosystem(referenceYard(9))))),
      );
      const back = restoreGraph(snap, new Ecosystem(referenceYard(9)));
      expect(back.stateHash()).toBe(live.stateHash());
      live.run(3_600);
      back.run(3_600);
      expect(back.stateHash()).toBe(live.stateHash());
    },
  );
});

describe("a research fly in the ecosystem", () => {
  const genesis = {
    subject: "research-ecology-test",
    seed: 7,
    start: [0, 0] as [number, number],
    yaw: 0,
    startReserve: 0.3,
  };

  it("refuses the originals and anything but a research subject", () => {
    expect(
      () =>
        new EcologicalLife(referenceYard(42), {
          ...genesis,
          subject: "04f8c797b6971a46",
        }),
    ).toThrow(OriginalRefused);
    expect(
      () => new EcologicalLife(referenceYard(42), { ...genesis, subject: "eva" }),
    ).toThrow(/research-/);
  });

  it(
    "changes the world only through recorded interactions, which reproduce it exactly",
    { timeout: 240_000 },
    () => {
      const spec = referenceYard(42);
      // The world has lived six hours (its flowers hold nectar); a hungry fly is
      // placed beside a flower, and the same world goes on without it.
      const world = spinUp(spec, 6 * 3_600);
      const life = new EcologicalLife(
        spec,
        { ...genesis, start: [7.3, -1] },
        { kind: "deployed" },
        cloneEcosystem(world),
      );
      const bare = new EcologicalLife(
        spec,
        null,
        { kind: "deployed" },
        cloneEcosystem(world),
      );
      // Until the fly first feeds, the world beside it is the world without it, second for second.
      let first: number | null = null;
      for (let s = 0; s < 6_000; s++) {
        life.step(10);
        bare.step(10);
        if (life.eco.interactions.length) {
          first = life.eco.t;
          break;
        }
        expect(life.eco.stateHash()).toBe(bare.eco.stateHash());
      }
      expect(first).not.toBeNull();
      // Afterwards it differs, and only by what the records say.
      life.step(6_000);
      const steps = life.eco.steps;
      const again = replay(spec, life.eco.interactions, steps);
      expect(again.stateHash()).toBe(life.eco.stateHash());
      const none = replay(spec, [], steps);
      expect(none.stateHash()).not.toBe(life.eco.stateHash());
      expect(life.eco.sugar.consumed).toBeGreaterThan(0);
      expect(life.eco.sugar.unbacked).toBeLessThan(0.01 * life.eco.sugar.consumed + 1e-6);
      // The sugar the world gave is the energy the body took, but for what was unbacked.
      const fedMg = life.fly!.state.counts.fedJ / P("sugarJPerMg");
      expect(life.eco.sugar.consumed + life.eco.sugar.unbacked).toBeCloseTo(fedMg, 9);
    },
  );

  it(
    "a fly's yeast hastens a fruit's fermentation and its odour",
    { timeout: 240_000 },
    () => {
      const spec = referenceYard(42);
      const a = new Ecosystem(spec),
        b = new Ecosystem(spec);
      a.run(DAY);
      b.run(DAY);
      const f = a.fruits.find((x) => x.ripeness > 0.5)!;
      expect(f).toBeDefined();
      a.inoculate(f.id, 200, "research-ecology-test");
      a.run(6 * 3600);
      b.run(6 * 3600);
      const fa = a.fruits.find((x) => x.id === f.id)!,
        fb = b.fruits.find((x) => x.id === f.id)!;
      expect(fa.yeast).toBeGreaterThan(fb.yeast);
      expect(fa.sugarMg).toBeLessThan(fb.sugarMg);
      expect(a.sugar.fermented).toBeGreaterThan(b.sugar.fermented);
      expect(a.odour.books.emitted).toBeGreaterThan(b.odour.books.emitted);
    },
  );

  it("feeding empties a flower, which then offers nothing until it secretes again", () => {
    const e = new Ecosystem(referenceYard(42), { transport: false });
    e.run(DAY / 2);
    const fl = e.flowers[0]!;
    const held = fl.sugarMg;
    expect(held).toBeGreaterThan(P("nectarMinSugarMg"));
    const taken = e.consume(fl.id, held * 2, "research-ecology-test");
    expect(taken).toBe(held);
    expect(fl.sugarMg).toBe(0);
    expect(e.sugar.unbacked).toBeCloseTo(held, 12);
  });
});
