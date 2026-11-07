/**
 * Image formation for the research compound eye: the luminance each
 * ommatidium receives from the world, at the fly's position and heading.
 *
 * Static surfaces are sampled with one ray along each ommatidium's axis
 * (`world.raycast`, glass unseen, as for the fly's senses). Their luminance
 * is the scene's illumination at the eye times a reflectance for the surface
 * kind, a fixed procedural texture of the hit point (seeded simplex noise
 * from `src/lib/noise.ts`, features of 0.5 m and 2 m) and a shading term in
 * the surface's normal. Nothing beyond `visualRangeM` is seen; a ray that
 * meets nothing sees the sky (or an arena's lit ceiling), brighter overhead.
 *
 * Moving things (spheres) are integrated over each ommatidium's Gaussian
 * acceptance exactly: the share of a 2-D Gaussian that falls on a disc of
 * angular radius ρ at angular distance δ is the Rice distribution's CDF,
 * tabulated once. Spheres nearer than the static surface on the axis cover
 * it; several are composited front to back.
 *
 * Every number here is a model choice: the illumination is one level per
 * image (the world's light level at the eye), not a radiometric model, and
 * reflectances and texture are invented so that walls, floors and sky differ
 * and a still scene has structure for motion to be seen against.
 */
import { mulberry32, seededNoise2D } from "../../lib/noise.js";
import { gauss } from "../fly/senses.js";
import { degToRad, forward, left, type V3 } from "../fly/units.js";
import type { FlyWorld, Mover, SurfaceKind } from "../fly/world.js";
import type { EyeLattice } from "./lattice.js";
import { VISION_PARAMS } from "./params.js";

/** Reflectance of each surface kind (relative to a white surface, 1). Model choices. */
export const REFLECTANCE: Readonly<Record<SurfaceKind, number>> = {
  ground: 0.25,
  floor: 0.3,
  roof: 0.35,
  wall: 0.5,
  glass: 0,
  table: 0.4,
  bench: 0.35,
  lamp: 0.4,
  pole: 0.3,
  obstacle: 0.4,
};
/** The reflectance a stimulus's contrast is measured against: the walls' mean. */
export const REFERENCE_REFLECTANCE = REFLECTANCE.wall;
/** Luminance of open sky (or an arena's lit ceiling) relative to the illumination. */
export const SKY_LUMINANCE = 1;
/** A moving thing's reflectance when the scene gives none (a dark body; a model choice). */
export const DEFAULT_MOVER_REFLECTANCE = 0.2;

export interface VisionScene {
  readonly world: FlyWorld;
  /** The reflectance of a moving thing; the default when absent. */
  moverReflectance?(m: Mover): number;
  /** Seeds the static texture (a property of the world, not of the fly). */
  readonly textureSeed: number;
  /**
   * True for a world whose static geometry changes over time: the renderer
   * then casts every ray for every image. Absent or false, a still eye reuses
   * the static scene it cast last.
   */
  readonly staticGeometryChanges?: boolean;
}

// --- coverage of a Gaussian acceptance by a disc -----------------------------

/** exp(−x)·I0(x) for x ≥ 0 (Abramowitz & Stegun 9.8.1–9.8.2). */
export function i0e(x: number): number {
  if (x <= 3.75) {
    const t = (x / 3.75) ** 2;
    const i0 =
      1 +
      t *
        (3.5156229 +
          t *
            (3.0899424 +
              t * (1.2067492 + t * (0.2659732 + t * (0.0360768 + t * 0.0045813)))));
    return i0 * Math.exp(-x);
  }
  const t = 3.75 / x;
  return (
    (0.39894228 +
      t *
        (0.01328592 +
          t *
            (0.00225319 +
              t *
                (-0.00157565 +
                  t *
                    (0.00916281 +
                      t *
                        (-0.02057706 +
                          t * (0.02635537 + t * (-0.01647633 + t * 0.00392377)))))))) /
    Math.sqrt(x)
  );
}

/** The standard normal CDF (Abramowitz & Stegun 7.1.26 for erf; |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    t *
      (0.254829592 +
        t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
      Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

const TABLE_MAX = 24;
const TABLE_STEP = 0.1;
const TABLE_N = Math.round(TABLE_MAX / TABLE_STEP) + 1;
const SUB = 8;

/**
 * P(a, b): the share of a unit 2-D Gaussian centred at distance `a` from a
 * disc's centre that falls inside the disc of radius `b` (both in units of
 * the Gaussian's σ), i.e. the CDF at b of a Rice distribution with ν = a.
 * Tabulated by Simpson integration of the Rice density on a 0.1σ grid.
 */
