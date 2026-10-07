import { describe, expect, it } from "vitest";
import { EVIDENCE_CLASSIFICATIONS } from "./evidence";
import { EVIDENCE_MODES } from "./evidenceMode";
import { subjectDrawState, subjectLensClassification } from "./drawState";
import {
  IDENTIFICATION_DASH,
  LENS_PALETTE,
  LENS_PAVEMENT_IDS,
  LENS_STRUCTURE_IDS,
  describeLens,
  lensTally,
} from "./evidenceLens";
import { ALL_SEGMENTS, APRONS, STRUCTURES } from "./layout";
import { TEMPORAL_SNAPSHOT_DATES } from "./temporal";

describe("subjectLensClassification", () => {
  it("paints today's strongest classification, and only what is drawn solid", () => {
    expect(subjectLensClassification("hangar-main", null, "full-simulation")).toBe(
      "interpreted",
    );
    expect(subjectLensClassification("solar-field", null, "full-simulation")).toBe(
      "illustrative",
    );
    // The runway is the one piece of geometry the project measured off a cited
    // scene: its measurement is observed, so the runway paints observed.
    expect(subjectLensClassification("rwy-05-23", null, "observed")).toBe("observed");
    // Withheld by the mode: nothing to paint.
    expect(
      subjectLensClassification("solar-field", null, "interpretation"),
    ).toBeUndefined();
  });

  it("paints the classification that was knowable on a past date, never today's", () => {
    // Reported by the June 2021 article; observed only once the 2025 scene it
    // was measured from was public.
    expect(subjectLensClassification("rwy-05-23", "2021-06-30", "full-simulation")).toBe(
      "reported",
    );
    expect(subjectLensClassification("rwy-05-23", "2025-09-28", "full-simulation")).toBe(
      "observed",
    );
    // A ghost is an outline, not a colour: nothing was knowable about it then.
    expect(subjectDrawState("solar-field", "2021-06-30", "full-simulation")).toBe(
      "ghost",
    );
    expect(
      subjectLensClassification("solar-field", "2021-06-30", "full-simulation"),
    ).toBeUndefined();
  });

  it("never paints a class the mode would not admit", () => {
    for (const date of [null, ...TEMPORAL_SNAPSHOT_DATES]) {
      for (const mode of EVIDENCE_MODES) {
        for (const id of [...LENS_STRUCTURE_IDS, ...LENS_PAVEMENT_IDS]) {
          const painted = subjectLensClassification(id, date, mode);
          if (painted === undefined) continue;
          expect(subjectDrawState(id, date, mode), `${id}@${date} in ${mode}`).toBe(
            "solid",
          );
          expect(
            mode === "observed"
              ? painted === "observed"
              : mode === "reported"
                ? painted !== "interpreted" && painted !== "illustrative"
                : mode === "interpretation"
                  ? painted !== "illustrative"
                  : true,
            `${id}@${date} painted ${painted} in ${mode}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("the lens palette", () => {
  it("gives every classification a colour, the badge's glyph and a line pattern", () => {
    const glyphs = new Set<string>();
    const colors = new Set<string>();
    for (const classification of EVIDENCE_CLASSIFICATIONS) {
      const entry = LENS_PALETTE[classification];
      expect(entry.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(entry.glyph.length).toBeGreaterThan(0);
      glyphs.add(entry.glyph);
      colors.add(entry.color);
    }
    expect(glyphs.size).toBe(EVIDENCE_CLASSIFICATIONS.length);
    expect(colors.size).toBe(EVIDENCE_CLASSIFICATIONS.length);
  });

  it("breaks the line further the weaker the class, and only observed is solid", () => {
    expect(LENS_PALETTE.observed.dash).toEqual([]);
    expect(LENS_PALETTE.reported.dash).toEqual(IDENTIFICATION_DASH.probable);
    expect(LENS_PALETTE.interpreted.dash).toEqual(IDENTIFICATION_DASH.possible);
    expect(LENS_PALETTE.illustrative.dash).toEqual(IDENTIFICATION_DASH.unknown);
    const dashShare = (dash: readonly number[]) =>
      dash.length === 0 ? 1 : dash[0]! / (dash[0]! + dash[1]!);
    expect(dashShare(LENS_PALETTE.reported.dash)).toBeLessThan(dashShare([]));
    expect(dashShare(LENS_PALETTE.interpreted.dash)).toBeLessThan(
      dashShare(LENS_PALETTE.reported.dash),
    );
    expect(dashShare(LENS_PALETTE.illustrative.dash)).toBeLessThan(
      dashShare(LENS_PALETTE.interpreted.dash),
    );
  });
});

describe("lensTally", () => {
  it("counts every structure and pavement exactly once", () => {
    expect(LENS_STRUCTURE_IDS).toHaveLength(STRUCTURES.length);
    expect(LENS_PAVEMENT_IDS).toHaveLength(ALL_SEGMENTS.length + APRONS.length);
    for (const date of [null, ...TEMPORAL_SNAPSHOT_DATES]) {
      for (const mode of EVIDENCE_MODES) {
        const tally = lensTally(date, mode);
        for (const group of [tally.structures, tally.pavements]) {
          const painted = EVIDENCE_CLASSIFICATIONS.reduce(
            (sum, classification) => sum + group.painted[classification],
            0,
          );
          expect(painted + group.outlined + group.withheld).toBe(group.total);
        }
      }
    }
  });

  it("paints nothing observed among the structures: no building is observed, by design", () => {
    // The only observed claims in the model are the runway measurements.
    const tally = lensTally(null, "full-simulation");
    expect(tally.structures.painted.observed).toBe(0);
    expect(tally.pavements.painted.observed).toBe(1);
    expect(tally.structures.outlined).toBe(0);
    expect(tally.structures.withheld).toBe(0);
  });

  it("moves paint to outline as the timeline steps back, never to a stronger class", () => {
    const now = lensTally(null, "full-simulation");
    const then = lensTally("2021-06-30", "full-simulation");
    expect(then.structures.outlined).toBeGreaterThan(now.structures.outlined);
    expect(then.structures.painted.reported + then.structures.painted.interpreted).toBe(
      0,
    );
    // Observed-only mode withholds every structure today.
    expect(lensTally(null, "observed").structures.withheld).toBe(STRUCTURES.length);
  });
});

describe("describeLens", () => {
  it("says what is painted, outlined and withheld, in counts", () => {
    const today = describeLens(lensTally(null, "full-simulation"), null);
    expect(today).toMatch(
      /^Painted by status today — \d+ structures: 0 observed, \d+ reported, \d+ interpreted, \d+ illustrative; \d+ pavements: 1 observed, \d+ reported, \d+ interpreted, \d+ illustrative\./,
    );
    expect(today).not.toMatch(/outlined|withheld/);
    const then = describeLens(lensTally("2021-06-30", "full-simulation"), "2021-06-30");
    expect(then).toMatch(/^Painted by the status knowable on 2021-06-30 — /);
    expect(then).toMatch(/\d+ outlined: not yet established then\./);
    const narrowed = describeLens(lensTally(null, "observed"), null);
    expect(narrowed).toMatch(/\d+ withheld by the evidence mode\./);
  });
});
