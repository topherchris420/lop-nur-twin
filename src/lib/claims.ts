/**
 * The claim inspector: one subject, answered as a set of questions.
 *
 * The dossier used to be a data dump — dimensions, a datum, a list of records,
 * a block of decorative "mission entity" capabilities. Everything a reviewer
 * needed was in it somewhere, and none of it was organised around the question
 * the reviewer actually has, which is *how much of this do we know?*
 *
 * `inspectClaim` reorganises what the ledger already says into those
 * questions — what is this, why is it here, what supports it, what does the
 * evidence establish, what does this model infer, what stays unknown, and when
 * — and it derives every answer. Nothing here is written per subject:
 *
 * - the classification, sources, dates and confidence come from the ledger
 *   (`evidence.ts`) and its knowability rule;
 * - the uncertainty comes from the merged envelope (`uncertainty.ts`);
 * - the timeline state comes from the snapshot (`temporal.ts`);
 * - the three lists are fixed sentences chosen by classification and by
 *   which envelope fields are absent, so an unknown can only ever be reported
 *   as unknown.
 *
 * The 3D dossier and `/analysis` both render this, so the two front doors
 * cannot answer the same question differently.
 */

import {
  EVIDENCE_CLASSIFICATION_META,
  EVIDENCE_LEDGER,
  MEASUREMENT_SUBJECT_LABELS,
  MODEL_INTERNAL_SOURCE_ID,
  getEvidenceForSubject,
  getUncertaintyForSubject,
  recordKnowability,
  strongestClassification,
  earliestKnowableDate,
  type EvidenceClassification,
  type EvidenceRecord,
  type EvidenceSubjectKind,
} from "./evidence";
import {
  SITE_SUBJECT_ID,
  getSiteSubject,
  getStructure,
  STRUCTURE_TYPE_LABELS,
} from "./layout";
import { OFFSITE_CONTEXT, getSource, type SourceId } from "./siteData";
import { deriveSnapshot, isIsoDate } from "./temporal";
import { modelEntryFor, type ModelEntryAnswer } from "./modelHistory";
import {
  UNCERTAINTY_LEVEL_META,
  formatTemporalBound,
  type UncertaintyEnvelope,
} from "./uncertainty";

export interface ClaimSupport {
  recordId: string;
  sourceId: string;
  title: string;
  publisher?: string;
  url?: string;
  classification: EvidenceClassification;
  confidence: number;
  /** Publication date the source states, or undefined. */
  published?: string;
  /** When this claim could first have been made from this source, if placed on the timeline. */
  knowableFrom?: string;
  /** The model's own definition, not a publication. */
  modelInternal: boolean;
  resolutionM?: number;
  measurementUncertaintyM?: number;
  notes?: string;
}

export type TimelineStanding =
  /** Established by the date on evidence public by then. Drawn solid. */
  | "publicly-established"
  /** Established by the date in hindsight, but the evidence was not yet public. */
  | "established-not-yet-public"
  /** The earliest evidence for it is later than the date. */
  | "not-yet-evidenced"
  /** No date of any kind: never established anywhere. */
  | "undated";

export interface ClaimAtDate {
  date: string;
  standing: TimelineStanding;
  /** One sentence saying what someone reading public sources on that date could say. */
  statement: string;
}

export interface ClaimInspection {
  subjectId: string;
  label: string;
  typeLabel?: string;
  description?: string;
  modelBasis?: string;
  classification: EvidenceClassification;
  /** "Observed in cited public imagery", and so on. */
  statement: string;
  /** What the classification means here, in the project's own words. */
  meaning: string;
  support: readonly ClaimSupport[];
  methodReferences: readonly { sourceId: string; title: string }[];
  establishes: readonly string[];
  infers: readonly string[];
  unknown: readonly string[];
  uncertainty?: UncertaintyEnvelope;
  dates: {
    /** "existed by …; earliest date unknown", or "not stated". */
    siteEvent: string;
    /** Earliest publication among the attesting sources, if any states one. */
    firstPublished?: string;
    /** Earliest date any claim about it could have been made. */
    knowableFrom?: string;
    /** When it entered this model and what has changed since, from `model-history/`. */
    modelEntry: ModelEntryAnswer;
  };
  relationships: readonly { kind: string; targetId: string; targetLabel: string }[];
  atDate?: ClaimAtDate;
}

