import {
  ALL_SEGMENTS,
  APRONS,
  STRUCTURES,
  isAircraft,
  type ApronDef,
  type SegmentDef,
  type StructureDef,
} from "./layout";
import {
  getEvidenceForSubject,
  getUncertaintyForSubject,
  strongestClassification,
  type EvidenceClassification,
} from "./evidence";
import type { UncertaintyEnvelope } from "./uncertainty";
import type { LocalPoint, LocalRing } from "./spatialQuery";

export type { LocalPoint, LocalRing } from "./spatialQuery";

export type SpatialSubjectKind = "structure" | "aircraft" | "pavement" | "apron";

export interface SpatialSubject {
  id: string;
  label: string;
  kind: SpatialSubjectKind;
  footprint: LocalRing;
  evidenceClass: EvidenceClassification;
  confidence?: number;
  sourceIds: readonly string[];
  uncertainty?: UncertaintyEnvelope;
  observedDate?: string;
}

function freezePoint(x: number, z: number): LocalPoint {
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    throw new RangeError("footprint coordinates must be finite");
  }
  return Object.freeze([x, z] as const);
}

function closeRing(points: readonly LocalPoint[]): LocalRing {
  if (points.length < 4) {
    throw new RangeError("footprint polygons must contain four corners");
  }
  return Object.freeze([...points, points[0]!]);
}

function orientedRectangle(
  center: readonly [number, number],
  width: number,
  depth: number,
  rotation: number,
): LocalRing {
  if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) {
    throw new RangeError("rectangle center must be finite");
  }
  if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0) {
    throw new RangeError("rectangle dimensions must be positive finite numbers");
  }
  if (!Number.isFinite(rotation)) {
    throw new RangeError("rectangle rotation must be finite");
  }

  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);

  const corners = (
    [
      [-halfWidth, -halfDepth],
      [halfWidth, -halfDepth],
      [halfWidth, halfDepth],
      [-halfWidth, halfDepth],
    ] as const
  ).map(([x, z]) =>
    freezePoint(center[0] + x * cosine - z * sine, center[1] + x * sine + z * cosine),
  );

  return closeRing(corners);
}

function segmentFootprint(segment: SegmentDef): LocalRing {
  const [fromX, fromZ] = segment.from;
  const [toX, toZ] = segment.to;
  const deltaX = toX - fromX;
  const deltaZ = toZ - fromZ;
  const length = Math.hypot(deltaX, deltaZ);
  if (!Number.isFinite(length) || length === 0) {
    throw new RangeError(`segment ${segment.id} must have non-zero finite length`);
  }
  if (!Number.isFinite(segment.width) || segment.width <= 0) {
    throw new RangeError(`segment ${segment.id} width must be a positive finite number`);
  }

  const scale = segment.width / 2 / length;
  const offsetX = -deltaZ * scale;
  const offsetZ = deltaX * scale;

  return closeRing([
    freezePoint(fromX + offsetX, fromZ + offsetZ),
    freezePoint(toX + offsetX, toZ + offsetZ),
    freezePoint(toX - offsetX, toZ - offsetZ),
    freezePoint(fromX - offsetX, fromZ - offsetZ),
  ]);
}

function structureFootprint(structure: StructureDef): LocalRing {
  return orientedRectangle(
    structure.position,
    structure.size[0],
    structure.size[2],
    structure.rotation,
  );
}

function apronFootprint(apron: ApronDef): LocalRing {
  return orientedRectangle(apron.center, apron.size[0], apron.size[1], apron.rotation);
}

function subjectKind(source: StructureDef | SegmentDef | ApronDef): SpatialSubjectKind {
  if ("position" in source) return isAircraft(source.type) ? "aircraft" : "structure";
  if ("center" in source) return "apron";
  return "pavement";
}

function subjectFootprint(source: StructureDef | SegmentDef | ApronDef): LocalRing {
  if ("position" in source) return structureFootprint(source);
  if ("center" in source) return apronFootprint(source);
  return segmentFootprint(source);
}

function subjectConfidence(subjectId: string): number {
  return getEvidenceForSubject(subjectId).reduce(
    (best, record) => Math.max(best, record.confidence),
    0,
  );
}

function subjectSourceIds(subjectId: string): readonly string[] {
  const ids = getEvidenceForSubject(subjectId).flatMap((record) =>
    record.sourceId === undefined ? [] : [record.sourceId],
  );
  return Object.freeze([...new Set(ids)].sort());
}

function subjectEvidenceClass(subjectId: string): EvidenceClassification {
  const records = getEvidenceForSubject(subjectId);
  if (records.length === 0) {
    throw new Error(`missing evidence for spatial subject ${subjectId}`);
  }
  const classification = strongestClassification(records);
  if (classification === undefined) {
    throw new Error(`missing evidence classification for spatial subject ${subjectId}`);
  }
  return classification;
}

function createSubject(source: StructureDef | SegmentDef | ApronDef): SpatialSubject {
  if (source.id.startsWith("live-aircraft-")) {
    throw new Error(`live ADS-B subject ${source.id} must not enter the spatial catalog`);
  }

  const records = getEvidenceForSubject(source.id);
  if (records.length === 0) {
    throw new Error(`missing evidence records for spatial subject ${source.id}`);
  }

  const footprint = subjectFootprint(source);
  if (footprint.length !== 5) {
    throw new RangeError(
      `spatial subject ${source.id} must produce a closed four-corner ring`,
    );
  }

  return Object.freeze({
    id: source.id,
    label: source.name,
    kind: subjectKind(source),
    footprint,
    evidenceClass: subjectEvidenceClass(source.id),
    confidence: subjectConfidence(source.id),
    sourceIds: subjectSourceIds(source.id),
    uncertainty: getUncertaintyForSubject(source.id),
    observedDate: source.observedDate,
  });
}

export const SPATIAL_SUBJECTS: readonly SpatialSubject[] = Object.freeze(
  [...STRUCTURES, ...ALL_SEGMENTS, ...APRONS]
    .map((source) => createSubject(source))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
);

const SPATIAL_SUBJECT_INDEX = new Map(
  SPATIAL_SUBJECTS.map((subject) => [subject.id, subject] as const),
);

export function getSpatialSubject(id: string): SpatialSubject | undefined {
  return SPATIAL_SUBJECT_INDEX.get(id);
}
