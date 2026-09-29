import { mulberry32 } from "@/lib/noise";
import type { ControlFrame, ControlMode, NavigationMode } from "./contract";
import { readDecisionError, validateDecision } from "./decision";
import { validateLlmDecision } from "./llmDecision";
import { validateObservation, type LegalActions } from "./observation";
import {
  confidenceFromAxes,
  localAccounting,
  utf8Bytes,
  type BrainDescriptor,
} from "./brain";
import {
  JEV_CAPABILITIES,
  LLM_CAPABILITIES,
  LOCAL_POLICY_CAPABILITIES,
} from "./capabilities";
import type { DecisionConfidence } from "../eval/records";
import type {
  DecisionProvider,
  DecisionRequest,
  FailureKind,
  ProviderResult,
} from "./loop";

/**
 * The brains that can sit behind the decision loop.
 *
 * Both answer the same question from the same observation with the same legal
 * options, and both hand back a control frame the executor validates again.
 * Neither can reach game state: a provider's entire output is three strings
 * from the action contract.
 */

export const JEV_DECISION_ENDPOINT = "/api/jev/decision";
export const LLM_DECISION_ENDPOINT = "/api/llm/decision";

type Posted =
  | {
      ok: true;
      status: number;
      body: unknown;
      requestBytes: number;
      responseBytes: number;
    }
  | { ok: false; result: ProviderResult };

/**
 * POST one observation to this deployment's own decision endpoint. The browser
 * sends `{ session, observation }` and nothing else — no prompt, no
 * credential; the server owns the question and the key. Shared by every
 * remote brain so they are measured the same way: request and response sizes
 * are the bytes on the wire as the page saw them.
 */
async function postObservation(
  fetchImpl: typeof fetch,
  endpoint: string,
  session: string,
  request: DecisionRequest,
): Promise<Posted> {
  const { observation, signal } = request;
  // The server validates too; checking here first turns a bad field into a
  // named local error instead of an opaque 400, and spends no request on it.
  const own = validateObservation(observation);
  if (!own.ok) {
    return {
      ok: false,
      result: {
        ok: false,
        failure: "invalid",
        detail: `observation rejected locally: ${own.error}`,
        retryAfterMs: null,
      },
    };
  }
  const payload = JSON.stringify({ session, observation });
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return {
      ok: false,
      result: signal.aborted
        ? { ok: false, failure: "aborted", detail: "request aborted", retryAfterMs: null }
        : { ok: false, failure: "network", detail: "network error", retryAfterMs: null },
    };
  }
  let text = "";
  try {
    text = await response.text();
  } catch {
    text = "";
  }
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = readDecisionError(body);
    const failure: FailureKind =
      response.status === 504 || error?.code === "upstream_timeout"
        ? "timeout"
        : response.status === 429
          ? "rate_limited"
          : error?.code === "upstream_refused"
            ? "refused"
            : response.status === 503 ||
                response.status === 404 ||
                response.status === 405 ||
                error?.code === "not_configured" ||
                error?.code === "upstream_auth"
              ? "unavailable"
              : error?.code === "upstream_invalid"
                ? "invalid"
                : "http_error";
    return {
      ok: false,
      result: {
        ok: false,
        failure,
        detail: error ? `${error.code}: ${error.message}` : `HTTP ${response.status}`,
        retryAfterMs: error?.retryAfterMs ?? null,
      },
    };
  }
  return {
    ok: true,
    status: response.status,
    body,
    requestBytes: utf8Bytes(payload),
    responseBytes: utf8Bytes(text),
  };
}

/** Bound here, not stored bare: `fetch` called off its global throws "Illegal invocation" in browsers. */
const boundFetch = (fetchImpl?: typeof fetch): typeof fetch =>
  fetchImpl ?? ((input, init) => fetch(input, init));

