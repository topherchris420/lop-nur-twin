/**
 * Pilots for the digital fly's protocols: exploratory runs that size a
 * protocol before anything is preregistered on it.
 *
 * A pilot runs a protocol's control arm and a series of doses on the first
 * half of the public pilot seeds (FLY_PILOT_SEEDS), and a null arm on the
 * second half, and reads, for every primary metric of its blocks, how often
 * matched seeds differ and in which direction, whether the control sits at a
 * bound, and how far trajectory divergence alone moves a mean. From that it
 * sizes, by rules written here, the seed count and minimum effect of the
 * scripted demonstration design (flyExample.ts) and the host's minimum effect
 * for the metrics the v3 redesign added.
 *
 * A pilot records everything it ran (its definition: apparatus, arms and
 * seeds), so it can be re-run exactly, and digests of its runs and outputs,
 * so a re-run shows whether the code still behaves the same.
 *
 * A pilot is never evidence. It is not preregistered, authorized or admitted;
 * its seeds are fixed and public, and the host never draws them for an
 * archived run (fly.ts), so no archived result is ever computed on a seed a
 * pilot has seen. Nothing here reads the disk: scripts/rain-fly.ts --pilot
 * writes the outputs to docs/benchmarks/fly-pilots/.
 */
import { canonicalJson, sha256Json } from "../sha256.js";
import { FLY_VERSION } from "../../bethesda/fly/fly.js";
import { PARAMS } from "../../bethesda/fly/params.js";
import {
  compileFlyExperiment,
  currentFlyEngine,
  describeFlyBaseline,
  describeFlyTreatment,
  flyEngineText,
  flyIdentity,
  FLY_PILOT_SEEDS,
  runFlyArm,
  signTestTail,
} from "./fly.js";
import { flyExample } from "./flyExample.js";
import {
  FLY_ALPHA,
  FLY_METRICS,
  FLY_MIN_UNTIED_PAIRS,
  FLY_PILOT,
  FLY_SEED_COUNT,
  type FlyArm,
  type FlyBlockSpec,
  type FlyCodeState,
  type FlyMetricId,
  type FlyProtocolId,
  type FlyRun,
  type FlyTreatment,
} from "./contracts.js";

/** How many pilot seeds a pilot's doses run: the first half of the public set. */
export const FLY_PILOT_SEEDS_USED = 32;
/** The sized design must pass G3, G4 and the sign test with this probability. */
export const FLY_PILOT_POWER = 0.9;
/** Confidence of the one-sided bounds the sizing puts on pilot proportions. */
const CONFIDENCE = 0.95;
/** Metrics the v3 redesign and Project ECHO added: their host minimum effects come from the pilots. */
export const FLY_PILOT_SIZED_METRICS: readonly FlyMetricId[] = [
  "near_miss_fraction",
  "escape_ttc_s",
  "impaired_path_error",
  "late_path_error",
  "baseline_path_error",
  "detection_latency_s",
  "identification_error",
  "attribution_accuracy",
  "false_self_attribution",
  "attribution_brier",
  "attribution_path_error",
  "reexposure_path_error",
  "reexposure_latency_s",
  "unfamiliar_path_error",
];

/** The doses a pilot runs against the control, the demonstration's among them. */
export const FLY_PILOT_SERIES: Partial<Record<FlyProtocolId, FlyTreatment[]>> = {
  obstacle_avoidance: [0.15, 0.3, 0.45, 0.9].map((avoid_ttc_s) => ({
    kind: "obstacle_avoidance" as const,
    avoid_ttc_s,
  })),
  visual_threat: [10, 20, 40, 80, 320].map((treatment_l_over_v_ms) => ({
    kind: "visual_threat" as const,
    control_l_over_v_ms: 160,
    treatment_l_over_v_ms,
  })),
  noisy_sensing: [0.1, 0.2, 0.4, 0.8].map((noise) => ({
    kind: "noisy_sensing" as const,
    noise,
  })),
  adaptation: [5, 10, 20, 40].map((isi_s) => ({ kind: "adaptation" as const, isi_s })),
  // ECHO: the full self-model is the control; each dose removes one mechanism.
  echo_impairment: (
    ["reactive", "no_learning", "no_uncertainty", "no_memory"] as const
  ).map((variant) => ({ kind: "echo_impairment" as const, variant })),
  echo_attribution: (
    ["naive_self", "motion_gated", "no_uncertainty", "no_memory"] as const
  ).map((variant) => ({ kind: "echo_attribution" as const, variant })),
  echo_retention: (["memory_reset", "no_memory", "no_learning", "reactive"] as const).map(
    (variant) => ({ kind: "echo_retention" as const, variant }),
  ),
};

