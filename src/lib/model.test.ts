import { describe, expect, it } from "vitest";
import { canonicalJson, canonicalize } from "./canonicalJson";
import { QUALITY_PROFILES, getQualityProfile } from "./quality";
import { STRUCTURES, TIMELINE_BOUNDS, getObservedYear } from "./layout";
import { CLIMATE_MONTHS, climateDustFactor, getClimateMonth } from "./siteData";
import { isSceneDressingVisible, isSubjectDrawn, subjectDrawState } from "./drawState";
import { earliestKnowableDate } from "./evidence";
import { TEMPORAL_SNAPSHOT_DATES } from "./temporal";

describe("canonical JSON", () => {
  it("sorts object keys recursively, so key order cannot move a hash", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson({ a: { c: 3, d: 2 }, b: 1 })).toBe(
      canonicalJson({ b: 1, a: { d: 2, c: 3 } }),
    );
  });

  it("preserves array order, because order is meaning in the layout", () => {
    // A runway runs from `from` to `to`; sorting those would reverse it.
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined rather than emitting null for it", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("keeps an explicit null, which is different from an absent field", () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });

  it("refuses a non-finite number instead of hashing it as null", () => {
    // `JSON.stringify(NaN)` is `null`, which would hash a broken model to the
    // same digest as one with a legitimate null in that slot.
    expect(() => canonicalize({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalize({ a: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
  });

  it("refuses values with no reproducible serialisation", () => {
    expect(() => canonicalize({ a: () => 1 })).toThrow(/unsupported value/);
    expect(() => canonicalize({ a: Symbol("x") })).toThrow(/unsupported value/);
    expect(() => canonicalize({ a: 1n })).toThrow(/unsupported value/);
  });

  it("is stable across repeated calls", () => {
    const value = { z: [1, { b: 2, a: 3 }], a: "x" };
    expect(canonicalJson(value)).toBe(canonicalJson(value));
  });

  it("handles nesting inside arrays", () => {
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });
});

describe("quality tiers", () => {
  it("defines all four tiers", () => {
    expect(Object.keys(QUALITY_PROFILES).sort()).toEqual(["0", "1", "2", "3"]);
  });

  it("scales monotonically, so a lower tier is never more expensive", () => {
    const tiers = [0, 1, 2, 3] as const;
    for (let index = 1; index < tiers.length; index += 1) {
      const lower = getQualityProfile(tiers[index - 1]!);
      const higher = getQualityProfile(tiers[index]!);
      expect(higher.terrainSegments).toBeGreaterThanOrEqual(lower.terrainSegments);
      expect(higher.dustParticles).toBeGreaterThanOrEqual(lower.dustParticles);
      expect(higher.dprMax).toBeGreaterThanOrEqual(lower.dprMax);
      expect(higher.patrolVehicleCount).toBeGreaterThanOrEqual(lower.patrolVehicleCount);
    }
  });

  it("mounts the post stack on the top tier only", () => {
    expect(getQualityProfile(3).postprocessing).toBe(true);
    for (const tier of [0, 1, 2] as const) {
      expect(getQualityProfile(tier).postprocessing).toBe(false);
    }
  });

  it("skips ground detail entirely on the lowest tier", () => {
    expect(getQualityProfile(0).groundDetailSize).toBe(0);
    expect(getQualityProfile(0).groundDetailRange).toBe(0);
  });

  it("keeps every texture size within the documented ceiling", () => {
    for (const tier of [0, 1, 2, 3] as const) {
      expect(getQualityProfile(tier).groundDetailSize).toBeLessThanOrEqual(4096);
      expect(getQualityProfile(tier).shadowMapSize).toBeLessThanOrEqual(2048);
    }
  });
});

describe("timeline visibility", () => {
  it("reads a year from a validated ISO date without constructing a Date", () => {
    expect(getObservedYear({ observedDate: "2025-09-13" })).toBe(2025);
    expect(getObservedYear({ observedDate: "2021-06-30" })).toBe(2021);
  });

  it("returns undefined for anything that is not an ISO date", () => {
    for (const observedDate of ["2025", "2025/09/13", "20250913", "abcd-09-13", ""]) {
      expect(getObservedYear({ observedDate })).toBeUndefined();
    }
    expect(getObservedYear({})).toBeUndefined();
  });

  it("derives its bounds from the dated records themselves", () => {
    expect(TIMELINE_BOUNDS.minYear).toBeLessThanOrEqual(TIMELINE_BOUNDS.maxYear);
    const years = STRUCTURES.map((structure) => getObservedYear(structure)).filter(
      (year): year is number => year !== undefined,
    );
    expect(Math.max(...years)).toBeLessThanOrEqual(TIMELINE_BOUNDS.maxYear);
    expect(Math.min(...years)).toBeGreaterThanOrEqual(TIMELINE_BOUNDS.minYear);
  });
});

describe("isSubjectDrawn", () => {
  it("requires both the evidence timeline and the evidence mode to admit a subject", () => {
    const runway = { id: "rwy-05-23" };
    // Now: the measured runway is observed, so even observed-only mode draws it.
    expect(isSubjectDrawn(runway, null, "observed")).toBe(true);
    // In 2021 it was reported, not yet observed: the scene it was measured from
    // is a 2025 scene, so observed-only mode does not draw it solid then.
    expect(isSubjectDrawn(runway, "2021-06-30", "observed")).toBe(false);
    expect(isSubjectDrawn(runway, "2021-06-30", "reported")).toBe(true);
    // Before the 2021 report nothing public establishes it.
    expect(isSubjectDrawn(runway, "2021-01-01", "full-simulation")).toBe(false);
    // Admitted by the timeline, withheld by the mode.
    const hangar = { id: "hangar-main" };
    expect(isSubjectDrawn(hangar, null, "reported")).toBe(false);
    expect(isSubjectDrawn(hangar, null, "interpretation")).toBe(true);
  });
});

describe("subjectDrawState", () => {
  it("outlines what today's model holds but was not publicly established then", () => {
    // Interpreted from the 2025-09-28 scene: a ghost before it, solid from it.
    expect(subjectDrawState("hangar-main", "2025-09-13", "full-simulation")).toBe(
      "ghost",
    );
    expect(subjectDrawState("hangar-main", "2025-09-28", "full-simulation")).toBe(
      "solid",
    );
    // Established by a 2025-09-13 image, identified in print on 2025-11-04.
    expect(
      subjectDrawState("west-fighter-shelters", "2025-09-28", "full-simulation"),
    ).toBe("ghost");
    expect(
      subjectDrawState("west-fighter-shelters", "2025-11-04", "full-simulation"),
    ).toBe("solid");
    // Illustrative content is never established at any date, so it is a ghost
    // in every past snapshot and solid only in the present.
    expect(subjectDrawState("solar-field", "2026-06-12", "full-simulation")).toBe(
      "ghost",
    );
    expect(subjectDrawState("solar-field", null, "full-simulation")).toBe("solid");
  });

  it("hides, rather than outlines, what the evidence mode withholds", () => {
    expect(subjectDrawState("solar-field", "2026-06-12", "interpretation")).toBe(
      "hidden",
    );
    expect(subjectDrawState("hangar-main", "2025-09-13", "reported")).toBe("hidden");
  });

  it("never draws a subject solid before evidence for it was public", () => {
    for (const date of TEMPORAL_SNAPSHOT_DATES) {
      for (const structure of STRUCTURES) {
        if (subjectDrawState(structure.id, date, "full-simulation") !== "solid") continue;
        const earliest = earliestKnowableDate(structure.id);
        expect(
          earliest !== undefined && earliest <= date,
          `${structure.id}@${date}`,
        ).toBe(true);
      }
    }
  });

  it("leaves scene dressing out of every past date", () => {
    expect(isSceneDressingVisible(null, "full-simulation")).toBe(true);
    expect(isSceneDressingVisible("2026-06-12", "full-simulation")).toBe(false);
    expect(isSceneDressingVisible(null, "interpretation")).toBe(false);
  });
});

describe("climatology", () => {
  it("holds twelve months", () => {
    expect(CLIMATE_MONTHS.length).toBe(12);
  });

  it("normalises any index into the twelve months", () => {
    expect(getClimateMonth(0).month).toBe("January");
    expect(getClimateMonth(11).month).toBe("December");
    expect(getClimateMonth(12).month).toBe("January");
    expect(getClimateMonth(-1).month).toBe("December");
    expect(getClimateMonth(25).month).toBe("February");
  });

  it("keeps the dust factor inside its documented band for every real month", () => {
    for (const month of CLIMATE_MONTHS) {
      const dust = climateDustFactor(month);
      expect(dust).toBeGreaterThanOrEqual(0.25);
      expect(dust).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic", () => {
    const june = getClimateMonth(5);
    expect(climateDustFactor(june)).toBe(climateDustFactor(june));
  });
});
