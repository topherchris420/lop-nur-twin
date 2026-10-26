/**
 * The sculpted garden's layout: the single source of truth for where every
 * prop stands and how big it is. The scene builders (`src/garden/scene/`)
 * and the stage mapping (`stage.ts`) both read it, so a perch can never sit
 * somewhere the clay is not.
 *
 * True scale, in metres: +x to the right, +y up, +z toward the observation
 * camera. The fly is FlyBody's 3 mm adult; the garden is a small Bethesda
 * back garden in late October, about five metres wide. The server's seven
 * places are composed where its 2D picture put them (the maple leaf top left,
 * the windowsill top right, the asters in their pot, the pear, saucer and
 * stepping stone in front), so the familiar garden reads the same way.
 *
 * The garden is an interpretation. The simulation's world is an abstract 2D
 * plane; it knows nothing of heights, surfaces or this geometry.
 */
import { seededNoise2D } from "../../lib/noise.js";
import type { V3 } from "./vec.js";

export const GARDEN_SEED = 0x6a2d;

export interface Ellipse {
  x: number;
  z: number;
  rx: number;
  rz: number;
  /** Rotation about +y, radians. */
  yaw: number;
}

export const LAYOUT = {
  ground: { minX: -3.4, maxX: 3.6, minZ: -1.7, maxZ: 3.2 },
  /** Cedar fence across the back; the boards' front faces lie in the plane z = front. */
  fence: {
    front: -1.3,
    x0: -3.4,
    x1: 1.06,
    // Boards butted close (a 1.5 mm gap), with a dark backing behind them
    // (scene/props.ts), so their joints never show the bright sky or the
    // sunlit neighbours as slits.
    boardWidth: 0.1425,
    gap: 0.0015,
    thickness: 0.016,
    height: 1.28,
    bottom: 0.025,
    rails: [0.24, 1.04] as const,
  },
  /**
   * The house wall on the right. The plane z = front is its sheathing; the
   * shiplap's face stands `siding` in front of it, the foundation's face
   * `foundation.face`.
   */
  wall: {
    front: -0.95,
    x0: 1.06,
    x1: 3.6,
    height: 2.7,
    board: 0.118,
    siding: 0.012,
    foundation: { top: 0.3, face: 0.024 },
  },
  window: {
    x0: 1.3,
    x1: 1.94,
    y0: 0.93,
    y1: 1.63,
    trim: 0.055,
    /** The sill, standing out from the wall plane; its front edges rounded at `round`. */
    sill: { x0: 1.19, x1: 2.05, top: 0.88, depth: 0.075, thickness: 0.034, round: 0.005 },
    /** The apron board under the sill: its height and its face's offset from the wall plane. */
    apron: { height: 0.06, face: 0.022 },
  },
  /** Terracotta pot of late asters, mid right. */
  pot: {
    x: 0.78,
    z: -0.22,
    baseRadius: 0.104,
    bodyTopRadius: 0.152,
    bodyHeight: 0.205,
    rimRadius: 0.164,
    rimHeight: 0.04,
    wall: 0.012,
    soil: 0.226,
  },
  /** The flower head the "flowers" place names: an aster at the front of the mound. */
  heroAster: {
    center: [0.71, 0.5, -0.07] as V3,
    facing: [-0.12, 0.74, 0.66] as V3,
    discRadius: 0.0046,
    rayLength: 0.0115,
  },
  /** A fallen pear lying on its side on the lawn. */
  pear: {
    x: -0.99,
    z: 0.59,
    /** Direction of the stem end, radians about +y from +x. */
    yaw: 0.38,
    length: 0.104,
    radius: 0.0355,
    neckRadius: 0.019,
    /** Unit direction from the body's centre to the bruised, sweet edge the fly feeds on. */
    bruise: [0.06, 0.84, 0.54] as V3,
  },
  /**
   * A terracotta plant saucer brimming with rainwater: the surface stands
   * 1.5 mm below the rim, so a fly on the rim can reach it.
   */
  saucer: {
    x: 0.1,
    z: 0.79,
    radius: 0.17,
    base: 0.146,
    height: 0.036,
    wall: 0.009,
    water: 0.0345,
  },
  /** The gravel path's centre line (xz), front to back, and its half-width. */
  path: {
    points: [
      [0.5, 3.1],
      [0.62, 2.3],
      [0.86, 1.62],
      [1.1, 0.95],
      [1.44, 0.38],
      [1.88, -0.14],
      [2.4, -0.6],
      [3.0, -0.9],
    ] as [number, number][],
    halfWidth: 0.4,
  },
  /** Stepping stones; index 2 is the "stone" place. */
  stones: [
    { x: 0.6, z: 2.32, rx: 0.2, rz: 0.15, yaw: 0.3 },
    { x: 0.86, z: 1.64, rx: 0.19, rz: 0.14, yaw: -0.4 },
    { x: 1.11, z: 0.95, rx: 0.2, rz: 0.14, yaw: 0.18 },
    { x: 1.44, z: 0.38, rx: 0.18, rz: 0.13, yaw: 0.7 },
    { x: 1.88, z: -0.14, rx: 0.19, rz: 0.13, yaw: -0.2 },
    { x: 2.42, z: -0.6, rx: 0.2, rz: 0.14, yaw: 0.5 },
  ] as Ellipse[],
  stoneThickness: 0.05,
  stoneRise: 0.016,
  /** The maple: a trunk off to the left and one long branch over the lawn. */
  maple: {
    trunk: { x: -3.05, z: 0.95, radius: 0.16 },
    /** The branch's centre line from the trunk outward, with radii. */
    branch: [
      { p: [-2.95, 1.78, 0.9] as V3, r: 0.07 },
      { p: [-2.2, 1.66, 0.74] as V3, r: 0.05 },
      { p: [-1.45, 1.42, 0.58] as V3, r: 0.034 },
      { p: [-0.92, 1.24, 0.47] as V3, r: 0.022 },
      { p: [-0.5, 1.12, 0.42] as V3, r: 0.012 },
    ],
    /** The leaf the fly shelters under: blade centre, upper-surface normal, size. */
    shelter: {
      center: [-0.6, 1.035, 0.405] as V3,
      normal: [0.14, 0.95, 0.28] as V3,
      /** Direction from the stalk toward the tip, in the blade's plane. */
      tip: [0.32, -0.28, 0.9] as V3,
      size: 0.105,
      twig: [-0.64, 1.16, 0.36] as V3,
    },
    /** The leaf whose sway the server tracks (`swaying_leaf`), at rest. */
    swaying: {
      center: [-0.7, 1.13, 0.46] as V3,
      normal: [-0.2, 0.92, 0.33] as V3,
      tip: [-0.35, -0.3, 0.88] as V3,
      size: 0.095,
      /** Where its stalk leaves the underside of the branch. */
      twig: [-0.75, 1.17, 0.45] as V3,
    },
  },
  /** Bed of soil and moss along the fence. */
  bed: { z0: -1.3, z1: -0.98 },
  /** Houses beyond the fence: out of focus at every lens. */
  beyond: { z: -7.5 },
} as const;

