import { describe, expect, it } from "vitest";
import {
  TEMPORAL_EVENT_CATEGORIES,
  TEMPORAL_LEDGER,
  TEMPORAL_SCOPES,
  TEMPORAL_SNAPSHOT_DATES,
  compareSnapshots,
  deriveSnapshot,
  isIsoDate,
  snapshotEstablishedCount,
  temporalCoverageGaps,
  temporalEventsForSubject,
} from "./temporal";
import { PUBLIC_SOURCES } from "./siteData";

/** Two dates with real evidence between them: the 2021 report and the 2025 scene. */
const EARLY = "2021-06-30";
const LATE = "2025-09-28";

describe("isIsoDate", () => {
  it("accepts a real calendar date", () => {
    expect(isIsoDate("2025-09-13")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
  });

  it("rejects a date that does not exist rather than rolling it forward", () => {
    expect(isIsoDate("2025-02-30")).toBe(false);
    expect(isIsoDate("2023-02-29")).toBe(false);
    expect(isIsoDate("2025-13-01")).toBe(false);
  });

  it("rejects anything that is not an ISO calendar date", () => {
    for (const value of ["2025", "late 2025", "13/09/2025", "", null, 20250913]) {
      expect(isIsoDate(value)).toBe(false);
    }
  });
});

describe("the temporal ledger", () => {
  it("is deterministically ordered: by date, undated last, ties on id", () => {
    const keys = TEMPORAL_LEDGER.map(
      (event) => `${event.latestDate ?? "9999-12-31"}|${event.id}`,
    );
    expect(keys).toEqual([...keys].sort());
  });

  it("gives every event a unique id", () => {
    const ids = new Set(TEMPORAL_LEDGER.map((event) => event.id));
    expect(ids.size).toBe(TEMPORAL_LEDGER.length);
  });

  it("uses only declared categories and scopes", () => {
    for (const event of TEMPORAL_LEDGER) {
      expect(TEMPORAL_EVENT_CATEGORIES).toContain(event.category);
      expect(TEMPORAL_SCOPES).toContain(event.scope);
    }
  });

  it("never invents a date", () => {
    for (const event of TEMPORAL_LEDGER) {
      for (const date of [
        event.earliestDate,
        event.latestDate,
        event.bestSupportedDate,
        event.publicationDate,
      ]) {
        if (date === undefined) continue;
        expect(isIsoDate(date)).toBe(true);
      }
    }
  });

  it("leaves the early bound of a site claim unknown", () => {
    // Seeing something in a scene proves it existed by that date and says
    // nothing about when it started existing.
    for (const event of TEMPORAL_LEDGER) {
      if (event.scope !== "real-site-claim") continue;
      expect(event.earliestDate).toBeUndefined();
      expect(event.bestSupportedDate).toBeUndefined();
    }
  });

  it("pins a publication date exactly, at both ends", () => {
    for (const event of TEMPORAL_LEDGER) {
      if (event.category !== "evidence-publication") continue;
      expect(event.earliestDate).toBe(event.latestDate);
      expect(event.bestSupportedDate).toBe(event.latestDate);
      expect(event.scope).toBe("evidence-availability");
    }
  });

  it("keeps model-only events out of the site's history entirely", () => {
    const modelOnly = TEMPORAL_LEDGER.filter(
      (event) => event.scope === "model-only-change",
    );
    expect(modelOnly.length).toBeGreaterThan(0);
    for (const event of modelOnly) {
      expect(event.latestDate).toBeUndefined();
      expect(event.earliestDate).toBeUndefined();
      expect(event.evidenceClass).toBe("illustrative");
    }
  });

  it("records no model-entry version, because the repository does not track one", () => {
    for (const event of TEMPORAL_LEDGER) {
      expect(event.modelVersionIntroduced).toBeUndefined();
    }
  });

  it("has one publication event per dated source", () => {
    const dated = PUBLIC_SOURCES.filter((source) => source.publishedOn !== undefined);
    const events = TEMPORAL_LEDGER.filter(
      (event) => event.category === "evidence-publication",
    );
    expect(events.length).toBe(dated.length);
  });

  it("classes a dated aircraft as a sighting, not a construction event", () => {
    const events = temporalEventsForSubject("j36-prototype");
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.category === "reported-aircraft-sighting")).toBe(
      true,
    );
    expect(events[0]?.after).toMatch(/no presence is asserted on any other date/i);
  });

  it("reports the categories the schema defines and holds no evidence for", () => {
    const gaps = temporalCoverageGaps();
    // These have no evidence in this repository and are shown as gaps rather
    // than filled with plausible history.
    expect(gaps).toContain("structure-removed");
    expect(gaps).toContain("reclassification");
    expect(gaps).toContain("correction-or-withdrawal");
    for (const gap of gaps) {
      expect(TEMPORAL_LEDGER.some((event) => event.category === gap)).toBe(false);
    }
  });

  it("offers at least two snapshot dates to compare", () => {
    expect(TEMPORAL_SNAPSHOT_DATES.length).toBeGreaterThanOrEqual(2);
    expect(TEMPORAL_SNAPSHOT_DATES).toEqual([...TEMPORAL_SNAPSHOT_DATES].sort());
    expect(TEMPORAL_SNAPSHOT_DATES).toContain(EARLY);
    expect(TEMPORAL_SNAPSHOT_DATES).toContain(LATE);
  });
});

