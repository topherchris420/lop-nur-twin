import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import {
  ALL_SEGMENTS,
  APRONS,
  STRUCTURES,
  segmentAngle,
  segmentCenter,
  segmentLength,
  type ApronDef,
  type SegmentDef,
  type StructureDef,
} from "@/lib/layout";
import { useSubjectDrawState } from "@/lib/sceneVisibility";
import { useTwinStore } from "@/lib/store";

/**
 * Outlines of what today's model holds but was not publicly established on the
 * evidence-timeline date.
 *
 * Removing those subjects would say they were not there. Drawing them solid
 * would say someone could have known they were. An outline says neither: the
 * model contains this today, and the public evidence of that date does not
 * establish it — absence of evidence, not evidence of absence. So the ghost is
 * deliberately quiet: one cool line colour, a faint volume, no shading, no
 * shadow, and nothing at all in the present, when there is nothing to ghost.
 *
 * A ghost is still selectable, so its dossier can say why it is a ghost.
 */

const GHOST_COLOR = "#a9bfd3";
const PAVEMENT_LIFT_M = 0.45;

function useGhostMaterials() {
  const materials = useMemo(
    () => ({
      edge: new THREE.LineBasicMaterial({
        color: GHOST_COLOR,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
      fill: new THREE.MeshBasicMaterial({
        color: GHOST_COLOR,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      materials.edge.dispose();
      materials.fill.dispose();
    },
    [materials],
  );
  return materials;
}

function StructureGhost({
  def,
  edge,
  fill,
}: {
  def: StructureDef;
  edge: THREE.LineBasicMaterial;
  fill: THREE.MeshBasicMaterial;
}) {
  const select = useTwinStore((state) => state.select);
  const [width, height, depth] = def.size;
  const geometry = useMemo(
    () => new THREE.BoxGeometry(width, height, depth),
    [width, height, depth],
  );
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);
  useEffect(
    () => () => {
      geometry.dispose();
      edges.dispose();
    },
    [geometry, edges],
  );

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    select(def.id);
  };

  return (
    <group
      position={[def.position[0], height / 2, def.position[1]]}
      rotation={[0, def.rotation, 0]}
      userData={{ entityId: def.id, evidenceGhost: true }}
    >
      <mesh
        geometry={geometry}
        material={fill}
        onClick={handleClick}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
      />
      <lineSegments geometry={edges} material={edge} />
    </group>
  );
}

/** A flat rectangle, centred, `length` along local +z and `width` across. */
function rectangleOutline(length: number, width: number): THREE.BufferGeometry {
  const halfL = length / 2;
  const halfW = width / 2;
  return new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-halfW, 0, -halfL),
    new THREE.Vector3(halfW, 0, -halfL),
    new THREE.Vector3(halfW, 0, halfL),
    new THREE.Vector3(-halfW, 0, halfL),
    new THREE.Vector3(-halfW, 0, -halfL),
  ]);
}

function PavementGhost({
  item,
  material,
}: {
  item: SegmentDef | ApronDef;
  material: THREE.LineBasicMaterial;
}) {
  const { geometry, position, rotationY } = useMemo(() => {
    if ("kind" in item) {
      const [cx, cz] = segmentCenter(item);
      return {
        geometry: rectangleOutline(segmentLength(item), item.width),
        position: [cx, PAVEMENT_LIFT_M, cz] as [number, number, number],
        rotationY: segmentAngle(item),
      };
    }
    // `Pavements.tsx` lays an apron's plane with euler [-π/2, 0, -rotation],
    // which puts its width along (cos r, sin r) in (x, z); a yaw of -rotation
    // puts this outline's local x on the same axis.
    return {
      geometry: rectangleOutline(item.size[1], item.size[0]),
      position: [item.center[0], PAVEMENT_LIFT_M, item.center[1]] as [
        number,
        number,
        number,
      ],
      rotationY: -item.rotation,
    };
  }, [item]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const line = useMemo(() => new THREE.Line(geometry, material), [geometry, material]);

  return (
    <primitive
      object={line}
      position={position}
      rotation={[0, rotationY, 0]}
      userData={{ entityId: item.id, evidenceGhost: true }}
    />
  );
}

export function EvidenceGhosts() {
  const snapshotDate = useTwinStore((state) => state.snapshotDate);
  const drawState = useSubjectDrawState();
  const { edge, fill } = useGhostMaterials();

  const ghosts = useMemo(
    () => ({
      structures: STRUCTURES.filter((def) => drawState(def.id) === "ghost"),
      pavements: [...ALL_SEGMENTS, ...APRONS].filter(
        (item) => drawState(item.id) === "ghost",
      ),
    }),
    [drawState],
  );

  // In the present everything the mode admits is drawn solid.
  if (snapshotDate === null) return null;

  return (
    <group name="evidence-ghosts">
      {ghosts.pavements.map((item) => (
        <PavementGhost key={item.id} item={item} material={edge} />
      ))}
      {ghosts.structures.map((def) => (
        <StructureGhost key={def.id} def={def} edge={edge} fill={fill} />
      ))}
    </group>
  );
}