const COVERAGE = (() => {
  const table = new Float64Array(TABLE_N * TABLE_N);
  const h = TABLE_STEP / SUB;
  const pdf = (s: number, a: number) =>
    s * Math.exp(-((s - a) * (s - a)) / 2) * i0e(s * a);
  for (let ia = 0; ia < TABLE_N; ia++) {
    const a = ia * TABLE_STEP;
    let acc = 0;
    table[ia * TABLE_N] = 0;
    for (let ib = 1; ib < TABLE_N; ib++) {
      const s0 = (ib - 1) * TABLE_STEP;
      let part = pdf(s0, a) + pdf(s0 + TABLE_STEP, a);
      for (let k = 1; k < SUB; k++) part += (k % 2 ? 4 : 2) * pdf(s0 + k * h, a);
      acc += (part * h) / 3;
      table[ia * TABLE_N + ib] = Math.min(1, acc);
    }
  }
  return table;
})();

/** Share of a Gaussian acceptance (width σ) covered by a disc of angular radius `rho` at angular distance `delta`. */
export function discCoverage(delta: number, rho: number, sigma: number): number {
  const a = delta / sigma,
    b = rho / sigma;
  if (b <= 0) return 0;
  if (a - b > 8) return 0;
  if (b - a > 8) return 1;
  if (a >= TABLE_MAX || b >= TABLE_MAX) return normalCdf(b - a);
  const fa = a / TABLE_STEP,
    fb = b / TABLE_STEP;
  const ia = Math.floor(fa),
    ib = Math.floor(fb);
  const ua = fa - ia,
    ub = fb - ib;
  const at = (i: number, j: number) => COVERAGE[i * TABLE_N + j]!;
  const ia1 = Math.min(ia + 1, TABLE_N - 1),
    ib1 = Math.min(ib + 1, TABLE_N - 1);
  return (
    (1 - ua) * ((1 - ub) * at(ia, ib) + ub * at(ia, ib1)) +
    ua * ((1 - ub) * at(ia1, ib) + ub * at(ia1, ib1))
  );
}

// --- the renderer ------------------------------------------------------------

/** Acceptance σ (rad) from the full width at half maximum. */
export const ACCEPTANCE_SIGMA =
  degToRad(VISION_PARAMS.acceptanceDeg.value) / (2 * Math.sqrt(2 * Math.log(2)));

interface Visible {
  d: number;
  ux: number;
  uy: number;
  uz: number;
  rho: number;
  /** Below this cosine of the angle to its centre an ommatidium sees none of it. */
  cosReach: number;
  lum: number;
}

/**
 * Renders one image: the luminance at every ommatidium of `lattice`, for an
 * eye at `p` with heading `yaw`, at fly time `t`. Holds scratch buffers, the
 * texture (a function of the scene's seed) and the static scene cast from the
 * last pose: none of it changes what any image is.
 */
export class Renderer {
  readonly scene: VisionScene;
  readonly lattice: EyeLattice;
  private readonly noise1;
  private readonly noise2;
  private readonly movers: Mover[] = [];
  private readonly visible: Visible[] = [];
  private readonly range: number;
  /** World-frame ray directions of the last image (scratch). */
  private readonly wx: Float64Array;
  private readonly wy: Float64Array;
  private readonly wz: Float64Array;
  private readonly depth: Float64Array;
  /** The static scene's luminance per unit of illumination, for the pose it was cast from. */
  private readonly unlit: Float64Array;
  private cached = false;
  private cachedP: V3 = [NaN, NaN, NaN];
  private cachedYaw = NaN;
  /** Rays cast for the last image, for the cost benchmark (0 when the static scene was reused). */
  rays = 0;
  /** Images rendered, and those that cast the static scene, for the cost benchmark. */
  images = 0;
  casts = 0;
  constructor(scene: VisionScene, lattice: EyeLattice, range: number) {
    this.scene = scene;
    this.lattice = lattice;
    this.range = range;
    this.noise1 = seededNoise2D(scene.textureSeed >>> 0);
    this.noise2 = seededNoise2D((scene.textureSeed ^ 0x5bd1e995) >>> 0);
    this.wx = new Float64Array(lattice.n);
    this.wy = new Float64Array(lattice.n);
    this.wz = new Float64Array(lattice.n);
    this.depth = new Float64Array(lattice.n);
    this.unlit = new Float64Array(lattice.n);
  }

  /** The procedural texture of a surface point, by its dominant normal axis. */
  private texture(pt: V3, n: V3): number {
    const ax = Math.abs(n[0]),
      ay = Math.abs(n[1]),
      az = Math.abs(n[2]);
    let u: number, v: number;
    if (ay >= ax && ay >= az) [u, v] = [pt[0], pt[2]];
    else if (ax >= az) [u, v] = [pt[2], pt[1]];
    else [u, v] = [pt[0], pt[1]];
    return 1 + 0.25 * this.noise1(u / 0.5, v / 0.5) + 0.15 * this.noise2(u / 2, v / 2);
  }

