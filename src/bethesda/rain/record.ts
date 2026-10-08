/**
 * The experiment record (`RECORD_SCHEMA`): one experiment, everything it took.
 *
 * A record keeps what was proposed, which deterministic checks ran and how
 * they came out, what a human approved — the definition itself, or a charter
 * that lists its design — what actually ran (every arm's recorded commands
 * and hashes), what was observed, what the criteria decided, what remains
 * unresolved, both repositories' revisions — and, when
 * R.A.I.N. admitted the run, R.A.I.N.'s own run record beside the host's.
 * Rejected, failed and inconclusive experiments are records too.
 *
 * The **run artifact** is the record without R.A.I.N.'s admission and without
 * its own digest: it is fixed the moment the run ends, so its SHA-256 can be
 * reported to R.A.I.N. before R.A.I.N. answers. The record digest covers the
 * rest.
 */
import {
  type RECORD_SCHEMA,
  type Admission,
  type ExperimentProposal,
  type Preregistration,
  type RainRunStatus,
  type RainCompletedStatus,
  type RainVerdict,
  type Evaluation,
} from "./contracts";
import { canonicalJson, sha256, sha256Json } from "../../rain/sha256";
import { validateAdmission, validatePreregistration } from "./validation";
import type { Authorization } from "./authorization";
import type { StandingAuthority } from "./standing";
import type { CheckResult, ExperimentDefinition } from "./experiments";
import type { LifecycleState, Transition } from "./lifecycle";
import type { Provenance } from "./provenance";
import type { ArmRecord, SeedResult } from "./runner";

export interface RunSection {
  started_at: string;
  finished_at: string;
  arms: ArmRecord[];
  per_seed: SeedResult[];
  measurements: Record<string, number | null>;
  series: Record<string, number[]>;
  evaluation: Evaluation;
  status: RainCompletedStatus;
  verdict: RainVerdict;
}
export interface Outcome {
  state: Extract<LifecycleState, "COMPLETED" | "INCONCLUSIVE" | "FAILED" | "REJECTED">;
  /** R.A.I.N.'s run vocabulary; null for a rejection, which never ran. */
  rain_status: RainRunStatus | null;
  verdict: RainVerdict;
  summary: string;
  /** What the record does not settle. */
  unresolved: string[];
}
export interface ReproductionReport {
  source_run: string;
  outcome_matches: boolean;
  deterministic_metrics_match: boolean;
  mismatches: string[];
}
export interface ExperimentRecord {
  schema: typeof RECORD_SCHEMA;
  run_id: string;
  experiment_id: string | null;
  kind: "run" | "reproduction" | "rejection";
  reproduces: string | null;
  lifecycle: Transition[];
  outcome: Outcome;
  proposal: ExperimentProposal | null;
  /** A proposal that failed the shape check, kept as bounded text for the audit. */
  rejected_input: string | null;
  validation: CheckResult[];
  definition: ExperimentDefinition | null;
  definition_sha256: string | null;
  /** A person's authorization of this exact definition. */
  authorization: Authorization | null;
  /**
   * Or, for a run R.A.I.N.'s autonomous researcher proposed: the charter a
   * person authorized and the autonomy policy's admission of this definition
   * under it. A run carries exactly one of the two.
   */
  standing: StandingAuthority | null;
  rain_preregistration: Preregistration | null;
  run: RunSection | null;
  error: { stage: string; type: string; message: string } | null;
  reproduction: ReproductionReport | null;
  rain_admission: Admission | null;
  provenance: Provenance;
  record_sha256: string;
}
export type RecordBody = Omit<ExperimentRecord, "record_sha256">;

export function runArtifactText(record: RecordBody | ExperimentRecord): string {
  const { rain_admission: _admission, ...rest } = record;
  const body = { ...rest } as Partial<ExperimentRecord>;
  delete body.record_sha256;
  return canonicalJson(body);
}
export const runArtifactSha256 = (record: RecordBody | ExperimentRecord) =>
  sha256(runArtifactText(record));

export function seal(body: RecordBody): ExperimentRecord {
  return { ...body, record_sha256: sha256Json(body) };
}
export function recordDigestOK(record: ExperimentRecord): boolean {
  const { record_sha256, ...body } = record;
  try {
    return sha256Json(body) === record_sha256;
  } catch {
    return false;
  }
}

/** R.A.I.N.'s answer is attached; the run artifact, and so its digest, do not change. */
export function withAdmission(record: ExperimentRecord, admission: Admission) {
  const { record_sha256: _old, ...body } = record;
  return seal({ ...body, rain_admission: admission });
}

/** Unresolved questions, derived from the outcome. Nothing is resolved by saying so. */
export function unresolvedFor(
  state: Outcome["state"],
  verdict: RainVerdict,
  seeds: number,
): string[] {
  const out = [
    "Whether the same pattern holds in Bethesda: the simulator's agents follow illustrative rules, so a simulated result says nothing about real crowds.",
  ];
  if (state === "COMPLETED" && verdict === "supported")
    out.push(
      "Whether the effect survives other seeds, populations or event intensities — only the pre-registered conditions were run.",
    );
  if (state === "COMPLETED" && verdict === "not_supported")
    out.push(
      "Why the simulator moved the other way, or not at all: inspect the event's declared effects and the arms' observations before revising the hypothesis.",
    );
  if (state === "INCONCLUSIVE")
    out.push(
      "What a decisive test would need: a guard was unmet or the result fell between the success and failure thresholds.",
    );
  if (state === "FAILED")
    out.push(
      "Everything: the run did not complete and the hypothesis was not evaluated.",
    );
  if (state === "REJECTED") out.push("Everything: nothing ran.");
  if (seeds && seeds < 10)
    out.push(`Sampling variation: ${seeds} seed(s) is descriptive only.`);
  return out;
}

