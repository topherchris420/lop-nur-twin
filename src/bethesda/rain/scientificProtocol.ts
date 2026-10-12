/** Pure, closed scientific design vocabulary. Proposals carry no execution authority. */
import { schemaErrors } from "../../rain/experiments/jsonSchema.js";
import { UNSAFE_TEXT } from "./contracts.js";
import type { Checked } from "./validation.js";
import type { Criterion, Evaluation } from "../../rain/experiments/evaluate.js";

export const SCIENTIFIC_IR = "rain-scientific-experiment/v1" as const;
export const NUMERICAL_DESIGN = "rain-oscillator-design/v1" as const;
export const NUMERICAL_BACKEND = "rain-driven-damped-oscillator/v1" as const;
export const NUMERICAL_RECORD = "rain-numerical-record/v1" as const;
export type ScientificBackendId = "bethesda" | "numerical-physics";
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
  domain: "urban-simulation" | "numerical-physics";
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
];
