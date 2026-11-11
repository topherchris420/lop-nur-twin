/**
 * A novelty compartment: what a fly's mushroom body makes of a contact
 * chemistry it has, or has not, met before.
 *
 * Research only. Hattori et al. 2017 (doi:10.1016/j.cell.2017.04.028)
 * recorded MBON-α′3, a mushroom-body output neuron that responds strongly to
 * a novel odour and less each time the same odour returns, through
 * dopamine-dependent depression of the Kenyon-cell synapses onto it; its
 * response is specific to the odour, and its output drives an alerting
 * response that interrupts grooming. This module is a rate model of that
 * compartment, fed by the legs' contact chemoreceptors (Thistle et al. 2012,
 * doi:10.1016/j.cell.2012.03.045: leg neurons that respond to cuticular
 * hydrocarbons):
 *
 * 1. **Receptors.** `RECEPTOR_TYPES` contact chemoreceptor types, the same in
 *    every fly (a species' receptor repertoire), each with a fixed positive
 *    tuning over the four synthetic surface-chemistry bins, with
 *    multiplicative noise, then divisive normalization across the
 *    population (a model choice).
 * 2. **Kenyon cells.** `kenyonCells` cells, each summing `claws` receptor
 *    channels chosen at random **for this individual** (Caron et al. 2013,
 *    doi:10.1038/nature12063: each Kenyon cell's inputs are an apparently
 *    random combination), so two flies generalize between chemistries
 *    differently. The strongest `activeFraction` fire (inhibition by APL,
 *    as a winner-take-all; Hattori: 5–10% of Kenyon cells per odour).
 * 3. **MBON-α′3.** The mean weight of the active cells' synapses onto it:
 *    1 for a pattern never met, falling as the pattern's synapses depress.
 * 4. **Plasticity.** While chemistry is sensed, each active cell's synapse
 *    depresses at `depressionPerS` (dopamine from PPL1-α′3, which fires with
 *    the stimulus, is implicit); every synapse recovers toward 1 with time
 *    constant `recoveryTauS`. Both are model values chosen to meet Hattori's
 *    measured time course (`noveltyCalibration`, tested).
 *
 * It holds no partner, id, trace list or label: only synaptic weights. A
 * familiar partner is nothing but a chemistry whose Kenyon cells' synapses
 * are depressed; two flies with the same chemistry are the same to it.
 * Nothing here is a claim about awareness or about the real fly's cuticular
 * chemistry: the four bins are synthetic (see `socialSensing.ts`).
 */
import { mulberry32, seekStream, streamPosition } from "../../../lib/noise.js";
import type { SurfaceChemistry } from "../socialSensing.js";

export const NOVELTY_VERSION = "first-contact-alpha3-novelty/v1" as const;

export interface Quoted {
  doi: string;
  quote: string;
}
export interface NoveltyParam {
  value: number;
  unit: string;
  class: "published" | "model";
  note: string;
  sources?: Quoted[];
}

const HATTORI = "10.1016/j.cell.2017.04.028";

