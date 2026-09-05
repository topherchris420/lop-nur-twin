import { describe, expect, it } from "vitest";
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
} from "./evidence";
import {
  SPATIAL_SUBJECTS,
  getSpatialSubject,
  type LocalPoint,
  type LocalRing,
} from "./spatialCatalog";

function sortCorners(points: readonly LocalPoint[]): readonly LocalPoint[] {
  return [...points].sort(([leftX, leftZ], [rightX, rightZ]) =>
    leftX === rightX ? leftZ - rightZ : leftX - rightX,
  );
}

function expectedRectangle(
  center: readonly [number, number],
  width: number,
  depth: number,
  rotation: number,
): LocalRing {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const offsets: readonly LocalPoint[] = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ];
  const corners: readonly LocalPoint[] = offsets.map(([x, z]) => [
    center[0] + x * cosine - z * sine,
    center[1] + x * sine + z * cosine,
  ]);
  return [...corners, corners[0]!] as LocalRing;
}

function expectedSegmentFootprint(segment: SegmentDef): LocalRing {
  const [fromX, fromZ] = segment.from;
  const [toX, toZ] = segment.to;
  const deltaX = toX - fromX;
  const deltaZ = toZ - fromZ;
  const length = Math.hypot(deltaX, deltaZ);
  const offsetX = (-deltaZ / length) * (segment.width / 2);
  const offsetZ = (deltaX / length) * (segment.width / 2);
  return [
    [fromX + offsetX, fromZ + offsetZ],
    [toX + offsetX, toZ + offsetZ],
    [toX - offsetX, toZ - offsetZ],
    [fromX - offsetX, fromZ - offsetZ],
    [fromX + offsetX, fromZ + offsetZ],
  ];
}

function expectedFootprint(subject: StructureDef | ApronDef | SegmentDef): LocalRing {
  if ("position" in subject) {
    return expectedRectangle(
      subject.position,
      subject.size[0],
      subject.size[2],
      subject.rotation,
    );
  }
  if ("center" in subject) {
    return expectedRectangle(
      subject.center,
      subject.size[0],
      subject.size[1],
      subject.rotation,
    );
  }
  return expectedSegmentFootprint(subject);
}

function expectedKind(subject: StructureDef | ApronDef | SegmentDef) {
  if ("position" in subject) return isAircraft(subject.type) ? "aircraft" : "structure";
  if ("center" in subject) return "apron";
  return "pavement";
}

function expectRingCloseTo(actual: LocalRing, expected: LocalRing): void {
  const actualCorners = sortCorners(actual.slice(0, -1));
  const expectedCorners = sortCorners(expected.slice(0, -1));
  expect(actualCorners).toHaveLength(expectedCorners.length);
  actualCorners.forEach((point, index) => {
    expect(point[0]).toBeCloseTo(expectedCorners[index]![0], 8);
    expect(point[1]).toBeCloseTo(expectedCorners[index]![1], 8);
  });
  expect(actual[0]![0]).toBeCloseTo(actual[actual.length - 1]![0], 8);
  expect(actual[0]![1]).toBeCloseTo(actual[actual.length - 1]![1], 8);
}

describe("spatial catalog", () => {
  it("contains one derived analytical subject for every layout structure, segment, and apron", () => {
    expect(SPATIAL_SUBJECTS).toHaveLength(
      STRUCTURES.length + ALL_SEGMENTS.length + APRONS.length,
    );
    expect(SPATIAL_SUBJECTS.map((subject) => subject.id)).toEqual(
      [...SPATIAL_SUBJECTS.map((subject) => subject.id)].sort(),
    );
    expect(new Set(SPATIAL_SUBJECTS.map((subject) => subject.id)).size).toBe(
      SPATIAL_SUBJECTS.length,
    );
    expect(
      SPATIAL_SUBJECTS.some((subject) => subject.id.startsWith("live-aircraft-")),
    ).toBe(false);
  });

  it("closes every footprint ring and preserves the declared rectangle corners", () => {
    const expectedSubjects = [...STRUCTURES, ...ALL_SEGMENTS, ...APRONS];
    expect(expectedSubjects).toHaveLength(SPATIAL_SUBJECTS.length);

    for (const source of expectedSubjects) {
      const subject = getSpatialSubject(source.id);
      expect(subject).toBeDefined();
      expect(subject?.footprint).toHaveLength(5);
      expectRingCloseTo(subject!.footprint, expectedFootprint(source));
    }
  });

  it("derives stable kinds and evidence metadata from the existing registries", () => {
    const expectedSubjects = [...STRUCTURES, ...ALL_SEGMENTS, ...APRONS];

    for (const source of expectedSubjects) {
      const subject = getSpatialSubject(source.id);
      const records = getEvidenceForSubject(source.id);
      expect(subject).toMatchObject({
        id: source.id,
        label: source.name,
        kind: expectedKind(source),
        evidenceClass: strongestClassification(records) ?? "illustrative",
        observedDate: source.observedDate,
      });
      expect(subject?.confidence).toBe(
        records.length === 0
          ? undefined
          : records.reduce((best, record) => Math.max(best, record.confidence), 0),
      );
      expect(subject?.sourceIds).toEqual(
        [
          ...new Set(
            records.map((record) => record.sourceId).filter((id) => id !== undefined),
          ),
        ].sort(),
      );
      expect(subject?.uncertainty).toEqual(getUncertaintyForSubject(source.id));
    }
  });
});
