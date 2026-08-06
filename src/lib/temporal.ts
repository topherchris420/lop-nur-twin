/**
 * The temporal evidence ledger, snapshots, and change comparison.
 *
 * The 3D twin already has a timeline: a year slider that hides anything whose
 * `observedDate` is later than the selected year. That is useful and it is also
 * the whole extent of the model's sense of time, and it quietly conflates three
 * different dates that this module keeps apart:
 *
 * 1. **When something happened at the site.** Almost never known. A first
 *    appearance in a cited scene bounds when a building existed *by*; it says
 *    nothing about when it was built. So a first-appearance event carries a
 *    `latestDate` and no `earliestDate`, and the UI is required to say
 *    "existed by" rather than printing the date on its own.
 * 2. **When the evidence became public.** Precisely known, because it is the
 *    publication date in the source register. This is the date that decides
 *    what an analyst could have concluded at a given moment, and it is what
 *    makes a snapshot mean something beyond "which buildings were drawn".
 * 3. **When the change entered this model.** A fact about this repository, not
 *    about the site. Events that carry it are scoped `model-only-change` and
 *    are never mixed into a site claim.
 *
 * Every event here is derived from data that already exists — `observedDate` on
 * layout records, `publishedOn` and `accessedOn` in the source register — and
 * no date is invented. Where the repository has no temporal evidence for a
 * category (a removed structure, a reclassification, a withdrawn claim), the
 * category exists in the schema and the ledger is empty for it. An empty
 * category is a coverage gap that the interface shows; it is not something to
 * fill in with plausible history.
 */

import {
  ALL_SEGMENTS,
  APRONS,
  MISSION_SITE_ID,
  STRUCTURES,
  isAircraft,
  type ApronDef,
  type SegmentDef,
  type StructureDef,
} from "./layout";
import { PUBLIC_SOURCES, getSource, type SourceId } from "./siteData";
import {
  CONFIDENCE_SCALE,
  getEvidenceForSubject,
  strongestClassification,
  type EvidenceClassification,
  type EvidenceRecord,
} from "./evidence";
import { UNCERTAINTY_LEVELS, type UncertaintyEnvelope } from "./uncertainty";

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

export type TemporalEventCategory =
  /** First visible in a cited public scene. Bounds existence, not construction. */
  | "first-appearance"
  /** A cited source describes an existing feature growing. */
  | "footprint-expansion"
  /** Resurfacing or other change to a modeled pavement, per cited reporting. */
  | "pavement-change"
  /** An aircraft reported present on a stated date by a cited publication. */
  | "reported-aircraft-sighting"
  /** A structure a cited source describes as newly built. */
  | "structure-added"
  /** A structure a cited source describes as gone. */
  | "structure-removed"
  /** A source became publicly available. A fact about the evidence, not the site. */
  | "evidence-publication"
  /** This project changed how a claim is classified. */
  | "reclassification"
  /** A claim this project has corrected or withdrawn. */
  | "correction-or-withdrawal"
  /** A change to the model that asserts nothing about the site. */
  | "model-only-change";

export const TEMPORAL_EVENT_CATEGORIES: readonly TemporalEventCategory[] = [
  "first-appearance",
  "footprint-expansion",
  "pavement-change",
  "reported-aircraft-sighting",
  "structure-added",
  "structure-removed",
  "evidence-publication",
  "reclassification",
  "correction-or-withdrawal",
  "model-only-change",
];

/**
 * What kind of statement an event is.
 *
 * The spec this follows names two scopes; a third is necessary here because
 * "a source was published" is a real-world fact that is emphatically *not* a
 * claim that anything at the site changed, and folding it into either of the
 * other two would recreate the conflation this module exists to remove.
 */
export type TemporalScope =
  /** Asserts something was true of the site. */
  | "real-site-claim"
  /** Asserts when evidence became publicly available. */
  | "evidence-availability"
  /** Asserts something about this model only. */
  | "model-only-change";

export const TEMPORAL_SCOPES: readonly TemporalScope[] = [
  "real-site-claim",
  "evidence-availability",
  "model-only-change",
];

export const TEMPORAL_SCOPE_META: Record<
  TemporalScope,
  { label: string; glyph: string; description: string }
