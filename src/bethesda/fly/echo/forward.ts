/**
 * The self-model's forward model: what the fly expects its self-motion sense
 * to report over the next decision period, given what it commanded
 * (efference copy), what its legs were doing when it commanded it
 * (proprioception), its own estimate of where it faces, and its beliefs about
 * its body and its surroundings.
 *
 * The beliefs are nine numbers (`X`):
 *
 * - its legs' speed gain, turning gain and turning bias (how far a step
 *   carries it, how far a commanded turn turns it, how far it turns unbidden);
 * - the same three for its wings;
 * - a drift (x, z, m/s) carrying it from outside, in its own heading frame,
 *   on a surface or in the air, and an outside turn (rad/s) of a surface
 *   under it.
 *
 * The body schema the predictions are built on is the fly's own parameter
 * table (the decision period, the physics step it acts in, the walking
 * speed's time constant): the innate model of its own body, which the fly is
 * given anyway. With every belief at its innate value the walking prediction
 * reproduces the reduced-order body's walking law exactly; flight is
 * predicted only in steady cruise or hover, where the body's velocity tracker
 * has settled, and every other period (takeoffs, landings, saccades,
 * accelerating flight, a reflex) is predicted as unknown and teaches nothing.
 *
 * The observation is linear in the gains and the outside terms except for the
 * walking path's curvature, which depends on the turn; the filter linearizes
 * there (an extended Kalman filter, Kalman 1960).
 */
import { SELF_MOTION_NOISE } from "../selfMotion.js";

/** Indices into the belief vector. */
export const X = {
  legGain: 0,
  legTurnGain: 1,
  legTurnBias: 2,
  wingGain: 3,
  wingTurnGain: 4,
  wingTurnBias: 5,
  driftX: 6,
  driftZ: 7,
  spin: 8,
} as const;
export const N = 9;
/** What the fly believes about itself and about its surroundings, by index. */
export const SELF = [0, 1, 2, 3, 4, 5] as const;
export const OUTSIDE = [6, 7, 8] as const;
export const GAINS = [0, 1, 3, 4] as const;
export const BIASES = [2, 5] as const;
/** The innate beliefs: an unimpaired body in still surroundings. */
export const INNATE: readonly number[] = Object.freeze([1, 1, 0, 1, 1, 0, 0, 0, 0]);
export const BELIEF_NAMES = [
  "leg speed gain",
  "leg turning gain",
  "leg turning bias",
  "wing speed gain",
  "wing turning gain",
  "wing turning bias",
  "outside drift x",
  "outside drift z",
  "outside turn",
] as const;

export type PeriodKind = "still" | "walk" | "flight" | "other";

/** What the fly knew about a period when it acted: the efference copy, its proprioception and its heading estimate. */
export interface PeriodContext {
  kind: PeriodKind;
  /** The period's length (s), physics steps in it and their length (s). */
  T: number;
  steps: number;
  h: number;
  /** Walking: leg speed when the command went out, and the commanded leg speed (m/s). */
  legSpeed0: number;
  legCommand: number;
  /** The walking speed's time constant (s): the body schema's. */
  tau: number;
  /** Walking or flight: the commanded yaw rate (rad/s). */
  turnCommand: number;
  /** Flight: the commanded horizontal speed (m/s). */
  airSpeed: number;
  /** The fly's own estimate of its heading when the period began (rad). */
  heading: number;
  /** Whether the period can teach: a settled, predictable period with nothing interrupting it. */
  learnable: boolean;
}

export interface Prediction {
  /** Expected forward and leftward displacement (m) and turn (rad) over the period. */
  y: [number, number, number];
  /** ∂y/∂x, 3 × N row-major. */
  H: number[];
  /** The innate sense's expected noise on each component (sd), before the fly's own rescaling. */
  sd: [number, number, number];
}

/** A period that cannot be predicted: nothing is expected, and its spread is wide. */
const UNKNOWN_SD = 0.05;

