/**
 * Shared evidence and provenance model.
 *
 * Every analytical claim this project makes about the site — a structure
 * footprint, a runway measurement, an aircraft identification, an
 * environmental input, a piece of simulated scenery — is expressed as an
 * `EvidenceRecord` in one ledger. The ledger is *derived* from the existing
 * `src/lib/layout.ts` geometry and `src/lib/siteData.ts` source register
 * rather than being maintained by hand, so a record can never drift from the
 * thing it describes and source metadata is written down exactly once.
 *
 * Three rules govern this file:
 *
 * 1. **Nothing is invented.** Every title, publisher, URL and date comes from
 *    `PUBLIC_SOURCES`. Unknown values are omitted rather than guessed, and no
 *    source content hash is recorded because the build fetches nothing (see
 *    `docs/DATA_PROVENANCE.md`).
 * 2. **Interpretation is never dressed as observation.** The classification
 *    of a record is copied from the subject's declared evidence status; the
 *    validator in `src/lib/evidenceValidation.ts` fails the build if an
 *    illustrative or interpreted subject acquires an observed record, or if
 *    any claim text calls an unverified feature verified.
 * 3. **Confidence is an ordinal, published as a number.** The project records
 *    low/medium/high judgements, not measured probabilities. `CONFIDENCE_SCALE`
 *    is the single documented mapping to the 0–1 range the schema requires; it
 *    is a rank expressed numerically, not a statistical estimate.
 */

import {
  ALL_SEGMENTS,
  APRONS,
  CIRCUIT_AIRCRAFT_ID,
  CIRCUIT_ROUTE_ENTITY_ID,
  ENVIRONMENT_ENTITY_ID,
  MISSION_ENTITIES,
  MISSION_SITE_ID,
  PATROL_ENTITY_IDS,
  PERIMETER_ROUTE_ENTITY_ID,
  RADAR_ENTITY_ID,
  RUNWAYS,
  STRUCTURES,
  TERRAIN_ENTITY_ID,
  WINDSOCK_ENTITY_ID,
  segmentLength,
  type StructureDef,
} from "./layout";
import {
  UNCERTAINTY_LEVELS,
  deriveUncertainty,
  illustrativeUncertainty,
  measurementUncertainty,
  type UncertaintyEnvelope,
  type UncertaintyLevel,
} from "./uncertainty";
import {
  OFFSITE_CONTEXT,
  PUBLIC_SOURCES,
  SITE_PROFILE,
  getSource,
  type EvidenceConfidence,
  type PublicSource,
  type SourceId,
} from "./siteData";

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

export type EvidenceClassification =
  "observed" | "reported" | "interpreted" | "illustrative";

export interface EvidenceRecord {
  /** Stable, deterministic identifier: `ev-<subject>-<source>`. */
  id: string;
  /** The modeled thing this claim is about; must resolve in the subject registry. */
  subjectId: string;
  /** The proposition being asserted, in plain language. */
  claim: string;
  classification: EvidenceClassification;
  /** 0–1. See `CONFIDENCE_SCALE` — an ordinal rank, not a measured probability. */
  confidence: number;
  sourceTitle: string;
  sourceUrl?: string;
  /** Publication date of the source, ISO `YYYY-MM-DD`, when the source states one. */
  sourceDate?: string;
  /** When this project last consulted the source, ISO `YYYY-MM-DD`. */
  accessedAt?: string;
  sourcePublisher?: string;
  /**
   * Content hash of the retrieved source artifact. Never populated today: the
   * build fetches nothing, so there is no artifact to hash. Reserved for a
   * future ingestion pipeline that pins downloaded files.
   */
  sourceHash?: string;
  coordinateReferenceSystem?: string;
  /** Stated positional uncertainty in metres, only where the project documents one. */
  measurementUncertaintyM?: number;
  /**
   * Structured uncertainty for this claim. Derived in `src/lib/uncertainty.ts`
   * from what the subject already declares, never hand-written, and absent
   * numbers mean unknown rather than zero.
   */
  uncertainty?: UncertaintyEnvelope;
  analystNotes?: string;
  /** Record ID this one replaces, once a claim is revised. */
  supersedes?: string;

  /* -------- project extensions to the base schema -------- */
  /** Source register key, so the UI can link back without re-stating metadata. */
  sourceId?: SourceId | typeof MODEL_INTERNAL_SOURCE_ID;
  /** Ground sample distance of the cited imagery, where the source states one. */
  sourceResolutionM?: number;
  /** Which catalog the subject lives in, for validation and grouping. */
  subjectKind: EvidenceSubjectKind;
}

