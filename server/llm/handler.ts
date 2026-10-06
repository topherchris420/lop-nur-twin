import {
  OBSERVATION_SCHEMA_VERSION,
  ACTION_CONTRACT_VERSION,
} from "../../src/game/pilot/contract.js";
import { isModelId } from "../../src/game/pilot/decision.js";
import {
  LLM_DECISION_SCHEMA,
  LLM_PROVIDERS,
  parseLlmAnswers,
  type LlmDecision,
  type LlmProviderName,
} from "../../src/game/pilot/llmDecision.js";
import { validateObservation } from "../../src/game/pilot/observation.js";
import { LLM_CAPABILITIES } from "../../src/game/pilot/capabilities.js";
import {
  MAX_BODY_BYTES,
  SESSION_ID,
  errorResponse,
  isSameOrigin,
  json,
  readBody,
  type RequestMeta,
} from "../jev/handler.js";
import { DEFAULT_RATE_LIMITS, RateLimiter } from "../jev/rateLimit.js";
import { buildLlmPrompt, type ConfidenceMode } from "./prompt.js";
import {
  AnthropicAdapter,
  OpenAiCompatibleAdapter,
  type AdapterResult,
  type LlmAdapter,
} from "./providers.js";

/**
 * `POST /api/llm/decision` — a conventional LLM in the player's seat.
 *
 * The same boundary as the Jev endpoint, deliberately: a same-origin JSON body
 * under 8 KiB holding `{ session, observation }`, validated by the shared
 * validator, rate-limited, and turned into a question by server code. The
 * browser never chooses what is asked, so this is not a prompt proxy, and the
 * credential never leaves the server.
 *
 * Provider and model are configuration (`LLM_PROVIDER`, `LLM_MODEL`, …), read
 * by the entry points and passed in; nothing in the game names a commercial
 * model. Every answer is validated against the options that were offered; an
 * answer that fails is a 502 `upstream_invalid`, never a guess. A refusal is a
 * 502 `upstream_refused`, never a substitute. Transient failures (rate limits,
 * overload, 5xx, a dropped connection) are retried within the deadline, and
 * the number of retries is returned with the decision, so a slow answer that
 * needed three tries is not mistaken for a fast one.
 */

export interface LlmServerConfig {
  provider: string | undefined;
  apiKey: string | undefined;
  model: string | undefined;
  baseUrl?: string | undefined;
  effort?: string | undefined;
  confidence?: string | undefined;
  timeoutMs?: string | number | undefined;
  maxRetries?: string | number | undefined;
  maxTokens?: string | number | undefined;
  responseFormat?: string | undefined;
  /** Tests inject an adapter or a fetch; production builds one from the fields above. */
  adapter?: LlmAdapter;
  fetchImpl?: typeof fetch;
  limiter?: RateLimiter;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: Record<string, unknown>) => void;
}

/** The default Claude model when the operator names none. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

function bounded(
  value: string | number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n =
    typeof value === "number"
      ? value
      : value === undefined || value === ""
        ? NaN
        : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** `https://…`, or `http://` to this machine only (a local model server). */
export function isAllowedBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export interface ResolvedLlmConfig {
  configured: boolean;
  /** Why not, in words that name no secret value. */
  reason: string | null;
  provider: LlmProviderName | null;
  model: string | null;
  confidence: ConfidenceMode;
  effort: (typeof EFFORTS)[number] | null;
  timeoutMs: number;
  maxRetries: number;
  maxTokens: number;
  responseFormat: "json_schema" | "json_object" | "none";
  baseUrl: string | null;
}

export function resolveLlmConfig(config: LlmServerConfig): ResolvedLlmConfig {
  const provider = (LLM_PROVIDERS as readonly string[]).includes(
    config.provider?.trim() ?? "",
  )
    ? (config.provider!.trim() as LlmProviderName)
    : null;
  const apiKey = config.apiKey?.trim();
  const rawModel =
    config.model?.trim() || (provider === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : "");
  const model = isModelId(rawModel) ? rawModel : null;
  const baseUrl = config.baseUrl?.trim() || null;
  const effort = (EFFORTS as readonly string[]).includes(config.effort?.trim() ?? "")
    ? (config.effort!.trim() as (typeof EFFORTS)[number])
    : null;
  const format = config.responseFormat?.trim();
  const confidence: ConfidenceMode =
    config.confidence?.trim() === "none" ? "none" : "verbalized";
  const responseFormat: ResolvedLlmConfig["responseFormat"] =
    format === "json_object" || format === "none" ? format : "json_schema";
  const base = {
    provider,
    model,
    confidence,
    effort,
    timeoutMs: bounded(config.timeoutMs, 10_000, 1_000, 25_000),
    maxRetries: bounded(config.maxRetries, 1, 0, 3),
    maxTokens: bounded(config.maxTokens, 1_024, 128, 16_000),
    responseFormat,
    baseUrl,
  };
  const reason =
    config.adapter !== undefined
      ? null
      : provider === null
        ? "LLM_PROVIDER is not set to a supported provider"
        : !apiKey
          ? "LLM_API_KEY is not configured"
          : model === null
            ? "LLM_MODEL is missing or malformed"
            : provider === "openai-compatible" &&
                (baseUrl === null || !isAllowedBaseUrl(baseUrl))
              ? "LLM_BASE_URL must be https (or http to localhost) for openai-compatible"
              : null;
  return { configured: reason === null, reason, ...base };
}

