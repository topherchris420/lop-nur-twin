import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../lib/noise";
import {
  awnings,
  rooftopUnit,
  STREET_BENCH,
  STREET_LAMP,
  streetLamps,
  streetTrees,
} from "../furniture";
import { CitySimulation, DT } from "../simulation";
import { parseScenario } from "../scenarios";
import { groundAt } from "../terrain";
import { buildingAt, buildings, inside } from "../model";
import { PARAMS } from "./params";
import { BethesdaFlyWorld } from "./bethesdaWorld";
import { CityFly } from "./cityFly";
import type { V3 } from "./units";
import {
  rayBox,
  rayCylinder,
  raySphere,
  type Hit,
  type Mover,
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
        // The seat's slats are solid and the gaps between them open, as drawn:
        // the bench's point falls between the first two slats.
        const q = l.bench.point;
        const across = (d: number) => ({
          x: q.x + Math.cos(l.angle) * d,
          z: q.z - Math.sin(l.angle) * d,
        });
        const slat = across(0.5 * STREET_BENCH.slatPitch);
        expect(city.world.perchAt(slat.x, slat.z, groundAt(q) + 1)?.kind).toBe("bench");
        expect(city.world.perchAt(q.x, q.z, groundAt(q) + 1)?.kind).not.toBe("bench");
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
    // And from origins a few centimetres apart, as a flying fly casts them, so
    // the lists made for one origin serve the next.
    const o: V3 = [home[0], home[1] + 1, home[2]];
    let drifted = 0;
    for (let k = 0; k < 3000; k++) {
      o[0] += (rng() - 0.5) * 0.1;
      o[1] = Math.min(home[1] + 6, Math.max(home[1] + 0.2, o[1] + (rng() - 0.5) * 0.1));
      o[2] += (rng() - 0.5) * 0.1;
      const u = rng() * 2 - 1,
        a = rng() * 2 * Math.PI,
        s = Math.sqrt(1 - u * u);
      const d: V3 = [s * Math.cos(a), u, s * Math.sin(a)];
      const maxT = [0.05, 0.4, 3, 12][k % 4]! * (0.5 + rng());
      const hit = world.raycast([...o] as V3, d, maxT);
      let brute: Hit | null = null;
      for (const h of [
        ...(spec.boxes ?? []).map((b) => rayBox(o, d, b, maxT)),
        ...(spec.cylinders ?? []).map((c) => rayCylinder(o, d, c, maxT)),
        ...(spec.spheres ?? []).map((sp) => raySphere(o, d, sp, maxT)),
      ])
        if (h && (!brute || h.t < brute.t)) brute = h;
      const found = brute;
      if (!found) continue;
      drifted++;
      expect(hit).not.toBeNull();
      expect(hit!.t).toBeLessThanOrEqual(found.t);
      if (hit!.t === found.t) expect(hit!.id).toBe(found.id);
    }
    expect(drifted).toBeGreaterThan(50);
  }, 60_000);
  it("touches the rooftop units and awnings drawn on buildings, and not their courtyards", () => {
    const sim = new CitySimulation(config);
    // An awning over open ground: the side of its wall outside the building, with nothing there.
    let awning: { b: (typeof buildings)[number]; k: number; out: number } | null = null;
    for (const b of buildings) {
      awnings(b).forEach((a, k) => {
        if (awning) return;
        const n = { x: Math.sin(a.angle), z: Math.cos(a.angle) };
        for (const out of [-1, 1]) {
          const p = (m: number) => ({
            x: a.point.x + out * n.x * m,
            z: a.point.z + out * n.z * m,
          });
          if (!buildingAt(p(0.3)) && !buildingAt(p(0.8)) && inside(p(-0.3), b.ring))
            awning = { b, k, out };
        }
      });
      if (awning) break;
    }
    expect(awning).not.toBeNull();
    {
      const { b, k, out } = awning!;
      const a = awnings(b)[k]!;
      const world = new BethesdaFlyWorld(sim, a.point);
      const y = groundAt(b.center) + a.y;
      const at = (m: number): V3 => [
        a.point.x + out * Math.sin(a.angle) * m,
        y,
        a.point.z + out * Math.cos(a.angle) * m,
      ];
      // It reaches 0.6 m out from the wall, 3.3 m up, and the fly can stand on it.
      expect(world.solid(at(0.3))).toBe(true);
      expect(world.solid(at(0.7))).toBe(false);
      const top = world.perchAt(at(0.3)[0], at(0.3)[2], y + 0.5);
      expect(top?.id).toBe(`building ${b.id} awning ${k}`);
      expect(top?.y).toBeCloseTo(y + a.h / 2, 9);
    }
    const unitOn = buildings.find((b) => rooftopUnit(b))!;
    {
      const unit = rooftopUnit(unitOn)!;
      const world = new BethesdaFlyWorld(sim, unit.point);
      const base = groundAt(unitOn.center);
      const top = world.perchAt(unit.point.x, unit.point.z, base + unitOn.height + 3);
      expect(top?.id).toBe(`building ${unitOn.id} rooftop unit`);
      expect(top?.y).toBeCloseTo(base + unit.y + unit.h / 2, 9);
    }
    // A courtyard is open from the ground to the sky, walled by its building.
    const yard = buildings.find((b) => b.holes.length > 0)!;
    {
      const hole = yard.holes[0]!;
      const c = {
        x: hole.reduce((s, p) => s + p.x, 0) / hole.length,
        z: hole.reduce((s, p) => s + p.z, 0) / hole.length,
      };
      expect(inside(c, hole)).toBe(true);
      const world = new BethesdaFlyWorld(sim, c);
      const base = groundAt(yard.center);
      expect(world.solid([c.x, base + yard.height / 2, c.z])).toBe(false);
      expect(world.perchAt(c.x, c.z, base + yard.height + 1)?.id).not.toBe(
        `building ${yard.id}`,
      );
      const wall = world.raycast([c.x, base + yard.height / 2, c.z], [1, 0, 0], 500);
      expect(wall?.id).toBe(`building ${yard.id}`);
    }
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
  it("catches up over several city ticks at once, with the city interpolated across them", () => {
    const sim = new CitySimulation(config);
    const city = new CityFly(sim);
    const [fx, , fz] = city.fly.state.p;
    // The visitor 2 m away, on a line toward the fly clear of buildings.
    const a = [...Array(8).keys()]
      .map((k) => (k * Math.PI) / 4)
      .find((a) =>
        [0.5, 1, 1.5, 2].every(
          (m) => !buildingAt({ x: fx + Math.cos(a) * m, z: fz + Math.sin(a) * m }),
        ),
      )!;
    sim.player = { x: fx + Math.cos(a) * 2, z: fz + Math.sin(a) * 2 };
    sim.step();
    city.tick();
    const t0 = city.fly.state.t;
    const p0 = { ...sim.player };
    // A frame three ticks late: the visitor walked 30 cm toward the fly meanwhile.
    for (let k = 0; k < 3; k++) {
      sim.movePlayer(-Math.cos(a) * 0.1, -Math.sin(a) * 0.1);
      sim.step();
    }
    city.tick();
    const p1 = { ...sim.player };
    expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeCloseTo(0.3, 9);
    expect(city.fly.state.t).toBeCloseTo(t0 + 3 * DT, 9);
    expect(city.failed).toBeNull();
    const out: Mover[] = [];
    city.world.movers([fx, 0, fz], 20, out, t0 + 1.5 * DT);
    const torso = out.find((m) => m.id === "player:torso");
    expect(torso?.center[0]).toBeCloseTo((p0.x + p1.x) / 2, 9);
    expect(torso?.center[2]).toBeCloseTo((p0.z + p1.z) / 2, 9);
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
