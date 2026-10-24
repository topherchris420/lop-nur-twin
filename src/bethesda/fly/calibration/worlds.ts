/**
 * The apparatus of the calibration paradigms, built from the fly's world
 * primitives (`world.ts`) as plain data, so a paradigm's world is part of its
 * definition. Metres, world frame. Walls are boxes or the walls of a prism's
 * courtyard: a round arena is a square block with a polygonal hole, the shape
 * the city uses for courtyards, so the fly meets its wall as it would any
 * other.
 */
import type { V3 } from "../units.js";
import {
  PrimitiveWorld,
  type Box,
  type Cylinder,
  type Prism,
  type WorldInputs,
} from "../world.js";

const WALL = 0.01;

const INPUTS: WorldInputs = {
  supported: ["floor, walls and lid", "posts", "looming stimuli"],
  proxies: ["light level: uniform ambient, relative units"],
  unsupported: [
    "odour",
    "temperature",
    "humidity",
    "airflow",
    "food",
    "dust (an internal state of the grooming circuit, set at placement)",
  ],
};

/** A closed square box of inner `width` × `width` × `height` (m), centred on the origin. */
export function chamber(width: number, height: number, id = "chamber"): PrimitiveWorld {
  const h = width / 2;
  const wall = (cid: string, center: V3, half: V3): Box => ({
    kind: "wall",
    id: cid,
    center,
    half,
    angle: 0,
  });
  return new PrimitiveWorld({
    id,
    home: { center: [0, 0, 0], radius: h, ceiling: height },
    inputs: INPUTS,
    ground: () => 0,
    groundMax: 0,
    groundKind: "floor",
    boxes: [
      wall("wall-n", [0, height / 2, -h - WALL / 2], [h + WALL, height / 2, WALL / 2]),
      wall("wall-s", [0, height / 2, h + WALL / 2], [h + WALL, height / 2, WALL / 2]),
      wall("wall-w", [-h - WALL / 2, height / 2, 0], [WALL / 2, height / 2, h + WALL]),
      wall("wall-e", [h + WALL / 2, height / 2, 0], [WALL / 2, height / 2, h + WALL]),
    ],
    ceiling: height,
    ambient: 0.6,
  });
}

/**
 * The reduced-order controller keeps a flying fly 0.3 m below its home
 * range's ceiling (`vertical` in `controller.ts`), a rule sized for the city.
 * An arena's home range therefore reaches this far above its lid, so the rule
 * holds the fly below the lid instead of pressing it toward the floor.
 */
const HOME_ABOVE_LID_M = 0.3;

/**
 * A round open arena of `radius` and `height` (m) with a lid: the floor
 * inside a `sides`-gon inscribed in the circle, walled all round. A clear
 * arena's wall and lid are glass, which the eyes see through (a stimulus
 * outside is visible); an opaque one's lid is the world's ceiling.
 */
export function roundArena(
  radius: number,
  height: number,
  o: { clear?: boolean; sides?: number; id?: string } = {},
): PrimitiveWorld {
  const sides = o.sides ?? 48;
  const clear = o.clear === true;
  const outer = radius + 0.05;
  const hole = Array.from({ length: sides }, (_, i) => {
    const a = (2 * Math.PI * i) / sides;
    return { x: radius * Math.cos(a), z: radius * Math.sin(a) };
  });
  const wall: Prism = {
    kind: clear ? "glass" : "wall",
    id: "arena-wall",
    ring: [
      { x: -outer, z: -outer },
      { x: outer, z: -outer },
      { x: outer, z: outer },
      { x: -outer, z: outer },
    ],
    holes: [hole],
    y0: 0,
    y1: height,
    min: { x: -outer, z: -outer },
    max: { x: outer, z: outer },
  };
  const lid: Box = {
    kind: "glass",
    id: "arena-lid",
    center: [0, height + WALL / 2, 0],
    half: [outer, WALL / 2, outer],
    angle: 0,
  };
  return new PrimitiveWorld({
    id: o.id ?? "round-arena",
    home: { center: [0, 0, 0], radius, ceiling: height + HOME_ABOVE_LID_M },
    inputs: INPUTS,
    ground: () => 0,
    groundMax: 0,
    groundKind: "floor",
    prisms: [wall],
    ...(clear ? { boxes: [lid] } : { ceiling: height }),
    ambient: 0.6,
  });
}

/**
 * A closed rectangular tunnel, `length` along x, with optional upright posts
 * (round cylinders from the floor, whose tops a fly may land on), still air
 * and uniform light. The whole tunnel is inside the home range.
 */
export function tunnel(
  length: number,
  width: number,
  height: number,
  posts: { x: number; z: number; r: number; h: number }[] = [],
  id = "tunnel",
): PrimitiveWorld {
  const hx = length / 2,
    hz = width / 2;
  const box = (cid: string, center: V3, half: V3): Box => ({
    kind: "wall",
    id: cid,
    center,
    half,
    angle: 0,
  });
  const cylinders: Cylinder[] = posts.map((p, i) => ({
    kind: "obstacle",
    id: `post-${i}`,
    x: p.x,
    z: p.z,
    r: p.r,
    y0: 0,
    y1: p.h,
  }));
  return new PrimitiveWorld({
    id,
    home: {
      center: [0, 0, 0],
      radius: Math.hypot(hx, hz),
      ceiling: height + HOME_ABOVE_LID_M,
    },
    inputs: INPUTS,
    ground: () => 0,
    groundMax: 0,
    groundKind: "floor",
    boxes: [
      box("wall-n", [0, height / 2, -hz - WALL / 2], [hx + WALL, height / 2, WALL / 2]),
      box("wall-s", [0, height / 2, hz + WALL / 2], [hx + WALL, height / 2, WALL / 2]),
      box("wall-w", [-hx - WALL / 2, height / 2, 0], [WALL / 2, height / 2, hz + WALL]),
      box("wall-e", [hx + WALL / 2, height / 2, 0], [WALL / 2, height / 2, hz + WALL]),
    ],
    cylinders,
    ceiling: height,
    ambient: 0.6,
  });
}
