/**
 * The self-model's forward model: what the fly expects its self-motion sense
 * to report over the next decision period, given what it commanded
 * (efference copy), what its legs were doing when it commanded it
 * (proprioception), its own estimate of where it faces, and its beliefs about
 * its body and its surroundings.
 *
 * The beliefs are eleven numbers (`X`):
 *
 * - its legs' speed gain, turning gain and turning bias (how far a step
 *   carries it, how far a commanded turn turns it, how far it turns unbidden);
 * - the same three for its wings;
 * - a drift (x, z, m/s) carrying it from outside, in its own heading frame,
 *   on a surface or in the air, and an outside turn (rad/s) of a surface
 *   under it;
 * - the air's velocity (x, z, m/s) in the same frame: the wind, which its
 *   antennae feel (`predictAir`). It moves the fly only as its body lets it:
 *   not at all on a surface or hovering, and in cruise only across its
 *   heading, since its wings hold its groundspeed along it (up to their
 *   limit, and never flying backward through the air), and its velocity
 *   follows a changing wind only after the body's velocity time constant, so
 *   what it holds slips by that much of the wind's change. That is the
 *   body's rule (fly.ts), part of the body schema the fly is given; the drift
 *   is what nothing in its schema explains. Until its antennae first feel
 *   the air move the fly takes the air to be still, with no doubt, and
 *   predicts exactly as it would without these two beliefs.
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
  windX: 9,
  windZ: 10,
} as const;
export const N = 11;
/** What the fly believes about itself and about its surroundings, by index. */
export const SELF = [0, 1, 2, 3, 4, 5] as const;
export const OUTSIDE = [6, 7, 8, 9, 10] as const;
export const GAINS = [0, 1, 3, 4] as const;
export const BIASES = [2, 5] as const;
/** The air's velocity: tracked as the antennae feel it, not learned from experience. */
export const WIND = [9, 10] as const;
/** Everything but the air: what experience teaches the fly. */
export const LEARNED = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
/** The innate beliefs: an unimpaired body in still surroundings. */
export const INNATE: readonly number[] = Object.freeze([1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0]);
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
  "wind x",
  "wind z",
] as const;

export type PeriodKind = "still" | "walk" | "flight" | "other";
export type CruiseRegime = "held" | "limit" | "carried";

/** Which of the wings' regimes a cruise is in, by what the fly believes of the wind ahead (`af`, m/s). */
export function cruiseRegime(
  x: readonly number[],
  c: PeriodContext,
  af: number,
): CruiseRegime {
  if (c.regime) return c.regime;
  const air = x[X.wingGain]! * c.airSpeed - af;
  return air < 0 ? "carried" : air > c.airMax ? "limit" : "held";
}

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
  /** Flight: the commanded horizontal speed (m/s), and whether the command is a hover. */
  airSpeed: number;
  hover: boolean;
  /** The wings' top air speed (m/s): the body schema's. */
  airMax: number;
  /** Whether the fly tracks the air: its antennae have felt it move. */
  wind: boolean;
  /** The flight velocity's time constant (s): the body schema's. */
  flightTau: number;
  /** How fast the fly takes the wind to be changing (m/s per s, x and z in its frame). */
  windRate: [number, number];
  /**
   * In flight in wind, how much further the body went than its wings' hold
   * over the period (m, x and z in its frame): its air velocity follows a
   * change only after the body's flight velocity time constant, so it went
   * that constant times the change in the air going by between the period's
   * ends, as its antennae felt it. Exact for the body's velocity tracker
   * (fly.ts) short of its acceleration limit. 0 elsewhere.
   */
  airLag: [number, number];
  /** How far `airLag` may be off for the antennae's spread (m). */
  airLagSd: number;
  /**
   * In cruise in wind, what its antennae said at the period's end: its wings
   * held its groundspeed (`held`), the air went by at their limit (`limit`),
   * or none came from ahead and the wind carried it (`carried`); null before
   * they have said, when its beliefs decide.
   */
  regime: CruiseRegime | null;
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

/**
 * A vector in the fly's frame (x, z) as forward and left of a heading (its
 * cosine and sine), and back: the turn is its own inverse.
 */
