import { mulberry32 } from "../../lib/noise.js";

/**
 * The statistics an evaluation is allowed to print, and the rules for when it
 * is allowed to print them.
 *
 * Two commitments shape everything here:
 *
 *  - **n is always carried.** Every summary says how many samples it came
 *    from, and a figure the sample cannot support is `null` with a reason, not
 *    a number. A 99th percentile of forty latencies is the maximum wearing a
 *    lab coat; it is reported as unsupported.
 *  - **Nothing claims significance.** Intervals are descriptive: a 95 %
 *    interval for a mean under the assumption that the episodes are
 *    exchangeable draws. Episodes in Blacksite are not guaranteed to be that —
 *    frame pacing is not deterministic and the same seed diverges within
 *    seconds — so an interval here is a statement about spread, and the
 *    documentation says so. Below `MIN_CI_N` samples none is computed.
 *
 * Percentiles are nearest-rank, matching `pilot/metrics.ts`, so a figure in an
 * evaluation and the same figure in a benchmark report agree.
 */

/** Fewest samples for which a confidence interval is computed at all. */
export const MIN_CI_N = 3;

/**
 * Fewest samples for which each tail percentile is reported. Below these a
 * percentile is determined by one or two samples and is really the maximum.
 */
export const PERCENTILE_MIN_N: Readonly<Record<"p90" | "p95" | "p99", number>> = {
  p90: 10,
  p95: 20,
  p99: 100,
};

export function mean(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  let sum = 0;
  for (const value of samples) sum += value;
  return sum / samples.length;
}

/** Sample standard deviation (n − 1). Null below two samples. */
export function sampleSd(samples: readonly number[]): number | null {
  if (samples.length < 2) return null;
  const m = mean(samples)!;
  let ss = 0;
  for (const value of samples) ss += (value - m) ** 2;
  return Math.sqrt(ss / (samples.length - 1));
}

/** Nearest-rank percentile; null with no samples. */
export function percentile(samples: readonly number[], p: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1]!;
}

