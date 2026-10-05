import type { Axis } from "../pilot/contract.js";
import {
  calibrate,
  climatologyBrier,
  type CalibrationReport,
  type CalibrationSample,
} from "./calibration.js";
import {
  contributions,
  type ContributionReport,
  type Factor,
  type FactorArm,
} from "./contribution.js";
import { REMOTE_BRAINS, type ArmSpec, type ExperimentSpec } from "./experimentSpec.js";
import { buildLedger, ledgerCalls, type Ledger } from "./ledger.js";
import {
  METRICS,
  metricDefinition,
  type EpisodeInput,
  type EpisodeReport,
} from "./metricRegistry.js";
import {
  decisionType,
  type DecisionTypeContract,
  type OutcomeClass,
} from "./outcomeContracts.js";
import type { PricingConfig } from "./pricing.js";
import type { ConfidenceSource, DecisionRecord, FailureRecord } from "./records.js";
import {
  mean,
  pairedDifference,
  summarize,
  tQuantile975,
  wilson,
  type Interval,
  type PairedDifference,
  type SampleSummary,
} from "./stats.js";
import {
  detectWarnings,
  slotPositionBias,
  type ArmView,
  type BenchmarkWarning,
} from "./warnings.js";

/**
 * `blacksite-evaluation/v1`: one experiment's result, in a form that can be
 * archived, diffed and re-analysed without this code.
 *
 * It is built offline from what the browser measured — benchmark episode
 * reports and decision records — and the experiment's declared contract. It
 * holds every episode (not just averages), every warning, the ledger, and the
 * provenance needed to find the raw files it came from. A result is only as
 * good as its trail back to those files, so every arm lists its artifacts.
 *
 * Re-running the evaluation on the same inputs produces the same JSON except
 * `generatedAt`; `evaluation.test.ts` pins that.
 */

export const EVALUATION_SCHEMA = "blacksite-evaluation/v1";

export interface BrainMeta {
  /** Descriptor id, e.g. `jev`, `llm:anthropic`, `script:marksman`, `random`. */
  id: string;
  kind: string;
  provider: string;
  models: string[];
  policy: string | null;
  confidenceSources: ConfidenceSource[];
  /** A test double stands in for the model. Its results are never a model's. */
  testDouble: boolean;
  /** The service's stated configuration at the start of the arm (see `ArmRun.service`). */
  parameters: Record<string, unknown> | null;
}

export interface EpisodeRun {
  runId: string;
  seed: number;
  simSeconds: number;
  wallSeconds: number;
  lagged: boolean;
  metrics: EpisodeReport & {
    opponent?: { roundsInSight: number; hitsOnSeat: number } | null;
  };
  decisions: DecisionRecord[];
  failures: FailureRecord[];
  brain: { id: string; kind: string; provider: string; testDouble: boolean };
  interface: Record<string, string | number | boolean | null>;
  artifacts: { report: string; decisions: string | null; trace: string | null };
}

export interface ArmRun {
  arm: ArmSpec;
  query: string;
  origin: string;
  build: string | null;
  episodes: EpisodeRun[];
  /** Set when the arm was not run, e.g. live flags missing. */
  pending: string | null;
  /**
   * The remote service's own status at the start of the arm — provider, model
   * alias, effort, confidence mode, limits — as its model parameters. Null for
   * local brains. Never contains a key.
   */
  service?: Record<string, unknown> | null;
}

export interface DecisionMetrics {
  contract: string;
  rule: string;
  controllerCannot: string;
  matched: number;
  scored: number;
  incomplete: number;
  classes: Record<OutcomeClass, number>;
  successRate: number | null;
  successInterval: Interval | null;
  harmfulRate: number | null;
  harmfulInterval: Interval | null;
  measure: { name: string; unit: string; summary: SampleSummary };
  /** Outcome by the option chosen on the contract's axis. */
  byChoice: Record<string, { n: number; successRate: number | null }>;
  slotBias: { firstShare: number; expected: number; n: number } | null;
  note: string;
}

export interface ValidationSummary {
  executed: number;
  executedIllegal: number;
  rejectedStale: number;
  superseded: number;
  notExecuted: number;
  worldChanged: number;
  worldChangeKinds: Record<string, number>;
  failures: Record<string, number>;
  staleAnswers: number;
  ageAtExecutionMs: SampleSummary;
  recoveryAfterRejectionS: SampleSummary;
  /** How often the world changed, by how long the decision took. */
  byLatency: {
    bucket: string;
    n: number;
    worldChangedRate: number | null;
    illegalRate: number | null;
  }[];
}

