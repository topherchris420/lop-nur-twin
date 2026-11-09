import { describe, expect, it } from "vitest";
import { decide, mean, pairedInterval, reading, sd, signTestP, streamSeed } from "./statistics.js";

const opts = { resamples: 4000, seed: 7, label: "t", level: 0.95, direction: "higher" as const };

describe("the paired interval", () => {
  it("is the bootstrap of the mean paired difference, reproducible from its seed and label", () => {
    const d = [0.1, 0.3, -0.2, 0.4, 0.0, 0.2, 0.1, 0.5];
    const a = pairedInterval(d, opts);
    expect(a).toEqual(pairedInterval(d, opts));
    expect(a.n).toBe(8);
    expect(a.mean).toBeCloseTo(mean(d), 12);
    expect(a.sd).toBeCloseTo(sd(d), 12);
    expect(a.low).toBeLessThan(a.mean);
    expect(a.high).toBeGreaterThan(a.mean);
    expect([a.better, a.worse, a.tied]).toEqual([6, 1, 1]);
    expect(pairedInterval(d, { ...opts, label: "other" })).not.toEqual(a);
  });

  it("counts better and worse by the metric's direction", () => {
    const d = [1, 2, -1];
    expect(pairedInterval(d, { ...opts, direction: "lower" })).toMatchObject({ better: 1, worse: 2 });
  });

  it("is empty, never invented, with no paired units", () => {
    const e = pairedInterval([], opts);
    expect(e.n).toBe(0);
    expect(Number.isNaN(e.low) && Number.isNaN(e.high)).toBe(true);
    expect(decide(e, "higher", 1).verdict).toBe("INCONCLUSIVE");
  });

  it("widens with a higher level (the Bonferroni correction)", () => {
    const d = Array.from({ length: 30 }, (_, i) => Math.sin(i * 1.7));
    const a = pairedInterval(d, { ...opts, level: 0.95 });
    const b = pairedInterval(d, { ...opts, level: 0.99 });
    expect(b.high - b.low).toBeGreaterThan(a.high - a.low);
  });

  it("derives independent streams per label", () => {
    expect(streamSeed(1, "a")).not.toBe(streamSeed(1, "b"));
    expect(streamSeed(1, "a")).toBe(streamSeed(1, "a"));
  });
});

describe("the exact sign test", () => {
  it("matches the binomial", () => {
    expect(signTestP(0, 0)).toBe(1);
    expect(signTestP(5, 5)).toBe(1);
    expect(signTestP(10, 0)).toBeCloseTo(2 / 1024, 12);
    expect(signTestP(9, 1)).toBeCloseTo((2 * 11) / 1024, 12);
    expect(signTestP(1, 9)).toBeCloseTo(signTestP(9, 1), 12);
  });
});

describe("the decision against the minimum meaningful effect", () => {
  const at = (low: number, high: number, m = (low + high) / 2) => ({
    n: 10,
    mean: m,
    sd: 1,
    dz: m,
    level: 0.975,
    low,
    high,
    better: 0,
    worse: 0,
    tied: 0,
    signP: 1,
  });
  it("claims an improvement only above zero and at least δ", () => {
    expect(decide(at(0.2, 0.6), "higher", 0.3).verdict).toBe("IMPROVEMENT");
    expect(decide(at(0.05, 0.6, 0.2), "higher", 0.3).verdict).toBe("INCONCLUSIVE");
  });
  it("calls an interval inside ±δ no demonstrated improvement", () => {
    expect(decide(at(-0.1, 0.1), "higher", 0.3).verdict).toBe("NO_DEMONSTRATED_IMPROVEMENT");
    expect(decide(at(0.01, 0.1), "higher", 0.3).verdict).toBe("NO_DEMONSTRATED_IMPROVEMENT");
  });
  it("calls an interval wholly on the worse side a regression, even a small one", () => {
    expect(decide(at(-0.6, -0.2), "higher", 0.3).verdict).toBe("REGRESSION");
    const small = decide(at(-0.1, -0.01), "higher", 0.3);
    expect(small.verdict).toBe("REGRESSION");
    expect(small.practical).toBe(false);
  });
  it("calls an interval that spans zero and reaches past δ inconclusive", () => {
    expect(decide(at(-0.5, 0.5), "higher", 0.3).verdict).toBe("INCONCLUSIVE");
  });
  it("mirrors for a metric where lower is better", () => {
    expect(decide(at(-0.6, -0.2), "lower", 0.3).verdict).toBe("IMPROVEMENT");
    expect(decide(at(0.2, 0.6), "lower", 0.3).verdict).toBe("REGRESSION");
  });
  it("refuses a non-positive δ", () => {
    expect(() => decide(at(0, 1), "higher", 0)).toThrow(/positive/);
  });
  it("reads secondary contrasts without a claim", () => {
    expect(reading(at(0.1, 0.2), "higher")).toBe("better");
    expect(reading(at(0.1, 0.2), "lower")).toBe("worse");
    expect(reading(at(-0.1, 0.2), "higher")).toBe("no difference detected");
    expect(reading(at(-0.3, -0.2), "neutral")).toBe("lower");
  });
});
