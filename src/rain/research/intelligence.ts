/** Pure CPU campaign decisions. Conditional model beliefs never assign claim standing. */
import { schemaErrors } from "../experiments/jsonSchema.js";
import { sha256Json } from "../sha256.js";

export type CpuAdapter = "qnp-stable" | "qnp-drift" | "drr-null";
export interface CpuDesign {
  id: string;
  adapter: CpuAdapter;
  parameters: Record<string, unknown>;
  predictions: Record<string, number>;
  cost_units: number;
  minimum_rate: number;
  hypothesis: string;
  falsification: string;
}
export interface IntelligencePlan {
  schema: "rain-intelligence-plan/v1";
  question: string;
  rivals: Record<string, number>;
  designs: CpuDesign[];
  screen_seeds: number[];
  confirm_seeds: number[];
  family_alpha: number;
  budget_units: number;
  timeout_seconds: number;
  policy: "information" | "fifo";
  parent_campaigns: string[];
}
export interface ProbeResult {
  samples: number[];
  checks: Record<string, boolean>;
  details: Record<string, unknown>;
  provenance: Record<string, unknown>;
}
export interface Assessment {
  mean: number;
  lower: number;
  upper: number;
  alpha: number;
  n: number;
  verdict: "supported" | "falsified" | "inconclusive" | "invalid";
  checks: Record<string, boolean>;
  method: string;
}
export interface RankedDesign {
  design: CpuDesign;
  expected_bits: number;
  bits_per_unit: number;
}

/** Versioned independent per-design panels; actual seeds are registered before execution. */
export function campaignSeeds(
  plan: IntelligencePlan,
  design: CpuDesign,
  phase: "screen" | "confirmation",
): number[] {
  return (phase === "screen" ? plan.screen_seeds : plan.confirm_seeds).map((base_seed) =>
    Number.parseInt(
      sha256Json({ rule: "cpu-seeds/v1", design_id: design.id, phase, base_seed }).slice(
        0,
        8,
      ),
      16,
    ),
  );
}

const id = { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" };
const text = { type: "string", minLength: 1, maxLength: 2000 };
const rate = { type: "number", minimum: 0, maximum: 1 };
const seeds = {
  type: "array",
  minItems: 8,
  maxItems: 256,
  uniqueItems: true,
  items: { type: "integer", minimum: 0, maximum: 4294967294 },
};
const designSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "adapter",
    "parameters",
    "predictions",
    "cost_units",
    "minimum_rate",
    "hypothesis",
    "falsification",
  ],
  properties: {
    id,
    adapter: { enum: ["qnp-stable", "qnp-drift", "drr-null"] },
    parameters: { type: "object", maxProperties: 16 },
    predictions: {
      type: "object",
      minProperties: 2,
      maxProperties: 8,
      propertyNames: id,
      additionalProperties: rate,
    },
    cost_units: { type: "integer", minimum: 1, maximum: 100000 },
    minimum_rate: rate,
    hypothesis: text,
    falsification: text,
  },
};
export const INTELLIGENCE_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "question",
    "rivals",
    "designs",
    "screen_seeds",
    "confirm_seeds",
    "family_alpha",
    "budget_units",
    "timeout_seconds",
    "policy",
    "parent_campaigns",
  ],
  properties: {
    schema: { const: "rain-intelligence-plan/v1" },
    question: text,
    rivals: {
      type: "object",
      minProperties: 2,
      maxProperties: 8,
      propertyNames: id,
      additionalProperties: { type: "number", minimum: 1e-9, maximum: 1 },
    },
    designs: { type: "array", minItems: 1, maxItems: 16, items: designSchema },
    screen_seeds: seeds,
    confirm_seeds: seeds,
    family_alpha: { type: "number", minimum: 1e-9, maximum: 0.25 },
    budget_units: { type: "integer", minimum: 1, maximum: 10000000 },
    timeout_seconds: { type: "number", minimum: 0.05, maximum: 300 },
    policy: { enum: ["information", "fifo"] },
    parent_campaigns: {
      type: "array",
      maxItems: 16,
      uniqueItems: true,
      items: { type: "string", pattern: "^[0-9a-f]{64}$" },
    },
  },
};

export function validateIntelligencePlan(value: unknown): IntelligencePlan {
  // The canonical encoder rejects non-finite numbers and non-JSON values at any depth.
  const encoded = sha256Json(value);
  if (!encoded || JSON.stringify(value).length > 128000)
    throw new Error("Oversized plan");
  const errors = schemaErrors(value, INTELLIGENCE_PLAN_SCHEMA);
  if (errors.length) throw new Error("Invalid CPU campaign: " + errors.join("; "));
  const p = structuredClone(value) as IntelligencePlan;
  const rivals = Object.keys(p.rivals).sort();
  if (rivals.length < 2 || rivals.length > 8)
    throw new Error("Declare 2..8 rival explanations");
  if (Math.abs(Object.values(p.rivals).reduce((a, b) => a + b, 0) - 1) > 1e-9)
    throw new Error("Rival priors must sum to one");
  if (
    new Set([...p.screen_seeds, ...p.confirm_seeds]).size !==
    p.screen_seeds.length + p.confirm_seeds.length
  )
    throw new Error("Screening and confirmation seeds must be disjoint");
  if (new Set(p.designs.map((d) => d.id)).size !== p.designs.length)
    throw new Error("Duplicate design IDs");
  if (new Set(p.parent_campaigns).size !== p.parent_campaigns.length)
    throw new Error("Duplicate parent campaigns");
  const physical = p.designs.map((d) =>
    sha256Json({ adapter: d.adapter, parameters: d.parameters }),
  );
  if (new Set(physical).size !== physical.length)
    throw new Error(
      "Duplicate physical protocols cannot manufacture independent evidence",
    );
  for (const d of p.designs) {
    if (JSON.stringify(Object.keys(d.predictions).sort()) !== JSON.stringify(rivals))
      throw new Error("Every design must predict every rival");
    if (JSON.stringify(d.parameters).length > 8000)
      throw new Error("Oversized parameters");
  }
  const actual = p.designs.flatMap((d) => [
    ...campaignSeeds(p, d, "screen"),
    ...campaignSeeds(p, d, "confirmation"),
  ]);
  if (actual.some((s) => s > 4294967294) || new Set(actual).size !== actual.length)
    throw new Error(
      "Derived seed panels collide; choose new base seeds before registering",
    );
  return p;
}

