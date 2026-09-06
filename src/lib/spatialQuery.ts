import { EVIDENCE_CLASSIFICATIONS, type EvidenceClassification } from "./evidence";
import { effectiveClassification } from "./evidenceMode";
import {
  SPATIAL_SUBJECTS,
  getSpatialSubject,
  type SpatialSubject,
  type SpatialSubjectKind,
} from "./spatialCatalog";
import { deriveSnapshot, isIsoDate, type SubjectPresence } from "./temporal";
import type { UncertaintyEnvelope } from "./uncertainty";

export type LocalPoint = readonly [x: number, z: number];
export type LocalRing = readonly LocalPoint[];

const EPSILON = 1e-9;

function assertFinitePoint(point: LocalPoint, name: string): void {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
    throw new RangeError(`${name} must contain only finite coordinates`);
  }
}

function ringVertices(ring: LocalRing): readonly LocalPoint[] {
  if (ring.length < 4) {
    throw new RangeError("polygon rings must contain at least four points");
  }
  ring.forEach((point, index) => assertFinitePoint(point, `ring[${index}]`));

  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  const vertices =
    Math.abs(first[0] - last[0]) <= EPSILON && Math.abs(first[1] - last[1]) <= EPSILON
      ? ring.slice(0, -1)
      : ring;
  if (vertices.length < 4) {
    throw new RangeError("polygon rings must contain at least four vertices");
  }
  return vertices;
}

function cross(origin: LocalPoint, left: LocalPoint, right: LocalPoint): number {
  return (
    (left[0] - origin[0]) * (right[1] - origin[1]) -
    (left[1] - origin[1]) * (right[0] - origin[0])
  );
}

function pointEquals(left: LocalPoint, right: LocalPoint): boolean {
  return (
    Math.abs(left[0] - right[0]) <= EPSILON && Math.abs(left[1] - right[1]) <= EPSILON
  );
}

function pointOnSegment(point: LocalPoint, a: LocalPoint, b: LocalPoint): boolean {
  if (Math.abs(cross(a, b, point)) > EPSILON) return false;
  return (
    point[0] <= Math.max(a[0], b[0]) + EPSILON &&
    point[0] + EPSILON >= Math.min(a[0], b[0]) &&
    point[1] <= Math.max(a[1], b[1]) + EPSILON &&
    point[1] + EPSILON >= Math.min(a[1], b[1])
  );
}

function segmentsIntersect(
  a: LocalPoint,
  b: LocalPoint,
  c: LocalPoint,
  d: LocalPoint,
): boolean {
  if (pointEquals(a, b)) return pointOnSegment(a, c, d);
  if (pointEquals(c, d)) return pointOnSegment(c, a, b);

  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);

  if (Math.abs(abC) <= EPSILON && pointOnSegment(c, a, b)) return true;
  if (Math.abs(abD) <= EPSILON && pointOnSegment(d, a, b)) return true;
  if (Math.abs(cdA) <= EPSILON && pointOnSegment(a, c, d)) return true;
  if (Math.abs(cdB) <= EPSILON && pointOnSegment(b, c, d)) return true;

  return abC > EPSILON !== abD > EPSILON && cdA > EPSILON !== cdB > EPSILON;
}

function pointInPolygon(point: LocalPoint, ring: LocalRing): boolean {
  const vertices = ringVertices(ring);
  let inside = false;

  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    if (pointOnSegment(point, current, next)) return true;

    const intersects =
      current[1] > point[1] !== next[1] > point[1] &&
      point[0] <
        ((next[0] - current[0]) * (point[1] - current[1])) / (next[1] - current[1]) +
          current[0];
    if (intersects) inside = !inside;
  }

  return inside;
}

export function pointToSegmentDistance(
  point: LocalPoint,
  a: LocalPoint,
  b: LocalPoint,
): number {
  assertFinitePoint(point, "point");
  assertFinitePoint(a, "segment start");
  assertFinitePoint(b, "segment end");

  const deltaX = b[0] - a[0];
  const deltaZ = b[1] - a[1];
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (lengthSquared <= EPSILON) {
    return Math.hypot(point[0] - a[0], point[1] - a[1]);
  }

  const projection =
    ((point[0] - a[0]) * deltaX + (point[1] - a[1]) * deltaZ) / lengthSquared;
  const clamped = Math.min(1, Math.max(0, projection));
  const nearestX = a[0] + deltaX * clamped;
  const nearestZ = a[1] + deltaZ * clamped;
  return Math.hypot(point[0] - nearestX, point[1] - nearestZ);
}

