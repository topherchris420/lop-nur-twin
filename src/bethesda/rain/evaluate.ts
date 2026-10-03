/**
 * `rain-criteria/v1`, applied by the Bethesda host to its own recorded
 * measurements. The rule is R.A.I.N.'s published one
 * (`james_library/experiments/evaluate.py`), applied in the same order:
 *
 *   1. any guard that does not hold, or cannot be evaluated → inconclusive;
 *   2. any failure criterion that holds → failed (failure dominates success);
 *   3. every success criterion holds → passed;
 *   4. otherwise → inconclusive.
 *
 * It is ported rather than invented so that the lab and R.A.I.N.'s registry
 * reach the same status from the same numbers; `tools/rain-bridge/
 * conformance.py` runs james_library's own `evaluate()` on the lab's
 * submissions and fails on any disagreement. When R.A.I.N. admits a run, its
 * run record is R.A.I.N.'s verdict; this one is the host's. A model is never
 * consulted, and nothing here reads interpretation text.
 */
import {
  CRITERIA_RULE,
  type CriterionResult,
  type Evaluation,
  type RainRunStatus,
  type RainVerdict,
} from "./contracts";
import type { Criterion } from "./experiments";

const OPS: Record<Criterion["op"], (a: number, b: number) => boolean> = {
  ">=": (a, b) => a >= b,
  ">": (a, b) => a > b,
  "<=": (a, b) => a <= b,
  "<": (a, b) => a < b,
};

export function checkCriterion(
  c: Pick<Criterion, "id" | "metric" | "op" | "value">,
  measurements: Record<string, number | null | undefined>,
): CriterionResult {
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
  criteria: { guards: Criterion[]; success: Criterion[]; failure: Criterion[] },
  measurements: Record<string, number | null | undefined>,
): {
  status: Exclude<RainRunStatus, "error">;
  verdict: RainVerdict;
  evaluation: Evaluation;
} {
  const guards = criteria.guards.map((c) => checkCriterion(c, measurements));
  const success = criteria.success.map((c) => checkCriterion(c, measurements));
  const failure = criteria.failure.map((c) => checkCriterion(c, measurements));
  const unmet = guards.filter((g) => g.holds !== true).map((g) => g.id);
  const triggered = failure.filter((f) => f.holds === true).map((f) => f.id);
  const met = success.filter((s) => s.holds === true).map((s) => s.id);
  const unevaluable = [...success, ...failure]
    .filter((c) => c.holds === null)
    .map((c) => c.id);
  let status: Exclude<RainRunStatus, "error">, verdict: RainVerdict, summary: string;
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
    if (unevaluable.length)
      summary += ` Not evaluable (missing measurement): ${unevaluable.join(", ")}.`;
  }
  return {
    status,
    verdict,
    evaluation: { rule: CRITERIA_RULE, guards, success, failure, summary },
  };
}