export type EvidenceSubjectKind =
  | "structure"
  | "aircraft"
  | "pavement"
  | "terrain"
  | "environment"
  | "measurement"
  | "simulation"
  | "context";

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export const EVIDENCE_CLASSIFICATIONS: readonly EvidenceClassification[] = [
  "observed",
  "reported",
  "interpreted",
  "illustrative",
];

/**
 * One place for the wording used across the UI, the analysis table and the
 * exported ledger. The glyph exists so evidence status is never carried by
 * colour alone (WCAG 1.4.1); it is decorative and always paired with the label.
 */
export const EVIDENCE_CLASSIFICATION_META: Record<
  EvidenceClassification,
  {
    label: string;
    glyph: string;
    statement: string;
    description: string;
  }
> = {
  observed: {
    label: "Observed",
    glyph: "◆", // ◆
    statement: "Observed in cited public imagery",
    description:
      "The feature is visible in the cited public Earth-observation scene. Visibility establishes presence and rough extent, not function or interior use.",
  },
  reported: {
    label: "Reported",
    glyph: "■", // ■
    statement: "Reported by cited publication",
    description:
      "A cited publication states the feature exists. Placement, dimensions and function in this model remain a modeled interpretation of that reporting.",
  },
  interpreted: {
    label: "Interpreted",
    glyph: "▲", // ▲
    statement: "Interpreted from available evidence",
    description:
      "This project assigned an identity, dimension or function that no cited source states outright. Treat it as a hypothesis to be tested, not a finding.",
  },
  illustrative: {
    label: "Illustrative",
    glyph: "○", // ○
    statement: "Illustrative simulation element",
    description:
      "Modeled scenery, motion or infrastructure added so the site reads as a place. Not resolved in any cited source and not an observation of anything on the ground.",
  },
};

/**
 * The documented ordinal-to-numeric mapping. The upstream data records
 * low / medium / high judgements; the schema stores a number. These three
 * values are the *only* numeric confidences the ledger emits, which keeps the
 * mapping auditable and stops a rank from being mistaken for a measurement.
 */
export const CONFIDENCE_SCALE: Record<EvidenceConfidence, number> = {
  low: 0.3,
  medium: 0.55,
  high: 0.8,
};

export const CONFIDENCE_SCALE_NOTE =
  "Confidence is a project-assigned ordinal (low 0.30 / medium 0.55 / high 0.80) published on a 0-1 scale. It ranks how well a claim is supported by its cited source; it is not a measured probability or a statistical estimate.";

/** Reverse lookup for display: turn a stored number back into its rank. */
export function confidenceRank(confidence: number): EvidenceConfidence | "unrated" {
  if (confidence >= CONFIDENCE_SCALE.high) return "high";
  if (confidence >= CONFIDENCE_SCALE.medium) return "medium";
  if (confidence >= CONFIDENCE_SCALE.low) return "low";
  return "unrated";
}

/** Text-first confidence rendering: never a bar or a colour on its own. */
export function formatConfidence(confidence: number): string {
  return `${confidence.toFixed(2)} (${confidenceRank(confidence)})`;
}

/**
 * Coordinate reference systems this project is allowed to express a
 * measurement in. `EPSG:32645` is the local projected frame every modeled
 * metre is registered to; `EPSG:4326` is used for the published reference and
 * offsite context coordinates. Anything else fails validation.
 */
export const SUPPORTED_COORDINATE_REFERENCE_SYSTEMS = [
  "EPSG:32645",
  "EPSG:4326",
] as const;

export type SupportedCrs = (typeof SUPPORTED_COORDINATE_REFERENCE_SYSTEMS)[number];

export const PRIMARY_CRS: SupportedCrs = "EPSG:32645";
export const GEOGRAPHIC_CRS: SupportedCrs = "EPSG:4326";

/**
 * Claims that originate in this repository rather than in an external
 * publication — illustrative scenery, simulated motion, derived scenario
 * geometry. Naming the model as the source is honest; inventing a citation
 * for procedural content would not be.
 */
export const MODEL_INTERNAL_SOURCE_ID = "model-internal-definition";

const MODEL_INTERNAL_SOURCE = {
  id: MODEL_INTERNAL_SOURCE_ID,
  title: "Deterministic model definition in this repository",
  publisher: "Lop Nur Geospatial Simulation Testbed",
} as const;

/* ------------------------------------------------------------------ */
/* Known limitations                                                   */
/* ------------------------------------------------------------------ */

/**
 * The limitations the project already states in its README, white paper and
 * dossiers, collected once so the UI, the analysis table and the release
 * manifest all publish the same list.
 */