export interface ArmEvaluation {
  id: string;
  status: "complete" | "pending" | "failed";
  pendingReason: string | null;
  brain: BrainMeta;
  config: ArmSpec & { query: string; origin: string; build: string | null };
  episodes: {
    runId: string;
    seed: number;
    simSeconds: number;
    wallSeconds: number;
    lagged: boolean;
    decisions: number;
    failures: number;
    metrics: Record<string, number | null>;
    interface: Record<string, string | number | boolean | null>;
    artifacts: EpisodeRun["artifacts"];
  }[];
  aggregate: Record<string, SampleSummary>;
  decisionMetrics: DecisionMetrics | null;
  calibration:
    | ({
        available: true;
        source: ConfidenceSource;
        field: string;
        axis: Axis;
        climatologyBrier: number | null;
      } & CalibrationReport)
    | { available: false; reason: string };
  ledger: Ledger;
  validation: ValidationSummary;
}

export interface Comparison {
  metric: string;
  reference: string;
  arm: string;
  difference: PairedDifference;
}

export interface SweepPoint {
  arm: string;
  value: number;
  primary: SampleSummary;
  successRate: number | null;
  decisions: number;
}

export interface Sweep {
  param: "latencyMs" | "cadenceMs";
  base: string;
  points: SweepPoint[];
  /** Least-squares slope of the per-episode primary metric per 100 ms, with a 95% interval. */
  slopePer100ms: { estimate: number; interval: Interval | null; n: number } | null;
  reading: string;
}

export interface Evaluation {
  schema: typeof EVALUATION_SCHEMA;
  generatedAt: string;
  status: "complete" | "partial" | "pending";
  experiment: {
    id: string;
    question: string;
    hypothesis: string;
    independentVariable: string;
    primaryMetric: { id: string; label: string; unit: string; description: string };
    secondaryMetrics: string[];
    decisionType: { id: string; rule: string; applies: string } | null;
    outcomeWindowS: number;
    seeds: number[];
    seedPreset: string | null;
    durationS: number;
    mode: string;
    definitionHash: string;
    definition: ExperimentSpec;
  };
  environment: Record<string, string | number | boolean | null>;
  provenance: Record<string, string | number | boolean | null | string[]>;
  arms: ArmEvaluation[];
  comparisons: Comparison[];
  sweeps: Sweep[];
  contribution: ContributionReport | null;
  warnings: BenchmarkWarning[];
  artifacts: { definition: string; arms: Record<string, string[]> };
  notes: string[];
}

export interface BuildInput {
  spec: ExperimentSpec;
  specHash: string;
  definitionPath: string;
  arms: ArmRun[];
  pricing: PricingConfig | null;
  environment: Record<string, string | number | boolean | null>;
  provenance: Record<string, string | number | boolean | null | string[]>;
  generatedAt: string;
}

const STANDARD_METRICS = [
  "kills_per_minute",
  "deaths_per_minute",
  "accuracy",
  "damage_dealt_per_minute",
  "damage_taken_per_minute",
  "exposure_fraction",
  "distance_m",
  "decisions_per_minute",
];

function episodeInput(run: EpisodeRun): EpisodeInput {
  return {
    seed: run.seed,
    metrics: run.metrics,
    decisions: run.decisions,
    failures: run.failures,
  };
}

function readConfidence(
  record: DecisionRecord,
  axis: Axis,
  field: "probability" | "confidence",
): number | null {
  if (record.confidence.source === "none") return null;
  return record.confidence.perAxis[axis]?.[field] ?? null;
}

