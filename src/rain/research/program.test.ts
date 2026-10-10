import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime } from "../runtime.js";
import { ResearchStore } from "../autonomy/store.js";
import { runDiscovery } from "../autonomy/discovery.js";
import {
  buildDiscoveryCharter,
  authorizeCharter,
  charterSha256,
} from "../../bethesda/rain/standing.js";
import {
  DEFAULT_ENVELOPE,
  DISCOVERY_QUESTION,
} from "../../bethesda/rain/discoveryProtocol.js";
import { researchScope } from "../../bethesda/rain/researchProtocol.js";
import { ResearchFixtureModel, fixtureLiterature } from "./fixtures.js";
import { verifyRecordSync } from "../../bethesda/rain/replay.js";
import { programGraph } from "./program.js";
import { createDiscoveryService } from "../autonomy/discoveryService.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rain-program-"));
  Object.assign(globalThis, {
    __LAB_REVISION__: { commit: "c".repeat(40), dirty: true, source: "git" },
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete (globalThis as { __LAB_REVISION__?: unknown }).__LAB_REVISION__;
});
async function input(online = true, revisions = 2) {
  const store = new ResearchStore(root),
    model = new ResearchFixtureModel();
  const charter = buildDiscoveryCharter({
    model: { provider: model.provider, model: model.model, endpoint: model.endpoint },
    ceilings: {
      iterations: 3,
      experiments: 3,
      runtime_ms: 240000,
      failed_proposals: 3,
      model_calls: 24,
      model_tokens: null,
    },
    validHours: 1,
    envelope: DEFAULT_ENVELOPE,
    research: {
      ...researchScope(DISCOVERY_QUESTION, online),
      manuscript_revisions: revisions,
    },
  });
  const auth = authorizeCharter({
    charter,
    operator: "Test.Operator",
    reviewed: true,
    typedPrefix: charterSha256(charter).slice(0, 8),
    now: new Date(),
  });
  if (!auth.ok) throw new Error("authorization");
  const runtime = await configureRuntime({
    env: { RAIN_REGISTRY_DIR: store.registryDir() },
    cwd: process.cwd(),
  });
  if (runtime.mode !== "local") throw new Error("runtime");
  const literature = vi.fn(async (query: string, limit: number) =>
    fixtureLiterature(query, limit),
  );
  return {
    store,
    model,
    charter,
    authorization: auth.value,
    budgets: charter.ceilings,
    runtime: runtime.runtime,
    operator: "Test.Operator",
    question: DISCOVERY_QUESTION,
    literature,
  };
}
describe("native research program", () => {
  it("collaborates over sources, runs a result-linked follow-up, and compiles an independently critiqued paper from actual measurements", async () => {
    const i = await input();
    const r = await runDiscovery(i);
    expect(r.ending).toBe("Research draft ready for human review");
    expect(r.ok).toBe(true);
    expect(r.executed).toBe(2);
    expect(i.literature).toHaveBeenCalledTimes(1);
    expect(r.research?.turns.map((t) => t.perspective)).toEqual([
      "James",
      "Jasmine",
      "Luca",
      "Elena",
    ]);
    const journal = i.store.discoveryEntries();
    const turns = journal.filter((e) => e.kind === "research-turn");
    expect(turns).toHaveLength(8);
    const sourceKinds = new Set(r.research?.sources.map((s) => s.kind));
    expect(sourceKinds.has("corpus")).toBe(true);
    expect(sourceKinds.has("literature")).toBe(true);
    const writer = i.model.requests.find(
      (q) => q.schemaName === "rain_research_manuscript",
    );
    expect(writer?.user).toContain(String(r.history[0]!.measurements.primary_delta_mean));
    const paper = r.research!.manuscript!;
    expect(paper).toContain("SCRIPTED INTEGRATION DEMONSTRATION");
    for (const result of r.history) {
      expect(paper).toContain(String(result.measurements.primary_delta_mean));
      expect(paper).toContain(result.registry_run_id!);
      for (const p of result.per_seed) expect(paper).toContain(String(p.seed));
    }
    expect(paper).not.toContain("{{metric:");
    for (const a of r.research!.artifacts)
      expect(i.store.readResearchArtifact(a.path)).toBeTruthy();
    expect(r.research?.artifacts.some((a) => a.name.endsWith("figure.svg"))).toBe(true);
    expect(r.research?.artifacts.some((a) => a.name.endsWith("references.bib"))).toBe(
      true,
    );
    expect(r.research?.review?.assessment).toBe("ready_for_human_review");
    for (const entry of i.store.records())
      expect(verifyRecordSync(entry.record).ok).toBe(true);
    const graph = programGraph(journal, r.research!.program_id);
    expect(
      graph.edges.some(
        (e) => e.relation === "revises" && e.from === r.history[0]!.design_id,
      ),
    ).toBe(true);
    expect(graph.nodes.filter((n) => n.kind === "manuscript")).toHaveLength(1);
    expect(graph.edges.filter((e) => e.relation === "informs design")).toHaveLength(8);
    const reloaded = createDiscoveryService(
      { RAIN_AUTONOMY_DIR: root },
      process.cwd(),
    ).status();
    expect(reloaded.active).toBe(false);
    expect(reloaded.stage).toBe("IDLE");
    expect(reloaded.research?.manuscript).toBe(paper);
    expect(i.store.lock()).toBeNull();
    const artifact = r.research!.artifacts.find((a) => a.name.endsWith("manuscript.md"))!;
    writeFileSync(join(root, artifact.path), paper + "\ntampered");
    expect(() => i.store.readResearchArtifact(artifact.path)).toThrow("integrity");
  }, 240000);
  it("requires a fresh reviewed digest for network scope and refuses goal changes before any research work", async () => {
    const i = await input(false);
    i.charter.research!.literature = "crossref";
    i.charter.research!.max_queries = 1;
    const altered = await runDiscovery(i);
    expect(altered.executed).toBe(0);
    expect(altered.ending).toContain("different charter");
    expect(i.literature).not.toHaveBeenCalled();
    const j = await input(false);
    const changed = await runDiscovery({ ...j, question: "An unreviewed goal" });
    expect(changed.executed).toBe(0);
    expect(changed.ending).toContain("goal differs");
    expect(j.model.requests).toHaveLength(0);
  }, 30000);
  it("retains rejected drafts and scientific disagreements through bounded repair", async () => {
    const i = await input(false, 3);
    const complete = i.model.complete.bind(i.model);
    let drafts = 0,
      reviews = 0;
    i.model.complete = async (request) => {
      const answer = await complete(request);
      const data = JSON.parse(answer.text);
      if (request.schemaName === "rain_research_manuscript" && ++drafts === 1)
        data.paragraphs[0].text = "An unsupported effect of 999 was measured.";
      if (request.schemaName === "rain_research_manuscript_review" && ++reviews === 1) {
        data.assessment = "revise";
        data.issues = ["Scripted criticism: explain the competing population account"];
        data.next_investigations = [];
      }
      return { ...answer, text: JSON.stringify(data) };
    };
    const result = await runDiscovery(i);
    expect(result.ok).toBe(true);
    expect(result.executed).toBe(2);
    expect(drafts).toBe(3);
    expect(reviews).toBe(2);
    const journal = i.store.discoveryEntries();
    expect(
      journal.filter((e) => e.kind === "research-manuscript-validation"),
    ).toHaveLength(3);
    const draftsInGraph = result.research!.graph.nodes.filter(
      (n) => n.kind === "manuscript",
    );
    expect(draftsInGraph.map((n) => n.status)).toEqual([
      "needs_revision",
      "ready_for_human_review",
    ]);
    const rejectedReview = result.research!.artifacts.find(
      (a) => a.name === "2-review.json",
    )!;
    expect(i.store.readResearchArtifact(rejectedReview.path)).toContain(
      "competing population",
    );
    expect(result.research!.manuscript).not.toContain("An unsupported effect of 999");
  }, 240000);
  it("retains a completed experiment after interruption and does not claim manuscript completion", async () => {
    const i = await input(false);
    const abort = new AbortController();
    const result = await runDiscovery({
      ...i,
      signal: abort.signal,
      onUpdate: (v) => {
        if (v.stage === "ANALYZE")
          abort.abort(new Error("operator interrupted research"));
      },
    });
    expect(result.history).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(result.research?.delivery).not.toBe("ready_for_human_review");
    expect(i.store.records()).toHaveLength(1);
    expect(i.literature).not.toHaveBeenCalled();
    expect(i.store.lock()).toBeNull();
    const delivery = result.research!.artifacts.find((a) => a.name === "delivery.json")!;
    expect(readFileSync(join(root, delivery.path), "utf8")).toContain(
      "operator interrupted",
    );
  }, 180000);
  it("shares the existing exclusive session lock", async () => {
    const i = await input(false);
    const release = i.store.acquireLock("other-controller");
    try {
      await expect(runDiscovery(i)).rejects.toThrow("locked");
    } finally {
      release();
    }
    expect(i.model.requests).toHaveLength(0);
  });
});