describe("deriveSnapshot", () => {
  it("rejects a malformed date rather than guessing", () => {
    expect(() => deriveSnapshot("2025-02-30")).toThrow(TypeError);
    expect(() => deriveSnapshot("not a date")).toThrow(TypeError);
  });

  it("establishes strictly more as the date moves forward", () => {
    const early = snapshotEstablishedCount(deriveSnapshot(EARLY));
    const late = snapshotEstablishedCount(deriveSnapshot(LATE));
    expect(late).toBeGreaterThan(early);
  });

  it("includes a subject on its own establishment date, not the day after", () => {
    const snapshot = deriveSnapshot(EARLY);
    const runway = snapshot.subjects.find((subject) => subject.subjectId === "rwy-05-23");
    expect(runway?.presence).toBe("established");
    expect(runway?.establishedBy).toBe(EARLY);
  });

  it("distinguishes not-yet-evidenced from undated", () => {
    const snapshot = deriveSnapshot(EARLY);
    const later = snapshot.subjects.find(
      (subject) => subject.subjectId === "j36-prototype",
    );
    expect(later?.presence).toBe("not-yet-evidenced");

    // An illustrative feature has no date at all. That is different from being
    // dated later, and collapsing the two would assert history nobody has.
    const undated = snapshot.subjects.find(
      (subject) => subject.subjectId === "solar-field",
    );
    expect(undated?.presence).toBe("undated");
    expect(undated?.establishedBy).toBeUndefined();
    expect(undated?.modelOnly).toBe(true);
  });

  it("reports only the evidence that was public by the snapshot date", () => {
    const early = deriveSnapshot(EARLY);
    const late = deriveSnapshot(LATE);
    expect(early.publishedSourceIds.length).toBeLessThan(late.publishedSourceIds.length);
    // The War Zone reporting is dated 2025-11-04, after both snapshots.
    expect(early.publishedSourceIds).not.toContain("twz-aircraft-2025");
    expect(late.publishedSourceIds).not.toContain("twz-aircraft-2025");
    expect(deriveSnapshot("2025-11-09").publishedSourceIds).toContain(
      "twz-aircraft-2025",
    );
  });

  it("separates establishment from publication", () => {
    // A subject can be established by a September scene while the reporting
    // that identifies it is not published until November. An analyst standing
    // in October could not have written the November sentence.
    const september = deriveSnapshot("2025-09-28");
    const shelters = september.subjects.find(
      (subject) => subject.subjectId === "west-fighter-shelters",
    );
    expect(shelters?.presence).toBe("established");
    expect(shelters?.sourceIds).not.toContain("twz-aircraft-2025");

    const november = deriveSnapshot("2025-11-09");
    const later = november.subjects.find(
      (subject) => subject.subjectId === "west-fighter-shelters",
    );
    expect(later?.sourceIds).toContain("twz-aircraft-2025");
  });

  it("orders subjects by id, independent of layout declaration order", () => {
    const ids = deriveSnapshot(LATE).subjects.map((subject) => subject.subjectId);
    expect(ids).toEqual([...ids].sort());
  });

  it("is deterministic", () => {
    expect(JSON.stringify(deriveSnapshot(LATE))).toBe(
      JSON.stringify(deriveSnapshot(LATE)),
    );
  });
});

