/**
 * The model's own history: the third date.
 *
 * Every claim in this twin has three dates that are never merged — when
 * something was true at the site, when evidence of it became public, and when
 * it entered this model. The first two come from the evidence. The third is a
 * fact about this repository, and for a long time the inspector printed "not
 * recorded" against it, because nothing recorded it.
 *
 * `model-history/index.json` records it. Each revision is the release manifest
 * one commit on `main` produced, re-derived by running *that commit's own*
 * generator with `SOURCE_DATE_EPOCH` pinned to its commit time and kept byte
 * for byte (`scripts/record-model-history.ts`). A revision is recorded wherever
 * what the manifest says — everything but its timestamp and package version —
 * differs from the commit before. The build refuses a model that differs from
 * the latest recorded revision (`scripts/validate-model-history.ts`), so the
 * history is complete by construction from its origin onward.
 *
 * What this can and cannot say:
 *
 * - **Entered.** A subject in the first recorded revision entered the model
 *   *by* that revision; the record does not reach further back, because
 *   earlier manifests digest the model as a whole and name no subject. A
 *   subject that first appears later entered *in* that revision — exactly,
 *   with respect to `main`'s history.
 * - **Changed.** A per-subject digest moved. Which digest says what kind of
 *   change: placement, evidence, wording or uncertainty. A subject's placement
 *   digest also covers the date it was first observed, so when that date moved
 *   too, the change is reported as "placement or first-observed date" and never
 *   as a move it may not have been.
 * - Only structures, aircraft and pavements carry per-subject digests. A
 *   measurement, the site or the terrain has no recorded entry, and the
 *   inspector says so rather than borrowing a neighbour's.
 *
 * None of this is evidence about the site. It is a record of what this model
 * said, when — the same discipline applied to the instrument itself.
 */

import historyFile from "../../model-history/index.json" with { type: "json" };
import {
  CHANGE_ASPECT_LABELS,
  parseModelHistory,
  type ModelHistoryFile,
  type ModelRevision,
  type SubjectHistoryEvent,
} from "./modelRevisions";

export {
  CHANGE_ASPECT_LABELS,
  type ChangeAspect,
  type ModelRevision,
  type SubjectHistoryEvent,
} from "./modelRevisions";

export const MODEL_HISTORY: ModelHistoryFile = parseModelHistory(historyFile);

export const MODEL_REVISIONS: readonly ModelRevision[] = MODEL_HISTORY.revisions;

export const LATEST_REVISION: ModelRevision =
  MODEL_REVISIONS[MODEL_REVISIONS.length - 1]!;

export function getRevision(revision: number): ModelRevision | undefined {
  return MODEL_REVISIONS[revision - 1];
}

/** "r3 · 2026-10-06 · be2978a" — the short form used everywhere. */
export function revisionLabel(revision: ModelRevision): string {
  return `r${revision.revision} · ${revision.committedAt.slice(0, 10)} · ${revision.commit.slice(0, 7)}`;
}

/* ------------------------------------------------------------------ */
/* Answers for the claim inspector                                     */
/* ------------------------------------------------------------------ */

export interface ModelEntryAnswer {
  /** No per-subject record exists for this kind of subject. */
  recorded: boolean;
  /** One sentence: when it entered this model. */
  entered: string;
  /** One sentence: what changed in the latest revision that touched it, or that nothing has. */
  lastChange: string;
  /** Every recorded event, oldest first, in words. */
  events: readonly { revision: ModelRevision; text: string }[];
}

function describeEvent(event: SubjectHistoryEvent): string {
  switch (event.kind) {
    case "present-at-origin":
      return "present when the record begins";
    case "added":
      return "added";
    case "removed":
      return "removed";
    case "changed":
      return `changed: ${event.aspects.map((aspect) => CHANGE_ASPECT_LABELS[aspect]).join(", ")}`;
  }
}

/** When a subject entered this model and what has changed since, from the record. */
export function modelEntryFor(subjectId: string): ModelEntryAnswer {
  const events = MODEL_HISTORY.subjects[subjectId];
  if (events === undefined || events.length === 0) {
    return {
      recorded: false,
      entered:
        "Not recorded: the model history digests structures, aircraft and pavements, and this is neither.",
      lastChange: "Not recorded for this kind of subject.",
      events: [],
    };
  }

  const described = events.flatMap((event) => {
    const revision = getRevision(event.revision);
    return revision === undefined ? [] : [{ revision, text: describeEvent(event) }];
  });
  const first = events[0]!;
  const firstRevision = getRevision(first.revision)!;
  const entered =
    first.kind === "present-at-origin"
      ? `By ${revisionLabel(firstRevision)}, where the record begins; earlier manifests name no subject, so when before that is unknown.`
      : `In ${revisionLabel(firstRevision)}.`;

  const changes = events.filter(
    (event): event is Extract<SubjectHistoryEvent, { kind: "changed" }> =>
      event.kind === "changed",
  );
  const latest = changes[changes.length - 1];
  const lastChange =
    latest === undefined
      ? `None since it entered, through ${revisionLabel(LATEST_REVISION)}.`
      : `${revisionLabel(getRevision(latest.revision)!)}: ${latest.aspects.map((aspect) => CHANGE_ASPECT_LABELS[aspect]).join(", ")}.`;

  return { recorded: true, entered, lastChange, events: described };
}

/**
 * When a dated evidence event entered this model, in short form. A
 * first-appearance, pavement or sighting event exists because its subject
 * carries a first-observed date, so it entered when that date last changed —
 * which the manifests state outright — or with the subject itself. A
 * publication is about a source, which the history does not digest, and is
 * reported as not recorded.
 */
export function eventModelEntry(event: { subjectId: string; scope: string }): string {
  if (event.scope === "evidence-availability") return "not recorded";
  const events = MODEL_HISTORY.subjects[event.subjectId];
  const first = events?.[0];
  if (events === undefined || first === undefined) return "not recorded";
  let entry: SubjectHistoryEvent = first;
  for (const candidate of events) {
    if (
      candidate.kind === "changed" &&
      candidate.aspects.includes("placement-or-first-observed-date")
    ) {
      entry = candidate;
    }
  }
  const revision = getRevision(entry.revision);
  if (revision === undefined) return "not recorded";
  return entry.kind === "present-at-origin"
    ? `by ${revisionLabel(revision)}`
    : revisionLabel(revision);
}

/** The table form of `modelEntryFor`: two short cells, or null when not recorded. */
export function modelEntryCells(
  subjectId: string,
): { entered: string; lastChange: string } | null {
  const events = MODEL_HISTORY.subjects[subjectId];
  const first = events?.[0];
  if (events === undefined || first === undefined) return null;
  const firstRevision = getRevision(first.revision);
  if (firstRevision === undefined) return null;
  const changes = events.filter(
    (event): event is Extract<SubjectHistoryEvent, { kind: "changed" }> =>
      event.kind === "changed",
  );
  const latest = changes[changes.length - 1];
  const latestRevision = latest === undefined ? undefined : getRevision(latest.revision);
  return {
    entered: `${first.kind === "present-at-origin" ? "by " : ""}${revisionLabel(firstRevision)}`,
    lastChange:
      latest === undefined || latestRevision === undefined
        ? "none since it entered"
        : `${revisionLabel(latestRevision)}: ${latest.aspects.map((aspect) => CHANGE_ASPECT_LABELS[aspect]).join(", ")}`,
  };
}