export const KNOWN_LIMITATIONS: readonly string[] = [
  "This is a public-source analytical reconstruction, not operational data, an official facility record, or an aeronautical chart.",
  "Terrain relief is a seeded procedural proxy around an approximate ~981 m EGM2008 datum sampled from Copernicus GLO-30. No DEM tile is redistributed and the surface must not be used for survey-grade elevation, slope or sightline analysis.",
  'Facility functions are interpretations. Names such as "assembly hangar", "operations block" and "crew accommodation" are model hypotheses; public overhead imagery does not establish interiors, occupants or use.',
  "Aircraft identifications, dimensions and parking positions follow cited public reporting. External shapes are massed from widely circulated photographs whose provenance cannot be verified.",
  "Base-support systems — power, water, sanitation, communications, sensors and security — are illustrative. None is resolved in the cited 10 m imagery.",
  "Modeled runway endpoints carry roughly 40 m of uncertainty; the 10 m source imagery supports site-scale measurement, not detailed interior or function claims.",
  "Animated elements (flight circuit, patrol vehicles, radar rotation, windsock, day/night cycle) are illustrative scenario motion, not observed site operations.",
  "Climate values are 2001-2020 NASA POWER monthly climatological means for a model grid cell — not local observations, a forecast, or conditions during any reported event.",
  "The Blacksite simulation at /play is an illustrative interactive demonstration on the same geometry. Nothing in it represents observed activity, capability or tactics.",
  "Confidence values are project-assigned ordinal ranks published on a 0-1 scale, not measured probabilities.",
  "No source artifact is retrieved at build time, so no source content hashes are recorded; provenance is pinned by citation, access date and reviewed data change.",
];

/* ------------------------------------------------------------------ */
/* Subject registry                                                    */
/* ------------------------------------------------------------------ */

/**
 * Every id an evidence record is allowed to point at. Mission entities
 * already enumerate the site, terrain, environment, routes, sensors, every
 * pavement record and every structure, so the registry is that catalog plus
 * the offsite context places and the derived measurement subjects.
 */
const MEASUREMENT_SUBJECT_IDS = [
  "measurement-runway-length",
  "measurement-runway-bearing",
  "measurement-site-reference-coordinate",
] as const;

export type MeasurementSubjectId = (typeof MEASUREMENT_SUBJECT_IDS)[number];

const SUBJECT_IDS: ReadonlySet<string> = new Set<string>([
  ...MISSION_ENTITIES.map((entity) => entity.id),
  ...OFFSITE_CONTEXT.map((place) => place.id),
  ...MEASUREMENT_SUBJECT_IDS,
]);

export function isKnownEvidenceSubject(subjectId: string): boolean {
  return SUBJECT_IDS.has(subjectId);
}

/** Ids that must resolve to a real piece of geometry, checked by the validator. */
const GEOMETRY_IDS: ReadonlySet<string> = new Set<string>([
  ...ALL_SEGMENTS.map((segment) => segment.id),
  ...APRONS.map((apron) => apron.id),
  ...STRUCTURES.map((structure) => structure.id),
]);

export function isKnownGeometryId(id: string): boolean {
  return GEOMETRY_IDS.has(id);
}

/* ------------------------------------------------------------------ */
/* Ledger construction                                                 */
/* ------------------------------------------------------------------ */

function sourceFields(
  source: PublicSource,
): Pick<
  EvidenceRecord,
  | "sourceTitle"
  | "sourceUrl"
  | "sourceDate"
  | "accessedAt"
  | "sourcePublisher"
  | "sourceId"
> {
  return {
    sourceTitle: source.title,
    sourceUrl: source.url,
    // `publishedOn` is genuinely absent for the live feed; omit rather than guess.
    ...(source.publishedOn === undefined ? {} : { sourceDate: source.publishedOn }),
    accessedAt: source.accessedOn,
    sourcePublisher: source.publisher,
    sourceId: source.id as SourceId,
  };
}

function internalSourceFields(): Pick<
  EvidenceRecord,
  "sourceTitle" | "sourcePublisher" | "sourceId"
> {
  return {
    sourceTitle: MODEL_INTERNAL_SOURCE.title,
    sourcePublisher: MODEL_INTERNAL_SOURCE.publisher,
    sourceId: MODEL_INTERNAL_SOURCE_ID,
  };
}

function joinNotes(parts: readonly (string | undefined)[]): string | undefined {
  const kept = parts
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part.length > 0);
  return kept.length > 0 ? kept.join(" ") : undefined;
}