export const NOVELTY_PARAMS = {
  receptorNoiseCv: {
    value: 0.1,
    unit: "fraction",
    class: "model",
    note: "multiplicative noise on each receptor type's response to a contact sample",
  },
  kenyonCells: {
    value: 2000,
    unit: "cells",
    class: "model",
    note: "Kenyon cells in the model compartment, of the order of one mushroom body's",
  },
  claws: {
    value: 6,
    unit: "inputs per cell",
    class: "model",
    note: "receptor channels each Kenyon cell sums, chosen at random per individual",
    sources: [
      {
        doi: "10.1038/nature12063",
        quote:
          "each Kenyon cell integrates input from a different and apparently random combination of glomeruli",
      },
    ],
  },
  activeFraction: {
    value: 0.07,
    unit: "fraction",
    class: "published",
    note: "share of Kenyon cells active for one stimulus: a value inside the measured range",
    sources: [
      {
        doi: HATTORI,
        quote:
          "each odor activates a sparse representation (5%–10%) of principal neurons, the Kenyon cells",
      },
    ],
  },
  depressionPerS: {
    value: Math.log(1 / 0.3),
    unit: "1/s",
    class: "model",
    note: "depression rate of an active Kenyon cell's synapse while chemistry is sensed: a synapse active through a 1-s exposure keeps 30%. Chosen as the mildest of 0.45, 0.35, 0.3 and 0.25 for which Hattori's protocol on the model (`noveltyCalibration`, seeds 1-3) suppresses the second exposure by over 50% and some exposure from the third to the seventh by over 80%; receptor noise moves the active set between samples, so the measured suppression is weaker than the synapse's",
    sources: [
      { doi: HATTORI, quote: "Flies were presented with a 1-s odor stimulus" },
      {
        doi: HATTORI,
        quote: "Over 50% suppression is apparent by the second exposure to odor",
      },
      {
        doi: HATTORI,
        quote: "MBON activity declines more than 80% within three to seven repetitions",
      },
    ],
  },
  recoveryTauS: {
    value: 1200,
    unit: "s",
    class: "model",
    note: "time constant of each synapse's recovery toward full weight: 20 min after three exposures about a third of the suppression remains, and after an hour less than 5%",
    sources: [
      {
        doi: HATTORI,
        quote:
          "Suppression of the response to a familiar odor is still observed after 20 min of recovery",
      },
      {
        doi: HATTORI,
        quote: "activity returns to levels observed with a novel odor after 1 hr",
      },
    ],
  },
} as const satisfies Record<string, NoveltyParam>;

/** Receptor types of the species' contact chemoreceptor repertoire (model). */
export const RECEPTOR_TYPES = 24;
/** The species' receptor tuning: one fixed draw, the same for every fly. */
const SPECIES_SEED = 0x7c3a_91e5;

export type NoveltyOptions = {
  /** Synapses depress: false freezes them (the "no plasticity" lesion). */
  plastic?: boolean;
  /** Chemoreceptors work: false makes every contact taste of nothing (the "agustatory" lesion). */
  tastes?: boolean;
};

export interface NoveltySample {
  /** MBON-α′3's response, 0..1: 1 for a pattern never met. Null when nothing was tasted. */
  novelty: number | null;
  active: number;
}

export interface NoveltySnapshot {
  version: typeof NOVELTY_VERSION;
  seed: number;
  plastic: boolean;
  tastes: boolean;
  lastT: number | null;
  /** Where the receptor-noise stream is, so a restore continues it exactly. */
  noise: number;
  weights: number[];
}

function speciesTuning(): number[][] {
  const rng = mulberry32(SPECIES_SEED);
  const out: number[][] = [];
  for (let j = 0; j < RECEPTOR_TYPES; j++) {
    // Broad tuning: every type responds to every bin, with one or two preferred.
    const w = [0, 1, 2, 3].map(() => 0.1 + rng() ** 2);
    const sum = w.reduce((a, b) => a + b, 0);
    out.push(w.map((v) => v / sum));
  }
  return out;
}
const TUNING = speciesTuning();

