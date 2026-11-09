/**
 * From a split's raw records and its frozen protocol to the bench's findings:
 * validity checks, the confirmatory decision, guardrails, where an effect holds
 * (boundary), which part of the mechanism carries it, whether the impairment
 * cost the baseline anything at all (assay sensitivity), every secondary
 * contrast without a claim, what the self-model and the plasticity learned,
 * trajectories, failure cases and the machine's compute.
 *
 * Pure arithmetic on the records: the verifier calls the same function and
 * must get the same bytes. Machine-dependent numbers (compute) are summarized
 * apart and never enter a verdict.
 */
import { refuseOriginal } from "../firstContact/originals.js";
import type { ControllerId } from "./controllers.js";
import {
  BEHAVIOUR_METRICS,
  METRIC_DIRECTION,
  conditionOf,
  controllersIn,
  protocolDigest,
  seedsOf,
  unitKey,
  unitsOf,
  type BehaviourMetric,
  type Protocol,
  type Split,
  type Verdict,
} from "./protocol.js";
import type { RunRecord } from "./runner.js";
import {
  decide,
  mean,
  pairedInterval,
  reading,
  type ComparisonVerdict,
  type Direction,
  type Interval,
} from "./statistics.js";

export const SUMMARY_SCHEMA = "eimb-summary/v1" as const;

export interface Check {
  id: string;
  passed: boolean;
  detail: string;
}

export interface Comparison {
  family: "confirmatory" | "boundary" | "mechanism";
  id: string;
  metric: BehaviourMetric;
  condition: string;
  contrast: [ControllerId, ControllerId];
  direction: Direction;
  mme: number;
  interval: Interval;
  verdict: ComparisonVerdict;
  practical: boolean;
  reason: string;
  /** Units without a value for both controllers (failed runs, undefined metrics). */
  missing: number;
}

export interface Guardrail {
  metric: BehaviourMetric;
  condition: string;
  contrast: [ControllerId, ControllerId];
  interval: Interval;
  regression: boolean;
  missing: number;
}

export interface Secondary {
  condition: string;
  contrast: [ControllerId, ControllerId];
  metric: BehaviourMetric;
  interval: Interval;
  reading: string;
  missing: number;
}

export interface ImpairmentCost {
  condition: string;
  reference: string;
  metric: BehaviourMetric;
  /** The baseline in this condition minus the baseline in the reference condition, per seed. */
  interval: Interval;
  reading: string;
  /** True when the impairment's cost to the baseline was detected (the assay can show compensation). */
  sensitive: boolean;
}

export interface LearningSummary {
  condition: string;
  controller: ControllerId;
  runs: number;
  plasticity: {
    detectedShare: number;
    detectionMeanS: number | null;
    falseAlarmShare: number;
    releasedShare: number | null;
    releaseMeanS: number | null;
    adaptationsMean: number;
    samplesMean: number;
    failureNormalMean: number;
  } | null;
  selfModel: {
    target: string;
    convergedShare: number;
    convergedMeanS: number | null;
    errorEndMean: number | null;
    noticedBeforeMean: number;
    noticedAfterMean: number;
    calibration90Mean: number | null;
    calibration50Mean: number | null;
  } | null;
}

export interface TrajectoryPoint {
  t: number;
  fedJ: number;
  meals: number;
  walkedM: number;
  adaptations: number;
  cautiousShare: number | null;
  belief: number | null;
  truth: number;
  foodDistanceM: number | null;
}

