/**
 * A fly and the surfaces of its world, from digital-fly/9 on: docs/ECHO_COLLISION.md.
 *
 * Before it, a fly that walked up to a wall could come to rest on the wall's line,
 * where a point counts as outside but a ray from it no longer sees the wall. Its
 * next jump went through, and from inside the walls held: it never came out, and
 * stopped eating (docs/ECHO_RANGING.md). These tests hold the body to one rule: a
 * movement never ends inside a solid it did not start in, and a movement that does
 * not meet the defect is what it always was.
 */
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../lib/noise.js";
import { CitySimulation, PROFILES } from "../simulation.js";
import { ARENA_INPUTS } from "./arena.js";
import { BethesdaFlyWorld } from "./bethesdaWorld.js";
import { DigitalFly, FLY_VERSION } from "./fly.js";
import type { FlyNeuralAdapter, MotorCommand } from "./neural.js";
import { forward, type V3 } from "./units.js";
import {
  PrimitiveWorld,
  sweep,
  SWEEP_SKIN_M,
  type FlyWorld,
  type PrimitiveWorldSpec,
} from "./world.js";

const dot = (a: V3, b: readonly number[]) => a[0] * b[0]! + a[1] * b[1]! + a[2] * b[2]!;
const unit = (v: V3): V3 => {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
};

/** A skewed wall: a straight wall lets a point sit exactly on it, this needs the search below. */
const RING = [
  { x: 473.1234567, z: 581.7654321 },
  { x: 491.9876543, z: 589.1234567 },
  { x: 487.3456789, z: 603.4567891 },
  { x: 468.7654321, z: 596.1234567 },
];
const open = (id: string, more: Partial<PrimitiveWorldSpec>) =>
  new PrimitiveWorld({
    id,
    inputs: ARENA_INPUTS,
    home: { center: [0, 0, 0], radius: 1000, ceiling: 100 },
    ground: () => 0,
    ...more,
  });
const building = (y0 = 0, y1 = 20) =>
  open("a building", {
    prisms: [
      {
        kind: "wall",
        id: "building",
        ring: RING,
        y0,
        y1,
        min: { x: 468, z: 581 },
        max: { x: 492, z: 604 },
      },
    ],
  });
const world = building();

/** Into the building, across the wall from RING[0] to RING[1]. */
const INTO = (() => {
  const a = RING[0]!,
    b = RING[1]!;
  return unit([-(b.z - a.z), 0, b.x - a.x]);
})();

/** The heading whose forward is most nearly `d`: flight goes where the body points. */
function yawToward(d: V3): number {
  let best = 0,
    most = -2;
  for (let k = 0; k < 7200; k++) {
    const yaw = (k * Math.PI) / 3600;
    const f = forward(yaw);
    const c = f[0] * d[0] + f[2] * d[2];
    if (c > most) {
      most = c;
      best = yaw;
    }
  }
  return best;
}
const YAW_INTO = yawToward(INTO);

/** The last point from `from` along `d` that counts as outside: on the surface, as near as numbers allow. */
function lineFrom(w: FlyWorld, from: V3, d: V3, reach = 50): V3 {
  let out = 0,
    inn = reach;
  const at = (t: number): V3 => [
    from[0] + d[0] * t,
    from[1] + d[1] * t,
    from[2] + d[2] * t,
  ];
  for (let i = 0; i < 200; i++) {
    const m = (out + inn) / 2;
    if (m === out || m === inn) break;
    if (w.solid(at(m))) inn = m;
    else out = m;
  }
  return at(out);
}

/** A point on the skewed wall's line, at height y, where a ray going in misses the wall: the trap. */
function trapPoint(y = 2): V3 {
  const a = RING[0]!,
    b = RING[1]!;
  for (let k = 1; k < 400; k++) {
    const u = k / 401;
    const mid: V3 = [a.x + (b.x - a.x) * u, y, a.z + (b.z - a.z) * u];
    const p = lineFrom(
      world,
      [mid[0] - INTO[0], y, mid[2] - INTO[2]],
      [INTO[0], 0, INTO[2]],
      2,
    );
    if (!world.solid(p) && !world.raycast(p, INTO, 0.003, false)) return p;
  }
  throw new Error("no point on this wall where a ray misses it");
}

