import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ResearchStore } from "../autonomy/store.js";
import {
  activeResearchGuidance,
  approveGuidance,
  learningView,
  proposeGuidance,
  recurringProcessErrors,
  rollbackGuidance,
} from "./learning.js";
import {
  evaluateFrozenLearning,
  evaluateProposal,
  freezeLearningEvaluation,
  parameterGridHoldout,
  parameterGridParticipant,
  validateLearningEvaluation,
  type LearningPlan,
} from "./learningEvaluation.js";
import type {
  GuidanceScope,
  LearningEvaluation,
} from "../../bethesda/rain/learningProtocol.js";
let root: string, store: ResearchStore;
const scope: GuidanceScope = {
  domain: "urban-simulation",
  backend: "bethesda",
  stage: "design",
  scenario: null,
  error: "parameter-grid",
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rain-learning-"));
  store = new ResearchStore(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function proposal(
  instructions = "Use 100-tick steps for warm-up and observation windows before submission; preserve matched controls and fixed evaluation criteria.",
) {
  const errors = [
    store.appendDiscovery("training-a", "validation", {
      ok: false,
      errors: ["warmup must use 100-tick steps"],
    }),
    store.appendDiscovery("training-b", "validation", {
      ok: false,
      errors: ["window must use 100-tick steps"],
    }),
  ];
  return proposeGuidance(store, "operator", {
    scope,
    instructions,
    evidence: errors.map((e) => e.sha256),
    proposer: "host-recurring-error-detector/v1",
    generation: "host",
  });
}
function plan(p: string): Omit<LearningPlan, "schema" | "rules"> {
  return {
    proposal: p,
    evaluator: "independent-heldout-evaluator/v1",
    generation: "scripted" as const,
    tasks: parameterGridHoldout(),
    budget: { calls_per_arm: 8, max_tokens_per_arm: null, timeout_ms: 60000 },
  };
}
describe("procedural research learning authority and evidence", () => {
  it("requires fresh held-out designs across guidance versions even when task IDs are renamed", async () => {
    const first = proposal();
    await evaluateProposal(store, "evaluation", first.sha256);
    const next = proposal("Use multiples of 100 for warm-up and observation windows.");
    expect(() =>
      freezeLearningEvaluation(store, "evaluation", plan(next.sha256)),
    ).toThrow("Fresh held-out");
    const renamed = plan(next.sha256);
    renamed.tasks.forEach((task, index) => {
      task.id = `renamed-${index}`;
    });
    expect(() => freezeLearningEvaluation(store, "evaluation", renamed)).toThrow(
      "Fresh held-out",
    );
    renamed.tasks.forEach((task) => {
      task.input_design.parameters.pedestrians += 1;
    });
    expect(freezeLearningEvaluation(store, "evaluation", renamed).kind).toBe(
      "learning-plan",
    );
  });
  it("detects only repeated deterministic process errors, excluding honest negatives and model criticism", () => {
    store.appendDiscovery("science", "result", {
      verdict: "FAILURE",
      hypothesis: "refuted by valid measurements",
    });
    store.appendDiscovery("science", "analysis", {
      assessment: "revise",
      errors: ["window must use 100-tick steps"],
    });
    expect(recurringProcessErrors(store.discoveryEntries())).toEqual([]);
    const p = proposal();
    expect(recurringProcessErrors(store.discoveryEntries())).toMatchObject([
      { code: "parameter-grid", count: 2 },
    ]);
    expect(learningView(store.discoveryEntries()).proposals[0]).toMatchObject({
      sha256: p.sha256,
      status: "proposed",
    });
    expect(
      activeResearchGuidance(store.discoveryEntries(), {
        domain: "urban-simulation",
        backend: "bethesda",
        stage: "design",
      }),
    ).toEqual([]);
  });
  it("compares the unchanged compiler on matched held-out designs and requires full operator digest to activate", async () => {
    const p = proposal();
    expect(() =>
      approveGuidance(store, "operator", {
        proposal: p.sha256,
        evaluation: p.sha256,
        operator: "Test.Operator",
        reviewed: true,
        typedDigest: p.sha256,
      }),
    ).toThrow("exact beneficial");
    const receipt = await evaluateProposal(store, "evaluation", p.sha256);
    const e = receipt.payload as LearningEvaluation;
    expect(e.sample_size).toBe(8);
    expect(e.baseline.compiler_success.successes).toBe(0);
    expect(e.candidate.compiler_success.successes).toBe(8);
    expect(e.paired).toEqual({
      wins: 8,
      losses: 0,
      ties: 0,
      effect: 1,
      exact_two_sided_p: 0.0078125,
    });
    expect(e.beneficial).toBe(true);
    expect(e.resources).toMatchObject({
      baseline_calls: 8,
      candidate_calls: 8,
      compiler_calls: 32,
      execution_actor_ticks: 0,
      baseline_tokens: null,
    });
    expect(e.candidate.compiler_success.interval95[0]).toBeGreaterThan(0.6);
    expect(e.limitations.join(" ")).toContain(
      "does not establish improved Qwen intelligence",
    );
    expect(
      e.tasks.every((t) => t.baseline_errors.length && !t.candidate_errors.length),
    ).toBe(true);
    expect(() =>
      approveGuidance(store, "operator", {
        proposal: p.sha256,
        evaluation: receipt.sha256,
        operator: "Test.Operator",
        reviewed: false,
        typedDigest: receipt.sha256,
      }),
    ).toThrow("Operator");
    expect(() =>
      approveGuidance(store, "operator", {
        proposal: p.sha256,
        evaluation: receipt.sha256,
        operator: "Test.Operator",
        reviewed: true,
        typedDigest: receipt.sha256.slice(0, 8),
      }),
    ).toThrow("Operator");
    const a = approveGuidance(store, "operator", {
      proposal: p.sha256,
      evaluation: receipt.sha256,
      operator: "Test.Operator",
      reviewed: true,
      typedDigest: receipt.sha256,
    });
    expect(
      activeResearchGuidance(store.discoveryEntries(), {
        domain: "urban-simulation",
        backend: "bethesda",
        stage: "design",
      }),
    ).toHaveLength(1);
    expect(
      activeResearchGuidance(store.discoveryEntries(), {
        domain: "urban-simulation",
        backend: "bethesda",
        stage: "deliberation",
      }),
    ).toEqual([]);
    rollbackGuidance(store, "operator", {
      activation: a.sha256,
      operator: "Test.Operator",
      reason: "Review requests larger independent samples",
      reviewed: true,
      typedDigest: a.sha256,
    });
    const reloaded = new ResearchStore(root);
    expect(
      activeResearchGuidance(reloaded.discoveryEntries(), {
        domain: "urban-simulation",
        backend: "bethesda",
        stage: "design",
      }),
    ).toEqual([]);
    expect(learningView(reloaded.discoveryEntries()).proposals[0]!.status).toBe(
      "rolled-back",
    );
    expect(reloaded.records()).toEqual([]);
  });
  it("retains a no-improvement proposal and prevents activation", async () => {
    const p = proposal("Keep good notes and investigate thoughtfully.");
    const receipt = await evaluateProposal(store, "evaluation", p.sha256);
    expect((receipt.payload as LearningEvaluation).beneficial).toBe(false);
    expect(() =>
      approveGuidance(store, "operator", {
        proposal: p.sha256,
        evaluation: receipt.sha256,
        operator: "Test.Operator",
        reviewed: true,
        typedDigest: receipt.sha256,
      }),
    ).toThrow("beneficial");
    expect(learningView(store.discoveryEntries()).proposals[0]!.status).toBe("evaluated");
  });
  it("rejects training contamination, self evaluation, scope mismatch and outcome-driven rule changes", async () => {
    const p = proposal(),
      contaminated = plan(p.sha256);
    contaminated.tasks[0]!.origin_entries = (
      p.payload as { evidence: string[] }
    ).evidence;
    expect(() => freezeLearningEvaluation(store, "evaluation", contaminated)).toThrow(
      "disjoint",
    );
    const self = plan(p.sha256);
    self.evaluator = (p.payload as { proposer: string }).proposer;
    expect(() => freezeLearningEvaluation(store, "evaluation", self)).toThrow(
      "independent",
    );
    const frozen = freezeLearningEvaluation(store, "evaluation", plan(p.sha256));
    await evaluateFrozenLearning(
      store,
      "evaluation",
      frozen.sha256,
      parameterGridParticipant,
    );
    const changed = plan(p.sha256);
    changed.tasks[0]!.preferred_primary_metric = "leaving";
    expect(() => freezeLearningEvaluation(store, "evaluation", changed)).toThrow(
      "already has a frozen",
    );
    await expect(
      evaluateFrozenLearning(
        store,
        "evaluation",
        frozen.sha256,
        parameterGridParticipant,
      ),
    ).rejects.toThrow("already attempted");
    expect(() =>
      proposeGuidance(store, "operator", {
        scope: { ...scope, stage: "deliberation" },
        instructions: "Use 100-tick steps",
        evidence: (p.payload as { evidence: string[] }).evidence,
        proposer: "model-researcher",
        generation: "model",
        parent: p.sha256,
      }),
    ).toThrow("retain its scope");
  });
  it("preserves immutable version history and applies only explicitly matching scenario guidance", async () => {
    const p = proposal();
    const v2 = proposeGuidance(store, "operator", {
      scope: { ...scope, scenario: null },
      instructions: "Use 100-tick steps and preserve uncertainty",
      evidence: (p.payload as { evidence: string[] }).evidence,
      proposer: "researcher",
      generation: "model",
      parent: p.sha256,
    });
    expect((v2.payload as { version: number }).version).toBe(2);
    const scoped = proposeGuidance(store, "operator", {
      scope: { ...scope, scenario: "fire" },
      instructions: "Use 100-tick steps",
      evidence: (p.payload as { evidence: string[] }).evidence,
      proposer: "researcher",
      generation: "model",
    });
    const evalReceipt = await evaluateProposal(store, "evaluation", scoped.sha256);
    approveGuidance(store, "operator", {
      proposal: scoped.sha256,
      evaluation: evalReceipt.sha256,
      operator: "Test.Operator",
      reviewed: true,
      typedDigest: evalReceipt.sha256,
    });
    expect(
      activeResearchGuidance(store.discoveryEntries(), {
        domain: "urban-simulation",
        backend: "bethesda",
        stage: "design",
        scenario: "storm",
      }),
    ).toEqual([]);
    expect(
      activeResearchGuidance(store.discoveryEntries(), {
        domain: "urban-simulation",
        backend: "bethesda",
        stage: "design",
        scenario: "fire",
      }),
    ).toHaveLength(1);
  });
  it("fails closed on corrupted journal or fabricated evaluation scores", async () => {
    const p = proposal(),
      receipt = await evaluateProposal(store, "evaluation", p.sha256);
    const fake = structuredClone(receipt.payload) as LearningEvaluation;
    fake.baseline.valid_proposals.successes = 8;
    expect(
      validateLearningEvaluation(
        store.discoveryEntries().slice(0, receipt.sequence),
        fake,
      ),
    ).toBe(false);
    const path = join(root, "discovery", "00000000.json");
    const original = JSON.parse(readFileSync(path, "utf8"));
    original.payload.ok = true;
    writeFileSync(path, JSON.stringify(original));
    expect(() => store.discoveryEntries()).toThrow("integrity");
  });
  it("retains failed held-out evaluations and refuses unreported enforced token budgets", async () => {
    const p = proposal(),
      input = plan(p.sha256);
    input.budget.max_tokens_per_arm = 100;
    const frozen = freezeLearningEvaluation(store, "evaluation", input);
    await expect(
      evaluateFrozenLearning(
        store,
        "evaluation",
        frozen.sha256,
        parameterGridParticipant,
      ),
    ).rejects.toThrow("unreported");
    expect(
      store.discoveryEntries().some((e) => e.kind === "learning-evaluation-answer"),
    ).toBe(true);
    expect(
      store.discoveryEntries().some((e) => e.kind === "learning-evaluation-incomplete"),
    ).toBe(true);
    expect(learningView(store.discoveryEntries()).proposals[0]!.status).toBe("proposed");
  });
});
