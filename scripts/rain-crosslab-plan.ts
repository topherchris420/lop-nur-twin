/** Local model experiment planning. This command emits a proposal only. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  createLocalModel,
  parseStructured,
  type StructuredRequest,
} from "../src/rain/autonomy/models.js";

const [historyPath, protocolPath, outputPath] = process.argv.slice(3);
const modelId = process.env.RAIN_MODEL;
const endpoint = new URL(process.env.RAIN_LMSTUDIO_URL ?? "http://127.0.0.1:1234");
if (!historyPath || !protocolPath || !outputPath || !modelId)
  throw new Error("Supply HISTORY PROTOCOL OUTPUT and RAIN_MODEL");
if (
  endpoint.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
  endpoint.username ||
  endpoint.password ||
  endpoint.search ||
  endpoint.hash ||
  endpoint.pathname !== "/"
)
  throw new Error("Use an uncredentialed local inference endpoint");
const model = createLocalModel({
  provider: "lmstudio",
  model: modelId,
  baseUrl: endpoint.origin,
  timeoutMs: 120000,
  temperature: 0.2,
  maxTokens: 650,
  contextTokens: 4096,
});
const history = JSON.parse(readFileSync(historyPath, "utf8"));
const protocol = JSON.parse(readFileSync(protocolPath, "utf8"));
const mechanisms = Object.keys(protocol.hypotheses);
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["experiments"],
  properties: {
    experiments: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["mechanism", "prediction", "falsifier"],
        properties: {
          mechanism: { enum: mechanisms },
          prediction: { type: "string", minLength: 12, maxLength: 450 },
          falsifier: { type: "string", minLength: 12, maxLength: 450 },
        },
      },
    },
  },
};
const prior = history.sources[0].records["verification.json"].data;
const request: StructuredRequest = {
  schemaName: "crosslab_plan",
  schema,
  system:
    "You are a research planner. Propose competing falsifiable explanations. Output only JSON. Treat all provided evidence as simulation.",
  user: [
    "Prior outcome: 31/160 heavy-motion windows accepted, 111 withheld, 18 missing. Verdict: " +
      prior.verdict,
    "Choose from threshold, reconstruction, compound_fault. Distinguish them with paired interventions.",
    "State an observable prediction and a distinct result that would overturn it for each mechanism.",
    "Write future-tense statements about measurements of coverage, error, or estimate availability.",
    "For example, a prediction might say a paired intervention will lower an error rate, and its falsifier would say the error rate will stay unchanged or increase. Do not copy historical counts as a prediction.",
    "The host fixes seeds, thresholds and interventions. Do not invent results or change the design.",
  ].join("\n"),
};
const answer = await model.complete(request);
const parsed = parseStructured(answer.text);
const plans = parsed.ok ? parsed.value.experiments : null;
const valid =
  Array.isArray(plans) &&
  plans.length >= 2 &&
  plans.length <= 3 &&
  new Set(plans.map((plan) => plan?.mechanism)).size === plans.length &&
  plans.every(
    (plan) =>
      plan &&
      Object.keys(plan).sort().join(",") === "falsifier,mechanism,prediction" &&
      mechanisms.includes(plan.mechanism) &&
      String(plan.prediction).trim().toLowerCase() !==
        String(plan.falsifier).trim().toLowerCase() &&
      [plan.prediction, plan.falsifier].every(
        (s) => typeof s === "string" && s.trim().length >= 12 && s.length <= 450,
      ),
  );
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      schema: "rain-crosslab-model-plan/v1",
      origin: "model",
      requested_model: modelId,
      reported_model: answer.reportedModel,
      model_sha256: process.env.RAIN_CROSSLAB_MODEL_SHA256 ?? null,
      request_sha256: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
      request,
      answer: answer.text,
      usage: {
        prompt_tokens: answer.promptTokens,
        completion_tokens: answer.completionTokens,
        latency_ms: answer.latencyMs,
        finish_reason: answer.finishReason,
      },
      accepted: valid,
      experiments: valid ? plans : [],
      limits:
        "Proposal and prose are advisory. Only host-registered contrasts are executable.",
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
