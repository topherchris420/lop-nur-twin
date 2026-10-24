/**
 * Street furniture, trees and the sun the city is lit by: the one place their
 * sizes and placements are written down. The mapped items (OSM benches, picnic
 * tables, lamps and trees) are drawn by `landmarks.ts`; the procedural ones
 * (footpath trees, and the lamps, benches and planters along the Row's
 * sidewalks) by `geometry.ts` and `detail.ts`, as are the rooftop units and
 * shop awnings on the buildings; `Atmosphere.tsx` places its light from
 * `SUN`. The digital fly (`fly/bethesdaWorld.ts`) lands on, bumps into and is
 * shaded by the same numbers, so what it touches is what is drawn.
 *
 * Heights are above the ground at the item's own point (the city builder lifts
 * each piece onto `groundAt` of its centre). The sizes are illustrative: OSM
 * maps where a bench or lamp is, not its dimensions, and the procedural items
 * are not mapped at all.
 */
import { mulberry32 } from "../lib/noise";
import {
  buildingAt,
  buildings,
  distance,
  lerp,
  pathWays,
  row,
  type Building,
  type Point,
} from "./model";

/** A box as the city builder takes it: centre height, width (x), height, depth (z). */
export interface BoxSize {
  y: number;
  w: number;
  h: number;
  d: number;
}

export const LAMP = {
  poleBottomRadius: 0.09,
  poleTopRadius: 0.055,
  poleHeight: 4.6,
  globeRadius: 0.23,
  /** Vertical stretch of the globe sphere. */
  globeStretch: 1.45,
  globeY: 4.9,
} as const;

export const BENCH = {
  seat: { y: 0.48, w: 1.6, h: 0.07, d: 0.45 },
  /** The back, offset along z from the bench point. */
  back: { y: 0.8, w: 1.6, h: 0.45, d: 0.06, dz: -0.22 },
} as const;

export const PICNIC_TABLE = {
  top: { y: 0.75, w: 1.8, h: 0.06, d: 0.8 },
  /** The two seats, either side along z. */
  seat: { y: 0.45, w: 1.8, h: 0.05, d: 0.3, dz: 0.65 },
} as const;

export interface TreeShape {
  trunkHeight: number;
  trunkBottomRadius: number;
  trunkTopRadius: number;
  /** Crown blobs: offsets from the tree point, centre height above ground, radius. */
  crowns: { dx: number; y: number; dz: number; r: number }[];
}

/** A mapped tree's procedural shape, drawn from its OSM id in a fixed order. */
export function treeShape(osmId: string): TreeShape {
  const r = mulberry32(Number(osmId) % 2147483647);
  const trunkHeight = 4 + r() * 3;
  const crowns = [];
  for (let k = 0; k < 5; k++) {
    const radius = 1.4 + r() * 0.7;
    crowns.push({
      dx: Math.cos(k * 1.3) * 1.1,
      y: trunkHeight + 0.4 + r(),
      dz: Math.sin(k * 1.3) * 1.1,
      r: radius,
    });
  }
  return { trunkHeight, trunkBottomRadius: 0.28, trunkTopRadius: 0.16, crowns };
}

/**
 * The sun: where it sits relative to the point it lights (m), and its light
 * intensity in clear weather and in a storm. Bethesda has no day or night.
 */
export const SUN = {
  offset: { x: -160, y: 230, z: 100 },
  clearIntensity: 3.2,
  stormIntensity: 0.7,
} as const;

export const STREET_TREE = { trunkTopRadius: 0.15, trunkBottomRadius: 0.25 } as const;

/** A procedural footpath tree. Crown blobs are spheres stretched vertically. */
export interface StreetTree {
  point: Point;
  trunkHeight: number;
  /** Near Bethesda Row: seven smaller blobs with leaf cards and limbs, not three. */
  close: boolean;
  crowns: {
    x: number;
    z: number;
    /** Centre height above the ground. */
    y: number;
    r: number;
    stretch: number;
    /** Tilts of the crown's leaf cards (close trees only). */
    leafTilts: number[];
  }[];
}

