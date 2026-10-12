/** Frozen, paired held-out evaluations. Calls propose data; the native compiler judges it. */
import { sha256Json } from "../sha256.js";
import {
  compileDesign,
  type PriorDesign,
} from "../../bethesda/rain/discoveryCompiler.js";
import {
  envelopeErrors,
  type Design,
  type Envelope,
} from "../../bethesda/rain/discoveryProtocol.js";
import { DEFAULT_ENVELOPE } from "../../bethesda/rain/discoveryProtocol.js";
import { fixtureDesign } from "../autonomy/discoveryFixtures.js";
import type { DiscoveryEntry, ResearchStore } from "../autonomy/store.js";
import type {
  GuidanceProposal,
  LearningEvaluation,
  LearningMetric,
  LearningRate,
} from "../../bethesda/rain/learningProtocol.js";

export const LEARNING_RULES = "rain-learning-scoring/v1" as const;
export const LEARNING_METRICS: readonly LearningMetric[] = [
  "valid_proposals",
  "evidence_references",
  "contradictions",
  "unsupported_claims",
  "compiler_success",
  "definition_repeatability",
  "question_coverage",
  "experiment_selection",
];
export interface LearningTask {
  id: string;
  question: string;
  origin_entries: string[];
  input_design: Design;
  envelope: Envelope;
  seeds: number[];
  prior: PriorDesign[];
  evidence_ids: string[];
  contradiction_ids: string[];
  claim_ids: string[];
  unsupported_claim_ids: string[];
  preferred_primary_metric: Design["primary_metric"];
}
export interface LearningPlan {
  schema: "rain-learning-plan/v1";
  proposal: string;
  rules: typeof LEARNING_RULES;
  evaluator: string;
  generation: "scripted" | "model";
  tasks: LearningTask[];
  budget: {
    calls_per_arm: number;
    max_tokens_per_arm: number | null;
    timeout_ms: number;
  };
}
export interface LearningAnswer {
  design: unknown;
  contradiction_ids: string[];
  unsupported_claim_ids: string[];
  tokens: number | null;
}
export type LearningParticipant = (input: {
  task: Omit<
    LearningTask,
    | "origin_entries"
    | "contradiction_ids"
    | "unsupported_claim_ids"
    | "preferred_primary_metric"
  >;
  guidance: {
    instructions: string;
    scope: GuidanceProposal["scope"];
    version: number;
  } | null;
  signal: AbortSignal;
}) => Promise<LearningAnswer>;
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length <= 100 &&
  v.every((s) => typeof s === "string" && s.length > 0 && s.length <= 128) &&
  new Set(v).size === v.length;