function structureRecords(structure: StructureDef): EvidenceRecord[] {
  const { evidence } = structure;
  const kind: EvidenceSubjectKind = structure.type.startsWith("aircraft-")
    ? "aircraft"
    : "structure";
  const analystNotes = joinNotes([
    evidence.note,
    evidence.method ? `Method: ${evidence.method}` : undefined,
    evidence.uncertainty ? `Uncertainty: ${evidence.uncertainty}` : undefined,
  ]);
  const uncertainty = deriveUncertainty(evidence, {
    // The asset-visibility date, when the layout records one. It bounds when
    // the structure existed *by*, which is the only end of the range imagery
    // establishes.
    ...(structure.observedDate === undefined
      ? {}
      : { observedDate: structure.observedDate }),
  });

  return evidence.sourceIds.map((sourceId): EvidenceRecord => {
    const source = getSource(sourceId);
    return {
      id: `ev-${structure.id}-${sourceId}`,
      subjectId: structure.id,
      claim: `${structure.name} — ${structure.description}`,
      classification: evidence.status,
      confidence: CONFIDENCE_SCALE[evidence.confidence],
      ...(source === undefined
        ? { sourceTitle: `Unresolved source reference: ${sourceId}` }
        : sourceFields(source)),
      coordinateReferenceSystem: PRIMARY_CRS,
      ...(evidence.resolutionM === undefined
        ? {}
        : { sourceResolutionM: evidence.resolutionM }),
      ...(analystNotes === undefined ? {} : { analystNotes }),
      uncertainty,
      subjectKind: kind,
    };
  });
}

function pavementRecords(): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  for (const entity of MISSION_ENTITIES) {
    if (entity.kind !== "pavement") continue;
    const { observation } = entity;
    // Pavement observations carry the mission vocabulary, which admits
    // "simulated"/"unknown"; those never appear on a pavement record, but the
    // narrowing keeps the classification honest if that ever changes.
    const classification: EvidenceClassification =
      observation.status === "simulated" || observation.status === "unknown"
        ? "illustrative"
        : observation.status;
    const confidence =
      observation.confidence === "unknown"
        ? CONFIDENCE_SCALE.low
        : CONFIDENCE_SCALE[observation.confidence];
    const sourceIds: readonly (SourceId | typeof MODEL_INTERNAL_SOURCE_ID)[] =
      observation.sourceIds.length > 0
        ? observation.sourceIds
        : [MODEL_INTERNAL_SOURCE_ID];

    for (const sourceId of sourceIds) {
      const source =
        sourceId === MODEL_INTERNAL_SOURCE_ID ? undefined : getSource(sourceId);
      records.push({
        id: `ev-${entity.id}-${sourceId}`,
        subjectId: entity.id,
        claim: `${entity.label} — modeled pavement geometry in the local ${PRIMARY_CRS} frame.`,
        classification,
        confidence,
        ...(source === undefined ? internalSourceFields() : sourceFields(source)),
        coordinateReferenceSystem: PRIMARY_CRS,
        analystNotes: observation.note,
        uncertainty: {
          // `observedDate` is set only where a cited scene dates the pavement;
          // `evidenceObservedOn` timestamps the source snapshot the illustrative
          // records were drawn against and is *not* a claim about the surface,
          // so it never becomes a bound.
          ...(entity.observedDate === undefined
            ? {}
            : { latestDate: entity.observedDate }),
          identification: classification === "reported" ? "probable" : "unknown",
          function: classification === "reported" ? "possible" : "unknown",
          narrative:
            classification === "reported"
              ? "Timeline visibility follows a cited public observation; the modeled centreline, width and endpoints are interpreted from imagery and are not surveyed."
              : "Illustrative pavement geometry. Its construction date is unknown and no cited source resolves it.",
          sourceIds: observation.sourceIds,
        },
        subjectKind: "pavement",
      });
    }
  }
  return records;
}

/**
 * Measurements the project publishes as numbers, with the uncertainty it
 * actually documents. These are the claims a reviewer is most likely to want
 * to reproduce, so each one names the scene it was measured from.
 */
