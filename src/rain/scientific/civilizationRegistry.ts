/** Registry adapter for civilization experiments. The registry evaluates; this file only drafts and submits. */
import type { Registry, Json } from "../experiments/registry.js";
import { assembleDefinition } from "../experiments/registry.js";
import { recordSubmission, type RecordedBy } from "../experiments/runner.js";
import { canonicalJson, sha256, sha256Json } from "../sha256.js";
import { verifyCivilizationPlan, verifyCivilizationRecord } from "./civilization.js";
import type { NoeterraEngine } from "./noeterraEngine.js";
import {
  CIVILIZATION_BACKEND,
  CIVILIZATION_METRICS,
  type CivilizationPlan,
  type CivilizationPreregistration,
  type CivilizationRecord,
} from "./contracts.js";

export function civilizationRegistryDraft(
  plan: CivilizationPlan,
  engine: NoeterraEngine,
): Json {
  const errors = verifyCivilizationPlan(plan, engine);
  if (errors.length) throw new Error(errors.join("; "));
  const primary = CIVILIZATION_METRICS.find((m) => m.id === plan.design.analysis.metric)!;
  const units: [string, string, string][] = [
    ["arms_completed", "count", "matched runs that completed"],
    [
      "determinism_check",
      "1 if reproduced",
      "an independent re-simulation reached every recorded state hash",
    ],
    ["seeds", "count", "matched seeds"],
    ["simulated_turns", "count", "seasons simulated across all runs"],
    ["control_mean", primary.unit, `mean ${primary.id} in the control arm`],
    ["treatment_mean", primary.unit, `mean ${primary.id} in the treatment arm`],
    [
      "mean_paired_delta",
      primary.unit,
      `treatment minus control ${primary.id}, averaged over seeds`,
    ],
    [
      "seeds_expected_direction",
      "count",
      "seeds whose difference lies in the expected direction",
    ],
    ["seeds_opposite", "count", "seeds whose difference lies in the opposite direction"],
    ["seeds_unchanged", "count", "seeds with no difference"],
    ...CIVILIZATION_METRICS.map((m): [string, string, string] => [
      `delta_${m.id}`,
      m.unit,
      `mean paired change in ${m.description}`,
    ]),
  ];
  return {
    title: "Matched-seed civilization simulation",
    question: plan.ir.question,
    hypothesis: plan.ir.hypothesis,
    rationale:
      "Bounded experiment on the Noeterra civilization simulator with matched seeds and independent re-simulation.",
    subsystem: {
      repository: "topherchris420/lop-nur-twin",
      component: "noeterra-civilization",
      paths: [],
    },
    created_by: "R.A.I.N.Host",
    evidence_class: "simulated",
    runner: {
      kind: "external",
      repository: "topherchris420/lop-nur-twin",
      adapter: CIVILIZATION_BACKEND,
    },
    seed: null,
    parameters: { scientific_plan: structuredClone(plan) },
    procedure: [
      "Review and authorize the exact civilization plan digest.",
      "Run every seed twice, with and without the treatment, under rule-based agents.",
      "Re-simulate every run independently and require each recorded state hash.",
      "Recompile and re-simulate again before registry admission.",
    ],
    variables: {
      independent: plan.ir.independent_variables,
      dependent: plan.ir.dependent_variables,
      controls: plan.ir.controls,
    },
    metrics: units.map(([name, unit, description]) => ({
      name,
      unit,
      description,
      deterministic: true,
    })),
    criteria: plan.criteria,
    dependencies: [],
    data_policy: { classification: "internal", store_artifacts: false },
    limitations: [
      ...plan.ir.limitations,
      "Seeds are replicates of one model, not samples of historical societies.",
    ],
  };
}

export function preregisterCivilization(
  registry: Registry,
  plan: CivilizationPlan,
  engine: NoeterraEngine,
): CivilizationPreregistration {
  const definition = registry.create(civilizationRegistryDraft(plan, engine));
  return {
    experiment_id: definition.experiment_id as string,
    registry_definition_sha256: sha256Json(definition),
    plan_sha256: plan.definition_sha256,
  };
}