export function polygonsIntersect(left: LocalRing, right: LocalRing): boolean {
  const leftVertices = ringVertices(left);
  const rightVertices = ringVertices(right);

  for (let leftIndex = 0; leftIndex < leftVertices.length; leftIndex += 1) {
    const leftStart = leftVertices[leftIndex]!;
    const leftEnd = leftVertices[(leftIndex + 1) % leftVertices.length]!;
    for (let rightIndex = 0; rightIndex < rightVertices.length; rightIndex += 1) {
      const rightStart = rightVertices[rightIndex]!;
      const rightEnd = rightVertices[(rightIndex + 1) % rightVertices.length]!;
      if (segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd)) return true;
    }
  }

  return (
    pointInPolygon(leftVertices[0]!, right) || pointInPolygon(rightVertices[0]!, left)
  );
}

export function footprintDistanceM(left: LocalRing, right: LocalRing): number {
  const leftVertices = ringVertices(left);
  const rightVertices = ringVertices(right);
  if (polygonsIntersect(left, right)) return 0;

  let best = Number.POSITIVE_INFINITY;

  for (const point of leftVertices) {
    for (let index = 0; index < rightVertices.length; index += 1) {
      best = Math.min(
        best,
        pointToSegmentDistance(
          point,
          rightVertices[index]!,
          rightVertices[(index + 1) % rightVertices.length]!,
        ),
      );
    }
  }

  for (const point of rightVertices) {
    for (let index = 0; index < leftVertices.length; index += 1) {
      best = Math.min(
        best,
        pointToSegmentDistance(
          point,
          leftVertices[index]!,
          leftVertices[(index + 1) % leftVertices.length]!,
        ),
      );
    }
  }

  return best;
}

export function footprintCentroid(ring: LocalRing): LocalPoint {
  const vertices = ringVertices(ring);
  const sum = vertices.reduce(
    (value, [x, z]) => [value[0] + x, value[1] + z] as LocalPoint,
    [0, 0] as LocalPoint,
  );
  return [sum[0] / vertices.length, sum[1] / vertices.length];
}

export type CardinalRelation =
  "north-of" | "south-of" | "east-of" | "west-of" | "coincident";

export function cardinalRelation(left: LocalRing, right: LocalRing): CardinalRelation {
  const [leftX, leftZ] = footprintCentroid(left);
  const [rightX, rightZ] = footprintCentroid(right);
  const dx = leftX - rightX;
  const dz = leftZ - rightZ;
  if (Math.abs(dx) <= EPSILON && Math.abs(dz) <= EPSILON) return "coincident";
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? "east-of" : "west-of";
  return dz < 0 ? "north-of" : "south-of";
}

export function nearestSpatialSubject(
  anchorSubjectId: string,
): SpatialSubject | undefined {
  const anchor = getSpatialSubject(anchorSubjectId);
  if (anchor === undefined) return undefined;
  return SPATIAL_SUBJECTS.filter((subject) => subject.id !== anchor.id).sort((a, b) => {
    const delta =
      footprintDistanceM(a.footprint, anchor.footprint) -
      footprintDistanceM(b.footprint, anchor.footprint);
    return Math.abs(delta) > EPSILON ? delta : a.id.localeCompare(b.id);
  })[0];
}

export type SourceSupport = "any" | "direct-observation" | "without-direct-observation";

export interface SpatialQuery {
  kinds?: readonly SpatialSubjectKind[];
  evidenceClasses?: readonly EvidenceClassification[];
  sourceSupport?: SourceSupport;
  maximumStatedHorizontalUncertaintyM?: number;
  includeUnknownHorizontalUncertainty?: boolean;
  snapshotDate?: string;
  presence?: readonly SubjectPresence[];
  anchorSubjectId?: string;
  maximumDistanceM?: number;
}

export interface SpatialQueryResult {
  subject: SpatialSubject;
  distanceM?: number;
  presence?: SubjectPresence;
  anchor?: {
    subjectId: string;
    uncertainty?: UncertaintyEnvelope;
  };
}

export type SpatialQueryResponse =
  | {
      ok: true;
      query: SpatialQuery;
      results: readonly SpatialQueryResult[];
      derivation: string;
    }
  | { ok: false; errors: readonly string[] };

export type SuccessfulSpatialQuery = Extract<SpatialQueryResponse, { ok: true }>;