/** One standard normal from a uniform stream (Box–Muller, two draws). */
function normal(rng: () => number): number {
  const u = Math.max(rng(), 1e-12),
    v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * One individual's α′3 compartment. `seed` wires its Kenyon cells and seeds
 * its receptor noise; nothing else is drawn from it.
 */
export class NoveltyCompartment {
  readonly seed: number;
  readonly plastic: boolean;
  readonly tastes: boolean;
  private readonly inputs: Uint16Array;
  private readonly weights: Float64Array;
  private readonly noise: () => number;
  private lastT: number | null = null;
  private readonly drive: Float64Array;
  private readonly order: Uint32Array;

  constructor(seed: number, options: NoveltyOptions = {}) {
    if (!Number.isSafeInteger(seed)) throw new Error("novelty: seed must be an integer");
    this.seed = seed;
    this.plastic = options.plastic ?? true;
    this.tastes = options.tastes ?? true;
    const K = NOVELTY_PARAMS.kenyonCells.value,
      C = NOVELTY_PARAMS.claws.value;
    const wiring = mulberry32((seed ^ 0x5eed_0a73) >>> 0);
    this.inputs = new Uint16Array(K * C);
    for (let i = 0; i < K * C; i++)
      this.inputs[i] = Math.floor(wiring() * RECEPTOR_TYPES) % RECEPTOR_TYPES;
    this.weights = new Float64Array(K).fill(1);
    this.noise = mulberry32((seed ^ 0x0dd5_17a3) >>> 0);
    this.drive = new Float64Array(K);
    this.order = new Uint32Array(K);
  }

  /** Synapses recover toward 1 since the last moment the compartment was used. */
  private recover(t: number): void {
    if (this.lastT !== null) {
      if (t < this.lastT - 1e-9) throw new Error("novelty: time cannot go backwards");
      const dt = t - this.lastT;
      if (dt > 0) {
        const keep = Math.exp(-dt / NOVELTY_PARAMS.recoveryTauS.value);
        const w = this.weights;
        for (let k = 0; k < w.length; k++) w[k] = 1 - (1 - w[k]!) * keep;
      }
    }
    this.lastT = Math.max(this.lastT ?? t, t);
  }

  /** The active Kenyon cells for one noisy receptor sample of `chemistry`. */
  private activate(chemistry: SurfaceChemistry): Uint32Array {
    const cv = NOVELTY_PARAMS.receptorNoiseCv.value;
    const r = new Float64Array(RECEPTOR_TYPES);
    let mean = 0;
    for (let j = 0; j < RECEPTOR_TYPES; j++) {
      const w = TUNING[j]!;
      const clean =
        w[0]! * chemistry[0] +
        w[1]! * chemistry[1] +
        w[2]! * chemistry[2] +
        w[3]! * chemistry[3];
      r[j] = Math.max(0, clean * (1 + cv * normal(this.noise)));
      mean += r[j]!;
    }
    mean /= RECEPTOR_TYPES;
    const norm = mean > 1e-9 ? 1 / mean : 0;
    const K = NOVELTY_PARAMS.kenyonCells.value,
      C = NOVELTY_PARAMS.claws.value;
    for (let k = 0; k < K; k++) {
      let s = 0;
      for (let c = 0; c < C; c++) s += r[this.inputs[k * C + c]!]!;
      this.drive[k] = s * norm;
      this.order[k] = k;
    }
    const n = Math.max(1, Math.round(NOVELTY_PARAMS.activeFraction.value * K));
    return this.strongest(n);
  }

  /**
   * The `n` most driven cells (ties to the lower index: a strict order, so
   * the set is unique), in index order: a winner-take-all found by
   * quickselect in linear time.
   */
  private strongest(n: number): Uint32Array {
    const idx = this.order,
      d = this.drive;
    for (let k = 0; k < idx.length; k++) idx[k] = k;
    const above = (a: number, b: number) => d[a]! > d[b]! || (d[a] === d[b] && a < b);
    const target = n - 1;
    let lo = 0,
      hi = idx.length - 1;
    while (lo < hi) {
      const pivot = idx[(lo + hi) >>> 1]!;
      let i = lo,
        j = hi;
      while (i <= j) {
        while (above(idx[i]!, pivot)) i++;
        while (above(pivot, idx[j]!)) j--;
        if (i <= j) {
          const tmp = idx[i]!;
          idx[i] = idx[j]!;
          idx[j] = tmp;
          i++;
          j--;
        }
      }
      if (target <= j) hi = j;
      else if (target >= i) lo = i;
      else break;
    }
    return idx.slice(0, n).sort();
  }

  /**
   * One contact sample lasting `dt` seconds at time `t`: the response it
   * evokes (before this sample's own depression), then plasticity. Null
   * chemistry (a body with none, or a fly that cannot taste) evokes nothing.
   */
  sense(chemistry: SurfaceChemistry | null, t: number, dt: number): NoveltySample {
    if (!Number.isFinite(t) || !(dt >= 0)) throw new Error("novelty: bad time");
    this.recover(t);
    if (!chemistry || !this.tastes) return { novelty: null, active: 0 };
    const active = this.activate(chemistry);
    let sum = 0;
    for (const k of active) sum += this.weights[k]!;
    const novelty = sum / active.length;
    if (this.plastic && dt > 0) {
      const keep = Math.exp(-NOVELTY_PARAMS.depressionPerS.value * dt);
      for (const k of active) this.weights[k] = this.weights[k]! * keep;
    }
    return { novelty, active: active.length };
  }

  /**
   * The response a chemistry would evoke at `t`, measured on a copy: this
   * compartment's weights, clock and noise stream are untouched (the
   * experimenter's probe).
   */
  probe(chemistry: SurfaceChemistry, t: number): number {
    return (
      NoveltyCompartment.restore(this.snapshot()).sense(chemistry, t, 0).novelty ?? 0
    );
  }

  /** Mean synaptic weight over all cells (1 = nothing learned). */
  get meanWeight(): number {
    let s = 0;
    for (const w of this.weights) s += w;
    return s / this.weights.length;
  }

  snapshot(): NoveltySnapshot {
    return {
      version: NOVELTY_VERSION,
      seed: this.seed,
      plastic: this.plastic,
      tastes: this.tastes,
      lastT: this.lastT,
      noise: streamPosition(this.noise)!,
      weights: Array.from(this.weights),
    };
  }

  /** Restores the weights, the clock and the noise stream's position: the same wiring, memory and future. */
  static restore(s: NoveltySnapshot): NoveltyCompartment {
    if (s.version !== NOVELTY_VERSION) throw new Error("novelty: incompatible snapshot");
    const m = new NoveltyCompartment(s.seed, { plastic: s.plastic, tastes: s.tastes });
    if (s.weights.length !== m.weights.length)
      throw new Error("novelty: snapshot has the wrong number of synapses");
    for (const w of s.weights)
      if (!(Number.isFinite(w) && w >= 0 && w <= 1))
        throw new Error("novelty: synaptic weights lie in [0, 1]");
    if (!Number.isSafeInteger(s.noise)) throw new Error("novelty: bad noise position");
    m.weights.set(s.weights);
    m.lastT = s.lastT;
    seekStream(m.noise, s.noise);
    return m;
  }
}

/**
 * Hattori's protocol on the model: 1-s exposures of one chemistry at a fixed
 * interval, then a probe after `recoveryS`, and a different chemistry after
 * the series. What `novelty.test.ts` holds against the paper's sentences.
 */
export function noveltyCalibration(
  seed: number,
  familiar: SurfaceChemistry,
  other: SurfaceChemistry,
  options: {
    pulses?: number;
    intervalS?: number;
    recoveryS?: number;
    stepS?: number;
  } = {},
) {
  const pulses = options.pulses ?? 7,
    isi = options.intervalS ?? 30,
    stepS = options.stepS ?? 0.005,
    recoveryS = options.recoveryS ?? 1200;
  const m = new NoveltyCompartment(seed);
  const responses: number[] = [];
  let t = 0;
  for (let p = 0; p < pulses; p++) {
    let first: number | null = null;
    for (let s = 0; s < Math.round(1 / stepS); s++) {
      const r = m.sense(familiar, t, stepS).novelty!;
      if (first === null) first = r;
      t += stepS;
    }
    responses.push(first!);
    t += isi - 1;
  }
  const end = t;
  return {
    responses,
    /** The other chemistry, right after the series. */
    other: m.probe(other, end),
    /** The familiar one after `recoveryS`, and after an hour. */
    afterRecovery: m.probe(familiar, end + recoveryS),
    afterHour: m.probe(familiar, end + 3600),
  };
}