function decisionMetrics(
  records: readonly DecisionRecord[],
  contract: DecisionTypeContract,
): DecisionMetrics {
  const matched = records.filter((r) => contract.matches(r));
  const classes: Record<OutcomeClass, number> = { beneficial: 0, neutral: 0, harmful: 0 };
  let scored = 0;
  const byChoice: Record<string, { n: number; success: number }> = {};
  for (const r of matched) {
    const cls = contract.classify(r);
    if (cls === null) continue;
    scored += 1;
    classes[cls] += 1;
    const key = r.frame[contract.calibrationAxis];
    byChoice[key] ??= { n: 0, success: 0 };
    byChoice[key].n += 1;
    if (cls === "beneficial") byChoice[key].success += 1;
  }
  const measure = matched
    .filter((r) => r.outcome?.complete)
    .map((r) => contract.measure.read(r))
    .filter((v): v is number => v !== null);
  const slotAxis =
    contract.calibrationAxis === "target" || contract.calibrationAxis === "go"
      ? contract.calibrationAxis
      : null;
  return {
    contract: contract.id,
    rule: contract.rule,
    controllerCannot: contract.controllerCannot,
    matched: matched.length,
    scored,
    incomplete: matched.length - scored,
    classes,
    successRate: scored > 0 ? classes.beneficial / scored : null,
    successInterval: wilson(classes.beneficial, scored),
    harmfulRate: scored > 0 ? classes.harmful / scored : null,
    harmfulInterval: wilson(classes.harmful, scored),
    measure: {
      name: contract.measure.name,
      unit: contract.measure.unit,
      summary: summarize(measure),
    },
    byChoice: Object.fromEntries(
      Object.entries(byChoice)
        .sort((a, b) => b[1].n - a[1].n)
        .map(([k, v]) => [k, { n: v.n, successRate: v.n > 0 ? v.success / v.n : null }]),
    ),
    slotBias: slotAxis ? slotPositionBias(matched, slotAxis) : null,
    note: "Pooled over every episode's decisions. Consecutive decisions share most of their outcome window, so these are not independent samples; intervals describe spread, not significance.",
  };
}

const LATENCY_BUCKETS: [string, number, number][] = [
  ["<100 ms", 0, 100],
  ["100–250 ms", 100, 250],
  ["250–500 ms", 250, 500],
  ["500–1000 ms", 500, 1000],
  ["≥1000 ms", 1000, Infinity],
];

function validationSummary(runs: readonly EpisodeRun[]): ValidationSummary {
  const records = runs.flatMap((r) => r.decisions);
  const failures = runs.flatMap((r) => r.failures);
  const count = (status: string): number =>
    records.filter((r) => r.validation.status === status).length;
  const kinds: Record<string, number> = {};
  for (const r of records) {
    for (const change of r.validation.worldChanged)
      kinds[change] = (kinds[change] ?? 0) + 1;
  }
  const failureKinds: Record<string, number> = {};
  for (const f of failures) failureKinds[f.kind] = (failureKinds[f.kind] ?? 0) + 1;
  // Recovery: from a refused decision to the next one that executed, same episode.
  const recovery: number[] = [];
  for (const run of runs) {
    const sorted = [...run.decisions].sort((a, b) => a.sequence - b.sequence);
    sorted.forEach((r, i) => {
      if (r.validation.status !== "rejected_stale") return;
      const next = sorted
        .slice(i + 1)
        .find(
          (n) =>
            n.validation.status === "executed" ||
            n.validation.status === "executed_illegal",
        );
      if (next?.execution.actionStart != null) {
        recovery.push(Math.max(0, next.execution.actionStart - r.acceptedAtSim));
      }
    });
  }
  const reached = records.filter(
    (r) =>
      r.validation.status === "executed" ||
      r.validation.status === "executed_illegal" ||
      r.validation.status === "rejected_stale",
  );
  return {
    executed: count("executed"),
    executedIllegal: count("executed_illegal"),
    rejectedStale: count("rejected_stale"),
    superseded: count("superseded"),
    notExecuted: count("not_executed"),
    worldChanged: reached.filter((r) => r.validation.worldChanged.length > 0).length,
    worldChangeKinds: kinds,
    failures: failureKinds,
    staleAnswers: failures.filter((f) => f.staleAnswer).length,
    ageAtExecutionMs: summarize(
      records
        .map((r) => r.validation.ageAtExecutionMs)
        .filter((v): v is number => v !== null),
    ),
    recoveryAfterRejectionS: summarize(recovery),
    byLatency: LATENCY_BUCKETS.map(([bucket, lo, hi]) => {
      const inBucket = reached.filter((r) => {
        const age = r.validation.ageAtExecutionMs;
        return age !== null && age >= lo && age < hi;
      });
      return {
        bucket,
        n: inBucket.length,
        worldChangedRate:
          inBucket.length > 0
            ? inBucket.filter((r) => r.validation.worldChanged.length > 0).length /
              inBucket.length
            : null,
        illegalRate:
          inBucket.length > 0
            ? inBucket.filter((r) => r.validation.illegalAtExecution.length > 0).length /
              inBucket.length
            : null,
      };
    }),
  };
}