const adapter = (decide: FlyNeuralAdapter["decide"]): (() => FlyNeuralAdapter) => {
  const a: FlyNeuralAdapter = {
    descriptor: {
      id: "test",
      label: "test",
      fidelity: "test",
      simulatesNeurons: false,
      regions: [],
    },
    decide,
  };
  return () => a;
};
const flying = (velocity: V3): (() => FlyNeuralAdapter) =>
  adapter((): MotorCommand => ({
    mode: "flight",
    velocity,
    reason: "under test",
  }));

function flyIn(
  w: FlyWorld,
  p: V3,
  velocity: V3,
  yaw = yawToward(unit([velocity[0], 0, velocity[2]])),
) {
  return new DigitalFly({
    world: w,
    seed: 1,
    start: { p, yaw, mode: "flight" },
    adapter: flying(velocity),
  });
}

/** Run a fly, holding it to the rule at every step: it never ends inside a solid. */
function stayOut(fly: DigitalFly, w: FlyWorld, steps = 400): void {
  for (let i = 0; i < steps; i++) {
    fly.advance(0.005);
    expect(w.solid(fly.state.p)).toBe(false);
  }
}

describe(`the trap, on ${FLY_VERSION}`, () => {
  it("has its precondition: on the line a point is outside and a ray misses the wall", () => {
    const p = trapPoint();
    expect(world.solid(p)).toBe(false);
    expect(world.raycast(p, INTO, 0.003, false)).toBeNull();
    expect(world.solid([p[0] + INTO[0] * 0.001, 2, p[2] + INTO[2] * 0.001])).toBe(true);
  });

  it("a jump from the line, into the wall, stays out", () => {
    const fly = flyIn(world, trapPoint(), [INTO[0] * 0.4, 0.1, INTO[2] * 0.4], YAW_INTO);
    stayOut(fly, world);
    expect(fly.state.counts.collisions).toBeGreaterThan(0);
  });

  it("leaves the fly a standing height off the wall, where it can be seen again", () => {
    const fly = flyIn(world, trapPoint(), [INTO[0] * 0.4, 0.1, INTO[2] * 0.4], YAW_INTO);
    for (let i = 0; i < 10; i++) fly.advance(0.005);
    const seen = world.raycast(fly.state.p, INTO, 0.01, false);
    expect(seen?.id).toBe("building");
    expect(seen!.t).toBeGreaterThan(fly.standingHeight * 0.5);
  });

  it("does the whole thing: walk up to the wall, come to rest on it, then jump", () => {
    // Its steps shrink at the edge: this long gets a walker down to rounding.
    const WALK_S = 40;
    for (const offset of [0.11, 0.23, 0.37, 0.41, 0.53, 0.61, 0.73, 0.89]) {
      const a = RING[0]!,
        b = RING[1]!;
      const start: V3 = [
        a.x + (b.x - a.x) * offset - INTO[0] * 0.02,
        0,
        a.z + (b.z - a.z) * offset - INTO[2] * 0.02,
      ];
      let jumped = false;
      const fly = new DigitalFly({
        world,
        seed: 5,
        start: { p: start, yaw: YAW_INTO },
        adapter: adapter((input): MotorCommand => {
          if (input.body.t < WALK_S)
            return { mode: "walk", walkSpeed: 2, yawRate: 0, reason: "to the wall" };
          if (!jumped) {
            jumped = true;
            return {
              mode: "takeoff",
              heading: YAW_INTO,
              prepare: 0.01,
              reason: "at the wall",
            };
          }
          return {
            mode: "flight",
            velocity: [INTO[0] * 0.4, 0.1, INTO[2] * 0.4],
            reason: "into the wall",
          };
        }),
      });
      while (fly.state.t < WALK_S - 0.1) fly.advance(0.05);
      // It has walked onto the line, as the live fly and six research flies did.
      const across = world.raycast(
        [
          fly.state.p[0] - INTO[0] * 0.01,
          fly.state.p[1],
          fly.state.p[2] - INTO[2] * 0.01,
        ],
        INTO,
        0.02,
        false,
      );
      expect(across).not.toBeNull();
      expect(Math.abs(across!.t - 0.01)).toBeLessThan(1e-6);
      for (let i = 0; i < 400; i++) {
        fly.advance(0.005);
        expect(world.solid(fly.state.p)).toBe(false);
      }
    }
  });

  it("does it at the real building the live fly entered, and the one seed 205 did", () => {
    const real = new BethesdaFlyWorld(new CitySimulation({ ...PROFILES[1]! }));
    const prisms = (
      real as unknown as {
        spec: { prisms: { id: string; ring: { x: number; z: number }[] }[] };
      }
    ).spec.prisms;
    const WALK_S = 15;
    let walked = 0;
    for (const [id, edges] of [
      ["building 1011267786", [2, 3]],
      ["building 533702831", [0, 1, 2, 3]],
    ] as const) {
      const ring = prisms.find((p) => p.id === id)!.ring;
      for (const e of edges) {
        const a = ring[e]!,
          b = ring[(e + 1) % ring.length]!;
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        for (const side of [1, -1]) {
          // Whichever way across this wall goes in, from where a body can stand.
          const d: V3 = [(-(b.z - a.z) / L) * side, 0, ((b.x - a.x) / L) * side];
          const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
          const g = real.ground(m.x, m.z) + 0.01;
          if (
            real.solid([m.x - d[0] * 0.05, g, m.z - d[2] * 0.05]) ||
            !real.solid([m.x + d[0] * 0.05, g, m.z + d[2] * 0.05])
          )
            continue;
          const yaw = yawToward(d);
          for (const u of [0.31, 0.5, 0.77]) {
            const x = a.x + (b.x - a.x) * u - d[0] * 0.02,
              z = a.z + (b.z - a.z) * u - d[2] * 0.02;
            let jumped = false;
            const fly = new DigitalFly({
              world: real,
              seed: 5,
              start: { p: [x, real.ground(x, z), z], yaw },
              adapter: adapter((input): MotorCommand => {
                if (input.body.t < WALK_S)
                  return {
                    mode: "walk",
                    walkSpeed: 2,
                    yawRate: 0,
                    reason: "to the wall",
                  };
                if (!jumped) {
                  jumped = true;
                  return {
                    mode: "takeoff",
                    heading: yaw,
                    prepare: 0.01,
                    reason: "there",
                  };
                }
                return {
                  mode: "flight",
                  velocity: [d[0] * 0.4, 0.1, d[2] * 0.4],
                  reason: "into the wall",
                };
              }),
            });
            while (fly.state.t < WALK_S - 0.1) fly.advance(0.05);
            walked++;
            for (let i = 0; i < 300; i++) {
              fly.advance(0.005);
              expect(real.solid(fly.state.p)).toBe(false);
            }
          }
        }
      }
    }
    expect(walked).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it("does not hold a fly on the line by the wall behind it", () => {
    const p = trapPoint();
    const out: V3 = [-INTO[0], 0.1, -INTO[2]];
    const fly = flyIn(world, p, [out[0] * 0.4, 0.1, out[2] * 0.4]);
    stayOut(fly, world, 40);
    const moved = Math.hypot(fly.state.p[0] - p[0], fly.state.p[2] - p[2]);
    expect(moved).toBeGreaterThan(0.03);
    expect(fly.state.counts.collisions).toBe(0);
  });

  it("slides along the wall from the line, at every angle, and never ends inside", () => {
    const p = trapPoint();
    for (let k = 0; k < 96; k++) {
      const yaw = (k * Math.PI) / 48;
      const f = forward(yaw);
      const fly = flyIn(world, p, [f[0] * 0.5, 0, f[2] * 0.5], yaw);
      stayOut(fly, world, 40);
    }
  });
});

describe("sweep", () => {
  it("meets the surface a body on its line is going into, and names it", () => {
    const hit = sweep(world, trapPoint(), INTO, 0.003);
    expect(hit?.fromLine).toBe(true);
    expect(hit?.id).toBe("building");
    expect(hit?.t).toBe(0);
    // Its normal faces the open side, so a fly can be set off it.
    expect(dot(INTO, hit!.normal)).toBeLessThan(0);
  });

  it("ignores the surface a body on its line is leaving", () => {
    const out: V3 = [-INTO[0], 0, -INTO[2]];
    expect(sweep(world, trapPoint(), out, 0.003)).toBeNull();
  });

  it("is exactly a ray everywhere else", () => {
    const rng = mulberry32(7);
    const r = (lo: number, hi: number) => lo + (hi - lo) * rng();
    let hits = 0;
    for (let i = 0; i < 3000; i++) {
      const o: V3 = [r(460, 500), r(0.01, 25), r(575, 610)];
      if (world.solid(o)) continue;
      const a = r(0, 2 * Math.PI),
        e = r(-1, 1);
      const d: V3 = unit([Math.cos(a), e, Math.sin(a)]);
      const reach = r(0.1, 40);
      const ray = world.raycast(o, d, reach, false);
      // Rays that start on a surface are the ones this is not for.
      if (ray && ray.t <= SWEEP_SKIN_M) continue;
      expect(sweep(world, o, d, reach)).toEqual(ray);
      if (ray) hits++;
    }
    expect(hits).toBeGreaterThan(100);
  });
});

/** Every kind of solid a world can hold, each with a place to approach it from. */
const SOLIDS: readonly { name: string; world: PrimitiveWorld; toward: V3; y: number }[] =
  [
    {
      name: "a rotated box",
      world: open("box", {
        boxes: [
          {
            kind: "wall",
            id: "box",
            center: [0.123, 2, 0.456],
            half: [1, 2, 1.5],
            angle: 0.7,
          },
        ],
      }),
      toward: [0.123, 2, 0.456],
      y: 2,
    },
    {
      name: "an upright cylinder",
      world: open("cylinder", {
        cylinders: [
          { kind: "pole", id: "cylinder", x: 0.123, z: 0.456, r: 0.5, y0: 0, y1: 4 },
        ],
      }),
      toward: [0.123, 2, 0.456],
      y: 2,
    },
    {
      name: "a tapered trunk",
      world: open("frustum", {
        cylinders: [
          {
            kind: "pole",
            id: "trunk",
            x: 0.123,
            z: 0.456,
            r: 0.5,
            r1: 0.2,
            y0: 0,
            y1: 4,
          },
        ],
      }),
      toward: [0.123, 2, 0.456],
      y: 2,
    },
    {
      name: "a sphere",
      world: open("sphere", {
        spheres: [{ kind: "obstacle", id: "ball", center: [0.123, 2, 0.456], r: 1 }],
      }),
      toward: [0.123, 2, 0.456],
      y: 2,
    },
    {
      name: "a squashed crown",
      world: open("ellipsoid", {
        spheres: [
          {
            kind: "obstacle",
            id: "crown",
            center: [0.123, 3, 0.456],
            r: 1.4,
            stretch: 0.7,
          },
        ],
      }),
      toward: [0.123, 3, 0.456],
      y: 3,
    },
    {
      name: "a building's courtyard wall",
      world: open("courtyard", {
        prisms: [
          {
            kind: "wall",
            id: "ring building",
            ring: [
              { x: -20, z: -20 },
              { x: 20, z: -20 },
              { x: 20, z: 20 },
              { x: -20, z: 20 },
            ],
            holes: [
              [
                { x: -5.123, z: -5.456 },
                { x: 5.789, z: -5.321 },
                { x: 5.654, z: 5.987 },
                { x: -5.321, z: 5.123 },
              ],
            ],
            y0: 0,
            y1: 10,
            min: { x: -20, z: -20 },
            max: { x: 20, z: 20 },
          },
        ],
      }),
      // From the middle of the courtyard, outward: the walls are all around.
      toward: [40, 2, 37],
      y: 2,
    },
  ];

describe("every solid a world holds, from its own surface", () => {
  it.each(SOLIDS)("$name keeps out a fly that starts on it", (solid) => {
    const rng = mulberry32(11);
    const r = (lo: number, hi: number) => lo + (hi - lo) * rng();
    const w = solid.world;
    for (let i = 0; i < 24; i++) {
      const a = r(0, 2 * Math.PI);
      const from: V3 =
        solid.name === "a building's courtyard wall"
          ? [0.1, solid.y, 0.2]
          : [
              solid.toward[0] - 30 * Math.cos(a),
              solid.y + r(-0.2, 0.2),
              solid.toward[2] - 30 * Math.sin(a),
            ];
      const inward =
        solid.name === "a building's courtyard wall"
          ? unit([Math.cos(a), 0, Math.sin(a)])
          : unit([
              solid.toward[0] - from[0],
              solid.toward[1] - from[1],
              solid.toward[2] - from[2],
            ]);
      const p = lineFrom(w, from, inward);
      expect(w.solid(p)).toBe(false);
      const speed = r(0.2, 1.5);
      const fly = flyIn(w, p, [inward[0] * speed, inward[1] * speed, inward[2] * speed]);
      stayOut(fly, w, 120);
    }
  });
});

describe("thin walls", () => {
  const wall = (half: number) =>
    open("thin", {
      boxes: [
        {
          kind: "glass",
          id: "pane",
          center: [0, 2, 0],
          half: [half, 2, 5],
          angle: 0,
        },
      ],
    });

  it.each([0.0005, 0.002, 0.01])(
    "a pane %s m in half-width stops a fly at full speed, from a distance",
    (half) => {
      const w = wall(half);
      const fly = flyIn(w, [-1, 2, 0], [1.5, 0, 0], yawToward([1, 0, 0]));
      for (let i = 0; i < 400; i++) {
        fly.advance(0.005);
        expect(fly.state.p[0]).toBeLessThan(-half);
      }
    },
  );

  it.each([0.0005, 0.002, 0.01])(
    "a pane %s m in half-width stops a fly that starts on it",
    (half) => {
      const w = wall(half);
      const p = lineFrom(w, [-1, 2, 0.1], [1, 0, 0], 2);
      const fly = flyIn(w, p, [1.5, 0, 0], yawToward([1, 0, 0]));
      for (let i = 0; i < 200; i++) {
        fly.advance(0.005);
        expect(fly.state.p[0]).toBeLessThan(-half);
      }
    },
  );
});

describe("standing room", () => {
  // Ground falling away beneath a building: its floor is lower than a fly stands.
  const FLOOR = 0.0008;
  const low = open("a gap", {
    prisms: [
      {
        kind: "wall",
        id: "building",
        ring: [
          { x: -10, z: -10 },
          { x: 10, z: -10 },
          { x: 10, z: 10 },
          { x: -10, z: 10 },
        ],
        y0: FLOOR,
        y1: 5,
        min: { x: -10, z: -10 },
        max: { x: 10, z: 10 },
      },
    ],
  });

  it("seed 205: a fly in a gap under a floor is not stood up through it", () => {
    const fly = flyIn(low, [0, FLOOR - 0.0001, 0], [0, -0.05, 0], 0);
    expect(fly.standingHeight).toBeGreaterThan(FLOOR);
    stayOut(fly, low, 40);
    expect(fly.state.counts.landings).toBe(0);
    expect(fly.state.perch).toBeNull();
  });

  it("seed 205, where it happened: under the real building, on the real slope", () => {
    const real = new BethesdaFlyWorld(new CitySimulation({ ...PROFILES[1]! }));
    const floor = (
      real as unknown as { spec: { prisms: { id: string; y0: number }[] } }
    ).spec.prisms.find((p) => p.id === "building 533702831")!.y0;
    const standing = flyIn(low, [20, 1, 20], [0, 0, 0], 0).standingHeight;
    // Along the slope from where the fly went in, to where the gap is half a fly high.
    const [ax, az] = [-106.91, 53.64];
    const [bx, bz] = [-153, 62];
    let lo = 0,
      hi = 1;
    expect(real.ground(ax, az)).toBeGreaterThan(floor);
    const gapAt = (u: number) =>
      floor - real.ground(ax + (bx - ax) * u, az + (bz - az) * u);
    expect(gapAt(1)).toBeGreaterThan(standing);
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (gapAt(m) < standing / 2) lo = m;
      else hi = m;
    }
    const x = ax + (bx - ax) * hi,
      z = az + (bz - az) * hi;
    const g = real.ground(x, z);
    const inGap: V3 = [x, (g + floor) / 2, z];
    expect(floor - g).toBeLessThan(standing);
    expect(real.solid(inGap)).toBe(false);
    // The stand a touchdown would give puts the body inside the building.
    expect(real.solid([x, g + standing, z])).toBe(true);
    const fly = flyIn(real, inGap, [0, -0.05, 0], 0);
    stayOut(fly, real, 40);
    expect(fly.state.counts.landings).toBe(0);
  });

  it("a fly on a roof beside a wall lands on it", () => {
    const w = building(0, 3);
    const top: V3 = [481, 3 + 0.02, 593];
    expect(w.solid(top)).toBe(false);
    const fly = flyIn(w, top, [0, -0.1, 0], 0);
    for (let i = 0; i < 200 && fly.state.mode === "flight"; i++) fly.advance(0.005);
    expect(fly.state.mode).toBe("rest");
    expect(fly.state.perch?.kind).toBe("roof");
    expect(fly.state.p[1]).toBeCloseTo(3 + fly.standingHeight, 9);
  });
});

describe("terrain", () => {
  const slope = (x: number, z: number) => 0.1 * x + 0.05 * z + 0.2 * Math.sin(x / 3);
  const hill = open("a hill", { ground: slope, groundMax: 100 });

  it("a fly flying into a slope never goes under it", () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 40; i++) {
      const a = rng() * 2 * Math.PI;
      const fly = flyIn(
        hill,
        [rng() * 4, slope(0, 0) + 1, rng() * 4],
        [Math.cos(a), -0.5, Math.sin(a)],
      );
      for (let k = 0; k < 200; k++) {
        fly.advance(0.005);
        const s = fly.state.p;
        expect(s[1]).toBeGreaterThanOrEqual(slope(s[0], s[2]));
      }
    }
  });

  it("a fly walks a slope standing on it", () => {
    const fly = new DigitalFly({
      world: hill,
      seed: 2,
      start: { p: [1, slope(1, 1) + 0.002, 1], yaw: 0.4 },
      adapter: adapter(() => ({
        mode: "walk",
        walkSpeed: 3,
        yawRate: 0,
        reason: "uphill",
      })),
    });
    for (let i = 0; i < 400; i++) {
      fly.advance(0.005);
      const s = fly.state;
      expect(s.p[1]).toBeCloseTo(slope(s.p[0], s.p[2]) + fly.standingHeight, 9);
    }
    expect(fly.state.counts.walkedM).toBeGreaterThan(0.01);
  });
});