let trees: readonly StreetTree[] | null = null;
/**
 * The procedural trees planted along footpaths: every 30 m, 2.5 m to one side,
 * at least 14 m apart, never inside a building. Every random draw is made in
 * the order the city builder has always made it, so the city looks as it did.
 */
export function streetTrees(): readonly StreetTree[] {
  if (trees) return trees;
  const rng = mulberry32(393977);
  const planted: StreetTree[] = [];
  for (const w of pathWays) {
    if (w.crossing) continue;
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1]!,
        b = w.points[i]!,
        d = distance(a, b),
        heading = Math.atan2(b.x - a.x, b.z - a.z);
      for (let t = 10; t < d; t += 30) {
        const p = lerp(a, b, t / d);
        p.x += Math.cos(heading) * 2.5;
        p.z -= Math.sin(heading) * 2.5;
        if (buildingAt(p) || planted.some((v) => distance(v.point, p) < 14)) continue;
        const trunkHeight = 4.5 + rng() * 3;
        const close = distance(p, row.point) < 240;
        const crowns: StreetTree["crowns"] = [];
        for (let branch = 0; branch < (close ? 7 : 3); branch++) {
          const angle = branch * 2.4,
            radius = close ? 1.6 : 1;
          const r = close ? 1.1 : 1.6 + rng() * 0.8;
          const stretch = 0.85 + rng() * 0.3;
          const y = trunkHeight + 0.6 + rng() * 1.2;
          const leafTilts = [];
          if (close) for (let k = 0; k < 3; k++) leafTilts.push((rng() - 0.5) * 0.8);
          crowns.push({
            x: p.x + Math.cos(angle) * radius,
            z: p.z + Math.sin(angle) * radius,
            y,
            r,
            stretch,
            leafTilts,
          });
        }
        planted.push({ point: p, trunkHeight, close, crowns });
      }
    }
  }
  trees = planted;
  return trees;
}

/** The procedural sidewalk lamp near Bethesda Row. */
export const STREET_LAMP = {
  poleTopRadius: 0.055,
  poleBottomRadius: 0.09,
  poleHeight: 4.6,
  base: { y: 0.22, w: 0.26, h: 0.44, d: 0.26 },
  collar: { y: 4.55, w: 0.46, h: 0.12, d: 0.46 },
  globeRadius: 0.23,
  globeStretch: 1.45,
  globeY: 4.91,
  cap: { y: 5.23, w: 0.35, h: 0.1, d: 0.35 },
} as const;

/**
 * The slatted bench beside every second sidewalk lamp. Sizes are in the
 * bench's own frame (rotated by the path's angle): x across the seat, z along it.
 */
export const STREET_BENCH = {
  /** From its lamp, along the path. */
  offset: 2.1,
  slats: 4,
  /** Slats sit at (k − 0.5) × pitch across the seat, k = 0…3. */
  slatPitch: 0.09,
  slat: { y: 0.51, w: 0.075, h: 0.055, d: 1.65 },
  /** The two end frames, ± spread along the seat. */
  leg: { y: 0.26, w: 0.38, h: 0.48, d: 0.07 },
  legSpread: 0.63,
  back: { y: 0.85, w: 0.07, h: 0.5, d: 1.65 },
  backOffset: 0.23,
} as const;

/** The planter beyond each sidewalk bench, with a shrub. */
export const PLANTER = {
  /** From the bench, along the path. */
  offset: 1.75,
  body: { y: 0.42, w: 0.7, h: 0.7, d: 0.7 },
  rim: { y: 0.79, w: 0.72, h: 0.08, d: 0.72 },
  soil: { y: 0.82, w: 0.6, h: 0.02, d: 0.6 },
  shrubRadius: 0.38,
  shrubStretch: 0.8,
  shrubY: 1.02,
} as const;

/** A procedural sidewalk lamp, and the bench (and planter) beside it if it has one. */
export interface StreetLamp {
  point: Point;
  /** The path's heading, which the bench is aligned to. */
  angle: number;
  bench: { point: Point; planter: Point | null } | null;
}

