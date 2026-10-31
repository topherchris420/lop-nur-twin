/**
 * Deterministic interval estimates for the first-contact studies: no
 * resampling, so a report reproduces byte for byte.
 *
 * - Wilson's score interval for one proportion (Wilson 1927).
 * - Newcombe's hybrid score interval for a difference of two independent
 *   proportions (Newcombe 1998, method 10), built from the two Wilson
 *   intervals.
 * - Fisher's exact test, two-sided, for a 2×2 table (the probabilities of
 *   all tables no more likely than the observed one).
 * - A normal-approximation interval for a difference of two means (Welch's
 *   standard error), for secondary continuous measures only.
 */

/** z for a two-sided 95% interval. */
export const Z95 = 1.959963984540054;

export interface Interval {
  estimate: number;
  low: number;
  high: number;
}

export function wilson(successes: number, n: number, z = Z95): Interval | null {
  if (!(n > 0) || successes < 0 || successes > n) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    estimate: p,
    low: Math.max(0, centre - half),
    high: Math.min(1, centre + half),
  };
}

/** Newcombe's interval for p1 − p2. */
export function newcombe(
  s1: number,
  n1: number,
  s2: number,
  n2: number,
  z = Z95,
): Interval | null {
  const a = wilson(s1, n1, z),
    b = wilson(s2, n2, z);
  if (!a || !b) return null;
  const d = a.estimate - b.estimate;
  const low = d - Math.sqrt((a.estimate - a.low) ** 2 + (b.high - b.estimate) ** 2);
  const high = d + Math.sqrt((a.high - a.estimate) ** 2 + (b.estimate - b.low) ** 2);
  return { estimate: d, low: Math.max(-1, low), high: Math.min(1, high) };
}

function logFactorials(n: number): Float64Array {
  const f = new Float64Array(n + 1);
  for (let i = 2; i <= n; i++) f[i] = f[i - 1]! + Math.log(i);
  return f;
}

/** Two-sided Fisher exact p for successes s1 of n1 against s2 of n2. */
export function fisherExact(
  s1: number,
  n1: number,
  s2: number,
  n2: number,
): number | null {
  if (!(n1 > 0 && n2 > 0) || s1 < 0 || s2 < 0 || s1 > n1 || s2 > n2) return null;
  const k = s1 + s2,
    n = n1 + n2;
  const lf = logFactorials(n);
  const logP = (x: number) =>
    lf[k]! +
    lf[n - k]! +
    lf[n1]! +
    lf[n2]! -
    lf[n]! -
    lf[x]! -
    lf[k - x]! -
    lf[n1 - x]! -
    lf[n2 - k + x]!;
  const lo = Math.max(0, k - n2),
    hi = Math.min(k, n1);
  const observed = logP(s1);
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    const lp = logP(x);
    if (lp <= observed + 1e-7) p += Math.exp(lp);
  }
  return Math.min(1, p);
}

export function mean(xs: readonly number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Difference of means a − b with a Welch standard error, normal approximation. */
export function meanDifference(
  a: readonly number[],
  b: readonly number[],
  z = Z95,
): Interval | null {
  if (a.length < 2 || b.length < 2) return null;
  const ma = mean(a)!,
    mb = mean(b)!;
  const va = a.reduce((s, x) => s + (x - ma) ** 2, 0) / (a.length - 1);
  const vb = b.reduce((s, x) => s + (x - mb) ** 2, 0) / (b.length - 1);
  const se = Math.sqrt(va / a.length + vb / b.length);
  const d = ma - mb;
  return { estimate: d, low: d - z * se, high: d + z * se };
}

/** Rounds for a report: fixed digits, no "-0". */
export function r(x: number | null, digits = 4): number | null {
  if (x === null || !Number.isFinite(x)) return null;
  const k = 10 ** digits;
  const v = Math.round(x * k) / k;
  return Object.is(v, -0) ? 0 : v;
}
