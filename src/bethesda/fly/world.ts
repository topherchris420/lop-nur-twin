/**
 * What a digital fly can sense and touch, as an interface every place it can
 * live in implements: the Bethesda city (`bethesdaWorld.ts`) and the R.A.I.N.
 * Lab's experiment arenas (`arena.ts`).
 *
 * A world is read-only to the fly. It answers geometric questions (what is
 * solid, where can a fly stand, what does a ray hit), lists what moves, and
 * gives a light level. Moving things are seen, never touched: they loom and
 * block the view, but no ray, solidity or perch test includes them, so they
 * pass through the fly. Anything a world cannot provide is named in `inputs`
 * so the inspection panel can say so instead of inventing it. A ray or perch
 * query with a non-finite input finds nothing (and a non-finite point counts
 * as solid) rather than looping or throwing.
 *
 * `PrimitiveWorld` builds a world from boxes, upright cylinders (tapered or
 * not), spheres (or ellipsoids squashed or stretched vertically), extruded
 * polygons (with holes, such as courtyards) and a ground function. Metres,
 * world frame (+x east, +y up, +z south).
 */
import { type V3 } from "./units.js";

export type SurfaceKind =
  | "ground"
  | "floor"
  | "roof"
  | "wall"
  | "glass"
  | "table"
  | "bench"
  | "lamp"
  | "pole"
  | "obstacle";

/**
 * A surface the fly may stand on is no steeper than this: its normal's
 * vertical component is at least this much (a model choice).
 */
export const WALKABLE_NORMAL_Y = 0.7;

/** Surfaces the fly may stand and walk on (horizontal tops). */
export const WALKABLE: ReadonlySet<SurfaceKind> = new Set([
  "ground",
  "floor",
  "roof",
  "table",
  "bench",
  "lamp",
  "obstacle",
]);

export interface Hit {
  t: number;
  point: V3;
  normal: V3;
  kind: SurfaceKind;
  id: string;
}
export interface Perch {
  y: number;
  kind: SurfaceKind;
  id: string;
}
export type MoverKind = "person" | "vehicle" | "player" | "stimulus";
export interface Mover {
  id: string;
  kind: MoverKind;
  center: V3;
  radius: number;
}
export interface LightSample {
  /** Relative illuminance proxy: 1 is open daylight in the city. Not lux. */
  level: number;
  /** Unit direction toward the strongest contribution, or null if none dominates. */
  toward: V3 | null;
}
/**
 * A top a fly may land on. Every point of its rectangle (centre ± `half`,
 * rotated by `angle`) at the centre's height lies within
 * `LANDING_SITE_FLATNESS_M` of the real surface: a box or cylinder top
 * exactly, the crown of a sphere within that tolerance.
 */
export interface LandingSite {
  id: string;
  kind: SurfaceKind;
  center: V3;
  /** Half extents of the usable top along x and z (after rotation by `angle`). */
  half: [number, number];
  angle: number;
  /**
   * Set on the one site the fly itself adds: the point of the surface
   * directly under it (zero extent), so a fly that sees no top can descend.
   */
  below?: boolean;
}
/** How far a landing site's flat rectangle may stand off the surface it stands for (m). */
export const LANDING_SITE_FLATNESS_M = 0.002;
export interface Home {
  center: V3;
  radius: number;
  ceiling: number;
}
export interface WorldInputs {
  supported: string[];
  proxies: string[];
  unsupported: string[];
}

export interface FlyWorld {
  readonly id: string;
  readonly home: Home;
  readonly inputs: WorldInputs;
  /**
   * The highest walkable top whose footprint holds (x, z) and lies at or
   * below `maxY`. Like `raycast` and `solid`, it covers static geometry only:
   * moving things are seen (`movers`), never touched.
   */
  perchAt(x: number, z: number, maxY: number): Perch | null;
  /** The nearest static surface along `dir` (unit) within `maxT`. `visible` skips glass. */
  raycast(origin: V3, dir: V3, maxT: number, visible?: boolean): Hit | null;
  /** True if the point is inside something solid (or below the ground). */
  solid(p: V3): boolean;
  /**
   * Moving things within `radius` of `near` at fly time `t` (s), appended to
   * `out` in a stable order. A world that updates in ticks interpolates.
   * They are for the eyes only: nothing the fly does collides with them.
   */
  movers(near: V3, radius: number, out: Mover[], t: number): void;
  light(p: V3): LightSample;
  /** Candidate tops to land on within `radius`, in a stable order. */
  landingSites(near: V3, radius: number, out: LandingSite[]): void;
}