  /**
   * Fills `out` (one luminance per ommatidium). `rng` adds the photoreceptors'
   * multiplicative noise; pass null for a noiseless image.
   */
  render(
    p: V3,
    yaw: number,
    t: number,
    out: Float64Array,
    rng: (() => number) | null,
  ): void {
    const L = this.lattice;
    const world = this.scene.world;
    const E = world.light(p).level;
    const f = forward(yaw),
      l = left(yaw);
    const range = this.range;
    this.rays = 0;
    this.images++;
    // The static scene depends only on the pose: a fly that has not moved since
    // the last image sees the same surfaces, so they are not cast again. Exact:
    // the image is the same number for number either way (a test checks).
    const same =
      this.cached &&
      this.scene.staticGeometryChanges !== true &&
      p[0] === this.cachedP[0] &&
      p[1] === this.cachedP[1] &&
      p[2] === this.cachedP[2] &&
      yaw === this.cachedYaw;
    if (!same) {
      for (let i = 0; i < L.n; i++) {
        const bx = L.dx[i]!,
          by = L.dy[i]!,
          bz = L.dz[i]!;
        // Level frame (forward, left, up) to world (+x east, +y up, +z south).
        const x = f[0] * bx + l[0] * by,
          y = bz,
          z = f[2] * bx + l[2] * by;
        this.wx[i] = x;
        this.wy[i] = y;
        this.wz[i] = z;
        const hit = world.raycast(p, [x, y, z], range, true);
        this.rays++;
        if (hit) {
          this.depth[i] = hit.t;
          const shade = 0.8 + 0.2 * hit.normal[1];
          this.unlit[i] =
            REFLECTANCE[hit.kind] * this.texture(hit.point, hit.normal) * shade;
        } else {
          this.depth[i] = Infinity;
          this.unlit[i] = SKY_LUMINANCE * (0.75 + 0.25 * Math.max(0, y));
        }
      }
      this.casts++;
      this.cached = true;
      this.cachedP = [p[0], p[1], p[2]];
      this.cachedYaw = yaw;
    }
    for (let i = 0; i < L.n; i++) out[i] = E * this.unlit[i]!;
    // Moving things, nearest first, over what lies behind them.
    const movers = this.movers;
    movers.length = 0;
    world.movers(p, range, movers, t);
    const vis = this.visible;
    vis.length = 0;
    for (const m of movers) {
      const dx = m.center[0] - p[0],
        dy = m.center[1] - p[1],
        dz = m.center[2] - p[2];
      const d = Math.hypot(dx, dy, dz);
      if (d <= m.radius || d > range) continue;
      const refl = this.scene.moverReflectance?.(m) ?? DEFAULT_MOVER_REFLECTANCE;
      const rho = Math.asin(Math.min(1, m.radius / d));
      vis.push({
        d,
        ux: dx / d,
        uy: dy / d,
        uz: dz / d,
        rho,
        cosReach:
          rho + 8 * ACCEPTANCE_SIGMA >= Math.PI
            ? -2
            : Math.cos(rho + 8 * ACCEPTANCE_SIGMA),
        lum: E * refl,
      });
    }
    if (vis.length) {
      vis.sort((a, b) => a.d - b.d);
      const sigma = ACCEPTANCE_SIGMA;
      for (let i = 0; i < L.n; i++) {
        let lum = 0,
          clear = 1;
        for (const v of vis) {
          if (v.d >= this.depth[i]!) continue;
          const c = this.wx[i]! * v.ux + this.wy[i]! * v.uy + this.wz[i]! * v.uz;
          if (c < v.cosReach) continue;
          const delta = Math.acos(Math.max(-1, Math.min(1, c)));
          if (delta > v.rho + 8 * sigma) continue;
          const cov = discCoverage(delta, v.rho, sigma);
          if (cov <= 0) continue;
          lum += clear * cov * v.lum;
          clear *= 1 - cov;
        }
        if (clear < 1) out[i] = lum + clear * out[i]!;
      }
    }
    if (rng) {
      // `gauss` sums four uniforms (variance 1/3); √3 makes its standard deviation 1.
      const sd = VISION_PARAMS.photonNoise.value * Math.sqrt(3);
      for (let i = 0; i < L.n; i++) out[i] = Math.max(0, out[i]! * (1 + sd * gauss(rng)));
    }
  }
}

/** A seeded noise stream for the photoreceptors, separate from every stream the fly draws from. */
export function photoreceptorStream(seed: number): () => number {
  return mulberry32((Math.imul(seed >>> 0, 0x2c1b3c6d) ^ 0x7e1a) >>> 0);
}
