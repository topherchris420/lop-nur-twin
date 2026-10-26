import { describe, expect, it } from "vitest";
import { groundHeight, LAYOUT, PLAN, standingHeight, stoneTop } from "./layout.js";
import { PLACE_IDS, type PlaceId } from "./observation.js";
import {
  airPoint,
  applySway,
  FlightPath,
  perchPoint,
  restingForward,
  routeProgress,
  STAGES,
  swayFrame,
  WalkPath,
} from "./stage.js";
import { distance, dot, length, sub, type V3 } from "./vec.js";

/** The farthest the server lets a perched fly wander from its place (learning.py's calibration rule). */
const WANDER = 0.018;
const around = (p: PlaceId): [number, number][] => {
  const [x, y] = PLAN[p];
  const out: [number, number][] = [[x, y]];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * 2 * Math.PI;
    out.push([x + WANDER * Math.cos(a), y + WANDER * Math.sin(a)]);
    out.push([
      x + 0.5 * WANDER * Math.cos(a + 0.3),
      y + 0.5 * WANDER * Math.sin(a + 0.3),
    ]);
  }
  return out;
};
const unit = (v: V3) => expect(length(v)).toBeCloseTo(1, 6);

describe("perches", () => {
  it("put the fly on the sculpted surface of each place", () => {
    const sill = LAYOUT.window.sill;
    for (const p of around("window")) {
      const s = perchPoint("window", p).position;
      expect(s[1]).toBeCloseTo(sill.top, 9);
      expect(s[0]).toBeGreaterThan(sill.x0);
      expect(s[0]).toBeLessThan(sill.x1);
      expect(s[2]).toBeGreaterThan(LAYOUT.wall.front);
      expect(s[2]).toBeLessThan(LAYOUT.wall.front + sill.depth);
    }
    for (const p of around("fence")) {
      const s = perchPoint("fence", p).position;
      expect(s[2]).toBeCloseTo(LAYOUT.fence.front, 9);
      expect(s[1]).toBeGreaterThan(LAYOUT.fence.rails[0] + 0.05);
      expect(s[1]).toBeLessThan(LAYOUT.fence.height - 0.05);
    }
    for (const p of around("water")) {
      const s = perchPoint("water", p).position;
      const r = Math.hypot(s[0] - LAYOUT.saucer.x, s[2] - LAYOUT.saucer.z);
      // On the rim's top, never on the water.
      expect(
        Math.abs(r - (LAYOUT.saucer.radius - LAYOUT.saucer.wall / 2)),
      ).toBeLessThanOrEqual(LAYOUT.saucer.wall / 2);
    }
    const stone = LAYOUT.stones[2]!;
    for (const p of around("stone")) {
      const s = perchPoint("stone", p).position;
      expect(s[1]).toBeCloseTo(stoneTop(2), 9);
      expect(
        Math.hypot((s[0] - stone.x) / stone.rx, (s[2] - stone.z) / stone.rz),
      ).toBeLessThan(0.75);
    }
    for (const p of around("flowers")) {
      const s = perchPoint("flowers", p).position;
      // On the aster's disc: within its radius of the flower's centre.
      expect(distance(s, LAYOUT.heroAster.center)).toBeLessThan(0.009);
    }
    for (const p of around("pear")) {
      const s = perchPoint("pear", p).position;
      expect(s[1]).toBeGreaterThan(groundHeight(LAYOUT.pear.x, LAYOUT.pear.z) + 0.02);
    }
    for (const p of around("leaf")) {
      const s = perchPoint("leaf", p);
      // Under the leaf, facing down.
      expect(s.normal[1]).toBeLessThan(-0.8);
      expect(distance(s.position, LAYOUT.maple.shelter.center)).toBeLessThan(0.03);
    }
  });

  it("give unit normals and a resting direction along the surface", () => {
    for (const place of PLACE_IDS)
      for (const p of around(place)) {
        const s = perchPoint(place, p);
        unit(s.normal);
        const f = restingForward(place, p, s.normal);
        unit(f);
        expect(Math.abs(dot(f, s.normal))).toBeLessThan(1e-6);
      }
  });

  it("move with the server's position, by the place's scale", () => {
    const a = perchPoint("stone", [0.77, 0.85]).position;
    const b = perchPoint("stone", [0.7716, 0.8513]).position;
    const moved = distance(a, b);
    // A 0.002 garden-unit calibration step is a few millimetres on the stone.
    expect(moved).toBeGreaterThan(0.002);
    expect(moved).toBeLessThan(0.008);
  });

  it("are the same for the same state, every time", () => {
    for (const place of PLACE_IDS) {
      const p: [number, number] = [PLAN[place][0] + 0.004, PLAN[place][1] - 0.003];
      expect(perchPoint(place, p)).toEqual(perchPoint(place, p));
      expect(restingForward(place, p, [0, 1, 0])).toEqual(
        restingForward(place, p, [0, 1, 0]),
      );
    }
  });
});

