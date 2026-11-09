/**
 * The decision system on outcomes chosen in advance. Each verdict the bench can
 * give is produced here from synthetic records built to deserve it, and each
 * way an experiment can break its protocol is shown to give INVALID rather than
 * a result. Negative and null outcomes are first-class: a test that only
 * exercised improvements would not show the bench can say no.
 */
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../rain/sha256.js";
import { ORIGINALS } from "../firstContact/originals.js";
import { summarize } from "./analysis.js";
import { parseProtocol, type Protocol } from "./protocol.js";
import source from "./protocols/plasticity-locomotor-v1.json" with { type: "json" };
import type { RunRecord } from "./runner.js";
import { both, moved, noEffect, syntheticRecords, type Shift } from "./testkit.js";

// The frozen protocol with fewer resamples, so the suite stays quick; the
// decision rules are the same.
const p: Protocol = parseProtocol({ ...source, analysis: { ...source.analysis, resamples: 2000 } });
const A = "plasticity-active";
const sum = (shift: Shift = noEffect, edit?: (r: RunRecord[]) => RunRecord[]) => {
  const records = syntheticRecords(p, "dev", shift);
  return summarize(p, "dev", edit ? edit(records) : records);
};
const improves = both(moved(A, "fedJ", 0.3, 0.02), moved(A, "meals", 2));

describe("the verdicts", () => {
  it("IMPROVEMENT: both endpoints beyond their minimum meaningful effect, no guardrail harmed", () => {
    const s = sum(improves);
    expect(s.validity.valid).toBe(true);
    expect(s.confirmatory.map((c) => c.verdict)).toEqual(["IMPROVEMENT", "IMPROVEMENT"]);
    expect(s.verdict.overall).toBe("IMPROVEMENT");
    expect(s.answers[0]!.answer).toMatch(/^Yes, within this protocol/);
  });

  it("an improvement with a guardrail regression is a trade-off: INCONCLUSIVE, never IMPROVEMENT", () => {
    const s = sum(both(improves, moved(A, "collisions", 3, 0.5)));
    expect(s.confirmatory.map((c) => c.verdict)).toEqual(["IMPROVEMENT", "IMPROVEMENT"]);
    expect(s.guardrails.find((g) => g.metric === "collisions")!.regression).toBe(true);
    expect(s.verdict.overall).toBe("INCONCLUSIVE");
    expect(s.verdict.reasons[0]).toMatch(/trade-off/);
  });

  it("NO_DEMONSTRATED_IMPROVEMENT: identical behaviour gives intervals inside ±δ", () => {
    const s = sum();
    expect(s.confirmatory.map((c) => c.verdict)).toEqual([
      "NO_DEMONSTRATED_IMPROVEMENT",
      "NO_DEMONSTRATED_IMPROVEMENT",
    ]);
    expect(s.verdict.overall).toBe("NO_DEMONSTRATED_IMPROVEMENT");
    expect(s.answers[0]!.answer).toMatch(/^No improvement was demonstrated/);
  });

  it("a real but small effect, below the minimum meaningful effect, is not an improvement", () => {
    const s = sum(both(moved(A, "fedJ", 0.05, 0.005), moved(A, "meals", 0)));
    const c1 = s.confirmatory[0]!;
    expect(c1.interval.low).toBeGreaterThan(0);
    expect(c1.verdict).toBe("NO_DEMONSTRATED_IMPROVEMENT");
    expect(s.verdict.overall).toBe("NO_DEMONSTRATED_IMPROVEMENT");
  });

  it("REGRESSION: the candidate does worse with confidence", () => {
    const s = sum(moved(A, "fedJ", -0.3, 0.02));
    expect(s.confirmatory[0]!.verdict).toBe("REGRESSION");
    expect(s.verdict.overall).toBe("REGRESSION");
  });

  it("REGRESSION: no endpoint improved but a guardrail regressed", () => {
    const s = sum(moved(A, "walkingBlocks", 4, 0.5));
    expect(s.verdict.overall).toBe("REGRESSION");
    expect(s.verdict.reasons[0]).toMatch(/guardrail regressed/);
  });

  it("INCONCLUSIVE: too noisy to decide either way", () => {
    // Six subjects that disagree: mean +0.11 J, some far better, some worse.
    const spread = [0.5, -0.2, 0.4, -0.1, 0.3, -0.25];
    const noisy: Shift = (u, m, base) =>
      u.controller === A && m === "fedJ"
        ? base + spread[p.splits.dev.seeds.indexOf(u.seed)]!
        : base;
    const s = sum(noisy);
    const c1 = s.confirmatory[0]!;
    expect(c1.interval.low).toBeLessThan(0);
    expect(c1.interval.high).toBeGreaterThan(p.endpoints.confirmatory[0]!.mme);
    expect(c1.verdict).toBe("INCONCLUSIVE");
    expect(s.verdict.overall).toBe("INCONCLUSIVE");
  });
});

