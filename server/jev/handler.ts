import {
  ACTION_CONTRACT_VERSION,
  DECISION_SCHEMA_VERSION,
  OBSERVATION_SCHEMA_VERSION,
  UPSTREAM_TIMEOUT_MS,
} from "../../src/game/pilot/contract.js";
import {
  frameOf,
  isModelId,
  parseAllAxes,
  type DecisionErrorBody,
  type DecisionErrorCode,
  type JevDecision,
} from "../../src/game/pilot/decision.js";
import { validateObservation } from "../../src/game/pilot/observation.js";
import { buildSystemOneRequest } from "./question.js";
import { DEFAULT_RATE_LIMITS, RateLimiter } from "./rateLimit.js";

/**
 * `POST /api/jev/decision` — the only place the TypeSafe credential is used.
 *
 * The handler takes a Web `Request` and returns a Web `Response`, so the Vercel
 * function (`api/jev/decision.ts`) and the local Vite middleware
 * (`vite.config.ts`) run exactly this code. It:
 *
 *  - accepts only a same-origin JSON body under 8 KiB holding a session id and
 *    one observation that passes `validateObservation` — every field typed,
 *    bounded and drawn from a closed vocabulary;
 *  - builds the TypeSafe question itself, so the browser can never choose what
 *    is asked (the endpoint is not a prompt proxy);
 *  - calls TypeSafe with a timeout, and validates every answer against the
 *    options it offered before anything is returned;
 *  - returns the three axis answers with TypeSafe's own probabilities,
 *    confidence and the concrete model version it reports.
 *
 * The API key is read from the environment by the caller and passed in. It is
 * sent to TypeSafe in the `Authorization` header and nowhere else: it is never
 * logged, never echoed, and never part of an error.
 */

export const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_MODEL = "jev-latest";
export const MAX_BODY_BYTES = 8192;

const SESSION_ID = /^[a-f0-9]{16,64}$/;

export interface JevServerConfig {
  /** The `TYPESAFE_API_KEY` value, read by the entry point. Absent means 503. */
  apiKey: string | undefined;
  /** The `TYPESAFE_MODEL` value; a missing or malformed one means `jev-latest`. */
  model?: string | undefined;
  fetchImpl?: typeof fetch;
  limiter?: RateLimiter;
  now?: () => number;
  endpoint?: string;
  timeoutMs?: number;
  /** Structured error log. Never receives the key, the body or TypeSafe's reply. */
  log?: (event: Record<string, unknown>) => void;
}

export interface RequestMeta {
  /** Client address, for the per-client rate limit. */
  clientKey: string;
}

export type JevDecisionHandler = (
  request: Request,
  meta: RequestMeta,
) => Promise<Response>;