/**
 * Every subject the ledger makes a claim about, sorted by id: structures,
 * pavements, measurements, the site, its terrain and climatology, off-site
 * context and the illustrative scenario elements. The inspector answers for
 * each of them, not only for buildings.
 */
export const CLAIM_SUBJECT_IDS: readonly string[] = Object.freeze(
  [...new Set(EVIDENCE_LEDGER.map((record) => record.subjectId))].sort(),
);

const CLAIM_SUBJECT_SET: ReadonlySet<string> = new Set(CLAIM_SUBJECT_IDS);

export function isClaimSubject(subjectId: string): boolean {
  return CLAIM_SUBJECT_SET.has(subjectId);
}

/** A subject's human name, from whichever registry holds it. */
export function claimSubjectLabel(subjectId: string): string {
  return (
    getStructure(subjectId)?.name ??
    getSiteSubject(subjectId)?.label ??
    OFFSITE_CONTEXT.find((place) => place.id === subjectId)?.name ??
    MEASUREMENT_SUBJECT_LABELS[subjectId as keyof typeof MEASUREMENT_SUBJECT_LABELS] ??
    subjectId
  );
}

function supportOf(record: EvidenceRecord): ClaimSupport {
  const knowability = recordKnowability(record);
  return {
    recordId: record.id,
    sourceId: record.sourceId ?? "unresolved",
    title: record.sourceTitle,
    ...(record.sourcePublisher === undefined
      ? {}
      : { publisher: record.sourcePublisher }),
    ...(record.sourceUrl === undefined ? {} : { url: record.sourceUrl }),
    classification: record.classification,
    confidence: record.confidence,
    ...(record.sourceDate === undefined ? {} : { published: record.sourceDate }),
    ...(knowability.kind === "from" ? { knowableFrom: knowability.date } : {}),
    modelInternal: record.sourceId === MODEL_INTERNAL_SOURCE_ID,
    ...(record.sourceResolutionM === undefined
      ? {}
      : { resolutionM: record.sourceResolutionM }),
    ...(record.measurementUncertaintyM === undefined
      ? {}
      : { measurementUncertaintyM: record.measurementUncertaintyM }),
    ...(record.analystNotes === undefined ? {} : { notes: record.analystNotes }),
  };
}

function publishersOf(records: readonly EvidenceRecord[], classification: string) {
  return [
    ...new Set(
      records
        .filter((record) => record.classification === classification)
        .map((record) => record.sourcePublisher ?? record.sourceTitle),
    ),
  ];
}

/**
 * What the cited evidence itself supports. Deliberately narrow: visibility
 * establishes presence and rough extent, reporting establishes that a
 * publication says so, and nothing in this project establishes a function.
 */
function establishedBy(
  classification: EvidenceClassification,
  records: readonly EvidenceRecord[],
): string[] {
  const lines: string[] = [];
  const observers = publishersOf(records, "observed");
  const reporters = publishersOf(records, "reported");
  if (observers.length > 0) {
    lines.push(
      `Presence and rough extent, visible in imagery from ${observers.join(", ")}.`,
    );
  }
  if (reporters.length > 0) {
    lines.push(`That it exists, as stated by ${reporters.join(", ")}.`);
  }
  if (lines.length === 0) {
    lines.push(
      classification === "illustrative"
        ? "Nothing. It is not resolved in any cited source."
        : "Nothing outright. No cited source shows or states this identity; the project assigned it.",
    );
  }
  return lines;
}

/**
 * What this model adds, and what stays unknown, for subjects that are not a
 * thing built at the site. Each sentence restates what the ledger's own
 * records and notes say about that kind of subject, so the inspector cannot
 * claim more for a climatology or a terrain proxy than the ledger does.
 */
const NOT_BUILT: Partial<
  Record<EvidenceSubjectKind | "site", { infers: string; unknown: string }>
