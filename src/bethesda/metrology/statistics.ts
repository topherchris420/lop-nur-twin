/**
 * The bench's statistics. The experimental unit is the research subject (one
 * seed in one condition); each unit runs once under each controller from the
 * same genesis, so comparisons are paired differences per unit, never per tick.
 *
 * - Effect: the mean paired difference (candidate minus reference), in the
 *   metric's unit, and the standardized `dz` (mean over the SD of differences).
 * - Uncertainty: a seeded percentile bootstrap of the mean difference over
 *   units, at the family's level (Bonferroni: 1 − α/m), with its stream fixed
 *   per comparison label so the same records always print the same interval.
 * - A nonparametric check: counts of better / worse / tied units and an exact
 *   two-sided sign test.
 * - The decision (`decide`): statistical evidence and practical size are
 *   judged together against the preregistered minimum meaningful effect δ:
 *
 *     REGRESSION                   the interval lies wholly on the worse side of 0
 *     IMPROVEMENT                  it lies wholly on the better side of 0 and the
 *                                  mean is at least δ
 *     NO_DEMONSTRATED_IMPROVEMENT  it lies wholly inside (−δ, +δ): any effect is
 *                                  smaller than meaningful
 *     INCONCLUSIVE                 anything else (too wide to tell)
 *
 *   Any interval wholly below zero counts as a regression, however small; the
 *   `practical` flag says whether it reaches δ. An upgrade has to earn its
 *   place, so the rule leans toward the baseline.
 *
 * Pure: same inputs, same outputs, on any machine.
 */
import { mulberry32 } from "../../lib/noise.js";
import { sha256 } from "../../rain/sha256.js";

export type Direction = "higher" | "lower";

export interface Interval {
  n: number;
  mean: number;
  sd: number;
  /** Mean over SD of the paired differences; null when the SD is 0. */
  dz: number | null;
  level: number;
  low: number;
  high: number;
  better: number;
  worse: number;
  tied: number;
  /** Exact two-sided sign test over the untied units. */
  signP: number;
}

export const mean = (xs: readonly number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** A stream seed for one comparison: the protocol's seed and the label, hashed. */
export function streamSeed(seed: number, label: string): number {
  return (parseInt(sha256(`${seed}:${label}`).slice(0, 8), 16) ^ seed) >>> 0;
}

/** Exact two-sided binomial sign test, p = 1/2. */
export function signTestP(better: number, worse: number): number {
  const n = better + worse;
  if (n === 0) return 1;
  const k = Math.min(better, worse);
  // P(X ≤ k) for X ~ Bin(n, 1/2), summed in log space for stability.
  let logC = 0,
    tail = 0;
  for (let i = 0; i <= k; i++) {
    if (i > 0) logC += Math.log(n - i + 1) - Math.log(i);
    tail += Math.exp(logC - n * Math.LN2);
  }
  return Math.min(1, 2 * tail);
}

const EPS = 1e-12;

/**
 * The paired mean difference and its percentile-bootstrap interval at `level`.
 * `direction` only decides which differences count as better.
 */
export function pairedInterval(
  diffs: readonly number[],
  opts: {
    resamples: number;
    seed: number;
    label: string;
    level: number;
    direction: Direction;
  },
): Interval {
  const n = diffs.length;
  const m = mean(diffs);
  const s = sd(diffs);
  const sign = opts.direction === "higher" ? 1 : -1;
  const better = diffs.filter((d) => d * sign > EPS).length;
  const worse = diffs.filter((d) => d * sign < -EPS).length;
  const tied = n - better - worse;
  if (n === 0)
    return {
      n,
      mean: NaN,
      sd: 0,
      dz: null,
      level: opts.level,
      low: NaN,
      high: NaN,
      better,
      worse,
      tied,
      signP: 1,
    };
  const rng = mulberry32(streamSeed(opts.seed, opts.label));
  const means = new Float64Array(opts.resamples);
  for (let r = 0; r < opts.resamples; r++) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc += diffs[Math.floor(rng() * n)]!;
    means[r] = acc / n;
  }
  means.sort();
  const tail = (1 - opts.level) / 2;
  const at = (q: number) =>
    means[Math.min(means.length - 1, Math.max(0, Math.floor(q * means.length)))]!;
  return {
    n,
    mean: m,
    sd: s,
    dz: s > EPS ? m / s : null,
    level: opts.level,
    low: at(tail),
    high: at(1 - tail),
    better,
    worse,
    tied,
    signP: signTestP(better, worse),
  };
}

export type ComparisonVerdict =
  "IMPROVEMENT" | "NO_DEMONSTRATED_IMPROVEMENT" | "REGRESSION" | "INCONCLUSIVE";

export interface Decision {
  verdict: ComparisonVerdict;
  /** Whether the mean difference reaches the minimum meaningful effect (in the better or worse direction). */
  practical: boolean;
  reason: string;
}

/** The decision rule above, for one comparison. */
export function decide(i: Interval, direction: Direction, mme: number): Decision {
  if (!(mme > 0)) throw new Error("a minimum meaningful effect is positive");
  if (i.n === 0 || !Number.isFinite(i.low) || !Number.isFinite(i.high))
    return { verdict: "INCONCLUSIVE", practical: false, reason: "no paired units" };
  const s = direction === "higher" ? 1 : -1;
  const low = s > 0 ? i.low : -i.high;
  const high = s > 0 ? i.high : -i.low;
  const m = s * i.mean;
  const practical = Math.abs(m) >= mme;
  const pct = `${Math.round(i.level * 1000) / 10}%`;
  if (high < 0)
    return {
      verdict: "REGRESSION",
      practical,
      reason: `the ${pct} interval lies wholly on the worse side of zero${practical ? "" : ", though its mean is smaller than the minimum meaningful effect"}`,
    };
  if (low > 0 && m >= mme)
    return {
      verdict: "IMPROVEMENT",
      practical: true,
      reason: `the ${pct} interval lies above zero and the mean reaches the minimum meaningful effect`,
    };
  if (low >= -mme && high <= mme)
    return {
      verdict: "NO_DEMONSTRATED_IMPROVEMENT",
      practical: false,
      reason: `the ${pct} interval lies inside ±${mme}: any effect is smaller than the minimum meaningful effect`,
    };
  return {
    verdict: "INCONCLUSIVE",
    practical,
    reason:
      low > 0
        ? `the ${pct} interval lies above zero but the mean is below the minimum meaningful effect while the interval reaches past it`
        : `the ${pct} interval spans zero and reaches beyond ±${mme}: these units cannot tell`,
  };
}

/** A descriptive reading for metrics with no minimum meaningful effect: never a verdict. */
export function reading(
  i: Interval,
  direction: Direction | "neutral",
): "better" | "worse" | "higher" | "lower" | "no difference detected" {
  if (i.n === 0 || !(i.low > 0 || i.high < 0)) return "no difference detected";
  if (direction === "neutral") return i.low > 0 ? "higher" : "lower";
  const up = i.low > 0;
  return (direction === "higher") === up ? "better" : "worse";
}