> = {
  "real-site-claim": {
    label: "Site claim",
    glyph: "◆",
    description:
      "Asserts something was true of the real site by a given date. Bounded by what a cited source establishes, which is usually one end of a range.",
  },
  "evidence-availability": {
    label: "Evidence published",
    glyph: "❖",
    description:
      "Records when a source became publicly available. Says nothing about when the thing it describes happened.",
  },
  "model-only-change": {
    label: "Model only",
    glyph: "○",
    description:
      "A fact about this reconstruction, not about the site. Illustrative content and modeling decisions live here.",
  },
};

export interface TemporalEvidenceEvent {
  id: string;
  subjectId: string;
  /**
   * Earliest date the event could have occurred. Absent for almost everything
   * here: imagery bounds the late end of a range, never the early end.
   */
  earliestDate?: string;
  /** Latest date by which the event had occurred. Absent means unknown. */
  latestDate?: string;
  /** The one date the evidence actually pins, where it pins one. */
  bestSupportedDate?: string;
  category: TemporalEventCategory;
  /** State before the event, in plain language. */
  before?: string;
  /** State after the event, in plain language. */
  after?: string;
  evidenceClass: EvidenceClassification;
  sourceIds: readonly string[];
  confidence?: number;
  uncertainty?: UncertaintyEnvelope;
  analystNote?: string;
  /**
   * Which release of this model first carried the change. The repository has
   * never recorded per-feature model history, so this is absent throughout and
   * `temporalCoverageGaps()` says so rather than filling it with the current
   * version, which would be a guess dressed as provenance.
   */
  modelVersionIntroduced?: string;
  /** When the evidence behind this event became public, where a source states it. */
  publicationDate?: string;
  scope: TemporalScope;
}

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a syntactically valid ISO calendar date. Nothing else is a date here. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return false;
  // `Date.parse` accepts 2025-02-30 and rolls it forward, so round-trip it.
  return new Date(timestamp).toISOString().slice(0, 10) === value;
}

/** The earliest publication date among a set of sources, or undefined. */
function earliestPublication(sourceIds: readonly string[]): string | undefined {
  // `publishedOn` is a literal union across the register (one member is
  // `undefined`), so the map is widened before the guard narrows it.
  const dates: readonly (string | undefined)[] = sourceIds.map(
    (id) => getSource(id as SourceId)?.publishedOn,
  );
  return dates.filter((date): date is string => date !== undefined).sort()[0];
}

function subjectClassification(subjectId: string): EvidenceClassification {
  return strongestClassification(getEvidenceForSubject(subjectId)) ?? "illustrative";
}

function subjectConfidence(subjectId: string): number | undefined {
  const records = getEvidenceForSubject(subjectId);
  if (records.length === 0) return undefined;
  return records.reduce((best, record) => Math.max(best, record.confidence), 0);
}

function subjectSourceIds(subjectId: string): readonly string[] {
  const ids: readonly (string | undefined)[] = getEvidenceForSubject(subjectId).map(
    (record) => record.sourceId,
  );
  return [...new Set(ids.filter((id): id is string => id !== undefined))].sort();
}

function subjectUncertainty(subjectId: string): UncertaintyEnvelope | undefined {
  return getEvidenceForSubject(subjectId).find(
    (record) => record.uncertainty !== undefined,
  )?.uncertainty;
}

/**
 * Events for a dated layout record.
 *
 * The category is chosen from what the record *is* — an aircraft on an apron is
 * a sighting, a taxiway carrying a date the reporting attributes to resurfacing
 * is a pavement change, everything else is a first appearance. The distinction
 * matters because a sighting is emphatically not a construction event: an
 * aircraft parked outside a hangar on one date says nothing about any other
 * date.
 */
function datedLayoutEvent(
  record: (StructureDef | SegmentDef | ApronDef) & { observedDate?: string },
  category: TemporalEventCategory,
  label: string,
  after: string,
): TemporalEvidenceEvent | undefined {
  const observedDate = record.observedDate;
  if (observedDate === undefined || !isIsoDate(observedDate)) return undefined;
  const sourceIds = subjectSourceIds(record.id);
  const confidence = subjectConfidence(record.id);
  const uncertainty = subjectUncertainty(record.id);
  const publicationDate = earliestPublication(sourceIds);

  return {
    id: `te-${record.id}-${category}-${observedDate}`,
    subjectId: record.id,
    // No `earliestDate`: a scene showing something on a date proves it existed
    // by then and nothing at all about when it started existing.
    latestDate: observedDate,
    category,
    before: "Not resolved in any cited scene this model holds before this date.",
    after,
    evidenceClass: subjectClassification(record.id),
    sourceIds,
    ...(confidence === undefined ? {} : { confidence }),
    ...(uncertainty === undefined ? {} : { uncertainty }),
    analystNote: `${label} The date is when the feature is first visible in a cited public scene, not a construction date; the construction date is unknown.`,
    ...(publicationDate === undefined ? {} : { publicationDate }),
    scope: "real-site-claim",
  };
}

