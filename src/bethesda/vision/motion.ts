/**
 * Motion vision on the research compound eye: from luminance to local motion,
 * to looming units, to a giant-fiber drive and a wide-field rotation signal.
 *
 * 1. **Photoreceptors** adapt: each keeps a running mean of its luminance
 *    (time constant `adaptationS`) and signals Weber contrast against it, so
 *    a still scene fades and the output does not scale with illumination.
 * 2. **Elementary motion detectors**: a Hassenstein–Reichardt correlator on
 *    each pair of neighbouring ommatidia along the lattice's three axes
 *    (Hassenstein & Reichardt 1956), one first-order low-pass as its delay,
 *    its output divided by the pair's local contrast energy (contrast
 *    compression, after Drews et al. 2020). The three axis responses at an
 *    ommatidium give a local motion vector in its eye's plane. Flies split
 *    this computation into ON (T4) and OFF (T5) pathways with four preferred
 *    directions (Maisak et al. 2013); one signed correlator stands in for both.
 * 3. **Looming units** (after LPLC2, Klapoetke et al. 2017): each has four
 *    branches, one per cardinal direction, over the quadrant of its receptive
 *    field that lies that way from the centre. A branch is excited by local
 *    motion along its direction (outward) and inhibited by motion against it
 *    (inward): radial motion opponency. The unit's output is the geometric
 *    mean of its rectified branches, so it responds only when every quadrant
 *    sees outward motion, as an object on a collision course with the eye
 *    produces and a translating, receding or rotating scene does not.
 * 4. **Giant-fiber drive**: the sum of every unit's output (the giant fiber
 *    pools LPLC2 from across the eye; Ache et al. 2019). The bearing of the
 *    threat is the centre of the most active unit.
 * 5. **Wide-field rotation** (after the horizontal-system cells, Schnell et
 *    al. 2010): the mean local motion along increasing azimuth over both
 *    eyes' equatorial bands. It is a rotation signal from optic flow, offered
 *    for study; nothing decides on it here.
 *
 * Two research controls run the same code: `shuffle` feeds the detectors from
 * a fixed random permutation of each eye's ommatidia (retinotopy destroyed,
 * every signal kept), and the `expansion` readout replaces each unit's
 * opponent, all-quadrant combination by the mean of its branches' excitation
 * (outward motion summed, with no inhibition and no AND). All state is typed
 * arrays, so a checkpoint of a research subject records it whole.
 */
import {
  AXES,
  BRANCH_DIRECTIONS,
  type EyeLattice,
  type LoomingUnits,
} from "./lattice.js";
import { VISION_PARAMS } from "./params.js";

export interface MotionOutput {
  t: number;
  /** Giant-fiber drive from the opponent looming units (before any gain). */
  lplc2: number;
  /** The same units read as outward-motion energy only (the expansion control). */
  expansion: number;
  /** Most active unit under each readout, or −1. */
  lplc2Best: number;
  expansionBest: number;
  /** Wide-field motion along increasing azimuth (+ when the image moves to the fly's left). */
  wideField: number;
  /** Mean squared contrast across the eye: how much the image is changing. */
  contrastEnergy: number;
}

export interface MotionOptions {
  /** A permutation of the ommatidia (within each eye) the detectors read through, or null. */
  shuffle?: Int32Array | null;
}

/** Elevation band (rad) the wide-field signal averages over. */
const WIDE_FIELD_BAND = (30 * Math.PI) / 180;

export class MotionVision {
  readonly lattice: EyeLattice;
  readonly units: LoomingUnits;
  private readonly shuffle: Int32Array | null;
  /** Adapted luminance, contrast, delayed contrast, per ommatidium. */
  readonly adapted: Float64Array;
  readonly contrast: Float64Array;
  readonly delayed: Float64Array;
  /** Local motion vector per ommatidium (plane x, y). */
  readonly motion: Float64Array;
  /** Per-unit outputs of the last step. */
  readonly unitLplc2: Float64Array;
  readonly unitExpansion: Float64Array;
  /** Whether the eye has seen its first image (its state is initialized from it). */
  started = false;
  lastT = -Infinity;
  constructor(lattice: EyeLattice, units: LoomingUnits, options: MotionOptions = {}) {
    this.lattice = lattice;
    this.units = units;
    this.shuffle = options.shuffle ?? null;
    if (this.shuffle && this.shuffle.length !== lattice.n)
      throw new Error("a shuffle permutes every ommatidium");
    this.adapted = new Float64Array(lattice.n);
    this.contrast = new Float64Array(lattice.n);
    this.delayed = new Float64Array(lattice.n);
    this.motion = new Float64Array(2 * lattice.n);
    this.unitLplc2 = new Float64Array(units.n);
    this.unitExpansion = new Float64Array(units.n);
  }

