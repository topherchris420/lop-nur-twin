/**
 * One predicate that decides how a modeled thing is drawn.
 *
 * Two independent questions compose here, and every surface has to compose
 * them the same way, or the scene, the minimap, the structure index and the
 * measurement ruler start disagreeing about what exists:
 *
 * - the **evidence mode** asks *is this well enough supported to show?* — a
 *   threshold on the claim's classification;
 * - the **evidence timeline** asks *could someone reading public sources have
 *   drawn this on the chosen date?* — established by then, on evidence that
 *   was itself public by then (`publiclyEstablished` in `temporal.ts`).
 *
 * The answer has three values, not two. `solid` is drawn normally. `ghost` is
 * something today's model contains that was not publicly established on the
 * chosen date; it is drawn as a restrained outline, because absence of
 * evidence is not evidence of absence, and a scene that simply removed it
 * would be saying the hangar was not there. `hidden` is what the evidence mode
 * withholds, whatever the date.
 *
 * With no date chosen the timeline reads "now": the model's current state, in
 * which everything the mode admits is solid.
 *
 * Before this module the timeline filter was copy-pasted into four
 * components. It was a year slider then, and it drew twenty-three buildings
 * in 2021 that no cited evidence placed there before September 2025.
 */

import {
  CANVAS_SUBJECT_IDS,
  effectiveClassificationAt,
  isClassificationVisible,
  isSubjectVisible,
  type EvidenceMode,
} from "./evidenceMode";
import { deriveSnapshot, type SnapshotSubject } from "./temporal";

/** Anything the scene draws that can be filtered: it has an id. */
export interface FilterableSubject {
  id: string;
}

export type DrawState = "solid" | "ghost" | "hidden";

/**
 * Snapshots are pure functions of a date and the committed data, and there
 * are only as many dates as the temporal ledger holds, so each is derived once.
 */
const SNAPSHOT_INDEX = new Map<string, ReadonlyMap<string, SnapshotSubject>>();

function snapshotIndex(date: string): ReadonlyMap<string, SnapshotSubject> {
  const cached = SNAPSHOT_INDEX.get(date);
  if (cached !== undefined) return cached;
  const index = new Map(
    deriveSnapshot(date).subjects.map((subject) => [subject.subjectId, subject]),
  );
  SNAPSHOT_INDEX.set(date, index);
  return index;
}

/** The pure form, for tests and for non-React callers such as `measure.ts`. */
export function subjectDrawState(
  subjectId: string,
  snapshotDate: string | null,
  evidenceMode: EvidenceMode,
): DrawState {
  if (!isSubjectVisible(subjectId, evidenceMode)) return "hidden";
  if (snapshotDate === null || CANVAS_SUBJECT_IDS.has(subjectId)) return "solid";
  const subject = snapshotIndex(snapshotDate).get(subjectId);
  // Only layout geometry has a footprint to outline.
  if (subject === undefined) return "hidden";
  if (!subject.publiclyEstablished) return "ghost";
  // Solid only if the class that was knowable *then* is one the mode admits:
  // in observed-only mode the runway is reported in 2021 and observed only
  // once the scene it was measured from is public.
  const classThen = effectiveClassificationAt(subjectId, snapshotDate);
  return classThen !== undefined && isClassificationVisible(classThen, evidenceMode)
    ? "solid"
    : "ghost";
}

export function isSubjectDrawn(
  subject: FilterableSubject,
  snapshotDate: string | null,
  evidenceMode: EvidenceMode,
): boolean {
  return subjectDrawState(subject.id, snapshotDate, evidenceMode) === "solid";
}

/**
 * Whether illustrative scene dressing — the circuit aircraft, patrol vehicles,
 * radar prop, windsock, beacons — is drawn. It is admitted only in the full
 * simulation, and only in the present: it asserts nothing about any date, so
 * an evidence-timeline view of a past date leaves it out rather than placing
 * invented motion in 2021.
 */
export function isSceneDressingVisible(
  snapshotDate: string | null,
  evidenceMode: EvidenceMode,
): boolean {
  return snapshotDate === null && isClassificationVisible("illustrative", evidenceMode);
}
