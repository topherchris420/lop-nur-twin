/**
 * The time scrubber: a continuous day axis over a ledger of discrete evidence.
 *
 * `temporal.ts` can already answer "what was established by this date?" for any
 * date. What it cannot do on its own is be *scrubbed*: a slider needs a
 * continuous axis, a set of stops to snap to, and an answer cheap enough to ask
 * sixty times a second while a playhead runs.
 *
 * The axis is days, not ledger index. That distinction matters more than it
 * looks: the snapshot dates are unevenly spaced, and stepping through them at a
 * constant rate would draw a picture where four years of nothing and three weeks
 * of construction take the same time to cross. On a day axis the site sits
 * still for years and then changes in a burst, which is what actually happened.
 *
 * Three properties this module guarantees:
 *
 * 1. **A scrub position never invents a date.** The playhead moves over days,
 *    but the state it reports is always the state at a real ledger stop — the
 *    latest one at or before the playhead. Between stops nothing changes,
 *    because between stops this project learned nothing.
 * 2. **Before the first stop is a real position.** Scrubbing to the left of the
 *    earliest evidence yields no snapshot at all, not an empty one. "There was
 *    no public evidence yet" and "the evidence showed nothing" are different
 *    statements and the interface has to be able to make the first.
 * 3. **Presence is memoised, never recomputed per frame.** `deriveSnapshot` is
 *    O(subjects × records); the scrubber calls it once per distinct date and
 *    caches the resulting lookup, which is why the playhead can run without
 *    React state on the frame loop.
 */

import {
  TEMPORAL_SNAPSHOT_DATES,
  deriveSnapshot,
  isIsoDate,
  type SubjectPresence,
  type TemporalSnapshot,
} from "./temporal";

/* ------------------------------------------------------------------ */
/* The day axis                                                        */
/* ------------------------------------------------------------------ */

const MS_PER_DAY = 86_400_000;

/** Days between two ISO calendar dates. Both are validated by the caller. */
function dayDelta(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY,
  );
}

export interface ScrubStop {
  date: string;
  /** Days after the earliest stop. The earliest stop is 0. */
  day: number;
  /** How many ledger events land on this date. */
  eventCount: number;
}

/**
 * Every date the ledger can be read at, on the day axis.
 *
 * Derived from `TEMPORAL_SNAPSHOT_DATES`, which is itself derived from the
 * ledger, so a new dated record shows up here without anything being typed out.
 */
export const SCRUB_STOPS: readonly ScrubStop[] = Object.freeze(
  (() => {
    const dates = TEMPORAL_SNAPSHOT_DATES.filter(isIsoDate);
    const first = dates[0];
    if (first === undefined) return [];
    return dates.map((date) => ({
      date,
      day: dayDelta(first, date),
      eventCount: 0,
    }));
  })(),
);

export const SCRUB_FIRST_DATE: string | undefined = SCRUB_STOPS[0]?.date;
export const SCRUB_LAST_DATE: string | undefined =
  SCRUB_STOPS[SCRUB_STOPS.length - 1]?.date;

/** Total span of the axis in days. Zero when the ledger holds one date or none. */
export const SCRUB_SPAN_DAYS: number = SCRUB_STOPS[SCRUB_STOPS.length - 1]?.day ?? 0;

/** True when there is enough dated evidence for a scrub to mean anything. */
export const SCRUB_AVAILABLE: boolean = SCRUB_STOPS.length > 1;

/** The day offset of a ledger date, or undefined when it is not a stop. */
export function dayOfDate(date: string): number | undefined {
  return SCRUB_STOPS.find((stop) => stop.date === date)?.day;
}

/**
 * The ledger date in effect at a day offset: the latest stop at or before it.
 *
 * Returns null to the left of the first stop, which is the "no public evidence
 * yet" position rather than an empty snapshot.
 */
export function dateAtDay(day: number): string | null {
  if (!Number.isFinite(day)) return SCRUB_LAST_DATE ?? null;
  let current: string | null = null;
  for (const stop of SCRUB_STOPS) {
    if (stop.day > day) break;
    current = stop.date;
  }
  return current;
}

/** Clamp an arbitrary number onto the axis. */
export function clampDay(day: number): number {
  if (!Number.isFinite(day)) return SCRUB_SPAN_DAYS;
  return Math.min(SCRUB_SPAN_DAYS, Math.max(0, Math.round(day)));
}

/** The stop immediately after a day offset, for the "step forward" control. */
export function nextStopAfter(day: number): ScrubStop | undefined {
  return SCRUB_STOPS.find((stop) => stop.day > day);
}

