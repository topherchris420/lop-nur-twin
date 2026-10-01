import {
  CITY_SCHEMA,
  DESCRIPTIONS,
  validateObservation,
  validateProposal,
} from "../../src/bethesda/contract.js";
import { canonicalHash } from "../../src/game/pilot/hash.js";
import {
  isSameOrigin,
  json,
  readBody,
  resolveModel,
  TYPESAFE_ENDPOINT,
  MAX_BODY_BYTES,
  SESSION_ID,
  type JevServerConfig,
  type RequestMeta,
} from "./handler.js";
import { RateLimiter, DEFAULT_RATE_LIMITS } from "./rateLimit.js";
export function createCityDecisionHandler(config: JevServerConfig) {
  const limiter = new RateLimiter({
    ...DEFAULT_RATE_LIMITS,
    sessionMinIntervalMs: 2000,
    perClient: { capacity: 3, refillPerSecond: 0.5 },
    maxInFlight: 2,
  });
  const fetchImpl = config.fetchImpl ?? fetch;
  return async (request: Request, meta: RequestMeta): Promise<Response> => {
    if (request.method !== "POST") return json(405, { error: "POST required" });
    if (!isSameOrigin(request)) return json(403, { error: "same origin required" });
    if (!request.headers.get("content-type")?.includes("application/json"))
      return json(415, { error: "JSON required" });
    let body: unknown;
    try {
      const raw = await readBody(request, MAX_BODY_BYTES);
      if (raw === null) return json(413, { error: "body too large" });
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: "invalid JSON" });
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return json(400, { error: "invalid envelope" });
    const v = body as Record<string, unknown>;
    if (
      Object.keys(v).some((k) => !["session", "observation"].includes(k)) ||
      typeof v.session !== "string" ||
      !SESSION_ID.test(v.session) ||
      !validateObservation(v.observation)
    )
      return json(400, { error: "invalid city observation" });
    const o = v.observation;
    if (!config.apiKey) return json(503, { error: "unavailable", schema: CITY_SCHEMA });
    if (!limiter.admitClient(meta.clientKey).ok || !limiter.admitSession(v.session).ok)
      return json(429, { error: "rate limited" });
    if (!limiter.admitUpstream().ok) return json(429, { error: "busy" });
    const question = {
      model: resolveModel(config.model),
      state: {
        simulation: "Illustrative Bethesda city",
        kind: o.kind,
        hazard: o.hazard,
        hazard_distance_m: o.hazardDistance,
        traffic_nearby: o.trafficNearby,
        crossing: o.crossing,
        crossing_safe: o.safeToCross,
        blocked: o.blocked,
        at_building_portal: o.atPortal,
        at_public_gathering: o.atGathering,
      },
      questions: {
        action: {
          type: "choice",
          instructions: {
            context:
              "Select a permitted response for this simulated city agent. The host validates movement and traffic rules.",
            question: "Which action does this agent attempt next?",
          },
          criteria: Object.fromEntries(o.candidates.map((a) => [a, DESCRIPTIONS[a]])),
        },
      },
    };
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 1000),
      start = Date.now();
    try {
      const response = await fetchImpl(config.endpoint ?? TYPESAFE_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(question),
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        return json(502, { error: "provider unavailable" });
      }
      const data = (await response.json()) as {
        model?: unknown;
        answers?: {
          action?: { choice?: unknown; confidence?: unknown; probabilities?: unknown };
        };
      };
      const a = data.answers?.action;
      const proposal = {
        sequence: o.sequence,
        agentId: o.agentId,
        action: a?.choice,
        model: data.model,
        confidence: a?.confidence,
        probabilities: a?.probabilities,
      };
      if (!validateProposal(proposal, o))
        return json(502, { error: "invalid provider answer" });
      return json(200, {
        ...proposal,
        latencyMs: Date.now() - start,
        questionHash: canonicalHash(question),
        usage: null,
      });
    } catch {
      return json(controller.signal.aborted ? 504 : 502, {
        error: controller.signal.aborted ? "timeout" : "provider error",
      });
    } finally {
      clearTimeout(timer);
      limiter.release();
    }
  };
}
