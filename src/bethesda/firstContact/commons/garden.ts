/**
 * The garden commons: Eva's sculpted garden as a physical world a research
 * fly can live in, built from the same true-scale layout her exhibit page
 * draws (`src/garden/core/layout.ts`), so the place where two research
 * subjects meet is the place visitors see her in.
 *
 * Research only (see `docs/FIRST_CONTACT.md`, "The commons"). Nothing in
 * production reads this, and the garden's own simulation (her service) knows
 * nothing of it: her world is an abstract 2D plane, and every height,
 * surface and solid here is this module's interpretation of the layout,
 * named in `GARDEN_COMMONS_APPROXIMATIONS`.
 *
 * What is solid: the cedar fence and the house wall, the windowsill, the
 * pot of asters (soil top, a stem, one flower head with nectar), the fallen
 * pear (two spheres: body and neck, with its bruised sweet edge as food),
 * the rain saucer, the stepping stones, the maple's trunk and the leaf the
 * garden's fly shelters under. The lawn's undulations are the layout's own
 * `groundHeight`.
 */
import { LAYOUT, groundHeight, stoneTop } from "../../../garden/core/layout.js";
import type { V3 } from "../../fly/units.js";
import {
  PrimitiveWorld,
  type Box,
  type Cylinder,
  type FoodPatch,
  type Prism,
  type Sphere,
  type WorldInputs,
} from "../../fly/world.js";

export const GARDEN_COMMONS_SCHEMA = "first-contact-garden-commons/v1" as const;

export const GARDEN_COMMONS_INPUTS: WorldInputs = {
  supported: [
    "the garden's ground, fence, house wall, windowsill, pot, saucer, stones, pear, maple trunk and shelter leaf, at the layout's true scale",
    "food: the pear's bruised edge and the aster's nectar, smelt from a distance and eaten standing on them",
    "sun and sky light",
  ],
  proxies: [
    "light level: relative units (sun over ambient), not lux",
    "odour: the fly world's still-air proxy (ODOUR_LENGTH_M), not a plume",
  ],
  unsupported: ["wind", "rain", "temperature", "humidity", "water to drink"],
};

export const GARDEN_COMMONS_APPROXIMATIONS = Object.freeze([
  "Eva's garden is an abstract 2D plane; this 3D garden is the exhibit page's interpretation of it (src/garden/core/layout.ts), not her simulation's world",
  "the pear is two spheres (body and neck), not the layout's ellipsoid; its bruise is a food patch on the body's surface",
  "the pot of asters is a tapered cylinder of soil with one stem and one flower head; the mound of other flowers is not modelled",
  "stepping stones are 16-sided prisms; the maple branch is not modelled, only its trunk and the shelter leaf (a flat blade)",
  "the saucer is solid to its brim: there is no water surface, and the digital fly does not drink",
  "still air: no wind, no rain",
]);

/** Highest point of the sculpted lawn (m): above every value `groundHeight` takes. */
const GROUND_MAX_M = 0.05;

function ellipseRing(
  e: { x: number; z: number; rx: number; rz: number; yaw: number },
  n = 16,
) {
  const c = Math.cos(e.yaw),
    s = Math.sin(e.yaw);
  const ring: { x: number; z: number }[] = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    const u = e.rx * Math.cos(a),
      v = e.rz * Math.sin(a);
    // The layout's ellipseRadius rotates by +yaw: (dx·c + dz·s, −dx·s + dz·c).
    ring.push({ x: e.x + u * c - v * s, z: e.z + u * s + v * c });
  }
  return ring;
}

function bounds(ring: { x: number; z: number }[]) {
  return {
    min: { x: Math.min(...ring.map((p) => p.x)), z: Math.min(...ring.map((p) => p.z)) },
    max: { x: Math.max(...ring.map((p) => p.x)), z: Math.max(...ring.map((p) => p.z)) },
  };
}

