/**
 * The civilization backend: matched-seed experiments on the Noeterra engine.
 *
 * The rule it keeps is the lab's: models propose, the host writes. A design is
 * a closed object; the host compiles it into the engine's own plan, writes the
 * question and hypothesis, freezes the criteria and binds the engine version.
 * Execution needs a digest-bound operator authorization. A record is evidence
 * only after the engine re-simulates every run and reaches the recorded state
 * hashes. Every measurement is a simulated observation of an illustrative
 * model — never evidence about the historical world.
 */
import { canonicalJson, sha256, sha256Json } from "../sha256.js";
import { evaluate, type Criterion } from "../experiments/evaluate.js";
import { schemaErrors } from "../experiments/jsonSchema.js";
import type { Checked } from "../../bethesda/rain/validation.js";
import { OPERATOR } from "../../bethesda/rain/contracts.js";
import {
  boundedData,
  closed,
  CIVILIZATION_BACKEND,
  CIVILIZATION_DESIGN,
  CIVILIZATION_METRICS,
  CIVILIZATION_RECORD,
  parseCivilizationDesign,
  SCIENTIFIC_IR,
  type CivilizationAuthorization,
  type CivilizationDesign,
  type CivilizationPlan,
  type CivilizationRecord,
  type CivilizationResult,
  type CivilizationTreatment,
  type NoeterraExperimentResult,
  type NoeterraPlan,
  type ScientificExperimentIR,
} from "./contracts.js";
import { NoeterraEngineError, type NoeterraEngine } from "./noeterraEngine.js";

export const MAX_SIMULATED_TURNS = 12800;
const AUTH_SCOPE = "civilization-simulation" as const;
const HOUR = 3600000;

export interface CivilizationContext {
  engine: NoeterraEngine;
  evidenceIds?: ReadonlySet<string>;
  verifiedParentDigests?: ReadonlySet<string>;
}

export const civilizationPlanBody = (p: CivilizationPlan) => {
  const { definition_sha256: _digest, experiment_id: _id, ...body } = p;
  return body;
};

function interventions(t: CivilizationTreatment): Record<string, unknown>[] {
  switch (t.kind) {
    case "set_trait":
      return [{ type: "set_trait", civ: t.civ, trait: t.trait, value: t.value }];
    case "withhold_memory":
      return [];
    case "add_treaty":
      return [{ type: "add_treaty", kind: t.treaty, a: t.a, b: t.b }];
    case "remove_treaty":
      return [{ type: "remove_treaty", kind: t.treaty, a: t.a, b: t.b }];
    case "scale_armies":
      return [{ type: "scale_armies", civ: t.civ, factor: t.factor }];
    case "scale_treasury":
      return [{ type: "scale_treasury", civ: t.civ, factor: t.factor }];
  }
}

export function describeTreatment(t: CivilizationTreatment): string {
  switch (t.kind) {
    case "set_trait":
      return `setting ${t.civ}'s ${t.trait} to ${t.value}`;
    case "withhold_memory":
      return "withholding every agent's memory of how others have treated it";
    case "add_treaty":
      return `a ${t.treaty.replace("_", "-")} treaty between ${t.a} and ${t.b} from the start`;
    case "remove_treaty":
      return `removing the ${t.treaty.replace("_", "-")} treaty between ${t.a} and ${t.b}`;
    case "scale_armies":
      return `scaling ${t.civ}'s starting armies by ${t.factor}`;
    case "scale_treasury":
      return `scaling ${t.civ}'s starting treasury by ${t.factor}`;
  }
}

export function noeterraPlanOf(design: CivilizationDesign): NoeterraPlan {
  const p = design.parameters;
  return {
    schema: "noeterra-experiment/v1",
    scenario:
      p.scenario === "generated-8x64"
        ? { kind: "generated", civs: 8, provinces: 64 }
        : { kind: "builtin", id: p.scenario },
    turns: p.turns,
    seeds: [...p.seeds],
    arms: [
      { id: "control", policy: "rules", interventions: [] },
      {
        id: "treatment",
        policy: p.treatment.kind === "withhold_memory" ? "amnesic" : "rules",
        interventions: interventions(p.treatment),
      },
    ],
  };
}

