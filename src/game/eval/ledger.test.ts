import { describe, expect, it } from "vitest";
import { buildLedger, ledgerCalls } from "./ledger";
import { PRICING_SCHEMA, type PricingConfig } from "./pricing";
import { DECISION_RECORD_VERSION, type FailureRecord } from "./records";
import { record } from "./testing/fixtures";

const remote = (latency: number, tokens: [number, number] | null) =>
  record({
    source: "llm",
    accounting: {
      provider: "p",
      model: "m",
      wallLatencyMs: latency,
      providerLatencyMs: latency - 20,
      requestBytes: 3000,
      responseBytes: 400,
      inputTokens: tokens?.[0] ?? null,
      outputTokens: tokens?.[1] ?? null,
      reportedCostUsd: null,
      retries: 0,
      traceId: null,
      questionHash: null,
      injectedLatencyMs: 0,
    },
  });

const pricing: PricingConfig = {
  schema: PRICING_SCHEMA,
  currency: "USD",
  models: [
    {
      provider: "p",
      model: "m",
      match: "exact",
      inputPerMTok: 1,
      outputPerMTok: 5,
      perRequest: null,
      source: "fixture",
      asOf: "2026-01-01",
    },
  ],
};

const failure = (kind: string): FailureRecord => ({
  schema: DECISION_RECORD_VERSION,
  episodeId: "synthetic",
  sequence: 999,
  kind,
  detail: "",
  latencyMs: 2200,
  staleAnswer: false,
});

describe("computational ledger", () => {
  it("totals cost only when every call's cost is known", () => {
    const calls = ledgerCalls(
      [remote(200, [1000, 100]), remote(300, [2000, 200])],
      [],
      pricing,
      {
        provider: "p",
        model: "m",
      },
    );
    const ledger = buildLedger(calls, 120, { label: "eliminations", count: 3 }, 2);
    expect(ledger.cost.totalUsd).toBeCloseTo((1000 + 500 + 2000 + 1000) / 1e6, 12);
    expect(ledger.decisionsPerMinute).toBe(1);
    expect(ledger.costPerMinuteUsd).toBeCloseTo(ledger.cost.totalUsd! / 2, 12);
    expect(ledger.costPerObjectiveUsd).toBeCloseTo(ledger.cost.totalUsd! / 3, 12);
    expect(ledger.costPerUsefulDecisionUsd).toBeCloseTo(ledger.cost.totalUsd! / 2, 12);
    expect(ledger.inputTokens.total).toBe(3000);
  });

  it("keeps missing token counts unknown, all the way up", () => {
    const calls = ledgerCalls(
      [remote(200, [1000, 100]), remote(300, null)],
      [],
      pricing,
      {
        provider: "p",
        model: "m",
      },
    );
    const ledger = buildLedger(calls, 60, null, null);
    expect(ledger.cost.totalUsd).toBeNull();
    expect(ledger.cost.unknownCalls).toBe(1);
    expect(ledger.cost.knownUsd).toBeGreaterThan(0);
    expect(ledger.inputTokens.total).toBeNull();
    expect(ledger.inputTokens.unknownCalls).toBe(1);
    expect(ledger.costPerMinuteUsd).toBeNull();
  });

  it("counts a remote failure as a call of unknown cost, and a timeout as a timeout", () => {
    const calls = ledgerCalls([remote(200, [1, 1])], [failure("timeout")], pricing, {
      provider: "p",
      model: "m",
    });
    const ledger = buildLedger(calls, 60, null, null);
    expect(ledger.calls).toBe(2);
    expect(ledger.failures).toBe(1);
    expect(ledger.timeouts).toBe(1);
    expect(ledger.cost.totalUsd).toBeNull();
    // Latency statistics describe answered decisions only.
    expect(ledger.wallLatencyMs.n).toBe(1);
  });

  it("prices local brains at exactly zero", () => {
    const calls = ledgerCalls([record(), record()], [failure("invalid")], null, {
      provider: "local",
      model: null,
    });
    const ledger = buildLedger(calls, 60, null, null);
    expect(ledger.cost.totalUsd).toBe(0);
  });

  it("does not count replayed frames as calls", () => {
    const calls = ledgerCalls([record({ source: "replay" })], [], null, {
      provider: "local",
      model: null,
    });
    expect(calls).toHaveLength(0);
  });
});