/** What a pilot runs, recorded in full so that it can be re-run exactly. */
export interface FlyPilotDefinition {
  protocol: FlyProtocolId;
  /** The demonstration's dose, metric and direction: what the pilot sizes. */
  demonstration: {
    treatment: FlyTreatment;
    metric: FlyMetricId;
    direction: "increase" | "decrease";
  };
  /** The apparatus, compiled from the demonstration design. */
  blocks: FlyBlockSpec[];
  control: FlyArm;
  doses: { treatment: FlyTreatment; arm: FlyArm }[];
  /** The control and every dose run on these. */
  seeds: number[];
  /**
   * The null arm: the control again on these, paired in order with `seeds`.
   * Code and arm are the same and every random stream independent (the fly's
   * and the apparatus's draws), so its paired differences bound what
   * divergence alone can produce: a dose's pairs share the apparatus's draws,
   * and the fly's stream until they first differ. (Sensory noise of 1e-9 was
   * tried first and branched no decision.)
   */
  null_seeds: number[];
}

type Values = Record<string, number | null>;
export interface FlyPilotSeed {
  seed: number;
  metrics: Values;
}
/** One metric of one dose against the control, over the pilot seeds. */
export interface FlyPilotMetric {
  control_mean: number | null;
  treatment_mean: number | null;
  mean_difference: number | null;
  sd_difference: number | null;
  /** Seeds where the treatment is higher, lower, equal, or either is undefined. */
  increase: number;
  decrease: number;
  tie: number;
  undefined: number;
  control_at_floor: number;
  control_at_ceiling: number;
}
/** One arm of a pilot on every seed it ran. */
export interface FlyPilotArm {
  label: string;
  treatment: FlyTreatment | null;
  gate_refusals: number;
  per_seed: FlyPilotSeed[];
}
/** A dose (or the null arm) against the control, metric by metric. */
export interface FlyPilotDose extends FlyPilotArm {
  metrics: Record<string, FlyPilotMetric>;
}
/** What the pilot sized for the demonstration design, and how sure it is. */
export interface FlyPilotSizing {
  metric: FlyMetricId;
  direction: "increase" | "decrease";
  treatment: FlyTreatment;
  /** Seeds in the expected direction, opposite, tied or undefined, of the pilot's. */
  outcomes: { expected: number; opposite: number; uninformative: number };
  /** Smallest seed count in the host's range that passes with FLY_PILOT_POWER; null if none. */
  seed_count: number | null;
  /** The probability of passing G3, G4 and the sign test at that seed count (conservative). */
  pass_probability: number | null;
  /** Mean paired difference less 1.645 standard errors there, rounded down; null if not positive. */
  minimum_effect: number | null;
  host_minimum_effect: number;
  /** What the design uses: the larger of the two; null when the pilot sized nothing. */
  design_minimum_effect: number | null;
  /** The probability that S1 holds at the design's minimum effect, from the same model. */
  s1_probability: number | null;
  rule: string;
}
export interface FlyPilotFloor {
  metric: FlyMetricId;
  /** The simulator's resolution for the metric. */
  resolution: number;
  /** Twice the standard error of the mean null paired difference over FLY_SEED_COUNT.min seeds. */
  divergence_bound: number;
  /** The larger, rounded up to one significant figure: the host minimum effect it implies. */
  floor: number;
  /** The host minimum effect in force (FLY_METRICS). */
  host_minimum_effect: number | null;
}
export interface FlyPilot {
  schema: typeof FLY_PILOT;
  status: string;
  protocol: FlyProtocolId;
  /** The fly the pilot ran on: FLY_VERSION, its identity and the flySource digest at the time. */
  fly_version: string;
  fly: string;
  fly_sha256: string;
  fly_source_sha256: string;
  engine: string;
  code: FlyCodeState;
  definition: FlyPilotDefinition;
  control: FlyPilotArm;
  doses: FlyPilotDose[];
  null: FlyPilotDose;
  sized: FlyPilotSizing;
  floors: FlyPilotFloor[];
  /** SHA-256 of every run, arm by arm: final state hashes, simulated time, gate refusals, measurements. */
  runs_sha256: string;
  /** SHA-256 of the definition and every output (arms, sizing, floors): what a re-run must reproduce. */
  outputs_sha256: string;
  generated_at: string;
  sha256: string;
}

