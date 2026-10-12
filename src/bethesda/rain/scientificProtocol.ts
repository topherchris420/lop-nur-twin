/** Pure, closed scientific design vocabulary. Proposals carry no execution authority. */
import { schemaErrors } from "../../rain/experiments/jsonSchema.js";
import { UNSAFE_TEXT } from "./contracts.js";
import type { Checked } from "./validation.js";
import type { Criterion, Evaluation } from "../../rain/experiments/evaluate.js";

export const SCIENTIFIC_IR = "rain-scientific-experiment/v1" as const;
export const NUMERICAL_DESIGN = "rain-oscillator-design/v1" as const;
export const NUMERICAL_BACKEND = "rain-driven-damped-oscillator/v1" as const;
export const NUMERICAL_RECORD = "rain-numerical-record/v1" as const;
export type ScientificBackendId = "bethesda" | "numerical-physics" | "civilization";
export interface Quantity<U extends string = string> {
  value: number;
  unit: U;
}
export interface OscillatorParameters {
  mass: Quantity<"kg">;
  damping: Quantity<"kg/s">;
  stiffness: Quantity<"N/m">;
  force_amplitude: Quantity<"N">;
  angular_frequency: Quantity<"rad/s">;
  initial_displacement: Quantity<"m">;
  initial_velocity: Quantity<"m/s">;
  duration: Quantity<"s">;
  timestep: Quantity<"s">;
  sample_every_steps: number;
}
export interface ScientificProvenance {
  generation: "model" | "human" | "scripted";
  decision_sha256: string | null;
  source_ids: string[];
  parent_record_sha256: string | null;
}
export interface NumericalDesign {
  schema: typeof NUMERICAL_DESIGN;
  question: string;
  hypothesis: string;
  competing_hypothesis: string;
  parameters: OscillatorParameters;
  analysis: {
    method: "matched_rms_displacement";
    expected_direction: "increase" | "decrease";
    minimum_effect_m: number;
    max_reference_error_m: number;
    max_reference_velocity_error_m_per_s: number;
  };
  budget: { max_steps: number; max_samples: number };
  provenance: ScientificProvenance;
}
export interface ScientificExperimentIR {
  schema: typeof SCIENTIFIC_IR;
  domain: "urban-simulation" | "numerical-physics" | "civilization-simulation";
  backend: ScientificBackendId;
  backend_version: string;
  question: string;
  hypothesis: string;
  observables: { id: string; unit: string; description: string }[];
  independent_variables: string[];
  dependent_variables: string[];
  controls: string[];
  parameter_constraints: string[];
  resource_budget: { execution_steps: number; replay_steps: number; max_samples: number };
  statistical_analysis: {
    method: string;
    independent_replicates: number;
    uncertainty: string;
  };
  falsification: { metric: string; op: ">=" | "<="; value: number; unit: string };
  provenance: ScientificProvenance;
  limitations: string[];
}
export interface BackendCapability {
  id: ScientificBackendId;
  version: string;
  supported: string[];
  unsupported: string[];
  authority_scope: string;
  physical_devices: false;
}
export interface NumericalPlan {
  schema: "rain-numerical-plan/v1";
  design: NumericalDesign;
  ir: ScientificExperimentIR;
  steps: number;
  samples_per_arm: number;
  criteria: { guards: Criterion[]; success: Criterion[]; failure: Criterion[] };
  definition_sha256: string;
  experiment_id: string;
}
export interface NumericalAuthorization {
  schema: "rain-numerical-authorization/v1";
  experiment_id: string;
  definition_sha256: string;
  operator: string;
  attestation: "local-operator";
  identity_verified: false;
  scope: "numerical-physics-simulation";
  confirmed_prefix: string;
  authorized_at: string;
  expires_at: string;
  authorization_sha256: string;
}
export interface NumericalSample {
  step: number;
  time_s: number;
  displacement_m: number;
  velocity_m_per_s: number;
  mechanical_energy_j: number;
}
export interface NumericalArm {
  arm: "control" | "treatment";
  force_amplitude_n: number;
  completed_steps: number;
  samples: NumericalSample[];
  reference_max_error_m: number;
  reference_max_velocity_error_m_per_s: number;
  rms_displacement_m: number | null;
}
export interface NumericalResult {
  arms: NumericalArm[];
  completed: boolean;
  stop_checkpoint: { arm: "control" | "treatment"; step: number } | null;
  measurements: Record<string, number | null>;
  status: "passed" | "failed" | "inconclusive" | "error";
  verdict: "supported" | "not_supported" | "insufficient_evidence" | "not_evaluated";
  evaluation: Evaluation | null;
  error: string | null;
}
export interface NumericalRecord {
  schema: typeof NUMERICAL_RECORD;
  run_id: string;
  plan: NumericalPlan;
  authorization: NumericalAuthorization;
  started_at: string;
  finished_at: string;
  result: NumericalResult;
  evidence_class: "simulated";
  sha256: string;
}
export interface NumericalPreregistration {
  experiment_id: string;
  registry_definition_sha256: string;
  plan_sha256: string;
}

