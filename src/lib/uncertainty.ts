/**
 * Structured uncertainty.
 *
 * Every claim in the ledger already carries a classification and a confidence
 * rank. Neither says *how wrong the geometry could be*, and until now the only
 * answer to that lived in prose: a free-text sentence per subject saying things
 * like "names, functions, heights and fine geometry are illustrative". That
 * sentence is honest and unusable — you cannot draw it, sort by it, or diff two
 * builds on it.
 *
 * This module turns what the project *already documents* into a machine-readable
 * envelope, and it is built around one rule that matters more than the rest:
 *
 *   **Unknown stays unknown.**
 *
 * There are exactly three places a number in an envelope can come from, and the
 * `basis` field on every envelope names which one it was:
 *
 * - `stated-in-source` — the cited publication states the figure. No envelope
 *   uses this today: the aircraft reporting says its dimensions "carry at least
 *   a few feet of error", which is a caveat, not a number.
 * - `project-documented` — the project documents the figure itself, in
 *   `SITE_PROFILE` and in `KNOWN_LIMITATIONS`. Today that is the ±40 m runway
 *   endpoint uncertainty, and it is the only positional number in the model.
 * - `derived-from-source-resolution` — a *floor* computed from the ground sample
 *   distance of the cited scene. A footprint traced from 10 m imagery cannot be
 *   resolved finer than one pixel, so 10 m is a lower bound on how well the
 *   extent is known. It is deliberately not called a measured footprint error,
 *   because it is not one: it is the resolution limit of the instrument the
 *   footprint was read off.
 *
 * Height and orientation are documented nowhere, so `heightMeters` and
 * `orientationDegrees` are absent from every envelope this model emits and the
 * UI prints "not stated" for them. That absence is the point — inventing a
 * plausible ±2 m would make the model look better and be worth less.
 *
 * The two ordinal fields (`identification`, `function`) are *derived* from the
 * subject's declared evidence status through the table in
 * `IDENTIFICATION_BY_STATUS` / `FUNCTION_BY_STATUS`. They are ranks, not
 * probabilities, in exactly the same sense as `CONFIDENCE_SCALE`. The mapping is
 * documented in `docs/UNCERTAINTY_MODEL.md` and is the single place that decides
 * what "we know what this is" means.
 */

import { SITE_PROFILE, type Evidence, type EvidenceStatus } from "./siteData";

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

/**
 * How well something is pinned down. An ordinal, ordered
 * `known > probable > possible > unknown`. It ranks the support behind a
 * statement; it is not a probability and must never be presented as one.
 */
export type UncertaintyLevel = "known" | "probable" | "possible" | "unknown";

export const UNCERTAINTY_LEVELS: readonly UncertaintyLevel[] = [
  "known",
  "probable",
  "possible",
  "unknown",
];

/** Where a numeric uncertainty came from. Required whenever one is present. */
export type UncertaintyBasis =
  "stated-in-source" | "project-documented" | "derived-from-source-resolution";

export const UNCERTAINTY_BASES: readonly UncertaintyBasis[] = [
  "stated-in-source",
  "project-documented",
  "derived-from-source-resolution",
];

export const UNCERTAINTY_BASIS_LABELS: Record<UncertaintyBasis, string> = {
  "stated-in-source": "Figure stated by the cited source",
  "project-documented": "Figure documented by this project",
  "derived-from-source-resolution":
    "Resolution floor derived from the cited scene's ground sample distance",
};

export const UNCERTAINTY_LEVEL_META: Record<
  UncertaintyLevel,
  { label: string; glyph: string; description: string }
> = {
  known: {
    label: "Known",
    // Glyphs exist so an uncertainty level is never carried by colour alone
    // (WCAG 1.4.1). They are decorative and always paired with the word.
    glyph: "▮▮▮",
    description:
      "Established by a cited source. For a footprint this means presence and rough extent, never interior use.",
  },
  probable: {
    label: "Probable",
    glyph: "▮▮▯",
    description:
      "A cited publication states it, but this model's placement or dimensions remain an interpretation of that reporting.",
  },
  possible: {
    label: "Possible",
    glyph: "▮▯▯",
    description:
      "Assigned by this project from available evidence. A hypothesis to be tested, not a finding.",
  },
  unknown: {
    label: "Unknown",
    glyph: "▯▯▯",
    description:
      "Not established by anything cited. Printed as unknown rather than estimated.",
  },
};

