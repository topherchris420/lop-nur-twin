/**
 * The looming-escape pathways as circuit models.
 *
 * The giant fiber (GF): its membrane potential is computed from the looming
 * object's angular size θ and expansion θ̇ by Ache et al. 2019's model
 * (Current Biology 29:1073, STAR Methods, eqs 3–7), the one that paper fitted
 * to whole-cell GF recordings with LC4 or LPLC2 silenced:
 *
 *   V = W_LPLC2·C2·exp(−(ln θ(t−δ2) − ln C3)² / 2C4²)     LPLC2: angular size
 *     + W_LC4·C1·θ̇(t−δ1)                                   LC4: angular velocity
 *     + W_i1·(C5 + C6 / (1 + exp((θ(t−δ3) − C7) / C8)))     tonic inhibition
 *     + W_i2·C9·exp(−(θ(t−δ4) − C10)² / 2C11²)             LC4-linked inhibition
 *
 * with every constant the paper's (`params.ts`). The connectome supports the
 * two excitatory terms: LC4 and LPLC2 make 99.4% of the GF's direct
 * optic-lobe synapses in the paper's EM reconstruction. Three choices are
 * this model's, each named where it is made: the velocity term is rectified
 * (LC4 is not driven by an object shrinking), the size term counts only while
 * the object expands (LPLC2 responds to looming, not to a static size;
 * Klapoetke et al. 2017), and nothing contributes when nothing is seen.
 *
 * The GF spikes when V first reaches this trial's threshold: a log-normal
 * draw around a median (von Reyn et al. 2014 found the GF pathway's threshold
 * log-normal), both fitted (see `calibration/fit.ts`). A trial is one looming
 * object: a new one, or one seen again after half a second, draws a new
 * threshold and a new wing-raise angle.
 *
 * The GF-independent pathway starts the long-mode program, the wing raise,
 * `wingRaiseDelayMs` after the object has grown to this trial's wing-raise
 * angle, drawn from Fotowat et al. 2009's 49° (SD 4°). Which pathway acts first sets the mode;
 * the GF can still cut a long-mode program short (von Reyn et al. 2014).
 *
 * It simulates no neuron, synapse or network: the membrane potential is the
 * published function of the stimulus, and a threshold on it.
 */
import type { SenseFrame } from "../senses.js";
import { normal } from "./random.js";
import type { ResolvedCircuitParams } from "./params.js";

interface Sample {
  t: number;
  /** Angular size (deg), 0 when nothing is seen. */
  size: number;
  /** Expansion (deg/s). */
  vel: number;
}

export interface EscapeCircuitState {
  /** The modelled membrane potential at the last sample (mV from rest). */
  v: number;
  /** Its parts at that sample, for the panel and the log (mV, weighted). */
  lplc2: number;
  lc4: number;
  inhibition: number;
  /** This trial's spike threshold (mV), the standard-normal draw that set it (threshold = median · e^(spread · z)), and its wing-raise angle (deg). */
  threshold: number;
  thresholdZ: number;
  wingRaiseDeg: number;
  /** The object this trial is about, or null between trials. */
  object: string | null;
  lastSeen: number;
  /** When the GF spiked in this trial, or null. */
  spikedAt: number | null;
  /** When this trial's wing-raise angle was reached, or null. */
  raisedAt: number | null;
  spikes: number;
  /** Samples for the delayed terms, oldest first, about 60 ms of them. */
  history: Sample[];
}

/** What one sample changed: a spike and the wing raise each fire once per trial. */
export interface EscapeSignal {
  spike: boolean;
  wingRaise: boolean;
  /** Where the object is, relative to the heading (rad, + left), for the jump's direction. */
  bearing: number | null;
}

const KEEP_S = 0.06;
const TRIAL_GAP_S = 0.5;

export class EscapeCircuit {
  readonly state: EscapeCircuitState;
  /** A silenced giant fiber (as with Kir2.1 in von Reyn et al. 2014): its potential is computed, it never spikes. */
  readonly silenced: boolean;
  private P: ResolvedCircuitParams;
  private rng: () => number;
  constructor(params: ResolvedCircuitParams, rng: () => number, silenced = false) {
    this.P = params;
    this.rng = rng;
    this.silenced = silenced;
    this.state = {
      v: 0,
      lplc2: 0,
      lc4: 0,
      inhibition: 0,
      threshold: params.gfThresholdMv,
      thresholdZ: 0,
      wingRaiseDeg: params.wingRaiseDeg,
      object: null,
      // Finite, so the fly's state hash can take it.
      lastSeen: -1e9,
      spikedAt: null,
      raisedAt: null,
      spikes: 0,
      history: [],
    };
  }

