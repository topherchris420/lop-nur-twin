/**
 * The React face of `drawState.ts`: hooks that read the evidence-timeline date
 * and the evidence mode from the store and hand back a stable predicate. The
 * rules themselves — what is solid, what is a ghost, what is hidden — live in
 * the pure module, so the measurement ruler and the build scripts apply them
 * without React.
 */

import { useCallback } from "react";
import {
  isSceneDressingVisible,
  isSubjectDrawn,
  subjectDrawState,
  type DrawState,
  type FilterableSubject,
} from "./drawState";
import { useTwinStore } from "./store";

export {
  isSceneDressingVisible,
  isSubjectDrawn,
  subjectDrawState,
  type DrawState,
  type FilterableSubject,
} from "./drawState";

/**
 * The predicate the scene uses: true for subjects drawn solid. Stable across
 * renders for a given (date, mode) pair, so it can be passed straight into a
 * `useMemo` dependency list without invalidating it every frame.
 */
export function useSubjectFilter(): (subject: FilterableSubject) => boolean {
  const snapshotDate = useTwinStore((state) => state.snapshotDate);
  const evidenceMode = useTwinStore((state) => state.evidenceMode);
  return useCallback(
    (subject: FilterableSubject) => isSubjectDrawn(subject, snapshotDate, evidenceMode),
    [snapshotDate, evidenceMode],
  );
}

/** The three-valued form, for the ghost layer and the minimap. */
export function useSubjectDrawState(): (subjectId: string) => DrawState {
  const snapshotDate = useTwinStore((state) => state.snapshotDate);
  const evidenceMode = useTwinStore((state) => state.evidenceMode);
  return useCallback(
    (subjectId: string) => subjectDrawState(subjectId, snapshotDate, evidenceMode),
    [snapshotDate, evidenceMode],
  );
}

export function useSceneDressingVisible(): boolean {
  const snapshotDate = useTwinStore((state) => state.snapshotDate);
  const evidenceMode = useTwinStore((state) => state.evidenceMode);
  return isSceneDressingVisible(snapshotDate, evidenceMode);
}
