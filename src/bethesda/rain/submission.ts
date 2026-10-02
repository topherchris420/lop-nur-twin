/**
 * Returning measurements to R.A.I.N., in R.A.I.N.'s own contracts.
 *
 * james_library registers experiments that run in other repositories as
 * `runner: {kind: "external"}` and admits their runs as
 * `rain-experiment-submission/v1` documents (EXPERIMENTS.md, "Connect another
 * repository"). A submission deliberately has no status or verdict: R.A.I.N.'s
 * host evaluates its pre-registered criteria itself, and its run record is
 * R.A.I.N.'s result. This module writes:
 *
 *   - the pre-registration draft — the fields `experiment create --from`
 *     accepts (R.A.I.N. assigns the id, version and creation time);
 *   - the submission for one recorded run, referencing the run artifact by
 *     SHA-256 (R.A.I.N. never fetches it);
 *   - an admission bundle holding both, for `tools/rain-bridge/admit.py`
 *     when no live bridge was available.
 *
 * It refuses rather than fabricates: R.A.I.N.'s submission contract requires
 * the producing commit, so a build that does not know its own revision cannot
 * produce one.
 */
import { REPLAY_SCHEMA, SIM_VERSION } from "../simulation";
import {
  LAB_REPOSITORY,
  METRICS,
  METRIC_IDS,
  METRIC_LABELS,
  OPERATOR,
  RAIN_BETHESDA_SCHEMA,
  RAIN_EXPERIMENT_ID,
  RAIN_SUBMISSION_SCHEMA,
  type MetricId,
} from "./contracts";
import type { ExperimentDefinition } from "./experiments";
import { runArtifactSha256, runArtifactText, type ExperimentRecord } from "./record";
import { utf8Length, type Checked } from "./validation";

export const ADMISSION_BUNDLE_SCHEMA = "rain-bethesda-admission-bundle/v1" as const;

function parameters(d: ExperimentDefinition, experimentId: string, sha: string) {
  return {
    bethesda_experiment_id: experimentId,
    bethesda_definition_sha256: sha,
    scenario: d.scenario.id,
    location: d.scenario.location,
    place: d.scenario.place,
    telemetry: d.scenario.telemetry,
    seeds: [...d.seeds],
    warmup_ticks: d.warmup_ticks,
    window_ticks: d.window_ticks,
    sample_interval_ticks: d.sample_interval,
    population: { ...d.population },
    primary_metric: d.primary_metric,
    expected_direction: d.expected_direction,
    minimum_effect: d.minimum_effect,
  };
}

/** Every metric the submission reports, declared as R.A.I.N. requires. */
function declaredMetrics(d: ExperimentDefinition) {
  const primary = METRICS[d.primary_metric];
  const label = METRIC_LABELS[d.primary_metric].toLowerCase();
  const rows: { name: string; unit: string; description: string; deterministic: true }[] =
    [
      {
        name: "seeds_completed",
        unit: "count",
        description:
          "Seeds whose control and treatment arms both ran to the end of the window.",
        deterministic: true,
      },
      {
        name: "matched_t0_seeds",
        unit: "count",
        description:
          "Seeds whose control and treatment arms had identical simulator state hashes and cohorts when the intervention was applied.",
        deterministic: true,
      },
      {
        name: "cohort_min",
        unit: "count",
        description: "Smallest catchment cohort across seeds.",
        deterministic: true,
      },
      {
        name: "primary_delta_mean",
        unit: primary.unit,
        description: `Mean over seeds of treatment minus control ${label}.`,
        deterministic: true,
      },
      {
        name: "primary_delta_min",
        unit: primary.unit,
        description: `Smallest per-seed treatment minus control ${label}.`,
        deterministic: true,
      },
      {
        name: "primary_delta_max",
        unit: primary.unit,
        description: `Largest per-seed treatment minus control ${label}.`,
        deterministic: true,
      },
      {
        name: "seeds_in_expected_direction",
        unit: "count",
        description: `Seeds whose difference has the pre-registered sign (${d.expected_direction}).`,
        deterministic: true,
      },
      {
        name: "control_primary_mean",
        unit: primary.unit,
        description: `Mean over seeds of the control arms' ${label}.`,
        deterministic: true,
      },
      {
        name: "treatment_primary_mean",
        unit: primary.unit,
        description: `Mean over seeds of the treatment arms' ${label}.`,
        deterministic: true,
      },
    ];
  for (const id of METRIC_IDS as readonly MetricId[])
    rows.push({
      name: `delta_mean_${id}`,
      unit: METRICS[id].unit,
      description: `Mean over seeds of treatment minus control: ${METRICS[id].description}`,
      deterministic: true,
    });
  return rows;
}

