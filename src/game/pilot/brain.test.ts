import { describe, expect, it } from "vitest";
import { confidenceFromAxes } from "./brain";
import { DECISION_SCHEMA_VERSION } from "./contract";
import { parseAllAxes } from "./decision";
import { LLM_DECISION_SCHEMA, parseLlmAnswers, validateLlmDecision } from "./llmDecision";
import {
  GlideHttpProvider,
  JevHttpProvider,
  LlmHttpProvider,
  RandomProvider,
} from "./providers";
import { ScriptedProvider } from "./policies";
import { fakeAnswers, makeObservation } from "./testing/fixtures";
import type { DecisionProvider } from "./loop";

/**
 * The provider-independent decision interface: every brain enters through the
 * same seam, describes itself the same way and accounts for its decisions the
 * same way. Unknowns stay null.
 */

const observation = makeObservation({ sequence: 5, control: "precision" });
const request = () => ({
  sequence: 5,
  observation,
  signal: new AbortController().signal,
});

const jevBody = () => {
  const axes = parseAllAxes(fakeAnswers(observation.legal), observation.legal);
  if (!axes.ok) throw new Error(axes.error);
  const frame = {
    move: axes.value.move.choice,
    turn: axes.value.turn.choice,
    tilt: axes.value.tilt.choice,
    weapon: axes.value.weapon.choice,
    target: axes.value.target?.choice ?? "NONE",
    aim: axes.value.aim?.choice ?? "CENTER_MASS",
    go: "NONE",
  };
  return {
    schemaVersion: DECISION_SCHEMA_VERSION,
    sequence: 5,
    source: "typesafe",
    model: "jev-1.13.0",
    frame,
    axes: axes.value,
    latencyMs: 140,
    usage: { inputTokens: 1400, outputTokens: 80 },
    questionHash: "0123456789abcdef",
  };
};

const llmBody = (overrides: Record<string, unknown> = {}) => {
  const answers: Record<string, { choice: string; confidence: number | null }> = {};
  for (const axis of ["move", "turn", "tilt", "weapon", "target", "aim"] as const) {
    answers[axis] = {
      choice: (observation.legal[axis] as string[])[0]!,
      confidence: 0.7,
    };
  }
  const parsed = parseLlmAnswers(answers, observation.legal);
  if (!parsed.ok) throw new Error(parsed.error);
  return {
    schemaVersion: LLM_DECISION_SCHEMA,
    sequence: 5,
    source: "llm",
    provider: "openai-compatible",
    model: "test-double-1",
    frame: parsed.value.frame,
    answers,
    confidenceSource: "verbalized",
    latencyMs: 900,
    usage: { inputTokens: 2000, outputTokens: 60 },
    retries: 1,
    traceId: "call-1",
    questionHash: "fedcba9876543210",
    ...overrides,
  };
};

const serve = (body: unknown, status = 200) =>
  (async () => Response.json(body, { status })) as unknown as typeof fetch;

describe("every brain describes itself", () => {
  const brains: DecisionProvider[] = [
    new JevHttpProvider("0123456789abcdef", "/x", serve({})),
    new GlideHttpProvider("0123456789abcdef", "/x", serve({})),
    new LlmHttpProvider("0123456789abcdef", "/x", serve({})),
    new RandomProvider(1),
    new ScriptedProvider("marksman"),
  ];
  it("with an id, a provider, capabilities and a confidence source", () => {
    expect(brains.map((b) => [b.descriptor?.id, b.descriptor?.confidence])).toEqual([
      ["jev", "provider-probability"],
      ["glide", "provider-probability"],
      ["llm", "verbalized"],
      ["random", "none"],
      ["script:marksman", "none"],
    ]);
    for (const b of brains)
      expect(b.descriptor!.capabilities.control.length).toBeGreaterThan(0);
  });
});