/** The fields of a service status that describe how the model is asked. */
function pickParameters(status: Record<string, unknown>): Record<string, unknown> {
  const keep = [
    "service",
    "provider",
    "model",
    "confidence",
    "effort",
    "limits",
    "actionContract",
    "observationSchema",
  ];
  return Object.fromEntries(Object.entries(status).filter(([k]) => keep.includes(k)));
}

function brainMeta(run: ArmRun): BrainMeta {
  const records = run.episodes.flatMap((e) => e.decisions);
  const first = run.episodes[0]?.brain;
  const sources = [...new Set(records.map((r) => r.confidence.source))].sort();
  return {
    id:
      first?.id ??
      (run.arm.brain === "script" ? `script:${run.arm.policy}` : run.arm.brain),
    kind: run.arm.brain,
    provider:
      first?.provider ??
      (run.arm.brain === "jev"
        ? "typesafe"
        : run.arm.brain === "glide"
          ? "fastino"
          : run.arm.brain === "llm"
            ? "unknown"
            : "local"),
    models: [
      ...new Set(
        records.map((r) => r.accounting.model).filter((m): m is string => m !== null),
      ),
    ].sort(),
    policy: run.arm.policy ?? null,
    confidenceSources: sources,
    testDouble: run.episodes.some((e) => e.brain.testDouble),
    parameters: run.service ? pickParameters(run.service) : null,
  };
}

function objectiveOf(
  spec: ExperimentSpec,
  runs: readonly EpisodeRun[],
): { label: string; count: number } {
  // In team deathmatch the team scores by eliminations, so an elimination is
  // the objective the mode itself counts. Other modes are labelled as such.
  return {
    label:
      spec.mode === "tdm" || spec.mode === "ffa"
        ? "eliminations (the mode's scoring event)"
        : "eliminations (not this mode's objective)",
    count: runs.reduce((a, r) => a + r.metrics.kills, 0),
  };
}

function evaluateArm(
  run: ArmRun,
  spec: ExperimentSpec,
  pricing: PricingConfig | null,
): ArmEvaluation {
  const contract = spec.decisionType ? decisionType(spec.decisionType) : null;
  const metricIds = [
    ...new Set([spec.primaryMetric, ...spec.secondaryMetrics, ...STANDARD_METRICS]),
  ];
  const episodes = run.episodes.map((e) => {
    const input = episodeInput(e);
    const metrics: Record<string, number | null> = {};
    for (const id of metricIds) {
      const def = metricDefinition(id)!;
      metrics[id] =
        def.level === "decision" && !contract ? null : def.read(input, contract);
    }
    return {
      runId: e.runId,
      seed: e.seed,
      simSeconds: e.simSeconds,
      wallSeconds: e.wallSeconds,
      lagged: e.lagged,
      decisions: e.decisions.length,
      failures: e.failures.length,
      metrics,
      interface: e.interface,
      artifacts: e.artifacts,
    };
  });
  const aggregate: Record<string, SampleSummary> = {};
  for (const id of metricIds) {
    aggregate[id] = summarize(
      episodes
        .map((e) => e.metrics[id])
        .filter((v): v is number => v !== null && v !== undefined),
    );
  }
  const records = run.episodes.flatMap((e) => e.decisions);
  const failures = run.episodes.flatMap((e) => e.failures);
  const metrics = contract ? decisionMetrics(records, contract) : null;

  let calibration: ArmEvaluation["calibration"];
  const sources = [...new Set(records.map((r) => r.confidence.source))].filter(
    (s) => s !== "none",
  );
  if (!contract) {
    calibration = {
      available: false,
      reason: "the experiment declares no decision type to score against",
    };
  } else if (sources.length === 0) {
    calibration = {
      available: false,
      reason: `${run.arm.brain} states no probability or confidence; none is filled in`,
    };
  } else if (sources.length > 1) {
    calibration = {
      available: false,
      reason: `mixed confidence sources (${sources.join(", ")}) are not pooled`,
    };
  } else {
    const axis = contract.calibrationAxis;
    const samples = records
      .filter((r) => contract.matches(r))
      .map((r) => ({
        p: readConfidence(r, axis, spec.calibrationField),
        cls: contract.classify(r),
      }))
      .filter(
        (s): s is { p: number; cls: OutcomeClass } => s.p !== null && s.cls !== null,
      )
      .map((s): CalibrationSample => ({ p: s.p, y: s.cls === "beneficial" ? 1 : 0 }));
    calibration = {
      available: true,
      source: sources[0]!,
      field: spec.calibrationField,
      axis,
      climatologyBrier: climatologyBrier(samples),
      ...calibrate(samples),
    };
  }

  const simSeconds = run.episodes.reduce((a, e) => a + e.simSeconds, 0);
  const provider = run.episodes[0]?.brain.provider ?? "local";
  const calls = ledgerCalls(records, failures, pricing, {
    provider,
    model: records.find((r) => r.accounting.model)?.accounting.model ?? null,
  });
  const ledger = buildLedger(
    calls,
    simSeconds,
    objectiveOf(spec, run.episodes),
    metrics ? metrics.classes.beneficial : null,
  );
  return {
    id: run.arm.id,
    status: run.pending ? "pending" : run.episodes.length === 0 ? "failed" : "complete",
    pendingReason: run.pending,
    brain: brainMeta(run),
    config: { ...run.arm, query: run.query, origin: run.origin, build: run.build },
    episodes,
    aggregate,
    decisionMetrics: metrics,
    calibration,
    ledger,
    validation: validationSummary(run.episodes),
  };
}