/** The server's 2D anchor of every place (`PLACES` in server.py). */
export const PLAN = {
  leaf: [0.29, 0.38],
  window: [0.82, 0.375],
  flowers: [0.68, 0.63],
  pear: [0.24, 0.79],
  water: [0.51, 0.83],
  fence: [0.13, 0.53],
  stone: [0.77, 0.85],
} as const;

/** The camera the garden is composed for: every place in view at 16:9. */
export const OBSERVATION = {
  position: [0.04, 0.74, 3.62] as V3,
  target: [0.06, 0.42, -0.32] as V3,
  fovDeg: 35,
};

// ---------------------------------------------------------------- the ground

const noise = seededNoise2D(GARDEN_SEED);

function segmentDistance(
  px: number,
  pz: number,
  a: [number, number],
  b: [number, number],
) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)),
  );
  return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t);
}

/** Distance from (x, z) to the path's centre line, metres. */
export function pathDistance(x: number, z: number): number {
  const p = LAYOUT.path.points;
  let d = Infinity;
  for (let i = 0; i + 1 < p.length; i++)
    d = Math.min(d, segmentDistance(x, z, p[i]!, p[i + 1]!));
  return d;
}

/** 1 on the gravel path, 0 on the lawn, a soft edge between. */
export function pathMask(x: number, z: number): number {
  const d = pathDistance(x, z) - LAYOUT.path.halfWidth;
  // A hand-cut edge: the boundary wanders a few centimetres.
  const edge = d + 0.035 * noise(x * 6.1, z * 6.1);
  return Math.max(0, Math.min(1, 0.5 - edge / 0.05));
}