describe("flight paths", () => {
  const pairs: [PlaceId, PlaceId][] = [];
  for (const a of PLACE_IDS) for (const b of PLACE_IDS) if (a !== b) pairs.push([a, b]);

  it("join the two perches and keep clear of the ground", () => {
    for (const [a, b] of pairs) {
      const A = perchPoint(a, PLAN[a] as [number, number]);
      const B = perchPoint(b, PLAN[b] as [number, number]);
      const path = new FlightPath(A, STAGES[a].approach, B, STAGES[b].approach, 7.5);
      expect(path.at(0)).toEqual(A.position);
      expect(path.at(1)).toEqual(B.position);
      for (let k = 1; k < 50; k++) {
        const p = path.at(k / 50);
        expect(p[1]).toBeGreaterThanOrEqual(standingHeight(p[0], p[2]) - 1e-9);
        unit(path.tangent(k / 50));
      }
      expect(path.length).toBeGreaterThan(distance(A.position, B.position));
    }
  });

  it("advance evenly: equal progress covers equal distance", () => {
    const A = perchPoint("fence", PLAN.fence as [number, number]);
    const B = perchPoint("stone", PLAN.stone as [number, number]);
    const path = new FlightPath(A, STAGES.fence.approach, B, STAGES.stone.approach, 3);
    const steps = [0, 0.25, 0.5, 0.75, 1].map((u) => path.at(u));
    const chords = steps.slice(1).map((p, i) => distance(p, steps[i]!));
    for (const c of chords) expect(c / (path.length / 4)).toBeGreaterThan(0.9);
  });
});

describe("walking routes", () => {
  it("are continuous and stay on surfaces", () => {
    const A = perchPoint("leaf", PLAN.leaf as [number, number]);
    const B = perchPoint("window", PLAN.window as [number, number]);
    const w = new WalkPath(A, "leaf", B, "window");
    let prev = w.at(0).position;
    expect(prev).toEqual(A.position);
    for (let k = 1; k <= 200; k++) {
      const p = w.at(k / 200).position;
      expect(distance(p, prev)).toBeLessThan((w.length / 200) * 1.01 + 1e-9);
      prev = p;
    }
    expect(prev).toEqual(B.position);
  });
});

describe("route progress", () => {
  it("projects the server's position on its straight route", () => {
    expect(routeProgress([0, 0], [1, 0], [0.25, 0.1])).toBeCloseTo(0.25, 9);
    expect(routeProgress([0, 0], [1, 0], [-1, 0])).toBe(0);
    expect(routeProgress([0, 0], [1, 0], [2, 0])).toBe(1);
    expect(routeProgress([0.3, 0.3], [0.3, 0.3], [0.3, 0.3])).toBe(1);
  });
});

describe("wind", () => {
  it("turns a perch about its stalk without moving the stalk", () => {
    const s = swayFrame("leaf", 12.3, 20);
    expect(distance(applySway(s, s.pivot), s.pivot)).toBeLessThan(1e-12);
    expect(Math.abs(s.angle)).toBeGreaterThan(0);
    expect(Math.abs(s.angle)).toBeLessThan(0.1);
    const v: V3 = [0.1, 0.2, 0.3];
    expect(length(applySway(s, v, true))).toBeCloseTo(length(v), 12);
    expect(swayFrame("flower", 5, 10)).toEqual(swayFrame("flower", 5, 10));
  });
});

describe("the midge's air", () => {
  it("is above the lawn and inside the garden for the server's whole track", () => {
    for (let t = 0; t < 2000; t += 7) {
      const p = airPoint([0.55 + 0.22 * Math.sin(t / 23), 0.4 + 0.11 * Math.cos(t / 31)]);
      expect(p[1]).toBeGreaterThan(standingHeight(p[0], p[2]) + 0.2);
      expect(p[0]).toBeGreaterThan(LAYOUT.ground.minX);
      expect(p[0]).toBeLessThan(LAYOUT.ground.maxX);
      expect(p[2]).toBeGreaterThan(LAYOUT.fence.front);
    }
  });
});

it("keeps every place's anchor distinct", () => {
  for (const a of PLACE_IDS)
    for (const b of PLACE_IDS)
      if (a !== b)
        expect(length(sub(STAGES[a].anchor, STAGES[b].anchor))).toBeGreaterThan(0.3);
});