function primaryBySeed(arm: ArmEvaluation, metric: string): Map<number, number | null> {
  return new Map(arm.episodes.map((e) => [e.seed, e.metrics[metric] ?? null]));
}

function sweeps(arms: readonly ArmEvaluation[], spec: ExperimentSpec): Sweep[] {
  const out: Sweep[] = [];
  for (const param of ["latencyMs", "cadenceMs"] as const) {
    const tagged = arms.filter(
      (a) => a.config[param] !== undefined && a.status === "complete",
    );
    const groups = new Map<string, ArmEvaluation[]>();
    for (const arm of tagged) {
      const base = arm.id.replace(/@(lat|cad)\d+$/, "");
      groups.set(base, [...(groups.get(base) ?? []), arm]);
    }
    for (const [base, group] of groups) {
      if (group.length < 2) continue;
      const points = group
        .map((arm) => ({
          arm: arm.id,
          value: arm.config[param]!,
          primary: arm.aggregate[spec.primaryMetric]!,
          successRate: arm.decisionMetrics?.successRate ?? null,
          decisions: arm.episodes.reduce((a, e) => a + e.decisions, 0),
        }))
        .sort((a, b) => a.value - b.value);
      // Per-episode regression of the primary metric on the swept value.
      const xs: number[] = [];
      const ys: number[] = [];
      for (const arm of group) {
        for (const e of arm.episodes) {
          const y = e.metrics[spec.primaryMetric];
          if (y === null || y === undefined) continue;
          xs.push(arm.config[param]! / 100);
          ys.push(y);
        }
      }
      let slope: Sweep["slopePer100ms"] = null;
      if (xs.length >= 3 && new Set(xs).size >= 2) {
        const mx = mean(xs)!;
        const my = mean(ys)!;
        let sxx = 0;
        let sxy = 0;
        for (let i = 0; i < xs.length; i += 1) {
          sxx += (xs[i]! - mx) ** 2;
          sxy += (xs[i]! - mx) * (ys[i]! - my);
        }
        const b = sxy / sxx;
        const residuals = ys.map((y, i) => y - (my + b * (xs[i]! - mx)));
        const s2 = residuals.reduce((a, r) => a + r * r, 0) / (xs.length - 2);
        const se = Math.sqrt(s2 / sxx);
        const half = xs.length > 2 ? tQuantile975(xs.length - 2) * se : NaN;
        slope = {
          estimate: b,
          interval: Number.isFinite(half)
            ? {
                lo: b - half,
                hi: b + half,
                method: `95% t interval on the OLS slope, n=${xs.length} episodes`,
              }
            : null,
          n: xs.length,
        };
      }
      const reading =
        slope?.interval == null
          ? "Too few episodes to estimate a slope."
          : slope.interval.lo <= 0 && slope.interval.hi >= 0
            ? `No detectable linear change in ${spec.primaryMetric} across ${param} ${points[0]!.value}–${points[points.length - 1]!.value} at this sample size. That is not evidence of no effect, only of none large enough to see.`
            : `${spec.primaryMetric} changes by ${slope.estimate.toFixed(3)} per 100 ms (interval excludes zero) across this range: sensitive to ${param === "latencyMs" ? "decision latency" : "decision cadence"} here.`;
      out.push({ param, base, points, slopePer100ms: slope, reading });
    }
  }
  return out;
}

