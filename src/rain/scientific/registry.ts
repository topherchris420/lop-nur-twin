/** Existing registry adapter: no filesystem, allocation ledger or evaluation implementation here. */
import type { Registry, Json } from "../experiments/registry.js";
import { assembleDefinition } from "../experiments/registry.js";
import { recordSubmission, type RecordedBy } from "../experiments/runner.js";
import { canonicalJson, sha256, sha256Json } from "../sha256.js";
import { verifyNumericalPlan, type NumericalPlan } from "./compiler.js";
import { verifyNumericalRecord, type NumericalRecord } from "./numerical.js";
import type { NumericalPreregistration } from "./contracts.js";
export type { NumericalPreregistration } from "./contracts.js";
export function numericalRegistryDraft(plan: NumericalPlan): Json {
  const errors = verifyNumericalPlan(plan);
  if (errors.length) throw new Error(errors.join("; "));
  const units: Record<string, string> = {
    arms_completed: "count",
    reference_max_error_m: "m",
    reference_max_velocity_error_m_per_s: "m/s",
    rms_control_m: "m",
    rms_treatment_m: "m",
    rms_displacement_delta_m: "m",
    execution_steps: "count",
    retained_samples: "count",
  };
  return {
    title: "Matched driven damped oscillator",
    question: plan.ir.question,
    hypothesis: plan.ir.hypothesis,
    rationale:
      "Original bounded numerical test with independent analytic reference verification.",
    subsystem: {
      repository: "topherchris420/lop-nur-twin",
      component: "rain-numerical-physics",
      paths: [],
    },
    created_by: "R.A.I.N.Host",
    evidence_class: "simulated",
    runner: {
      kind: "external",
      repository: "topherchris420/lop-nur-twin",
      adapter: "rain-driven-damped-oscillator/v1",
    },
    seed: null,
    parameters: { scientific_plan: structuredClone(plan) },
    procedure: [
      "Review and authorize the exact scientific plan digest.",
      "Run matched zero-force and driven arms with fixed-step RK4.",
      "Check every step against an independent closed-form solution.",
      "Recompile and deterministically replay retained samples and measurements before registry admission.",
    ],
    variables: {
      independent: plan.ir.independent_variables,
      dependent: plan.ir.dependent_variables,
      controls: plan.ir.controls,
    },
    metrics: Object.entries(units).map(([name, unit]) => ({
      name,
      unit,
      description: name.replaceAll("_", " "),
      deterministic: true,
    })),
    criteria: plan.criteria,
    dependencies: [],
    data_policy: { classification: "internal", store_artifacts: false },
    limitations: [
      ...plan.ir.limitations,
      "Time-series registry statistics summarize correlated trajectory points, not independent experimental replicates.",
    ],
  };
}
export function preregisterNumerical(
  registry: Registry,
  plan: NumericalPlan,
): NumericalPreregistration {
  const definition = registry.create(numericalRegistryDraft(plan));
  return {
    experiment_id: definition.experiment_id as string,
    registry_definition_sha256: sha256Json(definition),
    plan_sha256: plan.definition_sha256,
  };
}
export function verifyNumericalPreregistration(
  registry: Registry,
  plan: NumericalPlan,
  receipt: NumericalPreregistration,
): string[] {
  try {
    const stored = registry.loadDefinition(receipt.experiment_id);
    const expected = assembleDefinition(
      numericalRegistryDraft(plan),
      receipt.experiment_id,
      stored.created_at as string,
    );
    return receipt.plan_sha256 === plan.definition_sha256 &&
      receipt.registry_definition_sha256 === sha256Json(stored) &&
      canonicalJson(stored) === canonicalJson(expected)
      ? []
      : [
          "numerical registry snapshot does not bind the exact preregistered scientific plan",
        ];
  } catch {
    return ["numerical preregistration is unavailable or invalid"];
  }
}
/** Admit only independently replayed output against the exact registry snapshot. Registry decides verdict. */
export function admitNumericalRecord(
  registry: Registry,
  receipt: NumericalPreregistration,
  record: NumericalRecord,
  options: { commit: string | null; recordedBy?: RecordedBy },
): { registry_run: Json; replay: ReturnType<typeof verifyNumericalRecord> } {
  const replay = verifyNumericalRecord(record);
  const errors = [
    ...replay.errors,
    ...verifyNumericalPreregistration(registry, record.plan, receipt),
  ];
  if (errors.length || !replay.ok)
    throw new Error("Numerical admission refused: " + errors.join("; "));
  if (options.commit === null || !/^[a-f0-9]{7,64}$/.test(options.commit))
    throw new Error(
      "Numerical admission requires the actual producing commit; unknown provenance remains unadmitted",
    );
  const text = canonicalJson(record);
  const submission = {
    schema_version: "rain-experiment-submission/v1",
    experiment_id: receipt.experiment_id,
    experiment_version: 1,
    evidence_class: "simulated",
    started_at: record.started_at,
    finished_at: record.finished_at,
    seed: null,
    parameters: { scientific_plan_sha256: record.plan.definition_sha256 },
    inputs: {
      scientific_plan: record.plan,
      authorization: record.authorization,
      replay_sha256: replay.replay_sha256,
    },
    measurements: record.result.measurements,
    series: Object.fromEntries(
      record.result.arms.map((a) => [
        `${a.arm}_displacement_m`,
        a.samples.map((s) => s.displacement_m),
      ]),
    ),
    observations: [
      "Both arms are outputs of the original numerical simulator; no physical measurements were taken.",
      `Independent same-runtime replay: ${replay.replay_sha256}`,
    ],
    limitations: [
      "One deterministic matched initial condition; temporal points are correlated.",
    ],
    artifacts: [
      {
        name: "numerical-record.json",
        sha256: sha256(text),
        bytes: new TextEncoder().encode(text).length,
        kind: "numerical-simulation-record",
      },
    ],
    models: [],
    provenance: {
      producer: "R.A.I.N.NumericalHost",
      repository: "topherchris420/lop-nur-twin",
      commit: options.commit,
      numerical_record_sha256: record.sha256,
      numerical_run_id: record.run_id,
    },
    ...(record.result.error
      ? {
          error: {
            stage: "numerical-execution",
            type: "IncompleteNumericalRun",
            message: record.result.error,
          },
        }
      : {}),
  };
  const run = recordSubmission(registry, receipt.experiment_id, submission, {
    recordedBy: options.recordedBy,
  });
  if (
    run.status !== record.result.status ||
    run.hypothesis_verdict !== record.result.verdict
  )
    throw new Error(
      "Native registry evaluation differs from the numerical preregistered criteria",
    );
  return { registry_run: run, replay };
}
