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
import { partnership } from "../../bethesda/rain/inceptionProtocol.js";
import {
  approveWorld,
  descendantLabs,
  worldErrors,
  type ResearchWorld,
} from "./worlds.js";
import { descendantCharter, runDescendant } from "../autonomy/descendants.js";
import type { ResearchSource } from "../../bethesda/rain/researchProtocol.js";

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
async function input(online = true, revisions = 2, inception = false) {
  const store = new ResearchStore(root),
    model = new ResearchFixtureModel();
  const charter = buildDiscoveryCharter({
    model: { provider: model.provider, model: model.model, endpoint: model.endpoint },
    ceilings: {
      iterations: 3,
      experiments: 3,
      runtime_ms: 240000,
      failed_proposals: 3,
      model_calls: inception ? 40 : 24,
      model_tokens: null,
    },
    validHours: 1,
    envelope: DEFAULT_ENVELOPE,
    research: {
      ...researchScope(DISCOVERY_QUESTION, online),
      manuscript_revisions: revisions,
      ...(inception ? { partnership: partnership() } : {}),
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
  it("Inception offline demonstration: partnership, real native evidence, approved descendant, report and restart", async () => {
    const i = await input(false, 2, true);
    const result = await runDiscovery(i);
    expect(result.ending).toBe("Research draft ready for human review");
    expect(result.executed).toBe(2);
    expect(
      result.research!.turns.filter((t) => t.role === "Independent evidence review"),
    ).toHaveLength(2);
    expect(result.research!.turns.map((t) => t.perspective)).toEqual(
      expect.arrayContaining([
        "Christopher-Sim",
        "Research-Collaborator",
        "James",
        "Jasmine",
        "Luca",
        "Elena",
      ]),
    );
    expect(
      result.research!.memory?.some(
        (m) => m.layer === "critical" && m.status === "scripted",
      ),
    ).toBe(true);
    expect(result.research!.turns.every((t) => t.generation === "scripted")).toBe(true);
    const entries = i.store.discoveryEntries();
    const proposal = entries.find((e) => e.kind === "world-proposed")!.payload as {
      spec: ResearchWorld;
      digest: string;
    };
    const available = entries
      .filter((e) => e.kind === "research-source")
      .map((e) => {
        const s = e.payload as ResearchSource;
        return { id: s.id, sha256: s.sha256, status: "source-context" as const };
      });
    expect(() =>
      approveWorld(i.store, proposal.spec, available, {
        operator: "Test.Operator",
        typedPrefix: "00000000",
        reviewed: false,
        now: new Date(),
      }),
    ).toThrow();
    approveWorld(i.store, proposal.spec, available, {
      operator: "Test.Operator",
      typedPrefix: proposal.digest.slice(0, 8),
      reviewed: true,
      now: new Date(),
    });
    const child = descendantCharter(i.store, proposal.spec.id, i.model);
    const childAuth = authorizeCharter({
      charter: child.charter,
      operator: "Test.Operator",
      reviewed: true,
      typedPrefix: child.digest.slice(0, 8),
      now: new Date(),
    });
    if (!childAuth.ok) throw new Error("child authorization");
    const descendant = await runDescendant({
      store: i.store,
      id: proposal.spec.id,
      model: new ResearchFixtureModel(),
      authorization: childAuth.value,
      cwd: process.cwd(),
    });
    expect(descendant.executed).toBe(2);
    const childStore = i.store.descendant(
      proposal.spec.id,
      proposal.spec.budget.storage_bytes,
    );
    for (const r of [...i.store.records(), ...childStore.records()])
      expect(verifyRecordSync(r.record!).ok).toBe(true);
    expect(i.store.discoveryEntries().some((e) => e.kind === "world-report")).toBe(true);
    const count = i.model.requests.length;
    const restored = createDiscoveryService(
      { RAIN_AUTONOMY_DIR: root },
      process.cwd(),
    ).status();
    expect(restored.active).toBe(false);
    expect(restored.observatory.labs[0]?.status).toBe("completed");
    expect(i.model.requests).toHaveLength(count);
    expect(descendantLabs(new ResearchStore(root))).toHaveLength(1);
    expect(() => descendantCharter(i.store, proposal.spec.id, i.model)).toThrow(
      "already started",
    );
    expect(i.store.lock()).toBeNull();
    const artifact = descendant.research!.artifacts.find((a) =>
      a.name.endsWith("manuscript.md"),
    )!;
    const service = createDiscoveryService({ RAIN_AUTONOMY_DIR: root }, process.cwd());
    expect(service.artifact(`descendants/${proposal.spec.id}/${artifact.path}`)).toBe(
      descendant.research!.manuscript,
    );
    expect(() =>
      service.artifact(`descendants/${proposal.spec.id}/programs/../../state.json`),
    ).toThrow();
    const grandchild = i.store
      .discoveryEntries()
      .filter((e) => e.kind === "world-proposed")
      .map((e) => e.payload as { spec: ResearchWorld; digest: string })
      .find((p) => p.spec.generation === 2)!;
    const childSources = childStore
      .discoveryEntries()
      .filter((e) => e.kind === "research-source")
      .map((e) => {
        const s = e.payload as ResearchSource;
        return { id: s.id, sha256: s.sha256, status: "source-context" as const };
      });
    expect(
      worldErrors(
        grandchild.spec,
        descendantLabs(i.store),
        childSources,
        new Date(Date.now() + 1000),
      ),
    ).toEqual([]);
  }, 240000);
  it("partnership reflection cannot execute and emergency cancellation cannot continue inference", async () => {
    const i = await input(false, 2, true);
    i.charter.research!.partnership!.mode = "reflection";
    const auth = authorizeCharter({
      charter: i.charter,
      operator: "Test.Operator",
      reviewed: true,
      typedPrefix: charterSha256(i.charter).slice(0, 8),
      now: new Date(),
    });
    if (!auth.ok) throw new Error("authorization");
    const reflected = await runDiscovery({ ...i, authorization: auth.value });
    expect(reflected.executed).toBe(0);
    expect(reflected.ending).toContain("Proposal-only");
    const abort = new AbortController();
    const priorCalls = i.model.requests.length;
    const cancelled = await runDiscovery({
      ...i,
      authorization: auth.value,
      signal: abort.signal,
      onUpdate: () => abort.abort(new Error("Operator emergency cancellation")),
    });
    expect(cancelled.executed).toBe(0);
    expect(i.model.requests).toHaveLength(priorCalls);
    expect(i.store.lock()).toBeNull();
  }, 30000);
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