// --- Primitives ------------------------------------------------------------

export interface Box {
  kind: SurfaceKind;
  id: string;
  center: V3;
  /** Half extents along local x, y, z. */
  half: V3;
  /** Rotation about +y, radians (Three's rotateY). */
  angle: number;
}
export interface Cylinder {
  kind: SurfaceKind;
  id: string;
  x: number;
  z: number;
  /** Radius at the base, `y0`. */
  r: number;
  /** Radius at the top, `y1`, of a tapered one (a cone cut flat); `r` if absent. */
  r1?: number;
  y0: number;
  y1: number;
}
export interface Sphere {
  kind: SurfaceKind;
  id: string;
  center: V3;
  /** Horizontal radius. */
  r: number;
  /**
   * Vertical semi-axis over `r`: an ellipsoid squashed (below 1) or stretched
   * (above 1) vertically, as the renderer scales a sphere's height; 1 if absent.
   */
  stretch?: number;
}
export interface Prism {
  kind: SurfaceKind;
  id: string;
  ring: { x: number; z: number }[];
  /** Rings cut out of the footprint all the way up (courtyards), walled like the outside. */
  holes?: { x: number; z: number }[][];
  y0: number;
  y1: number;
  /** Footprint bounds, for culling. */
  min: { x: number; z: number };
  max: { x: number; z: number };
}
export interface PointLight {
  at: V3;
  /** Proxy illuminance at 1 m. */
  intensity: number;
}

const EPS = 1e-9;

export function rayBox(o: V3, d: V3, b: Box, maxT: number): Hit | null {
  // Into the box's frame: rotate by −angle about y.
  const c = Math.cos(b.angle),
    s = Math.sin(b.angle);
  const rx = o[0] - b.center[0],
    ry = o[1] - b.center[1],
    rz = o[2] - b.center[2];
  // Three's rotateY(θ): x' = x cosθ + z sinθ, z' = −x sinθ + z cosθ; inverse uses −θ.
  const lo: V3 = [rx * c - rz * s, ry, rx * s + rz * c];
  const ld: V3 = [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c];
  let tmin = -Infinity,
    tmax = Infinity,
    axis = -1,
    sign = 0;
  for (let k = 0; k < 3; k++) {
    const h = b.half[k]!;
    if (Math.abs(ld[k]!) < EPS) {
      if (lo[k]! < -h || lo[k]! > h) return null;
      continue;
    }
    let t1 = (-h - lo[k]!) / ld[k]!,
      t2 = (h - lo[k]!) / ld[k]!;
    let sg = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      sg = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = k;
      sign = sg;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmin < 0 || tmin > maxT || axis < 0) return null;
  const ln: V3 = [0, 0, 0];
  ln[axis] = sign;
  // Back to world: rotate by +angle.
  const normal: V3 = [ln[0] * c + ln[2] * s, ln[1], -ln[0] * s + ln[2] * c];
  return {
    t: tmin,
    point: [o[0] + d[0] * tmin, o[1] + d[1] * tmin, o[2] + d[2] * tmin],
    normal,
    kind: b.kind,
    id: b.id,
  };
}

export function insideBox(p: V3, b: Box): boolean {
  const c = Math.cos(b.angle),
    s = Math.sin(b.angle);
  const rx = p[0] - b.center[0],
    rz = p[2] - b.center[2];
  const lx = rx * c - rz * s,
    lz = rx * s + rz * c;
  return (
    Math.abs(lx) <= b.half[0] &&
    Math.abs(p[1] - b.center[1]) <= b.half[1] &&
    Math.abs(lz) <= b.half[2]
  );
}

