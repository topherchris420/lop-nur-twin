/**
 * Defensibility: what a cited source actually carries, versus what the model draws.
 *
 * Every other module here answers "how well supported is this claim?" on an
 * ordinal scale. This one answers a harder and much less flattering question:
 *
 *   *If someone challenged this reconstruction, which parts of it could be
 *   defended from the cited public evidence, and which parts would have to be
 *   withdrawn?*
 *
 * The two questions come apart because the reconstruction renders nine
 * different attributes of every subject — that it exists, where it is, how far
 * it extends, how tall it is, what shape it is, what it is made of, what it is
 * for, what is inside it, and what happens there — while a cited source
 * typically carries one or two of them. A 10 m Earth-observation scene
 * establishes that something is present and roughly how far it extends. It
 * establishes nothing whatsoever about height, and the reconstruction draws a
 * height for every building on the site.
 *
 * Three rules govern this file, and they are the same three that govern the
 * ledger it reads:
 *
 * 1. **Nothing is promoted.** A subject's defensibility is derived from the
 *    classification already recorded in `src/lib/evidence.ts`. An `interpreted`
 *    footprint traced off a cited scene does not become `observed` here because
 *    it would be convenient — the project declared it an interpretation, and
 *    `ATTRIBUTE_SUPPORT` reads that declaration rather than second-guessing it.
 * 2. **Support is a table, not a judgement call.** `ATTRIBUTE_SUPPORT` is the
 *    single documented mapping from a defensibility level to the attributes the
 *    evidence carries, in the same sense that `CONFIDENCE_SCALE` is the single
 *    documented ordinal-to-numeric mapping. Adding an exception means editing
 *    that table in the open, not adding a branch somewhere.
 * 3. **A number that is not defended is zero, not small.** The retained-volume
 *    figure this module publishes is `0 m³`, because no cited source in this
 *    project states the height of anything. That is not a rounding artifact and
 *    it must not be softened: it is the finding.
 *
 * What comes out is a per-subject verdict and a site-wide report, both pure and
 * deterministic, which `PROVE IT` renders by drawing only the geometry the
 * verdict defends and dissolving everything else.
 */

import {
  ALL_SEGMENTS,
  APRONS,
  STRUCTURES,
  segmentLength,
  type ApronDef,
  type SegmentDef,
  type StructureDef,
} from "./layout";
import {
  MODEL_INTERNAL_SOURCE_ID,
  getEvidenceForSubject,
  type EvidenceClassification,
  type EvidenceRecord,
} from "./evidence";
import { measurementSubjectsForGeometry } from "./evidenceMode";
import { uncertaintyRadiusM, type UncertaintyEnvelope } from "./uncertainty";

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

/**
 * The attributes this reconstruction renders about a subject.
 *
 * The list is the render, not a taxonomy: every one of these is something a
 * viewer can read off the screen. `form` and `material` are separate from
 * `extent` because a viewer reading a modeled roof profile or a weathered metal
 * facade is reading a modeling decision, not a source.
 */
export type ModeledAttribute =
  | "presence"
  | "position"
  | "extent"
  | "height"
  | "form"
  | "material"
  | "function"
  | "interior"
  | "activity";

export const MODELED_ATTRIBUTES: readonly ModeledAttribute[] = [
  "presence",
  "position",
  "extent",
  "height",
  "form",
  "material",
  "function",
  "interior",
  "activity",
];

export const MODELED_ATTRIBUTE_META: Record<
  ModeledAttribute,
  { label: string; question: string }
> = {
  presence: { label: "Presence", question: "Is something there at all?" },
  position: { label: "Position", question: "Where is it, in the ground frame?" },
  extent: { label: "Extent", question: "How far does its footprint reach?" },
  height: { label: "Height", question: "How tall is it?" },
  form: { label: "Form", question: "What shape is it — roof profile, massing, bays?" },
  material: { label: "Material", question: "What is it clad in?" },
  function: { label: "Function", question: "What is it for?" },
  interior: { label: "Interior", question: "What is inside it?" },
  activity: { label: "Activity", question: "What happens there, and when?" },
};

/**
 * How well a subject's *geometry* can be defended from the sources cited for it.
 *
 * Ordered strongest first. The distinction between the first two is real and
 * load-bearing: a published measurement carries a documented tolerance, while a
 * feature merely visible in a cited scene carries only that scene's resolution
 * floor.
 */
