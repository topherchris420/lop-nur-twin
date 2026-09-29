import { describe, expect, it } from "vitest";
import {
  binIndex,
  calibrate,
  climatologyBrier,
  MIN_BIN_N,
  type CalibrationSample,
} from "./calibration";

describe("confidence binning", () => {
  it("puts each probability in its half-open bin, closing the last at 1", () => {
    expect(binIndex(0)).toBe(0);
    expect(binIndex(0.49)).toBe(0);
    expect(binIndex(0.5)).toBe(1);
    expect(binIndex(0.599)).toBe(1);
    expect(binIndex(0.6)).toBe(2);
    expect(binIndex(0.89)).toBe(4);
    expect(binIndex(0.9)).toBe(5);
    expect(binIndex(1)).toBe(5);
    expect(binIndex(1.01)).toBe(-1);
  });

  it("labels the bins as the reports print them", () => {
    const report = calibrate([]);
    expect(report.bins.map((b) => b.label)).toEqual([
      "0.00–0.49",
      "0.50–0.59",
      "0.60–0.69",
      "0.70–0.79",
      "0.80–0.89",
      "0.90–1.00",
    ]);
  });
});

describe("calibration metrics", () => {
  it("scores a perfectly calibrated predictor with zero ECE", () => {
    // 10 samples at p = 0.8 with 8 successes; 10 at p = 0.6 with 6.
    const samples: CalibrationSample[] = [
      ...Array.from({ length: 10 }, (_, i): CalibrationSample => ({
        p: 0.8,
        y: i < 8 ? 1 : 0,
      })),
      ...Array.from({ length: 10 }, (_, i): CalibrationSample => ({
        p: 0.6,
        y: i < 6 ? 1 : 0,
      })),
    ];
    const r = calibrate(samples);
    expect(r.ece).toBeCloseTo(0, 10);
    expect(r.n).toBe(20);
    // Brier: 10·(0.8·0.04 + 0.2·0.64)/20 + 10·(0.6·0.16 + 0.4·0.36)/20
    expect(r.brier).toBeCloseTo((0.16 + 0.24) / 2, 10);
    expect(r.bins[4]!.empirical).toBe(0.8);
  });

  it("measures overconfidence as the gap between stated and observed", () => {
    const samples = Array.from({ length: 40 }, (_, i): CalibrationSample => ({
      p: 0.95,
      y: i < 20 ? 1 : 0,
    }));
    const r = calibrate(samples);
    expect(r.ece).toBeCloseTo(0.45, 10);
    expect(r.maxGap).toBeCloseTo(0.45, 10);
    expect(r.bins[5]!.sufficient).toBe(true);
    expect(r.bins[5]!.interval!.lo).toBeLessThan(0.5);
  });

  it("marks small bins insufficient and the whole report inadequate", () => {
    const r = calibrate([
      { p: 0.7, y: 1 },
      { p: 0.72, y: 0 },
    ]);
    expect(r.bins[3]!.n).toBe(2);
    expect(r.bins[3]!.sufficient).toBe(false);
    expect(r.adequacy).toBe("insufficient");
    expect(r.notes.join(" ")).toContain(`below n = ${MIN_BIN_N}`);
  });

  it("rejects probabilities outside [0, 1] instead of clamping them", () => {
    const r = calibrate([
      { p: 1.2, y: 1 },
      { p: Number.NaN, y: 0 },
      { p: 0.5, y: 1 },
    ]);
    expect(r.n).toBe(1);
    expect(r.rejected).toBe(2);
  });

  it("reports nothing, not zero, with no samples", () => {
    const r = calibrate([]);
    expect(r.brier).toBeNull();
    expect(r.ece).toBeNull();
    expect(r.adequacy).toBe("none");
  });

  it("gives the base-rate predictor's Brier score as the bar to beat", () => {
    expect(
      climatologyBrier([
        { p: 0.9, y: 1 },
        { p: 0.9, y: 0 },
      ]),
    ).toBeCloseTo(0.25, 10);
    expect(climatologyBrier([])).toBeNull();
  });
});
