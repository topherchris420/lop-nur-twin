/**
 * The exact statistics the claims register computes for itself.
 *
 * Where an entry says it "computed" a figure from per-seed records, a binding
 * recomputes it here. Everything is exact: counts are integers, and binomial
 * tails are summed as big integers before one division, so a p-value is the
 * same number on every machine.
 */

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error("the mean of no values is undefined");
  return sum(values) / values.length;
}

/** The median; the mean of the two middle values when the count is even. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("the median of no values is undefined");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function choose(n: number, k: number): bigint {
  let c = 1n;
  for (let i = 1; i <= k; i++) c = (c * BigInt(n - k + i)) / BigInt(i);
  return c;
}

/** P(X >= k) for X ~ Binomial(n, 1/2), exactly. */
export function upperTailHalf(n: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0)
    throw new Error("a binomial tail needs whole counts");
  if (k <= 0) return 1;
  if (k > n) return 0;
  let ways = 0n;
  for (let i = k; i <= n; i++) ways += choose(n, i);
  // One division of two exact integers; scaled so the quotient keeps 18 digits.
  const scale = 10n ** 18n;
  return Number((ways * scale) / (1n << BigInt(n))) / 1e18;
}

export interface SignTest {
  positive: number;
  negative: number;
  ties: number;
  /** Exact one-sided p that as many or more pairs are positive, ties dropped. */
  pPositive: number;
  /** Exact one-sided p that as many or more pairs are negative, ties dropped. */
  pNegative: number;
  /** Exact two-sided p: twice the smaller tail, at most 1. */
  pTwoSided: number;
}

/** The exact sign test on paired differences, ties dropped. */
export function signTest(differences: readonly number[]): SignTest {
  const positive = differences.filter((d) => d > 0).length;
  const negative = differences.filter((d) => d < 0).length;
  const ties = differences.length - positive - negative;
  const untied = positive + negative;
  const pPositive = upperTailHalf(untied, positive);
  const pNegative = upperTailHalf(untied, negative);
  return {
    positive,
    negative,
    ties,
    pPositive,
    pNegative,
    pTwoSided: Math.min(1, 2 * Math.min(pPositive, pNegative)),
  };
}