export type DefensibilityLevel =
  /** A published measurement of this geometry, taken off a cited scene. */
  | "measured"
  /** Visible in a cited public scene: presence and rough extent, nothing more. */
  | "observed-extent"
  /** A cited publication states it is there; this model chose where to put it. */
  | "reported-presence"
  /** Nothing cited defends any part of the rendered geometry. */
  | "undefended";

export const DEFENSIBILITY_LEVELS: readonly DefensibilityLevel[] = [
  "measured",
  "observed-extent",
  "reported-presence",
  "undefended",
];

export const DEFENSIBILITY_META: Record<
  DefensibilityLevel,
  { label: string; glyph: string; verdict: string; description: string }
> = {
  measured: {
    label: "Measured",
    // Glyphs exist so a verdict is never carried by colour alone (WCAG 1.4.1)
    // and are always paired with the word.
    glyph: "◆",
    verdict: "Geometry defensible, with a documented tolerance",
    description:
      "This project published a measurement of this geometry taken off a cited public scene, together with the positional uncertainty that measurement carries. It is the only class whose numbers come with a stated tolerance.",
  },
  "observed-extent": {
    label: "Observed extent",
    glyph: "◇",
    verdict: "Footprint defensible to the scene's resolution floor",
    description:
      "A cited public scene shows the feature. That establishes presence and rough extent, bounded below by the ground sample distance of the scene, and establishes nothing about height, form, material or use.",
  },
  "reported-presence": {
    label: "Reported presence",
    glyph: "■",
    verdict: "Existence defensible; no defensible location",
    description:
      "A cited publication states the feature is there. Where this model puts it, how big it draws it and what it calls it are modeling decisions the citation does not carry, so no geometry for it survives a strict reading.",
  },
  undefended: {
    label: "Undefended",
    glyph: "○",
    verdict: "No cited evidence defends any of it",
    description:
      "Interpreted or illustrative content. It may well be a reasonable reading of the site, and it is not a finding: nothing cited establishes that this thing is there.",
  },
};

/**
 * The single documented mapping from a defensibility level to the attributes
 * the cited evidence carries.
 *
 * Two entries in this table are the ones people argue with, so they are spelled
 * out rather than left to be inferred:
 *
 * - **`height` is false everywhere.** No source in `PUBLIC_SOURCES` states the
 *   height of anything at this site, and `UncertaintyEnvelope.heightMeters` is
 *   consequently never populated anywhere in the model. Every roofline in the
 *   reconstruction is a modeling decision.
 * - **`position` and `extent` are false for `reported-presence`.** Reporting
 *   that "three fighter-sized hangars" were built on the western edge defends
 *   that they exist. It does not defend the coordinates this model draws them
 *   at, and drawing them anyway at a specific spot is the exact substitution
 *   this table exists to make visible.
 */
export const ATTRIBUTE_SUPPORT: Record<
  DefensibilityLevel,
  Readonly<Record<ModeledAttribute, boolean>>
> = {
  measured: {
    presence: true,
    position: true,
    extent: true,
    height: false,
    form: false,
    material: false,
    function: false,
    interior: false,
    activity: false,
  },
  "observed-extent": {
    presence: true,
    position: true,
    extent: true,
    height: false,
    form: false,
    material: false,
    function: false,
    interior: false,
    activity: false,
  },
  "reported-presence": {
    presence: true,
    position: false,
    extent: false,
    height: false,
    form: false,
    material: false,
    function: false,
    interior: false,
    activity: false,
  },
  undefended: {
    presence: false,
    position: false,
    extent: false,
    height: false,
    form: false,
    material: false,
    function: false,
    interior: false,
    activity: false,
  },
};

/** True when a level defends enough for the scene to draw any geometry at all. */
export function hasDefensibleGeometry(level: DefensibilityLevel): boolean {
  const support = ATTRIBUTE_SUPPORT[level];
  return support.position && support.extent;
}

/* ------------------------------------------------------------------ */
/* Per-subject verdict                                                 */
/* ------------------------------------------------------------------ */

export interface DefensibleGeometry {
  /** Footprint the evidence defends, in square metres. Zero when none is. */
  footprintAreaM2: number;
  /**
   * Radius of the envelope that footprint carries, in metres. Absent when the
   * model documents no figure — which is the signal to draw nothing rather
   * than to draw a default.
   */
  toleranceM?: number;
}

