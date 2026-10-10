/** Explicitly invoked, inference-only live check. No fixture, execution or authorization. */
import { join } from "node:path";
import { createLocalModel, parseStructured } from "../src/rain/autonomy/models.js";
import { ResearchStore } from "../src/rain/autonomy/store.js";
import { corpusContext, mathematicsContext } from "../src/rain/research/knowledge.js";
import {
  partnerPrompt,
  PARTNERSHIP_STAGES,
  cognitiveMemory,
} from "../src/rain/research/partnership.js";
import { partnership } from "../src/bethesda/rain/inceptionProtocol.js";
import {
  CONTRIBUTION_SCHEMA,
  type Contribution,
  type ResearchTurn,
} from "../src/bethesda/rain/researchProtocol.js";
import { checkData } from "../src/bethesda/rain/discoveryProtocol.js";
import { sha256Json } from "../src/rain/sha256.js";

const args = process.argv.slice(3);
if (args.length !== 2 || args[0] !== "--model" || !args[1]?.trim())
  throw new Error(
    "Usage: bun run rain:inception:live --model <loaded-LM-Studio-identifier>",
  );
const modelId = args[1];
const settings = {
  provider: "lmstudio" as const,
  model: modelId,
  baseUrl: "http://127.0.0.1:1234",
  timeoutMs: 300000,
  temperature: 0.2,
  maxTokens: 1024,
  contextTokens: 4096,
};
const model = createLocalModel(settings);
if (!(await model.listModels()).includes(modelId))
  throw new Error("Requested model is not listed by LM Studio");
const question =
  "Which testable distinction separates Dynamic Resonance Rooting from ordinary rule-based collective response in the Bethesda simulator?";
const profile = partnership("reflection");
const sources = [
  ...corpusContext("Dynamic Resonance Rooting", 1),
  ...mathematicsContext("dynamical systems stability").slice(0, 1),
];
if (!sources.some((s) => s.kind === "corpus"))
  throw new Error("Approved corpus context is unavailable");
const root = join(
  process.cwd(),
  ".rain-research",
  "inception-live-" + new Date().toISOString().replace(/[^0-9TZ]/g, ""),
);
const store = new ResearchStore(root);
const session = "inference-check",
  programId = "RP-" + sha256Json({ goal: question }).slice(0, 24);
const release = store.acquireLock(session);
const turns: ResearchTurn[] = [];
try {
  store.appendDiscovery(session, "research-start", {
    program_id: programId,
    goal: question,
    scope: { partnership: profile },
    generation: "model",
    settings,
    limits: { model_calls: 2, experiments: 0, descendants: 0 },
    authorization:
      "Explicit operator request for live inference validation; no experiment authority",
  });
  for (const source of sources) store.appendDiscovery(session, "research-source", source);
  for (const stage of PARTNERSHIP_STAGES.slice(0, 2)) {
    const request = {
      schemaName: "rain_research_contribution",
      schema: CONTRIBUTION_SCHEMA,
      system:
        partnerPrompt(stage.name, stage.instruction, profile) +
        " Keep the whole response below 180 words. Use empty evidence_run_ids and search_queries: no experiment or web search has run. Cite at least one supplied source ID. Do not invent equations or source findings.",
      user: JSON.stringify({
        question,
        context: {
          sources: sources.map((s) => ({
            id: s.id,
            title: s.title,
            excerpt: s.excerpt.slice(0, 450),
            reading_scope: s.reading_scope,
          })),
          capabilities:
            "Existing Bethesda rule-based disruptions, matched seed controls, watching count and movement measurements; no physical resonance or new simulator code.",
        },
        previous: turns.map((t) => ({
          speaker: t.perspective,
          hypothesis: t.contribution.hypothesis,
          falsification: t.contribution.falsification,
          rationale: t.contribution.rationale,
        })),
      }),
    };
    const id = `${session}-${turns.length + 1}`;
    store.appendDiscovery(session, "inference-request", {
      id,
      provider: model.provider,
      model: model.model,
      endpoint: model.endpoint,
      generation: "model",
      request,
    });
    console.log(`LIVE ${stage.name}: ${stage.stage}`);
    const answer = await model.complete(request);
    store.appendDiscovery(session, "inference-answer", {
      id,
      generation: "model",
      answer,
    });
    if (
      answer.reportedModel !== modelId ||
      !["stop", "eos"].includes(answer.finishReason ?? "")
    )
      throw new Error(
        `Incomplete or mismatched model response: ${answer.finishReason}; reported model ${answer.reportedModel}`,
      );
    const parsed = parseStructured(answer.text);
    if (!parsed.ok) throw new Error(parsed.error);
    const checked = checkData<Contribution>(parsed.value, CONTRIBUTION_SCHEMA);
    if (!checked.ok) throw new Error(checked.errors.join("; "));
    const c = checked.value;
    if (
      !c.source_ids.length ||
      c.source_ids.some((id) => !sources.some((s) => s.id === id)) ||
      c.evidence_run_ids.length
    )
      throw new Error("Unavailable source or fabricated evidence reference");
    const turn: ResearchTurn = {
      perspective: stage.name,
      role: stage.stage,
      generation: "model",
      decision_id: id,
      contribution: c,
    };
    turns.push(turn);
    store.appendDiscovery(session, "research-turn", turn);
    console.log(
      JSON.stringify({
        speaker: stage.name,
        hypothesis: c.hypothesis,
        disagreements: c.disagreements,
        prompt_tokens: answer.promptTokens,
        completion_tokens: answer.completionTokens,
        latency_ms: answer.latencyMs,
      }),
    );
  }
  const memory = cognitiveMemory(
    new ResearchStore(root).discoveryEntries(),
    programId,
    profile,
    sources,
    new Set(),
  );
  if (
    !memory.some(
      (m) => m.namespace === "Christopher-Sim" && m.status === "model-inferred",
    ) ||
    !memory.some(
      (m) => m.namespace === "Research-Collaborator" && m.status === "model-inferred",
    )
  )
    throw new Error("Persistent role memory did not restore");
  store.appendDiscovery(session, "live-check-complete", {
    generation: "model",
    turns: turns.length,
    recalled_memory_items: memory.length,
    experiments: 0,
    descendants: 0,
  });
  const report = store.saveDiscoveryReport(
    "# Live Inception inference check\n\nReal local model output; unvalidated research proposals, not simulator evidence.\n\n" +
      JSON.stringify({ settings, question, sources, turns, memory }, null, 2),
    "live-inference",
  );
  console.log(
    JSON.stringify(
      {
        root,
        report,
        model: modelId,
        generation: "model",
        validated_turns: turns.length,
        restored_memory_items: memory.length,
        experiments: 0,
      },
      null,
      2,
    ),
  );
} catch (error) {
  store.appendDiscovery(session, "live-check-failed", {
    detail: String(error),
    accepted_turns: turns.length,
  });
  console.error("Live check failed; original requests and answers retained at " + root);
  throw error;
} finally {
  release();
}
