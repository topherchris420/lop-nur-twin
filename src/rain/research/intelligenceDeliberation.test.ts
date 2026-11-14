import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ResearchStore } from "../autonomy/store.js";
import type { LocalModel, ModelAnswer, StructuredRequest } from "../autonomy/models.js";
import { TEAM } from "../meeting/perspectives.js";
import { soulText } from "../meeting/souls.js";
import { sha256Json } from "../sha256.js";
import type { IntelligencePlan } from "./intelligence.js";
import type { IntelligenceViewReport } from "./intelligenceView.js";
import { deliberateCpuPlan, type CpuContribution } from "./intelligenceDeliberation.js";

const SESSION = "DS-00000000-0000-4000-8000-000000000001";
let root: string, store: ResearchStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rain-cpu-deliberation-"));
  store = new ResearchStore(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function template(): IntelligencePlan {
  return {
    schema: "rain-intelligence-plan/v1",
    question: "Which frozen CPU control best challenges the current explanation?",
    rivals: { calibrated: 0.5, miscalibrated: 0.5 },
    designs: [
      {
        id: "stable",
        adapter: "qnp-stable",
        parameters: { method: "sequential" },
        predictions: { calibrated: 0.95, miscalibrated: 0.2 },
        cost_units: 1,
        minimum_rate: 0.75,
        hypothesis: "Stable sessions remain quiet.",
        falsification: "The correctness upper bound falls below 75%.",
      },
      {
        id: "drift",
        adapter: "qnp-drift",
        parameters: { method: "sequential" },
        predictions: { calibrated: 0.9, miscalibrated: 0.3 },
        cost_units: 1,
        minimum_rate: 0.7,
        hypothesis: "A new signal is detected without an early alarm.",
        falsification: "The correctness upper bound falls below 70%.",
      },
    ],
    screen_seeds: Array.from({ length: 8 }, (_, i) => i + 84000),
    confirm_seeds: Array.from({ length: 8 }, (_, i) => i + 94000),
    family_alpha: 0.05,
    budget_units: 100,
    timeout_seconds: 30,
    policy: "information",
    parent_campaigns: [],
  };
}
function contribution(call: number): CpuContribution {
  return {
    hypothesis: `[scripted] Frozen control ${call} would expose a false alarm.`,
    rival_explanation: "[scripted] The signal could reflect an incorrect null model.",
    falsification: "[scripted] Fresh simulations fail the frozen correctness endpoint.",
    criticism:
      call === 1
        ? "[scripted] The template assumes independent sessions."
        : `[scripted] Challenge turn ${call - 1}: a quiet detector could also lack power.`,
    recommended_design_id: call === 2 ? "drift" : "stable",
  };
}
function fixture(
  script: (request: StructuredRequest, call: number) => unknown = (_r, n) =>
    contribution(n),
) {
  const requests: StructuredRequest[] = [];
  const model: LocalModel = {
    provider: "lmstudio",
    model: "scripted-cpu-panel",
    endpoint: "http://127.0.0.1:1234",
    generation: "scripted",
    async listModels() {
      throw new Error("No inventory or extra calls are permitted in this stage");
    },
    async complete(request, options): Promise<ModelAnswer> {
      requests.push(structuredClone(request));
      if (options?.signal?.aborted) throw new Error("cancelled");
      const value = script(request, requests.length);
      return {
        text: typeof value === "string" ? value : JSON.stringify(value),
        reportedModel: model.model,
        promptTokens: 20,
        completionTokens: 10,
        latencyMs: 1,
        finishReason: "stop",
      };
    },
  };
  return { model, requests };
}

describe("optional advisory CPU model deliberation", () => {
  it("includes bounded prior measurements with exact report receipts without changing the frozen template", async () => {
    const plan = template(),
      { model, requests } = fixture();
    const report: IntelligenceViewReport = {
      schema: "rain-intelligence-report/v1",
      study_id: "DS-00000000-0000-4000-8000-000000000002",
      plan_sha256: sha256Json(plan),
      question: "[scripted report context] Prior control study",
      policy: "information",
      status: "complete",
      budget: {
        ceiling_units: 100,
        reserved_units: 16,
        completed_units: 16,
        runtime_ms: 1,
        model_calls: 0,
      },
      rivals: [],
      designs: [
        {
          ...plan.designs[0]!,
          expected_bits: 0.1,
          screen: {
            mean: 0.5,
            lower: 0.1,
            upper: 0.9,
            alpha: 0.01,
            n: 8,
            verdict: "inconclusive",
            checks: { fixture_control: true },
            method: "scripted-test",
          },
          confirmation: null,
          registry_run: "V3D-EXP-0001-RUN-0001",
          state: "completed",
          error: null,
        },
      ],
      reviews: [],
      events: [],
      limitations: ["Scripted test context; no genuine experiment was run."],
    };
    const original = structuredClone(report);
    await deliberateCpuPlan({
      session: SESSION,
      store,
      template: plan,
      verifiedReports: [report],
      model,
    });
    const prior = JSON.parse(requests[0]!.user).template_context.prior_report_excerpts[0];
    expect(prior).toMatchObject({
      study_id: report.study_id,
      report_sha256: sha256Json(report),
      designs: [{ screen: { verdict: "inconclusive", n: 8 } }],
    });
    expect(report).toEqual(original);
    expect(prior).not.toHaveProperty("reviews");
    const other = fixture();
    await expect(
      deliberateCpuPlan({
        session: "DS-00000000-0000-4000-8000-000000000003",
        store,
        template: plan,
        verifiedReports: Array.from({ length: 5 }, () => report),
        model: other.model,
      }),
    ).rejects.toThrow("context_limit");
    expect(other.requests).toHaveLength(0);
  });

  it("calls each unchanged SOUL exactly once and records attributed, challenging contributions", async () => {
    const plan = template(),
      original = structuredClone(plan),
      { model, requests } = fixture();
    const result = await deliberateCpuPlan({
      session: SESSION,
      store,
      template: plan,
      model,
    });
    expect(requests).toHaveLength(4);
    for (const [index, member] of TEAM.entries()) {
      expect(requests[index]!.system).toContain(soulText(member.name));
      expect(requests[index]!.system).toContain(member.role);
      expect(requests[index]!.system).toContain(
        "Critically examine the earlier contributions",
      );
      const context = JSON.parse(requests[index]!.user);
      expect(context.earlier_contributions).toHaveLength(index);
      if (index)
        expect(context.earlier_contributions[0].contribution.hypothesis).toBe(
          contribution(1).hypothesis,
        );
      expect(context.template_context).not.toHaveProperty("screen_seeds");
      expect(context.template_context).not.toHaveProperty("confirm_seeds");
      expect(
        requests[index]!.system.length + requests[index]!.user.length,
      ).toBeLessThanOrEqual(32000);
    }
    expect(plan).toEqual(original);
    expect(result).toMatchObject({
      generation: "scripted",
      model_calls: 4,
      prompt_tokens: 80,
      completion_tokens: 40,
    });
    expect(result.template_sha256).toBe(sha256Json(original));
    expect(result.contributions.map((turn) => turn.agent)).toEqual(
      TEAM.map((member) => member.name),
    );
    expect(result.recommended_ranks).toEqual([
      { design_id: "stable", model_votes: 3, agents: ["James", "Luca", "Elena"] },
      { design_id: "drift", model_votes: 1, agents: ["Jasmine"] },
    ]);
    const entries = store.discoveryEntries();
    expect(
      entries.filter((entry) => entry.kind === "cpu-deliberation-request"),
    ).toHaveLength(4);
    expect(
      entries.filter((entry) => entry.kind === "cpu-deliberation-answer"),
    ).toHaveLength(4);
    expect(
      entries.filter((entry) => entry.kind === "cpu-deliberation-contribution"),
    ).toHaveLength(4);
    expect(
      entries.some(
        (entry) => entry.kind === "cpu-authorized" || entry.kind === "cpu-reserved",
      ),
    ).toBe(false);
    expect(store.lock()).toBeNull();
  });

  it("retains an out-of-vocabulary answer and stops without any repair or extra inference", async () => {
    const { model, requests } = fixture((_request, n) => ({
      ...contribution(n),
      recommended_design_id: "new-code",
    }));
    await expect(
      deliberateCpuPlan({ session: SESSION, store, template: template(), model }),
    ).rejects.toThrow("invalid_contribution");
    expect(requests).toHaveLength(1);
    const entries = store.discoveryEntries();
    expect(
      entries.find((entry) => entry.kind === "cpu-deliberation-answer")!.payload,
    ).toMatchObject({
      identity: { generation: "scripted", model: "scripted-cpu-panel" },
      answer: {
        text: JSON.stringify({ ...contribution(1), recommended_design_id: "new-code" }),
      },
    });
    expect(entries.at(-1)!.payload).toMatchObject({
      code: "invalid_contribution",
      model_calls: 1,
    });
    expect(store.lock()).toBeNull();
  });

  it("refuses executable or criterion fields even when the design ID is valid", async () => {
    const { model } = fixture((_request, n) => ({
      ...contribution(n),
      command: "execute something",
      minimum_rate: 0,
    }));
    await expect(
      deliberateCpuPlan({ session: SESSION, store, template: template(), model }),
    ).rejects.toThrow("invalid_contribution");
    expect(
      store
        .discoveryEntries()
        .some((entry) => entry.kind === "cpu-deliberation-completed"),
    ).toBe(false);
  });

  it("records pre-start cancellation without invoking a model", async () => {
    const abort = new AbortController(),
      { model, requests } = fixture();
    abort.abort();
    await expect(
      deliberateCpuPlan({
        session: SESSION,
        store,
        template: template(),
        model,
        signal: abort.signal,
      }),
    ).rejects.toThrow("cancelled");
    expect(requests).toHaveLength(0);
    expect(store.discoveryEntries().at(-1)!.payload).toMatchObject({
      code: "cancelled",
      model_calls: 0,
    });
    expect(store.lock()).toBeNull();
  });

  it("retains an answer arriving during cancellation without using it or calling another seat", async () => {
    const abort = new AbortController();
    const { model, requests } = fixture((_request, n) => {
      abort.abort();
      return contribution(n);
    });
    await expect(
      deliberateCpuPlan({
        session: SESSION,
        store,
        template: template(),
        model,
        signal: abort.signal,
      }),
    ).rejects.toThrow("cancelled");
    expect(requests).toHaveLength(1);
    expect(
      store
        .discoveryEntries()
        .filter((entry) => entry.kind === "cpu-deliberation-answer"),
    ).toHaveLength(1);
    expect(
      store
        .discoveryEntries()
        .filter((entry) => entry.kind === "cpu-deliberation-contribution"),
    ).toHaveLength(0);
    expect(store.lock()).toBeNull();
  });

  it("retains a model failure and earlier contributions while suppressing private diagnostic text", async () => {
    const { model, requests } = fixture((_request, n) => {
      if (n === 2) throw new Error("private diagnostic must not be copied");
      return contribution(n);
    });
    await expect(
      deliberateCpuPlan({ session: SESSION, store, template: template(), model }),
    ).rejects.toThrow("model_failure");
    expect(requests).toHaveLength(2);
    const entries = store.discoveryEntries();
    expect(
      entries.filter((entry) => entry.kind === "cpu-deliberation-contribution"),
    ).toHaveLength(1);
    expect(entries.at(-1)!.payload).toMatchObject({
      code: "model_failure",
      model_calls: 2,
      retained_contributions: 1,
    });
    expect(JSON.stringify(entries)).not.toContain(
      "private diagnostic must not be copied",
    );
    expect(store.lock()).toBeNull();
  });

  it("preserves unknown token usage and cannot reuse a session to exceed its four-call ceiling", async () => {
    const { model, requests } = fixture();
    const complete = model.complete;
    model.complete = async (...args) => ({
      ...(await complete(...args)),
      promptTokens: null,
    });
    const result = await deliberateCpuPlan({
      session: SESSION,
      store,
      template: template(),
      model,
    });
    expect(result.prompt_tokens).toBeNull();
    expect(result.completion_tokens).toBe(40);
    await expect(
      deliberateCpuPlan({ session: SESSION, store, template: template(), model }),
    ).rejects.toThrow("session_already_used");
    expect(requests).toHaveLength(4);
  });

  it("retains a changed reported model and refuses to treat it as the approved participant", async () => {
    const { model, requests } = fixture();
    const complete = model.complete;
    model.complete = async (...args) => ({
      ...(await complete(...args)),
      reportedModel: "different-model",
    });
    await expect(
      deliberateCpuPlan({ session: SESSION, store, template: template(), model }),
    ).rejects.toThrow("model_identity_changed");
    expect(requests).toHaveLength(1);
    expect(
      store.discoveryEntries().find((entry) => entry.kind === "cpu-deliberation-answer")!
        .payload,
    ).toMatchObject({
      answer: { reportedModel: "different-model" },
    });
  });
});