function layoutEvents(): TemporalEvidenceEvent[] {
  const events: TemporalEvidenceEvent[] = [];

  for (const structure of STRUCTURES) {
    const aircraft = isAircraft(structure.type);
    const event = datedLayoutEvent(
      structure,
      aircraft ? "reported-aircraft-sighting" : "first-appearance",
      aircraft
        ? `${structure.name} is reported present in imagery of this date.`
        : `${structure.name} is first visible in a cited scene of this date.`,
      aircraft
        ? "Reported parked at the modeled position on this date only. No presence is asserted on any other date."
        : "Modeled as present from this date onward.",
    );
    if (event !== undefined) events.push(event);
  }

  for (const segment of ALL_SEGMENTS) {
    // The cited 2025 reporting attributes the taxiway dates to resurfacing of
    // pavement that was already there, so those are changes rather than first
    // appearances. Nothing else in the segment list carries that attribution.
    const category: TemporalEventCategory =
      segment.kind === "taxiway" ? "pavement-change" : "first-appearance";
    const event = datedLayoutEvent(
      segment,
      category,
      category === "pavement-change"
        ? `${segment.name} is covered by reporting of resurfaced taxiways in mid-2025.`
        : `${segment.name} is visible in a cited scene of this date.`,
      category === "pavement-change"
        ? "Modeled as resurfaced pavement. The reporting establishes that work happened, not the modeled centreline or width."
        : "Modeled as present from this date onward.",
    );
    if (event !== undefined) events.push(event);
  }

  for (const apron of APRONS) {
    const event = datedLayoutEvent(
      apron,
      "first-appearance",
      `${apron.name} is visible in a cited scene of this date.`,
      "Modeled as present from this date onward.",
    );
    if (event !== undefined) events.push(event);
  }

  return events;
}

/**
 * One event per source that states a publication date.
 *
 * These are the events that make "what could have been concluded when" a
 * question with an answer. They are scoped `evidence-availability` so nothing
 * downstream can mistake a publication for a change at the site — the CSIS
 * analysis published in 2026 discusses imagery from 2020, and a ledger that
 * cannot express that distinction is worse than no ledger.
 */
function publicationEvents(): TemporalEvidenceEvent[] {
  const events: TemporalEvidenceEvent[] = [];
  for (const source of PUBLIC_SOURCES) {
    const publishedOn = source.publishedOn;
    if (publishedOn === undefined || !isIsoDate(publishedOn)) continue;
    events.push({
      id: `te-publication-${source.id}`,
      subjectId: MISSION_SITE_ID,
      // A publication date is one of the few things here that is exactly known.
      earliestDate: publishedOn,
      latestDate: publishedOn,
      bestSupportedDate: publishedOn,
      category: "evidence-publication",
      before: "Not available to a public-source analyst before this date.",
      after: `Publicly available: ${source.title} (${source.publisher}).`,
      evidenceClass: source.role === "reporting" ? "reported" : "observed",
      sourceIds: [source.id],
      analystNote: `Publication date only. It bounds when this evidence became usable, not when anything it describes occurred; this project last consulted the source on ${source.accessedOn}.`,
      publicationDate: publishedOn,
      scope: "evidence-availability",
    });
  }
  return events;
}

/**
 * Model-only records for content that exists in the reconstruction but makes no
 * claim about the site.
 *
 * They carry no dates, and that is the information: an illustrative solar field
 * has no appearance date because it has never appeared anywhere. Emitting them
 * keeps the "site claim versus model decision" split visible in the comparison
 * interface instead of leaving illustrative content silently mixed in.
 */
function modelOnlyEvents(): TemporalEvidenceEvent[] {
  const events: TemporalEvidenceEvent[] = [];
  for (const structure of STRUCTURES) {
    if (structure.evidence.status !== "illustrative") continue;
    events.push({
      id: `te-${structure.id}-model-only-change`,
      subjectId: structure.id,
      category: "model-only-change",
      after: `${structure.name} is present in the reconstruction as illustrative content.`,
      evidenceClass: "illustrative",
      sourceIds: [],
      analystNote:
        "Illustrative content with no date of any kind. It is not resolved in the cited imagery, so it has no appearance date, and this repository does not record when it was added to the model.",
      scope: "model-only-change",
    });
  }
  return events;
}