/** The `create --from` draft. R.A.I.N. assigns the id, the version and `created_at`. */
export function rainDefinitionDraft(
  d: ExperimentDefinition,
  experimentId: string,
  definitionSha256: string,
  createdBy: string,
) {
  if (!OPERATOR.test(createdBy)) throw new Error("created_by must be a role label");
  return {
    title:
      `Bethesda simulation: ${d.scenario.label} at ${d.scenario.place} — ${METRIC_LABELS[d.primary_metric]}`.slice(
        0,
        200,
      ),
    question: d.question,
    hypothesis: d.hypothesis,
    rationale:
      "Proposed in the R.A.I.N. Lab inside the Bethesda simulation and executed by lop-nur-twin's deterministic city simulator as matched-seed control and treatment arms. The criteria are the lab's fixed rain-criteria/v1 template for the pre-registered metric, direction and minimum effect.",
    subsystem: {
      repository: LAB_REPOSITORY,
      component: `Bethesda city simulation (${SIM_VERSION})`,
      paths: [],
    },
    created_by: createdBy,
    evidence_class: "simulated",
    runner: {
      kind: "external",
      repository: LAB_REPOSITORY,
      adapter: `${RAIN_BETHESDA_SCHEMA} (${RAIN_SUBMISSION_SCHEMA})`,
    },
    seed: null,
    parameters: parameters(d, experimentId, definitionSha256),
    procedure: [
      `For each seed (${d.seeds.join(", ")}), build two simulators with the same population and seed and set the full-rate focus on ${d.scenario.place}.`,
      `Warm both up for ${d.warmup_ticks} ticks; record each arm's state hash and the outdoor pedestrians within ${d.radii.catchment} m (the cohort).`,
      `Inject “${d.scenario.telemetry}” (${d.scenario.event.kind}, compiled by the city's scenario compiler) into the treatment arm only.`,
      `Run both arms ${d.window_ticks} more ticks, recording a bethesda-world-observation/v1 packet every ${d.sample_interval} ticks from simulator state.`,
      "Report the per-seed treatment minus control differences; R.A.I.N. evaluates the pre-registered criteria.",
    ],
    variables: {
      independent: [
        `${d.scenario.label} injected at tick ${d.warmup_ticks} (treatment) or not (control)`,
      ],
      dependent: [METRIC_LABELS[d.primary_metric]],
      controls: [
        "same seed and population in both arms",
        "same full-rate focus command at tick 0",
        "same simulator, map, terrain and transit versions",
      ],
    },
    metrics: declaredMetrics(d),
    criteria: {
      guards: d.criteria.guards.map(({ id, metric, op, value, note }) => ({
        id,
        metric,
        op,
        value,
        note,
      })),
      success: d.criteria.success.map(({ id, metric, op, value, note }) => ({
        id,
        metric,
        op,
        value,
        note,
      })),
      failure: d.criteria.failure.map(({ id, metric, op, value, note }) => ({
        id,
        metric,
        op,
        value,
        note,
      })),
    },
    dependencies: [],
    data_policy: { classification: "public", store_artifacts: false },
    limitations: [...d.limitations],
  };
}

export const runArtifactName = (record: ExperimentRecord) =>
  `bethesda-run-${record.run_id}.json`;

