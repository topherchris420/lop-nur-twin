import { clientKeyFrom } from "../../server/jev/handler.js";
import { createGlideDecisionHandler } from "../../server/glide/handler.js";

/**
 * Vercel Function: `POST /api/glide/decision`.
 *
 * Fastino's Glide for the player's seat. The credential lives in the project's
 * environment variables (`FASTINO_API_KEY`, optionally `FASTINO_MODEL`) and is
 * read here, on the server, only — it is not `VITE_`-prefixed, so Vite never
 * inlines it, and the handler never echoes it. Without it the endpoint answers
 * 503 and Blacksite shows GLIDE UNAVAILABLE. All behaviour is in
 * `server/glide/handler.ts`, shared with the Vite middleware.
 */
const handle = createGlideDecisionHandler({
  apiKey: process.env["FASTINO_API_KEY"],
  model: process.env["FASTINO_MODEL"],
});

export default {
  fetch(request: Request): Promise<Response> {
    return handle(request, { clientKey: clientKeyFrom(request.headers, "unknown") });
  },
};
