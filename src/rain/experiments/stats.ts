/**
 * Descriptive statistics only. No inferential test is computed here.
 *
 * A port of R.A.I.N.'s `experiments/stats.py` (james_library, MIT).
 * Significance tests need assumptions (independence, distribution, a
 * pre-registered test) that a generic registry cannot check, so none is
 * offered. Small samples are labelled rather than dressed up.
 *
 * Shared with the server: imports nothing.
 */

/** Below this many observations the summary is labelled descriptive-only. */
export const SMALL_SAMPLE = 10;

export interface Summary {
  n: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  stdev: number | null;
  variance: number | null;
  note: string | null;
}

/** Fixed precision keeps records byte-stable across platforms. */
const round9 = (value: number) => Number(value.toFixed(9));

export function summarize(values: readonly number[]): Summary {
  const n = values.length;
  if (n === 0)
    return { n: 0, mean: null, median: null, min: null, max: null, stdev: null, variance: null, note: "no observations" };
  const spread = n >= 2;
  const note =
    n < 2
      ? "single observation: spread undefined"
      : n < SMALL_SAMPLE
        ? `n=${n} < ${SMALL_SAMPLE}: descriptive only, too small for inference`
        : null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sorted = [...values].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const variance = spread ? values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1) : null;
  return {
    n,
    mean: round9(mean),
    median: round9(median),
    min: round9(sorted[0]!),
    max: round9(sorted[n - 1]!),
    stdev: variance === null ? null : round9(Math.sqrt(variance)),
    variance: variance === null ? null : round9(variance),
    note,
  };
}

/** Relative change in percent; undefined (null) when the baseline is zero or missing. */
export function percentChange(before: number | null, after: number | null): number | null {
  if (before === null || after === null || before === 0) return null;
  return round9(((after - before) / Math.abs(before)) * 100.0);
}
