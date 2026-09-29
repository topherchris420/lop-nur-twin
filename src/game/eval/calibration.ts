import { mean, wilson, type Interval } from "./stats.js";

/**
 * Is a stated probability worth believing? Reliability data for any brain
 * that states one.
 *
 * Input is a list of (predicted probability, outcome) pairs, where the outcome
 * is whatever the experiment's outcome contract declared as success *before*
 * the run (see `outcomeContracts.ts`). Output is the reliability table —
 * predicted against empirical, per confidence bin — with the Brier score and
 * the expected calibration error.
 *
 * What this does not do:
 *
 *  - **It does not decide what the probability meant.** Jev's probability is
 *    TypeSafe's distribution over "which option should be chosen"; an LLM's
 *    verbalized confidence is a number it wrote. Calibrating either against a
 *    game outcome tests whether that number *predicts* the declared outcome,
 *    which is a useful question, and not whether it was intended to. The
 *    report names the confidence source next to every table.
 *  - **It does not invent a probability.** A brain that states none (random,
 *    scripted, replay) has no calibration; the report says "not available"
 *    with the reason. A uniform 1/k is not substituted.
 *  - **It does not claim adequacy it lacks.** Every bin carries its n and a
 *    Wilson interval, and bins below `MIN_BIN_N` are marked insufficient. The
 *    decisions inside one episode are serially dependent, so even n is an
 *    optimistic count of independent evidence.
 */

/** A bin under this many samples is printed but marked insufficient. */
export const MIN_BIN_N = 30;

/**
 * The bins the reports print. Probabilities below 0.5 are real (with k
 * options a model can choose an option it gives 0.35) and are kept in their
 * own bin rather than dropped.
 */
export const CALIBRATION_EDGES: readonly number[] = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

export interface CalibrationSample {
  p: number;
  /** 1 when the declared success criterion held, 0 when it did not. */
  y: 0 | 1;
}

export interface CalibrationBin {
  label: string;
  lo: number;
  hi: number;
  n: number;
  /** Mean predicted probability of the samples in the bin. */
  meanPredicted: number | null;
  /** Share of the bin's samples that met the success criterion. */
  empirical: number | null;
  interval: Interval | null;
  /** n >= MIN_BIN_N. */
  sufficient: boolean;
}

export interface CalibrationReport {
  n: number;
  bins: CalibrationBin[];
  /** Mean squared error of the probability against the 0/1 outcome. Lower is better. */
  brier: number | null;
  /** Σ (n_b / N) · |empirical_b − predicted_b|. */
  ece: number | null;
  /** The worst bin's gap, over sufficient bins only. */
  maxGap: number | null;
  meanPredicted: number | null;
  baseRate: number | null;
  /** Samples rejected for a probability outside [0, 1]. */
  rejected: number;
  adequacy: "none" | "insufficient" | "exploratory" | "usable";
  notes: string[];
}

function binLabel(lo: number, hi: number, last: boolean): string {
  const f = (x: number): string => x.toFixed(2);
  return last ? `${f(lo)}–${f(hi)}` : `${f(lo)}–${f(hi - 0.01)}`;
}

/** Index of the bin a probability falls in; the last bin is closed at 1. */
export function binIndex(
  p: number,
  edges: readonly number[] = CALIBRATION_EDGES,
): number {
  for (let i = 0; i < edges.length - 1; i += 1) {
    const last = i === edges.length - 2;
    if (p >= edges[i]! && (p < edges[i + 1]! || (last && p <= edges[i + 1]!))) return i;
  }
  return -1;
}

export function calibrate(
  samples: readonly CalibrationSample[],
  edges: readonly number[] = CALIBRATION_EDGES,
): CalibrationReport {
  const valid = samples.filter((s) => Number.isFinite(s.p) && s.p >= 0 && s.p <= 1);
  const rejected = samples.length - valid.length;
  const groups: CalibrationSample[][] = edges.slice(0, -1).map(() => []);
  for (const sample of valid) groups[binIndex(sample.p, edges)]!.push(sample);
  const n = valid.length;
  const bins: CalibrationBin[] = groups.map((group, i) => {
    const successes = group.reduce((acc, s) => acc + s.y, 0);
    return {
      label: binLabel(edges[i]!, edges[i + 1]!, i === edges.length - 2),
      lo: edges[i]!,
      hi: edges[i + 1]!,
      n: group.length,
      meanPredicted: mean(group.map((s) => s.p)),
      empirical: group.length > 0 ? successes / group.length : null,
      interval: wilson(successes, group.length),
      sufficient: group.length >= MIN_BIN_N,
    };
  });
  const brier = n > 0 ? valid.reduce((acc, s) => acc + (s.p - s.y) ** 2, 0) / n : null;
  const ece =
    n > 0
      ? bins.reduce(
          (acc, bin) =>
            bin.n === 0
              ? acc
              : acc + (bin.n / n) * Math.abs(bin.empirical! - bin.meanPredicted!),
          0,
        )
      : null;
  const sufficient = bins.filter((bin) => bin.sufficient);
  const maxGap =
    sufficient.length > 0
      ? Math.max(
          ...sufficient.map((bin) => Math.abs(bin.empirical! - bin.meanPredicted!)),
        )
      : null;
  const notes: string[] = [];
  if (rejected > 0) notes.push(`${rejected} samples outside [0, 1] rejected`);
  const insufficient = bins.filter((bin) => bin.n > 0 && !bin.sufficient).length;
  if (insufficient > 0) {
    notes.push(
      `${insufficient} non-empty bins below n = ${MIN_BIN_N}; their rates are unstable`,
    );
  }
  notes.push(
    "Decisions within an episode are serially dependent; n overstates the independent evidence.",
  );
  const adequacy: CalibrationReport["adequacy"] =
    n === 0
      ? "none"
      : sufficient.length < 2
        ? "insufficient"
        : sufficient.length < bins.filter((b) => b.n > 0).length || n < 400
          ? "exploratory"
          : "usable";
  return {
    n,
    bins,
    brier,
    ece,
    maxGap,
    meanPredicted: mean(valid.map((s) => s.p)),
    baseRate: mean(valid.map((s) => s.y)),
    rejected,
    adequacy,
    notes,
  };
}

/**
 * The Brier score of always predicting the base rate: the score a brain with
 * no information about individual decisions would get. A stated probability
 * earns its keep only below this.
 */
export function climatologyBrier(samples: readonly CalibrationSample[]): number | null {
  if (samples.length === 0) return null;
  const base = mean(samples.map((s) => s.y))!;
  return base * (1 - base);
}
