/** Descriptive metrics over a stated local comparison history, never a claim of global novelty. */
import { sha256Json } from "../sha256.js";
import type { DiscoveryResult } from "../../bethesda/rain/discoveryView.js";
import type { DiscoveryEntry } from "../autonomy/store.js";
export function evaluateInstitution(
  history: readonly DiscoveryResult[],
  entries: readonly DiscoveryEntry[],
  comparison: readonly DiscoveryResult[] = [],
) {
  const protocol = (r: DiscoveryResult) =>
    sha256Json({
      scenario: r.design.scenario,
      location: r.design.location,
      metric: r.design.primary_metric,
      direction: r.design.expected_direction,
      effect: r.design.minimum_effect,
      parameters: r.design.parameters,
      warmup: r.design.warmup_ticks,
      observation: r.design.observation_window_ticks,
    });
  const valid = history.filter((r) => r.replay && r.registry_run_id !== null);
  const signatures = new Set(valid.map(protocol));
  const known = new Set(comparison.map(protocol));
  const endings = entries
    .filter((e) => e.kind === "session-end")
    .map((e) => e.payload as { model_calls: number; tokens: number | null });
  const calls = endings.reduce((n, e) => n + e.model_calls, 0);
  const tokens = endings.every((e) => e.tokens !== null)
    ? endings.reduce((n, e) => n + e.tokens!, 0)
    : null;
  return {
    schema: "rain-institution-evaluation/v1",
    evidence_scope: "simulator-only",
    comparison_history_sha256: sha256Json(comparison),
    comparison_runs: comparison.length,
    replay_verified_admitted_runs: valid.length,
    nonduplicate_protocols: signatures.size,
    protocols_absent_from_comparison: [...signatures].filter((s) => !known.has(s)).length,
    confirmatory_runs: valid.filter((r) => r.purpose === "confirmatory").length,
    verdict_counts: Object.fromEntries(
      [...new Set(valid.map((r) => r.verdict))]
        .sort()
        .map((v) => [v, valid.filter((r) => r.verdict === v).length]),
    ),
    complete_provenance_fraction: history.length ? valid.length / history.length : null,
    model_calls: calls,
    reported_tokens: tokens,
    valid_runs_per_model_call: calls ? valid.length / calls : null,
    independent_replications: null,
    resolved_questions: null,
    useful_cross_domain_connections: null,
    improvement:
      "not established; requires preregistered matched nonrecursive controls and independent scientific review",
  };
}
