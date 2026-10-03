import { clientKeyFrom } from "../../server/jev/handler.js";
import { createRainHandler } from "../../server/rain/handler.js";

/**
 * The R.A.I.N. backend's configuration, read on the server only.
 *
 * `RAIN_BACKEND_URL` names a backend that speaks `rain-bethesda/v2` (for
 * example `tools/rain-bridge/rain_bethesda_bridge.py` beside a james_library
 * checkout); `RAIN_BACKEND_TOKEN` is an optional bearer token for it. Neither
 * is `VITE_`-prefixed, so Vite never inlines them, and the handler sends the
 * token upstream only. Unset, every route answers "not configured" and the lab
 * runs OFFLINE. Vercel does not deploy underscore-prefixed files as functions;
 * the route files beside this one import it.
 */
const handle = createRainHandler({
  backendUrl: process.env["RAIN_BACKEND_URL"],
  token: process.env["RAIN_BACKEND_TOKEN"],
  timeoutMs: process.env["RAIN_TIMEOUT_MS"],
});

export const rainRoute = {
  fetch(request: Request): Promise<Response> {
    return handle(request, { clientKey: clientKeyFrom(request.headers, "unknown") });
  },
};