/**
 * The ledger, sorted so every consumer sees the same order: by date where one
 * exists, undated events last, ties broken on id.
 */
export const TEMPORAL_LEDGER: readonly TemporalEvidenceEvent[] = Object.freeze(
  [...layoutEvents(), ...publicationEvents(), ...modelOnlyEvents()].sort((a, b) => {
    const left = a.latestDate ?? "9999-12-31";
    const right = b.latestDate ?? "9999-12-31";
    if (left !== right) return left < right ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }),
);

/** Every distinct date the ledger can be snapshotted at, ascending. */
export const TEMPORAL_SNAPSHOT_DATES: readonly string[] = Object.freeze(
  [
    ...new Set(
      TEMPORAL_LEDGER.flatMap((event) =>
        [event.earliestDate, event.latestDate, event.bestSupportedDate].filter(
          (date): date is string => date !== undefined,
        ),
      ),
    ),
  ].sort(),
);

export function temporalEventsForSubject(
  subjectId: string,
): readonly TemporalEvidenceEvent[] {
  return TEMPORAL_LEDGER.filter((event) => event.subjectId === subjectId);
}

/** Categories the schema supports for which the repository holds no evidence. */
export function temporalCoverageGaps(): readonly TemporalEventCategory[] {
  const populated = new Set(TEMPORAL_LEDGER.map((event) => event.category));
  return TEMPORAL_EVENT_CATEGORIES.filter((category) => !populated.has(category));
}

/* ------------------------------------------------------------------ */
/* Snapshots                                                           */
/* ------------------------------------------------------------------ */

export type SubjectPresence =
  /** Established to have existed by the snapshot date. */
  | "established"
  /** Modeled, but the earliest cited evidence for it is later than this date. */
  | "not-yet-evidenced"
  /** In the model with no date of any kind. Presence at any date is unknown. */
  | "undated";

export interface SnapshotSubject {
  subjectId: string;
  label: string;
  presence: SubjectPresence;
  /** The date the subject is established by, when one exists. */
  establishedBy?: string;
  /**
   * Classification supportable by evidence *published* on or before the
   * snapshot date. Undefined when nothing was public yet.
   */
  evidenceClass?: EvidenceClassification;
  confidence?: number;
  sourceIds: readonly string[];
  uncertainty?: UncertaintyEnvelope;
  /** True when the subject asserts nothing about the site. */
  modelOnly: boolean;
}

export interface TemporalSnapshot {
  date: string;
  subjects: readonly SnapshotSubject[];
  /** Events whose latest bound falls on or before the snapshot date. */
  events: readonly TemporalEvidenceEvent[];
  /** Sources public on or before the snapshot date, ascending by id. */
  publishedSourceIds: readonly string[];
}

function subjectLabel(subjectId: string): string {
  const structure = STRUCTURES.find((item) => item.id === subjectId);
  if (structure !== undefined) return structure.name;
  const segment = ALL_SEGMENTS.find((item) => item.id === subjectId);
  if (segment !== undefined) return segment.name;
  const apron = APRONS.find((item) => item.id === subjectId);
  if (apron !== undefined) return apron.name;
  return subjectId;
}

/**
 * Every subject the snapshot machinery reasons about: the geometry that can
 * carry a date. Sorted by id so a snapshot's subject order never depends on the
 * order the layout happens to declare things in.
 */
const SNAPSHOT_SUBJECT_IDS: readonly string[] = Object.freeze(
  [
    ...STRUCTURES.map((structure) => structure.id),
    ...ALL_SEGMENTS.map((segment) => segment.id),
    ...APRONS.map((apron) => apron.id),
  ].sort(),
);

/** Records whose citing source was public on or before `date`. */
function recordsPublishedBy(subjectId: string, date: string): readonly EvidenceRecord[] {
  return getEvidenceForSubject(subjectId).filter((record) => {
    // A model-internal record has no publication date and is available to the
    // model at all times; it is also never a claim about the site.
    if (record.sourceDate === undefined) return record.sourceUrl === undefined;
    return record.sourceDate <= date;
  });
}

/** Distinct citing sources across a record set, ascending. */
function availableSourceIds(records: readonly EvidenceRecord[]): readonly string[] {
  const ids: readonly (string | undefined)[] = records.map((record) => record.sourceId);
  return [...new Set(ids.filter((id): id is string => id !== undefined))].sort();
}