export const FLY_PILOT_STATUS =
  "PILOT: exploratory sizing on the public pilot seeds; not evidence, never preregistered, authorized or admitted, and its seeds never feed an archived run";

// ------------------------------------------------------------------ numbers

const mean = (xs: readonly number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
function sd(xs: readonly number[]): number | null {
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** ln(k!) for k = 0..64, enough for any pilot or experiment. */
const LN_FACT = (() => {
  const out = [0];
  for (let k = 1; k <= 64; k++) out.push(out[k - 1]! + Math.log(k));
  return out;
})();
const lnChoose = (n: number, k: number) => LN_FACT[n]! - LN_FACT[k]! - LN_FACT[n - k]!;
/** k ln p, with 0 ln 0 = 0. */
const lnPow = (p: number, k: number) => (k === 0 ? 0 : k * Math.log(p));

/** P(X >= k) for X ~ Binomial(n, p). */
function upperTail(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n || p <= 0) return 0;
  if (p >= 1) return 1;
  let tail = 0;
  for (let j = k; j <= n; j++)
    tail += Math.exp(lnChoose(n, j) + lnPow(p, j) + lnPow(1 - p, n - j));
  return Math.min(1, tail);
}

/** One-sided lower Clopper-Pearson bound for `k` successes in `n` trials. */
export function lowerBound(k: number, n: number, confidence = CONFIDENCE): number {
  if (k <= 0) return 0;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (upperTail(n, k, mid) < 1 - confidence) lo = mid;
    else hi = mid;
  }
  return lo;
}
/** One-sided upper Clopper-Pearson bound. */
export const upperBound = (k: number, n: number, confidence = CONFIDENCE) =>
  1 - lowerBound(n - k, n, confidence);

/** The standard normal distribution function (Abramowitz and Stegun 7.1.26). */
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Rounded down to two significant figures. */
export function roundDown2(x: number): number {
  const step = 10 ** (Math.floor(Math.log10(x)) - 1);
  return Number((Math.floor(x / step + 1e-9) * step).toPrecision(2));
}
/** Rounded up to one significant figure. */
export function roundUp1(x: number): number {
  const step = 10 ** Math.floor(Math.log10(x));
  return Number((Math.ceil(x / step - 1e-9) * step).toPrecision(1));
}

/**
 * The probability that `n` matched seeds pass G4 (at least FLY_MIN_UNTIED_PAIRS
 * untied) and S2 (the exact sign test at FLY_ALPHA), when each seed lands in
 * the expected direction, the opposite one or neither with these chances.
 */
export function signTestPower(n: number, expected: number, opposite: number): number {
  const neither = Math.max(0, 1 - expected - opposite);
  let pass = 0;
  for (let e = 0; e <= n; e++)
    for (let o = 0; o + e <= n; o++) {
      const m = e + o;
      if (m < FLY_MIN_UNTIED_PAIRS || signTestTail(e, m) > FLY_ALPHA) continue;
      if ((e && expected <= 0) || (o && opposite <= 0) || (n - m && neither <= 0))
        continue;
      pass += Math.exp(
        lnChoose(n, e) +
          lnChoose(n - e, o) +
          lnPow(expected, e) +
          lnPow(opposite, o) +
          lnPow(neither, n - m),
      );
    }
  return Math.min(1, pass);
}

// ------------------------------------------------------------------ sizing

