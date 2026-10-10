/** Pure, browser-safe cognitive artifact data contracts. Never grants authority. */
import { closed } from "./discoveryProtocol.js";

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