  private newTrial(object: string): void {
    const S = this.state,
      P = this.P;
    S.object = object;
    S.thresholdZ = normal(this.rng);
    S.threshold = P.gfThresholdMv * Math.exp(P.gfThresholdLnSd * S.thresholdZ);
    S.wingRaiseDeg = P.wingRaiseDeg + P.wingRaiseSdDeg * normal(this.rng);
    S.spikedAt = null;
    S.raisedAt = null;
  }

  /** Size and expansion `delay` seconds before `t`, interpolated between samples. */
  private at(t: number, delay: number): Sample {
    const h = this.state.history,
      want = t - delay;
    if (!h.length || want < h[0]!.t) return { t: want, size: 0, vel: 0 };
    for (let i = h.length - 1; i >= 0; i--) {
      const a = h[i]!;
      if (a.t <= want) {
        const b = h[i + 1];
        if (!b) return a;
        const u = (want - a.t) / (b.t - a.t);
        return {
          t: want,
          size: a.size + (b.size - a.size) * u,
          vel: a.vel + (b.vel - a.vel) * u,
        };
      }
    }
    return h[0]!;
  }

  /**
   * One sensory sample, once each: the frame's looming object (the strongest
   * the eyes report, or none). `gain` is the body's responsiveness, which
   * scales the excitatory terms and widens the wing-raise angle by its inverse.
   */
  sample(frame: SenseFrame, gain: number): EscapeSignal {
    const S = this.state,
      P = this.P;
    const h = S.history;
    if (h.length && frame.t <= h[h.length - 1]!.t)
      return { spike: false, wingRaise: false, bearing: null };
    const loom = frame.looming;
    if (loom && loom.sizeDeg > 0) {
      if (loom.id !== S.object || frame.t - S.lastSeen > TRIAL_GAP_S)
        this.newTrial(loom.id);
      S.lastSeen = frame.t;
    }
    h.push({
      t: frame.t,
      size: loom ? loom.sizeDeg : 0,
      vel: loom ? loom.expansionDegS : 0,
    });
    while (h.length > 2 && h[1]!.t <= frame.t - KEEP_S) h.shift();

    const s1 = this.at(frame.t, P.lc4DelayMs / 1000),
      s2 = this.at(frame.t, P.lplc2DelayMs / 1000),
      s3 = this.at(frame.t, P.tonicDelayMs / 1000),
      s4 = this.at(frame.t, P.lc4InhibitionDelayMs / 1000);
    const lc4 = P.weightLc4 * P.lc4GainMvPerDegS * Math.max(0, s1.vel);
    const lplc2 =
      s2.size > 0 && s2.vel > 0
        ? P.weightLplc2 *
          P.lplc2PeakMv *
          Math.exp(
            -((Math.log(s2.size) - Math.log(P.lplc2PeakDeg)) ** 2) /
              (2 * P.lplc2WidthLn ** 2),
          )
        : 0;
    const tonic =
      s3.size > 0
        ? P.weightTonic *
          (P.tonicBaseMv +
            P.tonicStepMv / (1 + Math.exp((s3.size - P.tonicMidDeg) / P.tonicSlopeDeg)))
        : 0;
    const lc4Inhibition =
      s4.size > 0
        ? P.weightLc4Inhibition *
          P.lc4InhibitionMv *
          Math.exp(
            -((s4.size - P.lc4InhibitionPeakDeg) ** 2) /
              (2 * P.lc4InhibitionWidthDeg ** 2),
          )
        : 0;
    S.lc4 = lc4 * gain;
    S.lplc2 = lplc2 * gain;
    S.inhibition = tonic + lc4Inhibition;
    S.v = S.lc4 + S.lplc2 + S.inhibition;

    let spike = false,
      wingRaise = false;
    if (
      !this.silenced &&
      S.object !== null &&
      S.spikedAt === null &&
      S.v >= S.threshold
    ) {
      S.spikedAt = frame.t;
      S.spikes++;
      spike = true;
    }
    const seen = this.at(frame.t, P.wingRaiseDelayMs / 1000);
    if (
      S.object !== null &&
      S.raisedAt === null &&
      seen.vel > 0 &&
      gain > 0 &&
      seen.size >= S.wingRaiseDeg / gain
    ) {
      S.raisedAt = frame.t;
      wingRaise = true;
    }
    return { spike, wingRaise, bearing: loom ? loom.bearing : null };
  }
}