const metricOf = (id: string) => FLY_METRICS.find((m) => m.id === id)!;

/**
 * The seed count and minimum effect for a design on `metric`, from the pilot's
 * paired outcomes. Conservative on purpose: the share of seeds in the expected
 * direction is its one-sided 95% lower bound, the rest is split between the
 * opposite direction and no information in the pilot's proportions (each
 * counted once more, so neither is ever impossible), and the chance that the
 * control sits at a bound in every seed uses the 95% upper bound.
 */
export function sizeFlyDesign(
  metric: FlyMetricId,
  direction: "increase" | "decrease",
  treatment: FlyTreatment,
  pilot: FlyPilotMetric,
  differences: readonly number[],
): FlyPilotSizing {
  const m = metricOf(metric);
  const expected = direction === "increase" ? pilot.increase : pilot.decrease;
  const opposite = direction === "increase" ? pilot.decrease : pilot.increase;
  const uninformative = pilot.tie + pilot.undefined;
  const total = expected + opposite + uninformative;
  const qe = lowerBound(expected, total);
  const qo = ((1 - qe) * (opposite + 1)) / (opposite + uninformative + 2);
  const defined = total - pilot.undefined;
  // G3 fails only if the control sits at one bound in every seed.
  const atFloor = m.floor === null ? 0 : upperBound(pilot.control_at_floor, defined),
    atCeiling = m.ceiling === null ? 0 : upperBound(pilot.control_at_ceiling, defined);
  const pass = (n: number) => signTestPower(n, qe, qo) - atFloor ** n - atCeiling ** n;
  let seedCount: number | null = null;
  for (let n = FLY_SEED_COUNT.min; n <= FLY_SEED_COUNT.max && seedCount === null; n++)
    if (pass(n) >= FLY_PILOT_POWER) seedCount = n;
  const sign = direction === "increase" ? 1 : -1;
  const mu = mean(differences.map((d) => sign * d)),
    s = sd(differences) ?? 0;
  const host = m.minimum_effect ?? 0;
  let minimum: number | null = null,
    s1: number | null = null;
  if (seedCount !== null && mu !== null && mu > 0) {
    const se = s * Math.sqrt(1 / seedCount + 1 / differences.length);
    const raw = mu - 1.645 * se;
    minimum = raw > 0 ? roundDown2(raw) : null;
    const used = Math.max(minimum ?? 0, host);
    s1 = se > 0 ? normalCdf((mu - used) / se) : mu >= used ? 1 : 0;
  }
  return {
    metric,
    direction,
    treatment: structuredClone(treatment),
    outcomes: { expected, opposite, uninformative },
    seed_count: seedCount,
    pass_probability:
      seedCount === null ? null : Math.round(pass(seedCount) * 10000) / 10000,
    minimum_effect: minimum,
    host_minimum_effect: host,
    design_minimum_effect: minimum === null ? null : Math.max(minimum, host),
    s1_probability: s1 === null ? null : Math.round(s1 * 10000) / 10000,
    rule: `seed_count: the smallest of ${FLY_SEED_COUNT.min}-${FLY_SEED_COUNT.max} whose chance of passing G3, G4 (${FLY_MIN_UNTIED_PAIRS} untied) and the exact sign test at alpha ${FLY_ALPHA} is at least ${FLY_PILOT_POWER}, with the expected direction's share at its one-sided 95% lower bound; minimum_effect: the pilot's mean paired difference less 1.645 standard errors (pilot and experiment), rounded down to two significant figures, so S1 holds with about 95% probability for an effect the size of the pilot's; the design uses the larger of it and the host's minimum effect`,
  };
}

/** The host minimum effect a null arm implies for `metric`. */
function floorFor(metric: FlyMetricId, nullMetric: FlyPilotMetric): FlyPilotFloor {
  // Escapes are decided on sensory samples, so a timing is resolved to one
  // sample period; the self-model notices and concludes at decisions, so its
  // latencies resolve to one decision period.
  const resolution =
    metric === "escape_ttc_s"
      ? PARAMS.sensePeriodMs.value / 1000
      : metric.endsWith("latency_s")
        ? PARAMS.decisionPeriodMs.value / 1000
        : 0;
  const bound = (2 * (nullMetric.sd_difference ?? 0)) / Math.sqrt(FLY_SEED_COUNT.min);
  const larger = Math.max(resolution, bound);
  return {
    metric,
    resolution,
    divergence_bound: bound,
    floor: larger > 0 ? roundUp1(larger) : 0,
    host_minimum_effect: metricOf(metric).minimum_effect,
  };
}

