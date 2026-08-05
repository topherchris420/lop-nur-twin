import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { fileURLToPath, URL } from "node:url";

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

export default defineConfig({
  preview: { headers: SECURITY_HEADERS },
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
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
});
