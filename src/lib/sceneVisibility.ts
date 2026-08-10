/**
 * One place that decides whether a modeled thing is drawn, and how.
 *
 * This began as a single predicate over two filters and has become the
 * composer for six, which is the same job done properly rather than a different
 * one. The filters answer different questions and every surface has to compose
 * them identically, or the scene, the minimap, the structure index and the
 * measurement ruler start disagreeing about what exists:
 *
 * - the **timeline year** — *was this here yet?*
 * - the **evidence mode** — *is this well enough supported to show at all?*
 * - the **time scrubber** — *what had been publicly evidenced on this date?*
 * - **X-ray** — *how certain should this look compared to everything else?*
 * - **PROVE IT** — *could this be defended if someone challenged it?*
 * - the **forensic diff** — *did this change between the two dates being compared?*
 *
 * Before this module the timeline filter was copy-pasted into four components;
 * adding five more filters to four places would have been twenty opportunities
 * to get it wrong. So there is exactly one function that answers "how do I draw
 * this?", it returns a whole presentation rather than a boolean, and a component
 * that wants to know anything about a subject's appearance calls it.
 *
 * Two rules hold the composition together:
 *
 * 1. **Every stage may only weaken.** The stages run in a fixed order and each
 *    one can hide a subject, ghost it, or eat further into it — never the
 *    reverse. A subject cannot become more solid further down the pipeline, so
 *    no combination of controls can make something look better supported than
 *    the ledger says it is.
 * 2. **Withholding is always explained.** Every presentation carries the
 *    `reason` it looks the way it does, in words, and the accessible surfaces
 *    print it. A view that silently subtracts from a scene is a way to mislead
 *    yourself, which is the same reason the evidence mode reports its own
 *    hidden count.
 *
 * The hooks subscribe to the store slices they need and nothing else, so a
 * camera move or a selection change does not re-run them.
 */

import { useCallback, useMemo } from "react";
import { isVisibleAtTimelineYear, type TemporalDef } from "./layout";
import {
  effectiveClassification,
  isSubjectVisible,
  CANVAS_SUBJECT_IDS,
  type EvidenceMode,
} from "./evidenceMode";
import type { EvidenceClassification } from "./evidence";
import { survivesProveIt, getDefensibility } from "./forensics";
import {
  presenceAt,
  scrubStateAtDay,
  SCRUB_PRESENCE_META,
  type ScrubPresence,
  type ScrubState,
} from "./timeScrubber";
import { xrayTreatment, type XrayMode } from "./xray";
import { useTwinStore } from "./store";

/** Anything the scene draws that can be filtered: it has an id and may have a date. */
export interface FilterableSubject extends TemporalDef {
  id: string;
}

/** Whether the detailed model is drawn, a schematic shell, or nothing at all. */
export type BodyMode = "solid" | "ghost" | "hidden";

export interface SubjectPresentation {
  id: string;
  /** False when nothing at all is drawn for this subject. */
  visible: boolean;
  body: BodyMode;
  /** Altitude the subject is lifted to by X-ray stratification, in metres. */
  liftM: number;
  /** Shell opacity when ghosted. Meaningless when `body` is `solid`. */
  opacity: number;
  /** How much of the shell is eaten away, 0-1. */
  dissolve: number;
  classification: EvidenceClassification;
  presence: ScrubPresence;
  /** True when a strict reading of the cited evidence defends this geometry. */
  defensible: boolean;
  /** Why it looks like this, in one sentence. Printed by the accessible views. */
  reason: string;
}

/** The state the composer reads. Passed explicitly so it stays pure and testable. */
export interface ForensicViewState {
  timelineYear: number;
  evidenceMode: EvidenceMode;
  xrayMode: XrayMode;
  xrayFocus: EvidenceClassification | null;
  proveIt: boolean;
  /** Playhead position in days, or null when the scrubber is parked. */
  scrubDay: number | null;
  /**
   * True while the reference overlay is showing the source scene alone. The
   * model's own geometry steps aside so the evidence can be seen unmodeled,
   * which is the baseline every other view is a departure from.
   */
  referenceOnly: boolean;
}

const SOLID: Omit<
  SubjectPresentation,
  "id" | "classification" | "presence" | "defensible" | "reason"
> = {
  visible: true,
  body: "solid",
  liftM: 0,
  opacity: 1,
  dissolve: 0,
};

function hidden(
  id: string,
  classification: EvidenceClassification,
  presence: ScrubPresence,
  defensible: boolean,
  reason: string,
): SubjectPresentation {
  return {
    id,
    visible: false,
    body: "hidden",
    liftM: 0,
    opacity: 0,
    dissolve: 1,
    classification,
    presence,
    defensible,
    reason,
  };
}

/**
 * The pure form, for tests and for non-React callers such as `measure.ts`.
 *
 * Stage order is load-bearing and is the order they are written in: existence,
 * then support, then defensibility, then time, then appearance. PROVE IT runs
 * before the scrubber because a subject nothing defends should disappear
 * whatever date is selected — the two questions are independent and the
 * stricter answer wins.
 */