export interface DefensibilityVerdict {
  subjectId: string;
  label: string;
  kind: "structure" | "pavement-segment" | "pavement-apron";
  level: DefensibilityLevel;
  /** The classification the ledger records, carried through unchanged. */
  classification: EvidenceClassification;
  /** Attributes the cited evidence carries, in `MODELED_ATTRIBUTES` order. */
  defended: readonly ModeledAttribute[];
  /** Attributes the reconstruction renders that nothing cited carries. */
  stripped: readonly ModeledAttribute[];
  /** Citable public sources behind the verdict, ascending. Never model-internal. */
  sourceIds: readonly string[];
  /** Modeled footprint area, in square metres — what the scene draws today. */
  modeledFootprintM2: number;
  /** Modeled built volume, in cubic metres. Zero for pavement. */
  modeledVolumeM3: number;
  /** What survives a strict reading. Zero-area when the verdict defends nothing. */
  retained: DefensibleGeometry;
  /** One sentence a reviewer can quote, generated from the verdict. */
  statement: string;
}

/**
 * Records that could be cited at someone: an external, resolvable publication.
 *
 * Model-internal records name this repository as their own source, which is the
 * honest way to attribute procedural content and is emphatically not evidence.
 * A record with no URL cannot be checked by a reader, so it cannot defend
 * anything either.
 */
function citableRecords(records: readonly EvidenceRecord[]): readonly EvidenceRecord[] {
  return records.filter(
    (record) =>
      record.sourceId !== MODEL_INTERNAL_SOURCE_ID &&
      record.sourceUrl !== undefined &&
      record.sourceUrl.length > 0,
  );
}

/**
 * The level a subject earns, from its own records plus any published
 * measurement *of* it.
 *
 * The measurement link is what keeps the runway — the one piece of geometry
 * this project actually measured — from being demoted to the classification its
 * own pavement record carries. It is the same link `evidenceMode.ts` uses, read
 * from there rather than re-derived, so the two cannot disagree.
 */
function levelForSubject(subjectId: string): {
  level: DefensibilityLevel;
  classification: EvidenceClassification;
  sourceIds: readonly string[];
  envelope: UncertaintyEnvelope | undefined;
} {
  const own = getEvidenceForSubject(subjectId);
  const measurements = measurementSubjectsForGeometry(subjectId).flatMap(
    (measurementId) => getEvidenceForSubject(measurementId),
  );
  const citable = citableRecords([...own, ...measurements]);

  const measured = citable.find(
    (record) =>
      record.subjectKind === "measurement" &&
      record.classification === "observed" &&
      record.measurementUncertaintyM !== undefined,
  );
  const observed = citable.find(
    (record) =>
      record.classification === "observed" && record.subjectKind !== "measurement",
  );
  const reported = citable.find((record) => record.classification === "reported");

  const strongest = measured ?? observed ?? reported ?? citable[0] ?? own[0];
  const classification: EvidenceClassification =
    strongest?.classification ?? "illustrative";

  const level: DefensibilityLevel =
    measured !== undefined
      ? "measured"
      : observed !== undefined
        ? "observed-extent"
        : reported !== undefined
          ? "reported-presence"
          : "undefended";

  // Only sources that actually carry the surviving claim are listed. Citing the
  // full set would let an undefended subject display four references.
  const carrying =
    level === "undefended"
      ? []
      : citable.filter((record) =>
          level === "measured"
            ? record.subjectKind === "measurement"
            : level === "observed-extent"
              ? record.classification === "observed"
              : record.classification === "reported",
        );

  // `sourceId` is a literal union across the register (one member is
  // `undefined`), so the map is widened before the guard narrows it.
  const carryingIds: readonly (string | undefined)[] = carrying.map(
    (record) => record.sourceId,
  );

  return {
    level,
    classification,
    sourceIds: [
      ...new Set(carryingIds.filter((id): id is string => id !== undefined)),
    ].sort(),
    envelope: (measured ?? observed ?? reported)?.uncertainty,
  };
}

function verdictStatement(
  label: string,
  level: DefensibilityLevel,
  retained: DefensibleGeometry,
  sourceIds: readonly string[],
): string {
  const cited =
    sourceIds.length === 0
      ? "no citable public source"
      : `${sourceIds.length} cited source${sourceIds.length === 1 ? "" : "s"}`;
  switch (level) {
    case "measured":
      return `${label}: presence, position and extent are defensible from ${cited}, within ${
        retained.toleranceM === undefined
          ? "the tolerance the project documents"
          : `±${retained.toleranceM} m`
      }. Height, form, material, function, interior use and activity are not defended by anything cited.`;
    case "observed-extent":
      return `${label}: presence and rough extent are defensible from ${cited}, bounded below by the cited scene's resolution${
        retained.toleranceM === undefined ? "" : ` of ${retained.toleranceM} m`
      }. Height, form, material, function, interior use and activity are not defended by anything cited.`;
    case "reported-presence":
      return `${label}: ${cited} state${sourceIds.length === 1 ? "s" : ""} that it exists. Its modeled position, footprint, height, form, material, function, interior use and activity are this project's decisions and are not defended.`;
    case "undefended":
      return `${label}: nothing cited establishes that this is there. Everything the scene draws about it is a modeling decision.`;
  }
}

