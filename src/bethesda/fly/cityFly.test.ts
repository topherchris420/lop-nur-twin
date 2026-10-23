import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../lib/noise";
import { STREET_LAMP, streetLamps, streetTrees } from "../furniture";
import { CitySimulation } from "../simulation";
import { parseScenario } from "../scenarios";
import { groundAt } from "../terrain";
import { buildingAt } from "../model";
import { PARAMS } from "./params";
import { CityFly } from "./cityFly";
import type { V3 } from "./units";
import {
  rayBox,
  rayCylinder,
  raySphere,
  type Hit,
  type PrimitiveWorldSpec,
} from "./world";

const config = {
  seed: 393977,
  pedestrians: 30,
  vehicles: 10,
  buses: 2,
  statisticalPopulation: 120,
};
const storm = "A thunderstorm suddenly rolls through downtown Bethesda.";

describe("the fly in Bethesda", () => {
  it("never changes the city: the same state hash with and without it", () => {
    const plain = new CitySimulation(config),
      host = new CitySimulation(config);
    const fly = new CityFly(host);
    for (const s of [plain, host]) s.inject(parseScenario(storm)!);
    for (let k = 0; k < 900; k++) {
      plain.step();
      host.step();
      fly.tick();
    }
    expect(fly.failed).toBeNull();
    expect(fly.fly.state.t).toBeCloseTo(90, 6);
    expect(host.stateHash()).toBe(plain.stateHash());
  }, 60_000);
  it("starts on a mapped bench or table, stays near it and out of solids", () => {
    const sim = new CitySimulation(config);
    const city = new CityFly(sim);
    expect(["bench", "table"]).toContain(city.fly.state.perch?.kind);
    const home = city.world.home;
    let maxRange = 0;
    for (let k = 0; k < 3000; k++) {
      sim.step();
      city.tick();
      const p = city.fly.state.p;
      expect(p.every(Number.isFinite)).toBe(true);
      expect(city.world.solid(p)).toBe(false);
      maxRange = Math.max(
        maxRange,
        Math.hypot(p[0] - home.center[0], p[2] - home.center[2]),
      );
    }
    expect(city.failed).toBeNull();
    expect(maxRange).toBeLessThan(PARAMS.homeRadiusM.value + 6);
    expect(city.fly.state.counts.rejected).toBe(0);
  }, 60_000);
  it("can touch the street trees, lamps and benches the city draws near it", () => {
    const city = new CityFly(new CitySimulation(config));
    const home = city.world.home.center;
    const near = (p: { x: number; z: number }) =>
      Math.hypot(p.x - home[0], p.z - home[2]) < PARAMS.homeRadiusM.value;
    let checked = 0;
    for (const t of streetTrees().filter((t) => near(t.point))) {
      const g = groundAt(t.point);
      expect(city.world.solid([t.point.x, g + t.trunkHeight / 2, t.point.z])).toBe(true);
      for (const c of t.crowns)
        expect(city.world.solid([c.x, groundAt(c) + c.y, c.z])).toBe(true);
      checked++;
    }
    for (const l of streetLamps().filter((l) => near(l.point))) {
      const g = groundAt(l.point);
      expect(city.world.solid([l.point.x, g + 2, l.point.z])).toBe(true);
      expect(city.world.solid([l.point.x, g + STREET_LAMP.globeY, l.point.z])).toBe(true);
      if (l.bench) {
        const q = l.bench.point;
        expect(city.world.perchAt(q.x, q.z, groundAt(q) + 1)?.kind).toBe("bench");
      }
      checked++;
    }
    // The home bench near Bethesda Row has drawn street items within its range.
    expect(checked).toBeGreaterThan(0);
  });
  it("finds the same nearest surface a check of every primitive finds", () => {
    const city = new CityFly(new CitySimulation(config));
    const world = city.world;
    const spec = (world as unknown as { spec: PrimitiveWorldSpec }).spec;
    const home = world.home.center;
    const rng = mulberry32(7);
    let primitiveHits = 0;
    for (let k = 0; k < 4000; k++) {
      // Several rays per origin, as the senses cast them, with every reach tier.
      const o: V3 = [
        home[0] + (rng() - 0.5) * 30,
        home[1] + rng() * 6,
        home[2] + (rng() - 0.5) * 30,
      ];
      for (let j = 0; j < 4; j++) {
        const u = rng() * 2 - 1,
          a = rng() * 2 * Math.PI,
          s = Math.sqrt(1 - u * u);
        const d: V3 = [s * Math.cos(a), u, s * Math.sin(a)];
        const maxT = [0.05, 0.4, 3, 12, 40][j % 5]! * (0.5 + rng());
        const hit = world.raycast(o, d, maxT);
        let brute: Hit | null = null;
        const take = (h: Hit | null) => {
          if (h && (!brute || h.t < brute.t)) brute = h;
        };
        for (const b of spec.boxes ?? []) take(rayBox(o, d, b, maxT));
        for (const c of spec.cylinders ?? []) take(rayCylinder(o, d, c, maxT));
        for (const sp of spec.spheres ?? []) take(raySphere(o, d, sp, maxT));
        const found = brute as Hit | null;
        if (!found) continue;
        primitiveHits++;
        // Nothing nearer is missed; a primitive hit is the same one.
        expect(hit).not.toBeNull();
        expect(hit!.t).toBeLessThanOrEqual(found.t);
        if (hit!.t === found.t) expect(hit!.id).toBe(found.id);
      }
    }
    expect(primitiveHits).toBeGreaterThan(100);
  }, 60_000);
  it("escapes a visitor who walks straight at it, and not one who stands nearby", () => {
    // Settle the fly on its perch, then pick an approach line clear of buildings.
    const setUp = () => {
      const sim = new CitySimulation(config);
      const city = new CityFly(sim);
      for (let k = 0; k < 40; k++) {
        sim.step();
        city.tick();
      }
      return { sim, city };
    };
    const probe = setUp();
    expect(probe.city.fly.state.perch).not.toBeNull();
    const [fx, , fz] = probe.city.fly.state.p;
    const clear = (a: number) =>
      [...Array(13).keys()].every(
        (k) =>
          !buildingAt({
            x: fx + Math.cos(a) * (6 - k * 0.5),
            z: fz + Math.sin(a) * (6 - k * 0.5),
          }),
      );
    const angle = [...Array(8).keys()].map((k) => (k * Math.PI) / 4).find(clear);
    expect(angle).toBeDefined();
    const a = angle!;

    // Standing 3 m away for 20 s: a person who does not loom is no threat.
    const still = setUp();
    still.sim.player = { x: fx + Math.cos(a) * 3, z: fz + Math.sin(a) * 3 };
    for (let k = 0; k < 200; k++) {
      still.sim.step();
      still.city.tick();
    }
    expect(still.city.fly.state.counts.escapes).toBe(0);

    // Walking straight at it at 1.4 m/s from 6 m: it leaves before contact, and
    // the reason is the looming pathway, not the visitor's identity.
    const walk = setUp();
    walk.sim.player = { x: fx + Math.cos(a) * 6, z: fz + Math.sin(a) * 6 };
    let leftAt = -1;
    for (let k = 0; k < 80 && leftAt < 0; k++) {
      const p = walk.sim.player;
      const d = Math.hypot(fx - p.x, fz - p.z);
      if (d > 0.01)
        walk.sim.movePlayer(
          ((fx - p.x) / d) * Math.min(0.14, d),
          ((fz - p.z) / d) * Math.min(0.14, d),
        );
      walk.sim.step();
      walk.city.tick();
      if (walk.city.fly.state.counts.escapes > 0) leftAt = d;
    }
    expect(leftAt).toBeGreaterThan(0.1);
    expect(
      walk.city.fly.log.some((r) => /looming player.*giant-fiber proxy/.test(r.reason)),
    ).toBe(true);
  }, 60_000);
  it("is the same fly for the same city", () => {
    const a = new CityFly(new CitySimulation(config)),
      b = new CityFly(new CitySimulation(config));
    expect(a.seed).toBe(b.seed);
    expect(a.placedOn).toBe(b.placedOn);
    expect(a.fly.stateHash()).toBe(b.fly.stateHash());
  });
  it("advances only on ticks the city takes, so pausing the city pauses it", () => {
    const sim = new CitySimulation(config);
    const city = new CityFly(sim);
    sim.paused = true;
    sim.step();
    city.tick();
    expect(city.fly.state.t).toBe(0);
  });
});