/** Exact I(rival; one binary observation), conditional on declared probabilities. */
export function expectedInformation(
  predictions: Record<string, number>,
  priors: Record<string, number>,
): number {
  const entropy = (p: number) =>
    [p, 1 - p].reduce((s, x) => s - (x > 0 ? x * Math.log2(x) : 0), 0);
  const mixture = Object.entries(priors).reduce(
    (s, [k, p]) => s + p * predictions[k]!,
    0,
  );
  return Math.max(
    0,
    entropy(mixture) -
      Object.entries(priors).reduce((s, [k, p]) => s + p * entropy(predictions[k]!), 0),
  );
}
export function rankCpuDesigns(
  designs: CpuDesign[],
  priors: Record<string, number>,
  policy: IntelligencePlan["policy"],
): RankedDesign[] {
  const rows = designs.map((design) => ({
    design,
    expected_bits: expectedInformation(design.predictions, priors),
    bits_per_unit: expectedInformation(design.predictions, priors) / design.cost_units,
  }));
  return policy === "fifo"
    ? rows
    : rows.sort(
        (a, b) =>
          b.bits_per_unit - a.bits_per_unit || a.design.id.localeCompare(b.design.id),
      );
}

/** Screening-only model update. An impossible observation falsifies the model set. */
export function updateRivals(
  priors: Record<string, number>,
  predictions: Record<string, number>,
  samples: number[],
): Record<string, number> | null {
  if (!samples.length || samples.some((x) => x !== 0 && x !== 1))
    throw new Error("Binary observations required");
  const successes = samples.reduce((a, b) => a + b, 0),
    failures = samples.length - successes;
  const logs = Object.fromEntries(
    Object.entries(priors).map(([k, prior]) => {
      const p = predictions[k]!;
      const value =
        (p === 0 && successes > 0) || (p === 1 && failures > 0) || prior === 0
          ? -Infinity
          : Math.log(prior) +
            (successes ? successes * Math.log(p) : 0) +
            (failures ? failures * Math.log1p(-p) : 0);
      return [k, value];
    }),
  );
  const peak = Math.max(...Object.values(logs));
  if (!Number.isFinite(peak)) return null;
  const weights = Object.fromEntries(
    Object.entries(logs).map(([k, v]) => [k, Math.exp(v - peak)]),
  );
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / total]));
}

export function validateProbe(value: unknown, n: number): ProbeResult {
  const schema = {
    type: "object",
    required: ["samples", "checks", "details", "provenance"],
    additionalProperties: false,
    properties: {
      samples: { type: "array", minItems: n, maxItems: n, items: { enum: [0, 1] } },
      checks: {
        type: "object",
        minProperties: 1,
        maxProperties: 32,
        additionalProperties: { type: "boolean" },
      },
      details: { type: "object" },
      provenance: { type: "object", minProperties: 1 },
    },
  };
  const errors = schemaErrors(value, schema);
  if (errors.length)
    throw new Error("Incomplete or invalid worker observations: " + errors.join("; "));
  sha256Json(value);
  const probe = structuredClone(value) as ProbeResult;
  if (!Object.keys(probe.checks).length || !Object.keys(probe.provenance).length)
    throw new Error("Explicit diagnostics and provenance are required");
  return probe;
}

/** Fixed-n two-sided Hoeffding interval; union bound is allocated by the campaign. */
export function assessProbe(
  probe: ProbeResult,
  n: number,
  alpha: number,
  minimum: number,
): Assessment {
  const { samples, checks } = validateProbe(probe, n);
  if (!(alpha > 0 && alpha <= 0.25) || !(minimum >= 0 && minimum <= 1))
    throw new Error("Invalid endpoint rule");
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const radius = Math.sqrt(Math.log(2 / alpha) / (2 * n));
  const lower = Math.max(0, mean - radius),
    upper = Math.min(1, mean + radius);
  return {
    mean,
    lower,
    upper,
    alpha,
    n,
    checks,
    verdict: !Object.values(checks).every(Boolean)
      ? "invalid"
      : lower >= minimum
        ? "supported"
        : upper < minimum
          ? "falsified"
          : "inconclusive",
    method: "fixed-n-hoeffding-union-bound/v1",
  };
}
