/** Pure, closed scientific design vocabulary. Proposals carry no execution authority. */
import { schemaErrors } from "../../rain/experiments/jsonSchema.js";
import { UNSAFE_TEXT } from "./contracts.js";
import type { Checked } from "./validation.js";
import type { Criterion, Evaluation } from "../../rain/experiments/evaluate.js";
import { PARAMS } from "../fly/params.js";

export const SCIENTIFIC_IR = "rain-scientific-experiment/v1" as const;
export const NUMERICAL_DESIGN = "rain-oscillator-design/v1" as const;
export const NUMERICAL_BACKEND = "rain-driven-damped-oscillator/v1" as const;
export const NUMERICAL_RECORD = "rain-numerical-record/v1" as const;
export type ScientificBackendId =
  "bethesda" | "numerical-physics" | "civilization" | "digital-fly";
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
  domain:
    | "urban-simulation"
    | "numerical-physics"
    | "civilization-simulation"
    | "fly-behavior-simulation";
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
  {
    id: "digital-fly",
    // FLY_BACKEND, written out: this list is built before the fly section below.
    version: "digital-fly-behavior/v3",
    supported: [
      "matched-seed paired arms of the digital fly in closed arenas",
      "six fixed protocols: obstacle avoidance, light preference, a looming dose series (visual threat), noisy sensing, adaptation to repeated looms and controller comparison",
      "seeds drawn by the host after preregistration, never by the design; pilot seeds never",
      "an exact one-sided sign test on untied seeds at a host-fixed alpha of 0.05",
      "controller configurations that override model parameters only, within their ranges; FlyBody and published values stay fixed",
      "every run re-simulates exactly from its plan on the JavaScript engine that made it",
    ],
    unsupported: [
      "neural simulation: the controller is a reduced-order state machine",
      "inference about real Drosophila",
      "odour, temperature, humidity, airflow and food",
      "re-simulation on another JavaScript engine",
      "physical instruments",
    ],
    authority_scope: "fly-behavior-simulation",
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

// --------------------------------------------------------------- digital fly
// The digital fly (src/bethesda/fly/) moves FlyBody's anatomy with a
// reduced-order controller: a state machine over FlyBody, published and model
// parameters that simulates no neurons. Its experiments run in closed arenas
// and characterize that simulator only. They are never evidence about
// Drosophila, and the vocabulary below says so wherever it can.
//
// This section is part of the fly's source digest (FLY_SOURCE): editing it
// changes the fly's identity, so records made before the edit are listed as
// made by other code rather than failing re-simulation.

/** v3: the redesigned protocols (a looming dose series, pilot-sized apparatus, a fixed schedule). */
export const FLY_DESIGN = "rain-fly-design/v3" as const;
export const FLY_BACKEND = "digital-fly-behavior/v3" as const;
export const FLY_EXPERIMENT = "digital-fly-experiment/v3" as const;
/**
 * The envelopes keep their v2 shape, so a record made under
 * digital-fly-behavior/v2 is still checked for integrity (seal, receipt,
 * authorization, seeds) by this code even though only its own code could
 * re-simulate it.
 */
export const FLY_PLAN = "rain-fly-plan/v2" as const;
export const FLY_AUTHORIZATION = "rain-fly-authorization/v2" as const;
export const FLY_RECORD = "rain-fly-record/v2" as const;
/**
 * Pilot runs size the protocols' apparatus, minimum effects and seed counts.
 * They are exploratory: never preregistered, authorized or admitted, kept in
 * docs/benchmarks/fly-pilots/ as not evidence, and their seeds come from this
 * public domain, SHA-256("rain-fly-pilot/v1|" + counter), which the host
 * excludes from every archived run.
 */
export const FLY_PILOT = "rain-fly-pilot/v1" as const;
export const FLY_PILOT_SEED_COUNT = 64;
/**
 * Records made under digital-fly-behavior/v1, before the integrity rules: from
 * an uncommitted tree, on seeds the designer chose, authorized by a script.
 * They stay in the archive, which keeps everything that ran, and are
 * exploratory only: verification checks what it still can and never counts
 * them as evidence.
 */
export const FLY_LEGACY_RECORD = "rain-fly-record/v1" as const;
export const FLY_BLOCKS = ["clutter", "light", "escape", "repeat"] as const;
export type FlyBlockId = (typeof FLY_BLOCKS)[number];

/** The host's decision rule: an exact one-sided sign test on untied matched seeds. */
export const FLY_ALPHA = 0.05;
/**
 * Fewest seeds that must differ between the arms before the sign test decides
 * (host-fixed); at six, only a unanimous result reaches alpha.
 */
export const FLY_MIN_UNTIED_PAIRS = 6;
export const FLY_SEED_COUNT = { min: 8, max: 16 } as const;

/**
 * What each block measures, per seed and arm. A design may test a `primary`
 * metric; the others are reported but never tested. A primary metric can still
 * be undefined in one run (a per-metre rate below 0.5 m flown, a per-second
 * rate below 1 s of flight, a probability with nothing shown, a timing with no
 * escape): that seed then drops out of the paired test rather than voiding it.
 *
 * `floor` and `ceiling` bound the metric: a control arm pinned at one of them
 * in every seed can move one way only, so guard G3 holds the result
 * inconclusive. `minimum_effect` is the host's smallest mean paired difference
 * worth calling an effect. A design may raise it, never lower it. For the
 * metrics kept from v2 it was set from the apparatus: 0.1 for a probability,
 * 10 cm for a distance in the 4 m arena, 0.01 per metre for a collision rate.
 * For the metrics the redesign added it is the largest floor any pilot found
 * (docs/benchmarks/fly-pilots/): the larger of the simulator's resolution and
 * twice the standard error, at the smallest seed count, of the paired
 * differences between two independent runs of a control arm, an upper bound on
 * what divergence alone produces. fly.test.ts checks these against the pilots.
 */
export const FLY_METRICS = [
  {
    id: "collision_episodes_per_m",
    block: "clutter",
    unit: "1/m",
    primary: true,
    floor: 0,
    ceiling: null,
    minimum_effect: 0.01,
    description: "collision episodes per metre flown in pillar clutter",
  },
  {
    id: "cruise_collision_episodes_per_m",
    block: "clutter",
    unit: "1/m",
    primary: true,
    floor: 0,
    ceiling: null,
    minimum_effect: 0.01,
    description:
      "collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter",
  },
  {
    id: "collision_episodes",
    block: "clutter",
    unit: "count",
    primary: true,
    floor: 0,
    ceiling: null,
    minimum_effect: 1,
    description:
      "collision episodes in pillar clutter (contacts less than 0.1 s apart are one episode)",
  },
  {
    id: "near_miss_fraction",
    block: "clutter",
    unit: "fraction",
    primary: true,
    floor: 0,
    ceiling: 1,
    // The obstacle-avoidance pilot's floor: its avoidance-off control varies most.
    minimum_effect: 0.08,
    description:
      "fraction of cruising flight spent within 5 cm of a pillar or wall, measured by the host from the arena's geometry",
  },
  {
    id: "flown_m",
    block: "clutter",
    unit: "m",
    primary: true,
    floor: 0,
    ceiling: null,
    minimum_effect: 1,
    description: "distance flown in pillar clutter",
  },
  {
    id: "saccades_per_flight_s",
    block: "clutter",
    unit: "1/s",
    primary: true,
    floor: 0,
    ceiling: null,
    minimum_effect: 0.1,
    description: "body saccades per second of flight in pillar clutter",
  },
  {
    id: "contact_s",
    block: "clutter",
    unit: "s",
    primary: true,
    floor: 0,
    ceiling: null,
    minimum_effect: 0.1,
    description:
      "time spent pressed against a surface while flying or landing in pillar clutter",
  },
  {
    id: "escape_probability",
    block: "escape",
    unit: "fraction",
    primary: true,
    floor: 0,
    ceiling: 1,
    minimum_effect: 0.1,
    description: "fraction of single-stimulus trials answered by an escape takeoff",
  },
  {
    id: "escape_ttc_s",
    block: "escape",
    unit: "s",
    primary: true,
    floor: null,
    ceiling: null,
    // The visual-threat pilot's floor (the noisy-sensing pilot found the 10 ms sample period).
    minimum_effect: 0.02,
    description:
      "mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed)",
  },
  {
    id: "escape_latency_s",
    block: "escape",
    unit: "s",
    primary: false,
    floor: 0,
    ceiling: null,
    minimum_effect: null,
    description: "mean time from stimulus onset to the escape decision, over escapes",
  },
  {
    id: "size_at_escape_deg",
    block: "escape",
    unit: "deg",
    primary: false,
    floor: 0,
    ceiling: 180,
    minimum_effect: null,
    description: "mean angular size of the stimulus at the escape decision",
  },
  {
    id: "short_mode_fraction",
    block: "escape",
    unit: "fraction",
    primary: false,
    floor: 0,
    ceiling: 1,
    minimum_effect: null,
    description: "fraction of escapes that took the short (fast) takeoff",
  },
  {
    id: "mean_light_distance_m",
    block: "light",
    unit: "m",
    primary: true,
    floor: 0,
    ceiling: null,
    minimum_effect: 0.1,
    description:
      "mean horizontal distance from the fly to the point below the light position",
  },
  {
    id: "time_near_light",
    block: "light",
    unit: "fraction",
    primary: true,
    floor: 0,
    ceiling: 1,
    minimum_effect: 0.05,
    description:
      "fraction of time within 1 m (horizontally) of the point below the light position",
  },
  {
    id: "active_fraction",
    block: "light",
    unit: "fraction",
    primary: true,
    floor: 0,
    ceiling: 1,
    minimum_effect: 0.05,
    description:
      "fraction of time walking, taking off or flying rather than resting or grooming",
  },
  {
    id: "repeat_escape_probability",
    block: "repeat",
    unit: "fraction",
    primary: true,
    floor: 0,
    ceiling: 1,
    minimum_effect: 0.1,
    description:
      "fraction of the presentations shown to the standing fly that it answered by an escape",
  },
  {
    id: "late_escape_probability",
    block: "repeat",
    unit: "fraction",
    primary: true,
    floor: 0,
    ceiling: 1,
    minimum_effect: 0.1,
    description: "the same fraction over the second half of the schedule's presentations",
  },
  {
    id: "presentations",
    block: "repeat",
    unit: "count",
    primary: false,
    floor: 0,
    ceiling: null,
    minimum_effect: null,
    description: "presentations shown, each on the schedule while the fly stood",
  },
  {
    id: "airborne_presentations",
    block: "repeat",
    unit: "count",
    primary: false,
    floor: 0,
    ceiling: null,
    minimum_effect: null,
    description:
      "presentations the schedule skipped because the fly was still in the air when they were due",
  },
  {
    id: "repeat_size_at_escape_deg",
    block: "repeat",
    unit: "deg",
    primary: false,
    floor: 0,
    ceiling: 180,
    minimum_effect: null,
    description: "mean angular size of the repeated stimulus at the escape decision",
  },
] as const;
export type FlyMetricId = (typeof FLY_METRICS)[number]["id"];

/**
 * The six protocols. `caveat` says plainly what a protocol cannot show as
 * designed; it travels into every plan's limitations. The v3 redesign chose
 * the apparatus of four of them with pilots so that their primary measures
 * discriminate (docs/benchmarks/fly-pilots/); what is left is what the pilots
 * showed.
 */
export const FLY_PROTOCOLS = [
  {
    id: "obstacle_avoidance",
    title: "Obstacle avoidance",
    blocks: ["clutter"],
    independent: "the avoidance time-to-contact threshold (avoidTtcS)",
    baseline: "avoidance off (avoidTtcS = 0) on the same seeds",
    caveat: null,
  },
  {
    id: "light_preference",
    title: "Light preference",
    blocks: ["light"],
    independent: "a point light above one quadrant of the arena",
    baseline: "no point light, ambient only; distance is measured to the same point",
    caveat: null,
  },
  {
    id: "visual_threat",
    title: "Visual threat: looming dose series",
    blocks: ["escape"],
    independent:
      "the approach speed of a looming sphere, as l/v (its radius over its speed)",
    baseline: "the same sphere on the same lines, approaching at another l/v",
    caveat:
      "Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.",
  },
  {
    id: "noisy_sensing",
    title: "Noisy sensing",
    blocks: ["escape", "clutter"],
    independent:
      "sensory noise (relative on sizes, distances and light levels, in radians on directions)",
    baseline: "noiseless sensing on the same seeds",
    caveat:
      "Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.",
  },
  {
    id: "adaptation",
    title: "Adaptation to repeated looms",
    blocks: ["repeat"],
    independent: "a short interval between repeated looming stimuli, on a fixed schedule",
    baseline: "a 90 s interval on the same seeds",
    caveat:
      "This controller's responsiveness falls only after an escape, so the protocol measures habituation that follows responses; a presentation that falls due while the fly is still in the air is skipped and counted (airborne_presentations), never delayed.",
  },
  {
    id: "controller_comparison",
    title: "Controller comparison",
    blocks: ["escape", "clutter", "light"],
    independent: "a second controller configuration (model parameters only)",
    baseline: "a first controller configuration on the same seeds",
    caveat: null,
  },
] as const satisfies readonly {
  id: string;
  title: string;
  blocks: readonly FlyBlockId[];
  independent: string;
  baseline: string;
  caveat: string | null;
}[];
export type FlyProtocolId = (typeof FLY_PROTOCOLS)[number]["id"];

/** Overrides of the fly's parameters by name; the compiler admits model parameters only. */
export type FlyControllerConfig = Record<string, number>;
export type FlyTreatment =
  | { kind: "obstacle_avoidance"; avoid_ttc_s: number }
  | { kind: "light_preference"; light_intensity: number }
  | {
      kind: "visual_threat";
      /** l/v of each arm's approach (ms): the sphere's radius over its speed. */
      control_l_over_v_ms: number;
      treatment_l_over_v_ms: number;
    }
  | { kind: "noisy_sensing"; noise: number }
  | { kind: "adaptation"; isi_s: number }
  | {
      kind: "controller_comparison";
      baseline: FlyControllerConfig;
      treatment: FlyControllerConfig;
    };

export interface FlyDesign {
  schema: typeof FLY_DESIGN;
  question: string;
  hypothesis: string;
  competing_hypothesis: string;
  /** How many seeds, never which: the host draws them after preregistration. */
  parameters: { seed_count: number; treatment: FlyTreatment };
  analysis: {
    method: "matched_seed_sign_test";
    metric: FlyMetricId;
    expected_direction: "increase" | "decrease";
    /** At least the metric's host minimum (FLY_METRICS). */
    minimum_effect: number;
  };
  budget: { max_simulated_seconds: number };
  provenance: ScientificProvenance;
}

/** A host-built block: the arena, its fixed settings and how the fly is observed. */
export interface FlyBlockSpec {
  id: FlyBlockId;
  arena: {
    size: [number, number, number];
    ambient: number;
    pillars: { x: number; z: number; r: number }[];
  };
  /** Model parameters the apparatus fixes in both arms, so the block measures what it names. */
  fixed_config: FlyControllerConfig;
  /** Half-width of the square around the arena centre where the fly is placed (m). */
  start_half_width_m: number;
  /** How often the host observes the fly (s); the fly itself steps every 5 ms. */
  tick_s: number;
  /** Free-behaviour blocks: run length (s). Stimulus blocks: time kept after each stimulus (s). */
  duration_s: number;
  /** Escape: trials per seed. Repeat: presentations per seed. Otherwise 1. */
  trials: number;
  light_at: [number, number, number] | null;
  /** Clutter: a cruising fly closer than this to a pillar or wall is a near miss (m). */
  near_miss_m: number | null;
  stimulus: {
    radius_m: number;
    start_distance_m: number;
    /**
     * The angular size at which a presentation stops, drawn per trial or
     * presentation from this range (deg); equal ends fix it. It then vanishes.
     */
    final_size_deg: [number, number];
    elevation_deg: [number, number];
    /** Direction it comes from, relative to the fly's heading (anticlockwise positive). */
    azimuth_deg: [number, number];
    /** The first presentation (s after the fly is placed). */
    onset_s: number;
    /** The approach's l/v (ms) unless an arm sets its own: radius over speed. */
    l_over_v_ms: number;
  } | null;
}
export interface FlyArm {
  id: "control" | "treatment";
  config: FlyControllerConfig;
  noise: number;
  /** Light block: point-light intensity, 0 for none. */
  light_intensity: number;
  /** Escape block: the approach's l/v (ms), radius over speed. */
  l_over_v_ms: number;
  /** Repeat block: interval between scheduled presentation onsets (s). */
  isi_s: number;
}
export interface FlyExperiment {
  schema: typeof FLY_EXPERIMENT;
  protocol: FlyProtocolId;
  /** How many matched seeds; which ones is decided after preregistration. */
  seed_count: number;
  blocks: FlyBlockSpec[];
  arms: FlyArm[];
}
export interface FlyRun {
  arm: "control" | "treatment";
  seed: number;
  block: FlyBlockId;
  /** The fly's state hash at the end of every trial (one entry for a free-behaviour block). */
  final_hashes: string[];
  simulated_s: number;
  /** Commands the fly's own gate refused during the run; any refusal voids the result (G5). */
  gate_refusals: number;
  metrics: Record<string, number | null>;
}
export interface FlyPlan {
  schema: typeof FLY_PLAN;
  design: FlyDesign;
  ir: ScientificExperimentIR;
  /** The fly model and controller versions the plan binds. */
  fly: string;
  /** Digest of the fly's version, controller, parameter table and source digest. */
  fly_sha256: string;
  /** SHA-256 of the source files that decide what the experiment does (FLY_SOURCE). */
  fly_source_sha256: string;
  experiment: FlyExperiment;
  /** Upper bound on simulated fly-seconds over both arms, every seed and block. */
  simulated_seconds: number;
  criteria: { guards: Criterion[]; success: Criterion[]; failure: Criterion[] };
  definition_sha256: string;
  experiment_id: string;
}
/** The registry's receipt for a preregistered plan. */
export interface FlyPreregistration {
  /** The registry's id (V3D-EXP-...). */
  experiment_id: string;
  registry_definition_sha256: string;
  plan_sha256: string;
  /** When the registry recorded the definition: nothing may be authorized or run before it. */
  created_at: string;
}
/** How an authorization was given: a person at a terminal, or the demonstration script. */
export type FlyAuthorizationChannel = "terminal" | "script";
/** The only operator the demonstration script may name: never someone mistaken for a reviewer. */
export const FLY_SCRIPT_OPERATOR = "Scripted.DemoOperator";
export interface FlyAuthorization {
  schema: typeof FLY_AUTHORIZATION;
  experiment_id: string;
  definition_sha256: string;
  /** The preregistration it follows: the registry id, its receipt digest and time. */
  registry_experiment_id: string;
  preregistration_sha256: string;
  registered_at: string;
  /** 32 random bytes from a CSPRNG, drawn at authorization; with the receipt it fixes the seeds. */
  nonce: string;
  channel: FlyAuthorizationChannel;
  operator: string;
  attestation: "local-operator" | "demonstration-script";
  identity_verified: false;
  /** A design declared human: the operator attested at the terminal that a person wrote it. */
  human_design_attested: boolean;
  scope: "fly-behavior-simulation";
  confirmed_prefix: string;
  authorized_at: string;
  expires_at: string;
  authorization_sha256: string;
}
export interface FlyResult {
  runs: FlyRun[];
  completed: boolean;
  measurements: Record<string, number | null>;
  status: "passed" | "failed" | "inconclusive" | "error";
  verdict: "supported" | "not_supported" | "insufficient_evidence" | "not_evaluated";
  evaluation: Evaluation | null;
  error: string | null;
}
/** The JavaScript engine a record was made on: re-simulation is exact only there. */
export interface FlyEngine {
  runtime: string;
  version: string;
  js: string;
}
/** The source tree an experiment ran from, as git reported it. */
export interface FlyCodeState {
  commit: string | null;
  dirty: boolean | null;
}
export interface FlyRecord {
  schema: typeof FLY_RECORD;
  run_id: string;
  plan: FlyPlan;
  preregistration: FlyPreregistration;
  authorization: FlyAuthorization;
  /** Drawn from SHA-256(receipt digest ‖ nonce ‖ counter); the record carries them for reading. */
  seeds: number[];
  engine: FlyEngine;
  code: FlyCodeState;
  /** Run from uncommitted or unknown code: kept, never admitted as evidence. */
  development: boolean;
  started_at: string;
  finished_at: string;
  result: FlyResult;
  evidence_class: "simulated";
  sha256: string;
}

const flyConfig = {
  type: "object",
  maxProperties: 16,
  propertyNames: { type: "string", enum: Object.keys(PARAMS) },
  additionalProperties: number(0, 1000),
};
export const FLY_DESIGN_SCHEMA = closed({
  schema: { const: FLY_DESIGN, type: "string" },
  question: words(400),
  hypothesis: words(600),
  competing_hypothesis: words(600),
  parameters: closed({
    seed_count: integer(FLY_SEED_COUNT.min, FLY_SEED_COUNT.max),
    treatment: {
      oneOf: [
        closed({
          kind: { const: "obstacle_avoidance", type: "string" },
          avoid_ttc_s: number(0.05, 2),
        }),
        closed({
          kind: { const: "light_preference", type: "string" },
          light_intensity: number(0.25, 8),
        }),
        closed({
          kind: { const: "visual_threat", type: "string" },
          control_l_over_v_ms: number(10, 400),
          treatment_l_over_v_ms: number(10, 400),
        }),
        closed({
          kind: { const: "noisy_sensing", type: "string" },
          noise: number(0.01, 1),
        }),
        closed({ kind: { const: "adaptation", type: "string" }, isi_s: number(3, 60) }),
        closed({
          kind: { const: "controller_comparison", type: "string" },
          baseline: flyConfig,
          treatment: flyConfig,
        }),
      ],
    },
  }),
  analysis: closed({
    method: { const: "matched_seed_sign_test", type: "string" },
    metric: {
      type: "string",
      enum: FLY_METRICS.filter((m) => m.primary).map((m) => m.id),
    },
    expected_direction: { type: "string", enum: ["increase", "decrease"] },
    minimum_effect: number(0.000001, 1000000),
  }),
  budget: closed({ max_simulated_seconds: integer(1, 200000) }),
  provenance: PROVENANCE_SCHEMA,
});

export function parseFlyDesign(raw: unknown): Checked<FlyDesign> {
  const bounded = boundedData(raw, 5000);
  if (bounded.length) return { ok: false, errors: bounded };
  const errors = schemaErrors(raw, FLY_DESIGN_SCHEMA);
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: structuredClone(raw) as FlyDesign };
}