// -------------------------------------------------------------------- runs

function perSeed(runs: readonly FlyRun[], seeds: readonly number[]): FlyPilotSeed[] {
  return seeds.map((seed) => ({
    seed,
    metrics: Object.assign(
      {},
      ...runs.filter((r) => r.seed === seed).map((r) => r.metrics),
    ) as Values,
  }));
}

function compare(
  control: FlyPilotSeed[],
  treatment: FlyPilotSeed[],
  metric: string,
): FlyPilotMetric {
  const m = metricOf(metric);
  const pairs: { c: number; t: number }[] = [];
  let undef = 0;
  control.forEach((c, i) => {
    const a = c.metrics[metric],
      b = treatment[i]!.metrics[metric];
    if (typeof a !== "number" || typeof b !== "number") undef++;
    else pairs.push({ c: a, t: b });
  });
  const d = pairs.map((p) => p.t - p.c);
  return {
    control_mean: mean(pairs.map((p) => p.c)),
    treatment_mean: mean(pairs.map((p) => p.t)),
    mean_difference: mean(d),
    sd_difference: sd(d),
    increase: d.filter((x) => x > 0).length,
    decrease: d.filter((x) => x < 0).length,
    tie: d.filter((x) => x === 0).length,
    undefined: undef,
    control_at_floor: m.floor === null ? 0 : pairs.filter((p) => p.c === m.floor).length,
    control_at_ceiling:
      m.ceiling === null ? 0 : pairs.filter((p) => p.c === m.ceiling).length,
  };
}

/**
 * The demonstration design with this dose, compiled at the smallest seed count:
 * a pilot needs only its apparatus and arms, which no seed count changes.
 */
function experimentFor(protocol: FlyProtocolId, treatment: FlyTreatment) {
  const compiled = compileFlyExperiment(
    flyExample(protocol, { treatment, seedCount: FLY_SEED_COUNT.min }),
  );
  if (!compiled.ok)
    throw new Error(`pilot dose does not compile: ${compiled.errors.join("; ")}`);
  return compiled.value.experiment;
}

/** What this code's pilot of `protocol` runs: the demonstration, its series and the pilot seeds. */
export function flyPilotDefinition(protocol: FlyProtocolId): FlyPilotDefinition {
  const series = FLY_PILOT_SERIES[protocol];
  if (!series) throw new Error(`${protocol} has no pilot series`);
  const demo = flyExample(protocol);
  const treatment = demo.parameters.treatment;
  if (!series.some((t) => canonicalJson(t) === canonicalJson(treatment)))
    throw new Error(`the demonstration's treatment for ${protocol} is not in its series`);
  const experiment = experimentFor(protocol, treatment);
  const control = experiment.arms[0]!;
  const doses = series.map((t) => {
    const arms = experimentFor(protocol, t).arms;
    if (canonicalJson(arms[0]) !== canonicalJson(control))
      throw new Error(`a dose of ${protocol}'s series changes the control arm`);
    return { treatment: t, arm: arms[1]! };
  });
  return {
    protocol,
    demonstration: {
      treatment,
      metric: demo.analysis.metric,
      direction: demo.analysis.expected_direction,
    },
    blocks: experiment.blocks,
    control,
    doses,
    seeds: FLY_PILOT_SEEDS.slice(0, FLY_PILOT_SEEDS_USED),
    null_seeds: FLY_PILOT_SEEDS.slice(FLY_PILOT_SEEDS_USED, 2 * FLY_PILOT_SEEDS_USED),
  };
}

/** The digest a re-run of a pilot must reproduce. */
const outputsSha256 = (
  p: Pick<FlyPilot, "definition" | "control" | "doses" | "null" | "sized" | "floors">,
) =>
  sha256Json({
    definition: p.definition,
    control: p.control,
    doses: p.doses,
    null: p.null,
    sized: p.sized,
    floors: p.floors,
  });