describe("decision accounting", () => {
  it("records Jev's bytes, tokens, provider latency and question hash", async () => {
    const result = await new JevHttpProvider(
      "0123456789abcdef",
      "/x",
      serve(jevBody()),
    ).decide(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.decision.accounting!;
    expect(a).toMatchObject({
      provider: "typesafe",
      model: "jev-1.13.0",
      providerLatencyMs: 140,
      inputTokens: 1400,
      outputTokens: 80,
      retries: 0,
      reportedCostUsd: null,
      questionHash: "0123456789abcdef",
    });
    expect(a.requestBytes).toBeGreaterThan(500);
    expect(a.responseBytes).toBeGreaterThan(100);
    expect(result.decision.confidence!.source).toBe("provider-probability");
    expect(result.decision.confidence!.perAxis.move).toEqual({
      probability: 0.7,
      confidence: 0.62,
    });
  });

  it("records Glide's decision as Fastino's, with Fastino's own probabilities", async () => {
    const result = await new GlideHttpProvider(
      "0123456789abcdef",
      "/x",
      serve({ ...jevBody(), source: "fastino", model: "glide", latencyMs: 820 }),
    ).decide(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.model).toBe("glide");
    expect(result.decision.accounting).toMatchObject({
      provider: "fastino",
      model: "glide",
      providerLatencyMs: 820,
      retries: 0,
      reportedCostUsd: null,
    });
    expect(result.decision.confidence!.source).toBe("provider-probability");
    expect(result.decision.confidence!.perAxis.move).toEqual({
      probability: 0.7,
      confidence: 0.62,
    });
  });

  it("never takes one provider's answer for the other's", async () => {
    const glide = await new GlideHttpProvider(
      "0123456789abcdef",
      "/x",
      serve(jevBody()),
    ).decide(request());
    expect(!glide.ok && glide.failure).toBe("invalid");
    expect(!glide.ok && glide.detail).toBe("decision from typesafe, expected fastino");
    const jev = await new JevHttpProvider(
      "0123456789abcdef",
      "/x",
      serve({ ...jevBody(), source: "fastino", model: "glide" }),
    ).decide(request());
    expect(!jev.ok && jev.detail).toBe("decision from fastino, expected typesafe");
  });

  it("keeps unknown tokens unknown", async () => {
    const result = await new JevHttpProvider(
      "0123456789abcdef",
      "/x",
      serve({ ...jevBody(), usage: null }),
    ).decide(request());
    expect(result.ok && result.decision.accounting!.inputTokens).toBeNull();
    expect(result.ok && result.decision.accounting!.outputTokens).toBeNull();
  });

  it("records an LLM's verbalized confidence as verbalized, with no probability", async () => {
    const result = await new LlmHttpProvider(
      "0123456789abcdef",
      "/x",
      serve(llmBody()),
    ).decide(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.axes).toBeNull();
    expect(result.decision.confidence!.source).toBe("verbalized");
    expect(result.decision.confidence!.perAxis.move).toEqual({
      probability: null,
      confidence: 0.7,
    });
    expect(result.decision.accounting).toMatchObject({
      provider: "openai-compatible",
      retries: 1,
      traceId: "call-1",
    });
  });

  it("local brains account for nothing and claim nothing", async () => {
    const result = await new RandomProvider(3).decide(request());
    expect(result.ok && result.decision.accounting!.provider).toBe("local");
    expect(result.ok && result.decision.confidence).toEqual({
      source: "none",
      perAxis: {},
    });
  });

  it("derives no confidence at all without TypeSafe's axes", () => {
    expect(confidenceFromAxes(null)).toEqual({ source: "none", perAxis: {} });
  });
});

describe("LLM output validation", () => {
  it("refuses a choice that was not offered", () => {
    const body = llmBody({
      answers: { ...llmBody().answers, weapon: { choice: "TELEPORT", confidence: 0.9 } },
    });
    expect(validateLlmDecision(body, { sequence: 5, legal: observation.legal }).ok).toBe(
      false,
    );
  });

  it("refuses an answer for an axis that was not asked", () => {
    const direct = makeObservation({ sequence: 5 });
    const answers = { ...llmBody().answers };
    expect(parseLlmAnswers(answers, direct.legal).ok).toBe(false);
  });

  it("refuses a confidence outside [0, 1], and a confidence under the source 'none'", () => {
    const high = llmBody({
      answers: { ...llmBody().answers, move: { choice: "HOLD", confidence: 1.4 } },
    });
    expect(validateLlmDecision(high, { sequence: 5, legal: observation.legal }).ok).toBe(
      false,
    );
    const mislabelled = llmBody({ confidenceSource: "none" });
    expect(
      validateLlmDecision(mislabelled, { sequence: 5, legal: observation.legal }).ok,
    ).toBe(false);
  });

  it("refuses a frame that disagrees with the answers, and a wrong sequence", () => {
    const body = llmBody();
    const tampered = { ...body, frame: { ...body.frame, weapon: "RELOAD" } };
    expect(
      validateLlmDecision(tampered, { sequence: 5, legal: observation.legal }).ok,
    ).toBe(false);
    expect(validateLlmDecision(body, { sequence: 6, legal: observation.legal }).ok).toBe(
      false,
    );
  });

  it("maps a malformed body to an invalid failure, and a refusal to a refused one", async () => {
    const malformed = await new LlmHttpProvider(
      "0123456789abcdef",
      "/x",
      serve({ nonsense: true }),
    ).decide(request());
    expect(!malformed.ok && malformed.failure).toBe("invalid");
    const refused = await new LlmHttpProvider(
      "0123456789abcdef",
      "/x",
      serve(
        {
          schemaVersion: DECISION_SCHEMA_VERSION,
          sequence: 5,
          error: { code: "upstream_refused", message: "declined" },
          retryAfterMs: null,
        },
        422,
      ),
    ).decide(request());
    expect(!refused.ok && refused.failure).toBe("refused");
  });
});