> = {
  measurement: {
    infers:
      "The figure is this project's reading of the cited scene, with endpoints placed at its resolution; it is not an aeronautical survey.",
    unknown: "Positional error: not stated.",
  },
  environment: {
    infers:
      "How the monthly means drive the scene's light, wind and haze is this project's rendering of them.",
    unknown:
      "Conditions on any particular day: these are long-term monthly means for a grid cell, not a local station or a forecast.",
  },
  terrain: {
    infers:
      "The rendered relief is a seeded procedural proxy around one sampled height; it is not survey elevation.",
    unknown:
      "The real surface's relief: one elevation near the runway centre is sampled, nothing more.",
  },
  context: {
    infers: "Nothing is modeled: it is regional context and is not drawn in this scene.",
    unknown: "Its extent and layout: this project does not reconstruct it.",
  },
  site: {
    infers:
      "The layout inside the frame is this project's tracing of the cited scene; no building function inside it is established by it.",
    unknown:
      "What the facility is for: neither the layout nor the reporting establishes a function.",
  },
  simulation: {
    infers: "",
    unknown:
      "Everything about the real site: this element is not a claim about the ground.",
  },
};

/** The site itself is a context record, but it is not off-site context. */
function notBuiltKind(
  subjectId: string,
  recordKind: EvidenceSubjectKind | undefined,
): EvidenceSubjectKind | "site" | undefined {
  return subjectId === SITE_SUBJECT_ID ? "site" : recordKind;
}

/** What this model adds on top of the evidence. */
function inferredBy(
  classification: EvidenceClassification,
  envelope: UncertaintyEnvelope | undefined,
  recordKind: EvidenceSubjectKind | "site" | undefined,
): string[] {
  const own = recordKind === undefined ? undefined : NOT_BUILT[recordKind];
  // A scenario element is illustrative, and the illustrative sentence below
  // already says the one true thing about it.
  if (own !== undefined && recordKind !== "simulation") return [own.infers];
  switch (classification) {
    case "observed":
      return ["Exact position, height and form are modeled, not measured."];
    case "reported":
      return [
        "Placement, dimensions and form are modeled from the reporting, not surveyed.",
        ...(envelope === undefined
          ? []
          : [
              `Function: ${UNCERTAINTY_LEVEL_META[envelope.function].label.toLowerCase()} — ${UNCERTAINTY_LEVEL_META[envelope.function].description}`,
            ]),
      ];
    case "interpreted":
      return [
        "Identity, dimensions and function were assigned by this project — a hypothesis to be tested, not a finding.",
      ];
    case "illustrative":
      return [
        "Nothing is inferred: this was added so the site reads as a place, and is not a claim about the ground.",
      ];
  }
}

/** What stays unknown, read off the envelope's absent fields. */
function unknownFor(
  subjectKind: string | undefined,
  recordKind: EvidenceSubjectKind | "site" | undefined,
  envelope: UncertaintyEnvelope | undefined,
): string[] {
  if (envelope === undefined)
    return ["Everything about the real site: no envelope is recorded."];
  const lines: string[] = [];
  // When a thing was built and what it is for are questions about things that
  // are built; asked of a measurement or a climatology they read as gaps in
  // knowledge that are not the gaps that matter.
  const own = recordKind === undefined ? undefined : NOT_BUILT[recordKind];
  if (own !== undefined) {
    if (recordKind === "measurement") {
      return [
        envelope.horizontalMeters === undefined
          ? "Positional error: not stated."
          : `Anything finer than its stated ±${envelope.horizontalMeters} m.`,
      ];
    }
    return [own.unknown];
  }
  if (envelope.earliestDate === undefined) {
    lines.push(
      envelope.latestDate === undefined
        ? "When it came to exist, if it exists at all."
        : "When it was built. Imagery bounds only the date it existed by.",
    );
  }
  if (envelope.identification === "unknown") lines.push("What it is.");
  if (envelope.function === "unknown") lines.push("What it is used for.");
  if (subjectKind === "structure" || subjectKind === "aircraft") {
    lines.push("Interior use and occupancy: overhead imagery never establishes them.");
  }
  if (envelope.horizontalMeters === undefined) {
    lines.push(
      envelope.footprintMeters === undefined
        ? "Positional error: not stated."
        : `Positional error: not stated beyond a ${envelope.footprintMeters} m resolution floor.`,
    );
  }
  if (envelope.heightMeters === undefined) lines.push("Height tolerance: not stated.");
  if (envelope.orientationDegrees === undefined) {
    lines.push("Orientation tolerance: not stated.");
  }
  return lines;
}

