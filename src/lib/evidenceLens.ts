/**
 * The evidence lens.
 *
 * The twin's thesis is that the boundary between what was observed, reported,
 * interpreted and invented matters — and its picture did not carry it. The
 * default view drew every structure as the same solid building whether a cited
 * scene shows it, a publication reports it, this project assigned it, or it
 * was added so the site reads as a place; only the badge on an opened dossier
 * said which. The evidence *mode* lets a viewer subtract the weaker classes
 * one at a time. The lens lets them see all four at once, each as what it is.
 *
 * Switched on, the scene and the site map paint every solid subject by the
 * classification the ledger gives it — today's, or, at a past evidence-timeline
 * date, the one that was knowable then. That answer comes from
 * `subjectLensClassification` in `drawState.ts`, the one predicate every
 * surface already draws by, so the lens cannot paint a hangar one colour while
 * the dossier calls it another. Ghosts stay ghosts: the lens says how well an
 * established thing is supported; an outline already says it is not.
 *
 * Two rules, both borrowed from the badges and the uncertainty rings:
 *
 * - **Never colour alone.** Each class has a tint *and* a mark: the glyph the
 *   badges use (◆ ■ ▲ ○) on the map, and a line pattern on every edge — solid
 *   for observed, progressively more broken down the ranks — so the lens reads
 *   in greyscale and to a colour-blind reviewer. The patterns are the
 *   identification dashes the minimap already uses for uncertainty, because
 *   identification is derived from the same status (`IDENTIFICATION_BY_STATUS`).
 * - **Nothing here decides anything.** The palette renders the ledger's
 *   classification and nothing else; the tally counts what the scene would
 *   paint, and is the lens's text — on the HUD and on `/analysis` — for anyone
 *   who cannot see the paint.
 */

import {
  EVIDENCE_CLASSIFICATIONS,
  EVIDENCE_CLASSIFICATION_META,
  type EvidenceClassification,
} from "./evidence";
import { ALL_SEGMENTS, APRONS, STRUCTURES } from "./layout";
import { subjectDrawState, subjectLensClassification } from "./drawState";
import type { EvidenceMode } from "./evidenceMode";
import { IDENTIFICATION_BY_STATUS, type UncertaintyLevel } from "./uncertainty";

/**
 * Dash pattern per identification level, in pattern units (CSS pixels on the
 * map, metres times a scale in the scene). Solid where identification is
 * established, progressively broken where it is not. Shared with the minimap's
 * uncertainty rendering so one line texture means one thing everywhere.
 */
export const IDENTIFICATION_DASH: Record<UncertaintyLevel, readonly number[]> = {
  known: [],
  probable: [4, 2],
  possible: [2, 2],
  unknown: [1, 3],
};

/**
 * The tints are the badge tints (`EvidenceUi.tsx`), at full strength so they
 * carry over a lit scene and a dark map. They are a secondary cue: the glyph
 * and the dash pattern beside each carry the meaning on their own.
 */
export const LENS_PALETTE: Record<
  EvidenceClassification,
  { color: string; glyph: string; label: string; dash: readonly number[] }
> = {
  observed: {
    color: "#34d399",
    glyph: EVIDENCE_CLASSIFICATION_META.observed.glyph,
    label: EVIDENCE_CLASSIFICATION_META.observed.label,
    dash: IDENTIFICATION_DASH[IDENTIFICATION_BY_STATUS.observed],
  },
  reported: {
    color: "#38bdf8",
    glyph: EVIDENCE_CLASSIFICATION_META.reported.glyph,
    label: EVIDENCE_CLASSIFICATION_META.reported.label,
    dash: IDENTIFICATION_DASH[IDENTIFICATION_BY_STATUS.reported],
  },
  interpreted: {
    color: "#fbbf24",
    glyph: EVIDENCE_CLASSIFICATION_META.interpreted.glyph,
    label: EVIDENCE_CLASSIFICATION_META.interpreted.label,
    dash: IDENTIFICATION_DASH[IDENTIFICATION_BY_STATUS.interpreted],
  },
  illustrative: {
    color: "#a1a1aa",
    glyph: EVIDENCE_CLASSIFICATION_META.illustrative.glyph,
    label: EVIDENCE_CLASSIFICATION_META.illustrative.label,
    dash: IDENTIFICATION_DASH[IDENTIFICATION_BY_STATUS.illustrative],
  },
};

