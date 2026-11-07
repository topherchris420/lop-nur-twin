/**
 * Scoring the looming battery: when each readout would commit an escape,
 * whether that escape was right, and how sure the comparison is.
 *
 * A readout's decision on a trial is the first call at which its value
 * reaches its threshold (a fresh, perched fly has full responsiveness, so
 * the deployed reflex's rule is exactly this). A threat is hit by a decision
 * at or after the stimulus appears and before it collides; a harmless
 * stimulus is a false alarm if any decision falls in its run. A decision
 * before the stimulus appears is counted as `early`: a false positive, and
 * for a threat also a miss.
 *
 * Each trial keeps only its readouts' running-maximum envelopes (the times
 * at which the running maximum rose, and to what), from which the first
 * crossing of any threshold follows exactly.
 */
import { mulberry32 } from "../../lib/noise.js";

/** Running-maximum envelope: strictly increasing values at increasing times. */
export interface Envelope {
  t: number[];
  v: number[];
}

export function envelope(times: readonly number[], values: readonly number[]): Envelope {
  const out: Envelope = { t: [], v: [] };
  let best = -Infinity;
  for (let k = 0; k < values.length; k++) {
    const v = values[k]!;
    if (v > best) {
      best = v;
      out.t.push(times[k]!);
      out.v.push(round(v));
    }
  }
  return out;
}

const round = (x: number) => Number(x.toPrecision(9));

/** The first time the readout reaches `threshold`, or null. */
export function firstCrossing(e: Envelope, threshold: number): number | null {
  // v is increasing: binary search for the first v ≥ threshold.
  let lo = 0,
    hi = e.v.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (e.v[mid]! >= threshold) hi = mid;
    else lo = mid + 1;
  }
  return lo < e.v.length ? e.t[lo]! : null;
}

export interface TrialTruth {
  stimulus: number;
  kind: string;
  threat: boolean;
  tOn: number;
  tCollision: number | null;
}

export type Outcome = "hit" | "miss" | "false-alarm" | "correct-rejection" | "early";

export interface Scored {
  outcome: Outcome;
  /** Time from decision to collision (s), for a hit. */
  lead: number | null;
}

export function scoreTrial(truth: TrialTruth, decision: number | null): Scored {
  if (decision !== null && decision < truth.tOn - 1e-9)
    return { outcome: "early", lead: null };
  if (truth.threat) {
    if (decision !== null && decision < truth.tCollision! - 1e-9)
      return { outcome: "hit", lead: round(truth.tCollision! - decision) };
    return { outcome: "miss", lead: null };
  }
  return { outcome: decision === null ? "correct-rejection" : "false-alarm", lead: null };
}

export interface Metrics {
  trials: number;
  threats: number;
  harmless: number;
  hits: number;
  misses: number;
  falseAlarms: number;
  early: number;
  recall: number;
  precision: number | null;
  /** Share of harmless trials with an escape. */
  falseAlarmRate: number;
  f1: number;
  medianLeadS: number | null;
}

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function metrics(
  truths: readonly TrialTruth[],
  scored: readonly Scored[],
): Metrics {
  let tp = 0,
    fn = 0,
    fp = 0,
    early = 0,
    threats = 0;
  const leads: number[] = [];
  truths.forEach((tr, k) => {
    const s = scored[k]!;
    if (tr.threat) threats++;
    switch (s.outcome) {
      case "hit":
        tp++;
        leads.push(s.lead!);
        break;
      case "miss":
        fn++;
        break;
      case "false-alarm":
        fp++;
        break;
      case "early":
        early++;
        fp++;
        if (tr.threat) fn++;
        break;
      case "correct-rejection":
        break;
    }
  });
  const harmless = truths.length - threats;
  const f1 = tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : 0;
  const lead = median(leads);
  return {
    trials: truths.length,
    threats,
    harmless,
    hits: tp,
    misses: fn,
    falseAlarms: fp,
    early,
    recall: threats ? round(tp / threats) : 0,
    precision: tp + fp ? round(tp / (tp + fp)) : null,
    falseAlarmRate: harmless
      ? round(
          truths.filter((t, k) => !t.threat && scored[k]!.outcome !== "correct-rejection")
            .length / harmless,
        )
      : 0,
    f1: round(f1),
    medianLeadS: lead === null ? null : round(lead),
  };
}

