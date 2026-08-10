import { describe, expect, it } from "vitest";
import {
  isSubjectDrawn,
  subjectPresentation,
  type ForensicViewState,
} from "./sceneVisibility";
import { scrubStateAtDay, SCRUB_SPAN_DAYS } from "./timeScrubber";
import { ALL_SEGMENTS, APRONS, STRUCTURES, TIMELINE_BOUNDS } from "./layout";
import { EVIDENCE_MODES } from "./evidenceMode";
import { XRAY_LAYERS, XRAY_MODES } from "./xray";
import { survivesProveIt } from "./forensics";

/**
 * The composer is where six independent filters meet, and the invariant that
 * makes it safe is that every stage may only weaken. If any combination of
 * controls could make a subject look better supported than the ledger says it
 * is, the whole interface becomes a way to mislead yourself — so that is what
 * these tests hold it to.
 */

const BASE: ForensicViewState = {
  timelineYear: TIMELINE_BOUNDS.maxYear,
  evidenceMode: "full-simulation",
  xrayMode: "off",
  xrayFocus: null,
  proveIt: false,
  scrubDay: null,
  referenceOnly: false,
};

const SUBJECT = STRUCTURES[0]!;

describe("the default view", () => {
  it("draws the full reconstruction, solid", () => {
    for (const structure of STRUCTURES) {
      const presentation = subjectPresentation(structure, BASE, null);
      expect(presentation.visible, structure.id).toBe(true);
      expect(presentation.body, structure.id).toBe("solid");
      expect(presentation.liftM, structure.id).toBe(0);
      expect(presentation.opacity, structure.id).toBe(1);
      expect(presentation.dissolve, structure.id).toBe(0);
    }
  });

  it("always explains why a subject looks the way it does", () => {
    for (const mode of EVIDENCE_MODES) {
      for (const xrayMode of XRAY_MODES) {
        const presentation = subjectPresentation(
          SUBJECT,
          { ...BASE, evidenceMode: mode, xrayMode },
          null,
        );
        expect(presentation.reason.length).toBeGreaterThan(20);
      }
    }
  });
});

describe("PROVE IT", () => {
  it("draws only subjects whose geometry a cited source defends", () => {
    for (const structure of STRUCTURES) {
      const presentation = subjectPresentation(
        structure,
        { ...BASE, proveIt: true },
        null,
      );
      expect(presentation.visible, structure.id).toBe(survivesProveIt(structure.id));
      expect(presentation.defensible, structure.id).toBe(survivesProveIt(structure.id));
    }
  });

  it("overrides the appearance controls rather than composing with them", () => {
    // What is left is the point of the mode, not how it looks. A surviving
    // subject is drawn plainly even under stratified X-ray.
    const surviving = STRUCTURES.filter((structure) => survivesProveIt(structure.id));
    for (const structure of surviving) {
      const presentation = subjectPresentation(
        structure,
        { ...BASE, proveIt: true, xrayMode: "stratified", xrayFocus: "illustrative" },
        null,
      );
      expect(presentation.body).toBe("solid");
      expect(presentation.liftM).toBe(0);
    }
  });

  it("names the verdict when it removes something", () => {
    const removed = STRUCTURES.find((structure) => !survivesProveIt(structure.id));
    expect(removed).toBeDefined();
    const presentation = subjectPresentation(removed!, { ...BASE, proveIt: true }, null);
    expect(presentation.reason).toContain("Removed by PROVE IT");
  });

  it("beats the scrubber, because the two questions are independent", () => {
    const removed = STRUCTURES.find((structure) => !survivesProveIt(structure.id))!;
    const presentation = subjectPresentation(
      removed,
      { ...BASE, proveIt: true, scrubDay: SCRUB_SPAN_DAYS },
      scrubStateAtDay(SCRUB_SPAN_DAYS),
    );
    expect(presentation.visible).toBe(false);
  });
});

describe("reference-only", () => {
  it("stands the whole model aside so the evidence can be seen unmodeled", () => {
    for (const structure of STRUCTURES) {
      const presentation = subjectPresentation(
        structure,
        { ...BASE, referenceOnly: true },
        null,
      );
      expect(presentation.visible, structure.id).toBe(false);
    }
  });
});

