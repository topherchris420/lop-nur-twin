/**
 * One predicate that decides whether a modeled thing is drawn.
 *
 * Two independent filters are in play and they answer different questions:
 *
 * - the **timeline year**, which asks *was this here yet?*, and
 * - the **evidence mode**, which asks *is this well enough supported to show?*
 *
 * They compose, and every surface has to compose them the same way, or the
 * scene, the minimap, the structure index and the measurement ruler start
 * disagreeing about what exists. Before this module the timeline filter was
 * copy-pasted into four components; adding a second filter to four places would
 * have made that four opportunities to get it wrong.
 *
 * The hook subscribes to the two store slices it needs and nothing else, so a
 * camera move or a selection change does not re-run it.
 */

import { useCallback } from "react";
import { isVisibleAtTimelineYear, type TemporalDef } from "./layout";
import { isSubjectVisible, type EvidenceMode } from "./evidenceMode";
import { useTwinStore } from "./store";

/** Anything the scene draws that can be filtered: it has an id and may have a date. */
export interface FilterableSubject extends TemporalDef {
  id: string;
}

/** The pure form, for tests and for non-React callers such as `measure.ts`. */
export function isSubjectDrawn(
  subject: FilterableSubject,
  timelineYear: number,
  evidenceMode: EvidenceMode,
): boolean {
  return (
    isVisibleAtTimelineYear(subject, timelineYear) &&
    isSubjectVisible(subject.id, evidenceMode)
  );
}

/**
 * The predicate the scene uses. Stable across renders for a given
 * (year, mode) pair, so it can be passed straight into a `useMemo` dependency
 * list without invalidating it every frame.
 */
export function useSubjectFilter(): (subject: FilterableSubject) => boolean {
  const timelineYear = useTwinStore((state) => state.activeTimelineYear);
  const evidenceMode = useTwinStore((state) => state.evidenceMode);
  return useCallback(
    (subject: FilterableSubject) => isSubjectDrawn(subject, timelineYear, evidenceMode),
    [timelineYear, evidenceMode],
  );
}