export const rotated = (
  v: readonly number[],
  cosH: number,
  sinH: number,
): [number, number] => [v[0]! * cosH - v[1]! * sinH, -v[0]! * sinH - v[1]! * cosH];

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
      if (c.wind) {
        // In cruise the wings hold the groundspeed along the heading, up to
        // their limit and never backward through the air, and the wind
        // across the heading carries the body; hovering, they hold it still.
        // The body goes further than they hold while it catches up with a change.
        const af = x[X.windX]! * cosH - x[X.windZ]! * sinH,
          al = -x[X.windX]! * sinH - x[X.windZ]! * cosH;
        const [lf, ll] = rotated(c.airLag, cosH, sinH);
        if (c.hover) y = [lf + wf * c.T, ll + wl * c.T, rate * c.T];
        else {
          const regime = cruiseRegime(x, c, af);
          const along =
            regime === "held"
              ? g * c.airSpeed
              : regime === "carried"
                ? af
                : c.airMax + af;
          y = [along * c.T + wf * c.T + lf, (wl + al) * c.T + ll, rate * c.T];
          if (regime === "held") H[0 * N + X.wingGain] = c.airSpeed * c.T;
          else {
            H[0 * N + X.windX] = cosH * c.T;
            H[0 * N + X.windZ] = -sinH * c.T;
          }
          H[1 * N + X.windX] = -sinH * c.T;
          H[1 * N + X.windZ] = -cosH * c.T;
        }
        model = c.airLagSd;
      } else {
        y = [g * c.airSpeed * c.T + wf * c.T, wl * c.T, rate * c.T];
        H[0 * N + X.wingGain] = c.airSpeed * c.T;
      }
      H[2 * N + X.wingTurnGain] = c.turnCommand * c.T;
      H[2 * N + X.wingTurnBias] = c.T;
      drift(0, cosH, -sinH);
      drift(1, -sinH, -cosH);
      // The velocity tracker's residual lag, which a steady period still holds a little of.
      model += 0.05 * c.airSpeed * c.T;
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

/** One reading the antennae should give: its value and ∂/∂x. */
export interface AirRow {
  y: number;
  H: number[];
}

/**
 * What the antennae should feel at the end of a period the fly could
 * predict: the air going by, forward and left (m/s) in the frame it faces
 * then (`heading`). Standing, walking or hovering, that is the wind less its
 * own motion over the ground; in cruise it is its own air speed, held along
 * its heading, so only the forward reading tells anything (the wind across
 * the heading carries the body and goes by it at nothing). In flight what the
 * wings hold lags the wind's change by their time constant. `legSpeed` is the
 * legs' stepping speed then (m/s).
 */
export function predictAir(
  x: readonly number[],
  c: PeriodContext,
  heading: number,
  legSpeed: number,
): AirRow[] {
  const cosH = Math.cos(heading),
    sinH = Math.sin(heading);
  const af = x[X.windX]! * cosH - x[X.windZ]! * sinH,
    al = -x[X.windX]! * sinH - x[X.windZ]! * cosH;
  const row = (y: number, ax: number, az: number): AirRow => {
    const H = new Array<number>(N).fill(0);
    H[X.windX] = ax;
    H[X.windZ] = az;
    return { y, H };
  };
  const ahead = (y: number) => row(y, cosH, -sinH);
  const left = (y: number) => row(y, -sinH, -cosH);
  switch (c.kind) {
    case "still":
      return [ahead(af), left(al)];
    case "walk":
      return [ahead(af - x[X.legGain]! * legSpeed), left(al)];
    case "flight": {
      const [rf, rl] = rotated(c.windRate, cosH, sinH);
      if (c.hover) return [ahead(af - rf * c.flightTau), left(al - rl * c.flightTau)];
      // Beyond what the wings hold, the reading no longer follows the wind.
      if (cruiseRegime(x, c, af) !== "held") return [];
      return [ahead(af - x[X.wingGain]! * c.airSpeed - rf * c.flightTau)];
    }
    case "other":
      return [];
  }
}