export function rayCylinder(o: V3, d: V3, cy: Cylinder, maxT: number): Hit | null {
  if (cy.r1 !== undefined && cy.r1 !== cy.r) return rayFrustum(o, d, cy, cy.r1, maxT);
  let best: Hit | null = null;
  const ox = o[0] - cy.x,
    oz = o[2] - cy.z;
  const a = d[0] * d[0] + d[2] * d[2];
  if (a > EPS) {
    const b = ox * d[0] + oz * d[2];
    const c = ox * ox + oz * oz - cy.r * cy.r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      const y = o[1] + d[1] * t;
      if (t >= 0 && t <= maxT && y >= cy.y0 && y <= cy.y1) {
        const px = ox + d[0] * t,
          pz = oz + d[2] * t;
        best = {
          t,
          point: [o[0] + d[0] * t, y, o[2] + d[2] * t],
          normal: [px / cy.r, 0, pz / cy.r],
          kind: cy.kind,
          id: cy.id,
        };
      }
    }
  }
  if (Math.abs(d[1]) > EPS)
    for (const [y, ny] of [
      [cy.y1, 1],
      [cy.y0, -1],
    ] as const) {
      const t = (y - o[1]) / d[1];
      if (t < 0 || t > maxT || (best && t >= best.t)) continue;
      const px = ox + d[0] * t,
        pz = oz + d[2] * t;
      if (px * px + pz * pz <= cy.r * cy.r)
        best = {
          t,
          point: [o[0] + d[0] * t, y, o[2] + d[2] * t],
          normal: [0, ny, 0],
          kind: cy.kind,
          id: cy.id,
        };
    }
  return best;
}

/**
 * A tapered cylinder: the side is the cone through the base circle (radius
 * `r` at `y0`) and the top circle (`r1` at `y1`). As for the straight one, a
 * ray that starts inside meets only the ends.
 */
function rayFrustum(o: V3, d: V3, cy: Cylinder, r1: number, maxT: number): Hit | null {
  let best: Hit | null = null;
  // Radius gained per metre up, and the radius along the ray: A + B t.
  const k = (r1 - cy.r) / (cy.y1 - cy.y0);
  const ox = o[0] - cy.x,
    oz = o[2] - cy.z;
  const A = cy.r + k * (o[1] - cy.y0),
    B = k * d[1];
  // The side: (ox + dx t)² + (oz + dz t)² = (A + B t)², entered where the
  // distance from the axis falls through the radius.
  const a = d[0] * d[0] + d[2] * d[2] - B * B;
  const b = ox * d[0] + oz * d[2] - A * B;
  const c = ox * ox + oz * oz - A * A;
  let t = NaN;
  if (Math.abs(a) > EPS) {
    const disc = b * b - a * c;
    if (disc >= 0) t = (-b - Math.sqrt(disc)) / a;
  } else if (b < 0) t = -c / (2 * b);
  if (t >= 0 && t <= maxT) {
    const y = o[1] + d[1] * t;
    const R = A + B * t;
    if (y >= cy.y0 && y <= cy.y1 && R > 0) {
      const n = Math.hypot(1, k);
      best = {
        t,
        point: [o[0] + d[0] * t, y, o[2] + d[2] * t],
        normal: [(ox + d[0] * t) / R / n, -k / n, (oz + d[2] * t) / R / n],
        kind: cy.kind,
        id: cy.id,
      };
    }
  }
  if (Math.abs(d[1]) > EPS)
    for (const [y, ny, rr] of [
      [cy.y1, 1, r1],
      [cy.y0, -1, cy.r],
    ] as const) {
      const te = (y - o[1]) / d[1];
      if (te < 0 || te > maxT || (best && te >= best.t)) continue;
      const px = ox + d[0] * te,
        pz = oz + d[2] * te;
      if (px * px + pz * pz <= rr * rr)
        best = {
          t: te,
          point: [o[0] + d[0] * te, y, o[2] + d[2] * te],
          normal: [0, ny, 0],
          kind: cy.kind,
          id: cy.id,
        };
    }
  return best;
}

