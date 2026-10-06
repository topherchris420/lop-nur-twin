/**
 * One experiment case: a proposal on its way through the lifecycle.
 *
 * The functions here are the only way a case moves, and each one moves it
 * through `Lifecycle.to`, which refuses any transition the diagram does not
 * draw. A proposal enters PROPOSED and is validated at once; a failed check
 * ends it REJECTED with its reasons. Approval needs an authorization record
 * that verifies; running needs the runner's own preflight to pass again;
 * every ending — including rejection, a failed execution and a stale R.A.I.N.
 * proposal — produces a record.
 */
import {
  LIMITS,
  RECORD_SCHEMA,
  type Admission,
  type Preregistration,
  type RainRevision,
} from "./contracts";
import { validateExperiment, type CheckResult, type Validated } from "./experiments";
import { authorize, type Authorization } from "./authorization";
import { Lifecycle, terminalFor } from "./lifecycle";
import { provenance, type RainSource } from "./provenance";
import {
  reproductionReport,
  seal,
  unresolvedFor,
  withAdmission,
  type ExperimentRecord,
  type RecordBody,
  type RunSection,
} from "./record";
import { preflight, type RunResult } from "./runner";

export interface Origin {
  /** Where the R.A.I.N. revision in this case's provenance comes from. */
  rain: RainRevision | null;
  rainSource: RainSource;
  /** A model that produced the proposal, if any. Never filled in. */
  model: string | null;
}
export interface ExperimentCase {
  id: string;
  lifecycle: Lifecycle;
  receivedAt: number;
  origin: Origin;
  validated: Validated | null;
  checks: CheckResult[];
  rejectedInput: string | null;
  authorization: Authorization | null;
  preregistration: Preregistration | null;
  reproduces: ExperimentRecord | null;
  record: ExperimentRecord | null;
}

const bounded = (raw: unknown) => {
  try {
    return JSON.stringify(raw).slice(0, 4000);
  } catch {
    return "(not serialisable)";
  }
};

export function openCase(
  raw: unknown,
  input: { id: string; now: Date; origin: Origin; reproduces?: ExperimentRecord | null },
): ExperimentCase {
  const lifecycle = new Lifecycle().to("PROPOSED", "proposal received", input.now);
  const result = validateExperiment(raw);
  const c: ExperimentCase = {
    id: input.id,
    lifecycle,
    receivedAt: input.now.getTime(),
    origin: input.origin,
    validated: result.ok ? result.value : null,
    checks: result.checks,
    rejectedInput: result.ok ? null : bounded(raw),
    authorization: null,
    preregistration: null,
    reproduces: input.reproduces ?? null,
    record: null,
  };
  if (!result.ok) {
    lifecycle.to(
      "REJECTED",
      "failed deterministic validation: " + result.errors.join("; "),
      input.now,
    );
    c.record = endRecord(c, input.now, "rejection", null, null);
    return c;
  }
  lifecycle.to(
    "VALIDATED",
    `${result.checks.length} deterministic checks passed`,
    input.now,
  );
  lifecycle.to(
    "AWAITING_HUMAN_APPROVAL",
    "every Bethesda experiment needs a human authorization of its exact definition",
    input.now,
  );
  return c;
}

/** A R.A.I.N. proposal older than the TTL is stale; it is rejected, never approved. */
export function expireIfStale(c: ExperimentCase, now: Date): boolean {
  if (
    c.lifecycle.state !== "AWAITING_HUMAN_APPROVAL" ||
    c.validated?.proposal.origin !== "rain" ||
    now.getTime() - c.receivedAt <= LIMITS.proposalTtlMs
  )
    return false;
  c.lifecycle.to("REJECTED", "stale: the R.A.I.N. proposal expired before approval", now);
  c.record = endRecord(c, now, "rejection", null, null);
  return true;
}

export function approve(
  c: ExperimentCase,
  input: { operator: string; typedPrefix: string; reviewed: boolean; now: Date },
): { ok: true } | { ok: false; errors: string[] } {
  if (expireIfStale(c, input.now))
    return { ok: false, errors: ["the proposal is stale"] };
  if (c.lifecycle.state !== "AWAITING_HUMAN_APPROVAL" || !c.validated)
    return { ok: false, errors: ["this case is not awaiting approval"] };
  const auth = authorize({
    experimentId: c.validated.experimentId,
    definitionSha256: c.validated.definitionSha256,
    operator: input.operator,
    typedPrefix: input.typedPrefix,
    reviewed: input.reviewed,
    now: input.now,
  });
  if (!auth.ok) return auth;
  c.authorization = auth.value;
  c.lifecycle.to(
    "AUTHORIZED",
    `local operator ${auth.value.operator} authorized definition ${c.validated.definitionSha256.slice(0, 12)}… (not authenticated identity)`,
    input.now,
  );
  return { ok: true };
}

