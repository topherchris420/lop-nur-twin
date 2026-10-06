/**
 * `rain-criteria/v1`: deterministic evaluation of pre-registered criteria
 * against recorded measurements. The one implementation in this repository,
 * applied by the registry when it admits a run and by the Bethesda lab to its
 * own measurements, so the two cannot disagree. A port of R.A.I.N.'s
 * `experiments/evaluate.py` (james_library, MIT).
 *
 * This is the only code that assigns `passed`/`failed`/`inconclusive`.
 * Runners and external producers supply measurements, never a status, and a
 * model interpretation is never consulted. The rule, applied in order:
 *
 *   1. Any guard that does not hold, or cannot be evaluated → `inconclusive`
 *      (insufficient evidence). A small sample supports no conclusion either way.
 *   2. Any failure criterion that holds → `failed` (hypothesis not supported).
 *      Failure dominates success.
 *   3. Every success criterion holds → `passed` (hypothesis supported).
 *   4. Otherwise → `inconclusive` (insufficient evidence).
 *
 * Shared with the server and the browser: imports nothing.
 */

export const CRITERIA_RULE = "rain-criteria/v1" as const;
export type CriterionOp = ">=" | ">" | "<=" | "<";
export interface Criterion {
  id: string;
  metric: string;
  op: CriterionOp;
  value: number;
}
export interface CriterionResult extends Criterion {
  observed: number | null;
  holds: boolean | null;
}
export interface Evaluation {
  rule: typeof CRITERIA_RULE;
  guards: CriterionResult[];
  success: CriterionResult[];
  failure: CriterionResult[];
  summary: string;
}
export type RunStatus = "running" | "passed" | "failed" | "inconclusive" | "error";
export type CompletedStatus = Exclude<RunStatus, "running" | "error">;
export type Verdict = "supported" | "not_supported" | "insufficient_evidence" | "not_evaluated";
export type Measurements = Readonly<Record<string, number | null | undefined>>;

const OPS: Record<CriterionOp, (a: number, b: number) => boolean> = {
  ">=": (a, b) => a >= b,
  ">": (a, b) => a > b,
  "<=": (a, b) => a <= b,
  "<": (a, b) => a < b,
};

export function checkCriterion(c: Criterion, measurements: Measurements): CriterionResult {
  const observed = measurements[c.metric];
  const usable = typeof observed === "number" && Number.isFinite(observed);
  return {
    id: c.id,
    metric: c.metric,
    op: c.op,
    value: c.value,
    observed: usable ? observed : null,
    holds: usable ? OPS[c.op](observed, c.value) : null,
  };
}

export function evaluate(
  criteria: { guards: readonly Criterion[]; success: readonly Criterion[]; failure: readonly Criterion[] },
  measurements: Measurements,
): { status: CompletedStatus; verdict: Verdict; evaluation: Evaluation } {
  const guards = criteria.guards.map((c) => checkCriterion(c, measurements));
  const success = criteria.success.map((c) => checkCriterion(c, measurements));
  const failure = criteria.failure.map((c) => checkCriterion(c, measurements));
  const unmet = guards.filter((g) => g.holds !== true).map((g) => g.id);
  const triggered = failure.filter((f) => f.holds === true).map((f) => f.id);
  const met = success.filter((s) => s.holds === true).map((s) => s.id);
  const unevaluable = [...success, ...failure].filter((c) => c.holds === null).map((c) => c.id);
  let status: CompletedStatus, verdict: Verdict, summary: string;
  if (unmet.length) {
    status = "inconclusive";
    verdict = "insufficient_evidence";
    summary = `Evidence-sufficiency guard(s) not met: ${unmet.join(", ")}. No conclusion drawn.`;
  } else if (triggered.length) {
    status = "failed";
    verdict = "not_supported";
    summary = `Failure criterion triggered: ${triggered.join(", ")}. The hypothesis is not supported.`;
  } else if (met.length === success.length) {
    status = "passed";
    verdict = "supported";
    summary = `All ${success.length} success criteria held and no failure criterion triggered.`;
  } else {
    status = "inconclusive";
    verdict = "insufficient_evidence";
    const missing = success.filter((s) => s.holds !== true).map((s) => s.id);
    summary = `Success criteria not all met (${missing.join(", ")}) and no failure criterion triggered.`;
    if (unevaluable.length) summary += ` Not evaluable (missing measurement): ${unevaluable.join(", ")}.`;
  }
  return { status, verdict, evaluation: { rule: CRITERIA_RULE, guards, success, failure, summary } };
}

/** The verdict a status implies; the pair is always consistent. */
export const VERDICT_FOR: Record<Exclude<RunStatus, "running">, Verdict> = {
  passed: "supported",
  failed: "not_supported",
  inconclusive: "insufficient_evidence",
  error: "not_evaluated",
};
