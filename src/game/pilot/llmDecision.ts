import { AXES, isAxisAction, type Axis, type ControlFrame } from "./contract.js";
import { QUESTION_HASH } from "./decision.js";
import { askedAxes, type LegalActions, type Validated } from "./observation.js";

/**
 * The decision a conventional LLM returns through `/api/llm/decision`:
 * `blacksite-llm-decision/v2`. Shared by the server, which builds it from the
 * provider's answer, and the browser, which validates it again before anything
 * executes.
 *
 * Version 2 stopped turning unknowns into knowns. `model` is the model the
 * provider *reports* having served, and null when it reports none — version 1
 * filled the configured model in, so a substitution behind an alias could
 * never show. What the server asked for travels separately as
 * `requestedModel`. And `confidenceSource` is `verbalized` only when the model
 * actually wrote a number; asked for one and wrote none is `none`.
 *
 * It differs from Jev's decision in one respect that matters for evaluation,
 * and the difference is carried rather than hidden: an LLM has no distribution
 * over the options it was offered. When the deployment asks for one, it
 * *writes* a confidence number per axis; that is recorded with the source
 * `verbalized` and is never mixed with TypeSafe's probabilities. When it is not
 * asked, or does not answer with one, the confidence is null — not 1, not 1/k.
 */

export const LLM_DECISION_SCHEMA = "blacksite-llm-decision/v2";

export const LLM_PROVIDERS = ["anthropic", "openai-compatible"] as const;

/**
 * A model id as an LLM provider names it. Wider than Jev's `isModelId`:
 * OpenAI-compatible servers name models by namespace (`Qwen/Qwen2.5-7B-Instruct`,
 * `meta-llama/Llama-3.1-8B-Instruct`), so `/` is allowed and the length is
 * 128. Never a URL. The server applies it to what it asks for and what the
 * provider says it served; the browser applies it again.
 */
const LLM_MODEL_ID = /^(?!.*:[/]{2})[A-Za-z0-9][A-Za-z0-9._/:-]{0,127}$/;

export function isLlmModelId(value: unknown): value is string {
  return typeof value === "string" && LLM_MODEL_ID.test(value);
}
export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

export interface LlmAxisAnswer {
  choice: string;
  /** The number the model wrote, in [0, 1]; null when it wrote none. */
  confidence: number | null;
}

export interface LlmDecision {
  schemaVersion: typeof LLM_DECISION_SCHEMA;
  sequence: number;
  source: "llm";
  provider: LlmProviderName;
  /** The model the provider reported serving; null when it reported none. */
  model: string | null;
  /** The model the server asked for — configuration, not a claim about the answer. */
  requestedModel: string;
  frame: ControlFrame;
  /** One answer per asked axis; unasked axes are absent. */
  answers: Partial<Record<Axis, LlmAxisAnswer>>;
  confidenceSource: "verbalized" | "none";
  /** Server-measured duration of the provider call(s), ms. */
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number } | null;
  /** Provider attempts beyond the first. */
  retries: number;
  /** The provider's own id for the call, when it returns one. */
  traceId: string | null;
  questionHash: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the per-axis answers against the offered options: every asked axis
 * answered with an offered option, no unasked axis answered, confidences in
 * [0, 1] or null. Returns the frame they select.
 */
export function parseLlmAnswers(
  answers: unknown,
  legal: LegalActions,
): Validated<{ frame: ControlFrame; answers: Partial<Record<Axis, LlmAxisAnswer>> }> {
  if (!isRecord(answers)) return { ok: false, error: "answers is not an object" };
  const asked = new Set(askedAxes(legal));
  for (const key of Object.keys(answers)) {
    if (!(AXES as readonly string[]).includes(key)) {
      return { ok: false, error: `answer for unknown axis ${key.slice(0, 20)}` };
    }
    if (!asked.has(key as Axis))
      return { ok: false, error: `${key}: answered, but it was not asked` };
  }
  const out: Partial<Record<Axis, LlmAxisAnswer>> = {};
  const frame = {} as Record<Axis, string>;
  for (const axis of AXES) {
    const options = legal[axis] as readonly string[];
    if (!asked.has(axis)) {
      frame[axis] = options[0]!;
      continue;
    }
    const answer = answers[axis];
    if (!isRecord(answer)) return { ok: false, error: `${axis}: no answer` };
    const choice = answer["choice"];
    if (!isAxisAction(axis, choice) || !options.includes(choice)) {
      return { ok: false, error: `${axis}: choice is not an offered option` };
    }
    const confidence = answer["confidence"] ?? null;
    if (
      confidence !== null &&
      (typeof confidence !== "number" ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1)
    ) {
      return { ok: false, error: `${axis}: confidence outside [0, 1]` };
    }
    out[axis] = { choice, confidence };
    frame[axis] = choice;
  }
  return { ok: true, value: { frame: frame as unknown as ControlFrame, answers: out } };
}