/**
 * Runs a pilot exactly as `definition` says: the control and every dose on its
 * seeds, the control again on its null seeds, then sizes the demonstration.
 * `code` is the source tree it ran from, as git said.
 */
export function runFlyPilotDefinition(
  definition: FlyPilotDefinition,
  code: FlyCodeState,
  now: Date = new Date(),
): FlyPilot {
  const { protocol, blocks, seeds } = definition;
  const blockIds = blocks.map((b) => b.id as string);
  const metrics = FLY_METRICS.filter((m) => m.primary && blockIds.includes(m.block)).map(
    (m) => m.id,
  );
  const everyRun: FlyRun[][] = [];
  const run = (
    label: string,
    treatment: FlyTreatment | null,
    arm: FlyArm,
    on: readonly number[] = seeds,
  ): FlyPilotArm => {
    const runs = runFlyArm(blocks, arm, on);
    everyRun.push(runs);
    return {
      label,
      treatment: treatment && structuredClone(treatment),
      gate_refusals: runs.reduce((s, r) => s + r.gate_refusals, 0),
      per_seed: perSeed(runs, on),
    };
  };
  const control = run(
    describeFlyBaseline(definition.demonstration.treatment),
    null,
    definition.control,
  );
  const withMetrics = (d: FlyPilotArm): FlyPilotDose => ({
    ...d,
    metrics: Object.fromEntries(
      metrics.map((id) => [id, compare(control.per_seed, d.per_seed, id)]),
    ),
  });
  const doses = definition.doses.map((d) =>
    withMetrics(run(describeFlyTreatment(d.treatment), d.treatment, d.arm)),
  );
  const nullDose = withMetrics(
    run(
      `null: the control again on the next ${definition.null_seeds.length} pilot seeds, paired in order`,
      null,
      definition.control,
      definition.null_seeds,
    ),
  );
  const demo = definition.demonstration;
  const at = definition.doses.findIndex(
    (d) => canonicalJson(d.treatment) === canonicalJson(demo.treatment),
  );
  if (at < 0)
    throw new Error(`the demonstration's dose is not among ${protocol}'s doses`);
  const differences = control.per_seed.flatMap((c, i) => {
    const a = c.metrics[demo.metric],
      b = doses[at]!.per_seed[i]!.metrics[demo.metric];
    return typeof a === "number" && typeof b === "number" ? [b - a] : [];
  });
  const sized = sizeFlyDesign(
    demo.metric,
    demo.direction,
    demo.treatment,
    doses[at]!.metrics[demo.metric]!,
    differences,
  );
  const floors = FLY_PILOT_SIZED_METRICS.filter((id) => metrics.includes(id)).map((id) =>
    floorFor(id, nullDose.metrics[id]!),
  );
  const outputs = { definition, control, doses, null: nullDose, sized, floors };
  const identity = flyIdentity();
  const body = {
    schema: FLY_PILOT,
    status: FLY_PILOT_STATUS,
    protocol,
    fly_version: FLY_VERSION,
    fly: identity.fly,
    fly_sha256: identity.fly_sha256,
    fly_source_sha256: identity.source_sha256,
    engine: flyEngineText(currentFlyEngine()),
    code: { commit: code.commit, dirty: code.dirty },
    ...outputs,
    runs_sha256: sha256Json(everyRun),
    outputs_sha256: outputsSha256(outputs),
    generated_at: now.toISOString(),
  };
  return { ...body, sha256: sha256Json(body) };
}

/** Runs this code's pilot of `protocol`. */
export const runFlyPilot = (protocol: FlyProtocolId, code: FlyCodeState, now?: Date) =>
  runFlyPilotDefinition(flyPilotDefinition(protocol), code, now);

/** A kept pilot against a re-run of its own definition on this code. */
export interface FlyPilotCheck {
  protocol: FlyProtocolId;
  /** The file is what the pilot tool wrote: its seal and output digest hold. */
  intact: boolean;
  same_runs: boolean;
  same_outputs: boolean;
  /** This code's pilot would run the same definition (apparatus, arms, seeds). */
  current_definition: boolean;
  rerun: FlyPilot;
}