function planOK(
  plan: LearningPlan,
  proposal: GuidanceProposal,
  entries: readonly DiscoveryEntry[],
): boolean {
  if (
    plan?.schema !== "rain-learning-plan/v1" ||
    plan.rules !== LEARNING_RULES ||
    typeof plan.evaluator !== "string" ||
    !plan.evaluator.trim() ||
    plan.evaluator.length > 120 ||
    plan.evaluator === proposal.proposer ||
    !["scripted", "model"].includes(plan.generation) ||
    !Array.isArray(plan.tasks) ||
    plan.tasks.length < 4 ||
    plan.tasks.length > 24 ||
    new Set(plan.tasks.map((t) => t.id)).size !== plan.tasks.length
  )
    return false;
  const b = plan.budget;
  if (
    !b ||
    b.calls_per_arm !== plan.tasks.length ||
    !Number.isSafeInteger(b.timeout_ms) ||
    b.timeout_ms < 100 ||
    b.timeout_ms > 600000 ||
    (b.max_tokens_per_arm !== null &&
      (!Number.isSafeInteger(b.max_tokens_per_arm) || b.max_tokens_per_arm < 1))
  )
    return false;
  return plan.tasks.every(
    (t) =>
      typeof t.id === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(t.id) &&
      typeof t.question === "string" &&
      t.question.length > 0 &&
      t.question.length <= 1000 &&
      strings(t.origin_entries) &&
      t.origin_entries.every(
        (id) => entries.some((e) => e.sha256 === id) && !proposal.evidence.includes(id),
      ) &&
      !proposal.evidence.includes(t.id) &&
      strings(t.evidence_ids) &&
      !t.evidence_ids.some((id) => proposal.evidence.includes(id)) &&
      strings(t.contradiction_ids) &&
      strings(t.claim_ids) &&
      strings(t.unsupported_claim_ids) &&
      t.unsupported_claim_ids.every((id) => t.claim_ids.includes(id)) &&
      !envelopeErrors(t.envelope).length &&
      Array.isArray(t.seeds) &&
      t.seeds.length === t.envelope.seeds_per_design &&
      t.seeds.every((s) => Number.isSafeInteger(s) && s >= 0 && s <= 0xffffffff) &&
      new Set(t.seeds).size === t.seeds.length &&
      Array.isArray(t.prior) &&
      t.prior.length <= 24 &&
      t.envelope.metrics.includes(t.preferred_primary_metric) &&
      (proposal.scope.scenario === null ||
        proposal.scope.scenario === t.input_design.scenario),
  );
}
export function freezeLearningEvaluation(
  store: ResearchStore,
  session: string,
  input: Omit<LearningPlan, "schema" | "rules">,
) {
  const entries = store.discoveryEntries();
  const proposal = entries.find(
    (e) => e.kind === "learning-proposal" && e.sha256 === input.proposal,
  )?.payload as GuidanceProposal | undefined;
  const plan: LearningPlan = {
    ...structuredClone(input),
    schema: "rain-learning-plan/v1",
    rules: LEARNING_RULES,
  };
  if (!proposal || !planOK(plan, proposal, entries))
    throw new Error(
      "Learning evaluation requires independent evaluator, disjoint held-out tasks, fixed rules and equal bounded budgets",
    );
  if (
    entries.some(
      (e) =>
        e.kind === "learning-plan" &&
        (e.payload as LearningPlan).proposal === input.proposal,
    )
  )
    throw new Error(
      "Proposal already has a frozen evaluation plan; create a new guidance version for new rules or tasks",
    );
  const consumed = entries
    .filter(
      (e) =>
        e.kind === "learning-plan" &&
        entries.some(
          (attempt) =>
            attempt.kind === "learning-evaluation-start" &&
            (attempt.payload as { plan?: string }).plan === e.sha256,
        ),
    )
    .flatMap((e) => (e.payload as LearningPlan).tasks);
  if (
    plan.tasks.some((task) =>
      consumed.some(
        (prior) =>
          prior.id === task.id ||
          sha256Json(prior.input_design) === sha256Json(task.input_design),
      ),
    )
  )
    throw new Error(
      "Fresh held-out tasks are required: prior attempted tasks cannot evaluate another guidance version",
    );
  return store.appendDiscovery(session, "learning-plan", plan);
}
function answerOK(a: LearningAnswer): boolean {
  return (
    !!a &&
    strings(a.contradiction_ids) &&
    strings(a.unsupported_claim_ids) &&
    (a.tokens === null || (Number.isSafeInteger(a.tokens) && a.tokens >= 0))
  );
}
const equalSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));
function score(task: LearningTask, answer: LearningAnswer) {
  const context = {
    envelope: task.envelope,
    seeds: task.seeds,
    prior: task.prior,
    evidenceIds: new Set(task.evidence_ids),
    decision: { decision_id: "held-out-" + task.id, envelope_hash: sha256Json(task) },
  };
  const compiled = compileDesign(answer.design, context);
  const repeat = compileDesign(answer.design, structuredClone(context));
  const design = answer.design as Design | null;
  const references =
    !!design &&
    strings(design.evidence_ids) &&
    equalSet(design.evidence_ids, task.evidence_ids);
  const contradiction = equalSet(answer.contradiction_ids, task.contradiction_ids);
  const unsupported = equalSet(answer.unsupported_claim_ids, task.unsupported_claim_ids);
  const selection =
    compiled.ok && design?.primary_metric === task.preferred_primary_metric;
  const metrics: Record<LearningMetric, boolean> = {
    valid_proposals: compiled.ok && references && contradiction && unsupported,
    evidence_references: references,
    contradictions: contradiction,
    unsupported_claims: unsupported,
    compiler_success: compiled.ok,
    definition_repeatability:
      compiled.ok &&
      repeat.ok &&
      sha256Json(compiled.value.validated.definition) ===
        sha256Json(repeat.value.validated.definition),
    question_coverage: compiled.ok && references && selection,
    experiment_selection: selection,
  };
  return { metrics, errors: compiled.ok ? [] : compiled.errors, compiled: compiled.ok };
}
/** Wilson interval for a binomial rate. Intervals describe these sampled fixture tasks only. */
export function learningRate(successes: number, total: number): LearningRate {
  const z = 1.959963984540054,
    p = successes / total,
    d = 1 + (z * z) / total;
  const middle = (p + (z * z) / (2 * total)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / d;
  return {
    successes,
    total,
    rate: p,
    interval95: [Math.max(0, middle - half), Math.min(1, middle + half)],
  };
}
/** Exact paired sign test on valid proposal wins/losses, fixed before any outcomes. */
function pairedP(wins: number, losses: number): number {
  const n = wins + losses;
  if (!n) return 1;
  let coefficient = 1,
    sum = 1;
  for (let k = 1; k <= Math.min(wins, losses); k++) {
    coefficient *= (n - k + 1) / k;
    sum += coefficient;
  }
  return Math.min(1, (2 * sum) / 2 ** n);
}
function summarize(
  plan: LearningPlan,
  answers: {
    id: string;
    baseline_answer: LearningAnswer;
    candidate_answer: LearningAnswer;
  }[],
): LearningEvaluation {
  const rows = plan.tasks.map((task, i) => {
    const a = answers[i]!;
    if (a.id !== task.id || !answerOK(a.baseline_answer) || !answerOK(a.candidate_answer))
      throw new Error("Retained evaluation answer does not match frozen task");
    const base = score(task, a.baseline_answer),
      candidate = score(task, a.candidate_answer);
    return {
      id: task.id,
      baseline_compiled: base.compiled,
      candidate_compiled: candidate.compiled,
      baseline_errors: base.errors,
      candidate_errors: candidate.errors,
      baseline_answer: a.baseline_answer,
      candidate_answer: a.candidate_answer,
      baseline: base.metrics,
      candidate: candidate.metrics,
    };
  });
  const baseline = Object.fromEntries(
    LEARNING_METRICS.map((m) => [
      m,
      learningRate(rows.filter((r) => r.baseline[m]).length, rows.length),
    ]),
  ) as Record<LearningMetric, LearningRate>;
  const candidate = Object.fromEntries(
    LEARNING_METRICS.map((m) => [
      m,
      learningRate(rows.filter((r) => r.candidate[m]).length, rows.length),
    ]),
  ) as Record<LearningMetric, LearningRate>;
  const wins = rows.filter(
    (r) => r.candidate.valid_proposals && !r.baseline.valid_proposals,
  ).length;
  const losses = rows.filter(
    (r) => r.baseline.valid_proposals && !r.candidate.valid_proposals,
  ).length;
  const p = pairedP(wins, losses);
  const noRegression = LEARNING_METRICS.every(
    (m) => candidate[m].successes >= baseline[m].successes,
  );
  const tokens = (arm: "baseline_answer" | "candidate_answer") =>
    rows.some((r) => r[arm].tokens === null)
      ? null
      : rows.reduce((sum, r) => sum + (r[arm].tokens ?? 0), 0);
  const bt = tokens("baseline_answer"),
    ct = tokens("candidate_answer");
  if (
    plan.budget.max_tokens_per_arm !== null &&
    (bt === null ||
      ct === null ||
      bt > plan.budget.max_tokens_per_arm ||
      ct > plan.budget.max_tokens_per_arm)
  )
    throw new Error("Frozen evaluation token budget cannot be verified");
  return {
    schema: "rain-learning-evaluation/v1",
    proposal: plan.proposal,
    plan: "",
    evaluator: plan.evaluator,
    generation: plan.generation,
    sample_size: rows.length,
    baseline,
    candidate,
    paired: {
      wins,
      losses,
      ties: rows.length - wins - losses,
      effect: (wins - losses) / rows.length,
      exact_two_sided_p: p,
    },
    resources: {
      baseline_calls: rows.length,
      candidate_calls: rows.length,
      compiler_calls: 4 * rows.length,
      execution_actor_ticks: 0,
      baseline_tokens: bt,
      candidate_tokens: ct,
    },
    beneficial: wins > losses && p <= 0.05 && noRegression,
    limitations: [
      plan.generation === "scripted"
        ? "Scripted paired workflow fixtures; this does not establish improved Qwen intelligence."
        : "Paired held-out local-model proposals; small task sample does not establish general scientific intelligence.",
      "The existing workflow receives the same question, evidence, seeds and budgets; only the candidate receives proposed guidance.",
      "Evidence-reference and contradiction scores test explicit identifiers against frozen labels; they do not certify prose entailment.",
      "Selection quality tests a predeclared distinguishing observable; question coverage is coverage of these tasks only.",
      "Definition repeatability recompiles identical designs; it does not measure simulator replay or experimental reproducibility.",
      "No experiments run in this procedural benchmark. Token counts remain unknown when the participant does not report them.",
      "Wilson intervals and the paired p-value use binomial and exchangeability assumptions. Deterministic related fixtures do not establish those assumptions or justify population inference.",
      "Activation requires a two-sided paired p <= 0.05 improvement without aggregate metric regression, plus operator review; this is a procedural gate, not proof of external scientific validity.",
    ],
    tasks: rows,
  };
}
export function validateLearningEvaluation(
  entries: readonly DiscoveryEntry[],
  evaluation: LearningEvaluation,
): boolean {
  try {
    const frozen = entries.find(
      (e) => e.kind === "learning-plan" && e.sha256 === evaluation.plan,
    );
    const proposalEntry = entries.find(
      (e) => e.kind === "learning-proposal" && e.sha256 === evaluation.proposal,
    );
    if (
      !frozen ||
      !proposalEntry ||
      frozen.sequence <= proposalEntry.sequence ||
      entries.some(
        (e) =>
          e.kind === "learning-evaluation" &&
          (e.payload as LearningEvaluation).plan === evaluation.plan,
      )
    )
      return false;
    const plan = frozen.payload as LearningPlan;
    if (
      plan.proposal !== evaluation.proposal ||
      !planOK(
        plan,
        proposalEntry.payload as GuidanceProposal,
        entries.slice(0, frozen.sequence),
      ) ||
      evaluation.tasks.length !== plan.tasks.length
    )
      return false;
    const starts = entries.filter(
      (e) =>
        e.kind === "learning-evaluation-start" &&
        (e.payload as { plan: string }).plan === frozen.sha256,
    );
    if (starts.length !== 1 || starts[0]!.sequence <= frozen.sequence) return false;
    for (const task of evaluation.tasks)
      for (const arm of ["baseline", "candidate"] as const) {
        const retained = entries.filter(
          (e) =>
            e.kind === "learning-evaluation-answer" &&
            (e.payload as { plan: string; task: string; arm: string }).plan ===
              frozen.sha256 &&
            (e.payload as { task: string }).task === task.id &&
            (e.payload as { arm: string }).arm === arm,
        );
        if (
          retained.length !== 1 ||
          retained[0]!.sequence <= starts[0]!.sequence ||
          sha256Json((retained[0]!.payload as { answer: unknown }).answer) !==
            sha256Json(task[`${arm}_answer`])
        )
          return false;
      }
    const expected = summarize(
      plan,
      evaluation.tasks.map((t) => ({
        id: t.id,
        baseline_answer: t.baseline_answer as LearningAnswer,
        candidate_answer: t.candidate_answer as LearningAnswer,
      })),
    );
    expected.plan = frozen.sha256;
    return sha256Json(expected) === sha256Json(evaluation);
  } catch {
    return false;
  }
}
export async function evaluateFrozenLearning(
  store: ResearchStore,
  session: string,
  planSha256: string,
  participant: LearningParticipant,
) {
  const entries = store.discoveryEntries();
  const frozen = entries.find(
    (e) => e.kind === "learning-plan" && e.sha256 === planSha256,
  );
  if (
    !frozen ||
    entries.some(
      (e) =>
        ["learning-evaluation", "learning-evaluation-start"].includes(e.kind) &&
        (e.payload as { plan?: string }).plan === planSha256,
    )
  )
    throw new Error("Frozen learning plan unavailable or already attempted");
  const plan = structuredClone(frozen.payload) as LearningPlan;
  const proposal = entries.find(
    (e) => e.kind === "learning-proposal" && e.sha256 === plan.proposal,
  )?.payload as GuidanceProposal | undefined;
  if (!proposal || !planOK(plan, proposal, entries.slice(0, frozen.sequence)))
    throw new Error("Frozen learning plan is invalid");
  const abort = new AbortController();
  const timer = setTimeout(
    () => abort.abort(new Error("Learning evaluation timeout")),
    plan.budget.timeout_ms,
  );
  const answers: {
    id: string;
    baseline_answer: LearningAnswer;
    candidate_answer: LearningAnswer;
  }[] = [];
  store.appendDiscovery(session, "learning-evaluation-start", { plan: planSha256 });
  let baselineTokens: number | null = 0,
    candidateTokens: number | null = 0;
  const infer = async (task: LearningTask, candidate: boolean) => {
    if (abort.signal.aborted) throw new Error("Learning evaluation timeout");
    const {
      origin_entries: _origin,
      contradiction_ids: _contradictions,
      unsupported_claim_ids: _unsupported,
      preferred_primary_metric: _metric,
      ...context
    } = structuredClone(task);
    const guidance = candidate
      ? {
          instructions: proposal.instructions,
          scope: structuredClone(proposal.scope),
          version: proposal.version,
        }
      : null;
    let cancel = () => {};
    const stopped = new Promise<never>((_, reject) => {
      cancel = () => reject(new Error("Learning evaluation timeout"));
      abort.signal.addEventListener("abort", cancel, { once: true });
    });
    let answer: LearningAnswer;
    try {
      answer = structuredClone(
        await Promise.race([
          participant({ task: context, guidance, signal: abort.signal }),
          stopped,
        ]),
      );
    } finally {
      abort.signal.removeEventListener("abort", cancel);
    }
    store.appendDiscovery(session, "learning-evaluation-answer", {
      plan: planSha256,
      task: task.id,
      arm: candidate ? "candidate" : "baseline",
      answer,
    });
    if (!answerOK(answer)) throw new Error("Malformed learning evaluation answer");
    if (candidate)
      candidateTokens =
        candidateTokens === null || answer.tokens === null
          ? null
          : candidateTokens + answer.tokens;
    else
      baselineTokens =
        baselineTokens === null || answer.tokens === null
          ? null
          : baselineTokens + answer.tokens;
    const used = candidate ? candidateTokens : baselineTokens;
    if (
      plan.budget.max_tokens_per_arm !== null &&
      (used === null || used > plan.budget.max_tokens_per_arm)
    )
      throw new Error("Learning evaluation token ceiling reached or unreported");
    return answer;
  };
  try {
    for (const [i, task] of plan.tasks.entries()) {
      // Counterbalance call order; no task receives the other arm's answer.
      const first = await infer(task, i % 2 === 1),
        second = await infer(task, i % 2 === 0);
      answers.push({
        id: task.id,
        baseline_answer: i % 2 === 0 ? first : second,
        candidate_answer: i % 2 === 0 ? second : first,
      });
    }
    const evaluation = summarize(plan, answers);
    evaluation.plan = planSha256;
    if (!validateLearningEvaluation(store.discoveryEntries(), evaluation))
      throw new Error("Learning evaluation failed independent host recomputation");
    return store.appendDiscovery(session, "learning-evaluation", evaluation);
  } catch (error) {
    store.appendDiscovery(session, "learning-evaluation-incomplete", {
      plan: planSha256,
      completed_pairs: answers.length,
      reason: error instanceof Error ? error.message : "Unknown evaluation error",
    });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Public bounded host fixture: eight new parameter-grid problems, independent of proposal receipts.
 * Baseline keeps the scripted invalid proposal. The candidate adapter can apply ONLY a proposed
 * 100-tick procedural instruction. This verifies compilation and the learning gate, not Qwen. */
export function parameterGridHoldout(): LearningTask[] {
  return Array.from({ length: 8 }, (_, i) => {
    const design = fixtureDesign();
    design.parameters.pedestrians = 40 + 20 * i;
    design.parameters.vehicles = 8 + i;
    design.warmup_ticks = 101 + 11 * i;
    design.observation_window_ticks = 301 + 9 * i;
    return {
      id: `heldout-grid-${i + 1}`,
      question: `[SCRIPTED HELDOUT] Test watching under this fire protocol. Synthetic contradiction contradiction-${i + 1}: claim A states a positive effect and claim B states no effect. external-confirmed claims real-world confirmation despite simulator-only evidence, and is unsupported.`,
      origin_entries: [],
      input_design: design,
      envelope: structuredClone(DEFAULT_ENVELOPE),
      seeds: [10001 + i * 3, 10002 + i * 3, 10003 + i * 3],
      prior: [],
      evidence_ids: [],
      contradiction_ids: [`contradiction-${i + 1}`],
      claim_ids: ["simulator-only", "external-confirmed"],
      unsupported_claim_ids: ["external-confirmed"],
      preferred_primary_metric: "watching",
    };
  });
}
export const parameterGridParticipant: LearningParticipant = async ({
  task,
  guidance,
}) => {
  const design = structuredClone(task.input_design);
  if (
    guidance?.scope.error === "parameter-grid" &&
    /100[ -]tick|multiples of 100|100.*steps/i.test(guidance.instructions)
  ) {
    // The fixture follows its procedural instruction before the same unmodified host compiler.
    design.warmup_ticks = Math.max(100, Math.floor(design.warmup_ticks / 100) * 100);
    design.observation_window_ticks = Math.max(
      300,
      Math.floor(design.observation_window_ticks / 100) * 100,
    );
  }
  const contradiction = task.question.match(
    /Synthetic contradiction (contradiction-\d+):/,
  );
  return {
    design,
    contradiction_ids: contradiction ? [contradiction[1]!] : [],
    unsupported_claim_ids: task.question.includes(
      "external-confirmed claims real-world confirmation",
    )
      ? ["external-confirmed"]
      : [],
    tokens: null,
  };
};
export async function evaluateProposal(
  store: ResearchStore,
  session: string,
  proposalSha256: string,
) {
  const proposal = store
    .discoveryEntries()
    .find((e) => e.kind === "learning-proposal" && e.sha256 === proposalSha256)
    ?.payload as GuidanceProposal | undefined;
  if (
    !proposal ||
    proposal.scope.error !== "parameter-grid" ||
    (proposal.scope.scenario !== null && proposal.scope.scenario !== "fire")
  )
    throw new Error(
      "Installed scripted evaluation supports parameter-grid guidance for fire or all Bethesda scenarios only. Other scopes require a separately frozen independent evaluation.",
    );
  const plan = freezeLearningEvaluation(store, session, {
    proposal: proposalSha256,
    evaluator: "independent-host-grid-evaluator/v1",
    generation: "scripted",
    tasks: parameterGridHoldout(),
    budget: { calls_per_arm: 8, max_tokens_per_arm: null, timeout_ms: 60000 },
  });
  return evaluateFrozenLearning(store, session, plan.sha256, parameterGridParticipant);
}
