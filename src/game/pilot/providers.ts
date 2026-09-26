import { mulberry32 } from "@/lib/noise";
import type { ControlFrame } from "./contract";
import { readDecisionError, validateDecision } from "./decision";
import { validateObservation, type LegalActions } from "./observation";
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

/**
 * The live TypeSafe Jev brain, through this deployment's own server.
 *
 * The browser sends the observation and nothing else — no prompt, no
 * credential. The server owns the question and the key.
 */
export class JevHttpProvider implements DecisionProvider {
  readonly kind = "jev" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly session: string,
    private readonly endpoint: string = JEV_DECISION_ENDPOINT,
    fetchImpl?: typeof fetch,
  ) {
    // Bound here, not stored bare: `fetch` called off its global throws
    // "Illegal invocation" in browsers.
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async decide({
    sequence,
    observation,
    signal,
  }: DecisionRequest): Promise<ProviderResult> {
    // The server validates too; checking here first turns a bad field into a
    // named local error instead of an opaque 400, and spends no request on it.
    const own = validateObservation(observation);
    if (!own.ok) {
      return {
        ok: false,
        failure: "invalid",
        detail: `observation rejected locally: ${own.error}`,
        retryAfterMs: null,
      };
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: this.session, observation }),
        signal,
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch {
      return signal.aborted
        ? { ok: false, failure: "aborted", detail: "request aborted", retryAfterMs: null }
        : { ok: false, failure: "network", detail: "network error", retryAfterMs: null };
    }

    let body: unknown = null;
    try {
      body = await response.json();
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
            : response.status === 503 ||
                response.status === 404 ||
                response.status === 405 ||
                error?.code === "not_configured" ||
                error?.code === "upstream_auth"
              ? "unavailable"
              : "http_error";
      return {
        ok: false,
        failure,
        detail: error ? `${error.code}: ${error.message}` : `HTTP ${response.status}`,
        retryAfterMs: error?.retryAfterMs ?? null,
      };
    }

    const validated = validateDecision(body, { sequence, legal: observation.legal });
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
 * It draws four numbers per decision — one per axis — whatever the state, so a
 * given seed always consumes the stream identically, and it picks uniformly
 * among the *legal* options it was offered. Same observation, same options,
 * same seed: same sequence of frames. It receives exactly the observation Jev
 * does and uses only its legal lists; it reports no probabilities, because it
 * has none worth reporting beyond "uniform".
 */
export class RandomProvider implements DecisionProvider {
  readonly kind = "random" as const;
  private readonly rand: () => number;

  constructor(readonly seed: number) {
    this.rand = mulberry32(seed >>> 0);
  }

  pick(legal: LegalActions): ControlFrame {
    const draw = <T>(options: readonly T[]): T =>
      options[Math.min(options.length - 1, Math.floor(this.rand() * options.length))]!;
    // Always move, turn, tilt, weapon: the draw order is part of the seed's meaning.
    const move = draw(legal.move);
    const turn = draw(legal.turn);
    const tilt = draw(legal.tilt);
    const weapon = draw(legal.weapon);
    return { move, turn, tilt, weapon };
  }

  decide({ observation }: DecisionRequest): Promise<ProviderResult> {
    return Promise.resolve({
      ok: true,
      decision: {
        frame: this.pick(observation.legal),
        axes: null,
        model: null,
        serverLatencyMs: null,
        usage: null,
      },
    });
  }
}

/** A fresh per-page session id for the server's pacing limit. Not an identity. */
export function newSessionId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
