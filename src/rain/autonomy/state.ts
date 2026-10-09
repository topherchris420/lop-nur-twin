/**
 * The research state, derived — never stored and read back.
 *
 * Everything the researcher is shown about the past is rebuilt here from two
 * sources, each with its own standing:
 *
 *   sealed records   `bethesda-rain-experiment-record/v3`, each checked against
 *                    its digest. They alone decide what ran, what was measured,
 *                    and the status of a hypothesis — through the registry's
 *                    pre-registered criteria, never through a model's words.
 *   session traces   what each session asked and was told: the model's
 *                    questions, hypotheses and interpretations, labelled as
 *                    the model's, and the host's refusals.
 *
 * So a model's earlier conclusion reaches a later prompt only as what it is —
 * its own words, marked as such — and a hypothesis is "supported in
 * simulation" only because a record says the criteria held. A record that
 * does not match its digest, or was not made by this loop, is left out and
 * named in `warnings`.
 *
 * Pure: it reads what `store.ts` read.
 */
import {
  LOCATION_LABELS,
  METRICS,
  METRIC_LABELS,
  SCENARIO_LABELS,
} from "../../bethesda/rain/contracts.js";
import { optionHypothesis, OPTIONS } from "../../bethesda/rain/session.js";
import { parseDesignId, type Panel } from "../../bethesda/rain/standing.js";
import { runArtifactSha256 } from "../../bethesda/rain/record.js";
import type { StoredRecord } from "./store.js";
import type { TraceEntry } from "./trace.js";
import type { Reading } from "./actions.js";

export const STATE_SCHEMA = "rain-research-state/v1" as const;

export type HypothesisStatus =
  | "untested"
  | "supported"
  | "not_supported"
  | "inconclusive"
  | "contested"
  | "needs_reassessment"
  | "not_evaluated";
export const STATUS_WORDS: Record<HypothesisStatus, string> = {
  untested: "UNTESTED",
  supported: "SUPPORTED IN SIMULATION",
  not_supported: "NOT SUPPORTED IN SIMULATION",
  inconclusive: "INCONCLUSIVE IN SIMULATION",
  contested: "CONTESTED: the seed panels disagree, and both results are kept",
  needs_reassessment:
    "NEEDS REASSESSMENT: a contributing result has no successful replay",
  not_evaluated: "NOT EVALUATED: its run did not complete",
};

export interface ExperimentEntry {
  run_id: string;
  experiment_id: string;
  design_id: string;
  option: string;
  direction: "increase" | "decrease";
  panel: Panel;
  state: string;
  verdict: string;
  rain_status: string | null;
  summary: string;
  per_seed: {
    seed: number;
    control: number | null;
    treatment: number | null;
    delta: number | null;
  }[];
  delta_mean: number | null;
  delta_min: number | null;
  delta_max: number | null;
  seeds_expected: number | null;
  unit: string;
  unresolved: string[];
  registry_run_id: string | null;
  registry_status: string | null;
  session_id: string;
  iteration: number;
  decision_id: string;
  record_sha256: string;
  path: string;
  /** True or false when this loop replayed it after the run; null when nothing says. */
  replay_verified: boolean | null;
}
export interface Statement {
  text: string;
  session_id: string;
  iteration: number | null;
  decision_id: string;
  model: string;
}
export interface HypothesisEntry {
  /** `X1-increase`: one option, one direction. */
  id: string;
  /** The host's operationalization; the only wording a run tested. */
  statement: string;
  competitor: string;
  status: HypothesisStatus;
  runs: { run_id: string; design_id: string; panel: Panel; verdict: string }[];
  /** What the model said about it, its own words, newest last. */
  model_statements: Statement[];
}
export interface AnalysisEntry {
  run_id: string;
  design_id: string;
  reading: Reading;
  criteria_reading: Reading;
  agrees: boolean;
  interpretation: string;
  model: string;
  session_id: string;
}
export interface RefusalEntry {
  session_id: string;
  iteration: number | null;
  stage: string;
  reason: string;
}
export interface SessionEntry {
  session_id: string;
  mode: string;
  started_at: string;
  ended_at: string | null;
  provider: string;
  model: string;
  stop_reason: string | null;
  detail: string | null;
  experiments: number;
}
export interface ResearchState {
  schema: typeof STATE_SCHEMA;
  note: string;
  experiments: ExperimentEntry[];
  /** `option:panel` → the design that measured those seeds. */
  measured: Record<string, string>;
  hypotheses: HypothesisEntry[];
  /** Questions the model raised, newest last. Its words, not findings. */
  questions: Statement[];
  analyses: AnalysisEntry[];
  refusals: RefusalEntry[];
  sessions: SessionEntry[];
  warnings: string[];
}