/** The expected self-motion over the period, from beliefs `x`. */
export function predict(x: readonly number[], c: PeriodContext): Prediction {
  const H = new Array<number>(3 * N).fill(0);
  const cosH = Math.cos(c.heading),
    sinH = Math.sin(c.heading);
  // Outside drift in the frame the body faces at the start: forward, left.
  const wf = x[X.driftX]! * cosH - x[X.driftZ]! * sinH,
    wl = -x[X.driftX]! * sinH - x[X.driftZ]! * cosH;
  const drift = (row: number, ax: number, az: number) => {
    H[row * N + X.driftX] = ax * c.T;
    H[row * N + X.driftZ] = az * c.T;
  };
  let y: [number, number, number];
  let model = 0;
  switch (c.kind) {
    case "still": {
      y = [wf * c.T, wl * c.T, x[X.spin]! * c.T];
      drift(0, cosH, -sinH);
      drift(1, -sinH, -cosH);
      H[2 * N + X.spin] = c.T;
      break;
    }
    case "walk": {
      // The body's walking law, step by step: the legs' speed eases toward
      // the command, the heading turns at the period's rate, and each step
      // carries the body along its new heading.
      const g = x[X.legGain]!;
      const rate = x[X.legTurnGain]! * c.turnCommand + x[X.legTurnBias]! + x[X.spin]!;
      const a = c.tau > 0 ? Math.exp(-c.h / c.tau) : 0;
      let v = c.legSpeed0,
        sc = 0,
        ss = 0,
        kc = 0,
        ks = 0;
      for (let k = 1; k <= c.steps; k++) {
        v = c.legCommand + (v - c.legCommand) * a;
        const phi = k * c.h * rate;
        const d = v * c.h,
          lever = k * c.h;
        sc += d * Math.cos(phi);
        ss += d * Math.sin(phi);
        kc += d * lever * Math.cos(phi);
        ks += d * lever * Math.sin(phi);
      }
      y = [g * sc + wf * c.T, g * ss + wl * c.T, rate * c.T];
      H[0 * N + X.legGain] = sc;
      H[1 * N + X.legGain] = ss;
      const dRate = (row: number, dy: number) => {
        H[row * N + X.legTurnGain] = dy * c.turnCommand;
        H[row * N + X.legTurnBias] = dy;
        H[row * N + X.spin] = dy;
      };
      dRate(0, -g * ks);
      dRate(1, g * kc);
      dRate(2, c.T);
      drift(0, cosH, -sinH);
      drift(1, -sinH, -cosH);
      break;
    }
    case "flight": {
      const g = x[X.wingGain]!;
      const rate = x[X.wingTurnGain]! * c.turnCommand + x[X.wingTurnBias]!;
      y = [g * c.airSpeed * c.T + wf * c.T, wl * c.T, rate * c.T];
      H[0 * N + X.wingGain] = c.airSpeed * c.T;
      H[2 * N + X.wingTurnGain] = c.turnCommand * c.T;
      H[2 * N + X.wingTurnBias] = c.T;
      drift(0, cosH, -sinH);
      drift(1, -sinH, -cosH);
      // The velocity tracker's residual lag, which a steady period still holds a little of.
      model = 0.05 * c.airSpeed * c.T;
      break;
    }
    case "other":
      return { y: [0, 0, 0], H, sd: [UNKNOWN_SD, UNKNOWN_SD, UNKNOWN_SD * 10] };
  }
  const k = Math.sqrt(c.T / SELF_MOTION_NOISE.periodS);
  const N0 = SELF_MOTION_NOISE;
  const sdT = (v: number) =>
    N0.translationM * k + N0.translationShare * Math.abs(v) + model;
  return {
    y,
    H,
    sd: [sdT(y[0]), sdT(y[1]), N0.turnRad * k + N0.turnShare * Math.abs(y[2])],
  };
}
