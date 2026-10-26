/**
 * The self-model's beliefs as a Gaussian over the eleven numbers of
 * forward.ts, revised by every period that can teach (an extended Kalman
 * filter, Kalman 1960): predict, compare with what the self-motion sense
 * reported, and move each belief by as much as its own uncertainty and the
 * sense's warrant. The antennae's readings of the air revise the wind the
 * same way (`feelAir`).
 *
 * `frozen` beliefs are never moved (a learning-disabled self-model freezes
 * them all); `noiseScale` is the fly's own rescaling of how noisy it takes
 * its sense to be (metacognition.ts).
 */
import {
  add,
  diag,
  identity,
  inverse3,
  mul,
  quad3,
  sub,
  symmetrize,
  transpose,
  zeros,
} from "./linalg.js";
import {
  N,
  predict,
  type AirRow,
  type PeriodContext,
  type Prediction,
} from "./forward.js";

export interface Belief {
  x: number[];
  /** N × N covariance, row-major. */
  P: number[];
}

export interface Update {
  prediction: Prediction;
  /** Observed less predicted. */
  innovation: [number, number, number];
  /** Innovation covariance (3 × 3) and its diagonal's square root. */
  S: number[];
  sd: [number, number, number];
  /** Normalized innovation squared: χ² with three degrees of freedom when the model is right. */
  nis: number;
  /** ln of the predictive density of the observation. */
  logLik: number;
  /** The residual after the update, for scores that ignore uncertainty. */
  residual: [number, number, number];
  /** False when the update would have made a belief non-finite and was refused. */
  ok: boolean;
}

export const cloneBelief = (b: Belief): Belief => ({ x: b.x.slice(), P: b.P.slice() });

/** Grow uncertainty over `T` seconds: each belief may have wandered by its process spread. */
export function diffuse(b: Belief, T: number, processSd: readonly number[]): Belief {
  const P = b.P.slice();
  for (let i = 0; i < N; i++) P[i * N + i]! += processSd[i]! * processSd[i]! * T;
  return { x: b.x, P };
}

/** Widen the spread of the given beliefs by `sd` each (a new hypothesis's freedom). */
export function widen(b: Belief, indices: readonly number[], sd: number): Belief {
  const P = b.P.slice();
  for (const i of indices) P[i * N + i]! += sd * sd;
  return { x: b.x.slice(), P };
}

/** Set the given beliefs to `values` with spread `sd` and no correlation with the rest. */
export function assume(
  b: Belief,
  indices: readonly number[],
  values: readonly number[],
  sd: number,
): Belief {
  const x = b.x.slice(),
    P = b.P.slice();
  for (const i of indices) {
    x[i] = values[i]!;
    for (let j = 0; j < N; j++) {
      P[i * N + j] = 0;
      P[j * N + i] = 0;
    }
    P[i * N + i] = sd * sd;
  }
  return { x, P };
}

/** The prediction and its spread, without learning anything. */
export function expect(
  b: Belief,
  c: PeriodContext,
  noiseScale: number,
): { prediction: Prediction; S: number[]; sd: [number, number, number] } {
  const prediction = predict(b.x, c);
  const { H } = prediction;
  const R = diag(prediction.sd.map((s) => (s * noiseScale) ** 2));
  const S = add(mul(mul(H, b.P, 3, N, N), transpose(H, 3, N), 3, N, 3), R);
  return {
    prediction,
    S,
    sd: [Math.sqrt(S[0]!), Math.sqrt(S[4]!), Math.sqrt(S[8]!)],
  };
}

/**
 * One period's update. Returns the revised belief and what the period
 * showed; an update that would leave anything non-finite is refused and the
 * belief kept.
 */
