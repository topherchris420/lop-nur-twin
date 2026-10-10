import { expect, it } from "vitest";
import { compareInstitutions, type ComparisonPlan } from "./institutionEvaluation";
import type { DiscoveryEntry } from "../autonomy/store";
import { sha256Json } from "../sha256";
const plan: ComparisonPlan = {
  schema: "rain-inception-comparison/v1",
  question: "Scripted comparison fixture",
  generations: 1,
  sessions_per_arm: 2,
  ceilings_per_session: { experiments: 2, model_calls: 40, runtime_ms: 240000 },
  model: { provider: "lmstudio", model: "scripted-fixture", generation: "scripted" },
  comparison_corpus_sha256: sha256Json([]),
  primary_metric: "nonduplicate_protocols_per_model_call",
};
const entry = {
  kind: "session-end",
  payload: { executed: 2, model_calls: 30, tokens: null },
} as DiscoveryEntry;
const start = {
  kind: "session-start",
  payload: { budgets: plan.ceilings_per_session, ...plan.model },
} as DiscoveryEntry;
it("requires matching completed session allocation and refuses resource overrun", () => {
  const arm = { history: [], entries: [start, entry, start, entry] };
  const result = compareInstitutions(plan, arm, arm);
  expect(result.generation).toBe("scripted");
  expect(result.allocated_budget_per_arm.model_calls).toBe(80);
  expect(result.primary_metric_difference).toBe(0);
  expect(result.scientific_improvement).toMatch("not established");
  expect(() => compareInstitutions(plan, { ...arm, entries: [entry] }, arm)).toThrow(
    "allocation",
  );
  expect(() =>
    compareInstitutions(
      plan,
      {
        ...arm,
        entries: [
          start,
          entry,
          start,
          { ...entry, payload: { model_calls: 41, executed: 2 } },
        ],
      },
      arm,
    ),
  ).toThrow("ceiling");
  expect(() =>
    compareInstitutions(
      plan,
      {
        ...arm,
        entries: [
          start,
          entry,
          { ...start, payload: { ...(start.payload as object), model: "different" } },
          entry,
        ],
      },
      arm,
    ),
  ).toThrow("preregistration");
});
