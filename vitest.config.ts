import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

/**
 * Unit tests for the deterministic, non-rendering half of this project:
 * parameter validation, coordinate and bearing maths, the evidence ledger and
 * its validator, uncertainty derivation, the temporal ledger, manifest
 * canonicalisation and diffing, and bookmark serialisation.
 *
 * Deliberately no browser environment and no Three.js. What a scene *looks*
 * like is checked by `tools/probe.mjs` and `tools/frames.mjs`; what the
 * simulation *does* is checked by `tools/smoke.mjs`, `tools/gait.mjs` and
 * `tools/engagement.mjs`. Those need a real renderer and a real frame loop, and
 * re-testing them here through a mock would assert the mock.
 *
 * `node` is the environment because everything under test is pure: it reads no
 * DOM, and the two modules that touch browser APIs (`params.ts` reading
 * `location.search`, `bookmarks.ts` reading `localStorage`) take the storage or
 * the query string as an argument precisely so they can be tested without one.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Coverage is a map of what is tested, not a target to hit. Only the
      // deterministic modules the suites actually cover are reported, so the
      // number means something instead of being diluted by scene code that is
      // verified in a browser.
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "src/lib/use*.ts"],
    },
  },
});