export function compileCivilizationExperiment(
  raw: unknown,
  context: CivilizationContext,
): Checked<CivilizationPlan> {
  const parsed = parseCivilizationDesign(raw);
  if (!parsed.ok) return parsed;
  const design = parsed.value,
    p = design.parameters,
    a = design.analysis;
  const errors: string[] = [];
  const n = p.seeds.length;
  if (new Set(p.seeds).size !== n) errors.push("seeds must not repeat");
  const turns = 2 * n * p.turns;
  if (turns > design.budget.max_simulated_turns || turns > MAX_SIMULATED_TURNS)
    errors.push(
      `two arms x ${n} seeds x ${p.turns} seasons = ${turns} simulated seasons exceeds the budget`,
    );
  if (a.minimum_consistent_seeds > n || a.minimum_consistent_seeds < Math.ceil(n / 2))
    errors.push(
      "the effect must be required in at least half of the seeds, and in no more seeds than exist",
    );
  const t = p.treatment;
  if ((t.kind === "add_treaty" || t.kind === "remove_treaty") && t.a === t.b)
    errors.push("a treaty needs two different powers");
  if (
    design.hypothesis.trim().toLowerCase() ===
    design.competing_hypothesis.trim().toLowerCase()
  )
    errors.push("competing hypotheses must differ");
  if (new Set(design.provenance.source_ids).size !== design.provenance.source_ids.length)
    errors.push("duplicate motivating source ids");
  if (design.provenance.source_ids.some((id) => !context.evidenceIds?.has(id)))
    errors.push(
      "motivating sources require independently available evidence identifiers",
    );
  if (
    design.provenance.parent_record_sha256 &&
    !context.verifiedParentDigests?.has(design.provenance.parent_record_sha256)
  )
    errors.push("parent must be an independently replay-verified record");
  if (design.provenance.generation === "model" && !design.provenance.decision_sha256)
    errors.push("model proposals require an immutable decision receipt digest");
  if (errors.length) return { ok: false, errors };

  const noeterra_plan = noeterraPlanOf(design);
  let engine: string, validation: ReturnType<NoeterraEngine["validate"]>;
  try {
    engine = context.engine.version().engine;
    validation = context.engine.validate(noeterra_plan);
  } catch (e) {
    return {
      ok: false,
      errors: [
        e instanceof NoeterraEngineError
          ? `the engine refused the design: ${e.message}`
          : "the engine is unavailable",
      ],
    };
  }
  const metric = CIVILIZATION_METRICS.find((m) => m.id === a.metric)!;
  const sign = a.expected_direction === "increase" ? 1 : -1;
  const treatment = describeTreatment(t);
  const ir: ScientificExperimentIR = {
    schema: SCIENTIFIC_IR,
    domain: "civilization-simulation",
    backend: "civilization",
    backend_version: `${CIVILIZATION_BACKEND} (${engine})`,
    question: `In the Noeterra simulation of ${p.scenario}, how does ${treatment} change ${metric.description} over ${p.turns} seasons, against matched-seed controls?`,
    hypothesis: `${treatment[0]!.toUpperCase()}${treatment.slice(1)} will ${a.expected_direction} ${a.metric} by at least ${a.minimum_effect} ${metric.unit} on average over matched seeds, in the expected direction in at least ${a.minimum_consistent_seeds} of ${n} seeds.`,
    observables: [
      ...CIVILIZATION_METRICS.map((m) => ({
        id: m.id,
        unit: m.unit,
        description: m.description,
      })),
      {
        id: "mean_paired_delta",
        unit: metric.unit,
        description: `treatment minus control ${a.metric}, averaged over seeds`,
      },
    ],
    independent_variables: [treatment],
    dependent_variables: [a.metric],
    controls: [
      "matched seeds: each seed runs once with and once without the treatment",
      "identical scenario, horizon and rule-based agents in both arms",
      "the engine version is bound into the plan digest",
    ],
    parameter_constraints: [
      "closed treatment vocabulary validated by the engine before execution",
      "rule-based agents only, so every run re-simulates exactly",
      `at most ${MAX_SIMULATED_TURNS} simulated seasons per experiment`,
      "3-32 distinct seeds; the effect must appear in at least half of them",
    ],
    resource_budget: { execution_steps: turns, replay_steps: turns, max_samples: 2 * n },
    statistical_analysis: {
      method:
        "Matched-seed paired difference of the primary metric; per-seed sign counts; frozen rain-criteria/v1",
      independent_replicates: n,
      uncertainty:
        "Seeds are independent replicates of one illustrative model; descriptive only, no p-value or population inference, and nothing about the historical world.",
    },
    falsification: {
      metric: "mean_paired_delta",
      op: sign > 0 ? "<=" : ">=",
      value: 0,
      unit: metric.unit,
    },
    provenance: structuredClone(design.provenance),
    limitations: [
      "Noeterra is an illustrative model: its economy, warfare and diplomacy are invented rules, not estimates of how past societies worked.",
      "Scenario figures are game values; the polities and rulers follow the standard record only as a setting.",
      "A result characterizes the simulator and its agents' policy, not history, and is never empirical evidence.",
      "Agents are the deterministic rule-based policy; model-driven agents are not admitted as experiments.",
      "Native and WebAssembly builds of this engine version reproduce identical state hashes; other versions are refused.",
    ],
  };
  const criterion = (
    id: string,
    metricId: string,
    op: Criterion["op"],
    value: number,
    note: string,
  ) => ({
    id,
    metric: metricId,
    op,
    value,
    note,
  });
  const body = {
    schema: "rain-civilization-plan/v1" as const,
    design,
    ir,
    engine,
    noeterra_plan,
    noeterra_plan_sha256: validation.plan_sha256,
    scenario_sha256: validation.scenario_sha256,
    simulated_turns: turns,
    criteria: {
      guards: [
        criterion("G1", "arms_completed", ">=", 2 * n, "Every matched run completes"),
        criterion(
          "G2",
          "determinism_check",
          ">=",
          1,
          "An independent re-simulation reproduces every state hash",
        ),
      ],
      success: [
        criterion(
          "S1",
          "mean_paired_delta",
          sign > 0 ? ">=" : "<=",
          sign * a.minimum_effect,
          "Preregistered effect threshold",
        ),
        criterion(
          "S2",
          "seeds_expected_direction",
          ">=",
          a.minimum_consistent_seeds,
          "Effect appears in enough seeds",
        ),
      ],
      failure: [
        criterion(
          "F1",
          "mean_paired_delta",
          sign > 0 ? "<=" : ">=",
          0,
          "No effect or the opposite direction",
        ),
      ],
    },
  };
  const digest = sha256Json(body);
  return {
    ok: true,
    value: {
      ...body,
      definition_sha256: digest,
      experiment_id: `CV-${digest.slice(0, 24)}`,
    },
  };
}