/** Whether a kept pilot is what the pilot tool wrote: its seal and its outputs digest hold. */
export function flyPilotIntact(kept: FlyPilot): boolean {
  const { sha256: sealed, ...body } = kept;
  return sha256Json(body) === sealed && outputsSha256(kept) === kept.outputs_sha256;
}

/** Re-runs a kept pilot from its recorded definition and compares everything it produced. */
export function checkFlyPilot(kept: FlyPilot, code: FlyCodeState): FlyPilotCheck {
  const intact = flyPilotIntact(kept);
  const rerun = runFlyPilotDefinition(kept.definition, code);
  let current = false;
  try {
    current =
      canonicalJson(flyPilotDefinition(kept.protocol)) === canonicalJson(kept.definition);
  } catch {
    // This code cannot build a pilot of that protocol: not current.
  }
  return {
    protocol: kept.protocol,
    intact,
    same_runs: rerun.runs_sha256 === kept.runs_sha256,
    same_outputs: rerun.outputs_sha256 === kept.outputs_sha256,
    current_definition: current,
    rerun,
  };
}

// ------------------------------------------------------------------ outputs

const fmt = (x: number | null | undefined, d = 3) =>
  typeof x === "number" ? x.toFixed(d) : "—";

/**
 * The host minimum effect the pilots imply for each metric the redesign added:
 * the largest floor any pilot that measures it found.
 */
export function flyPilotFloors(pilots: readonly FlyPilot[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of pilots)
    for (const f of p.floors) out[f.metric] = Math.max(out[f.metric] ?? 0, f.floor);
  return out;
}

