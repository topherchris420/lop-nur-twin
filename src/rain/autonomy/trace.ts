/**
 * The session trace: what an autonomous session did, step by step, as
 * structured entries appended to `sessions/<id>/trace.jsonl` and never
 * rewritten. The CLI shows exactly these entries, so what a person watched is
 * what was kept.
 *
 * Every entry names its session and iteration. Who wrote each word is in the
 * entry: a `decision` holds the prompt the host wrote and the text the model
 * returned; `proposal` and `analysis` entries hold the model's words, marked
 * `generation: "model"`; everything else is the host's account of what its own
 * code did. Hypothesis status is never in a trace: it comes from sealed records
 * and the registry's criteria (`state.ts`).
 *
 * Pure: types and constants only.
 */
import type { PolicyRule, SessionBudgets } from "../../bethesda/rain/standing.js";
import type { DecisionRecord } from "./roles.js";
import type { Reading } from "./actions.js";

export const TRACE_SCHEMA = "rain-autonomy-trace/v1" as const;
export const SESSION_SCHEMA = "rain-autonomy-session/v1" as const;

export const STOP_REASONS = {
  iterations: "the iteration budget is spent",
  experiments: "the experiment budget is spent",
  runtime: "the runtime budget is spent",
  failed_proposals: "the failed-proposal budget is spent",
  model_calls: "the model-call budget is spent",
  model_tokens: "the model-token budget is spent, or cannot be enforced",
  researcher: "the researcher stopped",
  no_design: "no admissible design remains",
  repeated: "the researcher repeated a refused proposal",
  model_unavailable: "the model did not answer",
  not_authorized: "no standing authorization covers this charter",
  registry: "the registry refused",
  simulator: "an experiment did not complete",
  replay: "a record did not replay",
  store: "the research state could not be written",
  error: "an unexpected error stopped the session",
} as const;
export type StopReason = keyof typeof STOP_REASONS;

export type Stage =
  | "research"
  | "validation"
  | "policy"
  | "preregistration"
  | "execution"
  | "analysis"
  | "submission";

export type TraceBody =
  | {
      kind: "session-started";
      mode: "live" | "dry-run";
      provider: string;
      model: string;
      endpoint: string;
      charter_sha256: string;
      charter_authorization_sha256: string | null;
      budgets: SessionBudgets;
      roles: Record<string, string>;
      research_dir: string;
      records_before: number;
    }
  | { kind: "model-check"; ok: boolean; listed: string[]; detail: string }
  | {
      kind: "observation";
      designs_open: number;
      experiments_recorded: number;
      hypotheses_tested: number;
      open_questions: number;
    }
  | { kind: "decision"; decision: DecisionRecord }
  | {
      kind: "tool";
      decision_id: string;
      tool: "inspect_result" | "inspect_design";
      input: string;
      output: string;
    }
  | {
      kind: "proposal";
      decision_id: string;
      design_id: string;
      ranking: string[];
      question: string;
      hypothesis: string;
      competing_hypothesis: string;
      rationale: string;
      generation: "model";
      model: string;
    }
  | {
      kind: "validation";
      decision_id: string;
      design_id: string;
      ok: boolean;
      experiment_id: string | null;
      checks: { id: string; ok: boolean; detail: string }[];
    }
  | {
      kind: "policy";
      decision_id: string;
      design_id: string;
      admitted: boolean;
      /** Dry run: every rule but the charter's authorization holds. */
      admissible_once_authorized: boolean;
      rules: PolicyRule[];
      admission_sha256: string | null;
    }
  | {
      kind: "would-execute";
      decision_id: string;
      design_id: string;
      experiment_id: string;
      definition_sha256: string;
      protocol: string;
    }
  | {
      kind: "preregistration";
      experiment_id: string;
      rain_experiment_id: string;
      registry: string;
      definition_sha256: string;
    }
  | {
      kind: "execution";
      experiment_id: string;
      run_id: string;
      design_id: string;
      state: string;
      verdict: string;
      rain_status: string | null;
      summary: string;
      seconds: number;
    }
  | {
      kind: "replay";
      run_id: string;
      ok: boolean;
      failed: string[];
      artifact_sha256?: string;
    }
  | {
      kind: "analysis";
      decision_id: string;
      run_id: string;
      design_id: string;
      reading: Reading;
      /** What the pre-registered criteria imply; they stand whatever the model read. */
      criteria_reading: Reading;
      agrees: boolean;
      interpretation: string;
      caveats: string[];
      open_questions: string[];
      generation: "model";
      model: string;
    }
  | {
      kind: "contradiction";
      hypothesis: string;
      runs: { run_id: string; design_id: string; verdict: string }[];
      detail: string;
    }
  | {
      kind: "submission";
      run_id: string;
      rain_run_id: string | null;
      status: string | null;
      verdict: string | null;
      refused: string | null;
    }
  | {
      kind: "record";
      run_id: string;
      experiment_id: string | null;
      design_id: string | null;
      state: string;
      path: string;
      record_sha256: string;
    }
  | { kind: "refusal"; stage: Stage; decision_id: string | null; reason: string }
  | {
      kind: "session-ended";
      stop_reason: StopReason;
      detail: string;
      experiments: number;
      model_calls: number;
      /** Null when any answer came without counts: unknown stays unknown. */
      tokens: { prompt: number; completion: number } | null;
      failed_proposals: number;
    };

export type TraceEntry = TraceBody & {
  schema: typeof TRACE_SCHEMA;
  seq: number;
  at: string;
  session_id: string;
  iteration: number | null;
};
