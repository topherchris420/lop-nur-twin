/// <reference types="vite/client" />

/**
 * The commit this bundle was built from, when the build environment says
 * (Vercel and GitHub Actions both do). Empty for a local build.
 */
declare const __BUILD_COMMIT__: string;

/**
 * The full lop-nur-twin revision for R.A.I.N. Lab provenance: from the CI
 * environment, or from the checkout's own `git` (with its dirty state), or
 * unknown. Read only through `src/bethesda/rain/provenance.ts`, which treats
 * anything malformed as unknown.
 */
declare const __LAB_REVISION__: {
  commit: string | null;
  dirty: boolean | null;
  source: "ci" | "git" | "unknown";
};