function measurementRecords(): EvidenceRecord[] {
  const runway = RUNWAYS[0];
  const imagery = getSource("sentinel-2-scene-2025");
  const reporting = getSource("nsj-airfield-2025");
  const records: EvidenceRecord[] = [];
  if (runway === undefined || imagery === undefined) return records;

  const lengthM = Math.round(segmentLength(runway));
  records.push({
    id: "ev-measurement-runway-length-sentinel-2-scene-2025",
    subjectId: "measurement-runway-length",
    claim: `Modeled runway ${SITE_PROFILE.runway.designation} is ${lengthM} m long and ${SITE_PROFILE.runway.modeledWidthM} m wide, measured from the pinned public scene.`,
    classification: "observed",
    confidence: CONFIDENCE_SCALE.high,
    ...sourceFields(imagery),
    coordinateReferenceSystem: PRIMARY_CRS,
    measurementUncertaintyM: SITE_PROFILE.runway.endpointUncertaintyM,
    sourceResolutionM: 10,
    analystNotes:
      "Measured off 10 m imagery, so endpoints carry about 40 m of uncertainty. This is a model measurement, not an aeronautical survey.",
    uncertainty: measurementUncertainty({
      sourceIds: ["sentinel-2-scene-2025"],
      sourceResolutionM: 10,
      latestDate: imagery.publishedOn,
      narrative:
        "Both endpoints are read off a 10 m scene, so the length inherits their uncertainty at each end.",
    }),
    subjectKind: "measurement",
  });
  if (reporting !== undefined) {
    records.push({
      id: "ev-measurement-runway-length-nsj-airfield-2025",
      subjectId: "measurement-runway-length",
      claim: `Public reporting describes the runway as longer than 16,400 ft, consistent with the modeled ${lengthM} m.`,
      classification: "reported",
      confidence: CONFIDENCE_SCALE.medium,
      ...sourceFields(reporting),
      coordinateReferenceSystem: PRIMARY_CRS,
      analystNotes:
        "A secondary report of commercial imagery. It corroborates scale; it is not an official record.",
      uncertainty: {
        // The report states a bound ("longer than 16,400 ft"), not a
        // measurement with an error, so there is no number to record here.
        ...(reporting.publishedOn === undefined
          ? {}
          : { latestDate: reporting.publishedOn }),
        identification: "probable",
        function: "unknown",
        narrative:
          "The cited report gives a lower bound on runway length rather than a measurement with a stated tolerance, so no numeric uncertainty is recorded.",
        sourceIds: ["nsj-airfield-2025"],
      },
      subjectKind: "measurement",
    });
  }
  records.push({
    id: "ev-measurement-runway-bearing-sentinel-2-scene-2025",
    subjectId: "measurement-runway-bearing",
    claim: `Modeled runway ${SITE_PROFILE.runway.designation} lies on a ${SITE_PROFILE.runway.modeledGridBearingDeg} degree grid bearing in ${PRIMARY_CRS}.`,
    classification: "observed",
    confidence: CONFIDENCE_SCALE.high,
    ...sourceFields(imagery),
    coordinateReferenceSystem: PRIMARY_CRS,
    measurementUncertaintyM: SITE_PROFILE.runway.endpointUncertaintyM,
    sourceResolutionM: 10,
    analystNotes:
      "Grid bearing, not magnetic or true bearing. It follows from the same modeled endpoints and inherits their uncertainty.",
    uncertainty: measurementUncertainty({
      sourceIds: ["sentinel-2-scene-2025"],
      sourceResolutionM: 10,
      latestDate: imagery.publishedOn,
      narrative:
        "The bearing is derived from the same two endpoints as the length. The angular error that follows from ±40 m over a 5 km baseline is not published as a number here, because it would be a derived figure this project has not documented.",
    }),
    subjectKind: "measurement",
  });
  records.push({
    id: "ev-measurement-site-reference-coordinate-sentinel-2-scene-2025",
    subjectId: "measurement-site-reference-coordinate",
    claim: `The local frame is registered to the public runway-center reference ${SITE_PROFILE.referenceCoordinate.latitude.toFixed(6)} N, ${SITE_PROFILE.referenceCoordinate.longitude.toFixed(6)} E (${GEOGRAPHIC_CRS}), which is ${SITE_PROFILE.localCrs.runwayCenterEastingM} E / ${SITE_PROFILE.localCrs.runwayCenterNorthingM} N in ${PRIMARY_CRS}.`,
    classification: "observed",
    confidence: CONFIDENCE_SCALE.high,
    ...sourceFields(imagery),
    coordinateReferenceSystem: GEOGRAPHIC_CRS,
    measurementUncertaintyM: SITE_PROFILE.runway.endpointUncertaintyM,
    sourceResolutionM: 10,
    analystNotes:
      "An approximate coordinate read off public imagery. Every modeled metre is offset from this point, so an error here shifts the whole frame.",
    uncertainty: measurementUncertainty({
      sourceIds: ["sentinel-2-scene-2025"],
      sourceResolutionM: 10,
      latestDate: imagery.publishedOn,
      narrative:
        "Every modeled metre is offset from this point, so this envelope is the floor under every other position in the model.",
    }),
    subjectKind: "measurement",
  });
  return records;
}

