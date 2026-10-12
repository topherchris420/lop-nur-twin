/** Execution adapter delegates to the existing authority/preflight and simulator runner. */
import { runExperiment, type RunAuthority } from "../../bethesda/rain/runner.js";
import type { BethesdaScientificPlan } from "./compiler.js";

export function executeBethesda(
  plan: BethesdaScientificPlan,
  authority: RunAuthority | null,
) {
  const v = plan.compiled.validated;
  return runExperiment(v.definition, v.definitionSha256, v.experimentId, authority);
}
