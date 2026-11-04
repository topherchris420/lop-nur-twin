import { describe, expect, it } from "vitest";
import { ARENA_INPUTS } from "../../fly/arena.js";
import { DigitalFly } from "../../fly/fly.js";
import type { FlyNeuralAdapter, MotorCommand } from "../../fly/neural.js";
import { forward, type V3 } from "../../fly/units.js";
import { PrimitiveWorld } from "../../fly/world.js";
import { guardWalls } from "./wallGuard.js";

/** A skewed wall: a straight wall lets a point sit exactly on it, this needs the search below. */
const RING = [
  { x: 473.1234567, z: 581.7654321 },
  { x: 491.9876543, z: 589.1234567 },
  { x: 487.3456789, z: 603.4567891 },
  { x: 468.7654321, z: 596.1234567 },
];
const world = new PrimitiveWorld({
  id: "a wall",
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

/** Into the building, across the wall from `a` to `b`. */
const into = (() => {
  const a = RING[0]!,
    b = RING[1]!;
  const ex = b.x - a.x,
    ez = b.z - a.z,
    len = Math.hypot(ex, ez);
  return [-ez / len, 0, ex / len] as V3;
})();

/** The heading that faces the wall: flight goes where the body points. */
const yawInto = (() => {
  let best = 0,
    most = -2;
  for (let k = 0; k < 7200; k++) {
    const yaw = (k * Math.PI) / 3600;
    const f = forward(yaw);
    const dot = f[0] * into[0] + f[2] * into[2];
    if (dot > most) {
      most = dot;
      best = yaw;
    }
  }
  return best;
})();

/** A point at height y as near the wall as numbers allow, still counted as outside. */
function onTheLine(along: number, y: number): V3 {
  const a = RING[0]!,
    b = RING[1]!;
  const mid = [a.x + (b.x - a.x) * along, a.z + (b.z - a.z) * along] as const;
  let out = -1,
    inn = 1;
  const at = (d: number): V3 => [mid[0] + into[0] * d, y, mid[1] + into[2] * d];
  for (let i = 0; i < 200; i++) {
    const m = (out + inn) / 2;
    if (m === out || m === inn) break;
    if (world.solid(at(m))) inn = m;
    else out = m;
  }
  return at(out);
}

/** The fly's flight toward the wall, the way a jump beside it goes. */
const pushing: FlyNeuralAdapter = {
  descriptor: {
    id: "pushing",
    label: "pushing",
    fidelity: "test",
    simulatesNeurons: false,
    regions: [],
  },
  decide: (): MotorCommand => ({
    mode: "flight",
    velocity: [into[0] * 0.4, 0.1, into[2] * 0.4],
    reason: "into the wall",
  }),
};

function flyAt(p: V3) {
  return new DigitalFly({
    world,
    seed: 1,
    start: { p, yaw: yawInto, mode: "flight" },
    adapter: () => pushing,
  });
}

/** A point on the line where the wall can't be seen: that's the trap. */
function trapPoint(): V3 {
  for (let k = 1; k < 400; k++) {
    const p = onTheLine(k / 401, 2);
    const dir: V3 = [into[0], 0, into[2]];
    if (!world.solid(p) && !world.raycast(p, dir, 0.003, false)) return p;
  }
  throw new Error("no point on this wall where a ray misses it");
}

// Since digital-fly/9 the fly keeps itself out (collision.test.ts), so the guard, made
// to stand in for that, has nothing left to refuse. It stays for what was run with it.
describe("the wall guard", () => {
  it("is not needed: the plain fly stays out, from the line", () => {
    const fly = flyAt(trapPoint());
    for (let i = 0; i < 400; i++) {
      fly.advance(0.005);
      expect(world.solid(fly.state.p)).toBe(false);
    }
  });

  it("has nothing to refuse, from the same place", () => {
    const fly = flyAt(trapPoint());
    const guard = guardWalls(fly);
    for (let i = 0; i < 400; i++) {
      fly.advance(0.005);
      expect(world.solid(fly.state.p)).toBe(false);
    }
    expect(guard.refused).toBe(0);
    expect(guard.unnamed).toBe(0);
  });

  it("leaves the fly off the wall's line, where the wall can be seen again", () => {
    const fly = flyAt(trapPoint());
    guardWalls(fly);
    for (let i = 0; i < 10; i++) fly.advance(0.005);
    const dir: V3 = [into[0], 0, into[2]];
    expect(world.raycast(fly.state.p, dir, 0.01, false)?.id).toBe("building");
  });

  it("keeps the fly in the air where there is no room to stand under a floor", () => {
    // Ground falling away beneath a building: its floor is lower than a fly stands.
    const floor = 0.0008;
    const low = new PrimitiveWorld({
      id: "a gap",
      inputs: ARENA_INPUTS,
      home: { center: [0, 0, 0], radius: 50, ceiling: 40 },
      ground: () => 0,
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
          y0: floor,
          y1: 5,
          min: { x: -10, z: -10 },
          max: { x: 10, z: 10 },
        },
      ],
    });
    const down: FlyNeuralAdapter = {
      ...pushing,
      decide: () => ({ mode: "flight", velocity: [0, -0.05, 0], reason: "down" }),
    };
    const fly = new DigitalFly({
      world: low,
      seed: 3,
      start: { p: [0, floor - 0.0001, 0], yaw: 0, mode: "flight" },
      adapter: () => down,
    });
    const guard = guardWalls(fly);
    expect(fly.standingHeight).toBeGreaterThan(floor);
    for (let i = 0; i < 40; i++) {
      fly.advance(0.005);
      expect(low.solid(fly.state.p)).toBe(false);
    }
    expect(guard.touchedDown).toBe(0);
    expect(fly.state.counts.landings).toBe(0);
    expect(fly.state.perch).toBeNull();
  });

  it("changes nothing for a fly that never tries to enter", () => {
    const start: V3 = [480, 2, 560];
    const away: FlyNeuralAdapter = {
      ...pushing,
      decide: () => ({
        mode: "flight",
        velocity: [-into[0] * 0.4, 0.05, -into[2] * 0.4],
        reason: "away",
      }),
    };
    const make = () =>
      new DigitalFly({
        world,
        seed: 2,
        start: { p: start, yaw: 0, mode: "flight" },
        adapter: () => away,
      });
    const plain = make();
    const guarded = make();
    const guard = guardWalls(guarded);
    for (let i = 0; i < 2000; i++) {
      plain.advance(0.005);
      guarded.advance(0.005);
    }
    expect(guard.refused).toBe(0);
    expect(guarded.state).toEqual(plain.state);
  });
});
