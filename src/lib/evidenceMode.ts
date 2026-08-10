/**
 * Evidence viewing modes.
 *
 * The model draws four kinds of thing at once — what a scene shows, what a
 * publication says, what this project inferred, and what it invented so the
 * place reads as a place — and until now they were distinguishable only by
 * reading a badge on a dossier. A viewer could not ask the question that
 * matters: *show me only what is actually supported.*
 *
 * A mode is a threshold on the evidence classification, nothing more. Each mode
 * adds one weaker class to the one before it, so the four are strictly nested
 * and "step down a mode" always means "show strictly less".
 *
 * Two rules keep this from becoming another place that decides what "observed"
 * means:
 *
 * 1. **Filtering is derived, never re-decided.** Everything here reads
 *    `strongestClassification(getEvidenceForSubject(id))` from the one ledger.
 *    A component asking "should I draw this?" calls `isSubjectVisible`; it does
 *    not compare classifications itself. That is what stops the minimap and the
 *    scene from disagreeing about the same building.
 * 2. **Measurements carry their subject.** A published measurement is an
 *    `observed` record whose subject is the measurement, not the geometry it
 *    measured. Without the link in `MEASURED_GEOMETRY_BY_SUBJECT`, the runway —
 *    the one piece of geometry this project actually measured off a cited
 *    scene — would vanish in observed mode, which would be exactly backwards.
 *
 * What a mode does *not* filter is the terrain surface and the atmosphere.
 * Those are the canvas the analysis is drawn on rather than claims about the
 * site, they are classified in the ledger like everything else (interpreted and
 * illustrative respectively), and hiding them would leave a viewer looking at
 * buildings floating over nothing. `CANVAS_SUBJECT_IDS` names them so the
 * exception is enumerated in one place rather than assumed in several.
 */

import {
  EVIDENCE_CLASSIFICATION_META,
  getEvidenceForSubject,
  strongestClassification,
  type EvidenceClassification,
} from "./evidence";
import { ENVIRONMENT_ENTITY_ID, RUNWAYS, TERRAIN_ENTITY_ID } from "./layout";

export type EvidenceMode = "observed" | "reported" | "interpretation" | "full-simulation";

export const EVIDENCE_MODES: readonly EvidenceMode[] = [
  "observed",
  "reported",
  "interpretation",
  "full-simulation",
];

export const DEFAULT_EVIDENCE_MODE: EvidenceMode = "full-simulation";

/**
 * Each mode's admitted classifications, strictly nested. The glyph exists so
 * the active mode is never signalled by colour alone (WCAG 1.4.1) and is always
 * paired with the label.
 */
export const EVIDENCE_MODE_META: Record<
  EvidenceMode,
  {
    label: string;
    shortLabel: string;
    glyph: string;
    includes: readonly EvidenceClassification[];
    description: string;
  }
> = {
  observed: {
    label: "Observed only",
    shortLabel: "Observed",
    glyph: "◆",
    includes: ["observed"],
    description:
      "Only what a cited public scene shows directly, plus the measurements taken from it. Reported associations remain readable in the source text and in the dossier, but nothing reported, inferred or invented is drawn.",
  },
  reported: {
    label: "Observed + reported",
    shortLabel: "Reported",
    glyph: "■",
    includes: ["observed", "reported"],
    description:
      "Adds features a cited publication states are there. Their placement and dimensions in this model remain an interpretation of that reporting, so they keep their uncertainty and their status label.",
  },
  interpretation: {
    label: "Observed + reported + interpreted",
    shortLabel: "Interpretation",
    glyph: "▲",
    includes: ["observed", "reported", "interpreted"],
    description:
      "Adds identities, functions and dimensions this project assigned. Hypothesised names stay labelled as hypotheses; they are the analysis, not the findings.",
  },
  "full-simulation": {
    label: "Full simulation",
    shortLabel: "Full",
    glyph: "○",
    includes: ["observed", "reported", "interpreted", "illustrative"],
    description:
      "The complete reconstruction, including illustrative infrastructure, vehicles, aircraft motion, atmosphere and scene dressing added so the site reads as a place. None of that last category is an observation of anything on the ground.",
  },
};

const MODE_CLASSIFICATIONS: Record<EvidenceMode, ReadonlySet<EvidenceClassification>> = {
  observed: new Set(EVIDENCE_MODE_META.observed.includes),
  reported: new Set(EVIDENCE_MODE_META.reported.includes),
  interpretation: new Set(EVIDENCE_MODE_META.interpretation.includes),
  "full-simulation": new Set(EVIDENCE_MODE_META["full-simulation"].includes),
};

export function classificationsForMode(
  mode: EvidenceMode,
): ReadonlySet<EvidenceClassification> {
  return MODE_CLASSIFICATIONS[mode];
}

export function isClassificationVisible(
  classification: EvidenceClassification,
  mode: EvidenceMode,
): boolean {
  return MODE_CLASSIFICATIONS[mode].has(classification);
}

/**
 * Geometry that a published measurement is a measurement *of*.
 *
 * Derived from the layout rather than typed out: the runway measurement
 * subjects describe `RUNWAYS[0]`, and if that record's id ever changes this map
 * changes with it.
 */