describe("a fly already inside a solid, as one from an earlier release can be", () => {
  const INSIDE: V3 = [481, 2, 593];
  /** A fly can't be started inside: put it there, as a restored checkpoint does. */
  const inside = (velocity: V3, yaw = yawToward(unit([velocity[0], 0, velocity[2]]))) => {
    const fly = flyIn(world, [460, 2, 560], velocity, yaw);
    fly.state.p = [...INSIDE];
    return fly;
  };

  it("flies out, without being placed anywhere", () => {
    const fly = inside([-INTO[0], 0, -INTO[2]]);
    expect(world.solid(fly.state.p)).toBe(true);
    let left = -1;
    for (let i = 0; i < 2000 && left < 0; i++) {
      const before = fly.state.p;
      fly.advance(0.005);
      // It went there by flying: no step longer than its speed allows.
      expect(
        Math.hypot(fly.state.p[0] - before[0], fly.state.p[2] - before[2]),
      ).toBeLessThan(0.05);
      if (!world.solid(fly.state.p)) left = i;
    }
    expect(left).toBeGreaterThan(0);
    // And from outside, the wall holds as it holds any fly.
    const back = flyIn(world, fly.state.p, [INTO[0] * 0.5, 0, INTO[2] * 0.5]);
    stayOut(back, world);
  });

  it("is still held by the ground", () => {
    const fly = inside([0, -1, 0], 0);
    for (let i = 0; i < 400; i++) {
      fly.advance(0.005);
      expect(fly.state.p[1]).toBeGreaterThanOrEqual(0);
    }
  });

  it("cannot stand there, but can stand once out", () => {
    const fly = inside([0, -0.1, 0], 0);
    for (let i = 0; i < 2000; i++) fly.advance(0.005);
    expect(world.solid(fly.state.p)).toBe(true);
    expect(fly.state.counts.landings).toBe(0);
    expect(fly.state.perch).toBeNull();
    const outside = flyIn(world, [481, 0.02, 500], [0, -0.1, 0], 0);
    for (let i = 0; i < 200 && outside.state.mode === "flight"; i++)
      outside.advance(0.005);
    expect(outside.state.mode).toBe("rest");
  });

  it("does not walk: only flight takes it out", () => {
    const fly = new DigitalFly({
      world,
      seed: 4,
      start: { p: [481, 0, 593], yaw: 0 },
      adapter: adapter(() => ({
        mode: "walk",
        walkSpeed: 3,
        yawRate: 0,
        reason: "walking",
      })),
    });
    const from = fly.state.p;
    for (let i = 0; i < 200; i++) fly.advance(0.005);
    expect(fly.state.p).toEqual(from);
    expect(fly.state.edge).toBe(true);
    expect(fly.state.counts.walkedM).toBe(0);
  });
});

