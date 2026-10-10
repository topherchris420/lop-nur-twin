/** Inspectable reasoning products, never a claim about a person's mind or scientific truth. */
import type { DiscoveryEntry } from "../autonomy/store.js";
import {
  COGNITIVE_STRATEGIES,
  type CognitiveStrategy,
  type CognitiveArtifact,
} from "../../bethesda/rain/cognitionProtocol.js";
export { COGNITIVE_STRATEGIES, COGNITIVE_ARTIFACT_SCHEMA } from "../../bethesda/rain/cognitionProtocol.js";
export type { CognitiveStrategy, CognitiveArtifact } from "../../bethesda/rain/cognitionProtocol.js";

export function strategiesForStage(stage: string): CognitiveStrategy[] {
  if (stage === "Founder hypothesis")
    return ["cross-domain-synthesis", "mathematical-creativity"];
  if (stage === "Founder revision" || stage === "Independent evidence review")
    return ["reflective-learning"];
  if (stage === "Joint experiment proposal") return ["research-entrepreneurship"];
  if (stage === "Independent criticism")
    return ["artistic-exploration", "intellectual-skepticism"];
  return ["intellectual-skepticism"];
}
export function cognitiveArtifactErrors(
  artifacts: CognitiveArtifact[],
  expected: CognitiveStrategy[],
  priorIds: ReadonlySet<string>,
  evidenceIds: readonly string[],
): string[] {
  const errors: string[] = [];
  if (
    artifacts.length !== expected.length ||
    expected.some((s) => artifacts.filter((a) => a.strategy === s).length !== 1)
  )
    errors.push("Each requested strategy must produce exactly one artifact");
  for (const a of artifacts) {
    if (a.prior_decision_ids.some((id) => !priorIds.has(id)))
      errors.push("Unavailable prior prediction reference");
    if (
      a.comparison !== "not-yet-tested" &&
      (!a.prior_decision_ids.length || !evidenceIds.length)
    )
      errors.push(
        "A prediction comparison requires a prior decision and verified evidence reference",
      );
  }
  return errors;
}
export function cognitiveEvaluation(entries: readonly DiscoveryEntry[]) {
  const turns = entries
    .filter((e) => e.kind === "research-turn")
    .map(
      (e) =>
        e.payload as {
          generation: string;
          contribution: { cognitive_artifacts?: CognitiveArtifact[] };
        },
    );
  return {
    schema: "rain-cognitive-evaluation/v1",
    scope:
      "Artifact completeness and model-reported reasoning operations, not psychological fidelity or independently established quality",
    strategies: COGNITIVE_STRATEGIES.map((strategy) => {
      const artifacts = turns.flatMap((t) =>
        (t.contribution.cognitive_artifacts ?? [])
          .filter((a) => a.strategy === strategy)
          .map((a) => ({ ...a, generation: t.generation })),
      );
      return {
        strategy,
        artifacts: artifacts.length,
        live_artifacts: artifacts.filter((a) => a.generation === "model").length,
        missing_capabilities: artifacts.filter((a) => a.status === "missing-capability")
          .length,
        prediction_comparisons: artifacts.filter((a) => a.comparison !== "not-yet-tested")
          .length,
      };
    }),
  };
}