export interface Selection {
  threshold: number;
  metrics: Metrics;
  /** Why this threshold, in the rule's words. */
  rule: string;
  candidates: number;
}

/**
 * The frozen selection rule: among a log-spaced grid of thresholds spanning
 * the development trials' peaks, the highest F1 with recall at least
 * `minRecall`, then the longer median lead, then the higher threshold; if no
 * threshold reaches `minRecall`, the highest recall, then F1.
 */
export function select(
  truths: readonly TrialTruth[],
  envelopes: readonly Envelope[],
  minRecall: number,
  gridSize: number,
): Selection {
  const peaks = envelopes
    .map((e) => (e.v.length ? e.v[e.v.length - 1]! : 0))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (!peaks.length) throw new Error("no readout ever rose above zero");
  const lo = peaks[Math.floor(0.01 * (peaks.length - 1))]!;
  const hi = peaks[peaks.length - 1]! * 1.0001;
  const grid: number[] = [];
  for (let k = 0; k < gridSize; k++)
    grid.push(round(lo * Math.pow(hi / lo, gridSize > 1 ? k / (gridSize - 1) : 0)));
  type C = { threshold: number; m: Metrics };
  const all: C[] = grid.map((threshold) => ({
    threshold,
    m: metrics(
      truths,
      envelopes.map((e, k) => scoreTrial(truths[k]!, firstCrossing(e, threshold))),
    ),
  }));
  const ok = all.filter((c) => c.m.recall >= minRecall);
  const lead = (c: C) => c.m.medianLeadS ?? -1;
  let best: C;
  let rule: string;
  if (ok.length) {
    best = ok.reduce((a, b) =>
      b.m.f1 > a.m.f1 ||
      (b.m.f1 === a.m.f1 &&
        (lead(b) > lead(a) || (lead(b) === lead(a) && b.threshold > a.threshold)))
        ? b
        : a,
    );
    rule = `highest F1 with recall ≥ ${minRecall}`;
  } else {
    best = all.reduce((a, b) =>
      b.m.recall > a.m.recall || (b.m.recall === a.m.recall && b.m.f1 > a.m.f1) ? b : a,
    );
    rule = `no threshold reached recall ${minRecall}: highest recall, then F1`;
  }
  return { threshold: best.threshold, metrics: best.m, rule, candidates: grid.length };
}

export interface Interval {
  estimate: number;
  lo: number;
  hi: number;
}

/**
 * A paired percentile bootstrap of a statistic over stimuli: each resample
 * draws stimuli with replacement and keeps every trial of each (all its fly
 * seeds), so trials of one stimulus are never treated as independent.
 */
export function bootstrap(
  truths: readonly TrialTruth[],
  statistic: (idx: readonly number[]) => number,
  resamples: number,
  seed: number,
): Interval {
  const byStimulus = new Map<number, number[]>();
  truths.forEach((t, k) => {
    const list = byStimulus.get(t.stimulus) ?? [];
    list.push(k);
    byStimulus.set(t.stimulus, list);
  });
  const groups = [...byStimulus.keys()]
    .sort((a, b) => a - b)
    .map((s) => byStimulus.get(s)!);
  const all = groups.flat();
  const rng = mulberry32(seed >>> 0);
  const values: number[] = [];
  for (let r = 0; r < resamples; r++) {
    const idx: number[] = [];
    for (let g = 0; g < groups.length; g++)
      idx.push(...groups[Math.floor(rng() * groups.length)]!);
    values.push(statistic(idx));
  }
  values.sort((a, b) => a - b);
  const q = (p: number) =>
    values[Math.min(values.length - 1, Math.floor(p * values.length))]!;
  return { estimate: round(statistic(all)), lo: round(q(0.025)), hi: round(q(0.975)) };
}

/** F1 over a subset of trials (by index), for the bootstrap. */
export function f1Of(
  truths: readonly TrialTruth[],
  scored: readonly Scored[],
  idx: readonly number[],
): number {
  return metrics(
    idx.map((k) => truths[k]!),
    idx.map((k) => scored[k]!),
  ).f1;
}
