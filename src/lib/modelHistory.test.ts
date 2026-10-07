import { describe, expect, it } from "vitest";
import { ALL_SEGMENTS, APRONS, STRUCTURES } from "./layout";
import {
  LATEST_REVISION,
  MODEL_HISTORY,
  MODEL_REVISIONS,
  eventModelEntry,
  getRevision,
  modelEntryFor,
} from "./modelHistory";
import { TEMPORAL_LEDGER } from "./temporal";
import { inspectClaim } from "./claims";

/**
 * The committed record, checked against the model it describes. The build's
 * validator checks the bytes; these check that the record answers for every
 * subject the layout holds and never answers for one it does not digest.
 */
describe("the model history", () => {
  it("starts at its declared origin and numbers revisions contiguously", () => {
    expect(MODEL_REVISIONS[0]?.commit).toBe(MODEL_HISTORY.origin.commit);
    MODEL_REVISIONS.forEach((revision, index) => {
      expect(revision.revision).toBe(index + 1);
    });
    expect(LATEST_REVISION).toBe(MODEL_REVISIONS[MODEL_REVISIONS.length - 1]);
  });

  it("records an entry for every structure, aircraft and pavement in the layout", () => {
    for (const subject of [...STRUCTURES, ...ALL_SEGMENTS, ...APRONS]) {
      const events = MODEL_HISTORY.subjects[subject.id];
      expect(events, subject.id).toBeDefined();
      expect(
        events?.some((event) => event.kind === "removed"),
        subject.id,
      ).toBe(false);
      for (const event of events ?? []) expect(getRevision(event.revision)).toBeDefined();
    }
  });

  it("says 'by' the first revision, never 'in' it, for what was there when the record begins", () => {
    const answer = modelEntryFor("hangar-main");
    expect(answer.recorded).toBe(true);
    expect(answer.entered).toMatch(/^By r1 /);
    expect(answer.entered).toMatch(/unknown/);
  });

  it("does not borrow an entry for a subject the history does not digest", () => {
    const answer = modelEntryFor("measurement-runway-length");
    expect(answer.recorded).toBe(false);
    expect(answer.events).toEqual([]);
    expect(answer.entered).toMatch(/^Not recorded/);
  });

  it("is what the claim inspector reports", () => {
    expect(inspectClaim("hangar-main")?.dates.modelEntry).toEqual(
      modelEntryFor("hangar-main"),
    );
  });

  it("dates a dated event's entry by when its first-observed date last changed", () => {
    for (const event of TEMPORAL_LEDGER) {
      const entry = eventModelEntry(event);
      if (event.scope === "evidence-availability") {
        // A publication is about a source; the history does not digest sources.
        expect(entry, event.id).toBe("not recorded");
        continue;
      }
      const history = MODEL_HISTORY.subjects[event.subjectId] ?? [];
      const redated = history.filter(
        (item) =>
          item.kind === "changed" &&
          item.aspects.includes("placement-or-first-observed-date"),
      );
      const last = redated[redated.length - 1];
      if (last === undefined) expect(entry, event.id).toMatch(/^by r1 /);
      else expect(entry, event.id).toMatch(new RegExp(`^r${last.revision} `));
    }
  });
});