/** README.md for docs/benchmarks/fly-pilots/, written from the pilot files alone. */
export function flyPilotReadme(pilots: readonly FlyPilot[]): string {
  const sorted = [...pilots].sort((a, b) => (a.protocol < b.protocol ? -1 : 1));
  const floors = flyPilotFloors(sorted);
  const ranOn = sorted.map(
    (p) =>
      `| ${p.protocol} | ${p.fly_version} | \`${p.fly_source_sha256.slice(0, 12)}\` | \`${p.fly_sha256.slice(0, 12)}\` | ${p.engine} | ${p.code.commit ? `\`${p.code.commit.slice(0, 12)}\`${p.code.dirty ? " + uncommitted changes" : ""}` : "unknown"} | \`${p.runs_sha256.slice(0, 12)}\` | \`${p.outputs_sha256.slice(0, 12)}\` |`,
  );
  const sizedRows = sorted.map((p) => {
    const s = p.sized;
    return `| ${p.protocol} | ${describeFlyTreatment(s.treatment)} | ${s.metric} (${s.direction}) | ${s.outcomes.expected} / ${s.outcomes.opposite} / ${s.outcomes.uninformative} | ${s.seed_count ?? "none"} | ${fmt(s.pass_probability, 4)} | ${s.minimum_effect ?? "—"} | ${s.host_minimum_effect} | ${s.design_minimum_effect ?? "—"} | ${fmt(s.s1_probability, 4)} |`;
  });
  const floorRows = sorted.flatMap((p) =>
    p.floors.map(
      (f) =>
        `| ${f.metric} | ${p.protocol} | ${f.resolution} | ${f.divergence_bound.toPrecision(3)} | ${f.floor} | ${f.host_minimum_effect ?? "—"} |`,
    ),
  );
  const series = sorted.map((p) => {
    const metric = p.sized.metric;
    const row = (d: FlyPilotDose) => {
      const m = d.metrics[metric]!;
      return `| ${d.label} | ${fmt(m.control_mean)} | ${fmt(m.treatment_mean)} | ${fmt(m.mean_difference)} | ${m.increase} / ${m.decrease} / ${m.tie} / ${m.undefined} | ${d.gate_refusals} |`;
    };
    return `### ${p.protocol}: ${metric}

Control: ${p.control.label} (gate refusals ${p.control.gate_refusals}).

| arm | control mean | arm mean | mean difference | up / down / tie / undefined | gate refusals |
| :--- | ---: | ---: | ---: | :--- | ---: |
${[...p.doses, p.null].map(row).join("\n")}
`;
  });
  return `# Digital fly pilots: not evidence

> **PILOTS.** Exploratory sizing runs on the public pilot seeds. They are not
> evidence: never preregistered, authorized or admitted, and the host never
> draws a pilot seed for an archived run. They describe the digital fly
> simulator only, never Drosophila.

Written by \`npm run rain:fly -- --pilot\`; nothing here is edited by hand.
Each \`<protocol>.json\` holds its definition (the apparatus, the control arm,
a series of doses and the seeds), and per seed and summarized: the control and
every dose on the first ${FLY_PILOT_SEEDS_USED} pilot seeds (SHA-256("${FLY_PILOT}|" + counter),
eight 32-bit seeds per digest), a null arm (the control again on the next
${FLY_PILOT_SEEDS_USED} pilot seeds, paired in order: the same code and arm with every random
stream independent, the apparatus's draws included, so an upper bound on what
trajectory divergence alone can produce), and what the pilot sized. The scripted demonstrations of the four redesigned
protocols and the three Project ECHO ones (\`src/rain/scientific/flyExample.ts\`) take their seed counts and
minimum effects from \`sized\`, and the host's minimum effects for the metrics
the redesign and ECHO added (FLY_METRICS) come from \`floors\`;
\`src/rain/scientific/fly.test.ts\` checks both against these files.

## What each pilot ran on

| pilot | fly version | flySource digest | fly identity | engine | code | runs digest | outputs digest |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${ranOn.join("\n")}

\`npm run rain:fly -- --pilot --check\` re-runs every pilot exactly from its
recorded definition and compares the digests of its runs (final state hashes,
simulated time, gate refusals and measurements) and of its outputs. Identical
digests show that the code still behaves as it did when the thresholds were
sized; any difference fails the check.

## What the pilots sized for the demonstrations

| protocol | demonstration dose | metric | pilot seeds expected / opposite / uninformative | seed count | pass probability | sized minimum effect | host minimum effect | design minimum effect | S1 probability |
| :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
${sizedRows.join("\n")}

- **Seed count**: the smallest of ${FLY_SEED_COUNT.min}-${FLY_SEED_COUNT.max} whose chance of passing G3, G4 (at least ${FLY_MIN_UNTIED_PAIRS} untied seeds) and the exact sign test at alpha ${FLY_ALPHA} is at least ${FLY_PILOT_POWER}. The share of seeds in the expected direction is its one-sided 95% lower bound from the pilot, the rest is split between the opposite direction and no information in the pilot's proportions (each counted once more), and the chance that the control sits at a bound in every seed uses the one-sided 95% upper bound.
- **No seed count**: when no seed count in the host's range reaches that chance, the pilot sizes nothing, and its demonstration runs under-powered, at the host's largest seed count (${FLY_SEED_COUNT.max}) and the host's minimum effect; it is expected to come out inconclusive or failed.
- **Minimum effect**: the pilot's mean paired difference less 1.645 standard errors (of the pilot and of an experiment at that seed count), rounded down to two significant figures: an effect the size of the pilot's clears it with about 95% probability. A design may not go below the host's minimum effect for the metric, so it uses the larger of the two. The S1 probability is the chance that an experiment at that seed count clears the design's minimum effect if the effect is the pilot's.

## Host minimum effects for the metrics the redesign and Project ECHO added

| metric | pilot | resolution | divergence bound | floor | in force |
| :--- | :--- | ---: | ---: | ---: | ---: |
${floorRows.join("\n")}

The floor is the larger of the simulator's resolution (an escape is decided on
a sensory sample, so a timing resolves to one sample period) and twice the
standard error of the mean null paired difference over ${FLY_SEED_COUNT.min} seeds
(the divergence bound), rounded up to one significant figure. The host uses the
largest floor any pilot found: ${Object.entries(floors)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")}.

## Dose series (pilot means over ${FLY_PILOT_SEEDS_USED} seeds; never tested)

${series.join("\n")}`;
}