function environmentAndTerrainRecords(): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  const dem = getSource("copernicus-dem");
  const climate = getSource("nasa-power-climatology");

  if (dem !== undefined) {
    records.push({
      id: `ev-${TERRAIN_ENTITY_ID}-copernicus-dem`,
      subjectId: TERRAIN_ENTITY_ID,
      claim: `Terrain sits around an approximate ${SITE_PROFILE.terrainDatum.elevationM} m ${SITE_PROFILE.terrainDatum.verticalReference} datum sampled near the runway-center coordinate; the rendered relief is a seeded procedural proxy.`,
      classification: "interpreted",
      confidence: CONFIDENCE_SCALE.low,
      ...sourceFields(dem),
      coordinateReferenceSystem: PRIMARY_CRS,
      analystNotes: SITE_PROFILE.terrainDatum.note,
      uncertainty: {
        identification: "possible",
        function: "unknown",
        narrative:
          "The datum is an approximate sample from a 30 m global surface model and the rendered relief is a seeded proxy around it. Neither carries a vertical tolerance this project can state, so none is recorded — the surface must not be used for slope or sightline analysis.",
        sourceIds: ["copernicus-dem"],
      },
      subjectKind: "terrain",
    });
  }
  if (climate !== undefined) {
    records.push({
      id: `ev-${ENVIRONMENT_ENTITY_ID}-nasa-power-climatology`,
      subjectId: ENVIRONMENT_ENTITY_ID,
      claim: `Monthly environment values are NASA POWER ${SITE_PROFILE.climatePeriod} climatological means for the reference point.`,
      classification: "reported",
      confidence: CONFIDENCE_SCALE.medium,
      ...sourceFields(climate),
      analystNotes:
        "Modelled grid climatology, not a local weather station, a forecast, or conditions during any reported event.",
      uncertainty: {
        // A climatological mean has a spread, and POWER publishes one. This
        // project does not carry those figures, so it records none rather than
        // deriving a plausible band.
        identification: "known",
        function: "known",
        narrative:
          "Monthly means over a 2001-2020 window for a model grid cell. The spread around each mean is published by the source but is not carried in this repository, so no numeric band is recorded here.",
        sourceIds: ["nasa-power-climatology"],
      },
      subjectKind: "environment",
    });
  }
  return records;
}

function siteAndContextRecords(): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  const imagery = getSource("sentinel-2-scene-2025");
  const expansion = getSource("npr-airfield-expansion");
  const spacecraft = getSource("swf-spacecraft-2026");

  if (imagery !== undefined) {
    records.push({
      id: `ev-${MISSION_SITE_ID}-sentinel-2-scene-2025`,
      subjectId: MISSION_SITE_ID,
      claim: `A ${(SITE_PROFILE.worldExtentM / 1000).toFixed(1)} km square local frame reconstructs the airfield layout visible in the pinned public scene.`,
      classification: "observed",
      confidence: CONFIDENCE_SCALE.medium,
      ...sourceFields(imagery),
      coordinateReferenceSystem: PRIMARY_CRS,
      sourceResolutionM: 10,
      analystNotes:
        "The layout is traced from public imagery. Individual building functions inside that layout are not established by it.",
      uncertainty: measurementUncertainty({
        sourceIds: ["sentinel-2-scene-2025"],
        sourceResolutionM: 10,
        latestDate: imagery.publishedOn,
        narrative:
          "The frame's registration to the ground carries the same ±40 m the reference coordinate does. Building functions inside the frame are not established by imagery at all.",
      }),
      subjectKind: "context",
    });
  }
  if (expansion !== undefined) {
    records.push({
      id: `ev-${MISSION_SITE_ID}-npr-airfield-expansion`,
      subjectId: MISSION_SITE_ID,
      claim:
        "Public reporting describes a roughly three-mile runway and visible facility expansion at this airfield.",
      classification: "reported",
      confidence: CONFIDENCE_SCALE.medium,
      ...sourceFields(expansion),
      analystNotes:
        "Reported association only. This model does not confirm any facility function.",
      uncertainty: {
        ...(expansion.publishedOn === undefined
          ? {}
          : { latestDate: expansion.publishedOn }),
        identification: "probable",
        function: "unknown",
        narrative:
          "A reported association. The report gives no dimensions with tolerances, and this model does not establish what any facility is for.",
        sourceIds: ["npr-airfield-expansion"],
      },
      subjectKind: "context",
    });
  }
  if (spacecraft !== undefined) {
    records.push({
      id: `ev-${MISSION_SITE_ID}-swf-spacecraft-2026`,
      subjectId: MISSION_SITE_ID,
      claim:
        "Cited analysis associates the runway with likely reusable experimental spacecraft landings.",
      classification: "reported",
      confidence: CONFIDENCE_SCALE.low,
      ...sourceFields(spacecraft),
      analystNotes:
        '"Likely" is retained from the source. This project neither verifies nor renders any landing.',
      uncertainty: {
        ...(spacecraft.publishedOn === undefined
          ? {}
          : { latestDate: spacecraft.publishedOn }),
        // The source itself hedges. Recording that hedge as "possible" rather
        // than promoting it to "probable" is the whole job of this field.
        identification: "possible",
        function: "possible",
        narrative:
          '"Likely" is the source\'s own word and is retained. No landing is rendered, dated or corroborated here.',
        sourceIds: ["swf-spacecraft-2026"],
      },
      subjectKind: "context",
    });
  }

  for (const place of OFFSITE_CONTEXT) {
    for (const sourceId of place.sourceIds) {
      const source = getSource(sourceId);
      if (source === undefined) continue;
      records.push({
        id: `ev-${place.id}-${sourceId}`,
        subjectId: place.id,
        claim: `${place.name} lies about ${place.distanceFromAirfieldKm} km from the airfield reference point and is not rendered in this scene.`,
        classification: "reported",
        confidence: CONFIDENCE_SCALE.medium,
        ...sourceFields(source),
        coordinateReferenceSystem: GEOGRAPHIC_CRS,
        analystNotes: place.note,
        uncertainty: {
          ...(source.publishedOn === undefined ? {} : { latestDate: source.publishedOn }),
          identification: "probable",
          function: "unknown",
          narrative: `Regional context at about ${place.distanceFromAirfieldKm} km. The coordinate is approximate, the place is outside the modeled frame and nothing about it is rendered, so no positional envelope applies inside this scene.`,
          sourceIds: place.sourceIds,
        },
        subjectKind: "context",
      });
    }
  }
  return records;
}

