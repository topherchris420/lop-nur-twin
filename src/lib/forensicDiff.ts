/**
 * The forensic diff: three channels, never one number.
 *
 * Comparing two states of this model has always been possible — `temporal.ts`
 * compares two dates, `manifestDiff.ts` compares two builds — and both produced
 * a flat list of differences. A flat list answers "did something change?" and
 * hides the only question a reviewer actually has, which is *what kind* of
 * change it was. These three are different events with different consequences,
 * and collapsing them is how a rewording gets reviewed like a moved building:
 *
 * - **Geometry** — something entered or left the modeled world. A spatial
 *   re-review is required.
 * - **Evidence** — the support behind a subject changed: its classification, its
 *   confidence rank, which sources cite it. The geometry may be identical and
 *   the claims are not.
 * - **Interpretation** — what this project *says* about a subject changed: the
 *   uncertainty it admits, the wording it uses. Nothing moved and nothing new
 *   was cited; the reading changed.
 *
 * Both comparison surfaces route through the same three channels, so the
 * temporal diff on the 3D view and the manifest diff on `/compare` are read the
 * same way. Everything here is pure: the same pair of inputs always produces
 * the same channels in the same order.
 */

import {
  TEMPORAL_LEDGER,
  compareSnapshots,
  type SnapshotComparison,
  type SubjectChange,
  type SubjectChangeKind,
  type TemporalEvidenceEvent,
} from "./temporal";
import type { ChangeCategory, ManifestDiff, ManifestDifference } from "./manifestDiff";

/* ------------------------------------------------------------------ */
/* Channels                                                            */
/* ------------------------------------------------------------------ */

export type DiffChannel = "geometry" | "evidence" | "interpretation";

export const DIFF_CHANNELS: readonly DiffChannel[] = [
  "geometry",
  "evidence",
  "interpretation",
];

export const DIFF_CHANNEL_META: Record<
  DiffChannel,
  { label: string; glyph: string; question: string; description: string }
> = {
  geometry: {
    label: "Geometry",
    // Glyphs pair with every label so a channel is never carried by colour
    // alone (WCAG 1.4.1).
    glyph: "▲",
    question: "What entered or left the modeled world?",
    description:
      "A subject became established, stopped being established, moved, turned or resized. This is the channel that needs a spatial re-review, and the only one where the picture on screen is different.",
  },
  evidence: {
    label: "Evidence",
    glyph: "◆",
    question: "What changed about the support behind it?",
    description:
      "A classification, a confidence rank or a citing source changed. The geometry can be byte-identical while the claims attached to it are not.",
  },
  interpretation: {
    label: "Interpretation",
    glyph: "◇",
    question: "What changed about how this project reads it?",
    description:
      "What the model admits not knowing, or the words it uses to describe something. Nothing moved and nothing new was cited: the reading changed.",
  },
};

/**
 * Which channel a temporal change kind belongs to.
 *
 * `added` and `removed` are geometry rather than evidence even though a
 * snapshot derives them from evidence dates, because their consequence is
 * spatial: a subject appears or disappears from the scene.
 */
export function channelForChangeKind(kind: SubjectChangeKind): DiffChannel {
  switch (kind) {
    case "added":
    case "removed":
      return "geometry";
    case "evidence-class-changed":
    case "confidence-changed":
    case "sources-changed":
      return "evidence";
    case "uncertainty-changed":
      return "interpretation";
  }
}

/**
 * Which channel a manifest change category belongs to.
 *
 * `release-metadata` maps to nothing: a version bump or a new generation
 * timestamp is not a change to the model, and folding it into any of the three
 * would put noise in a channel a reviewer is meant to trust.
 */
