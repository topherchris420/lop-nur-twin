import { describe, expect, it } from "vitest";
import { partnership } from "../../bethesda/rain/inceptionProtocol.js";
import { cognitiveMemory } from "./partnership.js";
import { sha256Json } from "../sha256.js";
import type { DiscoveryEntry } from "../autonomy/store.js";
import type {
  ResearchSource,
  ResearchTurn,
} from "../../bethesda/rain/researchProtocol.js";
import {
  researchScopeErrors,
  researchScope,
} from "../../bethesda/rain/researchProtocol.js";
const source: ResearchSource = {
  id: "fixture-source",
  kind: "corpus",
  title: "SCRIPTED SOURCE FIXTURE",
  locator: "fixture",
  sha256: sha256Json("fixture"),
  excerpt: "Unverified fixture source context",
  reading_scope: "fixture",
  retrieved_at: null,
  authors: [],
  year: null,
  doi: null,
};
const turn: ResearchTurn = {
  perspective: "Christopher-Sim",
  role: "Founder hypothesis",
  generation: "model",
  decision_id: "fixture-decision",
  contribution: {
    question: "Fixture question",
    hypothesis: "Tentative relationship",
    falsification: "A counterexample would oppose this",
    rationale: "Fixture rationale",
    source_ids: [source.id],
    evidence_run_ids: ["verified-run"],
    disagreements: ["Competing mechanism remains unresolved"],
    next_experiment: "Compare the alternatives",
    search_queries: [],
    mathematical_assumptions: [],
  },
};
const entry = (kind: string, payload: unknown): DiscoveryEntry => ({
  sequence: 0,
  previous: null,
  session: "fixture-session",
  kind,
  at: "2026-01-01T00:00:00Z",
  payload,
  sha256: sha256Json({ kind, payload }),
});
describe("cognitive memory boundaries", () => {
  it("preserves uncertainty and rejects stale references, profile changes and reset epochs", () => {
    const config = partnership();
    const entries = [
      entry("research-start", {
        program_id: "fixture-program",
        scope: { partnership: config },
      }),
      entry("research-turn", turn),
    ];
    const read = (p = config, runs = new Set(["verified-run"]), sources = [source]) =>
      cognitiveMemory(entries, "fixture-program", p, sources, runs);
    const memory = read();
    expect(memory.filter((m) => m.layer === "semantic").map((m) => m.status)).toEqual([
      "model-inferred",
    ]);
    expect(memory.every((m) => m.about === "computational-research")).toBe(true);
    expect(
      memory.some((m) => m.layer === "critical" && m.origin === entries[1]!.sha256),
    ).toBe(true);
    expect(
      read({ ...config, memory_epoch: 1 }).every((m) => m.layer === "foundational"),
    ).toBe(true);
    expect(
      read({ ...config, profile: { ...config.profile, version: 2 } }).every(
        (m) => m.layer === "foundational",
      ),
    ).toBe(true);
    expect(read(config, new Set()).every((m) => m.layer === "foundational")).toBe(true);
    expect(read(config, new Set(["verified-run"]), [])).toEqual([]);
    expect(
      memory
        .filter((m) => m.namespace === "Research-Collaborator")
        .every((m) => m.layer === "foundational"),
    ).toBe(true);
  });
  it("refuses additional profile privileges and invalid modes", () => {
    const scope = {
      ...researchScope("A bounded fixture question", false),
      partnership: partnership(),
    };
    expect(researchScopeErrors(scope)).toEqual([]);
    expect(
      researchScopeErrors({
        ...scope,
        partnership: { ...scope.partnership, tools: ["shell"] },
      }).length,
    ).toBeGreaterThan(0);
    expect(
      researchScopeErrors({
        ...scope,
        partnership: { ...scope.partnership, mode: "unbounded" },
      }).length,
    ).toBeGreaterThan(0);
  });
});
