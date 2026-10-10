/** Inspectable reasoning products, never a claim about a person's mind or scientific truth. */
import { closed } from "../../bethesda/rain/discoveryProtocol.js";
import type { DiscoveryEntry } from "../autonomy/store.js";
export const COGNITIVE_STRATEGIES = [
  "cross-domain-synthesis",
  "mathematical-creativity",
  "artistic-exploration",
  "intellectual-skepticism",
  "research-entrepreneurship",
  "reflective-learning",
] as const;
export type CognitiveStrategy = (typeof COGNITIVE_STRATEGIES)[number];
export interface CognitiveArtifact {
  strategy: CognitiveStrategy;
  proposal: string;
  assumption: string;
  observable: string;
  falsification: string;
  status: "testable" | "missing-capability" | "not-applicable";
  limitation: string;
  prior_decision_ids: string[];
  comparison: "not-yet-tested" | "consistent" | "contradicted" | "inconclusive";
}
const word = { type: "string", minLength: 1, maxLength: 500 };
export const COGNITIVE_ARTIFACT_SCHEMA = closed({
  strategy: { type: "string", enum: [...COGNITIVE_STRATEGIES] },
  proposal: word,
  assumption: word,
  observable: word,
  falsification: word,
  status: { type: "string", enum: ["testable", "missing-capability", "not-applicable"] },
  limitation: word,
  prior_decision_ids: {
    type: "array",
    maxItems: 3,
    items: { type: "string", minLength: 1, maxLength: 120 },
  },
  comparison: {
    type: "string",
    enum: ["not-yet-tested", "consistent", "contradicted", "inconclusive"],
  },
});
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
