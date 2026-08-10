import { describe, expect, it } from "vitest";
import {
  DIFF_CHANNELS,
  channelForChangeKind,
  channelForManifestCategory,
  diffStatusIndex,
  eventsByScope,
  forensicDiff,
  manifestChannels,
  subjectDiffStatus,
} from "./forensicDiff";
import { CHANGE_CATEGORIES, type ManifestDiff } from "./manifestDiff";
import { TEMPORAL_SNAPSHOT_DATES, compareSnapshots } from "./temporal";

/**
 * The diff's value is entirely in the routing: three channels that mean three
 * different things to a reviewer. So the tests are about totality (every change
 * lands somewhere), separation (release noise lands nowhere), and determinism
 * (a pasted diff can be reproduced).
 */

const FIRST = TEMPORAL_SNAPSHOT_DATES[0]!;
const LAST = TEMPORAL_SNAPSHOT_DATES[TEMPORAL_SNAPSHOT_DATES.length - 1]!;

describe("channel routing", () => {
  it("routes presence changes to geometry, not to evidence", () => {
    // A subject appearing or disappearing is a spatial event even though a
    // snapshot derives it from evidence dates.
    expect(channelForChangeKind("added")).toBe("geometry");
    expect(channelForChangeKind("removed")).toBe("geometry");
  });

  it("routes support changes to evidence and readings to interpretation", () => {
    expect(channelForChangeKind("evidence-class-changed")).toBe("evidence");
    expect(channelForChangeKind("confidence-changed")).toBe("evidence");
    expect(channelForChangeKind("sources-changed")).toBe("evidence");
    expect(channelForChangeKind("uncertainty-changed")).toBe("interpretation");
  });

  it("keeps release metadata out of all three channels", () => {
    expect(channelForManifestCategory("release-metadata")).toBeNull();
    for (const category of CHANGE_CATEGORIES) {
      if (category === "release-metadata") continue;
      expect(DIFF_CHANNELS).toContain(channelForManifestCategory(category));
    }
  });
});

describe("forensicDiff", () => {
  it("routes every change exactly once", () => {
    const diff = forensicDiff(FIRST, LAST);
    const routed = DIFF_CHANNELS.reduce(
      (total, channel) => total + diff.byChannel[channel].length,
      0,
    );
    expect(routed).toBe(diff.comparison.changes.length);
  });

  it("is deterministic for a given pair of dates", () => {
    expect(JSON.stringify(forensicDiff(FIRST, LAST).subjects)).toBe(
      JSON.stringify(forensicDiff(FIRST, LAST).subjects),
    );
  });

  it("sorts subjects by id, so a pasted diff is reproducible", () => {
    const ids = forensicDiff(FIRST, LAST).subjects.map((subject) => subject.subjectId);
    expect([...ids].sort()).toEqual(ids);
  });

  it("wraps compareSnapshots rather than re-deciding what differs", () => {
    const diff = forensicDiff(FIRST, LAST);
    const comparison = compareSnapshots(FIRST, LAST);
    expect(diff.empty).toBe(comparison.empty);
    expect(diff.addedSourceIds).toEqual(comparison.addedSourceIds);
    expect(diff.eventsInWindow).toEqual(comparison.eventsInWindow);
  });

  it("is empty against itself", () => {
    const diff = forensicDiff(LAST, LAST);
    expect(diff.empty).toBe(true);
    expect(diff.subjects).toEqual([]);
    expect(diff.channelsTouched).toEqual([]);
  });

  it("answers backwards in time with removals rather than an error", () => {
    // "What did we lose confidence in?" is a legitimate question.
    const backwards = forensicDiff(LAST, FIRST);
    expect(backwards.empty).toBe(false);
    expect(backwards.subjects.some((subject) => subject.status === "removed")).toBe(true);
  });

  it("reports only channels that actually have a change", () => {
    const diff = forensicDiff(FIRST, LAST);
    for (const channel of diff.channelsTouched) {
      expect(diff.byChannel[channel].length).toBeGreaterThan(0);
    }
    for (const channel of DIFF_CHANNELS) {
      if (diff.byChannel[channel].length > 0) {
        expect(diff.channelsTouched).toContain(channel);
      }
    }
  });

  it("gives a status index the scene can look subjects up in", () => {
    const diff = forensicDiff(FIRST, LAST);
    const index = diffStatusIndex(diff);
    expect(index.size).toBe(diff.subjects.length);
    for (const subject of diff.subjects) {
      expect(index.get(subject.subjectId)).toBe(subject.status);
      expect(subjectDiffStatus(diff, subject.subjectId)).toBe(subject.status);
    }
    expect(subjectDiffStatus(diff, "not-a-subject")).toBe("unchanged");
    expect(subjectDiffStatus(null, "hangar-main")).toBe("unchanged");
    expect(diffStatusIndex(null).size).toBe(0);
  });
});

describe("manifestChannels", () => {
  const diff: ManifestDiff = {
    empty: false,
    differences: [
      {
        category: "analytical-model",
        subjectId: "hangar-main",
        field: "geometryHash",
        before: "a",
        after: "b",
      },
      {
        category: "evidence",
        subjectId: "hangar-main",
        field: "confidence",
        before: "0.55",
        after: "0.80",
      },
      {
        category: "uncertainty",
        subjectId: "rwy-05-23",
        field: "uncertaintyHash",
        before: "c",
        after: "d",
      },
      {
        category: "documentation",
        subjectId: "rwy-05-23",
        field: "wordingHash",
        before: "e",
        after: "f",
      },
      {
        category: "release-metadata",
        subjectId: "model",
        field: "modelVersion",
        before: "0.1.0",
        after: "0.2.0",
      },
    ],
    addedSubjectIds: [],
    removedSubjectIds: [],
    subjectComparisonAvailable: true,
    categoriesTouched: CHANGE_CATEGORIES,
    notCovered: [],
  };

  it("folds documentation and uncertainty into one interpretation channel", () => {
    const { channels } = manifestChannels(diff);
    const interpretation = channels.find(
      (channel) => channel.channel === "interpretation",
    );
    expect(interpretation?.differences).toHaveLength(2);
    expect(interpretation?.subjectIds).toEqual(["rwy-05-23"]);
  });

  it("returns release metadata separately rather than dropping it", () => {
    const { channels, releaseMetadata } = manifestChannels(diff);
    expect(releaseMetadata).toHaveLength(1);
    const routed = channels.reduce(
      (total, channel) => total + channel.differences.length,
      0,
    );
    expect(routed + releaseMetadata.length).toBe(diff.differences.length);
  });

  it("excludes the whole-model pseudo-subject from subject lists", () => {
    const { channels } = manifestChannels(diff);
    for (const channel of channels) expect(channel.subjectIds).not.toContain("model");
  });

  it("always returns all three channels, in declaration order", () => {
    const { channels } = manifestChannels({ ...diff, differences: [] });
    expect(channels.map((channel) => channel.channel)).toEqual([...DIFF_CHANNELS]);
  });
});

describe("eventsByScope", () => {
  it("keeps a publication apart from a site claim", () => {
    const grouped = eventsByScope(forensicDiff(FIRST, LAST).eventsInWindow);
    for (const [scope, events] of Object.entries(grouped)) {
      for (const event of events) expect(event.scope).toBe(scope);
    }
  });
});