/** The model to ask: a well-formed `TYPESAFE_MODEL`, or `jev-latest`. */
export function resolveModel(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && isModelId(trimmed) ? trimmed : DEFAULT_MODEL;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

function json(
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

function errorResponse(
  status: number,
  code: DecisionErrorCode,
  message: string,
  options: { sequence?: number | null; retryAfterMs?: number | null } = {},
): Response {
  const retryAfterMs = options.retryAfterMs ?? null;
  const body: DecisionErrorBody = {
    schemaVersion: DECISION_SCHEMA_VERSION,
    sequence: options.sequence ?? null,
    error: { code, message },
    retryAfterMs,
  };
  const extra: Record<string, string> =
    retryAfterMs !== null
      ? { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) }
      : {};
  if (status === 405) extra["Allow"] = "GET, POST";
  return json(status, body, extra);
}

/**
 * Browsers label cross-site requests; a same-origin page never sends a
 * mismatched `Origin`. Non-browser clients send neither and fall to the rate
 * limits, which is the protection that applies to them.
 */
function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function readBody(request: Request, limit: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function retryAfterHeader(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(60_000, Math.round(seconds * 1000));
}

export function createJevDecisionHandler(config: JevServerConfig): JevDecisionHandler {
  const fetchImpl = config.fetchImpl ?? fetch;
  const limiter = config.limiter ?? new RateLimiter(DEFAULT_RATE_LIMITS);
  const now = config.now ?? (() => Date.now());
  const endpoint = config.endpoint ?? TYPESAFE_ENDPOINT;
  const timeoutMs = config.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const model = resolveModel(config.model);
  const apiKey = config.apiKey?.trim() || undefined;
  const log =
    config.log ??
    ((event: Record<string, unknown>) => console.warn(JSON.stringify(event)));

  const status = (): Response =>
    json(200, {
      schemaVersion: DECISION_SCHEMA_VERSION,
      service: "blacksite-jev",
      configured: apiKey !== undefined,
      model,
      actionContract: ACTION_CONTRACT_VERSION,
      observationSchema: OBSERVATION_SCHEMA_VERSION,
      limits: {
        maxBodyBytes: MAX_BODY_BYTES,
        minIntervalMs: DEFAULT_RATE_LIMITS.sessionMinIntervalMs,
        upstreamTimeoutMs: timeoutMs,
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
    if (request.method !== "POST") {
      return errorResponse(405, "method_not_allowed", "Use POST.");
    }
    if (!isSameOrigin(request)) {
      return errorResponse(403, "forbidden_origin", "Cross-origin requests are refused.");
    }
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^application\/json(\s*;|$)/i.test(contentType)) {
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
    if (apiKey === undefined) {
      return errorResponse(503, "not_configured", "TYPESAFE_API_KEY is not configured.");
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
    if (text === null) {
      return errorResponse(413, "payload_too_large", "The observation is too large.");
    }
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
    const extraKeys = Object.keys(envelope).filter(
      (key) => key !== "session" && key !== "observation",
    );
    if (extraKeys.length > 0) {
      return errorResponse(400, "invalid_request", "Unexpected fields in the request.");
    }
    const session = envelope["session"];
    if (typeof session !== "string" || !SESSION_ID.test(session)) {
      return errorResponse(400, "invalid_request", "The session id is malformed.");
    }
    const parsed = validateObservation(envelope["observation"]);
    if (!parsed.ok) {
      return errorResponse(
        400,
        "invalid_request",
        `Invalid observation: ${parsed.error}`,
      );
    }
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

    const body = JSON.stringify(buildSystemOneRequest(observation, model));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = now();
    let upstream: Response;
    try {
      upstream = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
      });
    } catch {
      // The error object can carry request details; only its kind is kept.
      clearTimeout(timer);
      limiter.release();
      const timedOut = controller.signal.aborted;
      log({
        event: "jev_decision_error",
        code: timedOut ? "upstream_timeout" : "upstream_error",
        sequence,
      });
      return timedOut
        ? errorResponse(504, "upstream_timeout", "TypeSafe did not answer in time.", {
            sequence,
          })
        : errorResponse(502, "upstream_error", "TypeSafe could not be reached.", {
            sequence,
          });
    }

    let answer: unknown;
    try {
      if (!upstream.ok) {
        // The body is TypeSafe's, not ours to relay; only the status is used.
        await upstream.body?.cancel();
        const code: DecisionErrorCode =
          upstream.status === 401 || upstream.status === 403
            ? "upstream_auth"
            : upstream.status === 429 || upstream.status === 529
              ? "upstream_rate_limited"
              : upstream.status === 422
                ? "upstream_invalid"
                : "upstream_error";
        log({
          event: "jev_decision_error",
          code,
          upstreamStatus: upstream.status,
          sequence,
        });
        if (code === "upstream_rate_limited") {
          return errorResponse(429, code, "TypeSafe is rate limiting this deployment.", {
            sequence,
            retryAfterMs: retryAfterHeader(upstream.headers.get("retry-after")) ?? 1000,
          });
        }
        return errorResponse(
          502,
          code,
          code === "upstream_auth"
            ? "TypeSafe rejected the server's credentials."
            : code === "upstream_invalid"
              ? "TypeSafe rejected the question."
              : `TypeSafe returned HTTP ${upstream.status}.`,
          { sequence },
        );
      }
      answer = await upstream.json();
    } catch {
      log({ event: "jev_decision_error", code: "upstream_invalid", sequence });
      return errorResponse(502, "upstream_invalid", "TypeSafe returned malformed JSON.", {
        sequence,
      });
    } finally {
      clearTimeout(timer);
      limiter.release();
    }
    const latencyMs = Math.max(0, now() - started);

    const reply = answer as {
      model?: unknown;
      answers?: Record<string, unknown>;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };
    const answers = reply?.answers;
    if (!isModelId(reply?.model) || typeof answers !== "object" || answers === null) {
      log({ event: "jev_decision_error", code: "upstream_invalid", sequence });
      return errorResponse(
        502,
        "upstream_invalid",
        "TypeSafe's reply is missing fields.",
        {
          sequence,
        },
      );
    }
    const parsedAxes = parseAllAxes(answers, observation.legal);
    if (!parsedAxes.ok) {
      log({ event: "jev_decision_error", code: "upstream_invalid", sequence });
      return errorResponse(
        502,
        "upstream_invalid",
        `TypeSafe's answer failed validation: ${parsedAxes.error}.`,
        { sequence },
      );
    }
    const axes = parsedAxes.value;

    const inputTokens = reply.usage?.input_tokens;
    const outputTokens = reply.usage?.output_tokens;
    const decision: JevDecision = {
      schemaVersion: DECISION_SCHEMA_VERSION,
      sequence,
      source: "typesafe",
      model: reply.model,
      frame: frameOf(axes),
      axes,
      latencyMs,
      usage:
        typeof inputTokens === "number" &&
        typeof outputTokens === "number" &&
        Number.isInteger(inputTokens) &&
        Number.isInteger(outputTokens)
          ? { inputTokens, outputTokens }
          : null,
    };
    return json(200, decision);
  };
}

/** Client address as the platform reports it. Vercel overwrites these headers. */
export function clientKeyFrom(headers: Headers, fallback: string): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded.slice(0, 64);
  return fallback.slice(0, 64);
}
