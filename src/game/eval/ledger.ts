import { estimateCost, type PricingConfig } from "./pricing.js";
import type { DecisionRecord, FailureRecord } from "./records.js";
import { summarize, type SampleSummary } from "./stats.js";

/**
 * The computational ledger: what a run's decisions cost in time, bytes,
 * tokens and money.
 *
 * Every model call is a line — decisions that were accepted and failures that
 * were not — because a timeout costs the latency it burned and, for a paid
 * model, possibly the call. Unknown stays unknown all the way up: a total over
 * calls some of whose cost is unknown is `null`, with the known part and the
 * count of unknown calls beside it, so a partial sum is never mistaken for a
 * total.
 */

export interface LedgerCall {
  sequence: number;
  outcome: "decision" | "failure";
  provider: string;
  model: string | null;
  wallLatencyMs: number | null;
  providerLatencyMs: number | null;
  requestBytes: number | null;
  responseBytes: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  retries: number | null;
  timedOut: boolean;
  costUsd: number | null;
  costBasis: string;
}

export interface Ledger {
  calls: number;
  decisions: number;
  failures: number;
  timeouts: number;
  /** Upstream retries summed; null when no call reported a retry count. */
  retries: number | null;
  wallLatencyMs: SampleSummary;
  /** Answered decisions' round trips in fixed bins, for drawing the distribution. */
  wallLatencyHistogram: { edgesMs: number[]; counts: number[] };
  providerLatencyMs: SampleSummary;
  requestBytes: { total: number | null; unknownCalls: number };
  responseBytes: { total: number | null; unknownCalls: number };
  inputTokens: { total: number | null; unknownCalls: number };
  outputTokens: { total: number | null; unknownCalls: number };
  cost: {
    /** Sum over every call, or null if any call's cost is unknown. */
    totalUsd: number | null;
    knownUsd: number;
    unknownCalls: number;
    bases: string[];
  };
  decisionsPerMinute: number | null;
  costPerMinuteUsd: number | null;
  /** Divided by the count the experiment declared as its objective, e.g. eliminations. */
  costPerObjectiveUsd: number | null;
  objective: { label: string; count: number } | null;
  /** Divided by decisions its outcome contract classed as beneficial. */
  costPerUsefulDecisionUsd: number | null;
  usefulDecisions: number | null;
}

function known(values: (number | null)[]): {
  total: number | null;
  unknownCalls: number;
} {
  const unknownCalls = values.filter((v) => v === null).length;
  if (values.length === 0) return { total: null, unknownCalls: 0 };
  return {
    total: unknownCalls > 0 ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0),
    unknownCalls,
  };
}

export function ledgerCalls(
  decisions: readonly DecisionRecord[],
  failures: readonly FailureRecord[],
  pricing: PricingConfig | null,
  failureProvider: { provider: string; model: string | null },
): LedgerCall[] {
  const calls: LedgerCall[] = [];
  for (const record of decisions) {
    // A replayed frame was not a call; a fallback frame was a local one.
    if (record.source === "replay") continue;
    const a = record.accounting;
    const cost = estimateCost(pricing, a);
    calls.push({
      sequence: record.sequence,
      outcome: "decision",
      provider: a.provider,
      model: a.model,
      wallLatencyMs: a.wallLatencyMs,
      providerLatencyMs: a.providerLatencyMs,
      requestBytes: a.requestBytes,
      responseBytes: a.responseBytes,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      retries: a.retries,
      timedOut: false,
      costUsd: cost.usd,
      costBasis: cost.basis,
    });
  }
  for (const failure of failures) {
    // A failed remote call may or may not have been billed; that is unknown.
    const local = failureProvider.provider === "local";
    calls.push({
      sequence: failure.sequence,
      outcome: "failure",
      provider: failureProvider.provider,
      model: failureProvider.model,
      wallLatencyMs: failure.latencyMs,
      providerLatencyMs: null,
      requestBytes: null,
      responseBytes: null,
      inputTokens: null,
      outputTokens: null,
      retries: null,
      timedOut: failure.kind === "timeout",
      costUsd: local ? 0 : null,
      costBasis: local ? "local inference" : "billing of a failed call is unknown",
    });
  }
  return calls.sort((x, y) => x.sequence - y.sequence);
}

/**
 * Round-trip bins, milliseconds: fine where local brains and Jev live, coarse
 * where a conventional LLM does. The last bin is open-ended.
 */
export const LATENCY_EDGES_MS: readonly number[] = [
  0, 5, 10, 25, 50, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000,
];

export function histogram(
  samples: readonly number[],
  edgesMs: readonly number[] = LATENCY_EDGES_MS,
): { edgesMs: number[]; counts: number[] } {
  const counts = edgesMs.map(() => 0);
  for (const value of samples) {
    let i = edgesMs.length - 1;
    while (i > 0 && value < edgesMs[i]!) i -= 1;
    counts[i] = (counts[i] ?? 0) + 1;
  }
  return { edgesMs: [...edgesMs], counts };
}

export function buildLedger(
  calls: readonly LedgerCall[],
  simSeconds: number,
  objective: { label: string; count: number } | null,
  usefulDecisions: number | null,
): Ledger {
  const decisions = calls.filter((c) => c.outcome === "decision");
  const costs = calls.map((c) => c.costUsd);
  const cost = known(costs);
  const retries = calls.map((c) => c.retries).filter((r): r is number => r !== null);
  const minutes = simSeconds / 60;
  const totalUsd = cost.total;
  return {
    calls: calls.length,
    decisions: decisions.length,
    failures: calls.length - decisions.length,
    timeouts: calls.filter((c) => c.timedOut).length,
    retries: retries.length > 0 ? retries.reduce((a, b) => a + b, 0) : null,
    wallLatencyMs: summarize(
      decisions.map((c) => c.wallLatencyMs).filter((v): v is number => v !== null),
    ),
    wallLatencyHistogram: histogram(
      decisions.map((c) => c.wallLatencyMs).filter((v): v is number => v !== null),
    ),
    providerLatencyMs: summarize(
      decisions.map((c) => c.providerLatencyMs).filter((v): v is number => v !== null),
    ),
    requestBytes: known(calls.map((c) => c.requestBytes)),
    responseBytes: known(calls.map((c) => c.responseBytes)),
    inputTokens: known(calls.map((c) => c.inputTokens)),
    outputTokens: known(calls.map((c) => c.outputTokens)),
    cost: {
      totalUsd,
      knownUsd: costs.reduce<number>((a, v) => a + (v ?? 0), 0),
      unknownCalls: cost.unknownCalls,
      bases: [...new Set(calls.map((c) => c.costBasis))].sort(),
    },
    decisionsPerMinute: minutes > 0 ? decisions.length / minutes : null,
    costPerMinuteUsd: totalUsd !== null && minutes > 0 ? totalUsd / minutes : null,
    costPerObjectiveUsd:
      totalUsd !== null && objective && objective.count > 0
        ? totalUsd / objective.count
        : null,
    objective,
    costPerUsefulDecisionUsd:
      totalUsd !== null && usefulDecisions !== null && usefulDecisions > 0
        ? totalUsd / usefulDecisions
        : null,
    usefulDecisions,
  };
}
