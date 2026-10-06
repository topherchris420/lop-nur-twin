import { clientKeyFrom } from "../../server/jev/handler.js";
import { createRainHandler } from "../../server/rain/handler.js";
import { configureRuntime } from "../../src/rain/runtime.js";

/**
 * The R.A.I.N. research runtime's configuration, read on the server only.
 *
 * The `RAIN_*` settings (`RAIN_RUNTIME`, the meeting engine, the model
 * endpoint, decision routing, the registry directory) are read here from the
 * environment and handed to the runtime; the two credentials it can use —
 * `TYPESAFE_API_KEY` for Jev as a decision engine and `RAIN_LLM_API_KEY` for a
 * model server that wants a bearer token — are read here by name and passed
 * by value, so no module under `src/` names them. Nothing is `VITE_`-prefixed,
 * so Vite never inlines anything. With `RAIN_RUNTIME=off` every route answers
 * "not configured" and the lab runs OFFLINE. Vercel does not deploy
 * underscore-prefixed files as functions; the route files beside this one
 * import it.
 */
const handle = createRainHandler({
  runtime: configureRuntime({
    env: process.env,
    secrets: {
      typesafeApiKey: process.env["TYPESAFE_API_KEY"],
      typesafeModel: process.env["TYPESAFE_MODEL"],
      modelApiKey: process.env["RAIN_LLM_API_KEY"],
    },
    cwd: process.cwd(),
  }),
});

export const rainRoute = {
  fetch(request: Request): Promise<Response> {
    return handle(request, { clientKey: clientKeyFrom(request.headers, "unknown") });
  },
};
