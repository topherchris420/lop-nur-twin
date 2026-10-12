/** Frozen local-model pilot; no simulation, guidance activation or outcome-dependent retries. */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ResearchStore } from "../src/rain/autonomy/store.js";
import { createLocalModel, listsModel } from "../src/rain/autonomy/models.js";
import { fixtureDesign } from "../src/rain/autonomy/discoveryFixtures.js";
import { compileDesign } from "../src/bethesda/rain/discoveryCompiler.js";
import {
  DEFAULT_ENVELOPE,
  DESIGN_SCHEMA,
} from "../src/bethesda/rain/discoveryProtocol.js";
import { learningView, proposeGuidance } from "../src/rain/research/learning.js";
import {
  freezeLearningEvaluation,
  evaluateFrozenLearning,
  parameterGridHoldout,
} from "../src/rain/research/learningEvaluation.js";
import { canonicalJson, sha256Json } from "../src/rain/sha256.js";
import type { LearningEvaluation } from "../src/bethesda/rain/learningProtocol.js";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1]!;
};
const dir = resolve(option("--dir", ".rain-research/learning-local-model-pilot"));
if (!process.env.RAIN_MODEL)
  throw new Error("Set RAIN_MODEL to an actual local LM Studio identifier");
const store = new ResearchStore(dir),
  session = "LE-" + randomUUID();
const model = createLocalModel({
  provider: "lmstudio",
  model: process.env.RAIN_MODEL,
  baseUrl: "http://127.0.0.1:1234",
  temperature: 0,
  maxTokens: 1400,
  timeoutMs: 90000,
  contextTokens: 4096,
});
const count = Number(option("--tasks", "4"));
if (!Number.isInteger(count) || count < 4 || count > 8)
  throw new Error("Choose 4–8 tasks before evaluation");
if (!listsModel(await model.listModels(), model))
  throw new Error("Configured local model is not listed");
for (const [index, warmup] of [250, 750].entries()) {
  const design = fixtureDesign();
  design.warmup_ticks = warmup;
  const checked = compileDesign(design, {
    envelope: DEFAULT_ENVELOPE,
    seeds: [101 + index, 201 + index, 301 + index],
    prior: [],
    evidenceIds: new Set(),
    decision: { decision_id: `training-${index}`, envelope_hash: sha256Json({ index }) },
  });
  if (checked.ok) throw new Error("Expected actual training compiler refusal");
  store.appendDiscovery(session, "validation", {
    ok: false,
    errors: checked.errors,
    generation: "scripted",
    design,
  });
}
const recurring = learningView(store.discoveryEntries()).recurring.find(
  (r) => r.code === "parameter-grid",
)!;
const proposal = proposeGuidance(store, session, {
  scope: {
    domain: "urban-simulation",
    backend: "bethesda",
    stage: "design",
    scenario: null,
    error: "parameter-grid",
  },
  instructions:
    "Use 100-tick steps for warm-up and observation windows before submission; preserve matched controls and fixed evaluation criteria.",
  evidence: recurring.evidence,
  proposer: "training-process-reviewer",
  generation: "host",
});
const frozen = freezeLearningEvaluation(store, session, {
  proposal: proposal.sha256,
  evaluator: "independent-host-compiler-scoring/v1",
  generation: "model",
  tasks: parameterGridHoldout().slice(0, count),
  budget: { calls_per_arm: count, max_tokens_per_arm: null, timeout_ms: 600000 },
});
store.appendDiscovery(session, "learning-model-configuration", {
  plan: frozen.sha256,
  model: model.model,
  configuration: model.configuration,
  limitations: [
    "Synthetic held-out task pilot; no population intelligence estimate.",
    "Selection scoring is a preregistered primary-metric proxy, not optimal experiment utility.",
    "Model call ceilings are fixed; missing token usage stays null.",
  ],
});
try {
  const evaluated = await evaluateFrozenLearning(
    store,
    session,
    frozen.sha256,
    async ({ task, guidance, signal }) => {
      const request = {
        schemaName: "rain_learning_answer",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["design", "contradiction_ids", "unsupported_claim_ids"],
          properties: {
            design: DESIGN_SCHEMA,
            contradiction_ids: {
              type: "array",
              maxItems: 10,
              items: { type: "string", maxLength: 128 },
            },
            unsupported_claim_ids: {
              type: "array",
              maxItems: 10,
              items: { type: "string", maxLength: 128 },
            },
          },
        },
        system:
          "You are a R.A.I.N. experiment designer. Revise the provided proposal to answer its scientific question under the supplied envelope. Preserve matched controls and competing hypotheses, cite only provided evidence IDs, identify contradictions and unsupported claims from the question. No external facts, tools or measurements. Return schema-constrained JSON only. The unchanged host compiler independently judges your proposal.",
        user: canonicalJson({ task, evaluated_procedural_guidance: guidance }),
      };
      store.appendDiscovery(session, "learning-model-request", {
        plan: frozen.sha256,
        request,
        generation: "model",
      });
      const answer = await model.complete(request, { signal });
      store.appendDiscovery(session, "learning-model-answer", {
        plan: frozen.sha256,
        answer,
        generation: "model",
      });
      const parsed = JSON.parse(answer.text);
      return {
        ...parsed,
        tokens:
          answer.promptTokens === null || answer.completionTokens === null
            ? null
            : answer.promptTokens + answer.completionTokens,
      };
    },
  );
  const outcome = evaluated.payload as LearningEvaluation;
  console.log(
    JSON.stringify(
      {
        sample_size: count,
        baseline: outcome.baseline,
        candidate: outcome.candidate,
        paired: outcome.paired,
        beneficial: outcome.beneficial,
        journal: dir,
      },
      null,
      2,
    ),
  );
} catch (error) {
  store.appendDiscovery(session, "learning-model-failure", {
    plan: frozen.sha256,
    reason: error instanceof Error ? error.message : String(error),
  });
  throw error;
}
