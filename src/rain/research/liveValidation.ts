/** Measurement of completed workflow artifacts, not a score for scientific intelligence. */
import type { DiscoveryEntry } from "../autonomy/store.js";
import type { ModelAnswer, StructuredRequest } from "../autonomy/models.js";
import type { ResearchTurn } from "../../bethesda/rain/researchProtocol.js";
import type { DiscoveryResult } from "../../bethesda/rain/discoveryView.js";
import { sha256Json } from "../sha256.js";
import { cognitiveEvaluation } from "./cognition.js";
import { PARTNERSHIP_STAGES } from "./partnership.js";
export function liveStudyAudit(
  entries: readonly DiscoveryEntry[],
  independentlyReplayed: ReadonlySet<string>,
) {
  const requests = entries
    .filter((e) => e.kind === "inference-request")
    .map(
      (e) =>
        e.payload as {
          id: string;
          seat: string;
          generation: string;
          model: string;
          request: StructuredRequest;
        },
    );
  const answers = entries
    .filter((e) => e.kind === "inference-answer")
    .map((e) => e.payload as { id: string; generation: string; answer: ModelAnswer });
  const turns = entries
    .filter((e) => e.kind === "research-turn")
    .map((e) => e.payload as ResearchTurn);
  const results = entries
    .filter((e) => e.kind === "result")
    .map((e) => e.payload as DiscoveryResult);
  const verified = results.filter(
    (r) => r.replay && r.registry_run_id && independentlyReplayed.has(r.run_id),
  );
  const actualInference =
    requests.length > 0 &&
    requests.every((r) => {
      const a = answers.find((v) => v.id === r.id);
      return (
        r.generation === "model" &&
        a?.generation === "model" &&
        a.answer.reportedModel === r.model &&
        ["stop", "eos"].includes(a.answer.finishReason ?? "")
      );
    });
  const independentReviews = requests.filter((r) =>
    r.seat?.endsWith("-Independent evidence review"),
  );
  const pairedReviewContexts =
    independentReviews.length >= 2 &&
    independentReviews.length % 2 === 0 &&
    independentReviews.every((r, i) => {
      if (i % 2) return true;
      const a = JSON.parse(r.request.user),
        b = JSON.parse(independentReviews[i + 1]!.request.user);
      return (
        sha256Json({
          context: a.context,
          results: a.results,
          predictions: a.prior_predictions ?? null,
        }) ===
        sha256Json({
          context: b.context,
          results: b.results,
          predictions: b.prior_predictions ?? null,
        })
      );
    });
  const checks = {
    all_calls_are_completed_real_inference: actualInference,
    founder_challenge_revision_and_joint_proposal: PARTNERSHIP_STAGES.every((s) =>
      turns.some(
        (t) => t.role === s.stage && t.perspective === s.name && t.generation === "model",
      ),
    ),
    existing_team_contributed: ["James", "Jasmine", "Luca", "Elena"].every((name) =>
      turns.some((t) => t.perspective === name && t.generation === "model"),
    ),
    cited_knowledge: turns.some((t) => t.contribution.source_ids.length > 0),
    replay_verified_admitted_experiments: verified.length >= 2,
    withheld_seed_confirmation: verified.some(
      (r) =>
        r.purpose === "confirmatory" &&
        verified.some(
          (p) =>
            p.design_id === r.parent &&
            p.per_seed.every((a) => r.per_seed.every((b) => a.seed !== b.seed)),
        ),
    ),
    independent_evidence_review_contexts: pairedReviewContexts,
    disagreements_preserved: turns.some((t) => t.contribution.disagreements.length > 0),
    next_question_recorded: entries.some(
      (e) =>
        e.kind === "analysis" &&
        !!(e.payload as { critique: { next_question: string } }).critique.next_question,
    ),
    manuscript_ready_for_human_review: entries.some(
      (e) =>
        e.kind === "research-manuscript" &&
        (e.payload as { delivery: string }).delivery === "ready_for_human_review",
    ),
    descendant_proposed_without_execution:
      entries.some((e) => e.kind === "world-proposed") &&
      !entries.some((e) => e.kind === "world-approved"),
    session_stopped: entries.some((e) => e.kind === "session-end"),
  };
  return {
    schema: "rain-live-study-audit/v1",
    live_cycle_complete: Object.values(checks).every(Boolean),
    checks,
    inference_requests: requests.length,
    retained_answers: answers.length,
    verified_runs: verified.map((r) => r.run_id),
    reported_tokens: answers.every(
      (a) => a.answer.promptTokens !== null && a.answer.completionTokens !== null,
    )
      ? answers.reduce(
          (n, a) => n + a.answer.promptTokens! + a.answer.completionTokens!,
          0,
        )
      : null,
    failures: entries
      .filter((e) => ["session-failure", "research-untestable"].includes(e.kind))
      .map((e) => ({ at: e.at, payload: e.payload })),
    cognitive_artifacts: cognitiveEvaluation(entries),
    scientific_quality:
      "Not established by workflow completion. Requires human review of source relevance, hypothesis discrimination and interpretations. A same-model critic is not an independent scientist. No real-world or founder-fidelity inference.",
  };
}