/** Median as the mean of the two middle values for an even count. */
export function median(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Two-sided 97.5 % quantile of Student's t, for a 95 % interval. Exact to three
 * decimals from a table for small df, then interpolated in 1/df, which is how
 * the quantile actually behaves; converges on the normal 1.960.
 */
const T975: readonly [number, number][] = [
  [1, 12.706],
  [2, 4.303],
  [3, 3.182],
  [4, 2.776],
  [5, 2.571],
  [6, 2.447],
  [7, 2.365],
  [8, 2.306],
  [9, 2.262],
  [10, 2.228],
  [12, 2.179],
  [15, 2.131],
  [20, 2.086],
  [25, 2.06],
  [30, 2.042],
  [40, 2.021],
  [60, 2.0],
  [120, 1.98],
];

export function tQuantile975(df: number): number {
  if (!(df >= 1)) throw new Error("t quantile needs df >= 1");
  for (let i = 0; i < T975.length; i += 1) {
    const [d, t] = T975[i]!;
    if (df === d) return t;
    if (df < d) {
      const [d0, t0] = T975[i - 1]!;
      // Linear in 1/df between table points.
      const w = (1 / df - 1 / d0) / (1 / d - 1 / d0);
      return t0 + w * (t - t0);
    }
  }
  const [dLast, tLast] = T975[T975.length - 1]!;
  const w = 1 / df / (1 / dLast);
  return 1.96 + w * (tLast - 1.96);
}

export interface Interval {
  lo: number;
  hi: number;
  /** How the interval was made, in words; printed next to it. */
  method: string;
}

/** A 95 % t interval for a mean, or null below `MIN_CI_N` samples. */
export function meanInterval(samples: readonly number[]): Interval | null {
  if (samples.length < MIN_CI_N) return null;
  const m = mean(samples)!;
  const sd = sampleSd(samples)!;
  const half = (tQuantile975(samples.length - 1) * sd) / Math.sqrt(samples.length);
  return { lo: m - half, hi: m + half, method: `95% t interval, n=${samples.length}` };
}

/**
 * Wilson score interval for a proportion. Well-behaved at 0 and 1 and at small
 * n, where the normal approximation reports impossible intervals.
 */
export function wilson(successes: number, n: number, z = 1.96): Interval | null {
  if (n <= 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return {
    lo: Math.max(0, centre - half),
    hi: Math.min(1, centre + half),
    method: `95% Wilson interval, n=${n}`,
  };
}

/**
 * Percentile bootstrap interval of any statistic, seeded so the same samples
 * always print the same interval. Used for medians and ratios, where no
 * closed form is honest.
 */
export function bootstrapInterval(
  samples: readonly number[],
  statistic: (resample: readonly number[]) => number | null,
  options: { resamples?: number; seed?: number } = {},
): Interval | null {
  if (samples.length < MIN_CI_N) return null;
  const resamples = options.resamples ?? 2000;
  const rand = mulberry32((options.seed ?? 0x5eed) >>> 0);
  const stats: number[] = [];
  const buffer = new Array<number>(samples.length);
  for (let r = 0; r < resamples; r += 1) {
    for (let i = 0; i < samples.length; i += 1) {
      buffer[i] = samples[Math.floor(rand() * samples.length)]!;
    }
    const value = statistic(buffer);
    if (value !== null && Number.isFinite(value)) stats.push(value);
  }
  if (stats.length < resamples / 2) return null;
  return {
    lo: percentile(stats, 2.5)!,
    hi: percentile(stats, 97.5)!,
    method: `95% percentile bootstrap, ${resamples} resamples, n=${samples.length}`,
  };
}

export interface SampleSummary {
  n: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  ci95: Interval | null;
  /** Why a figure above is null although there were samples. */
  notes: string[];
}

/** Everything the evaluation prints about a set of numbers. */
export function summarize(samples: readonly number[]): SampleSummary {
  const finite = samples.filter((value) => Number.isFinite(value));
  const notes: string[] = [];
  if (finite.length !== samples.length) {
    notes.push(`${samples.length - finite.length} non-finite samples dropped`);
  }
  const gated = (key: "p90" | "p95" | "p99", p: number): number | null => {
    if (finite.length === 0) return null;
    if (finite.length < PERCENTILE_MIN_N[key]) {
      notes.push(`${key} needs n >= ${PERCENTILE_MIN_N[key]}`);
      return null;
    }
    return percentile(finite, p);
  };
  if (finite.length > 0 && finite.length < MIN_CI_N) {
    notes.push(`no interval below n = ${MIN_CI_N}`);
  }
  return {
    n: finite.length,
    mean: mean(finite),
    median: median(finite),
    sd: sampleSd(finite),
    min: finite.length ? Math.min(...finite) : null,
    max: finite.length ? Math.max(...finite) : null,
    p90: gated("p90", 90),
    p95: gated("p95", 95),
    p99: gated("p99", 99),
    ci95: meanInterval(finite),
    notes,
  };
}

export interface PairedDifference {
  /** Seeds present in both arms; the pairing unit. */
  seeds: number[];
  differences: number[];
  n: number;
  meanDifference: number | null;
  ci95: Interval | null;
  /** The reason the pairing is weaker than it looks. Always printed. */
  caveat: string;
}

export const PAIRING_CAVEAT =
  "Paired by seed, not by trajectory: the same seed starts the same match, but frame pacing is not deterministic and the worlds diverge within seconds.";

/**
 * B − A per seed, for seeds both arms ran. Episodes without a value for the
 * metric (null) are left out of the pairing, and say so by their absence from
 * `seeds`.
 */
export function pairedDifference(
  a: ReadonlyMap<number, number | null>,
  b: ReadonlyMap<number, number | null>,
): PairedDifference {
  const seeds: number[] = [];
  const differences: number[] = [];
  for (const [seed, valueA] of [...a.entries()].sort((x, y) => x[0] - y[0])) {
    const valueB = b.get(seed);
    if (valueA === null || valueB === null || valueB === undefined) continue;
    seeds.push(seed);
    differences.push(valueB - valueA);
  }
  return {
    seeds,
    differences,
    n: differences.length,
    meanDifference: mean(differences),
    ci95: meanInterval(differences),
    caveat: PAIRING_CAVEAT,
  };
}

/** Fraction, or null for an empty denominator. Never 0/0 = 0. */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