  /**
   * One image at fly time `t`. The first image initializes the adaptation
   * (no contrast, no motion): the eye's state is new, not remembered.
   */
  step(luminance: Float64Array, t: number): MotionOutput {
    const L = this.lattice;
    const n = L.n;
    const perm = this.shuffle;
    const floor = VISION_PARAMS.luminanceFloor.value;
    if (!this.started) {
      for (let i = 0; i < n; i++) {
        this.adapted[i] = luminance[perm ? perm[i]! : i]!;
        this.contrast[i] = 0;
        this.delayed[i] = 0;
      }
      this.started = true;
      this.lastT = t;
      this.motion.fill(0);
      this.unitLplc2.fill(0);
      this.unitExpansion.fill(0);
      return this.output(t, 0);
    }
    const dt = t - this.lastT;
    if (!(dt > 0)) throw new Error("the eye's images must come in time order");
    this.lastT = t;
    const ka = 1 - Math.exp(-dt / VISION_PARAMS.adaptationS.value);
    const kd = 1 - Math.exp(-dt / VISION_PARAMS.emdDelayS.value);
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const lum = luminance[perm ? perm[i]! : i]!;
      const a = this.adapted[i]!;
      const c = (lum - a) / (a + floor);
      this.contrast[i] = c;
      this.adapted[i] = a + ka * (lum - a);
      this.delayed[i] = this.delayed[i]! + kd * (c - this.delayed[i]!);
      energy += c * c;
    }
    // Hassenstein–Reichardt correlators along each axis, normalized by local contrast energy.
    const c0 = VISION_PARAMS.contrastNormalization.value;
    const s = this.contrast,
      d = this.delayed,
      m = this.motion;
    m.fill(0);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const j = L.neighbour[3 * i + k]!;
        if (j < 0) continue;
        const hr = d[i]! * s[j]! - s[i]! * d[j]!;
        if (hr === 0) continue;
        const e = c0 + 0.25 * (s[i]! ** 2 + s[j]! ** 2 + d[i]! ** 2 + d[j]! ** 2);
        const v = hr / e;
        const ax = AXES[k]!;
        // The pair's response is shared by both ommatidia it joins.
        const w = (2 / 3) * 0.5 * v;
        m[2 * i] = m[2 * i]! + w * ax[0];
        m[2 * i + 1] = m[2 * i + 1]! + w * ax[1];
        m[2 * j] = m[2 * j]! + w * ax[0];
        m[2 * j + 1] = m[2 * j + 1]! + w * ax[1];
      }
    }
    // Looming units.
    const U = this.units;
    const alpha = VISION_PARAMS.lplc2Opponency.value;
    const ex = [0, 0, 0, 0],
      inh = [0, 0, 0, 0];
    for (let u = 0; u < U.n; u++) {
      ex.fill(0);
      inh.fill(0);
      for (let q = U.start[u]!; q < U.start[u + 1]!; q++) {
        const i = U.member[q]!;
        const b = U.branch[q]!;
        const dir = BRANCH_DIRECTIONS[b]!;
        const proj = m[2 * i]! * dir[0] + m[2 * i + 1]! * dir[1];
        const w = U.weight[q]!;
        if (proj > 0) ex[b] = ex[b]! + w * proj;
        else inh[b] = inh[b]! - w * proj;
      }
      let prod = 1;
      for (let b = 0; b < 4; b++) prod *= Math.max(0, ex[b]! - alpha * inh[b]!);
      this.unitLplc2[u] = Math.sqrt(Math.sqrt(prod));
      this.unitExpansion[u] = 0.25 * (ex[0]! + ex[1]! + ex[2]! + ex[3]!);
    }
    return this.output(t, energy / n);
  }

  private output(t: number, energy: number): MotionOutput {
    const U = this.units;
    let lplc2 = 0,
      expansion = 0,
      lBest = -1,
      eBest = -1,
      lMax = 0,
      eMax = 0;
    for (let u = 0; u < U.n; u++) {
      const a = this.unitLplc2[u]!,
        b = this.unitExpansion[u]!;
      lplc2 += a;
      expansion += b;
      if (a > lMax) [lMax, lBest] = [a, u];
      if (b > eMax) [eMax, eBest] = [b, u];
    }
    const L = this.lattice;
    let wide = 0,
      count = 0;
    for (let i = 0; i < L.n; i++) {
      if (Math.abs(L.elevation[i]!) > WIDE_FIELD_BAND) continue;
      wide +=
        this.motion[2 * i]! * L.azimuthTangent[2 * i]! +
        this.motion[2 * i + 1]! * L.azimuthTangent[2 * i + 1]!;
      count++;
    }
    return {
      t,
      lplc2,
      expansion,
      lplc2Best: lBest,
      expansionBest: eBest,
      wideField: count ? wide / count : 0,
      contrastEnergy: energy,
    };
  }
}

/**
 * A fixed permutation of each eye's ommatidia, from `rng`: the shuffled
 * control's wiring. Ommatidia stay within their own eye.
 */
export function shuffledWiring(lattice: EyeLattice, rng: () => number): Int32Array {
  const perm = new Int32Array(lattice.n);
  for (let i = 0; i < lattice.n; i++) perm[i] = i;
  for (let e = 0; e < 2; e++) {
    const a = lattice.eyeStart[e]!,
      b = lattice.eyeStart[e + 1]!;
    for (let i = b - 1; i > a; i--) {
      const j = a + Math.floor(rng() * (i - a + 1));
      const tmp = perm[i]!;
      perm[i] = perm[j]!;
      perm[j] = tmp;
    }
  }
  return perm;
}
