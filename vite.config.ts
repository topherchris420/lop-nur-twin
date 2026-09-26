import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { fileURLToPath, URL } from "node:url";
import {
  MAX_BODY_BYTES,
  clientKeyFrom,
  createJevDecisionHandler,
} from "./server/jev/handler";

/**
 * The response headers the deployed site is expected to serve.
 *
 * They live here as well as in `vercel.json` and `deploy/nginx.conf` so
 * `vite preview` reproduces the deployed security posture locally — which is
 * the only way a CSP gets tested before it breaks production. `tools/a11y.mjs`
 * runs against the preview server and fails on a CSP violation.
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
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== JEV_DECISION_PATH) {
      next();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      // Keep one byte past the limit so the handler can report 413 itself.
      if (size > MAX_BODY_BYTES) return;
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
      const body = Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES + 1);
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
    name: "blacksite-jev-decision-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig(({ mode }) => ({
  define: { __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT) },
  preview: { headers: SECURITY_HEADERS },
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    jevDecisionApi(loadEnv(mode, process.cwd(), "TYPESAFE_")),
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
