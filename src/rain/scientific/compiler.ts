/** Original scientific IR extension. Existing Bethesda validation remains authoritative. */
import { sha256Json, canonicalJson } from "../sha256.js";
import type { Checked } from "../../bethesda/rain/validation.js";
import {
  compileDesign,
  type CompiledDesign,
} from "../../bethesda/rain/discoveryCompiler.js";
import { METRICS } from "../../bethesda/rain/contracts.js";
import {
  boundedData,
  NUMERICAL_BACKEND,
  parseNumericalDesign,
  SCIENTIFIC_IR,
  type NumericalPlan,
  type ScientificExperimentIR,
  type ScientificProvenance,
} from "./contracts.js";
import type { Criterion } from "../experiments/evaluate.js";
export type { NumericalPlan } from "./contracts.js";
export const numericalPlanBody = (p: NumericalPlan) => {
  const { definition_sha256: _digest, experiment_id: _id, ...body } = p;
  return body;
};
export function compileNumericalExperiment(
  raw: unknown,
  context: {
    evidenceIds?: ReadonlySet<string>;
    verifiedParentDigests?: ReadonlySet<string>;
  } = {},
): Checked<NumericalPlan> {
  const parsed = parseNumericalDesign(raw);
  if (!parsed.ok) return parsed;
  const design = parsed.value,
    p = design.parameters,
    a = design.analysis;
  const errors: string[] = [];
  const omega0 = Math.sqrt(p.stiffness.value / p.mass.value);
  const gamma = p.damping.value / (2 * p.mass.value);
  if (gamma >= omega0 * (1 - 0.000001))
    errors.push(
      "only underdamped oscillators separated from critical damping are supported",
    );
  if (p.timestep.value * Math.max(omega0, p.angular_frequency.value, 2 * gamma) > 0.1)
    errors.push("unsafe timestep: dt times fastest system/forcing rate must be <= 0.1");
  const count = p.duration.value / p.timestep.value,
    steps = Math.round(count);
  if (
    !Number.isSafeInteger(steps) ||
    steps < 1 ||
    Math.abs(count - steps) > 1e-8 * Math.max(1, count)
  )
    errors.push("duration must be an integer number of timesteps");
  const samples = 1 + Math.ceil(steps / p.sample_every_steps);
  if (
    steps > design.budget.max_steps ||
    steps > 100000 ||
    samples > design.budget.max_samples ||
    samples > 10001
  )
    errors.push("numerical execution/sample resource ceiling exceeded");
  if (p.sample_every_steps > steps)
    errors.push("sample interval exceeds experiment duration");
  if (
    p.sample_every_steps *
      p.timestep.value *
      Math.max(omega0, p.angular_frequency.value) >
    Math.PI / 4
  )
    errors.push(
      "measurement sampling must resolve the fastest period with at least eight samples",
    );
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
  const sign = a.expected_direction === "increase" ? 1 : -1;
  const ir: ScientificExperimentIR = {
    schema: SCIENTIFIC_IR,
    domain: "numerical-physics",
    backend: "numerical-physics",
    backend_version: NUMERICAL_BACKEND,
    question:
      "How does cosine driving change RMS displacement against a matched zero-force oscillator?",
    hypothesis: `Driving will ${a.expected_direction} RMS displacement by at least ${a.minimum_effect_m} m relative to a matched zero-force control.`,
    observables: [
      { id: "time", unit: "s", description: "Fixed integration clock" },
      { id: "displacement", unit: "m", description: "Oscillator displacement" },
      { id: "velocity", unit: "m/s", description: "Oscillator velocity" },
      { id: "mechanical_energy", unit: "J", description: "Kinetic plus spring energy" },
      {
        id: "rms_displacement_delta_m",
        unit: "m",
        description: "Treatment RMS displacement minus matched control RMS",
      },
    ],
    independent_variables: ["cosine force amplitude (N)"],
    dependent_variables: ["RMS displacement (m)"],
    controls: [
      "zero-force control",
      "matched mass, damping, stiffness, clock and initial conditions",
    ],
    parameter_constraints: [
      "SI units only",
      "positive mass, stiffness and damping",
      "underdamped regime",
      "dt * fastest rate <= 0.1",
      "sample interval resolves fastest period at >= 8 samples per period",
      "integer duration/timestep",
      "bounded steps and samples",
    ],
    resource_budget: {
      execution_steps: 2 * steps,
      replay_steps: 2 * steps,
      max_samples: 2 * samples,
    },
    statistical_analysis: {
      method:
        "Difference of sampled trajectory RMS; analytic reference verifies every integration step",
      independent_replicates: 1,
      uncertainty:
        "Deterministic simulation, one matched initial condition; temporal samples are correlated. Maximum analytic error is reported; no population inference or p-value.",
    },
    falsification: {
      metric: "rms_displacement_delta_m",
      op: sign > 0 ? "<=" : ">=",
      value: 0,
      unit: "m",
    },
    provenance: structuredClone(design.provenance),
    limitations: [
      "Simulation of m x'' + b x' + k x = F cos(omega t), not physical measurements.",
      "Linear underdamped dynamics only; no nonlinearities, thermal noise or physical equipment.",
      "RMS compares the complete preregistered sampled window including transients.",
      "Reference accuracy establishes numerical agreement, not empirical validity of the model.",
      "Same-runtime replay is byte-deterministic; cross-engine floating point identity is not promised.",
    ],
  };
  const criterion = (
    id: string,
    metric: string,
    op: Criterion["op"],
    value: number,
    note: string,
  ): Criterion & { note: string } => ({ id, metric, op, value, note });
  const body = {
    schema: "rain-numerical-plan/v1" as const,
    design,
    ir,
    steps,
    samples_per_arm: samples,
    criteria: {
      guards: [
        criterion("G1", "arms_completed", ">=", 2, "Both matched arms complete"),
        criterion(
          "G2",
          "reference_max_error_m",
          "<=",
          a.max_reference_error_m,
          "Independent analytic displacement check",
        ),
        criterion(
          "G3",
          "reference_max_velocity_error_m_per_s",
          "<=",
          a.max_reference_velocity_error_m_per_s,
          "Independent analytic velocity check",
        ),
      ],
      success: [
        criterion(
          "S1",
          "rms_displacement_delta_m",
          sign > 0 ? ">=" : "<=",
          sign * a.minimum_effect_m,
          "Preregistered effect threshold",
        ),
      ],
      failure: [
        criterion(
          "F1",
          "rms_displacement_delta_m",
          sign > 0 ? "<=" : ">=",
          0,
          "No effect or opposite direction",
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
      experiment_id: `NP-${digest.slice(0, 24)}`,
    },
  };
}
/** Recompile with retained source IDs; availability must be established separately at admission. */
export function verifyNumericalPlan(raw: unknown): string[] {
  const errors = boundedData(raw);
  if (errors.length) return errors;
  try {
    const p = raw as NumericalPlan;
    const sources = p.design.provenance.source_ids;
    const parent = p.design.provenance.parent_record_sha256;
    const compiled = compileNumericalExperiment(p.design, {
      evidenceIds: new Set(sources),
      verifiedParentDigests: new Set(parent ? [parent] : []),
    });
    if (!compiled.ok) return compiled.errors;
    return canonicalJson(raw) === canonicalJson(compiled.value)
      ? []
      : [
          "plan does not match deterministic recompilation (including frozen criteria and backend version)",
        ];
  } catch {
    return ["malformed numerical plan"];
  }
}
export interface BethesdaScientificPlan {
  backend: "bethesda";
  ir: ScientificExperimentIR;
  compiled: CompiledDesign;
}
/** Adapter: delegates every design, evidence, envelope, replication and resource check. */
export function compileBethesdaExperiment(
  raw: unknown,
  context: Parameters<typeof compileDesign>[1],
  provenance: ScientificProvenance,
): Checked<BethesdaScientificPlan> {
  const compiled = compileDesign(raw, context);
  if (!compiled.ok) return compiled;
  const d = compiled.value.validated.definition,
    metric = METRICS[d.primary_metric];
  return {
    ok: true,
    value: {
      backend: "bethesda",
      compiled: compiled.value,
      ir: {
        schema: SCIENTIFIC_IR,
        domain: "urban-simulation",
        backend: "bethesda",
        backend_version: d.versions.sim,
        question: d.question,
        hypothesis: d.hypothesis,
        observables: d.metrics.map((id) => ({
          id,
          unit: METRICS[id].unit,
          description: METRICS[id].aggregate,
        })),
        independent_variables: [`${d.scenario.id} at ${d.scenario.location}`],
        dependent_variables: [d.primary_metric],
        controls: [
          "native matched-seed no-event arm",
          "native identical pre-intervention state guard",
        ],
        parameter_constraints: [
          "native closed discovery vocabulary",
          "native compiler/envelope checks",
          "native preregistration, preflight and deterministic replay",
        ],
        resource_budget: {
          execution_steps: 2 * d.seeds.length * (d.warmup_ticks + d.window_ticks),
          replay_steps: 2 * d.seeds.length * (d.warmup_ticks + d.window_ticks),
          max_samples: 2 * d.seeds.length * (1 + d.window_ticks / d.sample_interval),
        },
        statistical_analysis: {
          method: "Native paired seed descriptive means and frozen rain-criteria/v1",
          independent_replicates: d.seeds.length,
          uncertainty: "Small seed sample; descriptive, no significance test",
        },
        falsification: {
          metric: "primary_delta_mean",
          op: d.expected_direction === "increase" ? "<=" : ">=",
          value: 0,
          unit: metric.unit,
        },
        provenance: structuredClone(provenance),
        limitations: [...d.limitations],
      },
    },
  };
}
