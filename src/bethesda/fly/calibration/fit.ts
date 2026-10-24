/**
 * The calibration's fits: how the circuit models' three `fitted` values are
 * set. Each is a deterministic search against named observations, which are
 * therefore fit targets of the circuit-informed controller, never tests of
 * it. `scripts/fly-calibration.ts --fit` runs them and writes
 * docs/benchmarks/fly-calibration/fit.json; the values in `circuits/params.ts`
 * are that file's, and a test holds them to it.
 *
 * The giant fiber's spike threshold, its median and log-normal spread, is fit
 * to von Reyn et al. 2014's counts of short-mode takeoffs at r/v 8, 14 and 40
 * ms: two parameters, three counts. The threshold enters the model only where
 * the potential is compared with it, and nothing before a trial's first
 * escape command depends on it. So each trial is run once with the giant
 * fiber silenced, recording the highest potential reached up to and
 * including the sample at which the other pathway starts the wing raise: the
 * trial is short-mode exactly when its threshold, median · e^(spread · z), is
 * at or below that peak. For any median m and spread s the expected
 * short-mode share is the mean over trials of Φ(ln(peak / m) / s), and the
 * fit minimizes the binomial negative log-likelihood of the three counts over
 * a grid: m in steps of 0.01 mV and s in steps of 0.01 across their ranges.
 * The chosen pair is then run in full, and every trial's mode must be the one
 * its peak and its own threshold draw z predict.
 *
 * The grooming drive threshold is fit to the dusted flies' mean share of
 * frames grooming, by bisection over whole dust units across its range, on as
 * many simulated flies as the data have (the same flies at every step).
 */
import type { CircuitController } from "../circuits/controller.js";
import { CIRCUIT_PARAMS } from "../circuits/params.js";
import { summarizeEthograms } from "./ethogram.js";
import { GROOMING_REFERENCE } from "./groomingReference.js";
import { observation } from "./observations.js";
import {
  chamberSession,
  loomingTrial,
  trialSeed,
  vonReyn2014Loom,
  ZHANG_2020_CHAMBER,
  type Subject,
} from "./paradigms.js";
import { circuitSubject } from "./subjects.js";

/** The seeds of the fits' trials and flies: `trialSeed(FIT_SEED, …)`. */
export const FIT_SEED = 0x5f17;
/** Looming trials per r/v in the giant fiber's fit. */
export const GF_FIT_TRIALS = 500;
/** The r/v values the threshold is fitted at, and the observations it is fitted to. */
export const GF_FIT_RV = [8, 14, 40] as const;
const GF_TARGETS = GF_FIT_RV.map((rv) => observation(`escape.short-mode.${rv}`));

/** The seed of trial `i` at r/v `rv` of the looming-disk paradigm, in the fit and the report. */
export const loomSeed = (rv: number, i: number) => trialSeed(FIT_SEED, 1, rv, i);
/** The seed of dusted fly `i` of the chamber paradigm, in the fit and the report. */
export const dustedSeed = (i: number) => trialSeed(FIT_SEED, 2, i);

/** The complementary error function (Numerical Recipes' Chebyshev fit, fractional error below 1.2e-7). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t *
                                  (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}
/** The standard normal distribution function. */
export const normalCdf = (x: number) => 0.5 * erfc(-x / Math.SQRT2);

/** One looming trial with the giant fiber silenced, as the fit sees it. */
export interface GfPeak {
  rv: number;
  seed: number;
  /** The highest modelled potential up to and including the wing-raise sample (mV); −∞ if none. */
  peakMv: number;
  /** Whether the other pathway started the wing raise. */
  raised: boolean;
  /** The trial's threshold draw: its threshold is median · e^(spread · z). */
  z: number;
}

/** A subject whose controller is kept, so its state can be read during a trial. */
function watched(base: Subject): {
  subject: Subject;
  controller: () => CircuitController;
} {
  let c: CircuitController | null = null;
  return {
    subject: {
      ...base,
      adapter: (seed, setting) => {
        const make = base.adapter(seed, setting);
        return (rng, streams) => (c = make(rng, streams) as CircuitController);
      },
    },
    controller: () => {
      if (!c) throw new Error("the trial built no controller");
      return c;
    },
  };
}