export interface Summary {
  schema: typeof SUMMARY_SCHEMA;
  protocol: { id: string; digest: string; title: string };
  split: Split;
  design: {
    seeds: number[];
    conditions: string[];
    controllers: ControllerId[];
    unitsExpected: number;
    recordsPresent: number;
    complete: number;
    failed: { key: string; status: string; error: string | null }[];
  };
  validity: { valid: boolean; checks: Check[] };
  verdict: { overall: Verdict; reasons: string[] };
  confirmatory: Comparison[];
  guardrails: Guardrail[];
  boundary: Comparison[];
  mechanism: Comparison[];
  impairmentCost: ImpairmentCost[];
  secondary: Secondary[];
  learning: LearningSummary[];
  trajectories: Record<string, Record<string, TrajectoryPoint[]>>;
  means: Record<string, Record<string, Record<string, number | null>>>;
  distributions: {
    condition: string;
    metric: BehaviourMetric;
    contrast: [ControllerId, ControllerId];
    points: { seed: number; diff: number }[];
  }[];
  failureCases: {
    condition: string;
    seed: number;
    metric: BehaviourMetric;
    candidate: number;
    baseline: number;
    diff: number;
    adaptations: number | null;
  }[];
  compute: {
    note: string;
    byController: Record<
      string,
      {
        runs: number;
        wallSMedian: number | null;
        cpuSMedian: number | null;
        ticksPerWallSMedian: number | null;
      }
    >;
  };
  answers: { id: string; question: string; answer: string }[];
}

const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const meanOrNull = (xs: readonly number[]): number | null =>
  xs.length ? mean(xs) : null;
const fmt = (x: number | null | undefined, d = 3) =>
  x === null || x === undefined || !Number.isFinite(x) ? "n/a" : x.toFixed(d);

/** Replace every non-finite number with null so the summary is canonical JSON. */
function finite<T>(v: T): T {
  if (typeof v === "number") return (Number.isFinite(v) ? v : null) as T;
  if (Array.isArray(v)) return v.map(finite) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = finite(x);
    return out as T;
  }
  return v;
}

type Index = Map<string, RunRecord>;

const complete = (r: RunRecord | undefined): r is RunRecord =>
  !!r && r.status === "complete";

function diffs(
  idx: Index,
  seeds: readonly number[],
  condition: string,
  [a, b]: [ControllerId, ControllerId],
  metric: BehaviourMetric,
  bCondition = condition,
): { points: { seed: number; diff: number }[]; missing: number } {
  const points: { seed: number; diff: number }[] = [];
  let missing = 0;
  for (const seed of seeds) {
    const ra = idx.get(unitKey({ seed, condition, controller: a }));
    const rb = idx.get(unitKey({ seed, condition: bCondition, controller: b }));
    const va = complete(ra) ? ra.behaviour[metric] : null;
    const vb = complete(rb) ? rb.behaviour[metric] : null;
    if (va === null || vb === null) missing++;
    else points.push({ seed, diff: va - vb });
  }
  return { points, missing };
}