export const SPATIAL_SUBJECT_KINDS: readonly SpatialSubjectKind[] = [
  "aircraft",
  "apron",
  "pavement",
  "structure",
];
export const SOURCE_SUPPORT_VALUES: readonly SourceSupport[] = [
  "any",
  "direct-observation",
  "without-direct-observation",
];
export const SUBJECT_PRESENCE_VALUES: readonly SubjectPresence[] = [
  "established",
  "not-yet-evidenced",
  "undated",
];

function normalizedMembers<T extends string>(
  values: readonly T[] | undefined,
  allowed: readonly T[],
  label: string,
  errors: string[],
): readonly T[] | undefined {
  if (values === undefined) return undefined;
  const invalid = values.filter((value) => !allowed.includes(value));
  if (invalid.length > 0) {
    errors.push(`${label} contains unsupported value(s): ${invalid.join(", ")}`);
    return undefined;
  }
  const requested = new Set(values);
  return Object.freeze(allowed.filter((value) => requested.has(value)));
}

function finiteNonNegative(
  value: number | undefined,
  label: string,
  errors: string[],
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${label} must be a finite non-negative number`);
    return undefined;
  }
  return value;
}

function hasDirectObservation(subjectId: string): boolean {
  return effectiveClassification(subjectId) === "observed";
}

function normalizeQuery(query: SpatialQuery): {
  query: SpatialQuery;
  errors: readonly string[];
} {
  const errors: string[] = [];
  const kinds = normalizedMembers(query.kinds, SPATIAL_SUBJECT_KINDS, "kinds", errors);
  const evidenceClasses = normalizedMembers(
    query.evidenceClasses,
    EVIDENCE_CLASSIFICATIONS,
    "evidenceClasses",
    errors,
  );
  const presence = normalizedMembers(
    query.presence,
    SUBJECT_PRESENCE_VALUES,
    "presence",
    errors,
  );
  const maximumStatedHorizontalUncertaintyM = finiteNonNegative(
    query.maximumStatedHorizontalUncertaintyM,
    "maximumStatedHorizontalUncertaintyM",
    errors,
  );
  const maximumDistanceM = finiteNonNegative(
    query.maximumDistanceM,
    "maximumDistanceM",
    errors,
  );

  if (
    query.sourceSupport !== undefined &&
    !SOURCE_SUPPORT_VALUES.includes(query.sourceSupport)
  ) {
    errors.push(`sourceSupport contains unsupported value: ${query.sourceSupport}`);
  }
  if (query.snapshotDate !== undefined && !isIsoDate(query.snapshotDate)) {
    errors.push("snapshotDate must be a valid ISO YYYY-MM-DD calendar date");
  }
  if (query.presence !== undefined && query.snapshotDate === undefined) {
    errors.push("presence requires snapshotDate");
  }
  const hasAnchor = query.anchorSubjectId !== undefined;
  const hasDistance = query.maximumDistanceM !== undefined;
  if (hasAnchor !== hasDistance) {
    errors.push("anchorSubjectId and maximumDistanceM must be provided together");
  }
  if (
    query.anchorSubjectId !== undefined &&
    getSpatialSubject(query.anchorSubjectId) === undefined
  ) {
    errors.push(
      `anchorSubjectId does not name a spatial subject: ${query.anchorSubjectId}`,
    );
  }

  const normalized: SpatialQuery = {
    ...(kinds === undefined ? {} : { kinds }),
    ...(evidenceClasses === undefined ? {} : { evidenceClasses }),
    ...(query.sourceSupport === undefined ? {} : { sourceSupport: query.sourceSupport }),
    ...(maximumStatedHorizontalUncertaintyM === undefined
      ? {}
      : { maximumStatedHorizontalUncertaintyM }),
    ...(query.includeUnknownHorizontalUncertainty === undefined
      ? {}
      : {
          includeUnknownHorizontalUncertainty: query.includeUnknownHorizontalUncertainty,
        }),
    ...(query.snapshotDate === undefined ? {} : { snapshotDate: query.snapshotDate }),
    ...(presence === undefined ? {} : { presence }),
    ...(query.anchorSubjectId === undefined
      ? {}
      : { anchorSubjectId: query.anchorSubjectId }),
    ...(maximumDistanceM === undefined ? {} : { maximumDistanceM }),
  };

  return { query: Object.freeze(normalized), errors: Object.freeze(errors) };
}

const QUERY_DERIVATION =
  "Results use deterministic modeled footprint distance in the local EPSG:32645 grid. Distances are planar model relationships, not geodesic or surveyed measurements; derived distance uncertainty is unknown.";

export function runSpatialQuery(query: SpatialQuery): SpatialQueryResponse {
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    return { ok: false, errors: ["query must be an object"] };
  }
  const runtime = query as Record<string, unknown>;
  for (const key of ["kinds", "evidenceClasses", "presence"] as const) {
    if (runtime[key] !== undefined && !Array.isArray(runtime[key])) {
      return { ok: false, errors: [`${key} must be an array`] };
    }
  }
  if (
    runtime["includeUnknownHorizontalUncertainty"] !== undefined &&
    typeof runtime["includeUnknownHorizontalUncertainty"] !== "boolean"
  ) {
    return {
      ok: false,
      errors: ["includeUnknownHorizontalUncertainty must be a boolean"],
    };
  }
  const normalized = normalizeQuery(query);
  if (normalized.errors.length > 0) {
    return { ok: false, errors: normalized.errors };
  }

  const kinds =
    normalized.query.kinds === undefined ? undefined : new Set(normalized.query.kinds);
  const evidenceClasses =
    normalized.query.evidenceClasses === undefined
      ? undefined
      : new Set(normalized.query.evidenceClasses);
  const presenceFilter =
    normalized.query.presence === undefined
      ? undefined
      : new Set(normalized.query.presence);
  const snapshot =
    normalized.query.snapshotDate === undefined
      ? undefined
      : deriveSnapshot(normalized.query.snapshotDate);
  const presenceById =
    snapshot === undefined
      ? undefined
      : new Map(
          snapshot.subjects.map((subject) => [subject.subjectId, subject.presence]),
        );
  const anchor =
    normalized.query.anchorSubjectId === undefined
      ? undefined
      : getSpatialSubject(normalized.query.anchorSubjectId);
  const anchorMetadata =
    anchor === undefined
      ? undefined
      : Object.freeze({
          subjectId: anchor.id,
          ...(anchor.uncertainty === undefined
            ? {}
            : { uncertainty: anchor.uncertainty }),
        });

  const results: SpatialQueryResult[] = [];
  for (const subject of SPATIAL_SUBJECTS) {
    if (kinds !== undefined && !kinds.has(subject.kind)) continue;
    if (evidenceClasses !== undefined && !evidenceClasses.has(subject.evidenceClass)) {
      continue;
    }

    const directObservation = hasDirectObservation(subject.id);
    if (normalized.query.sourceSupport === "direct-observation" && !directObservation) {
      continue;
    }
    if (
      normalized.query.sourceSupport === "without-direct-observation" &&
      directObservation
    ) {
      continue;
    }

    const maximumUncertainty = normalized.query.maximumStatedHorizontalUncertaintyM;
    if (maximumUncertainty !== undefined) {
      const horizontal = subject.uncertainty?.horizontalMeters;
      if (horizontal === undefined) {
        if (!normalized.query.includeUnknownHorizontalUncertainty) continue;
      } else if (horizontal > maximumUncertainty) {
        continue;
      }
    }

    const presence = presenceById?.get(subject.id);
    if (presenceFilter !== undefined) {
      if (presence === undefined || !presenceFilter.has(presence)) continue;
    }

    let distanceM: number | undefined;
    if (anchor !== undefined) {
      if (subject.id === anchor.id) continue;
      distanceM = footprintDistanceM(subject.footprint, anchor.footprint);
      if (distanceM > normalized.query.maximumDistanceM!) continue;
    }

    results.push({
      subject,
      ...(distanceM === undefined ? {} : { distanceM }),
      ...(presence === undefined ? {} : { presence }),
      ...(anchorMetadata === undefined ? {} : { anchor: anchorMetadata }),
    });
  }

  results.sort((left, right) => {
    if (left.distanceM !== undefined || right.distanceM !== undefined) {
      const distance =
        (left.distanceM ?? Number.POSITIVE_INFINITY) -
        (right.distanceM ?? Number.POSITIVE_INFINITY);
      if (Math.abs(distance) > EPSILON) return distance;
    }
    return left.subject.id < right.subject.id
      ? -1
      : left.subject.id > right.subject.id
        ? 1
        : 0;
  });

  return {
    ok: true,
    query: normalized.query,
    results: Object.freeze(results),
    derivation: QUERY_DERIVATION,
  };
}