/**
 * What a plan tests, apart from its seeds and its wording: the engine, scenario,
 * horizon and both arms. Two plans with the same fingerprint ask the simulator
 * the same question, whatever metric or threshold they name.
 */
export function civilizationProtocolFingerprint(plan: CivilizationPlan): string {
  const { seeds: _seeds, ...protocol } = plan.noeterra_plan;
  return sha256Json({ engine: plan.engine, protocol });
}

/**
 * Refuses seeds an equivalent protocol has already run or reserved. Its outcome
 * on them is known (and a model designing the next experiment is shown prior
 * results), so a new metric, threshold or hypothesis on the same seeds would be
 * chosen after the data, not before it. Fresh seeds are a replication.
 */
export function exposedSeedErrors(
  plan: CivilizationPlan,
  prior: readonly CivilizationPlan[],
): string[] {
  const fingerprint = civilizationProtocolFingerprint(plan);
  const errors: string[] = [];
  for (const p of prior) {
    if (
      p.definition_sha256 === plan.definition_sha256 ||
      civilizationProtocolFingerprint(p) !== fingerprint
    )
      continue;
    const shared = plan.noeterra_plan.seeds.filter((s) =>
      p.noeterra_plan.seeds.includes(s),
    );
    if (shared.length)
      errors.push(
        `seeds ${shared.join(", ")} were already exposed to an equivalent protocol (${p.experiment_id}); a new metric, threshold or wording on them is not a preregistered test, so choose fresh seeds`,
      );
  }
  return errors;
}

/**
 * The design `noeterra design` derives from a receipt's answer (noeterra/src/design.rs,
 * `propose`), rebuilt here so a design can be held to it field by field.
 */