describe("the time scrubber", () => {
  it("keeps undated subjects drawn, but never as though their date were known", () => {
    const state = scrubStateAtDay(0);
    for (const structure of STRUCTURES) {
      const presentation = subjectPresentation(
        structure,
        { ...BASE, scrubDay: 0 },
        state,
      );
      if (presentation.presence === "undated") {
        // Popping an undated subject in on a chosen date would be a claim.
        expect(presentation.visible, structure.id).toBe(true);
        expect(presentation.body, structure.id).toBe("ghost");
      }
    }
  });

  it("ghosts rather than hides what is not yet evidenced", () => {
    const state = scrubStateAtDay(0);
    const notYet = STRUCTURES.filter(
      (structure) =>
        subjectPresentation(structure, { ...BASE, scrubDay: 0 }, state).presence ===
        "not-yet-evidenced",
    );
    for (const structure of notYet) {
      const presentation = subjectPresentation(
        structure,
        { ...BASE, scrubDay: 0 },
        state,
      );
      expect(presentation.body, structure.id).toBe("ghost");
      expect(presentation.opacity, structure.id).toBeLessThan(0.3);
    }
  });

  it("reports everything as established when the scrubber is parked", () => {
    for (const structure of STRUCTURES) {
      expect(subjectPresentation(structure, BASE, null).presence).toBe("established");
    }
  });
});

describe("pavement is not exempt", () => {
  // Roads, strips, taxiways and aprons are classified by the same ledger as the
  // buildings. A treatment that only reached structures would leave an
  // illustrative street looking exactly as certain as the measured runway,
  // which is the failure X-ray exists to prevent — and it would be invisible,
  // because the pavement would simply keep rendering as it always had.
  const pavement = [...ALL_SEGMENTS, ...APRONS];

  it("resolves to a ghost body under X-ray, exactly as structures do", () => {
    const ghosted = pavement.filter(
      (subject) =>
        subjectPresentation(subject, { ...BASE, xrayMode: "ghost" }, null).body ===
        "ghost",
    );
    expect(ghosted.length).toBeGreaterThan(0);
  });

  it("lifts with its own stratum, not with the buildings' one", () => {
    for (const subject of pavement) {
      const presentation = subjectPresentation(
        subject,
        { ...BASE, xrayMode: "stratified" },
        null,
      );
      if (!presentation.visible) continue;
      expect(presentation.liftM, subject.id).toBe(
        XRAY_LAYERS[presentation.classification].liftM,
      );
    }
  });

  it("is removed by PROVE IT unless a cited source defends it", () => {
    for (const subject of pavement) {
      expect(
        subjectPresentation(subject, { ...BASE, proveIt: true }, null).visible,
        subject.id,
      ).toBe(survivesProveIt(subject.id));
    }
  });
});

describe("stage ordering", () => {
  it("only ever weakens: no control makes a subject more solid", () => {
    // The strongest possible presentation is the default. Every other
    // combination must be the same or weaker on each channel.
    for (const structure of STRUCTURES) {
      const strongest = subjectPresentation(structure, BASE, null);
      for (const evidenceMode of EVIDENCE_MODES) {
        for (const xrayMode of XRAY_MODES) {
          const presentation = subjectPresentation(
            structure,
            { ...BASE, evidenceMode, xrayMode },
            null,
          );
          if (!presentation.visible) continue;
          expect(presentation.opacity, structure.id).toBeLessThanOrEqual(
            strongest.opacity,
          );
          expect(presentation.dissolve, structure.id).toBeGreaterThanOrEqual(
            strongest.dissolve,
          );
        }
      }
    }
  });

  it("hides anything the timeline year has not reached", () => {
    const dated = STRUCTURES.find((structure) => structure.observedDate !== undefined);
    expect(dated).toBeDefined();
    const presentation = subjectPresentation(
      dated!,
      { ...BASE, timelineYear: TIMELINE_BOUNDS.minYear },
      null,
    );
    expect(presentation.visible).toBe(false);
    expect(presentation.reason).toContain("timeline year");
  });

  it("agrees with the boolean predicate the ruler and minimap use", () => {
    for (const structure of STRUCTURES) {
      for (const evidenceMode of EVIDENCE_MODES) {
        const state = { ...BASE, evidenceMode };
        expect(subjectPresentation(structure, state, null).visible, structure.id).toBe(
          isSubjectDrawn(structure, state.timelineYear, evidenceMode),
        );
      }
    }
  });
});