function verdictFor(
  subjectId: string,
  label: string,
  kind: DefensibilityVerdict["kind"],
  modeledFootprintM2: number,
  modeledVolumeM3: number,
): DefensibilityVerdict {
  const { level, classification, sourceIds, envelope } = levelForSubject(subjectId);
  const support = ATTRIBUTE_SUPPORT[level];
  const toleranceM = envelope === undefined ? undefined : uncertaintyRadiusM(envelope);

  // Footprint survives only where both position and extent are defended; the
  // rendered volume never survives, because no source states a height.
  const retained: DefensibleGeometry = hasDefensibleGeometry(level)
    ? {
        footprintAreaM2: modeledFootprintM2,
        ...(toleranceM === undefined ? {} : { toleranceM }),
      }
    : { footprintAreaM2: 0 };

  return {
    subjectId,
    label,
    kind,
    level,
    classification,
    defended: MODELED_ATTRIBUTES.filter((attribute) => support[attribute]),
    stripped: MODELED_ATTRIBUTES.filter((attribute) => !support[attribute]),
    sourceIds,
    modeledFootprintM2,
    modeledVolumeM3,
    retained,
    statement: verdictStatement(label, level, retained, sourceIds),
  };
}

function structureVerdict(structure: StructureDef): DefensibilityVerdict {
  const [width, height, depth] = structure.size;
  return verdictFor(
    structure.id,
    structure.name,
    "structure",
    width * depth,
    width * height * depth,
  );
}

function segmentVerdict(segment: SegmentDef): DefensibilityVerdict {
  return verdictFor(
    segment.id,
    segment.name,
    "pavement-segment",
    segmentLength(segment) * segment.width,
    0,
  );
}

function apronVerdict(apron: ApronDef): DefensibilityVerdict {
  return verdictFor(
    apron.id,
    apron.name,
    "pavement-apron",
    apron.size[0] * apron.size[1],
    0,
  );
}

/**
 * A verdict for every subject the scene draws geometry for, sorted by id so the
 * order never depends on the order the layout happens to declare things in.
 */
export const DEFENSIBILITY_LEDGER: readonly DefensibilityVerdict[] = Object.freeze(
  [
    ...STRUCTURES.map(structureVerdict),
    ...ALL_SEGMENTS.map(segmentVerdict),
    ...APRONS.map(apronVerdict),
  ].sort((left, right) =>
    left.subjectId < right.subjectId ? -1 : left.subjectId > right.subjectId ? 1 : 0,
  ),
);

const VERDICT_BY_SUBJECT: ReadonlyMap<string, DefensibilityVerdict> = new Map(
  DEFENSIBILITY_LEDGER.map((verdict) => [verdict.subjectId, verdict]),
);

export function getDefensibility(subjectId: string): DefensibilityVerdict | undefined {
  return VERDICT_BY_SUBJECT.get(subjectId);
}

/**
 * Whether `PROVE IT` draws this subject at all.
 *
 * A subject with no verdict is not in the geometry catalog — scene dressing,
 * a route, a sensor prop — and nothing cited defends it either, so it goes.
 */
export function survivesProveIt(subjectId: string): boolean {
  const verdict = VERDICT_BY_SUBJECT.get(subjectId);
  return verdict !== undefined && hasDefensibleGeometry(verdict.level);
}

/* ------------------------------------------------------------------ */
/* Site-wide report                                                    */
/* ------------------------------------------------------------------ */

export interface AttributeCoverage {
  attribute: ModeledAttribute;
  /** Subjects for which a cited source carries this attribute. */
  defendedSubjects: number;
  totalSubjects: number;
}

export interface ProveItReport {
  totalSubjects: number;
  /** Subjects whose rendered geometry survives in some form. */
  survivingSubjects: number;
  /** Subjects whose existence is attested but whose location is not defended. */
  presenceOnlySubjects: number;
  undefendedSubjects: number;
  byLevel: Readonly<Record<DefensibilityLevel, number>>;
  modeledFootprintM2: number;
  retainedFootprintM2: number;
  modeledVolumeM3: number;
  /** Always zero. No cited source in this project states a height. */
  retainedVolumeM3: number;
  attributeCoverage: readonly AttributeCoverage[];
  /** Every attribute-subject pair the reconstruction renders. */
  renderedAssertions: number;
  /** How many of those pairs a cited source carries. */
  defendedAssertions: number;
  /** Subjects whose geometry survives, in ledger order. */
  surviving: readonly DefensibilityVerdict[];
  /** Attested-but-unplaceable subjects, in ledger order. */
  presenceOnly: readonly DefensibilityVerdict[];
}