export function verifyCivilizationPreregistration(
  registry: Registry,
  plan: CivilizationPlan,
  receipt: CivilizationPreregistration,
  engine: NoeterraEngine,
): string[] {
  try {
    const stored = registry.loadDefinition(receipt.experiment_id);
    const expected = assembleDefinition(
      civilizationRegistryDraft(plan, engine),
      receipt.experiment_id,
      stored.created_at as string,
    );
    return receipt.plan_sha256 === plan.definition_sha256 &&
      receipt.registry_definition_sha256 === sha256Json(stored) &&
      canonicalJson(stored) === canonicalJson(expected)
      ? []
      : ["civilization registry snapshot does not bind the exact preregistered plan"];
  } catch {
    return ["civilization preregistration is unavailable or invalid"];
  }
}

/**
 * Admits an independently re-simulated record against its exact preregistration.
 * Failed and inconclusive results are admitted like any other: a negative
 * result is a result. The registry decides the verdict.
 */
export function admitCivilizationRecord(
  registry: Registry,
  receipt: CivilizationPreregistration,
  record: CivilizationRecord,
  engine: NoeterraEngine,
  options: { commit: string | null; recordedBy?: RecordedBy },
): { registry_run: Json; replay: ReturnType<typeof verifyCivilizationRecord> } {
  const replay = verifyCivilizationRecord(record, engine);
  const errors = [
    ...replay.errors,
    ...verifyCivilizationPreregistration(registry, record.plan, receipt, engine),
  ];
  if (errors.length || !replay.ok)
    throw new Error("Civilization admission refused: " + errors.join("; "));
  if (options.commit === null || !/^[a-f0-9]{7,64}$/.test(options.commit))
    throw new Error(
      "Civilization admission requires the actual producing commit; unknown provenance remains unadmitted",
    );
  const text = canonicalJson(record);
  const metric = record.plan.design.analysis.metric;
  const seeds = record.plan.noeterra_plan.seeds;
  // A run that did not happen has no measurement: an arm missing any seed (an
  // engine failure, say) contributes no series rather than a row of zeros.
  const per = (arm: string): [string, number[]][] => {
    const values = seeds.map(
      (s) =>
        record.result.experiment?.runs.find((r) => r.arm === arm && r.seed === s)
          ?.metrics[metric],
    );
    return values.every((v): v is number => typeof v === "number")
      ? [[`${arm}_primary`, values]]
      : [];
  };
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
      final_state_hashes:
        record.result.experiment?.runs.map((r) => `${r.arm}/${r.seed}/${r.final_hash}`) ??
        [],
    },
    measurements: record.result.measurements,
    series: Object.fromEntries([...per("control"), ...per("treatment")]),
    observations: [
      "Every arm is an output of the Noeterra civilization simulator; the scenario is illustrative and no historical observation was made.",
      `Independent re-simulation reproduced every state hash: ${replay.replay_sha256}`,
    ],
    limitations: [
      "Matched seeds of one illustrative model; descriptive statistics only.",
    ],
    artifacts: [
      {
        name: "civilization-record.json",
        sha256: sha256(text),
        bytes: new TextEncoder().encode(text).length,
        kind: "civilization-simulation-record",
      },
    ],
    models: [],
    provenance: {
      producer: "R.A.I.N.CivilizationHost",
      repository: "topherchris420/lop-nur-twin",
      commit: options.commit,
      civilization_record_sha256: record.sha256,
      civilization_run_id: record.run_id,
      engine: record.plan.engine,
    },
    ...(record.result.error
      ? {
          error: {
            stage: "civilization-execution",
            type: "IncompleteCivilizationRun",
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
      "Native registry evaluation differs from the civilization preregistered criteria",
    );
  return { registry_run: run, replay };
}