export function decline(c: ExperimentCase, reason: string, now: Date) {
  if (!c.lifecycle.can("REJECTED") || c.lifecycle.state === "PROPOSED") return false;
  c.lifecycle.to("REJECTED", "declined by the operator: " + reason, now);
  c.record = endRecord(c, now, "rejection", null, null);
  return true;
}

/** RUNNING only if the runner's preflight passes now, against this build. */
export function begin(c: ExperimentCase, now: Date): string[] {
  if (c.lifecycle.state !== "AUTHORIZED" || !c.validated)
    return ["only an authorized case can run"];
  const v = c.validated;
  const refused = preflight(
    v.definition,
    v.definitionSha256,
    v.experimentId,
    c.authorization,
  );
  if (refused.length) {
    c.lifecycle.to("REJECTED", "preflight refused: " + refused.join("; "), now);
    c.record = endRecord(c, now, "rejection", null, null);
    return refused;
  }
  c.lifecycle.to(
    "RUNNING",
    `${v.definition.seeds.length * 2} arms on separate simulators`,
    now,
  );
  return [];
}

export function complete(
  c: ExperimentCase,
  result: RunResult,
  times: { started: Date; finished: Date },
) {
  const run: RunSection = {
    started_at: times.started.toISOString(),
    finished_at: times.finished.toISOString(),
    arms: result.arms,
    per_seed: result.per_seed,
    measurements: result.measurements,
    series: result.series,
    evaluation: result.evaluation,
    status: result.status,
    verdict: result.verdict,
  };
  const state = terminalFor(result.status);
  c.lifecycle.to(state, result.evaluation.summary, times.finished);
  c.record = endRecord(
    c,
    times.finished,
    c.reproduces ? "reproduction" : "run",
    run,
    null,
  );
  return c.record;
}

export function fail(c: ExperimentCase, error: unknown, now: Date) {
  const e = error instanceof Error ? error : new Error(String(error));
  c.lifecycle.to("FAILED", "the run did not complete: " + e.message.slice(0, 300), now);
  c.record = endRecord(c, now, c.reproduces ? "reproduction" : "run", null, {
    stage: "execute",
    type: e.name.slice(0, 128) || "Error",
    message: e.message.slice(0, 2000),
  });
  return c.record;
}

export function attachAdmission(c: ExperimentCase, admission: Admission) {
  if (!c.record) return null;
  c.record = withAdmission(c.record, admission);
  return c.record;
}

let ordinal = 0;
/** Run ids are unique within this browser: definition id plus an ordinal and time. */
export function nextRunId(experimentId: string | null, now: Date) {
  ordinal += 1;
  const stamp = now.getTime().toString(36);
  return experimentId ? `${experimentId}-R${stamp}${ordinal}` : `REJ-${stamp}${ordinal}`;
}

function endRecord(
  c: ExperimentCase,
  now: Date,
  kind: ExperimentRecord["kind"],
  run: RunSection | null,
  error: ExperimentRecord["error"],
): ExperimentRecord {
  const v = c.validated;
  const state = c.lifecycle.state as ExperimentRecord["outcome"]["state"];
  const status = run ? run.status : error ? "error" : null;
  const verdict = run ? run.verdict : "not_evaluated";
  const seeds = v?.definition.seeds ?? [];
  const body: RecordBody = {
    schema: RECORD_SCHEMA,
    run_id: nextRunId(v?.experimentId ?? null, now),
    experiment_id: v?.experimentId ?? null,
    kind: state === "REJECTED" ? "rejection" : kind,
    reproduces: c.reproduces?.run_id ?? null,
    lifecycle: structuredClone(c.lifecycle.history),
    outcome: {
      state,
      rain_status: status,
      verdict,
      summary:
        run?.evaluation.summary ??
        c.lifecycle.history.at(-1)?.detail ??
        "no outcome recorded",
      unresolved: unresolvedFor(state, verdict, seeds.length),
    },
    proposal: v?.proposal ?? null,
    rejected_input: c.rejectedInput,
    validation: c.checks,
    definition: v?.definition ?? null,
    definition_sha256: v?.definitionSha256 ?? null,
    authorization: c.authorization,
    rain_preregistration: c.preregistration,
    run,
    error,
    reproduction: run && c.reproduces ? reproductionReport(c.reproduces, run) : null,
    rain_admission: null,
    provenance: provenance({
      rain: c.origin.rain,
      rainSource: c.origin.rainSource,
      model: c.origin.model,
      seeds,
      now,
    }),
  };
  return seal(body);
}