/**
 * The site-wide audit.
 *
 * Computed once at module load: the ledger is frozen and derived, so the report
 * cannot change between calls, and every surface that quotes a figure from it
 * quotes the same figure.
 */
export const PROVE_IT_REPORT: ProveItReport = (() => {
  const byLevel: Record<DefensibilityLevel, number> = {
    measured: 0,
    "observed-extent": 0,
    "reported-presence": 0,
    undefended: 0,
  };
  let modeledFootprintM2 = 0;
  let retainedFootprintM2 = 0;
  let modeledVolumeM3 = 0;
  let retainedVolumeM3 = 0;
  let defendedAssertions = 0;

  const attributeCounts = new Map<ModeledAttribute, number>(
    MODELED_ATTRIBUTES.map((attribute) => [attribute, 0]),
  );

  for (const verdict of DEFENSIBILITY_LEDGER) {
    byLevel[verdict.level] += 1;
    modeledFootprintM2 += verdict.modeledFootprintM2;
    retainedFootprintM2 += verdict.retained.footprintAreaM2;
    modeledVolumeM3 += verdict.modeledVolumeM3;
    // Deliberately summed rather than asserted to be zero: if a future source
    // ever states a height, the figure moves on its own instead of lying.
    retainedVolumeM3 += ATTRIBUTE_SUPPORT[verdict.level].height
      ? verdict.modeledVolumeM3
      : 0;
    for (const attribute of verdict.defended) {
      attributeCounts.set(attribute, (attributeCounts.get(attribute) ?? 0) + 1);
      defendedAssertions += 1;
    }
  }

  const total = DEFENSIBILITY_LEDGER.length;
  const surviving = DEFENSIBILITY_LEDGER.filter((verdict) =>
    hasDefensibleGeometry(verdict.level),
  );
  const presenceOnly = DEFENSIBILITY_LEDGER.filter(
    (verdict) => verdict.level === "reported-presence",
  );

  return {
    totalSubjects: total,
    survivingSubjects: surviving.length,
    presenceOnlySubjects: presenceOnly.length,
    undefendedSubjects: byLevel.undefended,
    byLevel,
    modeledFootprintM2,
    retainedFootprintM2,
    modeledVolumeM3,
    retainedVolumeM3,
    attributeCoverage: MODELED_ATTRIBUTES.map((attribute) => ({
      attribute,
      defendedSubjects: attributeCounts.get(attribute) ?? 0,
      totalSubjects: total,
    })),
    renderedAssertions: total * MODELED_ATTRIBUTES.length,
    defendedAssertions,
    surviving,
    presenceOnly,
  };
})();

/* ------------------------------------------------------------------ */
/* Presentation helpers                                                */
/* ------------------------------------------------------------------ */

/** A percentage with one decimal, or "0" exactly when nothing is retained. */
export function retainedPercent(retained: number, modeled: number): string {
  if (modeled <= 0) return "0";
  if (retained <= 0) return "0";
  const percent = (retained / modeled) * 100;
  return percent < 0.1 ? "<0.1" : percent.toFixed(1);
}

/** "1,240,000 m²" — grouped, never rounded into a different order of magnitude. */
export function formatArea(squareMeters: number): string {
  return `${Math.round(squareMeters).toLocaleString("en-US")} m²`;
}

export function formatVolume(cubicMeters: number): string {
  return `${Math.round(cubicMeters).toLocaleString("en-US")} m³`;
}

/**
 * The headline a viewer reads the instant the scene collapses.
 *
 * Phrased as subtraction, for the same reason `describeEvidenceMode` is: a view
 * that removes things has to say how much it removed, or it becomes a way to
 * mislead yourself in the opposite direction.
 */
export function proveItHeadline(report: ProveItReport = PROVE_IT_REPORT): string {
  return `${report.survivingSubjects} of ${report.totalSubjects} modeled subjects keep any defensible geometry. ${formatVolume(
    report.retainedVolumeM3,
  )} of ${formatVolume(
    report.modeledVolumeM3,
  )} modeled built volume survives, because no cited source states the height of anything at this site.`;
}
