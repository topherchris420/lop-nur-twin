import * as THREE from "three";
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

/**
 * The independent reference: the corners the scene actually renders, read off
 * the same Three.js transforms `Structures.tsx` and `Pavements.tsx` apply.
 * An earlier version of this test re-derived the catalog's own formula and so
 * agreed with it while every rotated building was exported as its mirror image.
 */
function renderedCorners(
  object: THREE.Object3D,
  width: number,
  depth: number,
  plane: boolean,
): LocalRing {
  object.updateMatrixWorld(true);
  const offsets: readonly LocalPoint[] = [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ];
  const corners: readonly LocalPoint[] = offsets.map(([a, b]) => {
    // A structure's footprint lies in its local XZ plane; an apron is a
    // PlaneGeometry, whose extent lies in its local XY plane.
    const local = plane ? new THREE.Vector3(a, b, 0) : new THREE.Vector3(a, 0, b);
    const world = local.applyMatrix4(object.matrixWorld);
    return [world.x, world.z];
  });
  return [...corners, corners[0]!] as LocalRing;
}

function renderedStructure(def: StructureDef): LocalRing {
  // `StructureNode`: <group position={[x, 0, z]} rotation={[0, rotation, 0]}>.
  const group = new THREE.Group();
  group.position.set(def.position[0], 0, def.position[1]);
  group.rotation.set(0, def.rotation, 0);
  return renderedCorners(group, def.size[0], def.size[2], false);
}

function renderedApron(def: ApronDef): LocalRing {
  // `ApronSlab`: <mesh rotation={[-π/2, 0, -rotation]}><planeGeometry args={size} />.
  const mesh = new THREE.Object3D();
  mesh.position.set(def.center[0], 0, def.center[1]);
  mesh.rotation.set(-Math.PI / 2, 0, -def.rotation);
  return renderedCorners(mesh, def.size[0], def.size[1], true);
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
  if ("position" in subject) return renderedStructure(subject);
  if ("center" in subject) return renderedApron(subject);
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

  it("closes every footprint ring on the corners the scene renders", () => {
    // A mirrored rectangle coincides with the original only at multiples of
    // 90°, so this is only a test if some footprint is rotated off-axis.
    expect(
      STRUCTURES.some((structure) => Math.abs(Math.sin(2 * structure.rotation)) > 0.1),
    ).toBe(true);
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