function designFromReceiptAnswer(answerText: string, decisionSha256: string): unknown {
  const start = answerText.indexOf("{"),
    end = answerText.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  const answer = JSON.parse(answerText.slice(start, end + 1)) as Record<string, unknown>;
  const field = (o: unknown, k: string): unknown =>
    o !== null && typeof o === "object" && !Array.isArray(o)
      ? ((o as Record<string, unknown>)[k] ?? null)
      : null;
  const p = field(answer, "parameters"),
    a = field(answer, "analysis");
  const seeds = field(p, "seeds"),
    turns = field(p, "turns");
  const seedCount = Array.isArray(seeds) ? seeds.length : 0;
  const turnCount =
    typeof turns === "number" && Number.isSafeInteger(turns) && turns >= 0 ? turns : 0;
  return {
    schema: CIVILIZATION_DESIGN,
    question: field(answer, "question"),
    hypothesis: field(answer, "hypothesis"),
    competing_hypothesis: field(answer, "competing_hypothesis"),
    parameters: {
      scenario: "mediterranean-264bc",
      seeds,
      turns,
      treatment: field(p, "treatment"),
    },
    analysis: {
      method: "matched_seed_paired_delta",
      metric: field(a, "metric"),
      expected_direction: field(a, "expected_direction"),
      minimum_effect: field(a, "minimum_effect"),
      minimum_consistent_seeds: field(a, "minimum_consistent_seeds"),
    },
    budget: { max_simulated_turns: 2 * seedCount * turnCount },
    provenance: {
      generation: "model",
      decision_sha256: decisionSha256,
      source_ids: [],
      parent_record_sha256: null,
    },
  };
}

/**
 * Holds a design to its receipt. A model's design must be exactly the design its
 * receipt's answer produces: a seed, horizon, treatment or threshold edited by
 * hand afterwards is no longer the model's proposal.
 */
export function civilizationReceiptErrors(
  design: CivilizationDesign,
  text: string | null,
): string[] {
  if (design.provenance.generation !== "model")
    return text ? ["a receipt accompanies a non-model design"] : [];
  if (!text) return ["a model design needs its receipt"];
  const errors: string[] = [];
  const digest = sha256(text);
  if (digest !== design.provenance.decision_sha256)
    errors.push("the receipt's SHA-256 does not match the design's decision_sha256");
  let r: { schema?: unknown; generation?: unknown; answer?: unknown };
  try {
    r = JSON.parse(text) as typeof r;
  } catch {
    return [...errors, "the receipt is not JSON"];
  }
  if (r.schema !== "noeterra-design-receipt/v1" || r.generation !== "model")
    errors.push("not a noeterra-design-receipt/v1 from a model");
  let rebuilt: unknown = null;
  try {
    rebuilt =
      typeof r.answer === "string" ? designFromReceiptAnswer(r.answer, digest) : null;
  } catch {
    rebuilt = null;
  }
  if (rebuilt === null || canonicalJson(rebuilt) !== canonicalJson(design))
    errors.push("the design is not the design the receipt's answer produces");
  return errors;
}

/** Recompiles against the given engine; a different engine version is refused. */
export function verifyCivilizationPlan(raw: unknown, engine: NoeterraEngine): string[] {
  const errors = boundedData(raw);
  if (errors.length) return errors;
  try {
    const p = raw as CivilizationPlan;
    const parent = p.design.provenance.parent_record_sha256;
    const compiled = compileCivilizationExperiment(p.design, {
      engine,
      evidenceIds: new Set(p.design.provenance.source_ids),
      verifiedParentDigests: new Set(parent ? [parent] : []),
    });
    if (!compiled.ok) return compiled.errors;
    return canonicalJson(raw) === canonicalJson(compiled.value)
      ? []
      : [
          "plan does not match deterministic recompilation (criteria, engine version or engine plan)",
        ];
  } catch {
    return ["malformed civilization plan"];
  }
}

const AUTH_SCHEMA = closed({
  schema: { const: "rain-civilization-authorization/v1" },
  experiment_id: { type: "string", pattern: "^CV-[a-f0-9]{24}$" },
  definition_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  operator: { type: "string", pattern: "^[A-Za-z0-9_.-]{1,64}$" },
  attestation: { const: "local-operator" },
  identity_verified: { const: false },
  scope: { const: AUTH_SCOPE },
  confirmed_prefix: { type: "string", pattern: "^[a-f0-9]{8}$" },
  authorized_at: { type: "string", maxLength: 40 },
  expires_at: { type: "string", maxLength: 40 },
  authorization_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
});

