/** Held-out binary experiment design benchmark. Model outputs are data only. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  createLocalModel,
  parseStructured,
  type StructuredRequest,
} from "../src/rain/autonomy/models.js";

const [protocolFile, output, mode, choiceFile] = process.argv.slice(3);
if (!protocolFile || !output || !["develop", "heldout"].includes(mode ?? ""))
  throw new Error("Usage: PROTOCOL OUTPUT develop|heldout [DEVELOPMENT_RECEIPT]");
const protocolText = readFileSync(protocolFile, "utf8");
const protocolHash = createHash("sha256").update(protocolText).digest("hex");
const protocol = JSON.parse(protocolText) as {
  development_seeds: number[];
  heldout_seeds: number[];
  families: string[];
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const entropy = (p: number): number =>
  p === 0 || p === 1 ? 0 : -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
const gain = ([p, q]: readonly [number, number]): number =>
  entropy((p + q) / 2) - (entropy(p) + entropy(q)) / 2;
const descriptions: Record<string, [string, string, string]> = {
  optical_sensor: [
    "increase optical attenuation",
    "delay delivery of pulse samples",
    "repeat the unmodified feed",
  ],
  packet_queue: [
    "constrain downstream buffer size",
    "add a clock offset to timestamps",
    "repeat the unmodified feed",
  ],
  reactor_temperature: [
    "change the simulated fan gain",
    "add an offset to the thermometer",
    "repeat the unmodified controller",
  ],
};
const labels = ["a", "b", "c"] as const;
type Label = (typeof labels)[number];
type Prob = readonly [number, number];
const method = process.env.RAIN_BENCH_METHOD ?? "all";
const requestedModel = process.env.RAIN_MODEL;
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
if (!requestedModel) throw new Error("RAIN_MODEL must name the local model");
const model = createLocalModel({
  provider: "lmstudio",
  model: requestedModel,
  baseUrl: endpoint.origin,
  temperature: 0,
  maxTokens: 430,
  timeoutMs: 120000,
  contextTokens: 4096,
});

const styles = ["direct", "structured_counts", "structured_rules"] as const;
type Style = (typeof styles)[number];
const structured = (s: Style) => s !== "direct";
const makeCase = (family: string, seed: number) => {
  const fingerprint = hash(family + "/" + seed);
  const rotation = Number.parseInt(fingerprint.slice(0, 8), 16) % 3;
  const flip = Number.parseInt(fingerprint.slice(8, 10), 16) % 2 === 1;
  const nuisance = Number.parseInt(fingerprint.slice(10, 12), 16) % 2 === 1 ? 0.9 : 0.1;
  const descriptionsForCase = descriptions[family]!;
  const design = labels.map((id, i) => {
    const type = (i + rotation) % 3;
    const pair: Prob =
      type === 0
        ? flip
          ? [0.9, 0.1]
          : [0.1, 0.9]
        : type === 1
          ? [nuisance, nuisance]
          : [0.5, 0.5];
    // Each case offers a calibrated pilot for both competing explanations.
    return { id, intervention: descriptionsForCase[i]!, pair };
  });
  return { family, seed, design };
};
const selectedReceipt = choiceFile ? JSON.parse(readFileSync(choiceFile, "utf8")) : null;
const selected: Style | null = selectedReceipt?.selected ?? null;
if (
  mode === "heldout" &&
  (!selected ||
    !styles.includes(selected) ||
    !structured(selected) ||
    selectedReceipt.mode !== "develop" ||
    selectedReceipt.protocol_sha256 !== protocolHash ||
    selectedReceipt.model !== requestedModel ||
    selectedReceipt.model_sha256 !== (process.env.RAIN_CROSSLAB_MODEL_SHA256 ?? null))
)
  throw new Error(
    "Held-out evaluation requires the same model's frozen development receipt",
  );
const cases = protocol.families.flatMap((f) =>
  (mode === "develop" ? protocol.development_seeds : protocol.heldout_seeds).map((s) =>
    makeCase(f, s),
  ),
);
const strategies =
  mode === "develop" ? styles.filter(structured) : (["direct", selected!] as const);
const rows = [];
for (const problem of cases) {
  const publicProblem = problem.design.map(({ id, intervention, pair }) => ({
    id,
    intervention,
    pilot_positives_under_H1_H2: pair.map((p) => p * 10),
  }));
  const truth = Object.fromEntries(problem.design.map((x) => [x.id, x.pair])) as Record<
    Label,
    Prob
  >;
  const best = Math.max(...Object.values(truth).map(gain));
  for (const style of strategies) {
    if (method !== "all" && method !== style) continue;
    const schema: Record<string, unknown> = structured(style)
      ? {
          type: "object",
          additionalProperties: false,
          required: [...labels],
          properties: Object.fromEntries(
            labels.map((id) => [
              id,
              {
                type: "array",
                minItems: 2,
                maxItems: 2,
                items: { enum: [0.1, 0.5, 0.9] },
              },
            ]),
          ),
        }
      : {
          type: "object",
          additionalProperties: false,
          required: ["choice"],
          properties: { choice: { enum: labels } },
        };
    const request: StructuredRequest = {
      schemaName: "rain_experiment_design",
      schema,
      system:
        "Plan a synthetic experiment with competing hypotheses H1 and H2. Return only the requested JSON.",
      user: JSON.stringify({
        domain: problem.family,
        prior: [0.5, 0.5],
        budget: 1,
        candidate_experiments: publicProblem,
        pilot_trials_per_hypothesis: 10,
        task: !structured(style)
          ? "Choose the experiment most likely to distinguish H1 from H2 in one repeat."
          : style === "structured_rules"
            ? "For each intervention, forecast the probability of a positive under H1 then H2. A calibrated pilot with k positives out of ten implies probability k/10. Preserve hypothesis order. The host chooses using information gain."
            : "For each intervention forecast the probability of a positive outcome separately under H1 and H2. Use the pilot observations. The host chooses using information gain.",
      }),
    };
    const answer = await model.complete(request);
    const parsed = parseStructured(answer.text);
    const v = parsed.ok ? parsed.value : {};
    const validPair = (x: unknown): x is Prob =>
      Array.isArray(x) &&
      x.length === 2 &&
      x.every((p) => p === 0.1 || p === 0.5 || p === 0.9);
    let choice: Label | null = null;
    let brier: number | null = null;
    if (
      structured(style) &&
      Object.keys(v).length === labels.length &&
      labels.every((k) => validPair(v[k]))
    ) {
      choice = [...labels].sort((a, b) => gain(v[b] as Prob) - gain(v[a] as Prob))[0]!;
      brier =
        labels
          .flatMap((k) =>
            (v[k] as Prob).map((p, i) => {
              const actual = truth[k][i]!;
              return actual * (1 - p) ** 2 + (1 - actual) * p ** 2;
            }),
          )
          .reduce((a, b) => a + b) / 6;
    } else if (
      !structured(style) &&
      Object.keys(v).length === 1 &&
      labels.some((k) => k === v.choice)
    ) {
      choice = v.choice as Label;
    }
    const score = choice === null ? 0 : gain(truth[choice]);
    rows.push({
      family: problem.family,
      seed: problem.seed,
      style,
      choice,
      valid: choice !== null,
      expected_bits: score,
      regret_bits: best - score,
      forecast_brier: brier,
      fifo_bits: gain(truth.a),
      fixed_pilot_bits: best,
      request_sha256: hash(JSON.stringify(request)),
      request,
      answer,
    });
  }
}
const summaries = strategies
  .map((style) => {
    const subset = rows.filter((r) => r.style === style);
    if (!subset.length) return null;
    const mean = (
      key: "expected_bits" | "regret_bits" | "fifo_bits" | "fixed_pilot_bits",
    ) => subset.reduce((s, r) => s + r[key], 0) / subset.length;
    const forecasts = subset.filter((r) => r.forecast_brier !== null);
    return {
      style,
      cases: subset.length,
      valid: subset.filter((r) => r.valid).length,
      mean_bits: mean("expected_bits"),
      mean_regret: mean("regret_bits"),
      fifo_bits: mean("fifo_bits"),
      fixed_pilot_bits: mean("fixed_pilot_bits"),
      mean_brier: forecasts.length
        ? forecasts.reduce((s, r) => s + r.forecast_brier!, 0) / forecasts.length
        : null,
    };
  })
  .filter((x) => x !== null);
const winner = [...summaries].sort((a, b) => a.mean_regret - b.mean_regret)[0]?.style;
writeFileSync(
  output,
  JSON.stringify(
    {
      schema: "rain-planning-benchmark-receipt/v1",
      mode,
      model: requestedModel,
      model_sha256: process.env.RAIN_CROSSLAB_MODEL_SHA256 ?? null,
      protocol_sha256: protocolHash,
      development_receipt_sha256: choiceFile
        ? hash(readFileSync(choiceFile, "utf8"))
        : null,
      selected: mode === "develop" ? winner : selected,
      summaries,
      rows,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