/** Procedural motion and scenery: sourced to the model, never to a publisher. */
function simulationRecords(): EvidenceRecord[] {
  const simulated: readonly { id: string; claim: string }[] = [
    {
      id: CIRCUIT_ROUTE_ENTITY_ID,
      claim:
        "The resident flight circuit is derived from the modeled runway. It is not a published procedure or an observed traffic pattern.",
    },
    {
      id: CIRCUIT_AIRCRAFT_ID,
      claim:
        "The circuit demonstrator is a procedural aircraft flying a deterministic path. It represents no identified airframe and no observed sortie.",
    },
    {
      id: PERIMETER_ROUTE_ENTITY_ID,
      claim:
        "The perimeter patrol route is drawn from modeled compound streets. It is not a surveyed or observed security route.",
    },
    {
      id: RADAR_ENTITY_ID,
      claim:
        "The rotating radar prop asserts no detection range, coverage or performance. Its motion is decorative.",
    },
    {
      id: WINDSOCK_ENTITY_ID,
      claim:
        "The windsock is driven by monthly climatology, not by measured wind at the site.",
    },
    ...PATROL_ENTITY_IDS.map((id, index) => ({
      id,
      claim: `Perimeter patrol vehicle ${index + 1} follows a seeded deterministic path. It is not an observed vehicle or an observed patrol.`,
    })),
  ];

  return simulated.map(({ id, claim }): EvidenceRecord => ({
    id: `ev-${id}-${MODEL_INTERNAL_SOURCE_ID}`,
    subjectId: id,
    claim,
    classification: "illustrative",
    confidence: CONFIDENCE_SCALE.low,
    ...internalSourceFields(),
    analystNotes:
      "Illustrative simulation element. Motion is deterministic scenario content and carries no claim about site activity.",
    uncertainty: illustrativeUncertainty(),
    subjectKind: "simulation",
  }));
}

/**
 * The ledger, sorted by record id so every consumer — UI, exporter and the
 * release-manifest hash — sees the same order on every run.
 */
export const EVIDENCE_LEDGER: readonly EvidenceRecord[] = Object.freeze(
  [
    ...STRUCTURES.flatMap(structureRecords),
    ...pavementRecords(),
    ...measurementRecords(),
    ...environmentAndTerrainRecords(),
    ...siteAndContextRecords(),
    ...simulationRecords(),
  ].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
);

const RECORDS_BY_SUBJECT = ((): ReadonlyMap<string, readonly EvidenceRecord[]> => {
  const index = new Map<string, EvidenceRecord[]>();
  for (const record of EVIDENCE_LEDGER) {
    const list = index.get(record.subjectId);
    if (list === undefined) index.set(record.subjectId, [record]);
    else list.push(record);
  }
  return index;
})();

export function getEvidenceForSubject(subjectId: string): readonly EvidenceRecord[] {
  return RECORDS_BY_SUBJECT.get(subjectId) ?? [];
}