export function gfPeaks(rv: number, trials: number): GfPeak[] {
  const out: GfPeak[] = [];
  for (let i = 0; i < trials; i++) {
    const w = watched(circuitSubject({}, { silenceGiantFiber: true }));
    let peak = -Infinity,
      raised = false,
      z: number | null = null;
    const seed = loomSeed(rv, i);
    loomingTrial(w.subject, vonReyn2014Loom(rv), seed, () => {
      const E = w.controller().escape.state;
      if (raised || E.object === null) return;
      // The draw of the trial the stimulus opened (a fly that flies off may open another later).
      z ??= E.thresholdZ;
      peak = Math.max(peak, E.v);
      if (E.raisedAt !== null) raised = true;
    });
    if (w.controller().escape.state.spikes !== 0)
      throw new Error("a silenced giant fiber spiked");
    if (z === null) throw new Error("the fly never saw the stimulus");
    out.push({ rv, seed, peakMv: peak, raised, z });
  }
  return out;
}

/** P(the trial is short-mode) for median `m` and spread `s`. */
function pShort(peakMv: number, m: number, s: number): number {
  if (!(peakMv > 0)) return 0;
  if (s === 0) return peakMv >= m ? 1 : 0;
  return normalCdf(Math.log(peakMv / m) / s);
}

/** Expected short-mode share among the takeoffs of these trials. */
export function expectedShortShare(
  peaks: readonly GfPeak[],
  m: number,
  s: number,
): number {
  let short = 0,
    jumps = 0;
  for (const p of peaks) {
    const q = pShort(p.peakMv, m, s);
    short += q;
    jumps += p.raised ? 1 : q;
  }
  return jumps > 0 ? short / jumps : 0;
}

const EPS = 1e-12;
const binomialNll = (k: number, n: number, p: number) =>
  -(k * Math.log(Math.max(p, EPS)) + (n - k) * Math.log(Math.max(1 - p, EPS)));
/** Deviance against the saturated model (each share its own count's). */
const binomialDeviance = (k: number, n: number, p: number) =>
  2 * (binomialNll(k, n, p) - binomialNll(k, n, k / n));

const range = (lo: number, hi: number, step: number) =>
  Array.from(
    { length: Math.round((hi - lo) / step) + 1 },
    (_, i) => Math.round((lo + i * step) * 100) / 100,
  );

export interface GfFit {
  method: string;
  trialsPerRv: number;
  grid: { medianMv: [number, number, number]; lnSd: [number, number, number] };
  medianMv: number;
  lnSd: number;
  nll: number;
  /** Deviance against the saturated model, on 3 − 2 = 1 degree of freedom. */
  deviance: number;
  /** Profile-likelihood 95% intervals (ΔNLL ≤ 1.92), within the grid. */
  profile95: { medianMv: [number, number]; lnSd: [number, number] };
  rows: {
    rv: number;
    observed: { k: number; n: number };
    expected: number;
    /** The full run at the fitted values: short-mode and all takeoffs. */
    simulated: { k: number; n: number };
  }[];
  /** Trials whose mode in the full run was the one predicted from their peak and threshold draw. */
  modesPredicted: number;
  trials: number;
}

