import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { fileURLToPath, URL } from "node:url";
import { execFileSync } from "node:child_process";
// `.js` like every import in the server chain, which @vercel/node runs with its
// specifiers as written. Vite's `configLoader: "native"` cannot load it yet.
import {
  MAX_BODY_BYTES,
  clientKeyFrom,
  createJevDecisionHandler,
} from "./server/jev/handler.js";
import { createLlmDecisionHandler } from "./server/llm/handler.js";
import { createGlideDecisionHandler } from "./server/glide/handler.js";
import { createRainHandler } from "./server/rain/handler.js";
import { configureRuntime } from "./src/rain/runtime.js";
import { LIMITS } from "./src/bethesda/rain/contracts.js";

/**
 * The response headers the deployed site is expected to serve.
 *
 * They live here as well as in `vercel.json` and `deploy/security-headers.conf`
 * (included by `deploy/nginx.conf`) so `vite preview` reproduces the deployed
 * security posture locally — which is the only way a CSP gets tested before it
 * breaks production. `tools/a11y.mjs` runs against the preview server and fails
 * on a CSP violation; `src/lib/deployHeaders.test.ts` holds the container's
 * copy to `vercel.json`'s.
 *
 * Content-Security-Policy notes, since each relaxation is a decision:
 *
 * - `script-src 'self'` is achievable because the production build emits no
 *   inline script. Verified against `dist/index.html`.
 * - `style-src` needs `'unsafe-inline'`: `index.html` carries a first-paint
 *   style block, and React and drei both set inline styles at runtime. Without
 *   it the page renders unstyled. This is the one relaxation the framework
 *   forces, and it is the weakest link in the policy.
 * - `blob:` in `img-src`/`worker-src` covers canvas-derived textures and any
 *   worker a bundled dependency spawns.
 * - `connect-src` allows the opt-in `?liveTraffic=1` ADS-B feed and nothing
 *   else. Remove that origin to forbid the feature outright.
 * - WebGL and GLSL are unaffected by CSP; shaders are not scripts.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://api.adsb.lol",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy":
    "accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
};

/**
 * Short commit of the build, printed on the Blacksite menu so a stale
 * deployment is visible at a glance. Read from the CI environment only; a
 * local build prints nothing rather than guessing.
 */
const BUILD_COMMIT = (
  process.env["VERCEL_GIT_COMMIT_SHA"] ??
  process.env["GITHUB_SHA"] ??
  ""
).slice(0, 7);

/**
 * The full revision for R.A.I.N. Lab provenance records. The CI environment's
 * commit when it reports one (dirty state unknown, so `null`); otherwise the
 * checkout's own `git rev-parse HEAD` with whether tracked files differ from
 * it. Without git, unknown — recorded as such, never guessed.
 */
function labRevision(): {
  commit: string | null;
  dirty: boolean | null;
  source: "ci" | "git" | "unknown";
} {
  const ci = process.env["VERCEL_GIT_COMMIT_SHA"] ?? process.env["GITHUB_SHA"] ?? "";
  if (/^[0-9a-f]{40}$/.test(ci)) return { commit: ci, dirty: null, source: "ci" };
  try {
    const git = (args: string[]) =>
      execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).trim();
    const commit = git(["rev-parse", "HEAD"]);
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("no commit");
    const dirty = git(["status", "--porcelain", "--untracked-files=no"]).length > 0;
    return { commit, dirty, source: "git" };
  } catch {
    return { commit: null, dirty: null, source: "unknown" };
  }
}

const JEV_DECISION_PATH = "/api/jev/decision";

/**
 * Serves `/api/jev/decision` from `vite` and `vite preview`, so `/play?brain=jev`
 * works locally without the Vercel CLI.
 *
 * It mounts the same handler the Vercel function exports. The credential comes
 * from the shell or from `.env.local` (git-ignored) through `loadEnv` with the
 * `TYPESAFE_` prefix, and goes only to that handler: it is never added to
 * `define`, and Vite only inlines `VITE_`-prefixed variables into the bundle, so
 * the browser build cannot contain it. `tools/jev-secret-scan.mjs` checks.
 */
function jevDecisionApi(env: Record<string, string>): Plugin {
  const handle = createJevDecisionHandler({
    apiKey: env["TYPESAFE_API_KEY"],
    model: env["TYPESAFE_MODEL"],
  });
  return decisionApi("blacksite-jev-decision-api", JEV_DECISION_PATH, handle);
}

const GLIDE_DECISION_PATH = "/api/glide/decision";

/**
 * Serves `/api/glide/decision` — Fastino's Glide — the same way: the handler
 * the Vercel function exports, configured from `FASTINO_`-prefixed variables
 * in the shell or `.env.local`. `FASTINO_API_KEY` goes to that handler and
 * nowhere else — never into `define`, never `VITE_`-prefixed.
 */
