/** Native, data-only discovery vocabulary. These schemas never grant authority. */
import { schemaErrors } from "../../rain/experiments/jsonSchema.js";
import {
  DIRECTIONS,
  LOCATION_IDS,
  METRIC_IDS,
  SCENARIO_IDS,
  UNSAFE_TEXT,
  type ScenarioId,
  type LocationId,
  type MetricId,
  type Direction,
} from "./contracts.js";
import type { Checked } from "./validation.js";

export const DISCOVERY_SCHEMA = "rain-discovery-design/v1" as const;
export const GENERATED_PROPOSAL_SCHEMA = "rain-bethesda-experiment/v3" as const;
export const GENERATED_DEFINITION_SCHEMA = "bethesda-experiment-definition/v3" as const;
export interface Parameters {
  pedestrians: number;
  vehicles: number;
  buses: number;
  intensity: 1 | 2 | 3;
  duration_ticks: number;
}
export interface Design {
  schema: typeof DISCOVERY_SCHEMA;
  question: string;
  hypothesis: string;
  competing_hypothesis: string;
  rationale: string;
  evidence_ids: string[];
  parent_design_id: string | null;
  purpose: "exploratory" | "confirmatory";
  scenario: ScenarioId;
  location: LocationId;
  primary_metric: MetricId;
  expected_direction: Direction;
  minimum_effect: number;
  warmup_ticks: number;
  observation_window_ticks: number;
  parameters: Parameters;
  uncertainties: string[];
  replication_plan: string;
  information_value: number;
}
export const closed = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const integer = (minimum: number, maximum: number) => ({
  type: "integer",
  minimum,
  maximum,
});
const words = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const options = (values: readonly string[]) => ({ type: "string", enum: [...values] });
const notes = { type: "array", items: words(400), maxItems: 5 };
export const PARAMETERS_SCHEMA = closed({
  pedestrians: integer(40, 360),
  vehicles: integer(0, 70),
  buses: integer(0, 14),
  intensity: integer(1, 3),
  duration_ticks: integer(100, 6000),
});
export const DESIGN_SCHEMA = closed({
  schema: { const: DISCOVERY_SCHEMA, type: "string" },
  question: words(400),
  hypothesis: words(600),
  competing_hypothesis: words(600),
  rationale: words(1000),
  evidence_ids: { type: "array", items: words(128), maxItems: 8 },
  parent_design_id: { type: ["string", "null"], maxLength: 80 },
  purpose: options(["exploratory", "confirmatory"]),
  scenario: options(SCENARIO_IDS),
  location: options(LOCATION_IDS),
  primary_metric: options(METRIC_IDS),
  expected_direction: options(DIRECTIONS),
  minimum_effect: { type: "number", minimum: 0.01, maximum: 500 },
  warmup_ticks: integer(100, 1200),
  observation_window_ticks: integer(300, 3000),
  parameters: PARAMETERS_SCHEMA,
  uncertainties: notes,
  replication_plan: words(600),
  information_value: { type: "number", minimum: 0, maximum: 1 },
});
export const CANDIDATES_SCHEMA = closed({
  candidates: { type: "array", minItems: 0, maxItems: 3, items: DESIGN_SCHEMA },
  untestable: closed({
    reason: words(1000),
    missing_capabilities: { type: "array", minItems: 1, maxItems: 6, items: words(400) },
    extension_specification: words(2000),
  }),
});
CANDIDATES_SCHEMA.required = ["candidates"];
export interface CandidateResponse {
  candidates: Design[];
  untestable?: {
    reason: string;
    missing_capabilities: string[];
    extension_specification: string;
  };
}
export interface Critique {
  assessment: "proceed" | "revise";
  confounds: string[];
  comparison_validity: string;
  circularity: string;
  evidence_limits: string[];
  disagreements: string[];
  learned: string;
  distinguished: string;
  failed_assumptions: string[];
  uncertainty: string[];
  next_question: string;
  replicate: boolean;
}
export const CRITIQUE_SCHEMA = closed({
  assessment: options(["proceed", "revise"]),
  confounds: notes,
  comparison_validity: words(600),
  circularity: words(600),
  evidence_limits: notes,
  disagreements: notes,
  learned: words(1000),
  distinguished: words(600),
  failed_assumptions: notes,
  uncertainty: notes,
  next_question: words(400),
  replicate: { type: "boolean" },
});
export function checkData<T>(raw: unknown, schema: Record<string, unknown>): Checked<T> {
  const errors = schemaErrors(raw, schema);
  const visit = (v: unknown) => {
    if (typeof v === "string" && UNSAFE_TEXT.test(v))
      errors.push("unsafe control or invisible text");
    if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(raw);
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: structuredClone(raw) as T };
}
export function checkParameters(raw: unknown): Checked<Parameters> {
  const checked = checkData<Parameters>(raw, PARAMETERS_SCHEMA);
  if (!checked.ok) return checked;
  if (checked.value.duration_ticks % 100 || checked.value.pedestrians % 20)
    return {
      ok: false,
      errors: ["duration must use 100-tick steps; pedestrians must use 20-agent steps"],
    };
  return checked;
}

export interface Envelope {
  scenarios: ScenarioId[];
  locations: LocationId[];
  metrics: MetricId[];
  pedestrians: [number, number];
  vehicles: [number, number];
  buses: [number, number];
  intensity: [number, number];
  duration_ticks: [number, number];
  warmup_ticks: [number, number];
  observation_window_ticks: [number, number];
  max_actor_ticks: number;
  seeds_per_design: number;
}
export const DEFAULT_ENVELOPE: Envelope = {
  scenarios: [...SCENARIO_IDS],
  locations: [...LOCATION_IDS],
  metrics: [...METRIC_IDS],
  pedestrians: [40, 360],
  vehicles: [0, 70],
  buses: [0, 14],
  intensity: [1, 3],
  duration_ticks: [100, 6000],
  warmup_ticks: [100, 1200],
  observation_window_ticks: [300, 3000],
  max_actor_ticks: 8_000_000,
  seeds_per_design: 3,
};
const range = (minimum: number, maximum: number) => ({
  type: "array",
  minItems: 2,
  maxItems: 2,
  items: integer(minimum, maximum),
});
export const ENVELOPE_SCHEMA = closed({
  scenarios: {
    type: "array",
    minItems: 1,
    maxItems: SCENARIO_IDS.length,
    items: options(SCENARIO_IDS),
  },
  locations: {
    type: "array",
    minItems: 1,
    maxItems: LOCATION_IDS.length,
    items: options(LOCATION_IDS),
  },
  metrics: {
    type: "array",
    minItems: 1,
    maxItems: METRIC_IDS.length,
    items: options(METRIC_IDS),
  },
  pedestrians: range(40, 360),
  vehicles: range(0, 70),
  buses: range(0, 14),
  intensity: range(1, 3),
  duration_ticks: range(100, 6000),
  warmup_ticks: range(100, 1200),
  observation_window_ticks: range(300, 3000),
  max_actor_ticks: integer(1, 8_000_000),
  seeds_per_design: integer(3, 5),
});
export function envelopeErrors(raw: unknown): string[] {
  const errors = schemaErrors(raw, ENVELOPE_SCHEMA);
  if (!errors.length) {
    for (const v of Object.values(raw as Envelope)) {
      if (Array.isArray(v) && typeof v[0] === "number" && v[0] > v[1])
        errors.push("inverted parameter range");
    }
  }
  return errors;
}
export const DISCOVERY_QUESTION =
  "How do different simulated urban disruptions alter collective movement patterns, and under which conditions does the same intervention produce different behavioral outcomes?";
