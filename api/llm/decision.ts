import { clientKeyFrom } from "../../server/jev/handler.js";
import { createLlmDecisionHandler } from "../../server/llm/handler.js";

/**
 * Vercel Function: `POST /api/llm/decision`.
 *
 * A conventional LLM for the player's seat. Provider, model and credential are
 * project environment variables read here, on the server, only — none is
 * `VITE_`-prefixed, so Vite never inlines them. Without a provider and a key
 * the endpoint answers 503 and Blacksite shows LLM UNAVAILABLE. All behaviour is
 * in `server/llm/handler.ts`, shared with the Vite middleware.
 */
const handle = createLlmDecisionHandler({
  provider: process.env["LLM_PROVIDER"],
  apiKey: process.env["LLM_API_KEY"],
  model: process.env["LLM_MODEL"],
  baseUrl: process.env["LLM_BASE_URL"],
  effort: process.env["LLM_EFFORT"],
  confidence: process.env["LLM_CONFIDENCE"],
  timeoutMs: process.env["LLM_TIMEOUT_MS"],
  maxRetries: process.env["LLM_MAX_RETRIES"],
  maxTokens: process.env["LLM_MAX_TOKENS"],
  responseFormat: process.env["LLM_RESPONSE_FORMAT"],
});

export default {
  fetch(request: Request): Promise<Response> {
    return handle(request, { clientKey: clientKeyFrom(request.headers, "unknown") });
  },
};