export const closed = (properties: Record<string, unknown>) => ({
  type: "object",
  required: Object.keys(properties),
  additionalProperties: false,
  properties,
});
const number = (minimum: number, maximum: number) => ({
  type: "number",
  minimum,
  maximum,
});
const integer = (minimum: number, maximum: number) => ({
  type: "integer",
  minimum,
  maximum,
});
const words = (maxLength: number) => ({
  type: "string",
  minLength: 1,
  maxLength,
  pattern: "\\S",
});
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const optionalDigest = { oneOf: [digest, { type: "null" }] };
const quantity = (unit: string, minimum: number, maximum: number) =>
  closed({ value: number(minimum, maximum), unit: { const: unit, type: "string" } });
export const PROVENANCE_SCHEMA = closed({
  generation: { type: "string", enum: ["model", "human", "scripted"] },
  decision_sha256: optionalDigest,
  source_ids: {
    type: "array",
    maxItems: 16,
    items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$" },
  },
  parent_record_sha256: optionalDigest,
});
export const NUMERICAL_DESIGN_SCHEMA = closed({
  schema: { const: NUMERICAL_DESIGN, type: "string" },
  question: words(400),
  hypothesis: words(600),
  competing_hypothesis: words(600),
  parameters: closed({
    mass: quantity("kg", 0.001, 1000),
    damping: quantity("kg/s", 0.000001, 1000),
    stiffness: quantity("N/m", 0.001, 1000000),
    force_amplitude: quantity("N", 0, 100000),
    angular_frequency: quantity("rad/s", 0.001, 1000),
    initial_displacement: quantity("m", -1000, 1000),
    initial_velocity: quantity("m/s", -1000, 1000),
    duration: quantity("s", 0.001, 1000),
    timestep: quantity("s", 0.000001, 1),
    sample_every_steps: integer(1, 10000),
  }),
  analysis: closed({
    method: { const: "matched_rms_displacement", type: "string" },
    expected_direction: { type: "string", enum: ["increase", "decrease"] },
    minimum_effect_m: number(0.000000001, 1000000),
    max_reference_error_m: number(0.000000000001, 0.01),
    max_reference_velocity_error_m_per_s: number(0.000000000001, 0.01),
  }),
  budget: closed({ max_steps: integer(1, 100000), max_samples: integer(2, 10001) }),
  provenance: PROVENANCE_SCHEMA,
});

