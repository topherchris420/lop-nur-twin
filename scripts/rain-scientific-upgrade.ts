/** Reproducible scientific workflow demonstration. Live execution has an explicit review gate. */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createDiscoveryService } from "../src/rain/autonomy/discoveryService.js";
import { ResearchStore } from "../src/rain/autonomy/store.js";
import { fixtureDesign } from "../src/rain/autonomy/discoveryFixtures.js";
import { compileDesign } from "../src/bethesda/rain/discoveryCompiler.js";
import { DEFAULT_ENVELOPE } from "../src/bethesda/rain/discoveryProtocol.js";
import { proposeGuidance, learningView } from "../src/rain/research/learning.js";
import { evaluateProposal } from "../src/rain/research/learningEvaluation.js";
import { oscillatorExample } from "../src/rain/scientific/example.js";
import { sha256Json, canonicalJson } from "../src/rain/sha256.js";
import { buildScientificKnowledge } from "../src/rain/research/scientificKnowledge.js";
import { queryScientificKnowledge } from "../src/bethesda/rain/scientificKnowledgeProtocol.js";

const args = process.argv.slice(2),
  value = (flag: string) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  };
const mode = args.includes("--draft")
  ? "draft"
  : args.includes("--execute-reviewed")
    ? "execute"
    : args.includes("--scripted")
      ? "scripted"
      : args.includes("--export")
        ? "export"
        : null;
if (!mode)
  throw new Error(
    "Use --scripted, --draft, --execute-reviewed <full-plan-digest>, or --export. --dir selects an isolated journal; --publish-dir exports reviewed public evidence.",
  );
const dir = resolve(
  value("--dir") ??
    `.rain-research/scientific-${mode === "scripted" ? "scripted" : "live"}`,
);
const env = {
  ...process.env,
  RAIN_AUTONOMY_DIR: dir,
  RAIN_AUTONOMY_ENABLED: "true",
  RAIN_MODEL_PROVIDER: "lmstudio",
  RAIN_MODEL: process.env.RAIN_MODEL,
  RAIN_MODEL_TIMEOUT_MS: process.env.RAIN_MODEL_TIMEOUT_MS ?? "600000",
  RAIN_MODEL_MAX_TOKENS: process.env.RAIN_MODEL_MAX_TOKENS ?? "2048",
  RAIN_AUTONOMY_OPERATOR:
    mode === "scripted" ? "Scripted.DemoOperator" : "R.A.I.N.Operator",
};
const service = createDiscoveryService(env, process.cwd()),
  store = new ResearchStore(dir),
  session = "DS-" + randomUUID();
try {
  if (mode === "draft") {
    const result = await service.scientificDraft(
      value("--question") ??
        "Does periodic driving increase RMS displacement against an otherwise matched damped oscillator? Design a bounded simulation that could refute that hypothesis.",
    );
    console.log(
      JSON.stringify(
        {
          mode: "live-local-model-proposal-awaiting-operator",
          plan: result.scientific.latest,
          journal: dir,
        },
        null,
        2,
      ),
    );
  } else if (mode === "execute") {
    const digest = value("--execute-reviewed");
    if (!digest || !/^[a-f0-9]{64}$/.test(digest))
      throw new Error("Repeat the exact full reviewed numerical plan digest");
    service.scientificAuthorize(digest, digest.slice(0, 8), true);
    const result = await service.scientificExecute(digest);
    console.log(
      JSON.stringify(
        {
          mode: "operator-reviewed-live-model-numerical-experiment",
          records: result.scientific.records,
          journal: dir,
        },
        null,
        2,
      ),
    );
  } else if (mode === "scripted") {
    for (const [i, warmup] of [250, 750].entries()) {
      const design = fixtureDesign();
      design.warmup_ticks = warmup;
      const checked = compileDesign(design, {
        envelope: DEFAULT_ENVELOPE,
        seeds: [110 + i, 220 + i, 330 + i],
        prior: [],
        evidenceIds: new Set(),
        decision: {
          decision_id: `training-${i}`,
          envelope_hash: sha256Json({ training: i }),
        },
      });
      if (checked.ok) throw new Error("Training fixture unexpectedly valid");
      store.appendDiscovery(session, "validation", {
        ok: false,
        errors: checked.errors,
        generation: "scripted",
        task: `training-grid-${i}`,
        design,
      });
    }
    const recurring = learningView(store.discoveryEntries()).recurring.find(
      (r) => r.code === "parameter-grid",
    );
    if (!recurring)
      throw new Error("Actual compiler refusals did not identify recurring grid errors");
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
      generation: "scripted",
      proposer: "scripted-training-designer",
    });
    const evaluation = await evaluateProposal(store, session, proposal.sha256);
    const compiled = service.scientificCompile(oscillatorExample()).scientific.latest!;
    store.appendDiscovery(session, "scripted-operator-review", {
      generation: "scripted",
      plan_sha256: compiled.digest,
      scope: "fixture-only",
      operator: "Scripted.DemoOperator",
    });
    service.scientificAuthorize(compiled.digest, compiled.digest.slice(0, 8), true);
    const result = await service.scientificExecute(compiled.digest);
    console.log(
      JSON.stringify(
        {
          mode: "scripted-integration-demonstration",
          learning_evaluation: evaluation.payload,
          records: result.scientific.records,
          gaps: queryScientificKnowledge(result.knowledge!, { kind: "missing_evidence" })
            .nodes.length,
          journal: dir,
        },
        null,
        2,
      ),
    );
  }
  const graph = buildScientificKnowledge(store.discoveryEntries()),
    gaps = queryScientificKnowledge(graph, { kind: "missing_evidence" });
  const report = {
    schema: "rain-scientific-upgrade-demonstration/v1",
    mode,
    journal_head_sha256: store.discoveryEntries().at(-1)?.sha256 ?? null,
    learning: learningView(store.discoveryEntries()),
    scientific: service.status().scientific,
    unresolved_question: {
      explanation: gaps.explanation,
      nodes: gaps.nodes.slice(0, 8),
      edges: gaps.edges.filter((e) =>
        gaps.nodes.slice(0, 8).some((n) => n.id === e.from || n.id === e.to),
      ),
    },
    limitations: [
      "Scripted and model outputs retain distinct attribution.",
      "Corpus manuscript assumptions are source context; numerical simulator measurements do not validate those papers.",
      "Learning fixtures establish a narrow compiler-process benefit, not scientific intelligence.",
    ],
  };
  const publish = value("--publish-dir");
  if (publish) {
    const target = resolve(publish);
    mkdirSync(target, { recursive: true });
    writeFileSync(
      join(target, "demonstration.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    writeFileSync(
      join(target, "journal.json"),
      JSON.stringify(store.discoveryEntries(), null, 2) + "\n",
    );
    writeFileSync(join(target, "graph.json"), JSON.stringify(graph, null, 2) + "\n");
    console.log("Original public demonstration evidence exported to " + target);
  } else {
    store.saveDiscoveryReport(
      "# Scientific workflow demonstration\n\nOriginal generated evidence; mode " +
        mode +
        ".\n\n```json\n" +
        JSON.stringify(report, null, 2) +
        "\n```\n",
      session,
    );
  }
  console.log("Evidence head " + sha256Json(JSON.parse(canonicalJson(report))));
} finally {
  service.dispose();
}
