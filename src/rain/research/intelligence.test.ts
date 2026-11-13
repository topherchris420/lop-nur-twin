import { describe, expect, it } from "vitest";
import {
  assessProbe,
  expectedInformation,
  rankCpuDesigns,
  updateRivals,
  validateIntelligencePlan,
  type IntelligencePlan,
  type ProbeResult,
} from "./intelligence.js";

export function cpuTestPlan(): IntelligencePlan {
  return {
    schema: "rain-intelligence-plan/v1",
    question: "Can the monitor withstand a null control?",
    rivals: { calibrated: 0.5, miscalibrated: 0.5 },
    designs: [
      {
        id: "null",
        adapter: "qnp-stable",
        parameters: {},
        predictions: { calibrated: 0.95, miscalibrated: 0.2 },
        cost_units: 1,
        minimum_rate: 0.75,
        hypothesis: "At least 75% of stable sessions stay quiet.",
        falsification: "The fixed-n upper bound is below 75%.",
      },
    ],
    screen_seeds: Array.from({ length: 32 }, (_, i) => i),
    confirm_seeds: Array.from({ length: 64 }, (_, i) => i + 1000),
    family_alpha: 0.05,
    budget_units: 1000,
    timeout_seconds: 30,
    policy: "information",
    parent_campaigns: [],
  };
}
const probe = (samples: number[], check = true): ProbeResult => ({
  samples,
  checks: { reference: check },
  details: {},
  provenance: { source: "scripted-test" },
});
describe("scientific decisions", () => {
  it("computes entropy analytically and ranks by cost", () => {
    expect(expectedInformation({ a: 0.4, b: 0.4 }, { a: 0.5, b: 0.5 })).toBeCloseTo(0);
    expect(expectedInformation({ a: 0, b: 1 }, { a: 0.5, b: 0.5 })).toBeCloseTo(1);
    const d = cpuTestPlan().designs[0]!;
    const rows = rankCpuDesigns(
      [
        { ...d, id: "expensive", cost_units: 10 },
        { ...d, id: "cheap" },
      ],
      cpuTestPlan().rivals,
      "information",
    );
    expect(rows[0]!.design.id).toBe("cheap");
  });
  it("matches hand-computed Bayes and abstains when every rival is impossible", () => {
    expect(updateRivals({ a: 0.5, b: 0.5 }, { a: 0.8, b: 0.2 }, [1])!.a).toBeCloseTo(0.8);
    expect(updateRivals({ a: 0.5, b: 0.5 }, { a: 0, b: 0 }, [1])).toBeNull();
    expect(() => updateRivals({ a: 1 }, { a: 0.5 }, [0.5])).toThrow();
  });
  it("checks the independent fixed-n bound and vetoes failed diagnostics", () => {
    const result = assessProbe(probe(Array<number>(64).fill(1)), 64, 0.01, 0.75);
    expect(result.lower).toBeCloseTo(1 - Math.sqrt(Math.log(200) / 128));
    expect(result.verdict).toBe("supported");
    expect(assessProbe(probe(Array<number>(64).fill(0)), 64, 0.01, 0.75).verdict).toBe(
      "falsified",
    );
    expect(
      assessProbe(probe(Array<number>(64).fill(1), false), 64, 0.01, 0.75).verdict,
    ).toBe("invalid");
    expect(() => assessProbe(probe([1]), 64, 0.01, 0.75)).toThrow();
    expect(() =>
      assessProbe({ ...probe(Array<number>(64).fill(1)), checks: {} }, 64, 0.01, 0.75),
    ).toThrow();
    expect(() =>
      assessProbe(
        { ...probe(Array<number>(64).fill(1)), provenance: {} },
        64,
        0.01,
        0.75,
      ),
    ).toThrow();
  });
  it("freezes a closed design family with disjoint withheld seeds", () => {
    const p = cpuTestPlan();
    expect(validateIntelligencePlan(p)).toEqual(p);
    expect(() => validateIntelligencePlan({ ...p, command: "anything" })).toThrow();
    expect(() =>
      validateIntelligencePlan({ ...p, confirm_seeds: p.screen_seeds }),
    ).toThrow(/disjoint/);
    expect(() =>
      validateIntelligencePlan({ ...p, designs: [p.designs[0], p.designs[0]] }),
    ).toThrow(/Duplicate/);
    expect(() => validateIntelligencePlan({ ...p, budget_units: true })).toThrow();
    expect(() => validateIntelligencePlan({ ...p, rivals: { calibrated: 1 } })).toThrow();
    expect(() => validateIntelligencePlan({ ...p, rivals: { a: NaN, b: 1 } })).toThrow();
    expect(() =>
      validateIntelligencePlan({
        ...p,
        designs: [{ ...p.designs[0], predictions: { calibrated: 1, other: 0 } }],
      }),
    ).toThrow();
  });
});