/** Is the point inside the (possibly tapered) cylinder? */
export function insideCylinder(p: V3, c: Cylinder): boolean {
  if (p[1] < c.y0 || p[1] > c.y1) return false;
  const R =
    c.r1 === undefined || c.r1 === c.r
      ? c.r
      : c.r + ((c.r1 - c.r) * (p[1] - c.y0)) / (c.y1 - c.y0);
  return (p[0] - c.x) ** 2 + (p[2] - c.z) ** 2 <= R * R;
}

export function raySphere(o: V3, d: V3, s: Sphere, maxT: number): Hit | null {
  if (s.stretch !== undefined && s.stretch !== 1)
    return rayEllipsoid(o, d, s, s.stretch, maxT);
  const ox = o[0] - s.center[0],
    oy = o[1] - s.center[1],
    oz = o[2] - s.center[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const c = ox * ox + oy * oy + oz * oz - s.r * s.r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxT) return null;
  const point: V3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  return {
    t,
    point,
    normal: [
      (point[0] - s.center[0]) / s.r,
      (point[1] - s.center[1]) / s.r,
      (point[2] - s.center[2]) / s.r,
    ],
    kind: s.kind,
    id: s.id,
  };
}

/** A sphere stretched vertically by `st`: solved as the sphere it is with heights divided by `st`. */
function rayEllipsoid(o: V3, d: V3, s: Sphere, st: number, maxT: number): Hit | null {
  const ox = o[0] - s.center[0],
    oy = (o[1] - s.center[1]) / st,
    oz = o[2] - s.center[2];
  const dy = d[1] / st;
  const a = d[0] * d[0] + dy * dy + d[2] * d[2];
  const b = ox * d[0] + oy * dy + oz * d[2];
  const c = ox * ox + oy * oy + oz * oz - s.r * s.r;
  const disc = b * b - a * c;
  if (disc < 0 || !(a > 0)) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0 || t > maxT) return null;
  const point: V3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  // The gradient of x² + (y/st)² + z².
  const nx = point[0] - s.center[0],
    ny = (point[1] - s.center[1]) / (st * st),
    nz = point[2] - s.center[2];
  const n = Math.hypot(nx, ny, nz) || 1;
  return { t, point, normal: [nx / n, ny / n, nz / n], kind: s.kind, id: s.id };
}

/** Is the point inside the sphere or ellipsoid? */
export function insideSphere(p: V3, s: Sphere): boolean {
  const st = s.stretch ?? 1;
  return (
    (p[0] - s.center[0]) ** 2 +
      ((p[1] - s.center[1]) / st) ** 2 +
      (p[2] - s.center[2]) ** 2 <=
    s.r * s.r
  );
}

export function insideRing(
  x: number,
  z: number,
  ring: { x: number; z: number }[],
): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!,
      b = ring[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x)
      hit = !hit;
  }
  return hit;
}

/** Inside the prism's footprint: within its ring and outside its holes. */
export function insideFootprint(x: number, z: number, pr: Prism): boolean {
  return (
    insideRing(x, z, pr.ring) && !(pr.holes?.some((h) => insideRing(x, z, h)) ?? false)
  );
}

export function rayPrism(o: V3, d: V3, pr: Prism, maxT: number): Hit | null {
  let best: Hit | null = null;
  // The walls: the outer ring's, then each hole's.
  const walls = (ring: { x: number; z: number }[]) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!;
      const ex = b.x - a.x,
        ez = b.z - a.z;
      const den = d[0] * ez - d[2] * ex;
      if (Math.abs(den) < EPS) continue;
      const t = ((a.x - o[0]) * ez - (a.z - o[2]) * ex) / den;
      const u = ((a.x - o[0]) * d[2] - (a.z - o[2]) * d[0]) / den;
      if (t < 0 || t > maxT || u < 0 || u > 1 || (best && t >= best.t)) continue;
      const y = o[1] + d[1] * t;
      if (y < pr.y0 || y > pr.y1) continue;
      const len = Math.hypot(ex, ez) || 1;
      let nx = ez / len,
        nz = -ex / len;
      if (nx * d[0] + nz * d[2] > 0) {
        nx = -nx;
        nz = -nz;
      }
      best = {
        t,
        point: [o[0] + d[0] * t, y, o[2] + d[2] * t],
        normal: [nx, 0, nz],
        kind: pr.kind,
        id: pr.id,
      };
    }
  };
  walls(pr.ring);
  for (const hole of pr.holes ?? []) walls(hole);
  if (Math.abs(d[1]) > EPS)
    for (const [y, ny] of [
      [pr.y1, 1],
      [pr.y0, -1],
    ] as const) {
      const t = (y - o[1]) / d[1];
      if (t < 0 || t > maxT || (best && t >= best.t)) continue;
      const x = o[0] + d[0] * t,
        z = o[2] + d[2] * t;
      if (insideFootprint(x, z, pr))
        best = {
          t,
          point: [x, y, z],
          normal: [0, ny, 0],
          kind: ny > 0 ? "roof" : pr.kind,
          id: pr.id,
        };
    }
  return best;
}