export function authorizeCivilization(
  plan: CivilizationPlan,
  engine: NoeterraEngine,
  input: { operator: string; typedPrefix: string; reviewed: boolean; now: Date },
): Checked<CivilizationAuthorization> {
  const errors = verifyCivilizationPlan(plan, engine);
  if (input.reviewed !== true) errors.push("operator must confirm protocol review");
  if (typeof input.operator !== "string" || !OPERATOR.test(input.operator))
    errors.push("operator must be a role label");
  const prefix =
    typeof input.typedPrefix === "string" ? input.typedPrefix.trim().toLowerCase() : "";
  if (prefix.length !== 8 || !plan.definition_sha256.startsWith(prefix))
    errors.push("repeat the first eight characters of this civilization plan digest");
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime()))
    errors.push("invalid authorization clock");
  if (errors.length) return { ok: false, errors };
  const body = {
    schema: "rain-civilization-authorization/v1" as const,
    experiment_id: plan.experiment_id,
    definition_sha256: plan.definition_sha256,
    operator: input.operator,
    attestation: "local-operator" as const,
    identity_verified: false as const,
    scope: AUTH_SCOPE,
    confirmed_prefix: prefix,
    authorized_at: input.now.toISOString(),
    expires_at: new Date(input.now.getTime() + HOUR).toISOString(),
  };
  return { ok: true, value: { ...body, authorization_sha256: sha256Json(body) } };
}

export function verifyCivilizationAuthorization(
  raw: unknown,
  plan: CivilizationPlan,
  now: Date,
): string[] {
  const bounded = boundedData(raw);
  if (bounded.length) return bounded;
  const errors = schemaErrors(raw, AUTH_SCHEMA);
  if (errors.length) return errors;
  const a = raw as CivilizationAuthorization;
  const { authorization_sha256, ...body } = a;
  if (sha256Json(body) !== authorization_sha256)
    errors.push("civilization authorization digest mismatch");
  if (
    a.definition_sha256 !== plan.definition_sha256 ||
    a.experiment_id !== plan.experiment_id ||
    a.confirmed_prefix !== plan.definition_sha256.slice(0, 8)
  )
    errors.push("civilization approval binds a different plan");
  const issued = Date.parse(a.authorized_at),
    expires = Date.parse(a.expires_at),
    clock = now.getTime();
  if (
    ![issued, expires, clock].every(Number.isFinite) ||
    expires - issued !== HOUR ||
    clock < issued ||
    clock > expires
  )
    errors.push("civilization approval outside its one-hour validity");
  return errors;
}

/** Derived from the engine's runs; the same function serves execution and replay. */
export function civilizationMeasurements(
  plan: CivilizationPlan,
  experiment: NoeterraExperimentResult | null,
  deterministic: boolean,
): Record<string, number | null> {
  const metric = plan.design.analysis.metric,
    sign = plan.design.analysis.expected_direction === "increase" ? 1 : -1;
  const seeds = plan.noeterra_plan.seeds;
  // Without an experiment nothing was checked or counted: unknown, not zero.
  const out: Record<string, number | null> = {
    arms_completed: experiment ? experiment.runs.length : 0,
    determinism_check: experiment ? (deterministic ? 1 : 0) : null,
    seeds: seeds.length,
    simulated_turns: experiment
      ? experiment.runs.length * plan.noeterra_plan.turns
      : null,
    control_mean: null,
    treatment_mean: null,
    mean_paired_delta: null,
    seeds_expected_direction: null,
    seeds_opposite: null,
    seeds_unchanged: null,
  };
  for (const m of CIVILIZATION_METRICS) out[`delta_${m.id}`] = null;
  if (!experiment) return out;
  const value = (arm: string, seed: number) => {
    const r = experiment.runs.find((x) => x.arm === arm && x.seed === seed);
    const v = r?.metrics[metric];
    return typeof v === "number" ? v : null;
  };
  const deltas: number[] = [];
  let control = 0,
    treatment = 0;
  for (const s of seeds) {
    const c = value("control", s),
      t = value("treatment", s);
    if (c === null || t === null) return out;
    control += c;
    treatment += t;
    deltas.push(t - c);
  }
  out.control_mean = control / seeds.length;
  out.treatment_mean = treatment / seeds.length;
  out.mean_paired_delta = deltas.reduce((a, b) => a + b, 0) / seeds.length;
  out.seeds_expected_direction = deltas.filter((d) => d * sign > 0).length;
  out.seeds_opposite = deltas.filter((d) => d * sign < 0).length;
  out.seeds_unchanged = deltas.filter((d) => d === 0).length;
  for (const m of CIVILIZATION_METRICS) {
    const p = experiment.paired.find((x) => x.arm === "treatment" && x.metric === m.id);
    out[`delta_${m.id}`] = p ? p.mean_delta : null;
  }
  return out;
}