/**
 * The best-supported modeled state at a date.
 *
 * Two independent things are resolved per subject and they are deliberately not
 * merged: whether the subject is *established* to have existed by then, and
 * what the evidence *public* by then would have supported. A hangar can be
 * established by a September 2025 scene while the reporting that identifies it
 * was not published until November — and an analyst standing in October could
 * not have written the November sentence.
 */
export function deriveSnapshot(date: string): TemporalSnapshot {
  if (!isIsoDate(date)) {
    throw new TypeError(
      `Snapshot date "${date}" must be an ISO YYYY-MM-DD calendar date`,
    );
  }

  const establishedBySubject = new Map<string, string>();
  for (const event of TEMPORAL_LEDGER) {
    if (event.scope !== "real-site-claim" || event.latestDate === undefined) continue;
    const current = establishedBySubject.get(event.subjectId);
    // Keep the *earliest* bound: the first date the subject is established by.
    if (current === undefined || event.latestDate < current) {
      establishedBySubject.set(event.subjectId, event.latestDate);
    }
  }

  const modelOnlySubjects = new Set(
    TEMPORAL_LEDGER.filter((event) => event.scope === "model-only-change").map(
      (event) => event.subjectId,
    ),
  );

  const subjects = SNAPSHOT_SUBJECT_IDS.map((subjectId): SnapshotSubject => {
    const establishedBy = establishedBySubject.get(subjectId);
    const presence: SubjectPresence =
      establishedBy === undefined
        ? "undated"
        : establishedBy <= date
          ? "established"
          : "not-yet-evidenced";

    const available = recordsPublishedBy(subjectId, date);
    const evidenceClass = strongestClassification(available);
    const confidence =
      available.length === 0
        ? undefined
        : available.reduce((best, record) => Math.max(best, record.confidence), 0);

    return {
      subjectId,
      label: subjectLabel(subjectId),
      presence,
      ...(establishedBy === undefined ? {} : { establishedBy }),
      ...(evidenceClass === undefined ? {} : { evidenceClass }),
      ...(confidence === undefined ? {} : { confidence }),
      sourceIds: availableSourceIds(available),
      ...(available[0]?.uncertainty === undefined
        ? {}
        : { uncertainty: available[0].uncertainty }),
      modelOnly: modelOnlySubjects.has(subjectId),
    };
  });

  return {
    date,
    subjects,
    events: TEMPORAL_LEDGER.filter(
      (event) => event.latestDate !== undefined && event.latestDate <= date,
    ),
    publishedSourceIds: PUBLIC_SOURCES.filter(
      (source) => source.publishedOn !== undefined && source.publishedOn <= date,
    )
      .map((source) => source.id)
      .sort(),
  };
}

/* ------------------------------------------------------------------ */
/* Change comparison                                                   */
/* ------------------------------------------------------------------ */

export type SubjectChangeKind =
  | "added"
  | "removed"
  | "evidence-class-changed"
  | "confidence-changed"
  | "uncertainty-changed"
  | "sources-changed";

export interface SubjectChange {
  subjectId: string;
  label: string;
  kind: SubjectChangeKind;
  before: string;
  after: string;
  /** True when the change is about this model rather than about the site. */
  modelOnly: boolean;
}

export interface SnapshotComparison {
  from: string;
  to: string;
  /** True when the two dates are the same, or nothing differs between them. */
  empty: boolean;
  changes: readonly SubjectChange[];
  addedSourceIds: readonly string[];
  removedSourceIds: readonly string[];
  /** Events falling strictly inside the interval, in ledger order. */
  eventsInWindow: readonly TemporalEvidenceEvent[];
}

function describeUncertainty(envelope: UncertaintyEnvelope | undefined): string {
  if (envelope === undefined) return "none recorded";
  const parts: string[] = [];
  if (envelope.horizontalMeters !== undefined) {
    parts.push(`±${envelope.horizontalMeters} m position`);
  }
  if (envelope.footprintMeters !== undefined) {
    parts.push(`${envelope.footprintMeters} m footprint floor`);
  }
  parts.push(`identification ${envelope.identification}`);
  parts.push(`function ${envelope.function}`);
  return parts.join("; ");
}

/**
 * Difference between two snapshots.
 *
 * The comparison is symmetric and total: `to` earlier than `from` is a
 * legitimate question ("what did we lose confidence in?") and produces
 * `removed` entries rather than an error. Output order is deterministic —
 * subjects by id, then change kind in the order declared above — so the same
 * pair of dates always yields a byte-identical result.
 */