function makeAdapter(
  config: LlmServerConfig,
  resolved: ResolvedLlmConfig,
): LlmAdapter | null {
  if (config.adapter) return config.adapter;
  if (!resolved.configured || !config.apiKey) return null;
  if (resolved.provider === "anthropic") {
    return new AnthropicAdapter({
      apiKey: config.apiKey.trim(),
      ...(resolved.effort ? { effort: resolved.effort } : {}),
      ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
      ...(resolved.baseUrl && isAllowedBaseUrl(resolved.baseUrl)
        ? { baseURL: resolved.baseUrl }
        : {}),
    });
  }
  return new OpenAiCompatibleAdapter({
    apiKey: config.apiKey.trim(),
    baseUrl: resolved.baseUrl!,
    responseFormat: resolved.responseFormat,
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
  });
}

/** Read the model's text as JSON; tolerate one Markdown code fence around it, nothing more. */
export function readAnswerText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  try {
    return JSON.parse(fenced ? fenced[1]! : trimmed);
  } catch {
    return null;
  }
}

const TRANSIENT = new Set(["rate_limited", "network", "upstream_error"]);

export type LlmDecisionHandler = (
  request: Request,
  meta: RequestMeta,
) => Promise<Response>;

export function createLlmDecisionHandler(config: LlmServerConfig): LlmDecisionHandler {
  const resolved = resolveLlmConfig(config);
  const adapter = makeAdapter(config, resolved);
  const limiter = config.limiter ?? new RateLimiter(DEFAULT_RATE_LIMITS);
  const now = config.now ?? (() => Date.now());
  const sleep =
    config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log =
    config.log ??
    ((event: Record<string, unknown>) => console.warn(JSON.stringify(event)));

  const status = (): Response =>
    json(200, {
      schemaVersion: LLM_DECISION_SCHEMA,
      service: "blacksite-llm",
      configured: resolved.configured && adapter !== null,
      provider: resolved.provider,
      model: resolved.model,
      confidence: resolved.confidence,
      effort: resolved.effort,
      actionContract: ACTION_CONTRACT_VERSION,
      observationSchema: OBSERVATION_SCHEMA_VERSION,
      capabilities: LLM_CAPABILITIES,
      limits: {
        maxBodyBytes: MAX_BODY_BYTES,
        upstreamTimeoutMs: resolved.timeoutMs,
        maxRetries: resolved.maxRetries,
      },
    });

  return async (request, meta) => {
    if (request.method === "GET" || request.method === "HEAD") {
      const admission = limiter.admitClient(meta.clientKey);
      if (!admission.ok) {
        return errorResponse(429, "rate_limited", "Too many requests.", {
          retryAfterMs: admission.retryAfterMs,
        });
      }
      return status();
    }
    if (request.method !== "POST")
      return errorResponse(405, "method_not_allowed", "Use POST.");
    if (!isSameOrigin(request)) {
      return errorResponse(403, "forbidden_origin", "Cross-origin requests are refused.");
    }
    if (!/^application\/json(\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return errorResponse(415, "unsupported_media_type", "Send application/json.");
    }
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return errorResponse(413, "payload_too_large", "The observation is too large.");
    }
    const client = limiter.admitClient(meta.clientKey);
    if (!client.ok) {
      return errorResponse(429, "rate_limited", "Too many requests from this client.", {
        retryAfterMs: client.retryAfterMs,
      });
    }
    if (!adapter || resolved.model === null) {
      return errorResponse(
        503,
        "not_configured",
        resolved.reason ?? "The LLM is not configured.",
      );
    }

    let text: string | null;
    try {
      text = await readBody(request, MAX_BODY_BYTES);
    } catch {
      return errorResponse(
        400,
        "invalid_request",
        "The body could not be read as UTF-8.",
      );
    }
    if (text === null)
      return errorResponse(413, "payload_too_large", "The observation is too large.");
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return errorResponse(400, "invalid_request", "The body is not JSON.");
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return errorResponse(400, "invalid_request", "Expected { session, observation }.");
    }
    const envelope = payload as Record<string, unknown>;
    if (Object.keys(envelope).some((key) => key !== "session" && key !== "observation")) {
      return errorResponse(400, "invalid_request", "Unexpected fields in the request.");
    }
    const session = envelope["session"];
    if (typeof session !== "string" || !SESSION_ID.test(session)) {
      return errorResponse(400, "invalid_request", "The session id is malformed.");
    }
    const parsed = validateObservation(envelope["observation"]);
    if (!parsed.ok)
      return errorResponse(
        400,
        "invalid_request",
        `Invalid observation: ${parsed.error}`,
      );
    const observation = parsed.value;
    const sequence = observation.sequence;
    if (!observation.player.alive) {
      return errorResponse(400, "invalid_request", "No decision is taken while dead.", {
        sequence,
      });
    }
    const pace = limiter.admitSession(session);
    if (!pace.ok) {
      return errorResponse(429, "rate_limited", "Decisions requested too quickly.", {
        sequence,
        retryAfterMs: pace.retryAfterMs,
      });
    }
    const slot = limiter.admitUpstream();
    if (!slot.ok) {
      return errorResponse(429, "rate_limited", "The decision service is busy.", {
        sequence,
        retryAfterMs: slot.retryAfterMs,
      });
    }

    const prompt = buildLlmPrompt(observation, resolved.confidence);
    const started = now();
    const deadline = started + resolved.timeoutMs;
    let retries = 0;
    let result: AdapterResult;
    try {
      for (;;) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - now()));
        try {
          result = await adapter.call({
            prompt,
            model: resolved.model,
            maxTokens: resolved.maxTokens,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (result.ok || !TRANSIENT.has(result.kind) || retries >= resolved.maxRetries)
          break;
        if (
          result.kind === "upstream_error" &&
          result.status !== null &&
          result.status < 500
        )
          break;
        // Keep a quarter second of the deadline for the retry itself; a
        // Retry-After of zero means "now", not "give up".
        const room = deadline - now() - 250;
        if (room <= 0) break;
        await sleep(Math.min(result.retryAfterMs ?? 250 * 2 ** retries, room));
        retries += 1;
      }
    } finally {
      limiter.release();
    }
    const latencyMs = Math.max(0, now() - started);

    if (!result.ok) {
      log({
        event: "llm_decision_error",
        kind: result.kind,
        status: result.status,
        retries,
        sequence,
      });
      switch (result.kind) {
        case "timeout":
          return errorResponse(
            504,
            "upstream_timeout",
            "The model did not answer in time.",
            { sequence },
          );
        case "rate_limited":
          return errorResponse(
            429,
            "upstream_rate_limited",
            "The provider is rate limiting this deployment.",
            {
              sequence,
              retryAfterMs: result.retryAfterMs ?? 1000,
            },
          );
        case "auth":
          return errorResponse(
            502,
            "upstream_auth",
            "The provider rejected the server's credentials.",
            {
              sequence,
            },
          );
        case "refused":
          return errorResponse(
            502,
            "upstream_refused",
            `The model declined to answer (${result.detail}).`,
            {
              sequence,
            },
          );
        default:
          return errorResponse(
            502,
            "upstream_error",
            `The provider failed (${result.detail}).`,
            { sequence },
          );
      }
    }

    const raw = readAnswerText(result.text);
    // Under `none` no confidence is asked for; any the model volunteers is dropped, not kept.
    const answersRaw =
      resolved.confidence === "none" && raw && typeof raw === "object"
        ? Object.fromEntries(
            Object.entries(raw as Record<string, unknown>).map(([axis, answer]) => [
              axis,
              answer && typeof answer === "object"
                ? {
                    choice: (answer as Record<string, unknown>)["choice"],
                    confidence: null,
                  }
                : answer,
            ]),
          )
        : raw;
    const answers = parseLlmAnswers(answersRaw, observation.legal);
    if (!answers.ok) {
      log({ event: "llm_decision_error", kind: "invalid", sequence });
      return errorResponse(
        502,
        "upstream_invalid",
        `The model's answer failed validation: ${answers.error}.`,
        {
          sequence,
        },
      );
    }
    // The served model is what the provider says served the answer. When it
    // says nothing, that is unknown — not the model this server asked for.
    const servedModel = isModelId(result.model) ? result.model : null;
    // Asked for a confidence and wrote none is "none", not "verbalized".
    const wroteConfidence = Object.values(answers.value.answers).some(
      (answer) => answer?.confidence !== null && answer?.confidence !== undefined,
    );
    const decision: LlmDecision = {
      schemaVersion: LLM_DECISION_SCHEMA,
      sequence,
      source: "llm",
      provider: adapter.provider,
      model: servedModel,
      requestedModel: resolved.model,
      frame: answers.value.frame,
      answers: answers.value.answers,
      confidenceSource:
        resolved.confidence === "verbalized" && wroteConfidence ? "verbalized" : "none",
      latencyMs,
      usage:
        result.inputTokens !== null && result.outputTokens !== null
          ? { inputTokens: result.inputTokens, outputTokens: result.outputTokens }
          : null,
      retries,
      traceId: result.traceId,
      questionHash: prompt.questionHash,
    };
    return json(200, decision);
  };
}