/** 1 in the soil bed along the fence, 0 elsewhere. */
export function bedMask(x: number, z: number): number {
  if (x > LAYOUT.wall.x0 + 0.05) return 0;
  const edge = z - LAYOUT.bed.z1 + 0.03 * noise(x * 4.3 + 11, 7.1);
  return Math.max(0, Math.min(1, 0.5 - edge / 0.06));
}

/** Inside-ness of an ellipse in [0, 1+]: 0 at the centre, 1 on the outline. */
export function ellipseRadius(e: Ellipse, x: number, z: number): number {
  const c = Math.cos(e.yaw),
    s = Math.sin(e.yaw);
  const dx = x - e.x,
    dz = z - e.z;
  const u = (dx * c + dz * s) / e.rx,
    v = (-dx * s + dz * c) / e.rz;
  return Math.hypot(u, v);
}

/** Soil height before props press into it. */
function rawGround(x: number, z: number): number {
  let h =
    0.011 * noise(x * 0.8, z * 0.8) +
    0.005 * noise(x * 2.3 + 5.2, z * 2.3 - 3.1) +
    0.0016 * noise(x * 9.1 - 2, z * 9.1 + 4);
  h -= 0.007 * pathMask(x, z);
  h += 0.014 * bedMask(x, z) * (0.6 + 0.4 * noise(x * 3.3, z * 3.3 + 9));
  return h;
}

interface Pad {
  x: number;
  z: number;
  r: number;
  blend: number;
}
const PADS: Pad[] = [
  { x: LAYOUT.pot.x, z: LAYOUT.pot.z, r: LAYOUT.pot.rimRadius + 0.02, blend: 0.12 },
  { x: LAYOUT.saucer.x, z: LAYOUT.saucer.z, r: LAYOUT.saucer.radius + 0.01, blend: 0.1 },
  { x: LAYOUT.pear.x, z: LAYOUT.pear.z, r: 0.05, blend: 0.08 },
];

/**
 * The garden floor's height at (x, z): sculpted undulations, a sunken gravel
 * path, a mounded bed by the fence, and level seats under the props. Shared
 * by the terrain mesh, the props that sit on it and the fly's landings.
 */
export function groundHeight(x: number, z: number): number {
  let h = rawGround(x, z);
  for (const p of PADS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r + p.blend) {
      const flat = rawGround(p.x, p.z);
      const w = d <= p.r ? 1 : 1 - (d - p.r) / p.blend;
      h = h + (flat - h) * w * w * (3 - 2 * w);
    }
  }
  return h;
}

/** A stepping stone's top height at its centre. */
export function stoneTop(i: number): number {
  const s = LAYOUT.stones[i]!;
  return groundHeight(s.x, s.z) + LAYOUT.stoneRise + LAYOUT.stoneThickness * 0.62;
}

/** Height of whatever a fly would stand on at (x, z): ground, a stone, the saucer rim or the pot's soil. */
export function standingHeight(x: number, z: number): number {
  let h = groundHeight(x, z);
  LAYOUT.stones.forEach((s, i) => {
    if (ellipseRadius(s, x, z) < 0.92) h = Math.max(h, stoneTop(i));
  });
  const sc = LAYOUT.saucer;
  const ds = Math.hypot(x - sc.x, z - sc.z);
  if (ds < sc.radius) h = Math.max(h, groundHeight(sc.x, sc.z) + sc.height);
  const pot = LAYOUT.pot;
  if (Math.hypot(x - pot.x, z - pot.z) < pot.rimRadius)
    h = Math.max(h, groundHeight(pot.x, pot.z) + pot.soil);
  return h;
}
