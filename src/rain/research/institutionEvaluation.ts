/** Descriptive metrics over a stated local comparison history, never a claim of global novelty. */
import { sha256Json } from "../sha256.js";
import type { DiscoveryResult } from "../../bethesda/rain/discoveryView.js";
import type { DiscoveryEntry } from "../autonomy/store.js";
import type { InstitutionAssessment } from "../../bethesda/rain/institutionProtocol.js";
export function evaluateInstitution(
  history: readonly DiscoveryResult[],
  entries: readonly DiscoveryEntry[],
  comparison: readonly DiscoveryResult[] = [],
  assessments: readonly InstitutionAssessment[] = [],
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
  const reviewed = new Map(
    assessments
      .filter((a) => valid.some((r) => r.run_id === a.run_id))
      .map((a) => [a.run_id, a]),
  );
  const replications = valid.filter(
    (r) =>
      r.purpose === "confirmatory" &&
      r.verdict === "supported" &&
      [...valid, ...comparison].some(
        (parent) =>
          parent.design_id === r.parent &&
          parent.verdict === "supported" &&
          protocol(parent) === protocol(r) &&
          parent.per_seed.every((p) => !r.per_seed.some((q) => q.seed === p.seed)),
      ),
  );
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
    hypotheses_not_supported_by_simulator_criteria: valid.filter(
      (r) => r.verdict === "not_supported",
    ).length,
    protocol_revisions: valid.filter(
      (r) => r.parent !== null && r.purpose === "exploratory",
    ).length,
    proposal_diversity: new Set(
      entries
        .filter((e) => e.kind === "research-turn")
        .map((e) =>
          sha256Json(
            (e.payload as { contribution: { hypothesis: string } }).contribution
              .hypothesis,
          ),
        ),
    ).size,
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
    successful_withheld_seed_simulator_replications: replications.length,
    resolved_questions: reviewed.size
      ? [...reviewed.values()].filter((a) => a.question_resolved).length
      : null,
    useful_cross_domain_connections: reviewed.size
      ? [...reviewed.values()].filter((a) => a.useful_cross_domain_connection).length
      : null,
    operator_quality_reviews: [...reviewed.values()],
    quality_review_scope:
      "human operator attestations, not authenticated reviewer identity or proof of scientific independence",
    improvement:
      "not established; requires preregistered matched nonrecursive controls and independent scientific review",
  };
}

export interface ComparisonPlan {
  schema: "rain-inception-comparison/v1";
  question: string;
  generations: 1 | 2;
  sessions_per_arm: number;
  ceilings_per_session: { experiments: number; model_calls: number; runtime_ms: number };
  model: { provider: string; model: string; generation: "model" | "scripted" };
  comparison_corpus_sha256: string;
  primary_metric: "nonduplicate_protocols_per_model_call";
}
export function compareInstitutions(
  plan: ComparisonPlan,
  recursive: { history: DiscoveryResult[]; entries: DiscoveryEntry[] },
  control: { history: DiscoveryResult[]; entries: DiscoveryEntry[] },
) {
  if (
    plan.schema !== "rain-inception-comparison/v1" ||
    !Number.isSafeInteger(plan.sessions_per_arm) ||
    plan.sessions_per_arm < 1 ||
    plan.sessions_per_arm > 3 ||
    ![1, 2].includes(plan.generations) ||
    !/^[a-f0-9]{64}$/.test(plan.comparison_corpus_sha256) ||
    Object.values(plan.ceilings_per_session).some(
      (n) => !Number.isSafeInteger(n) || n < 1,
    )
  )
    throw new Error("Invalid preregistered comparison plan");
  const results = [recursive, control].map((arm) => {
    const sessions = arm.entries.filter((e) => e.kind === "session-end");
    if (sessions.length !== plan.sessions_per_arm)
      throw new Error("Comparison session allocation differs from preregistration");
    const starts = arm.entries.filter((e) => e.kind === "session-start");
    if (
      starts.length !== sessions.length ||
      starts.some((e) => {
        const p = e.payload as {
          budgets: { experiments: number; model_calls: number; runtime_ms: number };
          model: string;
          provider: string;
          generation: string;
        };
        return (
          !p.budgets ||
          Object.entries(plan.ceilings_per_session).some(
            ([key, value]) => p.budgets[key as keyof typeof p.budgets] !== value,
          ) ||
          p.model !== plan.model.model ||
          p.provider !== plan.model.provider ||
          p.generation !== plan.model.generation
        );
      })
    )
      throw new Error("Comparison declared budgets or model differ from preregistration");
    if (
      sessions.some((e) => {
        const usage = e.payload as { model_calls: number; executed: number };
        return (
          usage.model_calls > plan.ceilings_per_session.model_calls ||
          usage.executed > plan.ceilings_per_session.experiments
        );
      })
    )
      throw new Error("Comparison compute ceiling exceeded");
    const evaluation = evaluateInstitution(arm.history, arm.entries);
    return {
      ...evaluation,
      nonduplicate_protocols_per_model_call: evaluation.model_calls
        ? evaluation.nonduplicate_protocols / evaluation.model_calls
        : null,
    };
  });
  const a = results[0]!.nonduplicate_protocols_per_model_call,
    b = results[1]!.nonduplicate_protocols_per_model_call;
  return {
    schema: "rain-inception-comparison-result/v1",
    plan_sha256: sha256Json(plan),
    generation: plan.model.generation,
    scope: "simulator-only",
    allocated_budget_per_arm: {
      experiments: plan.sessions_per_arm * plan.ceilings_per_session.experiments,
      model_calls: plan.sessions_per_arm * plan.ceilings_per_session.model_calls,
      runtime_ms: plan.sessions_per_arm * plan.ceilings_per_session.runtime_ms,
    },
    recursive: results[0],
    nonrecursive_control: results[1],
    primary_metric_difference: a === null || b === null ? null : a - b,
    scientific_improvement:
      "not established; this descriptive comparison does not replace independent replication and blinded scientific quality review",
  };
}
