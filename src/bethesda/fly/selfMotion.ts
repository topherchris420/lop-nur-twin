/**
 * The fly's sense of its own motion: how far and which way it went, and how
 * far it turned, over each decision period, as optic flow and the halteres
 * (in the air) or the legs' load and optic flow (on a surface) would report
 * them, with noise.
 *
 * A reduced-order stand-in, not a model of the motion-vision pathway or the
 * halteres: the body's true displacement and turn over the period, expressed
 * in the frame the body faced at the start of the period, plus independent
 * noise on every component. Its noise is a model choice (below), drawn from a
 * seeded stream of its own, so a fly whose decision maker does not ask for
 * this sense (`AdapterDescriptor.selfMotion`) draws nothing and runs exactly
 * as before. It also reports touch: whether the legs met an edge or a solid,
 * or the body pressed against a surface, during the period (mechanosensation,
 * which the walking controller already reads as `edge`).
 *
 * It reports what moved the fly, never why: a step that went less far because
 * the legs slipped and one that went less far because the ground moved back
 * under the fly read the same way. Faults of this sense are applied here from
 * a perturbation schedule (perturbation.ts): noise multiplied, the translation
 * reading scaled, a constant velocity added. Nothing here is handed to the fly
 * but the sample.
 */
import { gauss } from "./senses.js";
import type { ActivePerturbation } from "./perturbation.js";
import { forward, left, type V3, wrapAngle } from "./units.js";

/** Noise of a translation reading: this much (m) per 50 ms period, plus a share of the reading. */
export const SELF_MOTION_NOISE = {
  /** Absolute translation noise per 50 ms period (m): 0.1 mm, 0.2 cm/s. A model choice. */
  translationM: 1e-4,
  /** Relative translation noise (share of the reading). A model choice. */
  translationShare: 0.05,
  /** Absolute turn noise per 50 ms period (rad): 0.2 rad/s. A model choice. */
  turnRad: 0.01,
  /** Relative turn noise (share of the reading). A model choice. */
  turnShare: 0.05,
  /** The period the absolute noises are stated for (s); other periods scale them by √(dt / this). */
  periodS: 0.05,
} as const;

export interface SelfMotionSample {
  /** End of the period (s). */
  t: number;
  dt: number;
  /** Displacement over the period in the frame the body faced at its start (m): forward, left, up. */
  forward: number;
  lateral: number;
  vertical: number;
  /** Heading change over the period (rad, + left). */
  turn: number;
  /** The legs met an edge or a solid, or the body pressed against a surface, during the period. */
  touched: boolean;
}

export interface SelfMotionState {
  /** Where the period began: time, position and heading (the sense's reference, never handed out). */
  from: { t: number; p: V3; yaw: number } | null;
  touched: boolean;
  samples: number;
}

/** Unit normal noise from the seeded stream (Irwin–Hall of four uniforms, scaled to unit variance). */
const unit = (rng: () => number) => gauss(rng) * Math.sqrt(3);

export class SelfMotionSense {
  readonly state: SelfMotionState = { from: null, touched: false, samples: 0 };
  private rng: () => number;
  constructor(rng: () => number) {
    this.rng = rng;
  }

  /** One body step: remember any touch. */
  observe(touched: boolean): void {
    if (touched) this.state.touched = true;
  }

  /**
   * The sample since the last call, measured from the body's true motion
   * with this sense's noise and faults; null at the first call, which only
   * starts the period.
   */
  sample(
    t: number,
    p: V3,
    yaw: number,
    fault: ActivePerturbation | null,
  ): SelfMotionSample | null {
    const S = this.state;
    const from = S.from;
    S.from = { t, p: [p[0], p[1], p[2]], yaw };
    const touched = S.touched;
    S.touched = false;
    if (!from) return null;
    const dt = t - from.t;
    if (!(dt > 0)) return null;
    S.samples++;
    const d: V3 = [p[0] - from.p[0], p[1] - from.p[1], p[2] - from.p[2]];
    const f = forward(from.yaw),
      l = left(from.yaw);
    let fwd = d[0] * f[0] + d[2] * f[2],
      lat = d[0] * l[0] + d[2] * l[2],
      up = d[1];
    const turn = wrapAngle(yaw - from.yaw);
    const N = SELF_MOTION_NOISE;
    const k = Math.sqrt(dt / N.periodS) * (fault?.flowNoise ?? 1);
    if (fault) {
      fwd = fwd * fault.flowGain + fault.flowBias[0] * dt;
      lat = lat * fault.flowGain + fault.flowBias[1] * dt;
      up *= fault.flowGain;
    }
    const noisy = (x: number, abs: number, share: number) =>
      x + (abs * k + share * Math.abs(x) * (fault?.flowNoise ?? 1)) * unit(this.rng);
    return {
      t,
      dt,
      forward: noisy(fwd, N.translationM, N.translationShare),
      lateral: noisy(lat, N.translationM, N.translationShare),
      vertical: noisy(up, N.translationM, N.translationShare),
      turn: noisy(turn, N.turnRad, N.turnShare),
      touched,
    };
  }
}
