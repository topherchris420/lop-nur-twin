import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { APRONS, ALL_SEGMENTS, STRUCTURES, segmentCenter } from "@/lib/layout";
import { terrainHeight } from "@/lib/terrain";
import {
  diffStatusIndex,
  forensicDiff,
  type SubjectDiffStatus,
} from "@/lib/forensicDiff";
import { useTwinStore } from "@/lib/store";

/**
 * The before/after diff, marked on the ground.
 *
 * `/compare` and `/analysis` can list what changed between two dates; only the
 * scene can show *where*. A reviewer reading "eleven subjects changed" has no
 * idea whether that is one corner of the compound or the whole site, and that
 * is usually the first thing they need to know.
 *
 * The three channels stay separated here exactly as they are in the tables. A
 * subject that appeared is a different event from a subject whose citation
 * changed underneath unchanged geometry, and marking both with one generic
 * "changed" badge would undo the distinction the diff exists to draw.
 *
 * Shape carries the meaning, not colour: ring radius and beam height differ per
 * status, so the marks are still distinguishable in a monochrome screenshot and
 * to a colour-blind reviewer. Every mark is also a row in the `/analysis`
 * comparison table, which is where the words are.
 */

interface MarkerStyle {
  color: string;
  /** Ground ring radius, in metres. */
  radiusM: number;
  /** Beam height, in metres. Negative drops the beam into the ground. */
  beamM: number;
  /** Dashes around the ring; 0 draws it solid. */
  dashes: number;
}

/**
 * Radius and beam are the ordinal channels and they are monotonic with how much
 * attention a change deserves: geometry changes are the largest marks, because
 * they are the ones that need a spatial re-review.
 */
const MARKER_STYLES: Record<Exclude<SubjectDiffStatus, "unchanged">, MarkerStyle> = {
  added: { color: "#4ade80", radiusM: 34, beamM: 120, dashes: 0 },
  removed: { color: "#f87171", radiusM: 34, beamM: -80, dashes: 10 },
  "evidence-changed": { color: "#38bdf8", radiusM: 24, beamM: 70, dashes: 0 },
  "interpretation-changed": { color: "#fbbf24", radiusM: 17, beamM: 44, dashes: 16 },
};

/** Every subject the scene can place, so a diff row can find its ground point. */
const SUBJECT_POSITIONS: ReadonlyMap<string, readonly [number, number]> = new Map([
  ...STRUCTURES.map(
    (structure) =>
      [structure.id, structure.position] as [string, readonly [number, number]],
  ),
  ...APRONS.map(
    (apron) => [apron.id, apron.center] as [string, readonly [number, number]],
  ),
  ...ALL_SEGMENTS.map(
    (segment) =>
      [segment.id, segmentCenter(segment)] as [string, readonly [number, number]],
  ),
]);

function markerGeometry(
  points: readonly (readonly [number, number])[],
  style: MarkerStyle,
): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];

  for (const [x, z] of points) {
    const base = terrainHeight(x, z) + 0.4;

    if (style.dashes === 0) {
      const ring = new THREE.RingGeometry(style.radiusM * 0.84, style.radiusM, 48);
      ring.rotateX(-Math.PI / 2);
      ring.translate(x, base, z);
      parts.push(ring);
    } else {
      const step = (Math.PI * 2) / style.dashes;
      for (let index = 0; index < style.dashes; index += 1) {
        const dash = new THREE.RingGeometry(
          style.radiusM * 0.84,
          style.radiusM,
          8,
          1,
          index * step,
          step * 0.5,
        );
        dash.rotateX(-Math.PI / 2);
        dash.translate(x, base, z);
        parts.push(dash);
      }
    }

    // A thin beam, so a mark is findable from a site-wide camera where a ground
    // ring is a couple of pixels across.
    const beam = new THREE.CylinderGeometry(1.1, 1.1, Math.abs(style.beamM), 6, 1, true);
    beam.translate(x, base + style.beamM / 2, z);
    parts.push(beam);
  }

  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

function MarkerGroup({
  status,
  points,
}: {
  status: Exclude<SubjectDiffStatus, "unchanged">;
  points: readonly (readonly [number, number])[];
}) {
  const style = MARKER_STYLES[status];
  const geometry = useMemo(() => markerGeometry(points, style), [points, style]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (geometry === null) return null;
  return (
    <mesh
      geometry={geometry}
      renderOrder={3}
      frustumCulled={false}
      name={`diff-${status}`}
    >
      <meshBasicMaterial
        color={style.color}
        transparent
        opacity={0.42}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function ForensicDiffLayer() {
  const snapshotDate = useTwinStore((state) => state.snapshotDate);
  const comparisonDate = useTwinStore((state) => state.comparisonDate);
  const qualityTier = useTwinStore((state) => state.qualityTier);
  const proveIt = useTwinStore((state) => state.proveIt);

  const groups = useMemo(() => {
    if (snapshotDate === null || comparisonDate === null) return [];
    const index = diffStatusIndex(forensicDiff(snapshotDate, comparisonDate));
    const byStatus = new Map<
      Exclude<SubjectDiffStatus, "unchanged">,
      (readonly [number, number])[]
    >();
    for (const [subjectId, status] of index) {
      if (status === "unchanged") continue;
      const position = SUBJECT_POSITIONS.get(subjectId);
      if (position === undefined) continue;
      const list = byStatus.get(status);
      if (list === undefined) byStatus.set(status, [position]);
      else list.push(position);
    }
    // Sorted so the marker groups mount in a stable order between rebuilds.
    return [...byStatus.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
  }, [snapshotDate, comparisonDate]);

  // PROVE IT is a claim about the whole model rather than about a window in
  // time; overlaying a temporal diff on top of it would answer two questions at
  // once and neither clearly.
  if (proveIt || qualityTier < 1 || groups.length === 0) return null;

  return (
    <group name="forensic-diff">
      {groups.map(([status, points]) => (
        <MarkerGroup key={status} status={status} points={points} />
      ))}
    </group>
  );
}