export function subjectPresentation(
  subject: FilterableSubject,
  state: ForensicViewState,
  scrubState: ScrubState | null,
): SubjectPresentation {
  const classification = effectiveClassification(subject.id) ?? "illustrative";
  const defensible = survivesProveIt(subject.id);
  const presence: ScrubPresence =
    state.scrubDay === null ? "established" : presenceAt(scrubState, subject.id);

  // 1. Existence in the construction timeline.
  if (!isVisibleAtTimelineYear(subject, state.timelineYear)) {
    return hidden(
      subject.id,
      classification,
      presence,
      defensible,
      `Not drawn: its earliest cited appearance is later than the selected timeline year ${state.timelineYear}.`,
    );
  }

  // 2. The evidence-mode threshold.
  if (!isSubjectVisible(subject.id, state.evidenceMode)) {
    return hidden(
      subject.id,
      classification,
      presence,
      defensible,
      `Withheld by the evidence mode: it is ${classification}, and the current mode draws only better-supported classes.`,
    );
  }

  // 3. Reference-only. Nothing modeled is drawn over the source scene.
  if (state.referenceOnly) {
    return hidden(
      subject.id,
      classification,
      presence,
      defensible,
      "Hidden while the registered reference scene is shown alone: this is what the public evidence looks like before anything was modeled from it.",
    );
  }

  // 4. PROVE IT. The strictest reading there is, and it overrides appearance:
  //    a subject that survives is drawn plainly, without X-ray dressing, because
  //    the point of the mode is what is left rather than how it looks.
  if (state.proveIt) {
    if (!defensible) {
      const verdict = getDefensibility(subject.id);
      return hidden(
        subject.id,
        classification,
        presence,
        false,
        verdict === undefined
          ? "Removed by PROVE IT: it carries no evidence record of its own, so nothing cited defends it."
          : `Removed by PROVE IT: ${verdict.statement}`,
      );
    }
    return {
      ...SOLID,
      id: subject.id,
      classification,
      presence,
      defensible: true,
      reason:
        getDefensibility(subject.id)?.statement ??
        "Retained by PROVE IT: cited evidence defends this geometry.",
    };
  }

  // 5. The time scrubber. Undated subjects deliberately stay drawn as uncertain
  //    rather than appearing or disappearing: this project does not know when
  //    they arrived, and popping them in on an arbitrary date would be a claim.
  if (state.scrubDay !== null && presence !== "established") {
    const meta = SCRUB_PRESENCE_META[presence];
    if (presence === "pre-evidence" || presence === "not-yet-evidenced") {
      return {
        id: subject.id,
        visible: true,
        body: "ghost",
        liftM: 0,
        opacity: 0.12,
        dissolve: 0.82,
        classification,
        presence,
        defensible,
        reason: `${meta.label} at the scrub date: ${meta.description}`,
      };
    }
    // Undated: drawn, but never as though its presence on this date were known.
    return {
      id: subject.id,
      visible: true,
      body: "ghost",
      liftM: 0,
      opacity: 0.3,
      dissolve: 0.5,
      classification,
      presence,
      defensible,
      reason: `${meta.label}: ${meta.description}`,
    };
  }

  // 6. Appearance. X-ray decides how certain this is allowed to look.
  const treatment = xrayTreatment(classification, state.xrayMode, state.xrayFocus);
  return {
    id: subject.id,
    visible: true,
    body: treatment.body,
    liftM: treatment.liftM,
    opacity: treatment.opacity,
    dissolve: treatment.dissolve,
    classification,
    presence,
    defensible,
    reason:
      state.xrayMode === "off"
        ? `Drawn as built. Classified ${classification} in the evidence ledger.`
        : treatment.reading,
  };
}

/** The original predicate, kept for callers that only need a boolean. */
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

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

/** The forensic controls, as one object. Re-renders only when one of them moves. */
export function useForensicViewState(): ForensicViewState {
  const timelineYear = useTwinStore((state) => state.activeTimelineYear);
  const evidenceMode = useTwinStore((state) => state.evidenceMode);
  const xrayMode = useTwinStore((state) => state.xrayMode);
  const xrayFocus = useTwinStore((state) => state.xrayFocus);
  const proveIt = useTwinStore((state) => state.proveIt);
  const scrubDay = useTwinStore((state) => state.scrubDay);
  const showReference = useTwinStore((state) => state.showReference);
  const referenceMode = useTwinStore((state) => state.reference.mode);
  const referenceLoaded = useTwinStore((state) => state.reference.objectUrl !== null);
  // Reference-only only takes effect once a scene is actually loaded; otherwise
  // picking the mode would empty the scene and show nothing in its place.
  const referenceOnly =
    showReference && referenceLoaded && referenceMode === "reference-only";
  return useMemo(
    () => ({
      timelineYear,
      evidenceMode,
      xrayMode,
      xrayFocus,
      proveIt,
      scrubDay,
      referenceOnly,
    }),
    [timelineYear, evidenceMode, xrayMode, xrayFocus, proveIt, scrubDay, referenceOnly],
  );
}

/** The scrub state at the current playhead, memoised on the day. */
export function useScrubState(): ScrubState | null {
  const scrubDay = useTwinStore((state) => state.scrubDay);
  return useMemo(
    () => (scrubDay === null ? null : scrubStateAtDay(scrubDay)),
    [scrubDay],
  );
}

/**
 * The presentation function the scene uses. Stable for a given control state,
 * so it can be passed straight into a `useMemo` dependency list without
 * invalidating it every frame.
 */
export function useSubjectPresentation(): (
  subject: FilterableSubject,
) => SubjectPresentation {
  const state = useForensicViewState();
  const scrubState = useScrubState();
  return useCallback(
    (subject: FilterableSubject) => subjectPresentation(subject, state, scrubState),
    [state, scrubState],
  );
}

/**
 * The predicate, unchanged in behaviour for callers that only ask "is this
 * drawn at all?" — now derived from the composer so it cannot disagree with it.
 */
export function useSubjectFilter(): (subject: FilterableSubject) => boolean {
  const present = useSubjectPresentation();
  return useCallback((subject: FilterableSubject) => present(subject).visible, [present]);
}

/** Canvas subjects are exempt from filtering; named here so callers can check. */
export function isCanvasSubject(subjectId: string): boolean {
  return CANVAS_SUBJECT_IDS.has(subjectId);
}
