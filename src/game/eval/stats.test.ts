import { describe, expect, it } from "vitest";
import {
  bootstrapInterval,
  mean,
  meanInterval,
  median,
  pairedDifference,
  percentile,
  ratio,
  sampleSd,
  summarize,
  tQuantile975,
  wilson,
} from "./stats";

describe("summary statistics", () => {
  it("computes the textbook values", () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(xs)).toBe(5);
    expect(median(xs)).toBe(4.5);
    expect(sampleSd(xs)).toBeCloseTo(2.13809, 4);
    expect(percentile(xs, 50)).toBe(4);
    expect(percentile(xs, 100)).toBe(9);
  });

  it("returns null rather than zero for empty or undersized samples", () => {
    expect(mean([])).toBeNull();
    expect(median([])).toBeNull();
    expect(sampleSd([3])).toBeNull();
    expect(meanInterval([1, 2])).toBeNull();
    expect(ratio(3, 0)).toBeNull();
    expect(wilson(0, 0)).toBeNull();
  });

  it("gates tail percentiles on sample size and says why", () => {
    const small = summarize(Array.from({ length: 15 }, (_, i) => i));
    expect(small.p90).not.toBeNull();
    expect(small.p95).toBeNull();
    expect(small.p99).toBeNull();
    expect(small.notes.join(" ")).toContain("p95 needs n >= 20");
    const large = summarize(Array.from({ length: 200 }, (_, i) => i));
    expect(large.p99).toBe(197);
  });

  it("drops non-finite samples and counts them", () => {
    const s = summarize([1, 2, Number.NaN, 3]);
    expect(s.n).toBe(3);
    expect(s.notes[0]).toContain("1 non-finite");
  });
});

describe("intervals", () => {
  it("matches the t table and converges on the normal", () => {
    expect(tQuantile975(1)).toBe(12.706);
    expect(tQuantile975(10)).toBe(2.228);
    expect(tQuantile975(11)).toBeGreaterThan(2.179);
    expect(tQuantile975(11)).toBeLessThan(2.228);
    expect(tQuantile975(10000)).toBeCloseTo(1.96, 2);
  });

  it("builds a t interval around the mean", () => {
    const ci = meanInterval([10, 12, 14])!;
    // mean 12, sd 2, se 1.1547, t(2) 4.303
    expect(ci.lo).toBeCloseTo(12 - 4.303 * 1.1547, 3);
    expect(ci.hi).toBeCloseTo(12 + 4.303 * 1.1547, 3);
    expect(ci.method).toContain("n=3");
  });

  it("keeps Wilson intervals inside [0, 1] at the extremes", () => {
    const all = wilson(10, 10)!;
    expect(all.hi).toBe(1);
    expect(all.lo).toBeGreaterThan(0.6);
    const none = wilson(0, 10)!;
    expect(none.lo).toBe(0);
    expect(none.hi).toBeLessThan(0.35);
  });

  it("bootstraps deterministically from its seed", () => {
    const xs = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3];
    const a = bootstrapInterval(xs, median, { seed: 7, resamples: 500 });
    const b = bootstrapInterval(xs, median, { seed: 7, resamples: 500 });
    expect(a).toEqual(b);
    expect(a!.lo).toBeLessThanOrEqual(median(xs)!);
    expect(a!.hi).toBeGreaterThanOrEqual(median(xs)!);
  });
});

describe("paired differences", () => {
  it("pairs by seed and skips seeds missing on either side", () => {
    const a = new Map<number, number | null>([
      [42, 1],
      [43, 2],
      [44, null],
      [45, 4],
    ]);
    const b = new Map<number, number | null>([
      [42, 2],
      [43, 4],
      [44, 9],
      [46, 1],
    ]);
    const d = pairedDifference(a, b);
    expect(d.seeds).toEqual([42, 43]);
    expect(d.differences).toEqual([1, 2]);
    expect(d.meanDifference).toBe(1.5);
    expect(d.ci95).toBeNull();
    expect(d.caveat).toMatch(/not by trajectory/);
  });
});