export function summarize(
  p: Protocol,
  split: Split,
  records: readonly RunRecord[],
): Summary {
  const digest = protocolDigest(p);
  const seeds = seedsOf(p, split);
  const units = unitsOf(p, split);
  const expected = new Set(units.map(unitKey));
  const idx: Index = new Map();
  const checks: Check[] = [];
  const duplicates: string[] = [],
    unexpected: string[] = [];
  for (const r of records) {
    const k = unitKey(r);
    if (idx.has(k)) duplicates.push(k);
    if (!expected.has(k)) unexpected.push(k);
    idx.set(k, r);
  }
  const absent = [...expected].filter((k) => !idx.has(k));
  checks.push({
    id: "design-complete",
    passed: !duplicates.length && !unexpected.length && !absent.length,
    detail: `${idx.size} of ${expected.size} units recorded; ${absent.length} absent, ${duplicates.length} duplicated, ${unexpected.length} outside the design${absent.length ? ` (first absent: ${absent.slice(0, 3).join(", ")})` : ""}`,
  });
  const foreign = records.filter((r) => r.protocolDigest !== digest || r.split !== split);
  checks.push({
    id: "protocol-bound",
    passed: foreign.length === 0,
    detail: foreign.length
      ? `${foreign.length} records name another protocol digest or split`
      : `every record names protocol ${digest.slice(0, 12)}… and split ${split}`,
  });
  const failed = records.filter((r) => r.status !== "complete");
  const failedShare = records.length ? failed.length / records.length : 1;
  checks.push({
    id: "failures-within-limit",
    passed: failedShare <= p.decision.maxFailedFraction && records.length > 0,
    detail: `${failed.length} of ${records.length} runs failed or timed out (limit ${p.decision.maxFailedFraction * 100}%)`,
  });
  let unpaired = 0,
    pairedUnits = 0;
  for (const seed of seeds)
    for (const c of p.conditions) {
      const envs = new Set(
        controllersIn(p, c)
          .map((controller) => idx.get(unitKey({ seed, condition: c.id, controller })))
          .filter(complete)
          .map((r) => r.environmentDigest),
      );
      pairedUnits++;
      if (envs.size > 1) unpaired++;
    }
  checks.push({
    id: "paired-environment",
    passed: unpaired === 0,
    detail: `${pairedUnits - unpaired} of ${pairedUnits} units met the same environment (food schedule, start, perturbation) under every controller`,
  });
  let identical = 0,
    compared = 0;
  const differing: string[] = [];
  for (const condition of p.validity.conditions)
    for (const controller of p.validity.identicalToBaseline)
      for (const seed of seeds) {
        const r = idx.get(unitKey({ seed, condition, controller }));
        const b = idx.get(unitKey({ seed, condition, controller: p.baseline }));
        if (!complete(r) || !complete(b)) continue;
        compared++;
        const same =
          r.bodyHash === b.bodyHash &&
          BEHAVIOUR_METRICS.every((m) => r.behaviour[m] === b.behaviour[m]);
        if (same) identical++;
        else differing.push(`${controller} ${condition} ${seed}`);
      }
  checks.push({
    id: "identical-to-baseline",
    passed: identical === compared && compared > 0,
    detail: `${identical} of ${compared} validity runs behaved exactly as the baseline (every metric and the final body and controller hash)${differing.length ? `; differing: ${differing.slice(0, 5).join(", ")}` : ""}`,
  });
  let originals = 0;
  for (const r of records) {
    try {
      refuseOriginal(r.subject);
      if (!r.subject.startsWith("research-")) originals++;
    } catch {
      originals++;
    }
  }
  checks.push({
    id: "research-subjects-only",
    passed: originals === 0,
    detail: `${records.length - originals} of ${records.length} subjects are research subjects (research-…, never Eva or ECHO)`,
  });
  const valid = checks.every((c) => c.passed);

  const a = p.analysis;
  const interval = (
    pts: { diff: number }[],
    label: string,
    level: number,
    direction: Direction,
  ): Interval =>
    pairedInterval(
      pts.map((x) => x.diff),
      { resamples: a.resamples, seed: a.seed, label, level, direction },
    );
  const dirOf = (m: BehaviourMetric): Direction => {
    const d = METRIC_DIRECTION[m];
    if (d === "neutral") throw new Error(`${m} has no direction`);
    return d;
  };

  const confirmatory: Comparison[] = p.endpoints.confirmatory.map((e) => {
    const level = 1 - a.alpha / p.endpoints.confirmatory.length;
    const direction = dirOf(e.metric);
    const d = diffs(idx, seeds, e.condition, e.contrast, e.metric);
    const i = interval(d.points, `confirmatory:${e.id}`, level, direction);
    return {
      family: "confirmatory",
      id: e.id,
      metric: e.metric,
      condition: e.condition,
      contrast: e.contrast,
      direction,
      mme: e.mme,
      interval: i,
      ...decide(i, direction, e.mme),
      missing: d.missing,
    };
  });

  const guardrails: Guardrail[] = p.endpoints.guardrails.map((g) => {
    const direction = dirOf(g.metric);
    const d = diffs(idx, seeds, g.condition, g.contrast, g.metric);
    const i = interval(
      d.points,
      `guardrail:${g.condition}:${g.metric}:${g.contrast.join("-")}`,
      1 - a.guardrailAlpha,
      direction,
    );
    return {
      metric: g.metric,
      condition: g.condition,
      contrast: g.contrast,
      interval: i,
      regression: reading(i, direction) === "worse",
      missing: d.missing,
    };
  });

  const family = (name: "boundary" | "mechanism"): Comparison[] => {
    const f = p.endpoints[name];
    const direction = dirOf(f.metric);
    const level = 1 - a.alpha / (f.contrasts.length * f.conditions.length);
    const out: Comparison[] = [];
    for (const condition of f.conditions)
      for (const contrast of f.contrasts) {
        const runs = controllersIn(p, conditionOf(p, condition));
        if (!runs.includes(contrast[0]) || !runs.includes(contrast[1])) continue;
        const d = diffs(idx, seeds, condition, contrast, f.metric);
        const id = `${name}:${condition}:${contrast.join("-")}`;
        const i = interval(d.points, id, level, direction);
        out.push({
          family: name,
          id,
          metric: f.metric,
          condition,
          contrast,
          direction,
          mme: f.mme,
          interval: i,
          ...decide(i, direction, f.mme),
          missing: d.missing,
        });
      }
    return out;
  };
  const boundary = family("boundary");
  const mechanism = family("mechanism");

  const reference = p.conditions.find((c) => c.family === "unimpaired");
  const costMetric = p.endpoints.boundary.metric;
  const impairmentCost: ImpairmentCost[] = reference
    ? p.conditions
        .filter((c) => c.id !== reference.id)
        .map((c) => {
          const d = diffs(
            idx,
            seeds,
            c.id,
            [p.baseline, p.baseline],
            costMetric,
            reference.id,
          );
          const direction = dirOf(costMetric);
          const i = interval(d.points, `cost:${c.id}`, 1 - a.alpha, direction);
          const r = reading(i, direction);
          return {
            condition: c.id,
            reference: reference.id,
            metric: costMetric,
            interval: i,
            reading: r,
            sensitive: r === "worse",
          };
        })
    : [];

  const secondary: Secondary[] = [];
  for (const c of p.conditions) {
    const runs = controllersIn(p, c);
    const contrasts: [ControllerId, ControllerId][] = [];
    for (const x of runs) if (x !== p.baseline) contrasts.push([x, p.baseline]);
    for (const x of runs)
      if (
        x !== p.baseline &&
        x !== p.candidate &&
        !p.validity.identicalToBaseline.includes(x)
      )
        contrasts.push([p.candidate, x]);
    for (const contrast of contrasts)
      for (const metric of BEHAVIOUR_METRICS) {
        const d = diffs(idx, seeds, c.id, contrast, metric);
        const direction = METRIC_DIRECTION[metric];
        const i = interval(
          d.points,
          `secondary:${c.id}:${metric}:${contrast.join("-")}`,
          1 - a.alpha,
          direction === "neutral" ? "higher" : direction,
        );
        secondary.push({
          condition: c.id,
          contrast,
          metric,
          interval: i,
          reading: reading(i, direction),
          missing: d.missing,
        });
      }
  }

  const learning: LearningSummary[] = [];
  const trajectories: Summary["trajectories"] = {};
  const means: Summary["means"] = {};
  for (const c of p.conditions) {
    trajectories[c.id] = {};
    means[c.id] = {};
    for (const controller of controllersIn(p, c)) {
      const rows = seeds
        .map((seed) => idx.get(unitKey({ seed, condition: c.id, controller })))
        .filter(complete);
      means[c.id]![controller] = Object.fromEntries(
        BEHAVIOUR_METRICS.map((m) => {
          const v = rows
            .map((r) => r.behaviour[m])
            .filter((x): x is number => x !== null);
          return [m, meanOrNull(v)];
        }),
      );
      const blocks = rows[0]?.blocks.length ?? 0;
      const traj: TrajectoryPoint[] = [];
      for (let b = 0; b < blocks; b++) {
        const at = rows.map((r) => r.blocks[b]).filter((x) => x !== undefined);
        const caut = at.map((x) => x.cautious).filter((x): x is boolean => x !== null);
        const beliefs = at.map((x) => x.belief).filter((x): x is number => x !== null);
        const dist = at
          .map((x) => x.foodDistanceM)
          .filter((x): x is number => x !== null);
        traj.push({
          t: at[0]!.t,
          fedJ: mean(at.map((x) => x.fedJ)),
          meals: mean(at.map((x) => x.meals)),
          walkedM: mean(at.map((x) => x.walkedM)),
          adaptations: mean(at.map((x) => x.adaptations)),
          cautiousShare: caut.length ? caut.filter(Boolean).length / caut.length : null,
          belief: meanOrNull(beliefs),
          truth: at[0]!.truth,
          foodDistanceM: meanOrNull(dist),
        });
      }
      trajectories[c.id]![controller] = traj;
      const pl = rows.map((r) => r.plasticity).filter((x) => x !== null);
      const sm = rows.map((r) => r.selfModel).filter((x) => x !== null);
      const detected = pl.filter((x) => x.detectionS !== null);
      const releasable = c.episodes.length && c.episodes.every((e) => e.until !== null);
      const released = detected.filter((x) => x.releaseS !== null);
      learning.push({
        condition: c.id,
        controller,
        runs: rows.length,
        plasticity: pl.length
          ? {
              detectedShare: detected.length / pl.length,
              detectionMeanS: meanOrNull(detected.map((x) => x.detectionS!)),
              falseAlarmShare: pl.filter((x) => x.cautiousBeforeOnset).length / pl.length,
              releasedShare:
                releasable && detected.length ? released.length / detected.length : null,
              releaseMeanS: releasable
                ? meanOrNull(released.map((x) => x.releaseS!))
                : null,
              adaptationsMean: mean(pl.map((x) => x.adaptations)),
              samplesMean: mean(pl.map((x) => x.samples)),
              failureNormalMean: mean(pl.map((x) => x.failureNormal)),
            }
          : null,
        selfModel: sm.length
          ? {
              target: sm[0]!.target,
              convergedShare: sm.filter((x) => x.convergedS !== null).length / sm.length,
              convergedMeanS: meanOrNull(
                sm.map((x) => x.convergedS).filter((x): x is number => x !== null),
              ),
              errorEndMean: meanOrNull(
                sm.map((x) => x.errorEnd).filter((x): x is number => x !== null),
              ),
              noticedBeforeMean: mean(sm.map((x) => x.noticedBeforeOnset)),
              noticedAfterMean: mean(sm.map((x) => x.noticedAfterOnset)),
              calibration90Mean: meanOrNull(
                sm.map((x) => x.calibration90).filter((x): x is number => x !== null),
              ),
              calibration50Mean: meanOrNull(
                sm.map((x) => x.calibration50).filter((x): x is number => x !== null),
              ),
            }
          : null,
      });
    }
  }

  const distributions: Summary["distributions"] = [];
  const plotMetrics = [
    ...new Set([
      ...p.endpoints.confirmatory.map((e) => e.metric),
      p.endpoints.boundary.metric,
    ]),
  ];
  for (const c of p.conditions)
    for (const metric of plotMetrics)
      for (const x of controllersIn(p, c).filter(
        (x) => x !== p.baseline && !p.validity.identicalToBaseline.includes(x),
      )) {
        const contrast: [ControllerId, ControllerId] = [x, p.baseline];
        distributions.push({
          condition: c.id,
          metric,
          contrast,
          points: diffs(idx, seeds, c.id, contrast, metric).points,
        });
      }

  const failureCases: Summary["failureCases"] = [];
  for (const c of p.conditions) {
    const metric = p.endpoints.boundary.metric;
    const sign = METRIC_DIRECTION[metric] === "lower" ? -1 : 1;
    const pts = diffs(idx, seeds, c.id, [p.candidate, p.baseline], metric).points;
    const worst = [...pts].sort(
      (x, y) => sign * x.diff - sign * y.diff || x.seed - y.seed,
    );
    for (const w of worst.slice(0, 3)) {
      if (sign * w.diff >= 0) continue;
      const rc = idx.get(
        unitKey({ seed: w.seed, condition: c.id, controller: p.candidate }),
      )!;
      const rb = idx.get(
        unitKey({ seed: w.seed, condition: c.id, controller: p.baseline }),
      )!;
      failureCases.push({
        condition: c.id,
        seed: w.seed,
        metric,
        candidate: rc.behaviour[metric]!,
        baseline: rb.behaviour[metric]!,
        diff: w.diff,
        adaptations: rc.plasticity?.adaptations ?? null,
      });
    }
  }

  const byController: Summary["compute"]["byController"] = {};
  const allControllers = [...new Set(units.map((u) => u.controller))];
  for (const controller of allControllers) {
    const rows = records.filter((r) => r.controller === controller && complete(r));
    byController[controller] = {
      runs: rows.length,
      wallSMedian: median(rows.map((r) => r.compute.wallS)),
      cpuSMedian: median(
        rows.map((r) => r.compute.cpuS).filter((x): x is number => x !== null),
      ),
      ticksPerWallSMedian: median(
        rows.map((r) => r.compute.ticksPerWallS).filter((x): x is number => x !== null),
      ),
    };
  }

  const reasons: string[] = [];
  let overall: Verdict;
  const conf = confirmatory.map((c) => c.verdict);
  const harm = guardrails.filter((g) => g.regression);
  if (!valid) {
    overall = "INVALID";
    for (const c of checks.filter((x) => !x.passed))
      reasons.push(`validity check ${c.id} failed: ${c.detail}`);
  } else if (conf.includes("REGRESSION")) {
    overall = "REGRESSION";
    reasons.push("a confirmatory endpoint regressed");
  } else if (conf.includes("IMPROVEMENT")) {
    if (harm.length) {
      overall = "INCONCLUSIVE";
      reasons.push(
        "a confirmatory endpoint improved, but a guardrail regressed: a trade-off, not an improvement",
      );
    } else {
      overall = "IMPROVEMENT";
      reasons.push(
        "a confirmatory endpoint improved by at least its minimum meaningful effect, none regressed, and no guardrail regressed",
      );
    }
  } else if (harm.length) {
    overall = "REGRESSION";
    reasons.push("no confirmatory endpoint improved and a guardrail regressed");
  } else if (conf.every((v) => v === "NO_DEMONSTRATED_IMPROVEMENT")) {
    overall = "NO_DEMONSTRATED_IMPROVEMENT";
    reasons.push(
      "every confirmatory interval lies inside its minimum meaningful effect: any effect is too small to matter",
    );
  } else {
    overall = "INCONCLUSIVE";
    reasons.push(
      "at least one confirmatory interval is too wide to decide, and none improved or regressed",
    );
  }
  for (const c of confirmatory)
    reasons.push(
      `${c.id}: ${c.metric} in ${c.condition}, ${c.contrast[0]} − ${c.contrast[1]} = ${fmt(c.interval.mean)} (${fmt(c.interval.level * 100, 1)}% ${fmt(c.interval.low)} to ${fmt(c.interval.high)}, δ = ${c.mme}): ${c.verdict}`,
    );
  for (const g of harm)
    reasons.push(
      `guardrail ${g.metric} in ${g.condition} regressed: ${fmt(g.interval.mean)} (${fmt(g.interval.low)} to ${fmt(g.interval.high)})`,
    );

  const summary: Summary = {
    schema: SUMMARY_SCHEMA,
    protocol: { id: p.id, digest, title: p.title },
    split,
    design: {
      seeds,
      conditions: p.conditions.map((c) => c.id),
      controllers: allControllers,
      unitsExpected: expected.size,
      recordsPresent: records.length,
      complete: records.filter((r) => r.status === "complete").length,
      failed: failed.map((r) => ({ key: unitKey(r), status: r.status, error: r.error })),
    },
    validity: { valid, checks },
    verdict: { overall, reasons },
    confirmatory,
    guardrails,
    boundary,
    mechanism,
    impairmentCost,
    secondary,
    learning,
    trajectories,
    means,
    distributions,
    failureCases,
    compute: {
      note: "Wall and CPU time per run on the machine machine.json names, with several shards running at once: machine-dependent, never compared by the verifier, never in a verdict. See the compute benchmark for controlled measurements.",
      byController,
    },
    answers: [],
  };
  summary.answers = answer(p, summary);
  return finite(summary);
}

