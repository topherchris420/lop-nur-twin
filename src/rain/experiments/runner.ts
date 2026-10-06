/**
 * Admission of externally executed runs: validate → load the pre-registered
 * definition → evaluate → write the run record.
 *
 * A port of the external-submission half of R.A.I.N.'s `experiments/runner.py`
 * (james_library, MIT). Producers submit measurements only; the host computes
 * statistics and applies the pre-registered criteria (`evaluate.ts`). A
 * declared execution error becomes an `error` run: a failed execution is
 * recorded, not hidden, and is never confused with a failed hypothesis. The
 * builtin runners that executed R.A.I.N.'s own experiments in-process were
 * not consolidated: here the Bethesda simulator is the external runner, and
 * nothing a submission references is opened or fetched.
 *
 * Server only.
 */
import { evaluate, type Criterion, type Evaluation } from "./evaluate.js";
import { environment, gitState, redact, type GitState } from "./provenance.js";
import { type Registry, utcNow, type Json } from "./registry.js";
import { ExperimentError, RUN_SCHEMA, sha256Json, submissionErrors } from "./schema.js";
import { summarize, type Summary } from "./stats.js";

const CLASS_NOTES: Record<string, string> = {
  measured: "Measured on this code and data; the result is bounded by the listed limitations.",
  simulated: "Simulated data: this characterizes the simulator and analysis pipeline, not a physical system.",
  model_inferred: "Values are model output, not empirical measurement; treat as inference.",
};

export interface RunOutput {
  measurements: Record<string, number | null>;
  series: Record<string, number[]>;
  inputs: Json;
  observations: string[];
  limitations: string[];
  models: Json[];
}

function statistics(series: Record<string, number[]>, models: Json[]): Record<string, Summary> {
  const stats: Record<string, Summary> = {};
  for (const name of Object.keys(series).sort()) stats[name] = summarize(series[name]!);
  for (const model of models) {
    const latencies = model.latency_ms;
    if (Array.isArray(latencies) && latencies.length)
      stats[`model.${String(model.role ?? "model")}.latency_ms`] = summarize(latencies as number[]);
  }
  return stats;
}

function interpretation(evidenceClass: string, evaluation: Evaluation | null, error: Json | null): string {
  if (error !== null)
    return `Execution error at stage '${error.stage}' (${error.type}). The hypothesis was not evaluated; this is not a failed hypothesis.`;
  return `${evaluation!.summary} ${CLASS_NOTES[evidenceClass]}`;
}

/** Compare a replay with its source run; `verify` recomputes this from the stored records. */
export function reproductionReport(definition: Json, source: Json, record: Json): Json {
  const mismatches: string[] = [];
  const outcomeMatches = source.status === record.status;
  if (!outcomeMatches) mismatches.push(`status: ${source.status} -> ${record.status}`);
  let metricsMatch = true;
  for (const metric of definition.metrics as { name: string; deterministic: boolean }[]) {
    const before = (source.measurements as Json)[metric.name],
      after = (record.measurements as Json)[metric.name];
    if (metric.deterministic && JSON.stringify(before) !== JSON.stringify(after)) {
      metricsMatch = false;
      mismatches.push(`${metric.name}: ${before} -> ${after}`);
    }
  }
  if (source.definition_sha256 !== record.definition_sha256)
    mismatches.push(
      `definition: v${(source.definition as Json).experiment_version} -> v${definition.experiment_version}`,
    );
  return {
    source_run: source.run_id,
    outcome_matches: outcomeMatches,
    deterministic_metrics_match: metricsMatch,
    mismatches,
  };
}

/** Fill measurements, statistics and the deterministic evaluation (no I/O). */
export function complete(record: Json, definition: Json, output: RunOutput | null, error: Json | null, finishedAt: string): Json {
  record.finished_at = finishedAt;
  if (output !== null) {
    record.measurements = Object.fromEntries(Object.keys(output.measurements).sort().map((k) => [k, output.measurements[k]!]));
    record.series = Object.fromEntries(Object.keys(output.series).sort().map((k) => [k, output.series[k]!]));
    record.inputs = redact(output.inputs);
    record.observations = redact([...output.observations]);
    record.limitations = [...(definition.limitations as string[]), ...redact([...output.limitations])];
    record.models = redact(output.models);
    record.statistics = statistics(record.series as Record<string, number[]>, record.models as Json[]);
  }
  if (error === null) {
    const result = evaluate(
      definition.criteria as { guards: Criterion[]; success: Criterion[]; failure: Criterion[] },
      record.measurements as Record<string, number | null>,
    );
    record.status = result.status;
    record.hypothesis_verdict = result.verdict;
    record.evaluation = result.evaluation;
  } else {
    record.status = "error";
    record.hypothesis_verdict = "not_evaluated";
    record.evaluation = null;
    record.error = error;
  }
  record.interpretation = {
    deterministic: interpretation(record.evidence_class as string, record.evaluation as Evaluation | null, (record.error as Json | null) ?? null),
    model: null,
  };
  return record;
}