export function validateLlmDecision(
  value: unknown,
  expected: { sequence: number; legal: LegalActions },
): Validated<LlmDecision> {
  if (!isRecord(value)) return { ok: false, error: "decision is not an object" };
  if (value["schemaVersion"] !== LLM_DECISION_SCHEMA)
    return { ok: false, error: "unsupported decision schema" };
  if (value["sequence"] !== expected.sequence) {
    return { ok: false, error: "sequence does not match the observation" };
  }
  if (value["source"] !== "llm") return { ok: false, error: "unknown decision source" };
  const provider = value["provider"];
  if (!(LLM_PROVIDERS as readonly unknown[]).includes(provider)) {
    return { ok: false, error: "unknown provider" };
  }
  const model = value["model"];
  if (model !== null && !isLlmModelId(model))
    return { ok: false, error: "served model id malformed" };
  const requestedModel = value["requestedModel"];
  if (!isLlmModelId(requestedModel))
    return { ok: false, error: "requested model id missing or malformed" };
  const latency = value["latencyMs"];
  if (typeof latency !== "number" || !Number.isFinite(latency) || latency < 0) {
    return { ok: false, error: "latency missing or malformed" };
  }
  const retries = value["retries"];
  if (
    typeof retries !== "number" ||
    !Number.isInteger(retries) ||
    retries < 0 ||
    retries > 10
  ) {
    return { ok: false, error: "retries missing or malformed" };
  }
  const questionHash = value["questionHash"];
  if (typeof questionHash !== "string" || !QUESTION_HASH.test(questionHash)) {
    return { ok: false, error: "question hash missing" };
  }
  const parsed = parseLlmAnswers(value["answers"], expected.legal);
  if (!parsed.ok) return parsed;
  const frameRaw = value["frame"];
  if (
    !isRecord(frameRaw) ||
    AXES.some((axis) => frameRaw[axis] !== parsed.value.frame[axis])
  ) {
    return { ok: false, error: "frame disagrees with the answers" };
  }
  const anyConfidence = Object.values(parsed.value.answers).some(
    (a) => a?.confidence !== null,
  );
  const source = value["confidenceSource"];
  if (source !== "verbalized" && source !== "none")
    return { ok: false, error: "confidence source" };
  if (source === "none" && anyConfidence) {
    return { ok: false, error: "confidence given but the source says none" };
  }
  if (source === "verbalized" && !anyConfidence) {
    return {
      ok: false,
      error: "confidence source is verbalized but no number was written",
    };
  }
  let usage: LlmDecision["usage"] = null;
  const u = value["usage"];
  if (isRecord(u)) {
    const i = u["inputTokens"];
    const o = u["outputTokens"];
    if (
      Number.isInteger(i) &&
      Number.isInteger(o) &&
      (i as number) >= 0 &&
      (o as number) >= 0
    ) {
      usage = { inputTokens: i as number, outputTokens: o as number };
    }
  }
  const traceId = value["traceId"];
  return {
    ok: true,
    value: {
      schemaVersion: LLM_DECISION_SCHEMA,
      sequence: expected.sequence,
      source: "llm",
      provider: provider as LlmProviderName,
      model,
      requestedModel,
      frame: parsed.value.frame,
      answers: parsed.value.answers,
      confidenceSource: source,
      latencyMs: latency,
      usage,
      retries,
      traceId: typeof traceId === "string" && traceId.length <= 128 ? traceId : null,
      questionHash,
    },
  };
}
