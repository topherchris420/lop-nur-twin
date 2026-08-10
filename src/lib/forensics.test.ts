import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_SUPPORT,
  DEFENSIBILITY_LEDGER,
  DEFENSIBILITY_LEVELS,
  MODELED_ATTRIBUTES,
  PROVE_IT_REPORT,
  formatArea,
  formatVolume,
  getDefensibility,
  hasDefensibleGeometry,
  proveItHeadline,
  retainedPercent,
  survivesProveIt,
} from "./forensics";
import {
  EVIDENCE_LEDGER,
  getEvidenceForSubject,
  strongestClassification,
} from "./evidence";
import { ALL_SEGMENTS, APRONS, STRUCTURES } from "./layout";

/**
 * The defensibility model is the one place in this project that says "no" on
 * the model's behalf, so the tests are about what it must never allow rather
 * than about its happy path. Three properties matter more than the rest:
 * nothing is promoted above its recorded classification, no attribute is
 * defended that the cited source does not carry, and the headline figures are
 * arithmetic over the ledger rather than numbers anyone typed.
 */

describe("attribute support table", () => {
  it("never defends height, form, material, function, interior or activity", () => {
    // These six are what a nadir scene and a news report cannot establish, and
    // they are what the reconstruction draws most confidently. If any of them
    // ever becomes true here it is a claim about the sources, not a UI change.
    for (const level of DEFENSIBILITY_LEVELS) {
      const support = ATTRIBUTE_SUPPORT[level];
      expect(support.height, level).toBe(false);
      expect(support.form, level).toBe(false);
      expect(support.material, level).toBe(false);
      expect(support.function, level).toBe(false);
      expect(support.interior, level).toBe(false);
      expect(support.activity, level).toBe(false);
    }
  });

  it("is monotonic: a weaker level never defends more than a stronger one", () => {
    for (let index = 1; index < DEFENSIBILITY_LEVELS.length; index += 1) {
      const stronger = ATTRIBUTE_SUPPORT[DEFENSIBILITY_LEVELS[index - 1]!];
      const weaker = ATTRIBUTE_SUPPORT[DEFENSIBILITY_LEVELS[index]!];
      for (const attribute of MODELED_ATTRIBUTES) {
        if (weaker[attribute]) expect(stronger[attribute], attribute).toBe(true);
      }
    }
  });

  it("only admits geometry where both position and extent are defended", () => {
    for (const level of DEFENSIBILITY_LEVELS) {
      const support = ATTRIBUTE_SUPPORT[level];
      expect(hasDefensibleGeometry(level)).toBe(support.position && support.extent);
    }
  });

  it("defends nothing at all at the undefended level", () => {
    for (const attribute of MODELED_ATTRIBUTES) {
      expect(ATTRIBUTE_SUPPORT.undefended[attribute], attribute).toBe(false);
    }
  });
});

describe("defensibility ledger", () => {
  it("covers every subject the scene draws geometry for, exactly once", () => {
    const expected = [
      ...STRUCTURES.map((structure) => structure.id),
      ...ALL_SEGMENTS.map((segment) => segment.id),
      ...APRONS.map((apron) => apron.id),
    ].sort();
    expect(DEFENSIBILITY_LEDGER.map((verdict) => verdict.subjectId)).toEqual(expected);
  });

  it("never promotes a subject above the classification the ledger records", () => {
    // The whole module reads the ledger; it must not out-rank it. An
    // interpreted footprint traced off a cited scene stays interpreted.
    for (const verdict of DEFENSIBILITY_LEDGER) {
      if (verdict.level === "observed-extent" || verdict.level === "measured") {
        const classifications = getEvidenceForSubject(verdict.subjectId).map(
          (record) => record.classification,
        );
        const promoted =
          classifications.length > 0 &&
          !classifications.includes("observed") &&
          !classifications.includes("reported");
        expect(
          promoted,
          `${verdict.subjectId} promoted from ${classifications.join("/")}`,
        ).toBe(false);
      }
    }
  });

  it("cites only sources that carry the surviving claim", () => {
    for (const verdict of DEFENSIBILITY_LEDGER) {
      if (verdict.level === "undefended") {
        expect(verdict.sourceIds, verdict.subjectId).toEqual([]);
      } else {
        expect(verdict.sourceIds.length, verdict.subjectId).toBeGreaterThan(0);
      }
      // Never the model's own name: procedural content is not evidence.
      expect(verdict.sourceIds).not.toContain("model-internal-definition");
    }
  });

  it("retains a footprint only where geometry is defensible", () => {
    for (const verdict of DEFENSIBILITY_LEDGER) {
      if (hasDefensibleGeometry(verdict.level)) {
        expect(verdict.retained.footprintAreaM2, verdict.subjectId).toBe(
          verdict.modeledFootprintM2,
        );
      } else {
        expect(verdict.retained.footprintAreaM2, verdict.subjectId).toBe(0);
      }
      expect(survivesProveIt(verdict.subjectId)).toBe(
        hasDefensibleGeometry(verdict.level),
      );
    }
  });

  it("splits defended and stripped attributes with no overlap and no gap", () => {
    for (const verdict of DEFENSIBILITY_LEDGER) {
      expect([...verdict.defended, ...verdict.stripped].sort()).toEqual(
        [...MODELED_ATTRIBUTES].sort(),
      );
    }
  });

  it("treats an unknown subject as having no verdict rather than a lenient one", () => {
    expect(getDefensibility("not-a-subject")).toBeUndefined();
    expect(survivesProveIt("not-a-subject")).toBe(false);
  });
});

