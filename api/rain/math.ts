import { substrateRoute } from "./_config.js";

/**
 * Vercel Function: `/api/rain/math-status`, `/api/rain/math-search` and
 * `/api/rain/math-inspect`, which `vercel.json` rewrites here so the three
 * share one function. All behaviour is in `server/rain/handler.ts`.
 */
export default substrateRoute;
