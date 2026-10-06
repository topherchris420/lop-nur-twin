/**
 * Provider-neutral values for bounded evaluation: the question a decision
 * engine is asked, and the typed answer it must return. A port of R.A.I.N.'s
 * `judgment/contracts.py` (james_library, MIT), limited to what bounded
 * routing uses: Choice questions with explicit criteria, and the validation
 * every provider's answer passes at the policy boundary.
 *
 * Shared with the server: imports nothing.
 */

export type QuestionType = "choice" | "score" | "noul";

export interface AtomicQuestion {
  questionId: string;
  type: QuestionType;
  instructions: string;
  choices: readonly (readonly [string, string])[];
  levels: readonly string[];
}
export interface QuestionSet {
  version: string;
  questions: readonly AtomicQuestion[];
}

/** The question as the SystemOne protocol carries it. */
export function questionToDict(q: AtomicQuestion): Record<string, unknown> {
  const value: Record<string, unknown> = { type: q.type, instructions: q.instructions };
  if (q.type === "choice") value.criteria = Object.fromEntries(q.choices);
  else if (q.type === "score") value.criteria = [...q.levels];
  return value;
}
export const questionSetToDict = (set: QuestionSet): Record<string, unknown> =>
  Object.fromEntries(set.questions.map((q) => [q.questionId, questionToDict(q)]));

export interface JudgmentState {
  canonicalText: string;
  stateHash: string;
}
export interface JudgmentAnswer {
  questionId: string;
  type: QuestionType;
  value: string | number;
  probabilities: readonly (readonly [string, number])[];
  confidence: number | null;
}
export interface JudgmentResult {
  provider: string;
  model: string | null;
  answers: readonly JudgmentAnswer[];
  stateHash: string;
  questionSetVersion: string;
  errorCode: string | null;
  errorStatus: number | null;
}
export interface JudgmentProvider {
  evaluate(state: JudgmentState, questions: QuestionSet): Promise<JudgmentResult>;
}

export const boundedNumber = (
  value: unknown,
  low: number,
  high: number,
): value is number =>
  typeof value === "number" && Number.isFinite(value) && low <= value && value <= high;

/** Validate every provider at the policy boundary, including local implementations. */
export function validAnswers(result: JudgmentResult, questions: QuestionSet): boolean {
  if (
    !Array.isArray(result.answers) ||
    result.answers.length !== questions.questions.length
  )
    return false;
  const byId = new Map(result.answers.map((a) => [a.questionId, a]));
  const ids = new Set(questions.questions.map((q) => q.questionId));
  if (byId.size !== ids.size || [...byId.keys()].some((id) => !ids.has(id))) return false;
  for (const question of questions.questions) {
    const answer = byId.get(question.questionId)!;
    if (answer.type !== question.type) return false;
    if (question.type === "noul") {
      if (
        !boundedNumber(answer.value, 0, 1) ||
        answer.confidence !== null ||
        answer.probabilities.length
      )
        return false;
      continue;
    }
    if (!boundedNumber(answer.confidence, 0, 1)) return false;
    let expected: Set<string>;
    if (question.type === "choice") {
      expected = new Set(question.choices.map(([key]) => key));
      if (typeof answer.value !== "string" || !expected.has(answer.value)) return false;
    } else {
      expected = new Set(question.levels.map((_, index) => String(index)));
      if (!boundedNumber(answer.value, 0, question.levels.length - 1)) return false;
    }
    const probabilities = new Map<string, number>(answer.probabilities);
    if (
      answer.probabilities.length !== expected.size ||
      probabilities.size !== expected.size
    )
      return false;
    for (const key of probabilities.keys()) if (!expected.has(key)) return false;
    for (const value of probabilities.values())
      if (!boundedNumber(value, 0, 1)) return false;
    const sum = [...probabilities.values()].reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.01) return false;
    if (question.type === "choice") {
      const top = Math.max(...probabilities.values());
      if (probabilities.get(String(answer.value))! < top - 1e-9) return false;
    } else {
      const expectedScore = [...probabilities].reduce(
        (acc, [level, p]) => acc + Number(level) * p,
        0,
      );
      if (Math.abs(Number(answer.value) - expectedScore) > 0.05) return false;
    }
  }
  return true;
}