export const NOTE =
  "Derived from the sealed records and session traces in this directory; rebuilt on every load and never read back. Hypothesis status comes from records and the registry's pre-registered criteria. Every question, hypothesis wording and interpretation attributed to a model is that model's text, not evidence. Simulation results describe the Bethesda simulator's rules, not Bethesda.";

/** The error a run sealed when the session's runtime budget, not the run, ended it. */
export const RUNTIME_SPENT = "RuntimeSpent";
export const RUNTIME_SPENT_MESSAGE =
  "the session's runtime budget ran out during the run";

/**
 * A run the session's runtime budget cut off before it finished: sealed
 * FAILED with no run section, so nothing was measured. Records sealed before
 * the error was named carry the plain `Error` type and the same message.
 */
export const cutOffUnmeasured = (r: NonNullable<StoredRecord["record"]>): boolean =>
  r.outcome.state === "FAILED" &&
  r.run === null &&
  r.error !== null &&
  (r.error.type === RUNTIME_SPENT || r.error.message === RUNTIME_SPENT_MESSAGE);

const hypothesisOf = (design: string) => design.split("-").slice(0, 2).join("-");
const competitorOf = (id: string) =>
  id.endsWith("-increase")
    ? id.replace(/-increase$/, "-decrease")
    : id.replace(/-decrease$/, "-increase");

/** The registry's verdicts (`rain-criteria/v1`), as a hypothesis status. */
const VERDICT_STATUS: Record<string, HypothesisStatus> = {
  supported: "supported",
  not_supported: "not_supported",
  insufficient_evidence: "inconclusive",
  not_evaluated: "not_evaluated",
};
function statusOf(verdicts: readonly string[]): HypothesisStatus {
  if (!verdicts.length) return "untested";
  const statuses = new Set(verdicts.map((v) => VERDICT_STATUS[v] ?? "not_evaluated"));
  if (statuses.size === 1) return [...statuses][0]!;
  // Panels that decided, and decided differently, are a contradiction; it is kept.
  if (statuses.has("supported") && statuses.has("not_supported")) return "contested";
  return "inconclusive";
}