/** The live TypeSafe Jev brain, through this deployment's own server. */
export class JevHttpProvider implements DecisionProvider {
  readonly kind = "jev" as const;
  readonly descriptor: BrainDescriptor = {
    id: "jev",
    kind: "jev",
    provider: "typesafe",
    model: null,
    capabilities: JEV_CAPABILITIES,
    confidence: "provider-probability",
  };
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly session: string,
    private readonly endpoint: string = JEV_DECISION_ENDPOINT,
    fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = boundFetch(fetchImpl);
  }

  async decide(request: DecisionRequest): Promise<ProviderResult> {
    const posted = await postObservation(
      this.fetchImpl,
      this.endpoint,
      this.session,
      request,
    );
    if (!posted.ok) return posted.result;
    const { sequence, observation } = request;
    const validated = validateDecision(posted.body, {
      sequence,
      legal: observation.legal,
    });
    if (!validated.ok) {
      return {
        ok: false,
        failure: "invalid",
        detail: validated.error,
        retryAfterMs: null,
      };
    }
    const decision = validated.value;
    return {
      ok: true,
      decision: {
        frame: decision.frame,
        axes: decision.axes,
        model: decision.model,
        serverLatencyMs: decision.latencyMs,
        usage: decision.usage,
        confidence: confidenceFromAxes(decision.axes),
        accounting: {
          provider: "typesafe",
          model: decision.model,
          providerLatencyMs: decision.latencyMs,
          requestBytes: posted.requestBytes,
          responseBytes: posted.responseBytes,
          inputTokens: decision.usage?.inputTokens ?? null,
          outputTokens: decision.usage?.outputTokens ?? null,
          reportedCostUsd: null,
          // The Jev handler makes one upstream attempt and never retries.
          retries: 0,
          traceId: null,
          questionHash: decision.questionHash ?? null,
        },
      },
    };
  }
}

/**
 * A conventional LLM, through this deployment's own server
 * (`server/llm/handler.ts`). The same observation, the same legal options and
 * the same question text Jev is asked; the provider and model are server
 * configuration, not part of this class. Its confidence, when present, is
 * verbalized — a number the model wrote — and is labelled so.
 */
export class LlmHttpProvider implements DecisionProvider {
  readonly kind = "llm" as const;
  readonly descriptor: BrainDescriptor = {
    id: "llm",
    kind: "llm",
    provider: "unknown until the first answer",
    model: null,
    capabilities: LLM_CAPABILITIES,
    confidence: "verbalized",
  };
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly session: string,
    private readonly endpoint: string = LLM_DECISION_ENDPOINT,
    fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = boundFetch(fetchImpl);
  }

  async decide(request: DecisionRequest): Promise<ProviderResult> {
    const posted = await postObservation(
      this.fetchImpl,
      this.endpoint,
      this.session,
      request,
    );
    if (!posted.ok) return posted.result;
    const { sequence, observation } = request;
    const validated = validateLlmDecision(posted.body, {
      sequence,
      legal: observation.legal,
    });
    if (!validated.ok) {
      return {
        ok: false,
        failure: "invalid",
        detail: validated.error,
        retryAfterMs: null,
      };
    }
    const d = validated.value;
    const perAxis: DecisionConfidence["perAxis"] = {};
    for (const [axis, answer] of Object.entries(d.answers)) {
      if (answer)
        perAxis[axis as keyof typeof perAxis] = {
          probability: null,
          confidence: answer.confidence,
        };
    }
    return {
      ok: true,
      decision: {
        frame: d.frame,
        // `axes` is TypeSafe's shape, with a full distribution per axis; an
        // LLM has none, so it stays null and the confidence travels separately.
        axes: null,
        model: d.model,
        serverLatencyMs: d.latencyMs,
        usage: d.usage,
        confidence: {
          source: d.confidenceSource,
          perAxis: d.confidenceSource === "none" ? {} : perAxis,
        },
        accounting: {
          provider: d.provider,
          model: d.model,
          providerLatencyMs: d.latencyMs,
          requestBytes: posted.requestBytes,
          responseBytes: posted.responseBytes,
          inputTokens: d.usage?.inputTokens ?? null,
          outputTokens: d.usage?.outputTokens ?? null,
          reportedCostUsd: null,
          retries: d.retries,
          traceId: d.traceId,
          questionHash: d.questionHash,
        },
      },
    };
  }
}

export interface JevServiceStatus {
  available: boolean;
  /** The alias the server is configured to ask for; versions come per decision. */
  model: string | null;
  detail: string;
}

