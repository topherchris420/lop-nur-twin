/**
 * Who occupies each seat of the research process, and how a model seat is asked.
 *
 * The orchestration boundary is drawn now so that specialised agents can take
 * seats later; today one local model sits in both model seats:
 *
 *   researcher    model  observes the state, inspects results, proposes a design or stops
 *   planner       model  the researcher's ranking of alternatives, best first
 *   critic        —      unassigned; a seat for a second model that may object before submission
 *   experimenter  host   writes the experiment, runs it on fresh simulators (`runner.ts`)
 *   analyst       model  reads one result against its pre-registered hypothesis
 *   archivist     host   seals records, reports to the registry, keeps the trace
 *
 * A model seat never holds authority: it answers a question the host wrote,
 * with one JSON object the host checks. Every call leaves a decision record
 * (`rain-autonomy-decision/v1`): the session, the seat, the provider and model,
 * the prompt exactly as sent, the text exactly as returned, what the host made
 * of it, the token counts the server reported (null when it reported none) and
 * the record's own SHA-256, by which a proposal and an admission name it.
 *
 * Server only.
 */
import { sha256, sha256Json } from "../sha256.js";
import {
  ModelFailure,
  parseStructured,
  type LocalModel,
  type ModelFailureCode,
} from "./models.js";
import type { Checked } from "../../bethesda/rain/validation.js";

export const ROLES = [
  "researcher",
  "planner",
  "critic",
  "experimenter",
  "analyst",
  "archivist",
] as const;
export type Role = (typeof ROLES)[number];
export type ModelSeat = "researcher" | "analyst";
export const SEATS: Record<Role, { by: "model" | "host" | "unassigned"; does: string }> =
  {
    researcher: {
      by: "model",
      does: "observes the research state, inspects results, proposes a design or stops",
    },
    planner: { by: "model", does: "the researcher's ranking of alternative designs" },
    critic: { by: "unassigned", does: "a seat for a second model that may object" },
    experimenter: {
      by: "host",
      does: "writes the experiment from the design and runs it on fresh simulators",
    },
    analyst: {
      by: "model",
      does: "reads one result against its pre-registered hypothesis",
    },
    archivist: {
      by: "host",
      does: "seals records, reports to the registry, appends the trace",
    },
  };

export const DECISION_SCHEMA = "rain-autonomy-decision/v1" as const;
/** The most of a model's answer a decision record keeps, in characters. */
export const ANSWER_KEPT = 32 * 1024;

export interface DecisionRecord {
  schema: typeof DECISION_SCHEMA;
  decision_id: string;
  session_id: string;
  iteration: number;
  seat: ModelSeat;
  /** Every word in `response.text` is the model's. */
  generation: "model";
  provider: string;
  model: string;
  /** The model the server said answered, or null. */
  model_reported: string | null;
  endpoint: string;
  prompt: {
    schema_name: string;
    system: string;
    user: string;
    system_sha256: string;
    user_sha256: string;
  };
  response: { text: string; sha256: string; truncated: boolean } | null;
  /** What the host accepted, or null; `refused` says why not. */
  accepted: Record<string, unknown> | null;
  refused: string | null;
  failure: ModelFailureCode | null;
  tokens: { prompt: number | null; completion: number | null };
  latency_ms: number | null;
  finish_reason: string | null;
  at: string;
  decision_sha256: string;
}

export interface SeatQuestion {
  seat: ModelSeat;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}
export interface SeatAnswer<T> {
  record: DecisionRecord;
  value: T | null;
}

/**
 * Ask a model seat one question and check its answer. Never throws for what a
 * model did: a failure to answer is `record.failure`, an unacceptable answer
 * is `record.refused`, and either leaves `value` null.
 */
export async function ask<T>(
  model: LocalModel,
  question: SeatQuestion,
  check: (raw: Record<string, unknown>) => Checked<T>,
  context: {
    decisionId: string;
    sessionId: string;
    iteration: number;
    now: () => Date;
    signal?: AbortSignal;
  },
): Promise<SeatAnswer<T>> {
  let value: T | null = null;
  let refused: string | null = null;
  let failure: ModelFailureCode | null = null;
  let answer: Awaited<ReturnType<LocalModel["complete"]>> | null = null;
  try {
    answer = await model.complete(
      {
        system: question.system,
        user: question.user,
        schemaName: question.schemaName,
        schema: question.schema,
      },
      { signal: context.signal },
    );
  } catch (error) {
    failure = error instanceof ModelFailure ? error.code : "malformed";
    refused = error instanceof Error ? error.message.slice(0, 300) : "the call failed";
  }
  if (answer) {
    const parsed = parseStructured(answer.text);
    if (!parsed.ok) refused = parsed.error;
    else {
      const checked = check(parsed.value);
      if (checked.ok) value = checked.value;
      else refused = checked.errors.slice(0, 6).join("; ");
    }
  }
  const body = {
    schema: DECISION_SCHEMA,
    decision_id: context.decisionId,
    session_id: context.sessionId,
    iteration: context.iteration,
    seat: question.seat,
    generation: "model" as const,
    provider: model.provider,
    model: model.model,
    model_reported: answer?.reportedModel ?? null,
    endpoint: model.endpoint,
    prompt: {
      schema_name: question.schemaName,
      system: question.system,
      user: question.user,
      system_sha256: sha256(question.system),
      user_sha256: sha256(question.user),
    },
    response: answer
      ? {
          text: answer.text.slice(0, ANSWER_KEPT),
          sha256: sha256(answer.text),
          truncated: answer.text.length > ANSWER_KEPT,
        }
      : null,
    accepted: value === null ? null : (structuredClone(value) as Record<string, unknown>),
    refused,
    failure,
    tokens: {
      prompt: answer?.promptTokens ?? null,
      completion: answer?.completionTokens ?? null,
    },
    latency_ms: answer?.latencyMs ?? null,
    finish_reason: answer?.finishReason ?? null,
    at: context.now().toISOString(),
  };
  return { record: { ...body, decision_sha256: sha256Json(body) }, value };
}

/** Does this decision record match its own digest? */
export function decisionDigestOK(record: DecisionRecord): boolean {
  const { decision_sha256, ...body } = record;
  try {
    return sha256Json(body) === decision_sha256;
  } catch {
    return false;
  }
}
