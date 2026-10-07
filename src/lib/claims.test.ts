import { describe, expect, it } from "vitest";
import { inspectClaim } from "./claims";
import { getEvidenceForSubject, strongestClassification } from "./evidence";
import { STRUCTURES } from "./layout";
import { TEMPORAL_SNAPSHOT_DATES } from "./temporal";

describe("inspectClaim", () => {
  it("answers for every structure from the ledger's own classification", () => {
    for (const structure of STRUCTURES) {
      const claim = inspectClaim(structure.id);
      expect(claim, structure.id).toBeDefined();
      expect(claim?.classification).toBe(
        strongestClassification(getEvidenceForSubject(structure.id)),
      );
      expect(claim?.support.length).toBe(getEvidenceForSubject(structure.id).length);
    }
  });

  it("returns nothing for a subject the ledger does not know", () => {
    expect(inspectClaim("not-a-subject")).toBeUndefined();
  });

  it("never claims more than the classification allows", () => {
    // Interpreted: the identity was assigned here, so the evidence establishes
    // nothing outright.
    expect(inspectClaim("hangar-main")?.establishes).toEqual([
      "Nothing outright. No cited source shows or states this identity; the project assigned it.",
    ]);
    // Reported: the evidence establishes that a publication says so, by name.
    const shelters = inspectClaim("west-fighter-shelters");
    expect(shelters?.establishes.join(" ")).toContain("The War Zone");
    expect(shelters?.establishes.join(" ")).toContain("National Security Journal");
    // Illustrative: nothing at all.
    expect(inspectClaim("solar-field")?.establishes).toEqual([
      "Nothing. It is not resolved in any cited source.",
    ]);
  });

  it("reports what is undocumented as unknown, never as a figure", () => {
    for (const structure of STRUCTURES) {
      const unknown = inspectClaim(structure.id)?.unknown ?? [];
      expect(unknown, structure.id).toContain("Height tolerance: not stated.");
      expect(unknown, structure.id).toContain("Orientation tolerance: not stated.");
      expect(unknown, structure.id).toContain(
        "Interior use and occupancy: overhead imagery never establishes them.",
      );
    }
  });

  it("keeps the three dates apart and never invents a model-entry date", () => {
    const claim = inspectClaim("west-fighter-shelters");
    expect(claim?.dates.siteEvent).toBe("existed by 2025-09-13; earliest date unknown");
    expect(claim?.dates.firstPublished).toBe("2025-11-04");
    expect(claim?.dates.knowableFrom).toBe("2025-11-04");
    expect(claim?.dates.modelEntry).toBe("not recorded");
  });

  it("cites a method reference as a method, never as support", () => {
    const claim = inspectClaim("hangar-main");
    expect(claim?.support.map((support) => support.sourceId)).not.toContain(
      "sentinel-2-handbook",
    );
    expect(claim?.methodReferences.map((reference) => reference.sourceId)).toEqual([
      "sentinel-2-handbook",
    ]);
  });

  it("says what could be said on a timeline date, and calls hindsight hindsight", () => {
    expect(inspectClaim("west-fighter-shelters", "2025-09-28")?.atDate?.standing).toBe(
      "established-not-yet-public",
    );
    expect(inspectClaim("west-fighter-shelters", "2025-11-04")?.atDate?.standing).toBe(
      "publicly-established",
    );
    expect(inspectClaim("hangar-main", "2021-06-30")?.atDate?.standing).toBe(
      "not-yet-evidenced",
    );
    for (const date of TEMPORAL_SNAPSHOT_DATES) {
      expect(inspectClaim("solar-field", date)?.atDate?.standing).toBe("undated");
    }
    expect(inspectClaim("hangar-main")?.atDate).toBeUndefined();
  });

  it("uses no word that asserts verification", () => {
    for (const structure of STRUCTURES) {
      const claim = inspectClaim(structure.id, "2025-09-28");
      const generated = [
        ...(claim?.establishes ?? []),
        ...(claim?.infers ?? []),
        ...(claim?.unknown ?? []),
        claim?.atDate?.statement ?? "",
      ].join(" ");
      expect(generated, structure.id).not.toMatch(/\b(verified|confirmed|official)\b/i);
    }
  });

  it("gives illustrative content no evidence date, though it names a dated scene", () => {
    for (const structure of STRUCTURES) {
      const claim = inspectClaim(structure.id);
      if (claim?.classification !== "illustrative") continue;
      expect(claim.dates.firstPublished, structure.id).toBeUndefined();
      expect(claim.dates.knowableFrom, structure.id).toBeUndefined();
    }
    expect(inspectClaim("solar-field")?.classification).toBe("illustrative");
  });
});