describe("compareSnapshots", () => {
  it("reports no difference between a date and itself", () => {
    const diff = compareSnapshots(LATE, LATE);
    expect(diff.empty).toBe(true);
    expect(diff.changes).toEqual([]);
    expect(diff.addedSourceIds).toEqual([]);
    expect(diff.removedSourceIds).toEqual([]);
    expect(diff.eventsInWindow).toEqual([]);
  });

  it("reports subjects added between two dates", () => {
    const diff = compareSnapshots(EARLY, LATE);
    expect(diff.empty).toBe(false);
    const added = diff.changes.filter((change) => change.kind === "added");
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((change) => change.after.startsWith("established by"))).toBe(true);
  });

  it("is symmetric: running it backwards reports removals", () => {
    const forwards = compareSnapshots(EARLY, LATE);
    const backwards = compareSnapshots(LATE, EARLY);
    const added = forwards.changes.filter((change) => change.kind === "added").length;
    const removed = backwards.changes.filter(
      (change) => change.kind === "removed",
    ).length;
    expect(removed).toBe(added);
  });

  it("reports newly published sources separately from site changes", () => {
    const diff = compareSnapshots(EARLY, "2025-11-09");
    expect(diff.addedSourceIds).toContain("twz-aircraft-2025");
    expect(diff.removedSourceIds).toEqual([]);
  });

  it("reports evidence, confidence, source and uncertainty changes", () => {
    const kinds = new Set(
      compareSnapshots(EARLY, "2025-11-09").changes.map((change) => change.kind),
    );
    expect(kinds.has("evidence-class-changed")).toBe(true);
    expect(kinds.has("confidence-changed")).toBe(true);
    expect(kinds.has("sources-changed")).toBe(true);
  });

  it("marks model-only rows so they cannot read as site changes", () => {
    const diff = compareSnapshots(EARLY, LATE);
    const modelOnly = diff.changes.filter((change) => change.modelOnly);
    for (const change of modelOnly) {
      // A model-only subject has no establishment date, so it can never be
      // reported as having appeared or disappeared at the site.
      expect(change.kind).not.toBe("added");
      expect(change.kind).not.toBe("removed");
    }
  });

  it("counts only the events inside the window", () => {
    const diff = compareSnapshots(EARLY, LATE);
    for (const event of diff.eventsInWindow) {
      expect(event.latestDate).toBeDefined();
      expect(event.latestDate! > EARLY).toBe(true);
      expect(event.latestDate! <= LATE).toBe(true);
    }
  });

  it("orders changes by subject id then by change kind", () => {
    const diff = compareSnapshots(EARLY, LATE);
    const subjectIds = diff.changes.map((change) => change.subjectId);
    expect(subjectIds).toEqual([...subjectIds].sort());
  });

  it("is deterministic", () => {
    expect(JSON.stringify(compareSnapshots(EARLY, LATE))).toBe(
      JSON.stringify(compareSnapshots(EARLY, LATE)),
    );
  });

  it("throws on a malformed date rather than comparing nothing", () => {
    expect(() => compareSnapshots(EARLY, "2025-02-30")).toThrow(TypeError);
  });
});