/** Ask the endpoint whether it is configured. Costs no TypeSafe call. */
export async function probeJevService(
  endpoint: string = JEV_DECISION_ENDPOINT,
  signal?: AbortSignal,
): Promise<JevServiceStatus> {
  try {
    const response = await fetch(endpoint, { method: "GET", cache: "no-store", signal });
    const body = (await response.json().catch(() => null)) as {
      configured?: unknown;
      model?: unknown;
    } | null;
    if (!response.ok || !body) {
      return {
        available: false,
        model: null,
        detail: `No decision service on this deployment (HTTP ${response.status}).`,
      };
    }
    if (body.configured !== true) {
      return {
        available: false,
        model: null,
        // The variable's name is deliberately not spelled out here: nothing
        // about the credential, not even what it is called, ships to browsers.
        detail: "The decision service has no API key configured on this deployment.",
      };
    }
    return {
      available: true,
      model: typeof body.model === "string" ? body.model.slice(0, 64) : null,
      detail: "ready",
    };
  } catch {
    return {
      available: false,
      model: null,
      detail: "The decision service is unreachable.",
    };
  }
}

/**
 * The seeded random baseline.
 *
 * In direct control it draws four numbers per decision — one per axis —
 * whatever the state, exactly as it always has, so a seed's frames are
 * unchanged. In precision control it draws six: the same four, then the target
 * slot and the aim region. Either way a given seed consumes the stream
 * identically, and it picks uniformly among the *legal* options it was offered. Same observation, same options,
 * same seed: same sequence of frames. It receives exactly the observation Jev
 * does and uses only its legal lists; it reports no probabilities, because it
 * has none worth reporting beyond "uniform".
 */
export class RandomProvider implements DecisionProvider {
  readonly kind = "random" as const;
  readonly descriptor: BrainDescriptor = {
    id: "random",
    kind: "random",
    provider: "local",
    model: null,
    capabilities: LOCAL_POLICY_CAPABILITIES,
    confidence: "none",
  };
  private readonly rand: () => number;

  constructor(readonly seed: number) {
    this.rand = mulberry32(seed >>> 0);
  }

  pick(
    legal: LegalActions,
    control: ControlMode = "direct",
    navigation: NavigationMode = "steps",
  ): ControlFrame {
    const draw = <T>(options: readonly T[]): T =>
      options[Math.min(options.length - 1, Math.floor(this.rand() * options.length))]!;
    // Always move, turn, tilt, weapon: the draw order is part of the seed's
    // meaning. Precision adds target and aim; places adds the destination, last,
    // so a seed's frames under the older interfaces are unchanged.
    const move = draw(legal.move);
    const turn = draw(legal.turn);
    const tilt = draw(legal.tilt);
    const weapon = draw(legal.weapon);
    const target = control === "precision" ? draw(legal.target) : legal.target[0]!;
    const aim = control === "precision" ? draw(legal.aim) : legal.aim[0]!;
    const go = navigation === "places" ? draw(legal.go) : legal.go[0]!;
    return { move, turn, tilt, weapon, target, aim, go };
  }

  decide({ observation }: DecisionRequest): Promise<ProviderResult> {
    return Promise.resolve({
      ok: true,
      decision: {
        frame: this.pick(observation.legal, observation.control, observation.navigation),
        axes: null,
        model: null,
        serverLatencyMs: null,
        usage: null,
        confidence: { source: "none", perAxis: {} },
        accounting: localAccounting(),
      },
    });
  }
}

/**
 * A local brain whose answers arrive late, for measuring what latency costs.
 *
 * The inner brain decides on the observation at once — the observation was
 * captured when the request was issued, as a remote model's would be — and the
 * answer is held for `delayMs` before the loop sees it. The loop's own rules
 * then apply unchanged: one request in flight, staleness, timeouts. It is only
 * ever wrapped round the random and scripted brains, never round Jev.
 */
export class DelayedProvider implements DecisionProvider {
  readonly kind: DecisionProvider["kind"];
  readonly descriptor: BrainDescriptor | undefined;

  constructor(
    private readonly inner: DecisionProvider,
    readonly delayMs: number,
  ) {
    this.kind = inner.kind;
    this.descriptor = inner.descriptor;
  }

  async decide(request: DecisionRequest): Promise<ProviderResult> {
    const result = await this.inner.decide(request);
    return new Promise((resolve) => {
      const aborted = (): void => {
        clearTimeout(timer);
        resolve({
          ok: false,
          failure: "aborted",
          detail: "request aborted",
          retryAfterMs: null,
        });
      };
      const timer = setTimeout(() => {
        request.signal.removeEventListener("abort", aborted);
        resolve(result);
      }, this.delayMs);
      if (request.signal.aborted) aborted();
      else request.signal.addEventListener("abort", aborted, { once: true });
    });
  }
}

/** A fresh per-page session id for the server's pacing limit. Not an identity. */
export function newSessionId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