export function buildEvaluation(input: BuildInput): Evaluation {
  const { spec } = input;
  const primaryDef = metricDefinition(spec.primaryMetric)!;
  const contract = spec.decisionType ? decisionType(spec.decisionType) : null;
  const arms = input.arms.map((run) => evaluateArm(run, spec, input.pricing));
  const complete = arms.filter((a) => a.status === "complete");

  const references =
    spec.controls.length > 0 ? spec.controls : complete[0] ? [complete[0].id] : [];
  const comparisons: Comparison[] = [];
  for (const metric of [spec.primaryMetric, ...spec.secondaryMetrics]) {
    for (const ref of references) {
      const reference = complete.find((a) => a.id === ref);
      if (!reference) continue;
      for (const arm of complete) {
        if (arm.id === ref) continue;
        comparisons.push({
          metric,
          reference: ref,
          arm: arm.id,
          difference: pairedDifference(
            primaryBySeed(reference, metric),
            primaryBySeed(arm, metric),
          ),
        });
      }
    }
  }

  const views: ArmView[] = complete.map((arm) => {
    const run = input.arms.find((r) => r.arm.id === arm.id)!;
    const opp = run.episodes.map((e) => e.metrics.opponent ?? null);
    const allOpp = opp.every((o) => o !== null);
    const exposures = run.episodes
      .map((e) => e.metrics.debrief?.exposedFraction ?? null)
      .filter((v): v is number => v !== null);
    return {
      id: arm.id,
      brain: arm.config.brain,
      control: arm.config.control,
      navigation: arm.config.navigation ?? "places",
      motor: arm.config.motor ?? "standard",
      policy: arm.config.policy ?? null,
      seeds: arm.episodes.map((e) => e.seed),
      simSeconds: run.episodes.reduce((a, e) => a + e.simSeconds, 0),
      kills: run.episodes.reduce((a, e) => a + e.metrics.kills, 0),
      deaths: run.episodes.reduce((a, e) => a + e.metrics.deaths, 0),
      distanceM: run.episodes.reduce((a, e) => a + e.metrics.distanceM, 0),
      exposureFraction: mean(exposures),
      opponentRoundsInSight: allOpp ? opp.reduce((a, o) => a + o.roundsInSight, 0) : null,
      opponentHitsOnSeat: allOpp ? opp.reduce((a, o) => a + o.hitsOnSeat, 0) : null,
      laggedEpisodes: run.episodes.filter((e) => e.lagged).length,
      decisions: run.episodes.flatMap((e) => e.decisions),
      primary: primaryBySeed(arm, spec.primaryMetric),
      costUnknown:
        REMOTE_BRAINS.includes(arm.config.brain) &&
        !arm.brain.testDouble &&
        arm.ledger.cost.totalUsd === null,
    };
  });
  const warnings = detectWarnings(views, primaryDef, spec.seeds.length);

  let contribution: ContributionReport | null = null;
  if (spec.contributionFactors.length > 0) {
    // A script's policy is part of which brain it is, unless the experiment
    // declares policy as its own factor; counting it twice would make every
    // script-versus-random pair differ in two factors.
    const policyFactor = spec.contributionFactors.includes("policy");
    const factorArms: FactorArm[] = complete.map((arm) => ({
      id: arm.id,
      levels: {
        brain:
          arm.config.brain === "script" && !policyFactor
            ? `script:${arm.config.policy}`
            : arm.config.brain,
        control: arm.config.control,
        navigation: arm.config.navigation ?? "places",
        motor: arm.config.motor ?? "standard",
        policy: policyFactor ? (arm.config.policy ?? "none") : "folded into brain",
      },
      primary: primaryBySeed(arm, spec.primaryMetric),
    }));
    contribution = contributions(factorArms, spec.contributionFactors as Factor[]);
  }

  const pending = arms.filter((a) => a.status === "pending");
  const status: Evaluation["status"] =
    complete.length === 0
      ? "pending"
      : pending.length > 0 || complete.length < arms.length
        ? "partial"
        : "complete";
  const notes = [
    "Episodes are the unit of every interval. Episodes on the same seed start the same match but diverge: frame pacing is not deterministic.",
    "Decision-level pools overlap in time; their n overstates independent evidence.",
  ];
  if (contract) notes.push(`Outcome contract ${contract.id}: ${contract.rule}`);
  for (const arm of pending)
    notes.push(
      `Arm ${arm.id} is pending: ${arm.pendingReason}. No figure for it is a measurement.`,
    );

  return {
    schema: EVALUATION_SCHEMA,
    generatedAt: input.generatedAt,
    status,
    experiment: {
      id: spec.id,
      question: spec.question,
      hypothesis: spec.hypothesis,
      independentVariable: spec.independentVariable,
      primaryMetric: {
        id: primaryDef.id,
        label: primaryDef.label,
        unit: primaryDef.unit,
        description: primaryDef.description,
      },
      secondaryMetrics: spec.secondaryMetrics,
      decisionType: contract
        ? { id: contract.id, rule: contract.rule, applies: contract.applies }
        : null,
      outcomeWindowS: spec.outcomeWindowS,
      seeds: spec.seeds,
      seedPreset: spec.seedPreset,
      durationS: spec.duration,
      mode: spec.mode,
      definitionHash: input.specHash,
      definition: spec,
    },
    environment: input.environment,
    provenance: input.provenance,
    arms,
    comparisons,
    sweeps: sweeps(arms, spec),
    contribution,
    warnings,
    artifacts: {
      definition: input.definitionPath,
      arms: Object.fromEntries(
        input.arms.map((run) => [
          run.arm.id,
          run.episodes.flatMap((e) =>
            [e.artifacts.report, e.artifacts.decisions, e.artifacts.trace].filter(
              (p): p is string => p !== null,
            ),
          ),
        ]),
      ),
    },
    notes,
  };
}