const MEASURED_GEOMETRY_BY_SUBJECT: ReadonlyMap<string, readonly string[]> = (() => {
  const runwayId = RUNWAYS[0]?.id;
  if (runwayId === undefined) return new Map<string, readonly string[]>();
  return new Map<string, readonly string[]>([
    ["measurement-runway-length", [runwayId]],
    ["measurement-runway-bearing", [runwayId]],
  ]);
})();

/** Reverse index: geometry id → the measurement subjects that measure it. */
const MEASUREMENTS_BY_GEOMETRY: ReadonlyMap<string, readonly string[]> = (() => {
  const index = new Map<string, string[]>();
  for (const [measurementId, geometryIds] of MEASURED_GEOMETRY_BY_SUBJECT) {
    for (const geometryId of geometryIds) {
      const list = index.get(geometryId);
      if (list === undefined) index.set(geometryId, [measurementId]);
      else list.push(measurementId);
    }
  }
  return index;
})();

/**
 * The measurement subjects that measure a piece of geometry, or an empty list.
 *
 * Exported so `forensics.ts` can ask the same question when it decides whether a
 * subject's geometry is defensible. The runway is the one piece of geometry this
 * project actually measured off a cited scene, and it reaches that verdict
 * through this link; re-deriving it there would be a second place that decides
 * what counts as measured.
 */
export function measurementSubjectsForGeometry(geometryId: string): readonly string[] {
  return MEASUREMENTS_BY_GEOMETRY.get(geometryId) ?? [];
}

/**
 * Subjects that are always drawn, whatever the mode.
 *
 * The ground and the sky are the medium the analysis is presented in, not
 * assertions about the site. Their own classification is published in the
 * ledger, in the dossier and in the `/analysis` table exactly like everything
 * else — the exception is only about whether they are *drawn*.
 */
export const CANVAS_SUBJECT_IDS: ReadonlySet<string> = new Set([
  TERRAIN_ENTITY_ID,
  ENVIRONMENT_ENTITY_ID,
]);

/**
 * The classification a subject is filtered on: the strongest class asserted
 * about it, or about any measurement taken of it.
 */
export function effectiveClassification(
  subjectId: string,
): EvidenceClassification | undefined {
  const own = getEvidenceForSubject(subjectId);
  const measurements = (MEASUREMENTS_BY_GEOMETRY.get(subjectId) ?? []).flatMap(
    (measurementId) => getEvidenceForSubject(measurementId),
  );
  return strongestClassification([...own, ...measurements]);
}

/**
 * Whether a subject is drawn in a mode.
 *
 * A subject with no evidence record at all is treated as illustrative: it is
 * something the model added without a claim behind it, which is the definition.
 * The validator separately requires every structure to carry a record, so this
 * branch covers scene dressing rather than a gap in the ledger.
 */
export function isSubjectVisible(subjectId: string, mode: EvidenceMode): boolean {
  if (CANVAS_SUBJECT_IDS.has(subjectId)) return true;
  const classification = effectiveClassification(subjectId) ?? "illustrative";
  return isClassificationVisible(classification, mode);
}

/** How many of a set of subjects a mode admits. Used for the mode readout. */
export function evidenceModeCounts(
  subjectIds: readonly string[],
  mode: EvidenceMode,
): { visible: number; hidden: number; total: number } {
  let visible = 0;
  for (const subjectId of subjectIds) {
    if (isSubjectVisible(subjectId, mode)) visible += 1;
  }
  return { visible, hidden: subjectIds.length - visible, total: subjectIds.length };
}

/**
 * A one-line statement of what the mode is currently hiding, for the HUD and
 * the accessible view. Deliberately phrased as a count of *withheld* subjects:
 * a viewer needs to know that a mode is subtracting from the scene, and how
 * much, or the filter becomes a way to mislead yourself.
 */
export function describeEvidenceMode(
  subjectIds: readonly string[],
  mode: EvidenceMode,
): string {
  const { visible, hidden, total } = evidenceModeCounts(subjectIds, mode);
  const meta = EVIDENCE_MODE_META[mode];
  if (hidden === 0) {
    return `${meta.label}: showing all ${total} modeled subjects.`;
  }
  return `${meta.label}: showing ${visible} of ${total} modeled subjects; ${hidden} withheld as ${classesBelow(
    mode,
  )
    .map((classification) =>
      EVIDENCE_CLASSIFICATION_META[classification].label.toLowerCase(),
    )
    .join(", ")}.`;
}

/** Classifications a mode excludes, strongest first. */
export function classesBelow(mode: EvidenceMode): readonly EvidenceClassification[] {
  const included = MODE_CLASSIFICATIONS[mode];
  return (["observed", "reported", "interpreted", "illustrative"] as const).filter(
    (classification) => !included.has(classification),
  );
}

/** Narrow an untrusted string to a mode, for URL parameters and stored state. */
export function parseEvidenceMode(value: unknown): EvidenceMode | null {
  return typeof value === "string" &&
    (EVIDENCE_MODES as readonly string[]).includes(value)
    ? (value as EvidenceMode)
    : null;
}