export function fitGiantFiber(
  trials = GF_FIT_TRIALS,
  log: (line: string) => void = () => {},
): GfFit {
  const P = CIRCUIT_PARAMS;
  const byRv = GF_FIT_RV.map((rv) => {
    log(`giant fiber: ${trials} trials at r/v ${rv} ms, silenced`);
    return gfPeaks(rv, trials);
  });
  const obs = GF_TARGETS.map((o) => {
    const sp = o.spread;
    if (sp?.kind !== "proportion") throw new Error(`${o.id} is not a count`);
    return { k: sp.k, n: sp.n };
  });
  const ms = range(P.gfThresholdMv.min, P.gfThresholdMv.max, 0.01);
  const ss = range(P.gfThresholdLnSd.min, P.gfThresholdLnSd.max, 0.01);
  const nllAt = (m: number, s: number) =>
    byRv.reduce(
      (a, peaks, i) =>
        a + binomialNll(obs[i]!.k, obs[i]!.n, expectedShortShare(peaks, m, s)),
      0,
    );
  log(`giant fiber: likelihood over ${ms.length} × ${ss.length} grid points`);
  const surface = ss.map((s) => ms.map((m) => nllAt(m, s)));
  let best = { m: ms[0]!, s: ss[0]!, nll: Infinity };
  surface.forEach((row, j) =>
    row.forEach((v, i) => {
      if (v < best.nll) best = { m: ms[i]!, s: ss[j]!, nll: v };
    }),
  );
  const within = (xs: number[], prof: number[]) => {
    const keep = xs.filter((_, i) => prof[i]! - best.nll <= 1.92);
    return [Math.min(...keep), Math.max(...keep)] as [number, number];
  };
  const profileM = ms.map((_, i) => Math.min(...surface.map((row) => row[i]!)));
  const profileS = surface.map((row) => Math.min(...row));

  log(
    `giant fiber: median ${best.m} mV, spread ${best.s}; full run at the fitted values`,
  );
  const fitted = circuitSubject({ gfThresholdMv: best.m, gfThresholdLnSd: best.s });
  let predicted = 0,
    total = 0;
  const rows = byRv.map((peaks, i) => {
    let k = 0,
      n = 0;
    for (const p of peaks) {
      const t = loomingTrial(fitted, vonReyn2014Loom(p.rv), p.seed);
      const spikes = best.m * Math.exp(best.s * p.z) <= p.peakMv;
      const expectJump = p.raised || spikes;
      total++;
      if (t.jumped === expectJump && (!t.jumped || t.short === spikes)) predicted++;
      if (t.jumped) {
        n++;
        if (t.short) k++;
      }
    }
    return {
      rv: GF_FIT_RV[i]!,
      observed: obs[i]!,
      expected: Math.round(expectedShortShare(peaks, best.m, best.s) * 1e5) / 1e5,
      simulated: { k, n },
    };
  });
  if (predicted !== total)
    throw new Error(
      `${total - predicted} of ${total} trials did not take the mode their peak predicts`,
    );
  return {
    method:
      "Each trial run once with the giant fiber silenced, recording the peak modelled potential up to the wing raise; expected short-mode share per (median, spread) = mean of Φ(ln(peak/median)/spread); binomial negative log-likelihood of the three counts minimized over the grid; the optimum run again in full and every trial's mode checked against its prediction.",
    trialsPerRv: trials,
    grid: {
      medianMv: [ms[0]!, ms[ms.length - 1]!, 0.01],
      lnSd: [ss[0]!, ss[ss.length - 1]!, 0.01],
    },
    medianMv: best.m,
    lnSd: best.s,
    nll: Math.round(best.nll * 1e6) / 1e6,
    deviance:
      Math.round(
        byRv.reduce(
          (a, peaks, i) =>
            a +
            binomialDeviance(
              obs[i]!.k,
              obs[i]!.n,
              expectedShortShare(peaks, best.m, best.s),
            ),
          0,
        ) * 1e6,
      ) / 1e6,
    profile95: { medianMv: within(ms, profileM), lnSd: within(ss, profileS) },
    rows,
    modesPredicted: predicted,
    trials: total,
  };
}

/** The dusted flies' mean share of frames grooming at a drive threshold. */
export function dustedGroomingShare(groomDriveDust: number, flies: number): number {
  const subject = circuitSubject({ groomDriveDust });
  const labels = Array.from({ length: flies }, (_, i) =>
    chamberSession(subject, ZHANG_2020_CHAMBER, { dusted: true }, dustedSeed(i)),
  );
  return summarizeEthograms(labels, ZHANG_2020_CHAMBER.frameHz, 150).grooming.mean;
}

export interface GroomFit {
  method: string;
  flies: number;
  target: number;
  steps: { groomDriveDust: number; share: number }[];
  groomDriveDust: number;
  share: number;
}

export function fitGroomDrive(log: (line: string) => void = () => {}): GroomFit {
  const P = CIRCUIT_PARAMS.groomDriveDust;
  const target = observation("grooming.dusted.fraction").value!;
  const flies = GROOMING_REFERENCE.conditions.dusted.flies;
  const steps: GroomFit["steps"] = [];
  const at = (x: number) => {
    const share = dustedGroomingShare(x, flies);
    steps.push({ groomDriveDust: x, share });
    log(
      `grooming: drive threshold ${x} dust units → ${share.toFixed(4)} of frames grooming`,
    );
    return share;
  };
  let lo = P.min,
    hi = P.max;
  let fLo = at(lo),
    fHi = at(hi);
  if (!(fLo > target && fHi < target))
    throw new Error(`the range [${lo}, ${hi}] does not bracket the target ${target}`);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const f = at(mid);
    if (f > target) {
      lo = mid;
      fLo = f;
    } else {
      hi = mid;
      fHi = f;
    }
  }
  const pickLo = Math.abs(fLo - target) <= Math.abs(fHi - target);
  return {
    method:
      "Bisection over whole dust units in the parameter's range on the dusted chamber paradigm's flies (the same seeds at every step), keeping the end whose share is nearer the target.",
    flies,
    target,
    steps,
    groomDriveDust: pickLo ? lo : hi,
    share: pickLo ? fLo : fHi,
  };
}