/** Bound recursion and JSON size before schemas traverse hostile data. Never invoke getters. */
export function boundedData(raw: unknown, maxNodes = 50000): string[] {
  const ancestors = new Set<object>();
  let nodes = 0,
    characters = 0;
  const walk = (value: unknown, depth: number): boolean => {
    if (++nodes > maxNodes || depth > 24) return false;
    if (typeof value === "string") {
      characters += value.length;
      return characters <= 4000000 && !UNSAFE_TEXT.test(value);
    }
    if (typeof value === "number") return Number.isFinite(value);
    if (value === null || typeof value === "boolean") return true;
    if (!value || typeof value !== "object" || ancestors.has(value)) return false;
    if (Object.getOwnPropertySymbols(value).length) return false;
    if (
      Array.isArray(value) &&
      (Object.getPrototypeOf(value) !== Array.prototype ||
        Object.keys(value).length !== value.length ||
        Object.keys(value).some((key, i) => key !== String(i)))
    )
      return false;
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      return false;
    ancestors.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === "length") continue;
      if (
        descriptor.get ||
        descriptor.set ||
        !descriptor.enumerable ||
        !walk(descriptor.value, depth + 1)
      )
        return false;
    }
    ancestors.delete(value);
    return true;
  };
  try {
    return walk(raw, 0)
      ? []
      : [
          "input must be bounded finite plain JSON without cycles, accessors or unsafe text",
        ];
  } catch {
    return ["input is not inspectable plain JSON"];
  }
}
export function parseNumericalDesign(raw: unknown): Checked<NumericalDesign> {
  const bounded = boundedData(raw, 5000);
  if (bounded.length) return { ok: false, errors: bounded };
  const errors = schemaErrors(raw, NUMERICAL_DESIGN_SCHEMA);
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: structuredClone(raw) as NumericalDesign };
}

export const BACKEND_CAPABILITIES: readonly BackendCapability[] = [
  {
    id: "bethesda",
    version: "native-discovery/v3",
    supported: [
      "existing single-event matched-seed Bethesda designs",
      "native registry criteria and deterministic replay",
    ],
    unsupported: ["new simulator mechanisms", "physical instruments"],
    authority_scope: "bethesda-simulation",
    physical_devices: false,
  },
  {
    id: "numerical-physics",
    version: NUMERICAL_BACKEND,
    supported: [
      "underdamped linear oscillator with cosine driving",
      "matched zero-force control",
      "RK4 with closed-form trajectory verification",
    ],
    unsupported: [
      "overdamped or critical regimes",
      "nonlinear forces",
      "DRR",
      "TRIAD",
      "physical instruments",
    ],
    authority_scope: "numerical-physics-simulation",
    physical_devices: false,
  },
  {
    id: "civilization",
    version: "noeterra-civilization/v1",
    supported: [
      "matched-seed paired arms of the Noeterra civilization simulator",
      "closed treatments: a temperament trait, withheld agent memory, a treaty, armies or treasury",
      "rule-based agents only, so every run re-simulates exactly from its plan",
    ],
    unsupported: [
      "empirical historical inference",
      "real-world forecasting",
      "model-driven agents in admitted experiments",
      "physical instruments",
    ],
    authority_scope: "civilization-simulation",
    physical_devices: false,
  },
];

// ------------------------------------------------------------- civilization
// The Noeterra engine (noeterra/, Rust compiled to WebAssembly) simulates
// illustrative civilizations whose rulers are autonomous agents. Its outputs
// characterize that model and nothing else: they are never evidence about the
// historical world, and the vocabulary below says so wherever it can.