describe("a fly leaving one solid for the next", () => {
  // Two buildings a hand's width apart, and a fly in the first going toward the second.
  const pair = open("a narrow gap", {
    boxes: [
      { kind: "wall", id: "first", center: [-2, 3, 0], half: [2, 3, 2], angle: 0 },
      { kind: "wall", id: "second", center: [2.001, 3, 0], half: [2, 3, 2], angle: 0 },
    ],
  });

  it("the gap holds it: the second is met like any wall", () => {
    const fly = flyIn(pair, [-2, 2, 3], [1, 0, 0], yawToward([1, 0, 0]));
    // Not started there: put there, as a restored checkpoint does.
    fly.state.p = [-0.0005, 2, 0];
    expect(pair.solid(fly.state.p)).toBe(true);
    const hit = sweep(pair, fly.state.p, [1, 0, 0], 0.01);
    expect(hit?.id).toBe("second");
  });
});

describe("repeated corrections do not trap a fly against a surface", () => {
  class Windy extends PrimitiveWorld {
    wind(): V3 {
      return [INTO[0] * 3, 0, INTO[2] * 3];
    }
  }
  const windy = new Windy({
    id: "wind at the wall",
    inputs: ARENA_INPUTS,
    home: { center: [480, 0, 570], radius: 200, ceiling: 100 },
    ground: () => 0,
    prisms: [
      {
        kind: "wall",
        id: "building",
        ring: RING,
        y0: 0,
        y1: 20,
        min: { x: 468, z: 581 },
        max: { x: 492, z: 604 },
      },
    ],
  });

  it("a fly held against a wall by the wind stays out, and walls count once", () => {
    const p = trapPoint();
    const fly = flyIn(windy, p, [0, 0.02, 0], YAW_INTO);
    stayOut(fly, windy, 400);
    expect(fly.state.counts.collisions).toBeLessThan(4);
  });

  it("a fly that has pressed into a wall can fly away along it and off it", () => {
    let leaving = false;
    const a = unit([RING[1]!.x - RING[0]!.x, 0, RING[1]!.z - RING[0]!.z]);
    const fly = new DigitalFly({
      world,
      seed: 6,
      start: { p: trapPoint(), yaw: YAW_INTO, mode: "flight" },
      adapter: adapter((): MotorCommand => ({
        mode: "flight",
        velocity: leaving
          ? [a[0] * 0.5 - INTO[0] * 0.5, 0, a[2] * 0.5 - INTO[2] * 0.5]
          : [INTO[0] * 0.5, 0, INTO[2] * 0.5],
        reason: leaving ? "off it" : "into it",
      })),
    });
    stayOut(fly, world, 200);
    const pressed = fly.state.p;
    leaving = true;
    fly.state.yaw = yawToward(unit([a[0] - INTO[0], 0, a[2] - INTO[2]]));
    stayOut(fly, world, 200);
    expect(
      Math.hypot(fly.state.p[0] - pressed[0], fly.state.p[2] - pressed[2]),
    ).toBeGreaterThan(0.2);
    expect(fly.state.contact).toBeNull();
  });
});

describe("the same fly twice", () => {
  it("meets a wall from its line, deterministically", () => {
    const make = () =>
      flyIn(world, trapPoint(), [INTO[0] * 0.4, 0.1, INTO[2] * 0.4], YAW_INTO);
    const a = make(),
      b = make();
    for (let i = 0; i < 300; i++) {
      a.advance(0.005);
      b.advance(0.005);
    }
    expect(a.stateHash()).toBe(b.stateHash());
  });
});
