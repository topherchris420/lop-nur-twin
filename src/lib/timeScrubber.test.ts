import { describe, expect, it } from "vitest";
import {
  SCRUB_AVAILABLE,
  SCRUB_FIRST_DATE,
  SCRUB_LAST_DATE,
  SCRUB_SPAN_DAYS,
  SCRUB_STOPS,
  clampDay,
  dateAtDay,
  dayOfDate,
  describeScrubState,
  nextStopAfter,
  presenceAt,
  previousStopBefore,
  scrubStateAt,
  scrubStateAtDay,
} from "./timeScrubber";
import { TEMPORAL_SNAPSHOT_DATES } from "./temporal";

/**
 * The scrubber's contract is that a continuous control can never report a state
 * this project did not derive. Everything below is a form of that: the playhead
 * moves over days, the answer always comes from a real ledger stop, and a
 * position between two stops reports the earlier one because between stops
 * nothing was learned.
 */

describe("the day axis", () => {
  it("is built from the ledger's own snapshot dates", () => {
    expect(SCRUB_STOPS.map((stop) => stop.date)).toEqual([...TEMPORAL_SNAPSHOT_DATES]);
    expect(SCRUB_AVAILABLE).toBe(SCRUB_STOPS.length > 1);
  });

  it("starts at zero and increases strictly", () => {
    expect(SCRUB_STOPS[0]?.day).toBe(0);
    for (let index = 1; index < SCRUB_STOPS.length; index += 1) {
      expect(SCRUB_STOPS[index]!.day).toBeGreaterThan(SCRUB_STOPS[index - 1]!.day);
    }
    expect(SCRUB_SPAN_DAYS).toBe(SCRUB_STOPS[SCRUB_STOPS.length - 1]?.day);
  });

  it("measures real calendar distance, not ledger position", () => {
    // The point of a day axis: four quiet years and three busy weeks must not
    // take the same time to cross.
    const first = SCRUB_STOPS[0];
    const second = SCRUB_STOPS[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const expected = Math.round(
      (Date.parse(`${second!.date}T00:00:00Z`) - Date.parse(`${first!.date}T00:00:00Z`)) /
        86_400_000,
    );
    expect(second!.day).toBe(expected);
  });

  it("maps a date to its day and back", () => {
    for (const stop of SCRUB_STOPS) {
      expect(dayOfDate(stop.date)).toBe(stop.day);
      expect(dateAtDay(stop.day)).toBe(stop.date);
    }
    expect(dayOfDate("1999-01-01")).toBeUndefined();
  });
});

describe("dateAtDay", () => {
  it("reports the latest stop at or before the playhead", () => {
    for (let index = 1; index < SCRUB_STOPS.length; index += 1) {
      const previous = SCRUB_STOPS[index - 1]!;
      const current = SCRUB_STOPS[index]!;
      // One day short of the next stop still reads as the previous one.
      expect(dateAtDay(current.day - 1)).toBe(previous.date);
      expect(dateAtDay(current.day)).toBe(current.date);
    }
  });

  it("returns null to the left of the first stop", () => {
    expect(dateAtDay(-1)).toBeNull();
    expect(dateAtDay(-10_000)).toBeNull();
  });

  it("does not fall off the right-hand end", () => {
    expect(dateAtDay(SCRUB_SPAN_DAYS + 5000)).toBe(SCRUB_LAST_DATE);
  });

  it("survives a hostile number", () => {
    // URL parameters and range inputs are not trusted anywhere else here.
    expect(dateAtDay(Number.NaN)).toBe(SCRUB_LAST_DATE);
    expect(dateAtDay(Number.POSITIVE_INFINITY)).toBe(SCRUB_LAST_DATE);
    expect(clampDay(Number.NaN)).toBe(SCRUB_SPAN_DAYS);
    expect(clampDay(-5)).toBe(0);
    expect(clampDay(1e308)).toBe(SCRUB_SPAN_DAYS);
    expect(clampDay(3.6)).toBe(4);
  });
});

describe("stepping", () => {
  it("moves to the adjacent stop, never past the ends", () => {
    const first = SCRUB_STOPS[0]!;
    const last = SCRUB_STOPS[SCRUB_STOPS.length - 1]!;
    expect(previousStopBefore(first.day)).toBeUndefined();
    expect(nextStopAfter(last.day)).toBeUndefined();
    expect(nextStopAfter(first.day)?.date).toBe(SCRUB_STOPS[1]?.date);
    expect(previousStopBefore(last.day)?.date).toBe(
      SCRUB_STOPS[SCRUB_STOPS.length - 2]?.date,
    );
  });
});

describe("scrub state", () => {
  it("is memoised: the same date returns the identical object", () => {
    const date = SCRUB_FIRST_DATE;
    expect(date).toBeDefined();
    expect(scrubStateAt(date!)).toBe(scrubStateAt(date!));
  });

  it("rejects a malformed date rather than deriving one", () => {
    expect(scrubStateAt("not-a-date")).toBeNull();
    expect(scrubStateAt("2025-02-30")).toBeNull();
  });

  it("partitions every subject into exactly one presence", () => {
    const state = scrubStateAtDay(SCRUB_SPAN_DAYS);
    expect(state).not.toBeNull();
    const total =
      state!.establishedCount + state!.notYetEvidencedCount + state!.undatedCount;
    expect(total).toBe(state!.snapshot.subjects.length);
    expect(state!.presence.size).toBe(state!.snapshot.subjects.length);
  });

  it("never establishes fewer subjects as the playhead advances", () => {
    // Evidence accumulates; scrubbing forward can only add established
    // subjects, never remove them.
    let previous = 0;
    for (const stop of SCRUB_STOPS) {
      const state = scrubStateAt(stop.date);
      expect(state).not.toBeNull();
      expect(state!.establishedCount).toBeGreaterThanOrEqual(previous);
      previous = state!.establishedCount;
    }
  });

  it("treats a null state as before any evidence", () => {
    expect(presenceAt(null, "hangar-main")).toBe("pre-evidence");
    const state = scrubStateAtDay(SCRUB_SPAN_DAYS);
    expect(presenceAt(state, "not-a-subject")).toBe("undated");
  });
});

describe("describeScrubState", () => {
  it("never prints an establishment date as a construction date", () => {
    const state = scrubStateAtDay(SCRUB_SPAN_DAYS);
    const described = describeScrubState(state);
    expect(described).toContain("established by this date");
    expect(described).not.toMatch(/built|constructed/i);
  });

  it("says that nothing was public yet before the first source", () => {
    expect(describeScrubState(null)).toMatch(/no cited source|holds no dated evidence/);
  });
});
