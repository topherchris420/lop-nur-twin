import { describe, expect, it } from "vitest";
import { parseProfiles, profileSupports, wilsonLower } from "./calibration.js";
import { profile, request } from "./fixtures.js";

/**
 * Calibration files are read, never fitted, by this runtime: the load and
 * support checks from R.A.I.N.'s `tests/test_decision_calibration.py`.
 */
describe("decision calibration", () => {
  it("round-trips a profile through a calibration file", () => {
    const p = profile("typesafe", request());
    expect(parseProfiles(JSON.stringify([p]))).toEqual([p]);
    expect(profileSupports(p, 100)).toBe(true);
  });

  it("requires new evidence for an expired profile or a stricter threshold", () => {
    const p = profile("laya");
    expect(profileSupports({ ...p, expires_at: "2020-01-01T00:00:00+00:00" }, 100)).toBe(
      false,
    );
    expect(profileSupports({ ...p, threshold: 0.995 }, 100)).toBe(false);
    expect(profileSupports(p, 201)).toBe(false);
  });

  it("fails closed on invalid calibration files", () => {
    for (const payload of [
      '[{"engine":"laya","engine":"typesafe"}]',
      "[NaN]",
      "{}",
      JSON.stringify([profile("laya"), profile("laya")]),
      JSON.stringify([{ ...profile("laya"), threshold: 2 }]),
    ])
      expect(() => parseProfiles(payload), payload.slice(0, 40)).toThrow(
        /invalid calibration file/,
      );
  });

  it("uses a Wilson lower bound", () => {
    expect(wilsonLower(200, 200)).toBeGreaterThan(0.95);
    expect(wilsonLower(150, 200)).toBeLessThan(0.75);
    expect(wilsonLower(0, 0)).toBe(0);
  });
});