describe("a broken design is INVALID, not a result", () => {
  const cases: [string, string, (r: RunRecord[]) => RunRecord[], Shift?][] = [
    ["design-complete", "a unit is missing", (r) => r.slice(1)],
    ["design-complete", "a unit is recorded twice", (r) => [...r, r[0]!]],
    [
      "failures-within-limit",
      "a run timed out",
      (r) => r.map((x, i) => (i === 3 ? { ...x, status: "timeout" as const } : x)),
    ],
    [
      "paired-environment",
      "one controller met another environment",
      (r) => r.map((x, i) => (i === 1 ? { ...x, environmentDigest: "0".repeat(64) } : x)),
    ],
    [
      "protocol-bound",
      "a record names another protocol",
      (r) => r.map((x, i) => (i === 2 ? { ...x, protocolDigest: "f".repeat(64) } : x)),
    ],
    [
      "research-subjects-only",
      "a subject is an original",
      (r) => r.map((x, i) => (i === 0 ? { ...x, subject: ORIGINALS[0]!.id } : x)),
    ],
    [
      "identical-to-baseline",
      "carrying plasticity without acting changed behaviour",
      (r) => r,
      both(improves, moved("plasticity-shadow", "meals", 1)),
    ],
  ];
  for (const [check, what, edit, shift] of cases)
    it(`${what}: ${check} fails, verdict INVALID even if the candidate looks better`, () => {
      const s = sum(shift ?? improves, edit);
      expect(s.validity.checks.find((c) => c.id === check)!.passed).toBe(false);
      expect(s.validity.valid).toBe(false);
      expect(s.verdict.overall).toBe("INVALID");
      expect(s.answers[0]!.answer).toMatch(/^Not answerable/);
    });
});

describe("the rest of the summary", () => {
  it("corrects for multiplicity: Bonferroni over each family", () => {
    const s = sum(improves);
    expect(s.confirmatory[0]!.interval.level).toBeCloseTo(1 - 0.05 / 2, 12);
    const fam = p.endpoints.boundary.contrasts.length * p.endpoints.boundary.conditions.length;
    expect(s.boundary[0]!.interval.level).toBeCloseTo(1 - 0.05 / fam, 12);
    expect(s.mechanism).toHaveLength(p.endpoints.mechanism.contrasts.length);
  });

  it("gives exploratory metrics a reading and never a verdict", () => {
    const s = sum(improves);
    expect(s.secondary.length).toBeGreaterThan(100);
    for (const x of s.secondary) expect(x).not.toHaveProperty("verdict");
  });

  it("measures whether the impairment cost the baseline anything (assay sensitivity)", () => {
    const s = sum();
    expect(s.impairmentCost.map((c) => c.condition)).not.toContain("unimpaired");
    expect(s.impairmentCost.every((c) => c.sensitive)).toBe(true);
    // Lift the baseline back under one impairment: the assay can no longer show compensation there.
    const lifted: Shift = (u, m, base) =>
      m === "fedJ" && u.condition === "weak-legs" && u.controller === "organism" ? base + 0.1 : base;
    const t = sum(lifted);
    expect(t.impairmentCost.find((c) => c.condition === "weak-legs")!.sensitive).toBe(false);
    expect(t.answers[5]!.answer).toMatch(/not detected in: weak-legs/);
  });

  it("depends on the records alone, not their order", () => {
    const records = syntheticRecords(p, "dev", improves);
    const a = summarize(p, "dev", records);
    const b = summarize(p, "dev", [...records].reverse());
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("answers all six questions", () => {
    expect(sum().answers.map((a) => a.id)).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"]);
  });
});