/** The six questions the bench exists to answer, answered from the summary's numbers. */
function answer(p: Protocol, s: Summary): Summary["answers"] {
  const out: Summary["answers"] = [];
  const v = s.verdict.overall;
  out.push({
    id: "Q1",
    question:
      "Does the proposed controller outperform the existing controller under controlled conditions?",
    answer:
      v === "IMPROVEMENT"
        ? `Yes, within this protocol: ${s.verdict.reasons[0]}.`
        : v === "INVALID"
          ? "Not answerable: the experiment violated its protocol (see validity)."
          : `No improvement was demonstrated (${v}). ${s.confirmatory.map((c) => `${c.id}: ${c.verdict}`).join("; ")}.`,
  });
  const ident = s.validity.checks.find((c) => c.id === "identical-to-baseline");
  const mech = s.mechanism
    .map((m) => `${m.contrast[0]} − ${m.contrast[1]} in ${m.condition}: ${m.verdict}`)
    .join("; ");
  out.push({
    id: "Q2",
    question:
      "Can an improvement be attributed to a specific mechanism rather than greater complexity, different seeds or more computation?",
    answer: `${v === "IMPROVEMENT" ? "An improvement exists; the mechanism contrasts say which part carries it." : "There is no demonstrated improvement to attribute."} Controls: every controller met the same environment per unit (${s.validity.checks.find((c) => c.id === "paired-environment")?.detail ?? "n/a"}); carrying the plasticity without its action changed nothing (${ident?.detail ?? "n/a"}). Mechanism family (corrected): ${mech || "none"}.`,
  });
  const novel = new Set(p.conditions.filter((c) => c.novelToCandidate).map((c) => c.id));
  const bound = s.boundary
    .filter((b) => b.contrast[0] === p.candidate && b.contrast[1] === p.baseline)
    .map(
      (b) =>
        `${b.condition}${novel.has(b.condition) ? " (unseen by the candidate)" : ""}: ${b.verdict}`,
    );
  out.push({
    id: "Q3",
    question: "Does the improvement generalize to previously unseen conditions?",
    answer: `Per condition, ${p.candidate} − ${p.baseline} on ${p.endpoints.boundary.metric}, corrected over the family: ${bound.join("; ")}.`,
  });
  const acted = s.learning.filter((l) => l.controller === p.candidate && l.plasticity);
  out.push({
    id: "Q4",
    question: "Does experience produce measurable changes in subsequent behaviour?",
    answer: acted.length
      ? `The candidate's learned state changed what it did only where it became cautious: ${acted
          .map(
            (l) =>
              `${l.condition}: detected in ${fmt(l.plasticity!.detectedShare * 100, 0)}% of subjects, ${fmt(l.plasticity!.adaptationsMean, 0)} slowed walks per run`,
          )
          .join("; ")}. Whether that change helped is Q1 and Q3, not this.`
      : "The candidate carries no learned state the bench can read.",
  });
  const cb = s.compute.byController[p.candidate],
    bb = s.compute.byController[p.baseline];
  out.push({
    id: "Q5",
    question: "How much additional computation does the improvement require?",
    answer: `Per-run CPU, median on this machine under concurrent shards: ${p.candidate} ${fmt(cb?.cpuSMedian ?? null, 1)} s vs ${p.baseline} ${fmt(bb?.cpuSMedian ?? null, 1)} s for ${p.durationS} simulated s. The compute benchmark (single process, interleaved) is the controlled measurement; neither is hardware-independent.`,
  });
  const reverse = s.boundary
    .filter((b) => b.verdict === "REGRESSION")
    .map((b) => `${b.contrast.join(" − ")} in ${b.condition}`);
  const inert = acted
    .filter((l) => l.plasticity!.adaptationsMean === 0)
    .map((l) => l.condition);
  const insensitive = s.impairmentCost
    .filter((c) => !c.sensitive)
    .map((c) => c.condition);
  out.push({
    id: "Q6",
    question: "Under what conditions does the apparent improvement disappear or reverse?",
    answer: `Regressions (corrected): ${reverse.length ? reverse.join("; ") : "none detected"}. The candidate never acted in: ${inert.length ? inert.join(", ") : "no condition"}, so no effect was possible there. The impairment's cost to the baseline was not detected in: ${insensitive.length ? insensitive.join(", ") : "no condition"}: there, no compensation could have been shown.`,
  });
  return out;
}