export interface UncertaintyEnvelope {
  /**
   * Positional uncertainty of the modeled point, in metres. Present only where
   * the project documents a figure; absent means unknown, not zero.
   */
  horizontalMeters?: number;
  /** Uncertainty in the modeled footprint extent, in metres. */
  footprintMeters?: number;
  /** Never populated: no cited source states a height tolerance for anything here. */
  heightMeters?: number;
  /** Never populated: no cited source states an orientation tolerance. */
  orientationDegrees?: number;
  /**
   * Earliest date the subject could have existed. Almost always absent: a first
   * appearance in imagery bounds when something appeared *by*, never when it
   * was built.
   */
  earliestDate?: string;
  /** Latest date by which the subject is established to have existed, ISO `YYYY-MM-DD`. */
  latestDate?: string;
  /** How well the subject is identified as the thing this model names it. */
  identification: UncertaintyLevel;
  /** How well the subject's function or use is established. */
  function: UncertaintyLevel;
  /** True only where two cited sources are recorded as disagreeing. */
  sourceDisagreement?: boolean;
  /** How the numeric fields were arrived at. Required whenever one is present. */
  method?: string;
  /** Which of the three provenance classes the numbers belong to. */
  basis?: UncertaintyBasis;
  /** The project's own free-text caveat, carried through verbatim. */
  narrative?: string;
  /** Sources supporting the envelope, in declaration order. */
  sourceIds: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Evidence status to identification rank.
 *
 * `observed` maps to `known` because visibility in a cited scene establishes
 * that the feature is there and roughly how big it is — which is precisely what
 * `EVIDENCE_CLASSIFICATION_META.observed` already says and no more.
 */
const IDENTIFICATION_BY_STATUS: Record<EvidenceStatus, UncertaintyLevel> = {
  observed: "known",
  reported: "probable",
  interpreted: "possible",
  illustrative: "unknown",
};

/**
 * Evidence status to functional-certainty rank.
 *
 * `observed` maps to `unknown`, not `known`. Overhead imagery establishes that
 * a building exists; it establishes nothing whatsoever about what happens
 * inside it. Collapsing these two columns is the single most common way an
 * imagery-derived model overstates itself.
 */
const FUNCTION_BY_STATUS: Record<EvidenceStatus, UncertaintyLevel> = {
  observed: "unknown",
  reported: "possible",
  interpreted: "possible",
  illustrative: "unknown",
};

const RESOLUTION_FLOOR_METHOD =
  "Lower bound on resolvable footprint detail: the ground sample distance of the cited scene. Not a measured footprint error — the true error is unknown and is at least this large.";

const ENDPOINT_UNCERTAINTY_METHOD = `Positional uncertainty documented by this project for features registered off the pinned public scene: ±${SITE_PROFILE.runway.endpointUncertaintyM} m, the figure published in SITE_PROFILE and in the known-limitations list.`;

/**
 * The envelope for a subject whose evidence is declared in the layout.
 *
 * `observedDate` is the asset-visibility date — the date the thing is first
 * visible in a cited scene — and it becomes `latestDate`, never `earliestDate`.
 * Seeing a building on a given day proves it existed by then and says nothing
 * about when it was built, so the earlier bound stays absent.
 */
export function deriveUncertainty(
  evidence: Evidence,
  options: { observedDate?: string } = {},
): UncertaintyEnvelope {
  const latestDate = options.observedDate ?? evidence.observedOn;
  const resolutionM = evidence.resolutionM;

  const numeric: Pick<UncertaintyEnvelope, "footprintMeters" | "method" | "basis"> = {};
  if (resolutionM !== undefined && Number.isFinite(resolutionM) && resolutionM > 0) {
    numeric.footprintMeters = resolutionM;
    numeric.method = RESOLUTION_FLOOR_METHOD;
    numeric.basis = "derived-from-source-resolution";
  }

  return {
    ...numeric,
    // Illustrative content is not a claim about the site at all, so it carries
    // no temporal bound even when its source register entry has a date.
    ...(latestDate === undefined || evidence.status === "illustrative"
      ? {}
      : { latestDate }),
    identification: IDENTIFICATION_BY_STATUS[evidence.status],
    function: FUNCTION_BY_STATUS[evidence.status],
    ...(evidence.uncertainty === undefined ? {} : { narrative: evidence.uncertainty }),
    sourceIds: evidence.sourceIds,
  };
}

/**
 * The envelope for a published measurement, which is the one place this model
 * has a real positional number to state.
 */
export function measurementUncertainty(options: {
  sourceIds: readonly string[];
  sourceResolutionM?: number;
  latestDate?: string;
  narrative?: string;
}): UncertaintyEnvelope {
  return {
    horizontalMeters: SITE_PROFILE.runway.endpointUncertaintyM,
    ...(options.sourceResolutionM === undefined
      ? {}
      : { footprintMeters: options.sourceResolutionM }),
    ...(options.latestDate === undefined ? {} : { latestDate: options.latestDate }),
    identification: "known",
    function: "unknown",
    method: ENDPOINT_UNCERTAINTY_METHOD,
    basis: "project-documented",
    ...(options.narrative === undefined ? {} : { narrative: options.narrative }),
    sourceIds: options.sourceIds,
  };
}

/** The envelope for procedural content: nothing about it is a claim. */
export function illustrativeUncertainty(
  sourceIds: readonly string[] = [],
): UncertaintyEnvelope {
  return {
    identification: "unknown",
    function: "unknown",
    narrative:
      "Illustrative content. It models no real feature, so there is no positional or temporal uncertainty to state.",
    sourceIds,
  };
}

/* ------------------------------------------------------------------ */
/* Presentation helpers                                                */
/* ------------------------------------------------------------------ */

/** True when the envelope carries at least one number. */
export function hasNumericUncertainty(envelope: UncertaintyEnvelope): boolean {
  return (
    envelope.horizontalMeters !== undefined ||
    envelope.footprintMeters !== undefined ||
    envelope.heightMeters !== undefined ||
    envelope.orientationDegrees !== undefined
  );
}

/**
 * The radius, in metres, of the spatial envelope worth drawing around a
 * subject — the larger of its positional uncertainty and its footprint
 * resolution floor. Returns undefined when the model documents neither, which
 * is the signal for the scene to draw nothing rather than draw a guess.
 */
export function uncertaintyRadiusM(envelope: UncertaintyEnvelope): number | undefined {
  const candidates = [envelope.horizontalMeters, envelope.footprintMeters].filter(
    (value): value is number =>
      value !== undefined && Number.isFinite(value) && value > 0,
  );
  return candidates.length === 0 ? undefined : Math.max(...candidates);
}

/** "±40 m position; 10 m footprint floor" — or "not stated". */
export function formatUncertainty(envelope: UncertaintyEnvelope): string {
  const parts: string[] = [];
  if (envelope.horizontalMeters !== undefined) {
    parts.push(`±${envelope.horizontalMeters} m position`);
  }
  if (envelope.footprintMeters !== undefined) {
    parts.push(`${envelope.footprintMeters} m footprint floor`);
  }
  if (envelope.heightMeters !== undefined) {
    parts.push(`±${envelope.heightMeters} m height`);
  }
  if (envelope.orientationDegrees !== undefined) {
    parts.push(`±${envelope.orientationDegrees}° orientation`);
  }
  return parts.length === 0 ? "not stated" : parts.join("; ");
}

/**
 * The temporal bound in words. Deliberately verbose about which end is known:
 * "existed by 2025-09-13; first construction date unknown" is the true
 * statement, and "2025-09-13" on its own reads as a build date.
 */
export function formatTemporalBound(envelope: UncertaintyEnvelope): string {
  const { earliestDate, latestDate } = envelope;
  if (earliestDate === undefined && latestDate === undefined) return "not stated";
  if (earliestDate === undefined) {
    return `existed by ${latestDate ?? "unknown"}; earliest date unknown`;
  }
  if (latestDate === undefined)
    return `no earlier than ${earliestDate}; latest date unknown`;
  return `between ${earliestDate} and ${latestDate}`;
}
