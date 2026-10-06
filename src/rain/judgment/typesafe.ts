/**
 * TypeSafe's SystemOne endpoint as a judgment provider: Jev, asked one Choice
 * question. A port of R.A.I.N.'s `judgment/typesafe.py` (james_library, MIT)
 * on `fetch`: the state and the question go up, a typed answer comes back,
 * and only documented, validated fields are kept — the raw response never is.
 *
 * The endpoint is the one the player seat's Jev handler uses
 * (`server/jev/handler.ts`, `TYPESAFE_ENDPOINT`); this module is the research
 * runtime's client for it and is called only by the decision router, never
 * by the browser.
 *
 * Shared with the server: imports siblings only.
 */
import {
  questionSetToDict,
  validAnswers,
  type JudgmentAnswer,
  type JudgmentProvider,
  type JudgmentResult,
  type JudgmentState,
  type QuestionSet,
} from "./contracts.js";
import { containsSensitiveMaterial } from "./sensitive.js";

export const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const MAX_RESPONSE_BYTES = 100_000;
export const RESPONSE_DEADLINE_MS = 30_000;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

export interface TypeSafeOptions {
  apiKey: string | undefined;
  model?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  /** The environment whose configured secrets the state must not contain. */
  env?: Readonly<Record<string, string | undefined>>;
}

export class TypeSafeJudgmentProvider implements JudgmentProvider {
  readonly model: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly env: Readonly<Record<string, string | undefined>>;

  constructor(options: TypeSafeOptions) {
    const model = options.model ?? "jev-latest";
    if (!SAFE_MODEL.test(model)) throw new Error("invalid judgment model identifier");
    this.model = model;
    this.apiKey = options.apiKey ?? "";
    this.endpoint = options.endpoint ?? TYPESAFE_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.env = options.env ?? {};
  }

  private failed(
    state: JudgmentState,
    questions: QuestionSet,
    code: string,
    status: number | null = null,
  ): JudgmentResult {
    return {
      provider: "typesafe",
      model: this.model,
      answers: [],
      stateHash: state.stateHash,
      questionSetVersion: questions.version,
      errorCode: code,
      errorStatus: status,
    };
  }

  /** Reject configuration or credential exposure before deterministic routing. */
  preflight(state: JudgmentState, questions: QuestionSet): JudgmentResult | null {
    if (
      containsSensitiveMaterial(this.model, this.env) ||
      containsSensitiveMaterial(state.canonicalText, this.env) ||
      (this.apiKey &&
        (this.model.includes(this.apiKey) ||
          state.canonicalText.includes(this.apiKey) ||
          JSON.stringify(questionSetToDict(questions)).includes(this.apiKey)))
    )
      return { ...this.failed(state, questions, "state_contains_secret"), model: null };
    if (!this.apiKey) return this.failed(state, questions, "provider_not_configured");
    return null;
  }

  async evaluate(state: JudgmentState, questions: QuestionSet): Promise<JudgmentResult> {
    const preflight = this.preflight(state, questions);
    if (preflight !== null) return preflight;
    const payload = {
      state: state.canonicalText,
      model: this.model,
      questions: questionSetToDict(questions),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RESPONSE_DEADLINE_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: "error",
      });
    } catch {
      clearTimeout(timer);
      return this.failed(
        state,
        questions,
        controller.signal.aborted ? "provider_timeout" : "provider_transport_error",
      );
    }
    try {
      const status = response.status;
      if (status !== 200) {
        await response.body?.cancel();
        const code =
          status === 401 || status === 403
            ? "provider_authentication_error"
            : status === 429
              ? "provider_rate_limited"
              : status === 529
                ? "provider_overloaded"
                : "provider_http_error";
        return this.failed(state, questions, code, status);
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader)
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            return this.failed(state, questions, "provider_response_too_large");
          }
          chunks.push(value);
        }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const text = new TextDecoder().decode(bytes);
      if (this.apiKey && text.includes(this.apiKey))
        return this.failed(state, questions, "provider_malformed_response");
      if (/\bNaN\b|\bInfinity\b/.test(text))
        return this.failed(state, questions, "provider_malformed_response");
      return parseResponse(JSON.parse(text), state, questions);
    } catch {
      return controller.signal.aborted
        ? this.failed(state, questions, "provider_timeout")
        : this.failed(state, questions, "provider_malformed_response");
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Copy only documented, validated fields; never retain the raw response. */
export function parseResponse(
  payload: unknown,
  state: JudgmentState,
  questions: QuestionSet,
): JudgmentResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("invalid response");
  const p = payload as Record<string, unknown>;
  if (typeof p.model !== "string" || !SAFE_MODEL.test(p.model))
    throw new Error("invalid model");
  const rawAnswers = p.answers;
  if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers))
    throw new Error("invalid answers");
  const ids = new Set(questions.questions.map((q) => q.questionId));
  const answerKeys = Object.keys(rawAnswers);
  if (answerKeys.length !== ids.size || answerKeys.some((k) => !ids.has(k)))
    throw new Error("invalid answers");
  const usage = p.usage;
  if (
    !usage ||
    typeof usage !== "object" ||
    ["input_tokens", "output_tokens"].some((key) => {
      const v = (usage as Record<string, unknown>)[key];
      return !Number.isInteger(v) || (v as number) < 0;
    })
  )
    throw new Error("invalid usage");
  const answers: JudgmentAnswer[] = [];
  for (const question of questions.questions) {
    const raw = (rawAnswers as Record<string, unknown>)[question.questionId];
    if (
      !raw ||
      typeof raw !== "object" ||
      (raw as Record<string, unknown>).type !== question.type
    )
      throw new Error("invalid answer type");
    const r = raw as Record<string, unknown>;
    const probabilities = r.probabilities ?? {};
    if (
      !probabilities ||
      typeof probabilities !== "object" ||
      Array.isArray(probabilities)
    )
      throw new Error("invalid probabilities");
    if (question.type === "score") {
      const legend = Object.fromEntries(
        question.levels.map((text, index) => [String(index), text]),
      );
      if (JSON.stringify(r.legend) !== JSON.stringify(legend))
        throw new Error("invalid legend");
    }
    answers.push({
      questionId: question.questionId,
      type: question.type,
      value: r[question.type] as string | number,
      probabilities: Object.entries(probabilities as Record<string, number>),
      confidence: (r.confidence as number | undefined) ?? null,
    });
  }
  const result: JudgmentResult = {
    provider: "typesafe",
    model: p.model,
    answers,
    stateHash: state.stateHash,
    questionSetVersion: questions.version,
    errorCode: null,
    errorStatus: null,
  };
  if (!validAnswers(result, questions)) throw new Error("invalid typed answers");
  return result;
}