const finite3 = (v: V3) =>
  Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);

/** The most samples one ground march takes: a longer ray is sampled more coarsely. */
const MAX_GROUND_STEPS = 4096;

/**
 * Ground along a ray, by stepping and bisection. `ground` must be continuous
 * (where it is not a number, the ray counts as above it). Null for a
 * non-finite ray or reach. The march takes at most
 * `MAX_GROUND_STEPS` samples, `step` apart (wider on a ray longer than that
 * many steps), so it always ends.
 */
export function rayGround(
  o: V3,
  d: V3,
  maxT: number,
  ground: (x: number, z: number) => number,
  step = 0.25,
  groundMax = Infinity,
): number | null {
  if (!finite3(o) || !finite3(d) || !Number.isFinite(maxT) || maxT < 0 || !(step > 0))
    return null;
  const above = (t: number) => o[1] + d[1] * t - ground(o[0] + d[0] * t, o[2] + d[2] * t);
  if (above(0) <= 0) return 0;
  const stride = Math.max(step, maxT / MAX_GROUND_STEPS);
  let prev = 0;
  for (let k = 1; k <= MAX_GROUND_STEPS + 1; k++) {
    const t = Math.min(k * stride, maxT);
    if (above(t) <= 0) {
      let lo = prev,
        hi = t;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid) > 0) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    if (t >= maxT || (d[1] >= 0 && o[1] + d[1] * t > groundMax)) return null;
    prev = t;
  }
  return null;
}

export interface PrimitiveWorldSpec {
  id: string;
  home: Home;
  inputs: WorldInputs;
  ground: (x: number, z: number) => number;
  /** The highest the ground gets anywhere: rays above it stop looking for it. */
  groundMax?: number;
  groundKind?: SurfaceKind;
  boxes?: Box[];
  cylinders?: Cylinder[];
  spheres?: Sphere[];
  prisms?: Prism[];
  /** A ceiling plane, if the world is enclosed. */
  ceiling?: number;
  lights?: PointLight[];
  /** A uniform light level everywhere, with no direction. */
  ambient?: number;
  /** Unit direction toward the sun and its proxy level when unoccluded. */
  sun?: { toward: V3; level: number; shade: number };
  movers?: (near: V3, radius: number, out: Mover[], t: number) => void;
  /** Multiplies every light (storms, outages); defaults to 1. */
  dimming?: () => number;
}

/** A world assembled from primitives. Lists are scanned linearly: keep them local. */
/** A bounding sphere: centre x, y, z and radius. */
type Bound = readonly [number, number, number, number];

/**
 * Can the segment o + t·d, t in [0, maxT], touch the sphere? A cheap reject
 * in front of the exact tests: a ray misses most of a city's primitives.
 */
function mayHit(o: V3, d: V3, dLength: number, maxT: number, b: Bound): boolean {
  const cx = b[0] - o[0],
    cy = b[1] - o[1],
    cz = b[2] - o[2];
  // Distance along the ray to the closest approach, in metres.
  const along = (cx * d[0] + cy * d[1] + cz * d[2]) / dLength;
  if (along < -b[3] || along > maxT * dLength + b[3]) return false;
  return cx * cx + cy * cy + cz * cz - along * along <= b[3] * b[3];
}

/**
 * Reaches (m) for which the primitives near a ray's origin are listed once and
 * reused: the senses cast many short rays from one point per sample.
 */