describe("prove-it report", () => {
  it("retains no built volume, because no source states a height", () => {
    // The headline figure. It is zero by derivation — the report sums the
    // volume of subjects whose level defends height, and none does.
    expect(PROVE_IT_REPORT.retainedVolumeM3).toBe(0);
    expect(PROVE_IT_REPORT.modeledVolumeM3).toBeGreaterThan(0);
    expect(proveItHeadline()).toContain("0 m³");
  });

  it("agrees with the ledger it is computed from", () => {
    const surviving = DEFENSIBILITY_LEDGER.filter((verdict) =>
      hasDefensibleGeometry(verdict.level),
    );
    expect(PROVE_IT_REPORT.totalSubjects).toBe(DEFENSIBILITY_LEDGER.length);
    expect(PROVE_IT_REPORT.survivingSubjects).toBe(surviving.length);
    expect(PROVE_IT_REPORT.retainedFootprintM2).toBeCloseTo(
      surviving.reduce((total, verdict) => total + verdict.modeledFootprintM2, 0),
      6,
    );
    const levelTotal = DEFENSIBILITY_LEVELS.reduce(
      (total, level) => total + PROVE_IT_REPORT.byLevel[level],
      0,
    );
    expect(levelTotal).toBe(PROVE_IT_REPORT.totalSubjects);
  });

  it("counts assertions as subjects times attributes", () => {
    expect(PROVE_IT_REPORT.renderedAssertions).toBe(
      PROVE_IT_REPORT.totalSubjects * MODELED_ATTRIBUTES.length,
    );
    expect(PROVE_IT_REPORT.defendedAssertions).toBeLessThan(
      PROVE_IT_REPORT.renderedAssertions,
    );
    expect(PROVE_IT_REPORT.attributeCoverage).toHaveLength(MODELED_ATTRIBUTES.length);
    const coverageTotal = PROVE_IT_REPORT.attributeCoverage.reduce(
      (total, coverage) => total + coverage.defendedSubjects,
      0,
    );
    expect(coverageTotal).toBe(PROVE_IT_REPORT.defendedAssertions);
  });

  it("defends height for no subject at all", () => {
    const height = PROVE_IT_REPORT.attributeCoverage.find(
      (coverage) => coverage.attribute === "height",
    );
    expect(height?.defendedSubjects).toBe(0);
  });
});

describe("the ledger this all rests on", () => {
  it("states a height tolerance nowhere", () => {
    // If this ever fails, the PROVE IT headline stops being true and the
    // wording has to be revisited before the figure is. `evidenceValidation`
    // rejects a height tolerance without a stating source; this asserts the
    // stronger fact that today there is none at all.
    for (const record of EVIDENCE_LEDGER) {
      expect(record.uncertainty?.heightMeters, record.id).toBeUndefined();
    }
  });

  it("keeps a subject's strongest classification reachable", () => {
    for (const verdict of DEFENSIBILITY_LEDGER) {
      const records = getEvidenceForSubject(verdict.subjectId);
      if (records.length === 0) continue;
      expect(strongestClassification(records)).toBeDefined();
    }
  });
});

describe("presentation helpers", () => {
  it("prints zero as zero rather than as a small percentage", () => {
    expect(retainedPercent(0, 1000)).toBe("0");
    expect(retainedPercent(1, 1_000_000)).toBe("<0.1");
    expect(retainedPercent(500, 1000)).toBe("50.0");
    expect(retainedPercent(5, 0)).toBe("0");
  });

  it("groups areas and volumes without changing their magnitude", () => {
    expect(formatArea(1234567)).toBe("1,234,567 m²");
    expect(formatVolume(0)).toBe("0 m³");
  });
});