/** The stop immediately before a day offset, for "step back". */
export function previousStopBefore(day: number): ScrubStop | undefined {
  let candidate: ScrubStop | undefined;
  for (const stop of SCRUB_STOPS) {
    if (stop.day >= day) break;
    candidate = stop;
  }
  return candidate;
}

/* ------------------------------------------------------------------ */
/* Memoised presence lookup                                            */
/* ------------------------------------------------------------------ */

export interface ScrubState {
  date: string;
  day: number;
  snapshot: TemporalSnapshot;
  presence: ReadonlyMap<string, SubjectPresence>;
  /** Subjects established by this date. */
  establishedCount: number;
  /** Subjects modeled but not yet evidenced at this date. */
  notYetEvidencedCount: number;
  /** Subjects in the model that carry no date at all. */
  undatedCount: number;
  publishedSourceCount: number;
}

const STATE_CACHE = new Map<string, ScrubState>();

/**
 * The scrub state at a ledger date, computed once and cached.
 *
 * The cache is unbounded and that is safe by construction: it is keyed on
 * `SCRUB_STOPS`, a frozen list derived at module load, so it can never hold
 * more entries than the ledger has distinct dates.
 */
export function scrubStateAt(date: string): ScrubState | null {
  if (!isIsoDate(date)) return null;
  const cached = STATE_CACHE.get(date);
  if (cached !== undefined) return cached;

  const snapshot = deriveSnapshot(date);
  const presence = new Map<string, SubjectPresence>();
  let establishedCount = 0;
  let notYetEvidencedCount = 0;
  let undatedCount = 0;
  for (const subject of snapshot.subjects) {
    presence.set(subject.subjectId, subject.presence);
    if (subject.presence === "established") establishedCount += 1;
    else if (subject.presence === "not-yet-evidenced") notYetEvidencedCount += 1;
    else undatedCount += 1;
  }

  const state: ScrubState = {
    date,
    day: dayOfDate(date) ?? 0,
    snapshot,
    presence,
    establishedCount,
    notYetEvidencedCount,
    undatedCount,
    publishedSourceCount: snapshot.publishedSourceIds.length,
  };
  STATE_CACHE.set(date, state);
  return state;
}

/** The scrub state at a day offset, or null before the first evidence. */
export function scrubStateAtDay(day: number): ScrubState | null {
  const date = dateAtDay(day);
  return date === null ? null : scrubStateAt(date);
}

/**
 * How a subject reads at a scrub position.
 *
 * `pre-evidence` is the state to the left of the first ledger stop and exists
 * so the interface can distinguish "nothing was public yet" from "the evidence
 * did not show this", which are the two halves of the question a temporal view
 * is asked.
 */
export type ScrubPresence = SubjectPresence | "pre-evidence";

export const SCRUB_PRESENCE_META: Record<
  ScrubPresence,
  { label: string; glyph: string; description: string }
> = {
  established: {
    label: "Established",
    glyph: "◆",
    description:
      "A cited public scene shows this existed by the scrub date. It says nothing about when it was built.",
  },
  "not-yet-evidenced": {
    label: "Not yet evidenced",
    glyph: "◇",
    description:
      "Modeled, but the earliest cited evidence for it is later than the scrub date. It may well have been there; nothing public showed it yet.",
  },
  undated: {
    label: "Undated",
    glyph: "○",
    description:
      "In the model with no date of any kind. Its presence at this or any other date is unknown, so it stays drawn as uncertain rather than appearing or disappearing.",
  },
  "pre-evidence": {
    label: "Before any evidence",
    glyph: "·",
    description:
      "The scrub position is earlier than the first cited source this project holds. Nothing here was publicly evidenced yet.",
  },
};

/** A subject's presence at a scrub state, treating a null state as pre-evidence. */
export function presenceAt(state: ScrubState | null, subjectId: string): ScrubPresence {
  if (state === null) return "pre-evidence";
  return state.presence.get(subjectId) ?? "undated";
}

/**
 * A one-line readout of a scrub position, phrased so the reader cannot mistake
 * "established by" for "built on".
 */
export function describeScrubState(state: ScrubState | null): string {
  if (state === null) {
    return SCRUB_FIRST_DATE === undefined
      ? "The temporal ledger holds no dated evidence."
      : `Before ${SCRUB_FIRST_DATE}: no cited source this project holds was public yet, so nothing at the site was publicly evidenced.`;
  }
  return `${state.date}: ${state.establishedCount} subject${
    state.establishedCount === 1 ? "" : "s"
  } established by this date, ${state.notYetEvidencedCount} not yet evidenced, ${
    state.undatedCount
  } undated. ${state.publishedSourceCount} source${
    state.publishedSourceCount === 1 ? "" : "s"
  } public by then.`;
}