/** Structural validation of an evaluation file, for loaders and the UI. */
export function validateEvaluation(
  value: unknown,
): { ok: true; value: Evaluation } | { ok: false; error: string } {
  if (typeof value !== "object" || value === null)
    return { ok: false, error: "not an object" };
  const v = value as Record<string, unknown>;
  if (v["schema"] !== EVALUATION_SCHEMA)
    return { ok: false, error: `schema is not ${EVALUATION_SCHEMA}` };
  if (!["complete", "partial", "pending"].includes(String(v["status"])))
    return { ok: false, error: "status" };
  const experiment = v["experiment"] as Record<string, unknown> | undefined;
  if (
    !experiment ||
    typeof experiment["id"] !== "string" ||
    typeof experiment["definitionHash"] !== "string"
  ) {
    return { ok: false, error: "experiment id or definition hash missing" };
  }
  if (!Array.isArray(v["arms"])) return { ok: false, error: "arms missing" };
  for (const arm of v["arms"] as unknown[]) {
    const a = arm as Record<string, unknown>;
    if (
      typeof a?.["id"] !== "string" ||
      !Array.isArray(a["episodes"]) ||
      typeof a["ledger"] !== "object"
    ) {
      return { ok: false, error: "an arm is malformed" };
    }
    for (const e of a["episodes"] as unknown[]) {
      const ep = e as Record<string, unknown>;
      if (
        typeof ep?.["seed"] !== "number" ||
        typeof ep["runId"] !== "string" ||
        typeof ep["artifacts"] !== "object"
      ) {
        return {
          ok: false,
          error: `arm ${String(a["id"])}: an episode lacks seed, run id or artifacts`,
        };
      }
    }
  }
  if (!Array.isArray(v["warnings"])) return { ok: false, error: "warnings missing" };
  if (typeof v["provenance"] !== "object" || v["provenance"] === null)
    return { ok: false, error: "provenance missing" };
  return { ok: true, value: value as Evaluation };
}

/** Every registered metric id, for documentation and the UI. */
export const METRIC_IDS = METRICS.map((m) => m.id);