export function update(
  b: Belief,
  c: PeriodContext,
  y: readonly [number, number, number],
  noiseScale: number,
  frozen: ReadonlySet<number> | null,
): { belief: Belief; update: Update } {
  const prediction = predict(b.x, c);
  const { H } = prediction;
  const R = diag(prediction.sd.map((s) => (s * noiseScale) ** 2));
  const Ht = transpose(H, 3, N);
  const PHt = mul(b.P, Ht, N, N, 3);
  const S = add(mul(H, PHt, 3, N, 3), R);
  const innovation: [number, number, number] = [
    y[0] - prediction.y[0],
    y[1] - prediction.y[1],
    y[2] - prediction.y[2],
  ];
  const sd: [number, number, number] = [
    Math.sqrt(S[0]!),
    Math.sqrt(S[4]!),
    Math.sqrt(S[8]!),
  ];
  const inv = inverse3(S);
  const refused = (): { belief: Belief; update: Update } => ({
    belief: b,
    update: {
      prediction,
      innovation,
      S,
      sd,
      nis: 0,
      logLik: 0,
      residual: innovation,
      ok: false,
    },
  });
  if (!inv || !(inv.det > 0)) return refused();
  const nis = quad3(innovation, inv.inv);
  const logLik = -0.5 * (nis + Math.log(inv.det) + 3 * Math.log(2 * Math.PI));
  const K = mul(PHt, inv.inv, N, 3, 3);
  if (frozen) for (const i of frozen) for (let j = 0; j < 3; j++) K[i * 3 + j] = 0;
  const x = b.x.slice();
  for (let i = 0; i < N; i++)
    x[i]! +=
      K[i * 3]! * innovation[0] +
      K[i * 3 + 1]! * innovation[1] +
      K[i * 3 + 2]! * innovation[2];
  // Joseph form: stays a covariance for any gain, the frozen rows' zero gain included.
  const IKH = sub(identity(N), mul(K, H, N, 3, N));
  const P = symmetrize(
    add(
      mul(mul(IKH, b.P, N, N, N), transpose(IKH, N, N), N, N, N),
      mul(mul(K, R, N, 3, 3), transpose(K, N, 3), N, 3, N),
    ),
    N,
  );
  if (![...x, ...P, nis, logLik].every(Number.isFinite)) return refused();
  const after = predict(x, c).y;
  return {
    belief: { x, P },
    update: {
      prediction,
      innovation,
      S,
      sd,
      nis,
      logLik,
      residual: [y[0] - after[0], y[1] - after[1], y[2] - after[2]],
      ok: true,
    },
  };
}

/** A belief's standard deviations. */
export const spreads = (b: Belief): number[] =>
  zeros(N).map((_, i) => Math.sqrt(Math.max(0, b.P[i * N + i]!)));

/**
 * The antennae's readings `readings` against what they should be (`rows`,
 * from `predictAir`), each with its expected spread `sd`. Their errors are
 * independent, so taking them one at a time is the same as all at once.
 * Returns the revised belief and the readings' ln predictive density; a
 * reading that would leave anything non-finite is refused, with the rest.
 */
export function feelAir(
  b: Belief,
  rows: readonly AirRow[],
  readings: readonly number[],
  sd: readonly number[],
): { belief: Belief; logLik: number; ok: boolean } {
  const x = b.x.slice();
  let P = b.P.slice();
  let logLik = 0;
  for (let r = 0; r < rows.length; r++) {
    const { H } = rows[r]!;
    // The rows are linear in what the readings revise: each earlier one's revision moves the later predictions by H.
    let y = rows[r]!.y;
    for (let i = 0; i < N; i++) y += H[i]! * (x[i]! - b.x[i]!);
    const PH = zeros(N);
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) PH[i]! += P[i * N + j]! * H[j]!;
    let s = sd[r]! * sd[r]!;
    for (let i = 0; i < N; i++) s += H[i]! * PH[i]!;
    const innovation = readings[r]! - y;
    if (!(s > 0) || !Number.isFinite(innovation))
      return { belief: b, logLik: 0, ok: false };
    const next = P.slice();
    for (let i = 0; i < N; i++) {
      x[i]! += (PH[i]! / s) * innovation;
      for (let j = 0; j < N; j++) next[i * N + j]! -= (PH[i]! * PH[j]!) / s;
    }
    P = next;
    logLik +=
      -0.5 * ((innovation * innovation) / s + Math.log(s) + Math.log(2 * Math.PI));
  }
  if (![...x, ...P, logLik].every(Number.isFinite))
    return { belief: b, logLik: 0, ok: false };
  return { belief: { x, P }, logLik, ok: true };
}
