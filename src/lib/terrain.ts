import {
  ALL_SEGMENTS,
  FLATTEN_PADS,
  APRONS,
  type SegmentDef,
} from "./layout";
import { SITE_SEED, seededNoise2D } from "./noise";

/**
 * Analytic terrain heightfield. The same function displaces the terrain mesh,
 * grounds the first-person camera and seats every structure, so everything
 * always agrees on where the ground is.
 */

const bigNoise = seededNoise2D(SITE_SEED);
const midNoise = seededNoise2D(SITE_SEED + 1);
const mottleNoise = seededNoise2D(SITE_SEED + 2);
const fineNoise = seededNoise2D(SITE_SEED + 3);
const gravelNoise = seededNoise2D(SITE_SEED + 4);
const wadiNoise = seededNoise2D(SITE_SEED + 5);

// Lop Nur sits on a dried lakebed / gobi plain: broad, nearly flat relief with
// shallow gravel swells, cut by braided dry-wash channels.
const BIG_FREQ = 1 / 1150;
const BIG_AMP = 2.4;
const MID_FREQ = 1 / 240;
const MID_AMP = 0.7;
const FINE_FREQ = 1 / 46;
const FINE_AMP = 0.28;

/** Extra flat margin beyond a segment's half-width, and the blend distance. */
const FLAT_MARGIN = 30;
const BLEND_DIST = 55;

interface PreparedSegment {
  ax: number;
  az: number;
  dx: number;
  dz: number;
  invLenSq: number;
  halfWidth: number;
}

const prepared: PreparedSegment[] = ALL_SEGMENTS.map((seg: SegmentDef) => {
  const [ax, az] = seg.from;
  const dx = seg.to[0] - ax;
  const dz = seg.to[1] - az;
  const lenSq = dx * dx + dz * dz;
  return { ax, az, dx, dz, invLenSq: lenSq > 0 ? 1 / lenSq : 0, halfWidth: seg.width / 2 };
});

const apronRects = APRONS.map((a) => ({
  cx: a.center[0],
  cz: a.center[1],
  cos: Math.cos(a.rotation),
  sin: Math.sin(a.rotation),
  hw: a.size[0] / 2,
  hd: a.size[1] / 2,
}));

function distToSegmentEdge(x: number, z: number, s: PreparedSegment): number {
  let t = ((x - s.ax) * s.dx + (z - s.az) * s.dz) * s.invLenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = s.ax + t * s.dx - x;
  const pz = s.az + t * s.dz - z;
  return Math.hypot(px, pz) - s.halfWidth;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 0 where the ground must be dead flat (under pavement), 1 in open desert,
 * smooth in between.
 */
export function flattenFactor(x: number, z: number): number {
  let minEdge = Infinity;
  for (const s of prepared) {
    const d = distToSegmentEdge(x, z, s);
    if (d < minEdge) minEdge = d;
    if (minEdge <= 0) return 0;
  }
  for (const r of apronRects) {
    const lx = (x - r.cx) * r.cos + (z - r.cz) * r.sin;
    const lz = -(x - r.cx) * r.sin + (z - r.cz) * r.cos;
    const dx = Math.abs(lx) - r.hw;
    const dz = Math.abs(lz) - r.hd;
    const d = Math.max(dx, dz);
    if (d < minEdge) minEdge = d;
    if (minEdge <= 0) return 0;
  }
  for (const p of FLATTEN_PADS) {
    const d = Math.hypot(x - p.center[0], z - p.center[1]) - p.radius;
    if (d < minEdge) minEdge = d;
    if (minEdge <= 0) return 0;
  }
  return smoothstep(FLAT_MARGIN, FLAT_MARGIN + BLEND_DIST, minEdge);
}

/** Raw lakebed/gobi relief before flattening. */
export function rawHeight(x: number, z: number): number {
  // dry-wash channels: incise a little where the ridged wadi field is near zero
  const w = Math.abs(wadiNoise(x / 620, z / 620));
  const channel = -Math.max(0, 0.16 - w) * 6;
  return (
    bigNoise(x * BIG_FREQ, z * BIG_FREQ) * BIG_AMP +
    midNoise(x * MID_FREQ, z * MID_FREQ) * MID_AMP +
    fineNoise(x * FINE_FREQ, z * FINE_FREQ) * FINE_AMP +
    channel
  );
}

/** Final terrain height at a world position. */
export function terrainHeight(x: number, z: number): number {
  return rawHeight(x, z) * flattenFactor(x, z);
}

/** Slow color-mottling channel used for vertex colors, in [-1, 1]. */
export function mottle(x: number, z: number): number {
  return (
    mottleNoise(x / 260, z / 260) * 0.4 + mottleNoise(x / 47, z / 47) * 0.6
  );
}

/** Gobi gravel-field mask in [0, 1]: broad darker desert-pavement patches. */
export function gravelField(x: number, z: number): number {
  const g = gravelNoise(x / 560, z / 560) * 0.65 + gravelNoise(x / 150, z / 150) * 0.35;
  return Math.min(1, Math.max(0, (g - 0.06) * 1.5));
}

/** Dry-wash channel mask in [0, 1]: 1 in the braided wadi lines. */
export function wadiMask(x: number, z: number): number {
  const w = Math.abs(wadiNoise(x / 620, z / 620));
  return Math.min(1, Math.max(0, (0.14 - w) / 0.14));
}