/** What the lens paints: every structure and parked aircraft, every pavement. */
export const LENS_STRUCTURE_IDS: readonly string[] = STRUCTURES.map(
  (structure) => structure.id,
);
export const LENS_PAVEMENT_IDS: readonly string[] = [...ALL_SEGMENTS, ...APRONS].map(
  (item) => item.id,
);

/** How one group of subjects is painted at a given date and mode. */
export interface LensGroupTally {
  /** Painted solid, by the classification knowable at the date. */
  painted: Record<EvidenceClassification, number>;
  /** In today's model, not publicly established at the date: outlined, not painted. */
  outlined: number;
  /** Withheld by the evidence mode: not drawn at all. */
  withheld: number;
  total: number;
}

export interface LensTally {
  structures: LensGroupTally;
  pavements: LensGroupTally;
}

function tallyGroup(
  subjectIds: readonly string[],
  snapshotDate: string | null,
  evidenceMode: EvidenceMode,
): LensGroupTally {
  const painted: Record<EvidenceClassification, number> = {
    observed: 0,
    reported: 0,
    interpreted: 0,
    illustrative: 0,
  };
  let outlined = 0;
  let withheld = 0;
  for (const subjectId of subjectIds) {
    const state = subjectDrawState(subjectId, snapshotDate, evidenceMode);
    if (state === "hidden") {
      withheld += 1;
      continue;
    }
    const classification = subjectLensClassification(
      subjectId,
      snapshotDate,
      evidenceMode,
    );
    if (classification === undefined) outlined += 1;
    else painted[classification] += 1;
  }
  return { painted, outlined, withheld, total: subjectIds.length };
}

/**
 * What the lens would paint, counted. Derived from the same predicate the
 * scene draws by, so the text and the picture cannot disagree.
 */
export function lensTally(
  snapshotDate: string | null,
  evidenceMode: EvidenceMode,
): LensTally {
  return {
    structures: tallyGroup(LENS_STRUCTURE_IDS, snapshotDate, evidenceMode),
    pavements: tallyGroup(LENS_PAVEMENT_IDS, snapshotDate, evidenceMode),
  };
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function paintedClause(group: LensGroupTally): string {
  return EVIDENCE_CLASSIFICATIONS.map(
    (classification) =>
      `${group.painted[classification]} ${LENS_PALETTE[classification].label.toLowerCase()}`,
  ).join(", ");
}

/**
 * The lens as a sentence: what is painted which colour, what is outlined and
 * what is withheld. Phrased as counts of each, because a view that paints
 * ten invented buildings should say "10 illustrative" where the paint cannot
 * be seen.
 */
export function describeLens(tally: LensTally, snapshotDate: string | null): string {
  const outlined = tally.structures.outlined + tally.pavements.outlined;
  const withheld = tally.structures.withheld + tally.pavements.withheld;
  const when =
    snapshotDate === null
      ? "Painted by status today"
      : `Painted by the status knowable on ${snapshotDate}`;
  const parts = [
    `${when} — ${plural(tally.structures.total, "structure")}: ${paintedClause(tally.structures)}; ${plural(tally.pavements.total, "pavement")}: ${paintedClause(tally.pavements)}.`,
  ];
  if (outlined > 0) parts.push(`${outlined} outlined: not yet established then.`);
  if (withheld > 0) parts.push(`${withheld} withheld by the evidence mode.`);
  return parts.join(" ");
}
