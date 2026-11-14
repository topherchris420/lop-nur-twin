/** Bounded local inference receipt. Model text is data, never executable code. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createLocalModel, type StructuredRequest } from "../src/rain/autonomy/models.js";

const [requestPath, output] = process.argv.slice(3);
const modelName = process.env.RAIN_MODEL;
const modelDigest = process.env.RAIN_CROSSLAB_MODEL_SHA256;
if (!requestPath || !output || !modelName || !/^[a-f0-9]{64}$/.test(modelDigest ?? ""))
  throw new Error("Supply REQUEST OUTPUT, RAIN_MODEL and model file SHA-256");
const endpoint = new URL(process.env.RAIN_LMSTUDIO_URL ?? "http://127.0.0.1:1234");
if (
  endpoint.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
  endpoint.username ||
  endpoint.password ||
  endpoint.pathname !== "/" ||
  endpoint.search ||
  endpoint.hash
)
  throw new Error("Use an uncredentialed loopback model endpoint");
const requestText = readFileSync(requestPath, "utf8");
const request = JSON.parse(requestText) as StructuredRequest;
const model = createLocalModel({
  provider: "lmstudio",
  model: modelName,
  baseUrl: endpoint.origin,
  temperature: 0,
  maxTokens: 1800,
  timeoutMs: 120000,
  contextTokens: 8192,
});
const answer = await model.complete(request);
writeFileSync(
  output,
  JSON.stringify(
    {
      schema: "rain-assumption-model-receipt/v1",
      generation: "model",
      model: modelName,
      model_sha256: modelDigest,
      request_sha256: createHash("sha256").update(requestText).digest("hex"),
      request,
      answer,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
