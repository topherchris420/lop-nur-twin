import { GLIDE_CAPABILITIES } from "../../src/game/pilot/capabilities.js";
import {
  createSystemOneDecisionHandler,
  type JevDecisionHandler,
  type JevServerConfig,
  type SystemOneUpstream,
} from "../jev/handler.js";

/**
 * `POST /api/glide/decision` — Fastino's Glide in the player's seat, and the
 * only place the Fastino credential is used.
 *
 * Fastino serves the SystemOne Choice protocol TypeSafe does: the same state,
 * the same parallel Choice questions, and per question a choice, a confidence
 * and a probability for every option. So this is the Jev handler
 * (`server/jev/handler.ts`) pointed at Fastino — same body limits, same-origin
 * rule, rate limits, question builder and answer validation — and Glide is
 * asked exactly the words Jev is (`server/glide/handler.test.ts` holds that).
 *
 * What differs is stated here, not compensated for:
 *
 *  - **Instructions are one string.** Fastino refuses the `{ context,
 *    question }` object with a 422; the same context and question are joined
 *    with a blank line (`joinInstructions` in `server/jev/question.ts`).
 *  - **Model ids name the provider.** Fastino's are `fastino/glide`, or a
 *    fine-tuned model's training-job UUID; the reply names the model it ran
 *    (`glide`), and that is what every decision records.
 *  - **It is slower.** The upstream timeout is 7.5 s, against Jev's 1.8 s, and
 *    `GLIDE_CAPABILITIES` declares the matching limits for the seat.
 *  - **The source is `fastino`**, so the browser never accepts one provider's
 *    answer as the other's, and the HUD labels it LIVE GLIDE, never LIVE JEV.
 *
 * No Bethesda city observation is answered here: the city is Jev's.
 */

export const FASTINO_ENDPOINT = "https://api.fastino.ai/v1/systemone";
export const GLIDE_DEFAULT_MODEL = "fastino/glide";
export const GLIDE_UPSTREAM_TIMEOUT_MS = 7_500;

/** `provider/name`, a bare name, or a fine-tuned model's training-job UUID. */
const FASTINO_MODEL_ID =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9._:-]{0,63})?$/;

export function isFastinoModelId(value: string): boolean {
  return FASTINO_MODEL_ID.test(value);
}

export const FASTINO_UPSTREAM: SystemOneUpstream = {
  source: "fastino",
  name: "Fastino",
  service: "blacksite-glide",
  endpoint: FASTINO_ENDPOINT,
  defaultModel: GLIDE_DEFAULT_MODEL,
  isRequestModel: isFastinoModelId,
  keyVariable: "FASTINO_API_KEY",
  instructions: "text",
  capabilities: GLIDE_CAPABILITIES,
  timeoutMs: GLIDE_UPSTREAM_TIMEOUT_MS,
  logEvent: "glide_decision_error",
};

/**
 * The key comes from the entry point's environment (`FASTINO_API_KEY`) and is
 * sent to Fastino in the `Authorization` header only; the model from
 * `FASTINO_MODEL`, `fastino/glide` when unset or malformed.
 */
export function createGlideDecisionHandler(config: JevServerConfig): JevDecisionHandler {
  return createSystemOneDecisionHandler(FASTINO_UPSTREAM, config);
}