const LOCAL_REACH = [0.5, 3, 13] as const;
/**
 * The lists hold everything within their reach of any origin this close to
 * the point they were made for (m), so they are remade only after the fly has
 * moved that far, not at every step. A larger list, in the same order, finds
 * the same nearest hit: what it adds is out of the ray's reach.
 */
const LOCAL_SLACK = 0.25;
interface Local {
  boxes: number[];
  cylinders: number[];
  spheres: number[];
}

export class PrimitiveWorld implements FlyWorld {
  readonly id: string;
  readonly home: Home;
  readonly inputs: WorldInputs;
  /** The primitives are fixed once the world is built; their bounds are computed then. */
  protected spec: PrimitiveWorldSpec;
  /** The top of everything that can block a ray: above it, light is unoccluded. */
  private top: number;
  private boxBounds: Bound[];
  private cylinderBounds: Bound[];
  private sphereBounds: Bound[];
  /** Candidate lists for the last ray origin, one per `LOCAL_REACH`; a cache only. */
  private localAt: V3 = [NaN, NaN, NaN];
  private local: (Local | null)[] = LOCAL_REACH.map(() => null);
  constructor(spec: PrimitiveWorldSpec) {
    this.spec = spec;
    this.id = spec.id;
    this.home = spec.home;
    this.inputs = spec.inputs;
    this.boxBounds = (spec.boxes ?? []).map((b) => [
      ...b.center,
      Math.hypot(b.half[0], b.half[1], b.half[2]),
    ]);
    this.cylinderBounds = (spec.cylinders ?? []).map((c) => [
      c.x,
      (c.y0 + c.y1) / 2,
      c.z,
      Math.hypot(Math.max(c.r, c.r1 ?? c.r), (c.y1 - c.y0) / 2),
    ]);
    this.sphereBounds = (spec.spheres ?? []).map((s) => [
      ...s.center,
      s.r * Math.max(1, s.stretch ?? 1),
    ]);
    this.top = Math.max(
      spec.groundMax ?? Infinity,
      ...(spec.boxes ?? []).map((b) => b.center[1] + b.half[1]),
      ...(spec.cylinders ?? []).map((c) => c.y1),
      ...(spec.spheres ?? []).map((s) => s.center[1] + s.r * (s.stretch ?? 1)),
      ...(spec.prisms ?? []).map((p) => p.y1),
    );
  }
  ground(x: number, z: number) {
    return this.spec.ground(x, z);
  }
  /** Prisms near a point; subclasses may index them. */
  protected prismsNear(_x: number, _z: number, _r: number): readonly Prism[] {
    return this.spec.prisms ?? [];
  }
  perchAt(x: number, z: number, maxY: number): Perch | null {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Number.isNaN(maxY)) return null;
    const g = this.spec.ground(x, z);
    let best: Perch | null =
      g <= maxY + 1e-6
        ? { y: g, kind: this.spec.groundKind ?? "ground", id: "ground" }
        : null;
    const consider = (y: number, kind: SurfaceKind, id: string) => {
      if (y <= maxY + 1e-6 && (!best || y > best.y) && WALKABLE.has(kind))
        best = { y, kind, id };
    };
    for (const b of this.spec.boxes ?? []) {
      const top = b.center[1] + b.half[1];
      const probe: V3 = [x, top - 1e-4, z];
      if (insideBox(probe, b)) consider(top, b.kind, b.id);
    }
    for (const c of this.spec.cylinders ?? []) {
      const top = c.r1 ?? c.r;
      if ((x - c.x) ** 2 + (z - c.z) ** 2 <= top * top) consider(c.y1, c.kind, c.id);
    }
    for (const s of this.spec.spheres ?? []) {
      const dx = x - s.center[0],
        dz = z - s.center[2];
      const rho2 = dx * dx + dz * dz;
      const h2 = s.r * s.r - rho2;
      if (h2 < 0) continue;
      // The top surface, where it is no steeper than a walkable slope: its
      // normal is along (dx, h/st, dz), h the height on the unstretched sphere.
      const st = s.stretch ?? 1;
      const up2 = h2 / (st * st);
      const ny2 = WALKABLE_NORMAL_Y * WALKABLE_NORMAL_Y;
      if (up2 >= ny2 * (rho2 + up2))
        consider(s.center[1] + st * Math.sqrt(h2), s.kind, s.id);
    }
    for (const p of this.prismsNear(x, z, 0))
      if (insideFootprint(x, z, p)) consider(p.y1, "roof", p.id);
    return best;
  }
  raycast(o: V3, d: V3, maxT: number, visible = false): Hit | null {
    if (!finite3(o) || !finite3(d) || !Number.isFinite(maxT) || maxT < 0) return null;
    const dLength = Math.hypot(d[0], d[1], d[2]);
    if (!(dLength > 0)) return null;
    // Assigned inside `take`, which control-flow analysis cannot see.
    let best = null as Hit | null;
    const take = (h: Hit | null) => {
      if (h && (!best || h.t < best.t) && !(visible && h.kind === "glass")) best = h;
    };
    const near = this.near(o, maxT * dLength);
    const boxes = this.spec.boxes ?? [],
      cylinders = this.spec.cylinders ?? [],
      spheres = this.spec.spheres ?? [];
    // In the spec's order either way, so ties resolve as without the lists.
    const each = (n: number, local: number[] | undefined, f: (i: number) => void) => {
      if (local) for (const i of local) f(i);
      else for (let i = 0; i < n; i++) f(i);
    };
    each(boxes.length, near?.boxes, (i) => {
      const reach = best ? best.t : maxT;
      if (mayHit(o, d, dLength, reach, this.boxBounds[i]!))
        take(rayBox(o, d, boxes[i]!, reach));
    });
    each(cylinders.length, near?.cylinders, (i) => {
      const reach = best ? best.t : maxT;
      if (mayHit(o, d, dLength, reach, this.cylinderBounds[i]!))
        take(rayCylinder(o, d, cylinders[i]!, reach));
    });
    each(spheres.length, near?.spheres, (i) => {
      take(raySphere(o, d, spheres[i]!, best ? best.t : maxT));
    });
    const reach = maxT;
    for (const p of this.prismsNear(
      o[0] + (d[0] * reach) / 2,
      o[2] + (d[2] * reach) / 2,
      reach,
    ))
      take(rayPrism(o, d, p, best ? best.t : maxT));
    const tg = rayGround(
      o,
      d,
      best ? best.t : maxT,
      this.spec.ground,
      0.25,
      this.spec.groundMax,
    );
    if (tg !== null && (!best || tg < best.t))
      best = {
        t: tg,
        point: [o[0] + d[0] * tg, o[1] + d[1] * tg, o[2] + d[2] * tg],
        normal: [0, 1, 0],
        kind: this.spec.groundKind ?? "ground",
        id: "ground",
      };
    const ceiling = this.spec.ceiling;
    if (ceiling !== undefined && d[1] > EPS) {
      const t = (ceiling - o[1]) / d[1];
      if (t >= 0 && t <= maxT && (!best || t < best.t))
        best = {
          t,
          point: [o[0] + d[0] * t, ceiling, o[2] + d[2] * t],
          normal: [0, -1, 0],
          kind: "wall",
          id: "ceiling",
        };
    }
    return best;
  }
  /**
   * The primitives a ray from `o` reaching `reachM` metres could touch (and
   * perhaps a few more, in the spec's order), or null for all.
   */
  private near(o: V3, reachM: number): Local | null {
    const tier = LOCAL_REACH.findIndex((r) => reachM <= r);
    if (tier < 0) return null;
    const at = this.localAt;
    if (!(Math.hypot(o[0] - at[0], o[1] - at[1], o[2] - at[2]) <= LOCAL_SLACK)) {
      this.localAt = [o[0], o[1], o[2]];
      this.local = LOCAL_REACH.map(() => null);
    }
    const cached = this.local[tier];
    if (cached) return cached;
    // From the point the lists are made for, with room for the slack.
    const c = this.localAt;
    const r = LOCAL_REACH[tier]! + LOCAL_SLACK;
    const within = (bounds: Bound[]) => {
      const out: number[] = [];
      bounds.forEach((b, i) => {
        if (Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]) <= r + b[3]) out.push(i);
      });
      return out;
    };
    const local = {
      boxes: within(this.boxBounds),
      cylinders: within(this.cylinderBounds),
      spheres: within(this.sphereBounds),
    };
    this.local[tier] = local;
    return local;
  }
  solid(p: V3): boolean {
    if (!finite3(p)) return true;
    if (p[1] < this.spec.ground(p[0], p[2])) return true;
    if (this.spec.ceiling !== undefined && p[1] > this.spec.ceiling) return true;
    for (const b of this.spec.boxes ?? []) if (insideBox(p, b)) return true;
    for (const c of this.spec.cylinders ?? []) if (insideCylinder(p, c)) return true;
    for (const s of this.spec.spheres ?? []) if (insideSphere(p, s)) return true;
    for (const pr of this.prismsNear(p[0], p[2], 0))
      if (p[1] >= pr.y0 && p[1] <= pr.y1 && insideFootprint(p[0], p[2], pr)) return true;
    return false;
  }
  movers(near: V3, radius: number, out: Mover[], t: number): void {
    this.spec.movers?.(near, radius, out, t);
  }
  light(p: V3): LightSample {
    const dim = this.spec.dimming?.() ?? 1;
    let level = this.spec.ambient ?? 0;
    let bestPart = 0;
    let toward: V3 | null = null;
    const sun = this.spec.sun;
    if (sun) {
      const reach =
        sun.toward[1] > 0
          ? Math.min(400, Math.max(0, this.top - p[1]) / sun.toward[1] + 0.01)
          : 400;
      const lit = !this.raycast([p[0], p[1] + 1e-3, p[2]], sun.toward, reach, true);
      const part = lit ? sun.level : sun.shade;
      level += part;
      if (lit) {
        bestPart = part;
        toward = sun.toward;
      }
    }
    for (const l of this.spec.lights ?? []) {
      const dx = l.at[0] - p[0],
        dy = l.at[1] - p[1],
        dz = l.at[2] - p[2];
      const d2 = Math.max(0.05, dx * dx + dy * dy + dz * dz);
      const part = l.intensity / d2;
      level += part;
      if (part > bestPart) {
        bestPart = part;
        const d = Math.sqrt(d2);
        toward = [dx / d, dy / d, dz / d];
      }
    }
    return { level: level * dim, toward: bestPart > 0.5 * level ? toward : null };
  }
  landingSites(near: V3, radius: number, out: LandingSite[]): void {
    const r2 = radius * radius;
    const within = (c: V3) => (c[0] - near[0]) ** 2 + (c[2] - near[2]) ** 2 <= r2;
    for (const b of this.spec.boxes ?? []) {
      if (!WALKABLE.has(b.kind)) continue;
      const c: V3 = [b.center[0], b.center[1] + b.half[1], b.center[2]];
      if (within(c))
        out.push({
          id: b.id,
          kind: b.kind,
          center: c,
          half: [b.half[0], b.half[2]],
          angle: b.angle,
        });
    }
    for (const cy of this.spec.cylinders ?? []) {
      if (!WALKABLE.has(cy.kind)) continue;
      const c: V3 = [cy.x, cy.y1, cy.z];
      const top = cy.r1 ?? cy.r;
      if (within(c))
        out.push({
          id: cy.id,
          kind: cy.kind,
          center: c,
          half: [top * 0.7, top * 0.7],
          angle: 0,
        });
    }
    for (const s of this.spec.spheres ?? []) {
      if (!WALKABLE.has(s.kind)) continue;
      const st = s.stretch ?? 1;
      const c: V3 = [s.center[0], s.center[1] + s.r * st, s.center[2]];
      // The crown's cap within the flatness tolerance of the plane through its
      // top: the surface drops st·(r − √(r² − ρ²)) at radius ρ. The site is
      // the square inscribed in that circle.
      const f = LANDING_SITE_FLATNESS_M / st;
      const rho = Math.min(s.r, Math.sqrt(Math.max(0, 2 * s.r * f - f * f)));
      if (within(c))
        out.push({
          id: s.id,
          kind: s.kind,
          center: c,
          half: [rho / Math.SQRT2, rho / Math.SQRT2],
          angle: 0,
        });
    }
  }
}
