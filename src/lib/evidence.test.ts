import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_SCALE,
  EVIDENCE_CLASSIFICATIONS,
  EVIDENCE_CLASSIFICATION_META,
  EVIDENCE_LEDGER,
  SUPPORTED_COORDINATE_REFERENCE_SYSTEMS,
  confidenceRank,
  evidenceClassificationCounts,
  formatConfidence,
  getEvidenceForSubject,
  getUncertaintyForSubject,
  isKnownEvidenceSubject,
  strongestClassification,
} from "./evidence";
import { validateEvidenceLedger } from "./evidenceValidation";
import {
  EVIDENCE_MODES,
  EVIDENCE_MODE_META,
  classesBelow,
  classificationsForMode,
  effectiveClassification,
  evidenceModeCounts,
  isSubjectVisible,
  parseEvidenceMode,
} from "./evidenceMode";
import { ALL_SEGMENTS, APRONS, RUNWAYS, STRUCTURES } from "./layout";
import {
  UNCERTAINTY_LEVELS,
  formatTemporalBound,
  formatUncertainty,
  hasNumericUncertainty,
  uncertaintyRadiusM,
} from "./uncertainty";

const FILTERABLE = [
  ...STRUCTURES.map((structure) => structure.id),
  ...ALL_SEGMENTS.map((segment) => segment.id),
  ...APRONS.map((apron) => apron.id),
];

