import { canonicalJson } from "./canonicalJson";
import { KNOWN_LIMITATIONS, PRIMARY_CRS } from "./evidence";
import { localToProjected, localToWgs84 } from "./geospatial";
import type {
  SpatialQueryResult,
  SuccessfulSpatialQuery,
} from "./spatialQuery";

export const SPATIAL_EXPORT_SCHEMA_VERSION = "lop-nur-spatial-query/1.0.0";

export interface SpatialExportIdentity {
  modelVersion?: string;
  geometryHash?: string;
  evidenceLedgerHash?: string;
}

function rounded(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function exportIdentity(
  identity: SpatialExportIdentity | undefined,
): SpatialExportIdentity | undefined {
  if (identity === undefined) return undefined;
  const kept = {
    ...(identity.modelVersion === undefined
      ? {}
      : { modelVersion: identity.modelVersion }),
    ...(identity.geometryHash === undefined
      ? {}
      : { geometryHash: identity.geometryHash }),
    ...(identity.evidenceLedgerHash === undefined
      ? {}
      : { evidenceLedgerHash: identity.evidenceLedgerHash }),
  };
  return Object.keys(kept).length === 0 ? undefined : kept;
}

function resultRecord(result: SpatialQueryResult) {
  const { subject } = result;
  return {
    subjectId: subject.id,
    label: subject.label,
    kind: subject.kind,
    evidenceClass: subject.evidenceClass,
    ...(subject.confidence === undefined
      ? { confidence: "not stated" }
      : { confidence: subject.confidence }),
    sourceIds: subject.sourceIds,
    ...(result.presence === undefined
      ? { presence: "not stated" }
      : { presence: result.presence }),
    ...(result.distanceM === undefined
      ? { modeledDistanceM: "not stated" }
      : { modeledDistanceM: rounded(result.distanceM, 3) }),
    horizontalUncertaintyM: subject.uncertainty?.horizontalMeters ?? "not stated",
    footprintUncertaintyM: subject.uncertainty?.footprintMeters ?? "not stated",
    distanceUncertainty: "unknown",
    observedDate: subject.observedDate ?? "not stated",
    localFootprint: subject.footprint,
    projectedFootprint: subject.footprint.map(([x, z]) => localToProjected({ x, z })),
  };
}

function exportEnvelope(
  response: SuccessfulSpatialQuery,
  identity?: SpatialExportIdentity,
) {
  const keptIdentity = exportIdentity(identity);
  return {
    schemaVersion: SPATIAL_EXPORT_SCHEMA_VERSION,
    query: response.query,
    ...(keptIdentity === undefined ? {} : { identity: keptIdentity }),
    coordinateReferenceSystem: PRIMARY_CRS,
    coordinateMeaning:
      "Modeled positions registered to the project grid; numerical precision is not survey accuracy.",
    derivation: response.derivation,
    knownLimitations: KNOWN_LIMITATIONS,
    results: response.results.map(resultRecord),
  };
}

export function spatialResultsToJson(
  response: SuccessfulSpatialQuery,
  identity?: SpatialExportIdentity,
): string {
  return `${canonicalJson(exportEnvelope(response, identity))}\n`;
}

function csvText(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function csvMetric(value: number | undefined): string {
  return value === undefined ? csvText("not stated") : String(rounded(value, 3));
}

export function spatialResultsToCsv(response: SuccessfulSpatialQuery): string {
  const header = [
    "subject_id",
    "label",
    "kind",
    "evidence_class",
    "confidence",
    "source_ids",
    "presence",
    "modeled_distance_m",
    "horizontal_uncertainty_m",
    "footprint_uncertainty_m",
    "distance_uncertainty",
  ].join(",");
  const rows = response.results.map(({ subject, distanceM, presence }) =>
    [
      csvText(subject.id),
      csvText(subject.label),
      csvText(subject.kind),
      csvText(subject.evidenceClass),
      csvMetric(subject.confidence),
      csvText(subject.sourceIds.join(";")),
      csvText(presence ?? "not stated"),
      csvMetric(distanceM),
      csvMetric(subject.uncertainty?.horizontalMeters),
      csvMetric(subject.uncertainty?.footprintMeters),
      csvText("unknown"),
    ].join(","),
  );
  return `${[header, ...rows].join("\r\n")}\r\n`;
}

type GeoJsonPosition = readonly [longitude: number, latitude: number];

interface GeoJsonFeature {
  type: "Feature";
  id: string;
  geometry: {
    type: "Polygon";
    coordinates: readonly (readonly GeoJsonPosition[])[];
  };
  properties: Record<string, unknown>;
}

function wgs84Ring(result: SpatialQueryResult): readonly GeoJsonPosition[] {
  const positions = result.subject.footprint.map(([x, z]) => {
    const coordinate = localToWgs84({ x, z });
    const position: GeoJsonPosition = [
      rounded(coordinate.longitude, 6),
      rounded(coordinate.latitude, 6),
    ];
    if (
      !position.every(Number.isFinite) ||
      position[0] < -180 ||
      position[0] > 180 ||
      position[1] < -90 ||
      position[1] > 90
    ) {
      throw new RangeError(
        `GeoJSON coordinate for ${result.subject.id} is outside WGS84 bounds`,
      );
    }
    return position;
  });
  const first = positions[0];
  if (first === undefined || positions.length < 5) {
    throw new RangeError(
      `GeoJSON polygon for ${result.subject.id} must contain a closed ring`,
    );
  }
  positions[positions.length - 1] = first;
  return positions;
}

function geoJsonFeature(result: SpatialQueryResult): GeoJsonFeature {
  const { subject } = result;
  return {
    type: "Feature",
    id: subject.id,
    geometry: {
      type: "Polygon",
      coordinates: [wgs84Ring(result)],
    },
    properties: {
      subjectId: subject.id,
      label: subject.label,
      kind: subject.kind,
      evidenceClass: subject.evidenceClass,
      confidence: subject.confidence ?? "not stated",
      sourceIds: subject.sourceIds,
      presence: result.presence ?? "not stated",
      modeledDistanceM:
        result.distanceM === undefined ? "not stated" : rounded(result.distanceM, 3),
      horizontalUncertaintyM: subject.uncertainty?.horizontalMeters ?? "not stated",
      footprintUncertaintyM: subject.uncertainty?.footprintMeters ?? "not stated",
      distanceUncertainty: "unknown",
      sourceCoordinateReferenceSystem: PRIMARY_CRS,
      derivation:
        "WGS84 polygon transformed from the modeled EPSG:32645 footprint; numerical coordinate precision is not positional accuracy.",
    },
  };
}

export function spatialResultsToGeoJson(
  response: SuccessfulSpatialQuery,
  identity?: SpatialExportIdentity,
): string {
  const keptIdentity = exportIdentity(identity);
  const collection = {
    type: "FeatureCollection",
    features: response.results.map(geoJsonFeature),
    lopNurTwin: {
      schemaVersion: SPATIAL_EXPORT_SCHEMA_VERSION,
      query: response.query,
      ...(keptIdentity === undefined ? {} : { identity: keptIdentity }),
      sourceCoordinateReferenceSystem: PRIMARY_CRS,
      coordinateReferenceSystem: "EPSG:4326",
      derivation: response.derivation,
      knownLimitations: KNOWN_LIMITATIONS,
    },
  };
  return `${canonicalJson(collection)}\n`;
}