export const CIVILIZATION_DESIGN = "rain-civilization-design/v1" as const;
export const CIVILIZATION_BACKEND = "noeterra-civilization/v1" as const;
export const CIVILIZATION_RECORD = "rain-civilization-record/v1" as const;
export const CIVILIZATION_SCENARIOS = [
  "mediterranean-264bc",
  "tarim-77bc",
  "generated-8x64",
] as const;
export const CIVILIZATION_TRAITS = [
  "aggression",
  "expansion",
  "caution",
  "honor",
  "mercantile",
  "diplomacy",
] as const;
export const CIVILIZATION_TREATIES = ["alliance", "non_aggression", "trade"] as const;
/** Mirrors `experiment::METRICS` in noeterra/src/experiment.rs; a test pins the two together. */
export const CIVILIZATION_METRICS = [
  { id: "wars_declared", unit: "count", description: "wars declared over the horizon" },
  {
    id: "pacts_broken",
    unit: "count",
    description: "wars declared in breach of a non-aggression pact",
  },
  { id: "peace_treaties", unit: "count", description: "peace settlements concluded" },
  { id: "battles", unit: "count", description: "battles fought" },
  {
    id: "battle_losses",
    unit: "thousand soldiers",
    description: "soldiers lost or scattered in battle",
  },
  { id: "occupations", unit: "count", description: "provinces occupied by an enemy" },
  { id: "conquests", unit: "count", description: "unclaimed or rebel provinces annexed" },
  { id: "revolts", unit: "count", description: "provinces lost to revolt" },
  {
    id: "treaties_signed",
    unit: "count",
    description: "alliances, pacts and trade agreements concluded",
  },
  {
    id: "alliances_broken",
    unit: "count",
    description: "alliances broken by a refused call to arms",
  },
  {
    id: "civs_fallen",
    unit: "count",
    description: "civilizations that lost every province",
  },
  { id: "surviving_civs", unit: "count", description: "civilizations alive at the end" },
  {
    id: "province_hhi",
    unit: "index 0..1",
    description: "Herfindahl index of province shares among surviving civilizations",
  },
  {
    id: "largest_share",
    unit: "fraction",
    description: "share of owned provinces held by the largest civilization",
  },
  {
    id: "peace_fraction",
    unit: "fraction",
    description: "fraction of turns that ended with no war in progress",
  },
  {
    id: "mean_stability",
    unit: "points 0..100",
    description: "mean stability of surviving civilizations at the end",
  },
  {
    id: "total_population",
    unit: "thousand people",
    description: "population of all provinces at the end",
  },
  {
    id: "unowned_provinces",
    unit: "count",
    description: "provinces held by no civilization at the end",
  },
] as const;
export type CivilizationMetricId = (typeof CIVILIZATION_METRICS)[number]["id"];
export type CivilizationTrait = (typeof CIVILIZATION_TRAITS)[number];
export type CivilizationTreatyKind = (typeof CIVILIZATION_TREATIES)[number];

export type CivilizationTreatment =
  | { kind: "set_trait"; civ: string; trait: CivilizationTrait; value: number }
  | { kind: "withhold_memory" }
  | { kind: "add_treaty"; treaty: CivilizationTreatyKind; a: string; b: string }
  | { kind: "remove_treaty"; treaty: CivilizationTreatyKind; a: string; b: string }
  | { kind: "scale_armies"; civ: string; factor: number }
  | { kind: "scale_treasury"; civ: string; factor: number };

export interface CivilizationDesign {
  schema: typeof CIVILIZATION_DESIGN;
  question: string;
  hypothesis: string;
  competing_hypothesis: string;
  parameters: {
    scenario: (typeof CIVILIZATION_SCENARIOS)[number];
    seeds: number[];
    turns: number;
    treatment: CivilizationTreatment;
  };
  analysis: {
    method: "matched_seed_paired_delta";
    metric: CivilizationMetricId;
    expected_direction: "increase" | "decrease";
    minimum_effect: number;
    minimum_consistent_seeds: number;
  };
  budget: { max_simulated_turns: number };
  provenance: ScientificProvenance;
}

/** The engine's own experiment plan (`noeterra-experiment/v1`). */
export interface NoeterraPlan {
  schema: "noeterra-experiment/v1";
  scenario:
    | { kind: "builtin"; id: string }
    | { kind: "generated"; civs: number; provinces: number };
  turns: number;
  seeds: number[];
  arms: {
    id: string;
    policy: "rules" | "amnesic" | "random";
    interventions: Record<string, unknown>[];
  }[];
}
export interface NoeterraRun {
  arm: string;
  seed: number;
  initial_hash: string;
  final_hash: string;
  metrics: Record<string, number>;
}
export interface NoeterraExperimentResult {
  schema: "noeterra-experiment-result/v1";
  engine: string;
  evidence_class: "simulated";
  plan_sha256: string;
  scenario_sha256: string;
  runs: NoeterraRun[];
  summary: Record<string, Record<string, { mean: number; min: number; max: number }>>;
  paired: {
    arm: string;
    baseline: string;
    metric: string;
    mean_delta: number;
    increased: number;
    decreased: number;
    unchanged: number;
  }[];
}