/** Mirrors R.A.I.N.'s `reproduction_report`: status and every deterministic metric. */
export function reproductionReport(
  source: ExperimentRecord,
  current: RunSection,
): ReproductionReport {
  const mismatches: string[] = [];
  const before = source.run;
  if (!before)
    return {
      source_run: source.run_id,
      outcome_matches: false,
      deterministic_metrics_match: false,
      mismatches: ["the source run has no measurements"],
    };
  const outcome = before.status === current.status;
  if (!outcome) mismatches.push(`status: ${before.status} -> ${current.status}`);
  let metrics = true;
  for (const key of Object.keys(before.measurements).sort())
    if (before.measurements[key] !== current.measurements[key]) {
      metrics = false;
      mismatches.push(
        `${key}: ${before.measurements[key]} -> ${current.measurements[key]}`,
      );
    }
  for (const arm of before.arms) {
    const now = current.arms.find((a) => a.id === arm.id);
    if (!now || now.final_hash !== arm.final_hash) {
      metrics = false;
      mismatches.push(`${arm.id}: final state differs`);
    }
  }
  return {
    source_run: source.run_id,
    outcome_matches: outcome,
    deterministic_metrics_match: metrics,
    mismatches: mismatches.slice(0, 40),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keysExactly = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => k in o);

/**
 * What a record carries beside the run that replay cannot re-simulate: the
 * registry's pre-registration, R.A.I.N.'s admission, a reproduction report and
 * an execution error. Each must be the shape the lab writes and bound to this
 * record — an admission to the pre-registration it answers, a reproduction
 * report to the run it reproduces — or the record is refused. Nothing here
 * trusts the record: a field of the wrong type is an error, never a throw.
 */
export function attachmentErrors(raw: unknown): string[] {
  if (!isObject(raw)) return ["not a record"];
  const r = raw as Partial<Record<keyof ExperimentRecord, unknown>>;
  const errors: string[] = [];
  const prereg = r.rain_preregistration;
  if (prereg !== null) {
    if (!isObject(prereg) || "certificate" in prereg)
      errors.push(
        "the pre-registration is not the registry's answer as a record keeps it",
      );
    else {
      // A record never holds the certificate; the rest of the answer must stand.
      const v = validatePreregistration(
        { ...prereg, certificate: "0".repeat(64) },
        { requestId: String(prereg.request_id) },
      );
      if (!v.ok) errors.push("the pre-registration is malformed: " + v.errors[0]);
    }
  }
  const admission = r.rain_admission;
  if (admission !== null) {
    if (!isObject(admission)) errors.push("R.A.I.N.'s admission is malformed");
    else if (!isObject(prereg))
      errors.push("R.A.I.N.'s admission answers no pre-registration in this record");
    else {
      const v = validateAdmission(admission, {
        requestId: String(admission.request_id),
        experimentId: String(prereg.experiment_id),
      });
      if (!v.ok) errors.push("R.A.I.N.'s admission is malformed: " + v.errors[0]);
      else if (v.value.definition_sha256 !== prereg.definition_sha256)
        errors.push("R.A.I.N.'s admission is for another registered definition");
      if (r.run === null && r.error === null)
        errors.push("R.A.I.N.'s admission is attached to a record that reports no run");
    }
  }
  const error = r.error;
  if (
    error !== null &&
    !(
      isObject(error) &&
      keysExactly(error, ["stage", "type", "message"]) &&
      Object.values(error).every((x) => typeof x === "string")
    )
  )
    errors.push("the execution error is malformed");
  if (r.reproduces !== null && typeof r.reproduces !== "string")
    errors.push("the reproduced run is not named");
  if (r.kind === "reproduction" && typeof r.reproduces !== "string")
    errors.push("a reproduction that names no source run");
  const report = r.reproduction;
  if (report === null) {
    if (r.kind === "reproduction" && r.run !== null)
      errors.push("a completed reproduction without its reproduction report");
  } else if (
    !isObject(report) ||
    !keysExactly(report, [
      "source_run",
      "outcome_matches",
      "deterministic_metrics_match",
      "mismatches",
    ]) ||
    typeof report.source_run !== "string" ||
    typeof report.outcome_matches !== "boolean" ||
    typeof report.deterministic_metrics_match !== "boolean" ||
    !Array.isArray(report.mismatches) ||
    report.mismatches.length > 40 ||
    !report.mismatches.every((m) => typeof m === "string")
  )
    errors.push("the reproduction report is malformed");
  else if (
    r.kind !== "reproduction" ||
    r.run === null ||
    report.source_run !== r.reproduces
  )
    errors.push("the reproduction report is not about the run this record reproduces");
  return errors;
}

/** R.A.I.N.'s admission, only when it is well formed and bound to this record. */
export function boundAdmission(r: ExperimentRecord): Admission | null {
  return r.rain_admission && !attachmentErrors(r).length ? r.rain_admission : null;
}
/** The reproduction report, only when it is well formed and about this record's source. */
export function boundReproduction(r: ExperimentRecord): ReproductionReport | null {
  return r.reproduction && !attachmentErrors(r).length ? r.reproduction : null;
}
