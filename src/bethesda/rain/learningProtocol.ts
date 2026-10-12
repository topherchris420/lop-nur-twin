/** Browser-safe views of procedural learning. These receipts never confer execution authority. */
export type ProcessErrorCode =
  | "parameter-grid"
  | "evidence-reference"
  | "unsupported-capability"
  | "hypothesis-distinction"
  | "protocol-novelty"
  | "resource-envelope";
export interface GuidanceScope {
  domain: "urban-simulation";
  backend: "bethesda";
  stage: "design" | "deliberation";
  scenario: string | null;
  error: ProcessErrorCode;
}
export interface RecurringProcessError {
  code: ProcessErrorCode;
  count: number;
  evidence: string[];
  sessions: string[];
}
export interface GuidanceProposal {
  schema: "rain-guidance-proposal/v1";
  id: string;
  version: number;
  parent: string | null;
  scope: GuidanceScope;
  instructions: string;
  evidence: string[];
  generation: "host" | "model" | "scripted";
  proposer: string;
}
export interface LearningRate {
  successes: number;
  total: number;
  rate: number;
  interval95: [number, number];
}
export type LearningMetric =
  | "valid_proposals"
  | "evidence_references"
  | "contradictions"
  | "unsupported_claims"
  | "compiler_success"
  | "definition_repeatability"
  | "question_coverage"
  | "experiment_selection";
export interface LearningEvaluation {
  schema: "rain-learning-evaluation/v1";
  proposal: string;
  plan: string;
  evaluator: string;
  generation: "scripted" | "model";
  sample_size: number;
  baseline: Record<LearningMetric, LearningRate>;
  candidate: Record<LearningMetric, LearningRate>;
  paired: {
    wins: number;
    losses: number;
    ties: number;
    effect: number;
    exact_two_sided_p: number;
  };
  resources: {
    baseline_calls: number;
    candidate_calls: number;
    compiler_calls: number;
    execution_actor_ticks: 0;
    baseline_tokens: number | null;
    candidate_tokens: number | null;
  };
  beneficial: boolean;
  limitations: string[];
  tasks: {
    id: string;
    baseline_compiled: boolean;
    candidate_compiled: boolean;
    baseline_errors: string[];
    candidate_errors: string[];
    baseline_answer: unknown;
    candidate_answer: unknown;
    baseline: Record<LearningMetric, boolean>;
    candidate: Record<LearningMetric, boolean>;
  }[];
}
export interface LearningView {
  schema: "rain-learning-view/v1";
  recurring: RecurringProcessError[];
  proposals: {
    sha256: string;
    proposal: GuidanceProposal;
    evaluations: { sha256: string; evaluation: LearningEvaluation }[];
    status: "proposed" | "evaluated" | "active" | "rolled-back";
  }[];
  activations: {
    sha256: string;
    proposal: string;
    evaluation: string;
    operator: string;
  }[];
  rollbacks: { sha256: string; activation: string; operator: string; reason: string }[];
}