export interface CivilizationPlan {
  schema: "rain-civilization-plan/v1";
  design: CivilizationDesign;
  ir: ScientificExperimentIR;
  engine: string;
  noeterra_plan: NoeterraPlan;
  noeterra_plan_sha256: string;
  scenario_sha256: string;
  simulated_turns: number;
  criteria: { guards: Criterion[]; success: Criterion[]; failure: Criterion[] };
  definition_sha256: string;
  experiment_id: string;
}
export interface CivilizationAuthorization {
  schema: "rain-civilization-authorization/v1";
  experiment_id: string;
  definition_sha256: string;
  operator: string;
  attestation: "local-operator";
  identity_verified: false;
  scope: "civilization-simulation";
  confirmed_prefix: string;
  authorized_at: string;
  expires_at: string;
  authorization_sha256: string;
}
export interface CivilizationResult {
  experiment: NoeterraExperimentResult | null;
  completed: boolean;
  measurements: Record<string, number | null>;
  status: "passed" | "failed" | "inconclusive" | "error";
  verdict: "supported" | "not_supported" | "insufficient_evidence" | "not_evaluated";
  evaluation: Evaluation | null;
  error: string | null;
}
export interface CivilizationRecord {
  schema: typeof CIVILIZATION_RECORD;
  run_id: string;
  plan: CivilizationPlan;
  authorization: CivilizationAuthorization;
  started_at: string;
  finished_at: string;
  result: CivilizationResult;
  evidence_class: "simulated";
  sha256: string;
}
export interface CivilizationPreregistration {
  experiment_id: string;
  registry_definition_sha256: string;
  plan_sha256: string;
}

const civKey = { type: "string", pattern: "^[a-z][a-z0-9_]{0,23}$" };
const treaty = { type: "string", enum: [...CIVILIZATION_TREATIES] };
export const CIVILIZATION_DESIGN_SCHEMA = closed({
  schema: { const: CIVILIZATION_DESIGN, type: "string" },
  question: words(400),
  hypothesis: words(600),
  competing_hypothesis: words(600),
  parameters: closed({
    scenario: { type: "string", enum: [...CIVILIZATION_SCENARIOS] },
    seeds: { type: "array", minItems: 3, maxItems: 32, items: integer(0, 2147483647) },
    turns: integer(8, 200),
    treatment: {
      oneOf: [
        closed({
          kind: { const: "set_trait", type: "string" },
          civ: civKey,
          trait: { type: "string", enum: [...CIVILIZATION_TRAITS] },
          value: number(0, 1),
        }),
        closed({ kind: { const: "withhold_memory", type: "string" } }),
        closed({
          kind: { const: "add_treaty", type: "string" },
          treaty,
          a: civKey,
          b: civKey,
        }),
        closed({
          kind: { const: "remove_treaty", type: "string" },
          treaty,
          a: civKey,
          b: civKey,
        }),
        closed({
          kind: { const: "scale_armies", type: "string" },
          civ: civKey,
          factor: number(0, 5),
        }),
        closed({
          kind: { const: "scale_treasury", type: "string" },
          civ: civKey,
          factor: number(0, 5),
        }),
      ],
    },
  }),
  analysis: closed({
    method: { const: "matched_seed_paired_delta", type: "string" },
    metric: { type: "string", enum: CIVILIZATION_METRICS.map((m) => m.id) },
    expected_direction: { type: "string", enum: ["increase", "decrease"] },
    minimum_effect: number(0.000001, 1000000),
    minimum_consistent_seeds: integer(1, 32),
  }),
  budget: closed({ max_simulated_turns: integer(1, 12800) }),
  provenance: PROVENANCE_SCHEMA,
});

export function parseCivilizationDesign(raw: unknown): Checked<CivilizationDesign> {
  const bounded = boundedData(raw, 5000);
  if (bounded.length) return { ok: false, errors: bounded };
  const errors = schemaErrors(raw, CIVILIZATION_DESIGN_SCHEMA);
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: structuredClone(raw) as CivilizationDesign };
}
