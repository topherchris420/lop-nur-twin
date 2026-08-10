import { describe, expect, it } from "vitest";
import {
  XRAY_LAYERS,
  XRAY_LAYER_ORDER,
  XRAY_MODES,
  describeXrayMode,
  parseXrayMode,
  xrayTreatment,
  xrayTreatmentsAreOrdinal,
} from "./xray";
import { EVIDENCE_CLASSIFICATIONS } from "./evidence";

/**
 * X-ray's one job is to make appearance follow support. Every test here is a
 * form of the same question: can any combination of controls make a weaker
 * claim look better supported than a stronger one? The answer has to be no,
 * because a table that inverts once would invert silently — a screenshot of an
 * over-solid guess looks exactly like a screenshot of an observation.
 */

describe("the treatment table", () => {
  it("is ordinal across lift, opacity and dissolve", () => {
    expect(xrayTreatmentsAreOrdinal()).toBe(true);
  });

  it("keeps observed on the ground and fully solid", () => {
    expect(XRAY_LAYERS.observed.liftM).toBe(0);
    expect(XRAY_LAYERS.observed.body).toBe("solid");
    expect(XRAY_LAYERS.observed.opacity).toBe(1);
    expect(XRAY_LAYERS.observed.dissolve).toBe(0);
  });

  it("covers every classification exactly once, strongest first", () => {
    expect(XRAY_LAYER_ORDER.map((layer) => layer.classification)).toEqual([
      ...EVIDENCE_CLASSIFICATIONS,
    ]);
  });

  it("never lets a stratum reach the one above it", () => {
    // The tallest modeled structure is 30 m; a gap narrower than that would let
    // two layers intersect and stop reading as separate.
    for (let index = 1; index < XRAY_LAYER_ORDER.length; index += 1) {
      const gap = XRAY_LAYER_ORDER[index]!.liftM - XRAY_LAYER_ORDER[index - 1]!.liftM;
      expect(gap).toBeGreaterThan(30);
    }
  });
});

describe("xrayTreatment", () => {
  it("returns the reconstruction untouched when the mode is off", () => {
    for (const classification of EVIDENCE_CLASSIFICATIONS) {
      const treatment = xrayTreatment(classification, "off", null);
      expect(treatment.liftM).toBe(0);
      expect(treatment.body).toBe("solid");
      expect(treatment.opacity).toBe(1);
      expect(treatment.dissolve).toBe(0);
    }
  });

  it("ghosts in place without lifting", () => {
    for (const classification of EVIDENCE_CLASSIFICATIONS) {
      expect(xrayTreatment(classification, "ghost", null).liftM).toBe(0);
      expect(xrayTreatment(classification, "ghost", null).body).toBe(
        XRAY_LAYERS[classification].body,
      );
    }
  });

  it("lifts each layer to its own altitude when stratified", () => {
    for (const classification of EVIDENCE_CLASSIFICATIONS) {
      expect(xrayTreatment(classification, "stratified", null).liftM).toBe(
        XRAY_LAYERS[classification].liftM,
      );
    }
  });

  it("treats focus as emphasis, never as a filter", () => {
    // An unfocused layer is pushed down to a faint shell and stays drawn. A
    // viewer isolating one layer needs to see how much is being held back.
    for (const focus of EVIDENCE_CLASSIFICATIONS) {
      for (const classification of EVIDENCE_CLASSIFICATIONS) {
        const treatment = xrayTreatment(classification, "stratified", focus);
        if (classification === focus) {
          expect(treatment.body).toBe(XRAY_LAYERS[classification].body);
        } else {
          expect(treatment.body).toBe("ghost");
          expect(treatment.opacity).toBeLessThanOrEqual(0.1);
          expect(treatment.opacity).toBeGreaterThan(0);
          expect(treatment.dissolve).toBeGreaterThanOrEqual(0.8);
          expect(treatment.dissolve).toBeLessThan(1);
        }
      }
    }
  });

  it("never makes a weaker layer more solid than a stronger one, in any mode", () => {
    for (const mode of XRAY_MODES) {
      for (const focus of [null, ...EVIDENCE_CLASSIFICATIONS]) {
        const treatments = EVIDENCE_CLASSIFICATIONS.map((classification) =>
          xrayTreatment(classification, mode, focus),
        );
        for (let index = 1; index < treatments.length; index += 1) {
          const stronger = treatments[index - 1]!;
          const weaker = treatments[index]!;
          // Focus deliberately suppresses everything it is not, including
          // layers stronger than itself, so the ordinal guarantee holds among
          // the unfocused set rather than across the focus boundary.
          if (
            focus !== null &&
            (stronger.classification === focus || weaker.classification === focus)
          ) {
            continue;
          }
          expect(weaker.opacity, `${mode}/${focus}`).toBeLessThanOrEqual(
            stronger.opacity,
          );
          expect(weaker.dissolve, `${mode}/${focus}`).toBeGreaterThanOrEqual(
            stronger.dissolve,
          );
        }
      }
    }
  });
});

describe("parseXrayMode", () => {
  it("accepts only the three modes", () => {
    for (const mode of XRAY_MODES) expect(parseXrayMode(mode)).toBe(mode);
  });

  it("rejects anything else without coercing it", () => {
    for (const value of ["", "STRATIFIED", "on", 1, null, undefined, {}, ["ghost"]]) {
      expect(parseXrayMode(value)).toBeNull();
    }
  });
});

describe("describeXrayMode", () => {
  it("says what is being held back when a layer is isolated", () => {
    const described = describeXrayMode("stratified", "observed");
    expect(described).toContain("observed");
    expect(described).toMatch(/faint shells rather than being hidden/);
  });

  it("does not mention isolation when no layer is focused", () => {
    expect(describeXrayMode("ghost", null)).not.toMatch(/Isolating/);
  });
});