function simulate(plan: CivilizationPlan, engine: NoeterraEngine): CivilizationResult {
  let experiment: NoeterraExperimentResult | null = null;
  let error: string | null = null;
  try {
    experiment = engine.experiment(plan.noeterra_plan);
  } catch (e) {
    error = e instanceof Error ? e.message : "the engine failed";
  }
  let deterministic = false;
  if (experiment) {
    try {
      engine.verify(plan.noeterra_plan, experiment);
      deterministic = true;
    } catch {
      deterministic = false;
    }
  }
  const measurements = civilizationMeasurements(plan, experiment, deterministic);
  const completed =
    experiment !== null && experiment.runs.length === 2 * plan.noeterra_plan.seeds.length;
  if (!completed)
    return {
      experiment,
      completed,
      measurements,
      status: "error",
      verdict: "not_evaluated",
      evaluation: null,
      error: error ?? "incomplete civilization experiment",
    };
  return {
    experiment,
    completed,
    measurements,
    ...evaluate(plan.criteria, measurements),
    error: null,
  };
}

export class CivilizationRunRefused extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super("Civilization run refused: " + reasons.join("; "));
    this.reasons = reasons;
  }
}

export function executeCivilization(
  plan: CivilizationPlan,
  authorization: unknown,
  engine: NoeterraEngine,
  now: Date | (() => Date) = () => new Date(),
): CivilizationRecord {
  const started = typeof now === "function" ? now() : now;
  const errors = verifyCivilizationPlan(plan, engine);
  if (!errors.length)
    errors.push(...verifyCivilizationAuthorization(authorization, plan, started));
  if (errors.length) throw new CivilizationRunRefused(errors);
  const frozen = structuredClone(plan),
    auth = structuredClone(authorization) as CivilizationAuthorization;
  const startedAt = started.toISOString();
  const result = simulate(frozen, engine);
  const body = {
    schema: CIVILIZATION_RECORD,
    run_id: `CR-${sha256Json({ plan: frozen.definition_sha256, authorization: auth.authorization_sha256, started_at: startedAt }).slice(0, 24)}`,
    plan: frozen,
    authorization: auth,
    started_at: startedAt,
    finished_at: (typeof now === "function" ? now() : new Date()).toISOString(),
    result,
    evidence_class: "simulated" as const,
  };
  return { ...body, sha256: sha256Json(body) };
}

const RECORD_KEYS = [
  "schema",
  "run_id",
  "plan",
  "authorization",
  "started_at",
  "finished_at",
  "result",
  "evidence_class",
  "sha256",
];

/** Re-simulates every run on `engine` and requires the recorded result exactly. */
export function verifyCivilizationRecord(
  raw: unknown,
  engine: NoeterraEngine,
): { ok: boolean; errors: string[]; replay_sha256: string | null } {
  const errors = boundedData(raw, 400000);
  if (errors.length) return { ok: false, errors, replay_sha256: null };
  try {
    const r = raw as CivilizationRecord;
    const { sha256, ...body } = r;
    if (
      Object.keys(r).length !== RECORD_KEYS.length ||
      Object.keys(r).some((k) => !RECORD_KEYS.includes(k)) ||
      r.schema !== CIVILIZATION_RECORD ||
      r.evidence_class !== "simulated"
    )
      errors.push("unsupported civilization record shape/classification");
    if (sha256Json(body) !== sha256) errors.push("civilization record digest mismatch");
    const started = new Date(r.started_at),
      finished = new Date(r.finished_at);
    if (
      ![started.getTime(), finished.getTime()].every(Number.isFinite) ||
      finished < started
    )
      errors.push("invalid civilization record clocks");
    errors.push(
      ...verifyCivilizationPlan(r.plan, engine),
      ...verifyCivilizationAuthorization(r.authorization, r.plan, started),
    );
    const id = `CR-${sha256Json({ plan: r.plan.definition_sha256, authorization: r.authorization.authorization_sha256, started_at: r.started_at }).slice(0, 24)}`;
    if (id !== r.run_id)
      errors.push("run identity does not bind plan, approval and start");
    if (errors.length) return { ok: false, errors, replay_sha256: null };
    const replay = simulate(r.plan, engine);
    if (canonicalJson(replay) !== canonicalJson(r.result))
      errors.push(
        "state hashes, measurements or frozen evaluation differ on re-simulation",
      );
    return {
      ok: !errors.length,
      errors,
      replay_sha256: sha256Json({ plan: civilizationPlanBody(r.plan), result: replay }),
    };
  } catch {
    return { ok: false, errors: ["malformed civilization record"], replay_sha256: null };
  }
}