function normalize(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** The pear's body: centre and radius (m). */
export function pearBody(): { center: V3; r: number } {
  const p = LAYOUT.pear;
  const g = groundHeight(p.x, p.z);
  return { center: [p.x, g + p.radius, p.z], r: p.radius };
}

/** The food patches of the garden commons. */
export function gardenFood(): FoodPatch[] {
  const pear = pearBody();
  const bruise = normalize([...LAYOUT.pear.bruise] as V3);
  const aster = LAYOUT.heroAster.center;
  return [
    {
      id: "pear-bruise",
      kind: "fallen pear, bruised and fermenting",
      center: [
        pear.center[0] + bruise[0] * pear.r,
        pear.center[1] + bruise[1] * pear.r,
        pear.center[2] + bruise[2] * pear.r,
      ],
      surface: "obstacle",
      radius: 0.012,
    },
    {
      id: "aster-nectar",
      kind: "late aster flower head",
      center: [aster[0], aster[1], aster[2]],
      surface: "obstacle",
      radius: LAYOUT.heroAster.discRadius + LAYOUT.heroAster.rayLength * 0.5,
    },
  ];
}

/** Eva's garden as a fly world, deterministic and built from the layout alone. */
export function gardenCommonsWorld(id = "garden-commons"): PrimitiveWorld {
  const L = LAYOUT;
  const g = L.ground;
  const boxes: Box[] = [];
  const fence = L.fence;
  boxes.push({
    kind: "wall",
    id: "cedar-fence",
    // From below the lawn to the boards' tops: the gap under them is not modelled.
    center: [
      (fence.x0 + fence.x1) / 2,
      fence.height / 2,
      fence.front - fence.thickness / 2,
    ],
    half: [(fence.x1 - fence.x0) / 2, fence.height / 2, fence.thickness / 2],
    angle: 0,
  });
  const wall = L.wall;
  boxes.push({
    kind: "wall",
    id: "house-wall",
    center: [(wall.x0 + wall.x1) / 2, wall.height / 2, wall.front - 0.1],
    half: [(wall.x1 - wall.x0) / 2, wall.height / 2, 0.1],
    angle: 0,
  });
  const sill = L.window.sill;
  boxes.push({
    kind: "table",
    id: "windowsill",
    center: [
      (sill.x0 + sill.x1) / 2,
      sill.top - sill.thickness / 2,
      wall.front + sill.depth / 2,
    ],
    half: [(sill.x1 - sill.x0) / 2, sill.thickness / 2, sill.depth / 2],
    angle: 0,
  });
  const leaf = L.maple.shelter;
  boxes.push({
    kind: "obstacle",
    id: "shelter-leaf",
    center: [leaf.center[0], leaf.center[1], leaf.center[2]],
    half: [leaf.size / 2, 0.0008, leaf.size * 0.32],
    angle: Math.atan2(-leaf.tip[2], leaf.tip[0]),
  });

  const pot = L.pot;
  const potGround = groundHeight(pot.x, pot.z);
  const soilTop = potGround + pot.soil;
  const aster = L.heroAster;
  const sc = L.saucer;
  const saucerGround = groundHeight(sc.x, sc.z);
  const trunk = L.maple.trunk;
  const cylinders: Cylinder[] = [
    {
      kind: "obstacle",
      id: "aster-pot",
      x: pot.x,
      z: pot.z,
      r: pot.baseRadius,
      r1: pot.rimRadius,
      y0: potGround - 0.02,
      y1: soilTop,
    },
    {
      kind: "pole",
      id: "aster-stem",
      x: aster.center[0],
      z: aster.center[2],
      r: 0.0015,
      y0: soilTop,
      y1: aster.center[1] - 0.002,
    },
    {
      kind: "obstacle",
      id: "aster-head",
      x: aster.center[0],
      z: aster.center[2],
      r: aster.discRadius + aster.rayLength,
      y0: aster.center[1] - 0.002,
      y1: aster.center[1],
    },
    {
      kind: "obstacle",
      id: "rain-saucer",
      x: sc.x,
      z: sc.z,
      r: sc.base,
      r1: sc.radius,
      y0: saucerGround - 0.01,
      y1: saucerGround + sc.height,
    },
    {
      kind: "pole",
      id: "maple-trunk",
      x: trunk.x,
      z: trunk.z,
      r: trunk.radius,
      y0: groundHeight(trunk.x, trunk.z) - 0.05,
      y1: L.maple.branch[0].p[1],
    },
  ];

  const pear = pearBody();
  const neckDir: V3 = [Math.cos(L.pear.yaw), 0, -Math.sin(L.pear.yaw)];
  const neckOffset = L.pear.length / 2 - L.pear.neckRadius;
  const spheres: Sphere[] = [
    { kind: "obstacle", id: "pear-body", center: pear.center, r: pear.r },
    {
      kind: "obstacle",
      id: "pear-neck",
      center: [
        pear.center[0] + neckDir[0] * neckOffset,
        groundHeight(
          pear.center[0] + neckDir[0] * neckOffset,
          pear.center[2] + neckDir[2] * neckOffset,
        ) + L.pear.neckRadius,
        pear.center[2] + neckDir[2] * neckOffset,
      ],
      r: L.pear.neckRadius,
    },
  ];

  const prisms: Prism[] = L.stones.map((s, i) => {
    const ring = ellipseRing(s);
    return {
      kind: "obstacle",
      id: `stepping-stone-${i}`,
      ring,
      y0: groundHeight(s.x, s.z) - 0.02,
      y1: stoneTop(i),
      ...bounds(ring),
    };
  });

  return new PrimitiveWorld({
    id,
    home: {
      center: [(g.minX + g.maxX) / 2, 0, (g.minZ + g.maxZ) / 2],
      radius: Math.min(g.maxX - g.minX, g.maxZ - g.minZ) / 2,
      ceiling: 3,
      bounds: { min: { x: g.minX, z: g.minZ }, max: { x: g.maxX, z: g.maxZ } },
    },
    inputs: GARDEN_COMMONS_INPUTS,
    ground: groundHeight,
    groundMax: GROUND_MAX_M,
    groundKind: "ground",
    boxes,
    cylinders,
    spheres,
    prisms,
    ambient: 0.35,
    // A low November sun from the south-west, over the observation camera's shoulder.
    sun: { toward: normalize([-0.45, 0.5, 0.74]), level: 1, shade: 0.4 },
    food: gardenFood(),
  });
}