function parseTime(value: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new ExperimentError(`Invalid timestamp ${JSON.stringify(value)}`);
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(value))
    throw new ExperimentError(`Timestamp ${JSON.stringify(value)} must include a timezone`);
  return ms;
}

export interface RecordedBy {
  git: GitState;
  environment: Record<string, string | number | null>;
}
/** Where a recording runtime looks for its own revision; registry data is excluded from the dirty check. */
export const recordedBy = (cwd: string, registry: Registry): RecordedBy => ({
  git: gitState(cwd, [registry.root]),
  environment: environment(),
});

/** Admit one externally executed run. Nothing referenced by it is opened or fetched. */
export function recordSubmission(
  registry: Registry,
  experimentId: string,
  submission: unknown,
  options: { recordedBy?: RecordedBy; now?: () => Date } = {},
): Json {
  const errors = submissionErrors(submission);
  if (errors.length) throw new ExperimentError("Invalid submission:\n  " + errors.join("\n  "));
  const s = submission as Json & {
    measurements: Record<string, number | null>;
    series: Record<string, number[]>;
    inputs: Json;
    observations: string[];
    limitations: string[];
    models: Json[];
    artifacts: Json[];
    provenance: Json;
  };
  const definition = registry.loadDefinition(experimentId);
  if ((definition.runner as Json).kind !== "external")
    throw new ExperimentError(`${experimentId} is a builtin experiment; the host runs it, it cannot be submitted`);
  if (s.experiment_id !== experimentId)
    throw new ExperimentError(`Submission is for ${s.experiment_id}, not ${experimentId}`);
  if (s.experiment_version !== definition.experiment_version)
    throw new ExperimentError(
      `Submission targets v${s.experiment_version}; ${experimentId} is v${definition.experiment_version}. Re-run against the current pre-registration.`,
    );
  if (s.evidence_class !== definition.evidence_class)
    throw new ExperimentError("Submission evidence class does not match the registered experiment");
  const submissionSha256 = sha256Json(submission);
  for (const existing of registry.runs(experimentId))
    if ((existing.provenance as Json | undefined)?.submission_sha256 === submissionSha256)
      throw new ExperimentError(`This submission is already recorded as ${existing.run_id}`);
  const started = parseTime(s.started_at as string),
    finished = parseTime(s.finished_at as string);
  if (finished < started) throw new ExperimentError("finished_at precedes started_at");

  const output: RunOutput = {
    measurements: s.measurements,
    series: s.series,
    inputs: s.inputs,
    observations: s.observations,
    limitations: s.limitations,
    models: s.models,
  };
  const now = options.now ?? (() => new Date());
  const { runId, runDir } = registry.beginRun(experimentId);
  const by = options.recordedBy ?? { git: gitState(process.cwd(), [registry.root]), environment: environment() };
  const record: Json = {
    schema_version: RUN_SCHEMA,
    experiment_id: experimentId,
    run_id: runId,
    kind: "external",
    reproduces: null,
    status: "running",
    hypothesis_verdict: "not_evaluated",
    evidence_class: definition.evidence_class,
    started_at: s.started_at,
    finished_at: null,
    duration_ms: null,
    seed: s.seed,
    parameters: redact(s.parameters),
    definition,
    definition_sha256: sha256Json(definition),
    inputs: {},
    measurements: {},
    series: {},
    statistics: {},
    evaluation: null,
    observations: [],
    interpretation: { deterministic: "", model: null },
    limitations: [],
    artifacts: s.artifacts.map((a) => ({
      name: a.name,
      sha256: a.sha256,
      bytes: a.bytes,
      kind: a.kind,
      stored: false,
      note: "external artifact; referenced by hash, never fetched",
      ...("uri" in a ? { uri: redact(a.uri) } : {}),
    })),
    models: [],
    reproduction: null,
    error: null,
    provenance: {
      source: "external_submission",
      submission_sha256: submissionSha256,
      producer: redact(s.provenance),
      recorded_by: by,
      recorded_at: utcNow(now()),
    },
  };
  const error = (s.error as Json | undefined) ?? null;
  complete(record, definition, output, error ? redact(error) : null, utcNow(now()));
  record.finished_at = s.finished_at;
  record.duration_ms = Math.round((finished - started) * 1000) / 1000;
  const modelInterpretation = s.model_interpretation as Json | undefined;
  if (modelInterpretation)
    // Kept apart from the deterministic reading and never used in evaluation.
    (record.interpretation as Json).model = { origin: "MODEL_INFERRED", ...redact(modelInterpretation) };
  registry.writeRun(runDir, record);
  return record;
}