/** One run, as R.A.I.N.'s external-run contract describes it. No status, no verdict. */
export function rainSubmission(
  record: ExperimentRecord,
  rain: { experimentId: string; experimentVersion: number },
): Checked<Record<string, unknown>> {
  const errors: string[] = [];
  const d = record.definition;
  if (!d || !record.definition_sha256 || !record.experiment_id)
    errors.push("nothing ran: a rejected proposal has no submission");
  if (!RAIN_EXPERIMENT_ID.test(rain.experimentId))
    errors.push("R.A.I.N. experiment id is malformed (expected V3D-EXP-NNNN)");
  const commit = record.provenance.lop_nur_twin_commit;
  if (!commit)
    errors.push(
      "this build does not know its lop-nur-twin commit; R.A.I.N.'s submission contract requires the producing commit, and it is not invented",
    );
  if (!record.run && !record.error)
    errors.push("the run has neither measurements nor an error");
  if (errors.length || !d) return { ok: false, errors };
  const started =
    record.run?.started_at ?? record.lifecycle.find((t) => t.state === "RUNNING")?.at;
  const finished = record.run?.finished_at ?? record.lifecycle.at(-1)?.at;
  const prereg = record.rain_preregistration;
  const authorized = record.authorization?.authorized_at ?? "unknown";
  const artifact = runArtifactText(record);
  const submission: Record<string, unknown> = {
    schema_version: RAIN_SUBMISSION_SCHEMA,
    experiment_id: rain.experimentId,
    experiment_version: rain.experimentVersion,
    evidence_class: "simulated",
    started_at: started,
    finished_at: finished,
    seed: null,
    parameters: parameters(d, record.experiment_id!, record.definition_sha256!),
    inputs: {
      bethesda_run_id: record.run_id,
      sim_version: SIM_VERSION,
      replay_schema: REPLAY_SCHEMA,
      map_sha256: record.provenance.bethesda_map_sha256,
      streetscape_sha256: record.provenance.streetscape_sha256,
      terrain_sha256: record.provenance.terrain_sha256,
      authorization_sha256: record.authorization?.authorization_sha256 ?? null,
      authorization: "local operator attestation; not authenticated identity",
    },
    measurements: record.run ? { ...record.run.measurements } : {},
    series: record.run ? { ...record.run.series } : {},
    observations: (record.run?.per_seed ?? []).map(
      (s) =>
        `Seed ${s.seed}: control ${s.control ?? "not measured"}, treatment ${s.treatment ?? "not measured"}, difference ${s.delta ?? "not computable"} ${METRICS[d.primary_metric].unit}; arms ${s.t0_matched ? "identical" : "NOT identical"} at the intervention; cohort ${s.cohort}.`,
    ),
    limitations: [
      ...d.limitations,
      prereg
        ? `Pre-registered with R.A.I.N. as ${prereg.experiment_id} at ${prereg.created_at}, before the run.`
        : `Not pre-registered with R.A.I.N. before the run. The Bethesda definition was frozen and authorized at ${authorized}; R.A.I.N. cannot verify that earlier freeze.`,
    ],
    artifacts: [
      {
        name: runArtifactName(record),
        sha256: runArtifactSha256(record),
        bytes: utf8Length(artifact),
        kind: "replay",
      },
    ],
    models:
      record.provenance.model !== null
        ? [
            {
              role: "proposer",
              name: record.provenance.model,
              provider: "R.A.I.N.",
              calls: 1,
            },
          ]
        : [],
    provenance: {
      producer: "lop-nur-twin Bethesda R.A.I.N. Lab",
      repository: LAB_REPOSITORY,
      commit,
      ...(record.provenance.lop_nur_twin_dirty === null
        ? {}
        : { dirty: record.provenance.lop_nur_twin_dirty }),
      environment: { contract: RAIN_BETHESDA_SCHEMA, sim_version: SIM_VERSION },
    },
  };
  if (record.error)
    submission.error = {
      stage: record.error.stage.slice(0, 64),
      type: record.error.type.slice(0, 128),
      message: record.error.message.slice(0, 2000),
    };
  return { ok: true, value: submission };
}

/** Draft plus submission template, for admitting a run without a live bridge. */
export function admissionBundle(record: ExperimentRecord, createdBy: string) {
  if (!record.definition || !record.definition_sha256 || !record.experiment_id)
    return {
      ok: false as const,
      errors: ["nothing ran: a rejected proposal has no submission"],
    };
  const submission = rainSubmission(record, {
    experimentId: "V3D-EXP-0000",
    experimentVersion: 1,
  });
  if (!submission.ok) return submission;
  return {
    ok: true as const,
    value: {
      schema: ADMISSION_BUNDLE_SCHEMA,
      note: "Admit with: python tools/rain-bridge/admit.py <this file> --library <james_library checkout> --registry <registry directory>. The helper registers the draft (R.A.I.N. assigns the id), sets that id in the submission and records it; R.A.I.N. evaluates the criteria.",
      draft: rainDefinitionDraft(
        record.definition,
        record.experiment_id,
        record.definition_sha256,
        createdBy,
      ),
      submission: { ...submission.value, experiment_id: null },
    },
  };
}
