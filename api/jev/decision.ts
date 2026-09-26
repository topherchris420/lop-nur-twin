import { clientKeyFrom, createJevDecisionHandler } from "../../server/jev/handler.js";

/**
 * Vercel Function: `POST /api/jev/decision`.
 *
 * The TypeSafe credential lives in the project's environment variables
 * (`TYPESAFE_API_KEY`, optionally `TYPESAFE_MODEL`) and is read here, on the
 * server, only. Nothing in `src/` can see it: it is not `VITE_`-prefixed, so
 * Vite never inlines it, and the handler never echoes it. Without it the
 * endpoint answers 503 and Blacksite shows JEV UNAVAILABLE.
 *
 * All behaviour — validation, rate limiting, the TypeSafe question, answer
 * validation — is in `server/jev/handler.ts`, shared with the local Vite
 * middleware so development runs the same code as production.
 */
const handle = createJevDecisionHandler({
  apiKey: process.env["TYPESAFE_API_KEY"],
  model: process.env["TYPESAFE_MODEL"],
});

export default {
  fetch(request: Request): Promise<Response> {
    return handle(request, { clientKey: clientKeyFrom(request.headers, "unknown") });
  },
};
