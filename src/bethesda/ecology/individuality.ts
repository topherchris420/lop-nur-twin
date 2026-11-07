/**
 * Individuality measures for long lives (R.A.I.N. Genesis Stage E): whether
 * flies of different seeds, started in identical yards at the same place,
 * keep ways of living that differ between them more than a fly's own days
 * differ.
 *
 * - For a number per fly per day (food taken, time flying, distance), the
 *   repeatability ICC(1) = (MSB − MSW) / (MSB + (k − 1) MSW), the share of
 *   the variance that lies between flies (Bell, Hankison & Laskowski 2009 use
 *   it for animal personality).
 * - For a profile per fly per day (where in the yard it spends its time, at
 *   which hours it is active, which food sites it feeds at), a signature index
 *   1 − within / between: `within` the mean distance between two of a fly's
 *   own days, `between` the mean distance between two flies on the same day.
 *   0 when a fly is no more like itself than like the others; 1 when each fly
 *   repeats itself exactly.
 *
 * Each has a permutation null that keeps every day's set of values and
 * shuffles which fly each belongs to, independently per day: it removes
 * identity and keeps whatever the days share (weather, season of the fruit).
 */
import { mulberry32 } from "../../lib/noise.js";

/** ICC(1) of a flies × days table (every fly the same number of days). */
export function repeatability(x: readonly (readonly number[])[]): number {
  const n = x.length;
  const k = x[0]?.length ?? 0;
  if (n < 2 || k < 2) return 0;
  const grand = x.flat().reduce((a, b) => a + b, 0) / (n * k);
  const means = x.map((r) => r.reduce((a, b) => a + b, 0) / k);
  const ssb = k * means.reduce((a, m) => a + (m - grand) ** 2, 0);
  const ssw = x.reduce(
    (a, r, i) => a + r.reduce((b, v) => b + (v - means[i]!) ** 2, 0),
    0,
  );
  const msb = ssb / (n - 1);
  const msw = ssw / (n * (k - 1));
  const denom = msb + (k - 1) * msw;
  return denom > 0 ? (msb - msw) / denom : 0;
}

/** Euclidean distance between two profiles of equal length. */
const dist = (a: readonly number[], b: readonly number[]) =>
  Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]!) ** 2, 0));

/** 1 − within/between of a flies × days table of profiles. */
export function signature(x: readonly (readonly (readonly number[])[])[]): number {
  const n = x.length;
  const k = x[0]?.length ?? 0;
  let w = 0,
    nw = 0,
    b = 0,
    nb = 0;
  for (let i = 0; i < n; i++)
    for (let d = 0; d < k; d++)
      for (let e = d + 1; e < k; e++) {
        w += dist(x[i]![d]!, x[i]![e]!);
        nw++;
      }
  for (let d = 0; d < k; d++)
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        b += dist(x[i]![d]!, x[j]![d]!);
        nb++;
      }
  if (!nw || !nb || b === 0) return 0;
  return 1 - w / nw / (b / nb);
}

/** The table with fly identities shuffled independently within each day. */
function shuffleWithinDays<T>(x: readonly (readonly T[])[], rng: () => number): T[][] {
  const n = x.length;
  const k = x[0]?.length ?? 0;
  const out: T[][] = Array.from({ length: n }, () => new Array<T>(k));
  for (let d = 0; d < k; d++) {
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    for (let i = 0; i < n; i++) out[i]![d] = x[order[i]!]![d]!;
  }
  return out;
}

export interface Tested {
  value: number;
  /** One-sided permutation p: the share of shuffles at least as large (with the observed one counted). */
  p: number;
  null_mean: number;
  null_95: number;
}

export function permutationTest<T>(
  x: readonly (readonly T[])[],
  stat: (t: readonly (readonly T[])[]) => number,
  shuffles: number,
  seed: number,
): Tested {
  const value = stat(x);
  const rng = mulberry32(seed >>> 0);
  const nulls: number[] = [];
  let ge = 0;
  for (let s = 0; s < shuffles; s++) {
    const v = stat(shuffleWithinDays(x, rng));
    nulls.push(v);
    if (v >= value) ge++;
  }
  nulls.sort((a, b) => a - b);
  const r6 = (v: number) => Number(v.toPrecision(6));
  return {
    value: r6(value),
    p: r6((ge + 1) / (shuffles + 1)),
    null_mean: r6(nulls.reduce((a, b) => a + b, 0) / Math.max(1, nulls.length)),
    null_95: r6(nulls[Math.min(nulls.length - 1, Math.floor(0.95 * nulls.length))] ?? 0),
  };
}

/** A dictionary of shares as a vector over the given keys (missing keys are 0). */
export const toVector = (d: Record<string, number>, keys: readonly string[]) =>
  keys.map((k) => d[k] ?? 0);

/** A vector scaled to sum to 1 (all zeros stays all zeros). */
export function normalized(v: readonly number[]): number[] {
  const s = v.reduce((a, b) => a + b, 0);
  return s > 0 ? v.map((x) => x / s) : v.map(() => 0);
}