export function getEvidenceRecord(id: string): EvidenceRecord | undefined {
  return EVIDENCE_LEDGER.find((record) => record.id === id);
}

/**
 * The uncertainty a subject carries, merged across its records.
 *
 * A subject usually has one record per citing source and they agree, because
 * they are derived from the same declared evidence. Where they differ, this
 * takes the *widest* envelope: the largest number, the weakest ordinal, the
 * widest date range. Reporting the narrowest would let a second citation make
 * the model look more certain than any single source supports, which is the
 * exact failure this whole module exists to prevent.
 */
export function getUncertaintyForSubject(
  subjectId: string,
): UncertaintyEnvelope | undefined {
  const envelopes = getEvidenceForSubject(subjectId)
    .map((record) => record.uncertainty)
    .filter((envelope): envelope is UncertaintyEnvelope => envelope !== undefined);
  const first = envelopes[0];
  if (first === undefined) return undefined;
  if (envelopes.length === 1) return first;

  const widest = <K extends "horizontalMeters" | "footprintMeters">(
    key: K,
  ): number | undefined => {
    const values = envelopes
      .map((envelope) => envelope[key])
      .filter((value): value is number => value !== undefined);
    return values.length === 0 ? undefined : Math.max(...values);
  };
  const weakest = (key: "identification" | "function"): UncertaintyLevel => {
    let worst = 0;
    for (const envelope of envelopes) {
      worst = Math.max(worst, UNCERTAINTY_LEVELS.indexOf(envelope[key]));
    }
    return UNCERTAINTY_LEVELS[worst] ?? "unknown";
  };
  const dates = (key: "earliestDate" | "latestDate", pick: "min" | "max") => {
    const values = envelopes
      .map((envelope) => envelope[key])
      .filter((value): value is string => value !== undefined)
      .sort();
    return pick === "min" ? values[0] : values[values.length - 1];
  };

  const horizontalMeters = widest("horizontalMeters");
  const footprintMeters = widest("footprintMeters");
  // The method and basis belong to whichever envelope actually supplied a
  // number, so they cannot be taken from `first` unconditionally.
  const numericSource = envelopes.find(
    (envelope) =>
      envelope.horizontalMeters !== undefined || envelope.footprintMeters !== undefined,
  );
  const earliestDate = dates("earliestDate", "min");
  const latestDate = dates("latestDate", "max");
  const narratives = [
    ...new Set(
      envelopes
        .map((envelope) => envelope.narrative)
        .filter((note): note is string => note !== undefined),
    ),
  ];

  return {
    ...(horizontalMeters === undefined ? {} : { horizontalMeters }),
    ...(footprintMeters === undefined ? {} : { footprintMeters }),
    ...(numericSource?.method === undefined ? {} : { method: numericSource.method }),
    ...(numericSource?.basis === undefined ? {} : { basis: numericSource.basis }),
    ...(earliestDate === undefined ? {} : { earliestDate }),
    ...(latestDate === undefined ? {} : { latestDate }),
    identification: weakest("identification"),
    function: weakest("function"),
    ...(envelopes.some((envelope) => envelope.sourceDisagreement === true)
      ? { sourceDisagreement: true }
      : {}),
    ...(narratives.length === 0 ? {} : { narrative: narratives.join(" ") }),
    sourceIds: [...new Set(envelopes.flatMap((envelope) => envelope.sourceIds))],
  };
}

/** Count of records per classification, for the legend and the manifest. */
export function evidenceClassificationCounts(): Record<EvidenceClassification, number> {
  const counts: Record<EvidenceClassification, number> = {
    observed: 0,
    reported: 0,
    interpreted: 0,
    illustrative: 0,
  };
  for (const record of EVIDENCE_LEDGER) counts[record.classification] += 1;
  return counts;
}

/**
 * The strongest classification asserted about a subject, using the ordering
 * observed > reported > interpreted > illustrative. The dossier uses it to
 * label a subject once instead of listing every record's status.
 */
const CLASSIFICATION_RANK: Record<EvidenceClassification, number> = {
  observed: 3,
  reported: 2,
  interpreted: 1,
  illustrative: 0,
};

export function strongestClassification(
  records: readonly EvidenceRecord[],
): EvidenceClassification | undefined {
  let best: EvidenceClassification | undefined;
  for (const record of records) {
    if (
      best === undefined ||
      CLASSIFICATION_RANK[record.classification] > CLASSIFICATION_RANK[best]
    ) {
      best = record.classification;
    }
  }
  return best;
}

/** Source register size, exported so the manifest never recounts it by hand. */
export const SOURCE_COUNT = PUBLIC_SOURCES.length;