export function compareSnapshots(from: string, to: string): SnapshotComparison {
  const before = deriveSnapshot(from);
  const after = deriveSnapshot(to);
  const beforeById = new Map(
    before.subjects.map((subject) => [subject.subjectId, subject]),
  );
  const afterById = new Map(
    after.subjects.map((subject) => [subject.subjectId, subject]),
  );

  const changes: SubjectChange[] = [];
  const subjectIds = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();

  for (const subjectId of subjectIds) {
    const left = beforeById.get(subjectId);
    const right = afterById.get(subjectId);
    if (left === undefined || right === undefined) continue;

    const label = right.label;
    const modelOnly = right.modelOnly;
    const wasPresent = left.presence === "established";
    const isPresent = right.presence === "established";

    if (!wasPresent && isPresent) {
      changes.push({
        subjectId,
        label,
        kind: "added",
        before: `not established (${left.presence})`,
        after: `established by ${right.establishedBy ?? "unknown"}`,
        modelOnly,
      });
    } else if (wasPresent && !isPresent) {
      changes.push({
        subjectId,
        label,
        kind: "removed",
        before: `established by ${left.establishedBy ?? "unknown"}`,
        after: `not established (${right.presence})`,
        modelOnly,
      });
    }

    if (left.evidenceClass !== right.evidenceClass) {
      changes.push({
        subjectId,
        label,
        kind: "evidence-class-changed",
        before: left.evidenceClass ?? "no published evidence",
        after: right.evidenceClass ?? "no published evidence",
        modelOnly,
      });
    }
    if (left.confidence !== right.confidence) {
      changes.push({
        subjectId,
        label,
        kind: "confidence-changed",
        before: left.confidence?.toFixed(2) ?? "none",
        after: right.confidence?.toFixed(2) ?? "none",
        modelOnly,
      });
    }
    const leftUncertainty = describeUncertainty(left.uncertainty);
    const rightUncertainty = describeUncertainty(right.uncertainty);
    if (leftUncertainty !== rightUncertainty) {
      changes.push({
        subjectId,
        label,
        kind: "uncertainty-changed",
        before: leftUncertainty,
        after: rightUncertainty,
        modelOnly,
      });
    }
    const leftSources = left.sourceIds.join(", ");
    const rightSources = right.sourceIds.join(", ");
    if (leftSources !== rightSources) {
      changes.push({
        subjectId,
        label,
        kind: "sources-changed",
        before: leftSources.length === 0 ? "none published" : leftSources,
        after: rightSources.length === 0 ? "none published" : rightSources,
        modelOnly,
      });
    }
  }

  const beforeSources = new Set(before.publishedSourceIds);
  const afterSources = new Set(after.publishedSourceIds);
  const addedSourceIds = after.publishedSourceIds
    .filter((id) => !beforeSources.has(id))
    .sort();
  const removedSourceIds = before.publishedSourceIds
    .filter((id) => !afterSources.has(id))
    .sort();

  const [low, high] = from <= to ? [from, to] : [to, from];
  const eventsInWindow = TEMPORAL_LEDGER.filter(
    (event) =>
      event.latestDate !== undefined &&
      event.latestDate > low &&
      event.latestDate <= high,
  );

  return {
    from,
    to,
    empty:
      changes.length === 0 &&
      addedSourceIds.length === 0 &&
      removedSourceIds.length === 0,
    changes,
    addedSourceIds,
    removedSourceIds,
    eventsInWindow,
  };
}

/** Weakest identification level across a snapshot, for a headline readout. */
export function snapshotWeakestIdentification(snapshot: TemporalSnapshot): string {
  let worst = 0;
  for (const subject of snapshot.subjects) {
    if (subject.uncertainty === undefined) continue;
    worst = Math.max(
      worst,
      UNCERTAINTY_LEVELS.indexOf(subject.uncertainty.identification),
    );
  }
  return UNCERTAINTY_LEVELS[worst] ?? "unknown";
}

/** Count of subjects established by the snapshot date. */
export function snapshotEstablishedCount(snapshot: TemporalSnapshot): number {
  return snapshot.subjects.filter((subject) => subject.presence === "established").length;
}

/** The confidence scale is shared, so a snapshot readout cannot invent its own. */
export const SNAPSHOT_CONFIDENCE_SCALE = CONFIDENCE_SCALE;
