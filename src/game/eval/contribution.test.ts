import { describe, expect, it } from "vitest";
import { contributions, type FactorArm } from "./contribution";

const seeds = (values: number[]) =>
  new Map(values.map((v, i) => [42 + i, v] as [number, number]));

const cell = (
  id: string,
  brain: string,
  control: string,
  values: number[],
): FactorArm => ({
  id,
  levels: { brain, control, navigation: "places", motor: "standard", policy: "none" },
  primary: seeds(values),
});

describe("contribution analysis", () => {
  // A 2×2 where the controller is worth +4 to the model and +1 to random.
  const arms = [
    cell("random-direct", "random", "direct", [0, 0, 0]),
    cell("random-precision", "random", "precision", [1, 1, 1]),
    cell("model-direct", "model", "direct", [2, 2, 2]),
    cell("model-precision", "model", "precision", [6, 6, 6]),
  ];
  const report = contributions(arms, ["brain", "control"]);

  it("contrasts only arms that differ in exactly one factor", () => {
    const pairs = report.contrasts.map((c) => `${c.from.arm}→${c.to.arm}`).sort();
    expect(pairs).toEqual([
      "model-direct→model-precision",
      "random-direct→model-direct",
      "random-direct→random-precision",
      "random-precision→model-precision",
    ]);
  });

  it("holds the other factors fixed and says at which levels", () => {
    const c = report.contrasts.find(
      (x) => x.to.arm === "model-precision" && x.factor === "control",
    )!;
    expect(c.difference.meanDifference).toBe(4);
    expect(c.heldFixed.brain).toBe("model");
  });

  it("reports the interaction instead of pretending effects add", () => {
    expect(report.interactions).toHaveLength(1);
    // Controller effect at brain=random is 1, at brain=model is 4.
    expect(Math.abs(report.interactions[0]!.differenceOfDifferences!)).toBe(3);
    expect(report.statement).toMatch(/not shares of a whole/);
  });

  it("never contrasts arms whose other settings differ, and lists them as held fixed", () => {
    const at = (arm: FactorArm, setting: Record<string, string>): FactorArm => ({
      ...arm,
      setting,
    });
    const r = contributions(
      [
        at(arms[0]!, { latencyMs: "0", stale: "strict" }),
        // Differs from random-direct in control *and* injected latency.
        at(arms[1]!, { latencyMs: "600", stale: "strict" }),
        // Differs from random-direct in brain only.
        at(arms[2]!, { latencyMs: "0", stale: "strict" }),
      ],
      ["brain", "control"],
    );
    expect(r.contrasts.map((c) => `${c.from.arm}→${c.to.arm}`)).toEqual([
      "random-direct→model-direct",
    ]);
    expect(r.contrasts[0]!.heldFixed).toMatchObject({
      control: "direct",
      latencyMs: "0",
      stale: "strict",
    });
  });

  it("finds nothing to contrast when every pair differs in two factors", () => {
    const r = contributions([arms[0]!, arms[3]!], ["brain", "control"]);
    expect(r.contrasts).toEqual([]);
  });
});