describe("the shipped ledger", () => {
  it("validates cleanly", () => {
    const { errors } = validateEvidenceLedger(EVIDENCE_LEDGER);
    expect(errors).toEqual([]);
  });

  it("is sorted by record id, so every consumer sees the same order", () => {
    const ids = EVIDENCE_LEDGER.map((record) => record.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("covers every structure", () => {
    for (const structure of STRUCTURES) {
      expect(getEvidenceForSubject(structure.id).length).toBeGreaterThan(0);
    }
  });

  it("points every record at a subject the model contains", () => {
    for (const record of EVIDENCE_LEDGER) {
      expect(isKnownEvidenceSubject(record.subjectId)).toBe(true);
    }
  });

  it("emits only the three documented confidence values", () => {
    const allowed = new Set(Object.values(CONFIDENCE_SCALE));
    for (const record of EVIDENCE_LEDGER) {
      expect(allowed.has(record.confidence)).toBe(true);
    }
  });

  it("uses only coordinate reference systems the project registers to", () => {
    const supported = new Set<string>(SUPPORTED_COORDINATE_REFERENCE_SYSTEMS);
    for (const record of EVIDENCE_LEDGER) {
      if (record.coordinateReferenceSystem === undefined) continue;
      expect(supported.has(record.coordinateReferenceSystem)).toBe(true);
    }
  });

  it("counts classifications to the ledger size", () => {
    const counts = evidenceClassificationCounts();
    const total = EVIDENCE_CLASSIFICATIONS.reduce(
      (sum, classification) => sum + counts[classification],
      0,
    );
    expect(total).toBe(EVIDENCE_LEDGER.length);
  });
});

describe("confidence", () => {
  it("maps a stored number back to its rank", () => {
    expect(confidenceRank(CONFIDENCE_SCALE.high)).toBe("high");
    expect(confidenceRank(CONFIDENCE_SCALE.medium)).toBe("medium");
    expect(confidenceRank(CONFIDENCE_SCALE.low)).toBe("low");
    expect(confidenceRank(0)).toBe("unrated");
    expect(confidenceRank(0.29)).toBe("unrated");
  });

  it("renders as a number and a word, never a bar", () => {
    expect(formatConfidence(0.55)).toBe("0.55 (medium)");
    expect(formatConfidence(0.8)).toBe("0.80 (high)");
  });
});

describe("strongestClassification", () => {
  it("ranks observed above reported above interpreted above illustrative", () => {
    const record = (classification: (typeof EVIDENCE_CLASSIFICATIONS)[number]) =>
      ({ classification }) as Parameters<typeof strongestClassification>[0][number];
    expect(strongestClassification([record("illustrative"), record("observed")])).toBe(
      "observed",
    );
    expect(strongestClassification([record("interpreted"), record("reported")])).toBe(
      "reported",
    );
    expect(strongestClassification([record("illustrative")])).toBe("illustrative");
  });

  it("returns undefined for no records", () => {
    expect(strongestClassification([])).toBeUndefined();
  });
});

describe("evidence classification metadata", () => {
  it("pairs every classification with a distinct glyph and a word", () => {
    const glyphs = new Set<string>();
    for (const classification of EVIDENCE_CLASSIFICATIONS) {
      const meta = EVIDENCE_CLASSIFICATION_META[classification];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.glyph.length).toBeGreaterThan(0);
      // A shared glyph would make two statuses indistinguishable in greyscale,
      // which is the exact failure the glyphs exist to prevent.
      expect(glyphs.has(meta.glyph)).toBe(false);
      glyphs.add(meta.glyph);
    }
  });
});

describe("evidence modes", () => {
  it("are strictly nested, so stepping down always shows less", () => {
    for (let index = 1; index < EVIDENCE_MODES.length; index += 1) {
      const narrower = classificationsForMode(EVIDENCE_MODES[index - 1]!);
      const wider = classificationsForMode(EVIDENCE_MODES[index]!);
      expect(wider.size).toBeGreaterThan(narrower.size);
      for (const classification of narrower) {
        expect(wider.has(classification)).toBe(true);
      }
    }
  });

  it("admit exactly the classifications each mode declares", () => {
    expect([...classificationsForMode("observed")]).toEqual(["observed"]);
    expect([...classificationsForMode("full-simulation")].sort()).toEqual(
      [...EVIDENCE_CLASSIFICATIONS].sort(),
    );
  });

  it("report the classifications they exclude", () => {
    expect(classesBelow("observed")).toEqual(["reported", "interpreted", "illustrative"]);
    expect(classesBelow("full-simulation")).toEqual([]);
  });

  it("show every modeled subject in full simulation and fewer in every other mode", () => {
    const full = evidenceModeCounts(FILTERABLE, "full-simulation");
    expect(full.visible).toBe(FILTERABLE.length);
    expect(full.hidden).toBe(0);

    let previous = 0;
    for (const mode of EVIDENCE_MODES) {
      const counts = evidenceModeCounts(FILTERABLE, mode);
      // Monotonic: each mode admits at least as much as the one before it.
      expect(counts.visible).toBeGreaterThanOrEqual(previous);
      previous = counts.visible;
    }
  });

  it("keeps the runway visible in observed mode through its measurement records", () => {
    // The runway's own pavement records are classified reported. The published
    // measurements taken off it are observed, and the link between them is what
    // stops the one measured piece of geometry from vanishing.
    const runwayId = RUNWAYS[0]!.id;
    expect(effectiveClassification(runwayId)).toBe("observed");
    expect(isSubjectVisible(runwayId, "observed")).toBe(true);
  });

  it("withholds illustrative content until full simulation", () => {
    expect(isSubjectVisible("solar-field", "interpretation")).toBe(false);
    expect(isSubjectVisible("solar-field", "full-simulation")).toBe(true);
  });

  it("withholds interpreted structures below interpretation mode", () => {
    expect(effectiveClassification("hangar-main")).toBe("interpreted");
    expect(isSubjectVisible("hangar-main", "reported")).toBe(false);
    expect(isSubjectVisible("hangar-main", "interpretation")).toBe(true);
  });

  it("never filters the canvas subjects", () => {
    for (const mode of EVIDENCE_MODES) {
      expect(isSubjectVisible("terrain-site-surface", mode)).toBe(true);
      expect(isSubjectVisible("environment-climatology", mode)).toBe(true);
    }
  });

  it("narrows an untrusted string", () => {
    expect(parseEvidenceMode("observed")).toBe("observed");
    expect(parseEvidenceMode("Observed")).toBeNull();
    expect(parseEvidenceMode("constructor")).toBeNull();
    expect(parseEvidenceMode(42)).toBeNull();
    expect(parseEvidenceMode(undefined)).toBeNull();
  });

  it("pairs every mode with a distinct glyph", () => {
    const glyphs = new Set(EVIDENCE_MODES.map((mode) => EVIDENCE_MODE_META[mode].glyph));
    expect(glyphs.size).toBe(EVIDENCE_MODES.length);
  });
});

describe("uncertainty envelopes", () => {
  it("give every non-illustrative claim an envelope", () => {
    for (const record of EVIDENCE_LEDGER) {
      if (record.classification === "illustrative") continue;
      expect(record.uncertainty).toBeDefined();
    }
  });

  it("never state a height or orientation tolerance, because none is documented", () => {
    for (const record of EVIDENCE_LEDGER) {
      expect(record.uncertainty?.heightMeters).toBeUndefined();
      expect(record.uncertainty?.orientationDegrees).toBeUndefined();
    }
  });

  it("always document a method and a basis alongside a number", () => {
    for (const record of EVIDENCE_LEDGER) {
      const envelope = record.uncertainty;
      if (envelope === undefined || !hasNumericUncertainty(envelope)) continue;
      expect(envelope.method).toBeTruthy();
      expect(envelope.basis).toBeTruthy();
    }
  });

  it("never claim a known identity for interpreted or illustrative content", () => {
    for (const record of EVIDENCE_LEDGER) {
      if (record.classification === "observed" || record.classification === "reported") {
        continue;
      }
      expect(record.uncertainty?.identification).not.toBe("known");
      expect(record.uncertainty?.function).not.toBe("known");
    }
  });

  it("record function as unknown for anything established only by imagery", () => {
    // Overhead imagery establishes that something is there and nothing about
    // what happens inside it.
    for (const record of EVIDENCE_LEDGER) {
      if (record.classification !== "observed") continue;
      expect(record.uncertainty?.function).toBe("unknown");
    }
  });

  it("bound the late end of a date range and leave the early end unknown", () => {
    for (const record of EVIDENCE_LEDGER) {
      const envelope = record.uncertainty;
      if (envelope?.latestDate === undefined) continue;
      // Every temporal bound in this model comes from a first observation,
      // which says nothing about when something started existing.
      expect(envelope.earliestDate).toBeUndefined();
    }
  });

  it("merge to the widest envelope across a subject's records", () => {
    const merged = getUncertaintyForSubject("measurement-runway-length");
    expect(merged).toBeDefined();
    // One record states ±40 m, the other states nothing. The merge must keep the
    // number rather than letting a second citation erase it.
    expect(merged?.horizontalMeters).toBe(40);
  });

  it("returns undefined for a subject with no records", () => {
    expect(getUncertaintyForSubject("not-a-subject")).toBeUndefined();
  });

  it("prints an absent figure as not stated rather than as zero", () => {
    expect(
      formatUncertainty({
        identification: "unknown",
        function: "unknown",
        sourceIds: [],
      }),
    ).toBe("not stated");
    expect(
      formatUncertainty({
        horizontalMeters: 40,
        footprintMeters: 10,
        identification: "known",
        function: "unknown",
        sourceIds: [],
      }),
    ).toBe("±40 m position; 10 m footprint floor");
  });

  it("says which end of a temporal range is known", () => {
    expect(
      formatTemporalBound({
        latestDate: "2025-09-13",
        identification: "probable",
        function: "possible",
        sourceIds: [],
      }),
    ).toBe("existed by 2025-09-13; earliest date unknown");
    expect(
      formatTemporalBound({
        identification: "unknown",
        function: "unknown",
        sourceIds: [],
      }),
    ).toBe("not stated");
  });

  it("offers a spatial radius only where a distance is documented", () => {
    expect(
      uncertaintyRadiusM({
        identification: "unknown",
        function: "unknown",
        sourceIds: [],
      }),
    ).toBeUndefined();
    expect(
      uncertaintyRadiusM({
        horizontalMeters: 40,
        footprintMeters: 10,
        identification: "known",
        function: "unknown",
        sourceIds: [],
      }),
    ).toBe(40);
  });

  it("orders its levels from most to least established", () => {
    expect(UNCERTAINTY_LEVELS).toEqual(["known", "probable", "possible", "unknown"]);
  });
});