let lamps: readonly StreetLamp[] | null = null;
/**
 * The procedural lamps along footpaths within 220 m of Bethesda Row: every
 * 24 m at the path's edge, at least 17 m apart, never inside a building; every
 * second one has a bench, and the bench a planter where neither is inside a
 * building.
 */
export function streetLamps(): readonly StreetLamp[] {
  if (lamps) return lamps;
  const placed: StreetLamp[] = [];
  for (const way of pathWays) {
    if (way.crossing) continue;
    for (let i = 1; i < way.points.length; i++) {
      const a = way.points[i - 1]!,
        b = way.points[i]!,
        length = distance(a, b);
      if (distance(lerp(a, b, 0.5), row.point) > 220 || length < 8) continue;
      const angle = Math.atan2(b.x - a.x, b.z - a.z);
      for (let t = 6; t < length; t += 24) {
        const p = lerp(a, b, t / length);
        p.x += Math.cos(angle) * (way.width / 2 + 0.35);
        p.z -= Math.sin(angle) * (way.width / 2 + 0.35);
        if (buildingAt(p) || placed.some((q) => distance(p, q.point) < 17)) continue;
        const lamp: StreetLamp = { point: p, angle, bench: null };
        placed.push(lamp);
        if (placed.length % 2 !== 0) continue;
        const q = {
          x: p.x + Math.sin(angle) * STREET_BENCH.offset,
          z: p.z + Math.cos(angle) * STREET_BENCH.offset,
        };
        if (buildingAt(q)) continue;
        const planter = {
          x: q.x + Math.sin(angle) * PLANTER.offset,
          z: q.z + Math.cos(angle) * PLANTER.offset,
        };
        lamp.bench = { point: q, planter: buildingAt(planter) ? null : planter };
      }
    }
  }
  lamps = placed;
  return lamps;
}

/**
 * The buildings drawn with facade detail (`detail.ts`): the arrival blocks, so
 * the expensive silhouette and frame geometry stays local to them.
 */
export const detailedBuildings = new Set(
  buildings
    .filter(
      (b) =>
        distance(b.center, row.point) < 205 && !["house", "detached"].includes(b.type),
    )
    .map((b) => b.id),
);

/**
 * A box `geometry.ts` draws on a building: centred on `point`, `y` above the
 * building's base (the ground at its centre), `w` wide along its own x once
 * turned by `angle` about +y (Three's rotateY), `h` high and `d` deep.
 */
export interface BuildingBox {
  point: Point;
  y: number;
  w: number;
  h: number;
  d: number;
  angle: number;
}

/** The rooftop plant on a building over 14 m tall, on its centre. */
export function rooftopUnit(b: Building): BuildingBox | null {
  return b.height > 14 && buildingAt(b.center)?.id === b.id
    ? { point: b.center, y: b.height + 0.6, w: 3.5, h: 1.2, d: 2.5, angle: 0 }
    : null;
}

/**
 * The shop awnings on a plain building under 18 m (not a house, and not one
 * of the detailed blocks): one along the middle 65 % of every wall 10–65 m
 * long, 3.3 m up, centred on the wall line, so it reaches 0.6 m out.
 */
export function awnings(b: Building): BuildingBox[] {
  const out: BuildingBox[] = [];
  if (
    detailedBuildings.has(b.id) ||
    !(b.height < 18) ||
    ["house", "detached"].includes(b.type)
  )
    return out;
  for (let i = 1; i < b.ring.length; i++) {
    const a = b.ring[i - 1]!,
      e = b.ring[i]!,
      d = distance(a, e);
    if (d > 10 && d < 65)
      out.push({
        point: lerp(a, e, 0.5),
        y: 3.3,
        w: d * 0.65,
        h: 0.18,
        d: 1.2,
        angle: Math.atan2(e.x - a.x, e.z - a.z) + Math.PI / 2,
      });
  }
  return out;
}