export function deriveState(
  records: readonly StoredRecord[],
  entries: readonly TraceEntry[],
): ResearchState {
  const warnings: string[] = [];
  const experiments: ExperimentEntry[] = [];
  const refusals: RefusalEntry[] = [];
  const replayed = new Map<string, { ok: boolean; artifact_sha256?: string }>();
  const replayStatus = new Map<string, boolean | null>();
  for (const e of entries) {
    if (e.kind === "replay") replayed.set(e.run_id, e);
    if (e.kind === "refusal")
      refusals.push({
        session_id: e.session_id,
        iteration: e.iteration,
        stage: e.stage,
        reason: e.reason,
      });
  }
  for (const stored of records) {
    const r = stored.record;
    if (!r || !stored.digestOK) {
      warnings.push(
        `${stored.path} ${stored.problem ? `could not be read (${stored.problem})` : "does not match its digest"}; it is not part of the research state`,
      );
      continue;
    }
    // A design that was refused never ran, whatever admitted it first; the
    // trace holds the refusal, and its seeds stay fresh.
    if (r.outcome.state === "REJECTED" && r.proposal?.origin === "rain") continue;
    // Nor did one the session's budget cut off before it measured anything:
    // the trace holds the stop, and the design's seeds stay fresh.
    if (cutOffUnmeasured(r)) continue;
    if (!r.standing) {
      warnings.push(
        `${stored.path} was not admitted under a standing authority; it is not this loop's record and is left out`,
      );
      continue;
    }
    const a = r.standing.admission;
    const parsed = parseDesignId(a.design_id);
    if (!parsed || !r.definition || !r.experiment_id) {
      warnings.push(`${stored.path} names no design this lab offers; it is left out`);
      continue;
    }
    const run = r.run;
    const receipt = replayed.get(r.run_id);
    const verified =
      receipt?.ok === false
        ? false
        : receipt?.ok === true && receipt.artifact_sha256 === runArtifactSha256(r)
          ? true
          : null;
    replayStatus.set(r.run_id, verified);
    const m = run?.measurements ?? {};
    const num = (k: string) => (typeof m[k] === "number" ? m[k] : null);
    experiments.push({
      run_id: r.run_id,
      experiment_id: r.experiment_id,
      design_id: a.design_id,
      option: parsed.option,
      direction: parsed.direction,
      panel: parsed.panel,
      state: r.outcome.state,
      verdict: r.outcome.verdict,
      rain_status: r.outcome.rain_status,
      summary: r.outcome.summary,
      per_seed: (run?.per_seed ?? []).map((s) => ({
        seed: s.seed,
        control: s.control,
        treatment: s.treatment,
        delta: s.delta,
      })),
      delta_mean: num("primary_delta_mean"),
      delta_min: num("primary_delta_min"),
      delta_max: num("primary_delta_max"),
      seeds_expected: num("seeds_in_expected_direction"),
      unit: METRICS[r.definition.primary_metric].unit,
      unresolved: [...r.outcome.unresolved],
      registry_run_id: r.rain_admission?.run_id ?? null,
      registry_status: r.rain_admission?.status ?? null,
      session_id: a.session_id,
      iteration: a.iteration,
      decision_id: a.decision_id,
      record_sha256: r.record_sha256,
      path: stored.path,
      replay_verified: verified,
    });
  }
  const measured: Record<string, string> = {};
  for (const x of experiments) {
    const key = `${x.option}:${x.panel}`;
    if (measured[key] && measured[key] !== x.design_id)
      warnings.push(`${key} was measured by both ${measured[key]} and ${x.design_id}`);
    measured[key] ??= x.design_id;
  }

  const hypotheses = new Map<string, HypothesisEntry>();
  const hypothesis = (id: string): HypothesisEntry | null => {
    const known = hypotheses.get(id);
    if (known) return known;
    const parsed = parseDesignId(`${id}-primary`);
    if (!parsed) return null;
    const entry: HypothesisEntry = {
      id,
      statement: optionHypothesis(parsed.option, parsed.direction)!,
      competitor: competitorOf(id),
      status: "untested",
      runs: [],
      model_statements: [],
    };
    hypotheses.set(id, entry);
    return entry;
  };
  for (const x of experiments)
    hypothesis(hypothesisOf(x.design_id))!.runs.push({
      run_id: x.run_id,
      design_id: x.design_id,
      panel: x.panel,
      verdict: x.verdict,
    });
  const questions: Statement[] = [];
  const analyses: AnalysisEntry[] = [];
  const sessions = new Map<string, SessionEntry>();
  for (const e of entries) {
    if (e.kind === "proposal") {
      const h = hypothesis(hypothesisOf(e.design_id));
      const said = {
        session_id: e.session_id,
        iteration: e.iteration,
        decision_id: e.decision_id,
        model: e.model,
      };
      h?.model_statements.push({ ...said, text: e.hypothesis });
      if (e.question) questions.push({ ...said, text: e.question });
    }
    if (e.kind === "analysis") {
      analyses.push({
        run_id: e.run_id,
        design_id: e.design_id,
        reading: e.reading,
        criteria_reading: e.criteria_reading,
        agrees: e.agrees,
        interpretation: e.interpretation,
        model: e.model,
        session_id: e.session_id,
      });
      for (const q of e.open_questions)
        questions.push({
          text: q,
          session_id: e.session_id,
          iteration: e.iteration,
          decision_id: e.decision_id,
          model: e.model,
        });
    }
    if (e.kind === "session-started")
      sessions.set(e.session_id, {
        session_id: e.session_id,
        mode: e.mode,
        started_at: e.at,
        ended_at: null,
        provider: e.provider,
        model: e.model,
        stop_reason: null,
        detail: null,
        experiments: 0,
      });
    if (e.kind === "session-ended") {
      const s = sessions.get(e.session_id);
      if (s) {
        s.ended_at = e.at;
        s.stop_reason = e.stop_reason;
        s.detail = e.detail;
        s.experiments = e.experiments;
      }
    }
  }
  for (const h of hypotheses.values()) {
    h.status = statusOf(h.runs.map((r) => r.verdict));
    const unverified = h.runs.filter(
      (r) => r.verdict !== "not_evaluated" && replayStatus.get(r.run_id) !== true,
    );
    if (unverified.length) {
      h.status = "needs_reassessment";
      warnings.push(
        `${h.id}: ${unverified.map((r) => r.run_id).join(", ")} has failed or missing replay verification; the original results are retained for review`,
      );
    }
    h.model_statements = h.model_statements.slice(-3);
  }
  return {
    schema: STATE_SCHEMA,
    note: NOTE,
    experiments,
    measured,
    hypotheses: [...hypotheses.values()].sort((a, b) => a.id.localeCompare(b.id, "en")),
    questions,
    analyses,
    refusals,
    sessions: [...sessions.values()],
    warnings,
  };
}

/** One line per option, as the researcher reads it. */
export function optionLines(): string[] {
  return OPTIONS.filter((o) => o.template).map((o) => {
    const t = o.template!;
    return `${o.id} · ${SCENARIO_LABELS[t.scenario]} at ${LOCATION_LABELS[t.location]} · metric: ${METRIC_LABELS[t.metric].toLowerCase()} (${METRICS[t.metric].unit}) · threshold ${t.effect}`;
  });
}
