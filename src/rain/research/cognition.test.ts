import { describe, it, expect } from "vitest";
import {
  cognitiveArtifactErrors,
  strategiesForStage,
  COGNITIVE_STRATEGIES,
  type CognitiveArtifact,
} from "./cognition.js";
import { checkData } from "../../bethesda/rain/discoveryProtocol.js";
import {
  CONTRIBUTION_SCHEMA,
  researchScope,
  researchScopeErrors,
} from "../../bethesda/rain/researchProtocol.js";
import { partnership } from "../../bethesda/rain/inceptionProtocol.js";
import { PARTNERSHIP_STAGES } from "./partnership.js";
describe("inspectable cognitive strategies", () => {
  const artifact: CognitiveArtifact = {
    strategy: "reflective-learning",
    proposal: "Fixture prediction revision",
    assumption: "Fixture assumption",
    observable: "watching",
    falsification: "No positive paired effect",
    status: "testable",
    limitation: "Simulator only",
    prior_decision_ids: ["earlier"],
    comparison: "inconclusive",
  };
  it("requires real references before claiming a prediction comparison", () => {
    expect(
      cognitiveArtifactErrors([artifact], ["reflective-learning"], new Set(["earlier"]), [
        "verified",
      ]),
    ).toEqual([]);
    expect(
      cognitiveArtifactErrors([artifact], ["reflective-learning"], new Set(), [
        "verified",
      ]),
    ).toContain("Unavailable prior prediction reference");
    expect(
      cognitiveArtifactErrors(
        [artifact],
        ["reflective-learning"],
        new Set(["earlier"]),
        [],
      ),
    ).toContain(
      "A prediction comparison requires a prior decision and verified evidence reference",
    );
    expect(
      cognitiveArtifactErrors(
        [artifact, artifact],
        ["reflective-learning"],
        new Set(["earlier"]),
        ["verified"],
      ).length,
    ).toBeGreaterThan(0);
  });
  it("covers all six strategies and versions opt-in profiles without changing legacy profiles", () => {
    expect(
      new Set(PARTNERSHIP_STAGES.flatMap((s) => strategiesForStage(s.stage))),
    ).toEqual(new Set(COGNITIVE_STRATEGIES));
    const scope = {
      ...researchScope("Fixture research question", false),
      partnership: partnership(),
    };
    expect(researchScopeErrors(scope)).toEqual([]);
    scope.partnership.profile.strategy_version = 1;
    expect(researchScopeErrors(scope)).toEqual([]);
    expect(
      researchScopeErrors({
        ...scope,
        partnership: {
          ...scope.partnership,
          profile: { ...scope.partnership.profile, strategy_version: 2 },
        },
      }).length,
    ).toBeGreaterThan(0);
  });
  it("rejects model prose containing JSON-decoded backspace math", () => {
    const contribution = {
      question: "Question",
      hypothesis: "Hypothesis",
      falsification: "Counterexample",
      rationale: "Reason",
      source_ids: [],
      evidence_run_ids: [],
      disagreements: [],
      next_experiment: "Proposal",
      search_queries: [],
      mathematical_assumptions: [JSON.parse('"\\bar(W)"')],
    };
    expect(checkData(contribution, CONTRIBUTION_SCHEMA).ok).toBe(false);
  });
});