export function channelForManifestCategory(category: ChangeCategory): DiffChannel | null {
  switch (category) {
    case "analytical-model":
      return "geometry";
    case "evidence":
      return "evidence";
    case "uncertainty":
    case "documentation":
      return "interpretation";
    case "release-metadata":
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Per-subject status                                                  */
/* ------------------------------------------------------------------ */

/**
 * How a subject reads in a diff. Ordered by how much attention it wants, which
 * is also the order the scene draws them in.
 */
export type SubjectDiffStatus =
  "added" | "removed" | "evidence-changed" | "interpretation-changed" | "unchanged";

export const SUBJECT_DIFF_STATUSES: readonly SubjectDiffStatus[] = [
  "added",
  "removed",
  "evidence-changed",
  "interpretation-changed",
  "unchanged",
];

export const SUBJECT_DIFF_META: Record<
  SubjectDiffStatus,
  { label: string; glyph: string; description: string }
> = {
  added: {
    label: "Established in this window",
    glyph: "+",
    description:
      "Not established at the earlier date, established by the later one. The cited evidence for it became available in between; the thing itself may be older.",
  },
  removed: {
    label: "No longer established",
    glyph: "−",
    description:
      "Established at the earlier date and not at the later one. Comparing backwards in time is a legitimate question and this is its answer.",
  },
  "evidence-changed": {
    label: "Evidence changed",
    glyph: "◆",
    description:
      "Same presence, different support: a classification, confidence rank or citing source moved between the two dates.",
  },
  "interpretation-changed": {
    label: "Interpretation changed",
    glyph: "◇",
    description:
      "Same presence and same sources; what this project admits not knowing about it changed.",
  },
  unchanged: {
    label: "Unchanged",
    glyph: "=",
    description: "Nothing this comparison can see differs between the two dates.",
  },
};

export interface SubjectDiff {
  subjectId: string;
  label: string;
  status: SubjectDiffStatus;
  /** Channels this subject has at least one change in, in declaration order. */
  channels: readonly DiffChannel[];
  changes: readonly SubjectChange[];
  /** True when the subject asserts nothing about the site. */
  modelOnly: boolean;
}

export interface ForensicDiff {
  from: string;
  to: string;
  empty: boolean;
  /** Changes grouped by channel, each in the deterministic ledger order. */
  byChannel: Readonly<Record<DiffChannel, readonly SubjectChange[]>>;
  /** Channels with at least one change, in declaration order. */
  channelsTouched: readonly DiffChannel[];
  /** Per-subject rollup, subjects with changes only, by id. */
  subjects: readonly SubjectDiff[];
  addedSourceIds: readonly string[];
  removedSourceIds: readonly string[];
  eventsInWindow: readonly TemporalEvidenceEvent[];
  /** The underlying comparison, for surfaces that want the raw rows. */
  comparison: SnapshotComparison;
}

/** The status a set of changes rolls up to, strongest signal first. */
function statusFor(changes: readonly SubjectChange[]): SubjectDiffStatus {
  if (changes.some((change) => change.kind === "added")) return "added";
  if (changes.some((change) => change.kind === "removed")) return "removed";
  if (changes.some((change) => channelForChangeKind(change.kind) === "evidence")) {
    return "evidence-changed";
  }
  if (changes.some((change) => channelForChangeKind(change.kind) === "interpretation")) {
    return "interpretation-changed";
  }
  return "unchanged";
}

/**
 * The three-channel diff between two ledger dates.
 *
 * Wraps `compareSnapshots` rather than replacing it: the comparison stays the
 * one place that decides what differs, and this adds only the routing. Output
 * order is inherited and therefore deterministic.
 */
export function forensicDiff(from: string, to: string): ForensicDiff {
  const comparison = compareSnapshots(from, to);

  const byChannel: Record<DiffChannel, SubjectChange[]> = {
    geometry: [],
    evidence: [],
    interpretation: [],
  };
  const bySubject = new Map<string, SubjectChange[]>();

  for (const change of comparison.changes) {
    byChannel[channelForChangeKind(change.kind)].push(change);
    const list = bySubject.get(change.subjectId);
    if (list === undefined) bySubject.set(change.subjectId, [change]);
    else list.push(change);
  }

  const subjects: SubjectDiff[] = [...bySubject.entries()]
    .map(([subjectId, changes]): SubjectDiff => {
      const touched = DIFF_CHANNELS.filter((channel) =>
        changes.some((change) => channelForChangeKind(change.kind) === channel),
      );
      return {
        subjectId,
        label: changes[0]?.label ?? subjectId,
        status: statusFor(changes),
        channels: touched,
        changes,
        modelOnly: changes.every((change) => change.modelOnly),
      };
    })
    .sort((left, right) =>
      left.subjectId < right.subjectId ? -1 : left.subjectId > right.subjectId ? 1 : 0,
    );

  return {
    from,
    to,
    empty: comparison.empty,
    byChannel,
    channelsTouched: DIFF_CHANNELS.filter((channel) => byChannel[channel].length > 0),
    subjects,
    addedSourceIds: comparison.addedSourceIds,
    removedSourceIds: comparison.removedSourceIds,
    eventsInWindow: comparison.eventsInWindow,
    comparison,
  };
}

/** A subject's status in a diff. Subjects with no changes read `unchanged`. */
export function subjectDiffStatus(
  diff: ForensicDiff | null,
  subjectId: string,
): SubjectDiffStatus {
  if (diff === null) return "unchanged";
  return (
    diff.subjects.find((subject) => subject.subjectId === subjectId)?.status ??
    "unchanged"
  );
}

/** Index for the scene, which asks per subject on every rebuild. */
export function diffStatusIndex(
  diff: ForensicDiff | null,
): ReadonlyMap<string, SubjectDiffStatus> {
  const index = new Map<string, SubjectDiffStatus>();
  if (diff === null) return index;
  for (const subject of diff.subjects) index.set(subject.subjectId, subject.status);
  return index;
}

/* ------------------------------------------------------------------ */
/* Manifest side                                                       */
/* ------------------------------------------------------------------ */

export interface ManifestChannelSummary {
  channel: DiffChannel;
  differences: readonly ManifestDifference[];
  subjectIds: readonly string[];
}

/**
 * A manifest diff routed into the same three channels.
 *
 * Release-metadata differences are returned separately rather than dropped: a
 * reviewer needs to see that the version moved, and needs it kept out of the
 * channels that are supposed to mean something about the model.
 */
export function manifestChannels(diff: ManifestDiff): {
  channels: readonly ManifestChannelSummary[];
  releaseMetadata: readonly ManifestDifference[];
} {
  const buckets = new Map<DiffChannel, ManifestDifference[]>(
    DIFF_CHANNELS.map((channel) => [channel, []]),
  );
  const releaseMetadata: ManifestDifference[] = [];

  for (const difference of diff.differences) {
    const channel = channelForManifestCategory(difference.category);
    if (channel === null) releaseMetadata.push(difference);
    else buckets.get(channel)?.push(difference);
  }

  return {
    channels: DIFF_CHANNELS.map((channel) => {
      const differences = buckets.get(channel) ?? [];
      return {
        channel,
        differences,
        subjectIds: [
          ...new Set(
            differences
              .map((difference) => difference.subjectId)
              .filter((subjectId) => subjectId !== "model"),
          ),
        ].sort(),
      };
    }),
    releaseMetadata,
  };
}

/**
 * Events inside a window, grouped by the scope they assert on.
 *
 * The split exists because "a source was published" and "something was true of
 * the site" are the two statements a temporal comparison is most likely to be
 * misread as conflating.
 */
export function eventsByScope(
  events: readonly TemporalEvidenceEvent[],
): Readonly<Record<string, readonly TemporalEvidenceEvent[]>> {
  const grouped: Record<string, TemporalEvidenceEvent[]> = {};
  for (const event of events) {
    (grouped[event.scope] ??= []).push(event);
  }
  return grouped;
}

/** Every dated ledger event, for surfaces that render the whole timeline. */
export const ALL_TEMPORAL_EVENTS: readonly TemporalEvidenceEvent[] = TEMPORAL_LEDGER;
