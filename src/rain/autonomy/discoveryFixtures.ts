/** Scripted integration fixture. Not Qwen and not evidence of model reasoning. */
import type { Design, Critique } from "../../bethesda/rain/discoveryProtocol.js";
import { DISCOVERY_SCHEMA } from "../../bethesda/rain/discoveryProtocol.js";
import type { DiscoveryResult } from "../../bethesda/rain/discoveryView.js";
import type { LocalModel, StructuredRequest } from "./models.js";
export const fixtureDesign = (): Design => ({
  schema: DISCOVERY_SCHEMA,
  question: "[scripted fixture] Does a simulated fire change nearby watching behavior?",
  hypothesis:
    "[scripted fixture] A fire increases mean watching count by at least 0.01 relative to no event.",
  competing_hypothesis:
    "[scripted fixture] A fire does not increase mean watching count.",
  rationale:
    "[scripted fixture] Test attraction and avoidance in the existing event rules.",
  evidence_ids: [],
  parent_design_id: null,
  purpose: "exploratory",
  scenario: "fire",
  location: "bethesda_row",
  primary_metric: "watching",
  expected_direction: "increase",
  minimum_effect: 0.01,
  warmup_ticks: 100,
  observation_window_ticks: 300,
  parameters: {
    pedestrians: 40,
    vehicles: 8,
    buses: 2,
    intensity: 1,
    duration_ticks: 300,
  },
  uncertainties: [
    "Illustrative agents and short windows may show no measurable response.",
  ],
  replication_plan:
    "Freeze the protocol and evaluate withheld seeds before claiming confirmation.",
  information_value: 0.5,
});
export const fixtureCritique = (): Critique => ({
  assessment: "proceed",
  confounds: [],
  comparison_validity:
    "[scripted fixture] Paired initial states, only event presence differs.",
  circularity:
    "[scripted fixture] This tests simulator rules; it does not validate them against reality.",
  evidence_limits: ["Descriptive small seed panel; no real-world claims."],
  disagreements: [],
  learned: "[scripted fixture] No evidence is claimed before measurements.",
  distinguished:
    "[scripted fixture] Directional paired differences can be compared descriptively.",
  failed_assumptions: [],
  uncertainty: ["Population dependence remains untested."],
  next_question:
    "Does a denser population alter the same disruption's movement response?",
  replicate: true,
});
export class DiscoveryFixtureModel implements LocalModel {
  readonly generation = "scripted" as const;
  readonly provider = "lmstudio" as const;
  readonly model = "scripted-discovery-test-double";
  readonly endpoint = "http://127.0.0.1:1234";
  readonly requests: StructuredRequest[] = [];
  async listModels() {
    return [this.model];
  }
  async complete(request: StructuredRequest) {
    this.requests.push(request);
    const context = JSON.parse(request.user) as {
      memory?: DiscoveryResult[];
      result?: DiscoveryResult;
    };
    let answer: unknown;
    if (request.schemaName === "rain_discovery_candidates") {
      const d = fixtureDesign();
      const previous = context.memory?.at(-1);
      if (previous) {
        const delta = previous.measurements.primary_delta_mean;
        d.parent_design_id = previous.design_id;
        d.evidence_ids = [previous.run_id];
        d.parameters.pedestrians = delta === 0 ? 120 : 60;
        d.question =
          "[scripted fixture] Does a denser simulated population change the response to the same fire?";
        d.rationale = `[scripted fixture] Previous measured paired mean delta was ${delta}; test ${d.parameters.pedestrians} pedestrians to investigate population dependence. This branch is computed from the actual previous result.`;
      }
      answer = { candidates: [d] };
    } else {
      const c = fixtureCritique();
      if (context.result)
        c.learned = `[scripted fixture] Simulator reported mean delta ${context.result.measurements.primary_delta_mean}; preregistered verdict ${context.result.verdict}.`;
      answer = c;
    }
    return {
      text: JSON.stringify(answer),
      reportedModel: this.model,
      promptTokens: null,
      completionTokens: null,
      latencyMs: 0,
      finishReason: "stop",
    };
  }
}
