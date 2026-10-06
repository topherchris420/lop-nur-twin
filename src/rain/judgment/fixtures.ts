/**
 * Fixtures shared by the judgment tests: a bounded request, a deterministic
 * provider and a calibration profile that supports it. Test support only;
 * nothing in the runtime imports this module.
 */
import { CALIBRATION_SCHEMA, type CalibrationProfile } from "./calibration.js";
import type {
  JudgmentProvider,
  JudgmentResult,
  JudgmentState,
  QuestionSet,
} from "./contracts.js";
import {
  type DecisionRequest,
  type Engine,
  decisionRequest,
  questionHash,
} from "./routing.js";

export function request(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return decisionRequest({
    decisionClass: "continue_stop",
    state: "A bounded step remains unfinished.",
    instructions: "Choose a next step.",
    choices: [
      ["CONTINUE", "Continue analysis."],
      ["VERIFY", "Verify evidence."],
    ],
    consequence: "low",
    remoteAllowed: true,
    ...overrides,
  });
}

export class Provider implements JudgmentProvider {
  calls = 0;
  readonly engine: Engine;
  readonly choice: string;
  readonly probability: number;
  readonly error: string | null;
  constructor(
    engine: Engine = "laya",
    choice = "CONTINUE",
    probability = 0.99,
    error: string | null = null,
  ) {
    this.engine = engine;
    this.choice = choice;
    this.probability = probability;
    this.error = error;
  }
  result(state: JudgmentState, questions: QuestionSet): JudgmentResult {
    const q = questions.questions[0]!;
    return {
      provider: this.engine,
      model: `${this.engine}-fixture`,
      answers: [
        {
          questionId: q.questionId,
          type: "choice",
          value: this.choice,
          probabilities: q.choices.map(([key]) => [
            key,
            key === this.choice ? this.probability : 1 - this.probability,
          ]),
          confidence: this.probability,
        },
      ],
      stateHash: state.stateHash,
      questionSetVersion: questions.version,
      errorCode: this.error,
      errorStatus: null,
    };
  }
  async evaluate(state: JudgmentState, questions: QuestionSet): Promise<JudgmentResult> {
    this.calls += 1;
    return this.result(state, questions);
  }
}

export function profile(
  engine: Engine,
  req: DecisionRequest = request(),
): CalibrationProfile {
  const samples = Array.from({ length: 400 }, (_, i) => ({
    sample_id: String(i),
    expected: "CONTINUE",
    selected: "CONTINUE",
    probability: 0.99,
    margin: 0.98,
  }));
  return {
    schema_version: CALIBRATION_SCHEMA,
    engine,
    model: `${engine}-fixture`,
    decision_class: req.decisionClass,
    question_hash: questionHash(req),
    threshold: 0.9,
    margin: 0.15,
    target_accuracy: 0.95,
    fit_samples: samples.slice(0, 200),
    heldout_samples: samples.slice(200),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

export const allow = (req: DecisionRequest, selected: string | null) =>
  selected === null || req.choices.some(([key]) => key === selected);