function standingAt(subjectId: string, date: string): ClaimAtDate | undefined {
  const subject = deriveSnapshot(date).subjects.find(
    (candidate) => candidate.subjectId === subjectId,
  );
  if (subject === undefined) return undefined;
  const knowable = earliestKnowableDate(subjectId);
  if (subject.publiclyEstablished) {
    return {
      date,
      standing: "publicly-established",
      statement: `Established by ${subject.establishedBy ?? "this date"} on evidence that was public by ${date}.`,
    };
  }
  if (subject.presence === "established") {
    return {
      date,
      standing: "established-not-yet-public",
      statement: `It existed by ${subject.establishedBy ?? "this date"} — but that is hindsight: no evidence of it was public on ${date}${knowable === undefined ? "" : ` (the first was on ${knowable})`}. Drawn as an outline.`,
    };
  }
  if (subject.presence === "not-yet-evidenced") {
    return {
      date,
      standing: "not-yet-evidenced",
      statement: `Nothing cited establishes it by ${date}; the earliest evidence is dated ${subject.establishedBy ?? "later"}. That is absence of evidence, not evidence of absence. Drawn as an outline.`,
    };
  }
  return {
    date,
    standing: "undated",
    statement:
      "It has no date of any kind: it is not established on this date or any other. Drawn as an outline in every past view.",
  };
}

/**
 * Everything the inspector shows about one subject, or undefined when the
 * ledger holds nothing about it. `snapshotDate` adds the timeline answer.
 */
export function inspectClaim(
  subjectId: string,
  snapshotDate: string | null = null,
): ClaimInspection | undefined {
  const records = getEvidenceForSubject(subjectId);
  const classification = strongestClassification(records);
  if (classification === undefined) return undefined;

  const structure = getStructure(subjectId);
  const subject = getSiteSubject(subjectId);
  const envelope = getUncertaintyForSubject(subjectId);
  const meta = EVIDENCE_CLASSIFICATION_META[classification];
  // Only a record that is a claim about the site has an evidence date. An
  // illustrative record may name the scene it was checked against, and that
  // scene's date is not when anything about it became public.
  const firstPublished = records
    .filter((record) => recordKnowability(record).kind === "from")
    .map((record) => record.sourceDate)
    .filter((date): date is string => date !== undefined)
    .sort()[0];
  const knowableFrom = earliestKnowableDate(subjectId);
  const atDate =
    snapshotDate !== null && isIsoDate(snapshotDate)
      ? standingAt(subjectId, snapshotDate)
      : undefined;

  // What a non-structure subject *is* is the claim the ledger makes about it,
  // in the ledger's own words: the strongest record's sentence.
  const claimSentence = records.find(
    (record) => record.classification === classification,
  )?.claim;
  return {
    subjectId,
    label: claimSubjectLabel(subjectId),
    ...(structure === undefined
      ? claimSentence === undefined
        ? {}
        : { description: claimSentence }
      : {
          typeLabel: STRUCTURE_TYPE_LABELS[structure.type],
          description: structure.description,
          modelBasis: structure.evidence.method ?? structure.modelBasis,
        }),
    classification,
    statement: meta.statement,
    meaning: meta.description,
    support: records.map(supportOf),
    methodReferences: (envelope?.methodSourceIds ?? []).map((sourceId) => ({
      sourceId,
      title: getSource(sourceId as SourceId)?.title ?? sourceId,
    })),
    establishes: establishedBy(classification, records),
    infers: inferredBy(
      classification,
      envelope,
      notBuiltKind(subjectId, records[0]?.subjectKind),
    ),
    unknown: unknownFor(
      subject?.kind,
      notBuiltKind(subjectId, records[0]?.subjectKind),
      envelope,
    ),
    ...(envelope === undefined ? {} : { uncertainty: envelope }),
    dates: {
      siteEvent: envelope === undefined ? "not stated" : formatTemporalBound(envelope),
      ...(firstPublished === undefined ? {} : { firstPublished }),
      ...(knowableFrom === undefined ? {} : { knowableFrom }),
      modelEntry: modelEntryFor(subjectId),
    },
    relationships: (subject?.relationships ?? []).map((relationship) => ({
      kind: relationship.kind,
      targetId: relationship.targetId,
      targetLabel: getSiteSubject(relationship.targetId)?.label ?? relationship.targetId,
    })),
    ...(atDate === undefined ? {} : { atDate }),
  };
}
