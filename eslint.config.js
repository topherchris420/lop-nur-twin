// @ts-check
/**
 * Flat ESLint config.
 *
 * `bun run build` already runs `tsc --noEmit` in strict mode over every file in
 * `src/` and `scripts/`, so the type system carries most of the weight. What is
 * configured here is the set of checks the compiler does not make, chosen so
 * that every rule that fires marks a real defect in *this* code.
 *
 * Two families are deliberately not enabled, and both decisions are about
 * precision rather than convenience:
 *
 * - **`@typescript-eslint`'s `no-unsafe-*` family.** In this codebase it fires
 *   almost exclusively on `@types/three`'s generic defaults — `Mesh<any, any,
 *   any>`, `material.dispose` on a union — not on `any` written here. Writing
 *   `any` *is* an error (`no-explicit-any` below), and the type-aware rules
 *   that catch real bugs (floating promises, misused promises, unnecessary
 *   assertions, unused expressions) are enabled individually.
 *
 * - **The React Compiler rule family in `eslint-plugin-react-hooks` v7**
 *   (`immutability`, `refs`, `use-memo`, `set-state-in-effect`). This project
 *   is not compiled by React Compiler, and its documented architecture is the
 *   opposite of what those rules assume: per-frame data flows through mutable
 *   singletons and refs mutated inside `useFrame`, precisely so that React
 *   state never updates on the frame loop (see AGENTS.md). The rules fire on
 *   that pattern by design. The two classic correctness rules —
 *   `rules-of-hooks` and `exhaustive-deps` — are on, and `exhaustive-deps` is
 *   the one that would have caught the manifest-fetch deadlock.
 *
 * Formatting is Prettier's job — no stylistic rules here.
 */

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build output, generated files, and the parked experiments. `experiments/`
    // is outside `tsconfig.json` on purpose, so a type-aware rule could not run
    // there in any case — see experiments/README.md.
    ignores: [
      "dist/**",
      "dist-ssr/**",
      "coverage/**",
      "node_modules/**",
      "experiments/**",
      "src/routeTree.gen.ts",
      ".vercel/**",
      "shots/**",
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Application and build-script sources.                             */
  /* ---------------------------------------------------------------- */
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts", "*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,

      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      // A promise nobody awaits inside a scene effect surfaces as "the screen
      // is dark" and nothing else, which is the hardest kind of failure to
      // diagnose here. Both rules need type information.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unused-expressions": "error",
      // `noUnusedLocals`/`noUnusedParameters` in tsconfig already error on
      // these, and tsc understands the `_`-prefix escape hatch that the lint
      // rule spells differently. One owner is enough.
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  /* ---------------------------------------------------------------- */
  /* Vitest suites.                                                    */
  /* ---------------------------------------------------------------- */
  {
    files: ["src/**/*.test.ts"],
    rules: {
      // A suite that proves a validator rejects malformed input has to be able
      // to construct malformed input.
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },

  /* ---------------------------------------------------------------- */
  /* Browser-driving tools: plain Node ESM, no type information.       */
  /* ---------------------------------------------------------------- */
  {
    files: ["tools/**/*.mjs", "scripts/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // These files call `page.evaluate(() => …)`, whose callback runs inside
      // the browser and legitimately reaches for `window`, `document` and the
      // app's own dev-only globals. ESLint cannot see across that boundary.
      "no-undef": "off",
    },
  },
);
