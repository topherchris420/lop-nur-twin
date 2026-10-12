import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "../experiments/registry.js";
import { oscillatorExample } from "../scientific/example.js";
import { compileNumericalExperiment } from "../scientific/compiler.js";
import { authorizeNumerical, executeNumerical } from "../scientific/numerical.js";
import { preregisterNumerical, admitNumericalRecord } from "../scientific/registry.js";
import { sha256Json } from "../sha256.js";
import type { DiscoveryEntry } from "../autonomy/store.js";
import type { ResearchAssessment } from "../experiments/research.js";
import type { ResearchSource } from "../../bethesda/rain/researchProtocol.js";
import { buildScientificKnowledge } from "./scientificKnowledge.js";
import { queryScientificKnowledge } from "../../bethesda/rain/scientificKnowledgeProtocol.js";

const source: ResearchSource = {
  id: "P-source",
  kind: "corpus",
  title: "Synthetic oscillator manuscript",
  locator: "fixture:paper",
  sha256: "a".repeat(64),
  excerpt: "Assume linear response. $$m x'' + c x' + k x = F(t)$$",
  reading_scope: "Synthetic fixture, not an actual paper",
  retrieved_at: null,
  authors: [],
  year: null,
  doi: null,
};
function journal(values: { kind: string; payload: unknown }[]): DiscoveryEntry[] {
  const entries: DiscoveryEntry[] = [];
  for (const v of values) {
    const body = {
      sequence: entries.length,
      previous: entries.at(-1)?.sha256 ?? null,
      session: "DS-fixture",
      kind: v.kind,
      payload: v.payload,
      at: "2026-10-11T00:00:00Z",
    };
    entries.push({ ...body, sha256: sha256Json(body) });
  }
  return entries;
}
function turn(id = "H-one", sources = [source.id]) {
  return {
    perspective: "James",
    role: "Researcher",
    generation: "model",
    decision_id: id,
    contribution: {
      question: "Is the response linear?",
      hypothesis: "The oscillator responds linearly",
      falsification: "Doubling force fails to double displacement",
      rationale: "Synthetic example",
      source_ids: sources,
      evidence_run_ids: [],
      disagreements: ["A nonlinear response remains possible"],
      next_experiment: "Compare matched force levels",
      search_queries: [],
      mathematical_assumptions: ["Linear response"],
    },
  };
}
const result = {
  design_id: "D-one",
  question: "Is the response linear?",
  design: { primary_metric: "cohort_mean_distance_m" },
  unit: "m",
  operational_hypothesis: "Treatment increases displacement",
  hypothesis: "Proposed displacement",
  purpose: "exploratory",
  parent: null,
  evidence_ids: [],
  run_id: "R-one",
  registry_run_id: "V3D-EXP-0001-RUN-0001",
  verdict: "not_supported",
  replay: true,
  measurements: { cohort_mean_distance_m: 2 },
  per_seed: [],
  critique: null,
  record_path: "records/fixture.json",
};
describe("derived scientific knowledge graph", () => {
  it("indexes the pinned corpus as context and does not claim manuscript validity", () => {
    const graph = buildScientificKnowledge([]);
    expect(graph.nodes.filter((n) => n.kind === "paper")).toHaveLength(17);
    expect(graph.corpus_commit).toMatch(/^[a-f0-9]{40}$/);
    expect(
      graph.nodes
        .filter((n) => n.kind === "paper")
        .every((n) => n.standing === "source_context"),
    ).toBe(true);
    const assumptions = graph.nodes.filter(
      (n) => n.kind === "assumption" && n.standing === "source_context",
    );
    expect(assumptions.length).toBeGreaterThan(0);
    expect(
      graph.nodes.some(
        (n) => n.kind === "question" && n.status === "unresolved in current records",
      ),
    ).toBe(true);
  });
  it("joins an actual numerical run to exact preregistration, replay and native registry admission", () => {
    const root = mkdtempSync(join(tmpdir(), "rain-graph-numerical-"));
    try {
      const compiled = compileNumericalExperiment(oscillatorExample());
      if (!compiled.ok) throw new Error(compiled.errors.join("; "));
      const plan = compiled.value;
      const authorized = authorizeNumerical(plan, {
        operator: "Test.Operator",
        typedPrefix: plan.definition_sha256.slice(0, 8),
        reviewed: true,
        now: new Date(),
      });
      if (!authorized.ok) throw new Error(authorized.errors.join("; "));
      const registry = new Registry(root);
      const receipt = preregisterNumerical(registry, plan);
      const record = executeNumerical(plan, authorized.value);
      const admitted = admitNumericalRecord(registry, receipt, record, {
        commit: "c".repeat(40),
      });
      const entries = journal([
        { kind: "scientific-preregistration", payload: { plan, receipt } },
        { kind: "scientific-record", payload: record },
        {
          kind: "scientific-replay",
          payload: {
            run_id: record.run_id,
            record_sha256: record.sha256,
            ...admitted.replay,
            registry_run_id: admitted.registry_run.run_id,
            registry_experiment_id: receipt.experiment_id,
            registry_definition_sha256: receipt.registry_definition_sha256,
          },
        },
      ]);
      const graph = buildScientificKnowledge(entries, { sources: [source] });
      expect(graph.nodes.find((n) => n.id === record.run_id)?.standing).toBe(
        "verified_simulator",
      );
      expect(
        graph.nodes
          .find((n) => n.id === record.run_id)
          ?.quantities?.find((q) => q.metric === "rms_displacement_delta_m")?.unit,
      ).toBe("m");
      const missing = buildScientificKnowledge(entries.slice(0, 2), {
        sources: [source],
      });
      expect(missing.nodes.find((n) => n.id === record.run_id)?.standing).toBe(
        "host_observed",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("reconstructs stable IDs, explicit equations and gaps without changing inputs", () => {
    const entries = journal([{ kind: "research-turn", payload: turn() }]);
    const before = JSON.stringify(entries);
    const graph = buildScientificKnowledge(entries, { sources: [source] });
    expect(graph).toEqual(buildScientificKnowledge(entries, { sources: [source] }));
    expect(JSON.stringify(entries)).toBe(before);
    expect(
      graph.nodes.some((n) => n.kind === "equation" && n.standing === "source_context"),
    ).toBe(true);
    expect(
      queryScientificKnowledge(graph, { kind: "untested_hypotheses" }).nodes.map(
        (n) => n.id,
      ),
    ).toContain("H-one");
    const gaps = queryScientificKnowledge(graph, { kind: "missing_evidence" });
    expect(gaps.unresolved).toBe(true);
    expect(
      gaps.nodes.every((n) =>
        n.provenance.some((p) => ["journal", "corpus"].includes(p.kind)),
      ),
    ).toBe(true);
  });
  it("shows shared explicitly attributed assumptions and model objections separately", () => {
    const other = { ...source, id: "P-other", sha256: "b".repeat(64) };
    const entries = journal([
      { kind: "research-turn", payload: turn() },
      { kind: "research-turn", payload: turn("H-two", [other.id]) },
    ]);
    const graph = buildScientificKnowledge(entries, { sources: [source, other] });
    const shared = queryScientificKnowledge(graph, {
      kind: "shared_assumptions",
      node_id: source.id,
    });
    expect(shared.nodes.map((n) => n.id)).toContain(other.id);
    expect(
      shared.edges
        .filter((e) => e.relation === "assumes")
        .every((e) => ["model_suggested", "source_context"].includes(e.standing)),
    ).toBe(true);
    const objections = queryScientificKnowledge(graph, {
      kind: "contradictions",
      node_id: "H-one",
    });
    expect(
      objections.edges.some(
        (e) => e.relation === "challenges" && e.standing === "model_suggested",
      ),
    ).toBe(true);
    expect(objections.edges.some((e) => e.relation === "contradicts")).toBe(false);
  });
  it("requires actual preceding replay and registry receipts, preserving valid negative findings", () => {
    const base = [
      { kind: "research-turn", payload: turn() },
      {
        kind: "research-design",
        payload: {
          design_id: "D-one",
          hypothesis: "Treatment increases displacement",
          perspectives: ["H-one"],
          tested_hypothesis_ids: ["H-one"],
        },
      },
    ];
    const unverified = buildScientificKnowledge(
      journal([...base, { kind: "result", payload: result }]),
      { sources: [source] },
    );
    expect(unverified.nodes.find((n) => n.id === result.run_id)?.standing).toBe(
      "host_observed",
    );
    expect(
      queryScientificKnowledge(unverified, { kind: "untested_hypotheses" }).nodes.map(
        (n) => n.id,
      ),
    ).toContain("H-one");
    const entries = journal([
      ...base,
      {
        kind: "replay",
        payload: {
          run_id: result.run_id,
          artifact_sha256: "c".repeat(64),
          verification: { ok: true },
        },
      },
      {
        kind: "registry-admission",
        payload: { run_id: result.run_id, admission: { run_id: result.registry_run_id } },
      },
      { kind: "result", payload: result },
    ]);
    const verified = buildScientificKnowledge(entries, { sources: [source] });
    expect(verified.nodes.find((n) => n.id === result.run_id)).toMatchObject({
      standing: "verified_simulator",
      status: "not_supported",
    });
    expect(
      queryScientificKnowledge(verified, { kind: "untested_hypotheses" }).nodes.map(
        (n) => n.id,
      ),
    ).not.toContain("H-one");
    expect(verified.nodes.some((n) => n.status === "research failure")).toBe(false);
  });
  it("does not convert same-word hypotheses into test links or invent a discriminating experiment", () => {
    const graph = buildScientificKnowledge(
      journal([
        { kind: "research-turn", payload: turn() },
        { kind: "research-turn", payload: turn("H-two") },
        { kind: "result", payload: result },
      ]),
      { sources: [source] },
    );
    const answer = queryScientificKnowledge(graph, {
      kind: "distinguishing_experiment",
      hypothesis_ids: ["H-one", "H-two"],
    });
    expect(answer.unresolved).toBe(true);
    expect(answer.nodes.every((n) => n.kind === "hypothesis")).toBe(true);
    const search = queryScientificKnowledge(graph, {
      kind: "search",
      text: "linear oscillator",
    });
    expect(search.matched_terms).toEqual(["linear", "oscillator"]);
    expect(search.explanation).toContain("similarity");
  });
  it("projects contrary native registry evidence without changing its standing", () => {
    const assessment: ResearchAssessment = {
      claims: [
        {
          id: "claim",
          question: "q",
          statement: "s",
          experiment_id: "V3D-EXP-0001",
          status: "not_supported",
          evidence: [
            {
              run_id: "native-run",
              sha256: "d".repeat(64),
              reviewed: true,
              admissible: true,
              verdict: "not_supported",
              evidence_class: "simulated",
              measurements: {},
              provenance: {},
              artifacts: [],
              problems: [],
            },
          ],
          supporting_runs: [],
          contrary_runs: ["native-run"],
          reasons: [],
          uncertainty: ["Simulator only"],
          confidence: null,
        },
      ],
      edges: [],
      follow_ups: [],
      note: "fixture",
    };
    const graph = buildScientificKnowledge([], { sources: [], registry: [assessment] });
    expect(
      queryScientificKnowledge(graph, {
        kind: "contradictions",
        node_id: "claim",
      }).edges.some(
        (e) => e.relation === "contradicts" && e.standing === "verified_simulator",
      ),
    ).toBe(true);
    expect(graph.nodes.find((n) => n.id === "claim")?.status).toBe(
      assessment.claims[0]!.status,
    );
  });
  it("fails closed on altered journal data", () => {
    const entries = journal([{ kind: "research-turn", payload: turn() }]);
    entries[0]!.kind = "altered";
    expect(() => buildScientificKnowledge(entries, { sources: [] })).toThrow(
      "broken native journal",
    );
  });
});
