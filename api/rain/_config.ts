import { clientKeyFrom } from "../../server/jev/handler.js";
import {
  PROPOSAL_FUNCTION_MAX_DURATION_S,
  createRainHandler,
  substrateRequest,
} from "../../server/rain/handler.js";
import { configureRuntime } from "../../src/rain/runtime.js";

/**
 * The R.A.I.N. research runtime's configuration, read on the server only.
 *
 * The `RAIN_*` settings (`RAIN_RUNTIME`, the meeting engine, the model
 * endpoint, decision routing, the registry directory) are read here from the
 * environment and handed to the runtime; the secrets it can use —
 * `TYPESAFE_API_KEY` for Jev as a decision engine, `RAIN_LLM_API_KEY` for a
 * model server that wants a bearer token, and `RAIN_REGISTRY_SECRET`, the key
 * every function instance shares to check a pre-registration another made —
 * are read here by name and passed by value, so no module under `src/` names
 * them. Nothing is `VITE_`-prefixed,
 * so Vite never inlines anything. With `RAIN_RUNTIME=off` every route answers
 * "not configured" and the lab runs OFFLINE. Vercel does not deploy
 * underscore-prefixed files as functions; the route files beside this one
 * import it. A proposal waits up to `RAIN_DECISION_TIMEOUT` on the decision
 * router, so the route is told that setting and the proposal function's
 * `maxDuration`; a timeout that cannot fit inside it is refused by name.
 */
const handle = createRainHandler({
  runtime: configureRuntime({
    env: process.env,
    secrets: {
      typesafeApiKey: process.env["TYPESAFE_API_KEY"],
      typesafeModel: process.env["TYPESAFE_MODEL"],
      modelApiKey: process.env["RAIN_LLM_API_KEY"],
      registrySecret: process.env["RAIN_REGISTRY_SECRET"],
    },
    cwd: process.cwd(),
  }),
  decisionTimeout: process.env["RAIN_DECISION_TIMEOUT"],
  proposalLimitMs: PROPOSAL_FUNCTION_MAX_DURATION_S * 1000,
});

export const rainRoute = {
  fetch(request: Request): Promise<Response> {
    return handle(request, { clientKey: clientKeyFrom(request.headers, "unknown") });
  },
};

/** The substrate's three routes, rewritten to one function (`api/rain/math.ts`). */
export const substrateRoute = {
  fetch(request: Request): Promise<Response> {
    return rainRoute.fetch(substrateRequest(request));
  },
};