function glideDecisionApi(env: Record<string, string>): Plugin {
  const handle = createGlideDecisionHandler({
    apiKey: env["FASTINO_API_KEY"],
    model: env["FASTINO_MODEL"],
  });
  return decisionApi("blacksite-glide-decision-api", GLIDE_DECISION_PATH, handle);
}

const LLM_DECISION_PATH = "/api/llm/decision";

/**
 * Serves `/api/llm/decision` the same way: the handler the Vercel function
 * exports, configured from `LLM_`-prefixed variables in the shell or
 * `.env.local`. Like the TypeSafe key, `LLM_API_KEY` goes to that handler and
 * nowhere else — never into `define`, never `VITE_`-prefixed.
 */
function llmDecisionApi(env: Record<string, string>): Plugin {
  const handle = createLlmDecisionHandler({
    provider: env["LLM_PROVIDER"],
    apiKey: env["LLM_API_KEY"],
    model: env["LLM_MODEL"],
    baseUrl: env["LLM_BASE_URL"],
    effort: env["LLM_EFFORT"],
    confidence: env["LLM_CONFIDENCE"],
    timeoutMs: env["LLM_TIMEOUT_MS"],
    maxRetries: env["LLM_MAX_RETRIES"],
    maxTokens: env["LLM_MAX_TOKENS"],
    responseFormat: env["LLM_RESPONSE_FORMAT"],
  });
  return decisionApi("blacksite-llm-decision-api", LLM_DECISION_PATH, handle);
}

/**
 * Serves `/api/rain/*` — the R.A.I.N. Lab's route to the research runtime that
 * runs in this process — from `vite` and `vite preview`, with the handler the
 * Vercel functions use. The `RAIN_*` settings come from the shell or
 * `.env.local` through `loadEnv` with the `RAIN_` prefix; the secrets the
 * runtime can use, `TYPESAFE_API_KEY` (Jev as a decision engine),
 * `RAIN_LLM_API_KEY` (a model server's bearer token) and `RAIN_REGISTRY_SECRET`
 * (the key that certifies pre-registrations), are read here by name and passed
 * by value, so no module under `src/` names them: never into `define`, never
 * `VITE_`-prefixed. With `RAIN_RUNTIME=off` the lab is
 * OFFLINE and says so.
 */
function rainApi(env: Record<string, string>, typesafe: Record<string, string>): Plugin {
  const handle = createRainHandler({
    runtime: configureRuntime({
      env: { ...env, VERCEL: process.env["VERCEL"] },
      secrets: {
        typesafeApiKey: typesafe["TYPESAFE_API_KEY"],
        typesafeModel: typesafe["TYPESAFE_MODEL"],
        modelApiKey: env["RAIN_LLM_API_KEY"],
        registrySecret: env["RAIN_REGISTRY_SECRET"],
      },
      cwd: process.cwd(),
    }),
  });
  return decisionApi(
    "bethesda-rain-api",
    (path) => path.startsWith("/api/rain/"),
    handle,
    LIMITS.submissionRequest,
  );
}

/** Mount one decision handler at one path on the dev and preview servers. */
function decisionApi(
  name: string,
  mountPath: string | ((path: string) => boolean),
  handle: (request: Request, meta: { clientKey: string }) => Promise<Response>,
  maxBodyBytes = MAX_BODY_BYTES,
): Plugin {
  const matches =
    typeof mountPath === "string" ? (path: string) => path === mountPath : mountPath;
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (!matches(path)) {
      next();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      // Keep one byte past the limit so the handler can report 413 itself.
      if (size > maxBodyBytes) return;
      chunks.push(chunk);
      size += chunk.length;
    });
    req.on("end", () => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(", "));
      }
      const method = req.method ?? "GET";
      const body = Buffer.concat(chunks).subarray(0, maxBodyBytes + 1);
      const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
      });
      handle(request, {
        clientKey: clientKeyFrom(headers, req.socket.remoteAddress ?? "local"),
      })
        .then(async (response) => {
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        })
        .catch(() => {
          res.statusCode = 500;
          res.end();
        });
    });
  };
  return {
    name,
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig(({ mode }) => ({
  define: {
    __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
    __LAB_REVISION__: JSON.stringify(labRevision()),
  },
  preview: { headers: SECURITY_HEADERS },
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    jevDecisionApi(loadEnv(mode, process.cwd(), "TYPESAFE_")),
    glideDecisionApi(loadEnv(mode, process.cwd(), "FASTINO_")),
    llmDecisionApi(loadEnv(mode, process.cwd(), "LLM_")),
    rainApi(
      loadEnv(mode, process.cwd(), "RAIN_"),
      loadEnv(mode, process.cwd(), "TYPESAFE_"),
    ),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/three/")) return "three";
          if (id.includes("@react-three/fiber") || id.includes("@react-three/drei")) {
            return "r3f";
          }
          return undefined;
        },
      },
    },
  },
}));
