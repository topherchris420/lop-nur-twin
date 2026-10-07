import { useEffect, useMemo } from "react";
import * as THREE from "three";
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
import { EVIDENCE_CLASSIFICATIONS, type EvidenceClassification } from "@/lib/evidence";
import { LENS_PALETTE } from "@/lib/evidenceLens";
import { useSubjectLensClassification } from "@/lib/sceneVisibility";
import { useTwinStore } from "@/lib/store";

/**
 * The evidence lens in the scene: every solid subject under a translucent
 * shell tinted by its evidence classification, edged in that class's line
 * pattern — solid for observed, more broken down the ranks.
 *
 * The shell is deliberately a shell and not a repaint. The buildings keep
 * their materials underneath, so the lens reads as an annotation laid over the
 * reconstruction rather than as a different reconstruction, and switching it
 * off leaves nothing changed. It is the ghost's vocabulary (`EvidenceGhosts`)
 * extended one step: an outline says a thing was not established on the
 * chosen date; a tinted shell says how well an established thing is supported.
 * The two never apply to the same subject at once, because the classification
 * comes from `subjectLensClassification`, which answers only for what is drawn
 * solid.
 *
 * Nothing here is raycast: a shell must not take the click meant for the
 * building inside it. And nothing here is tier-gated: the lens is a few dozen
 * boxes and planes, and it is the one layer a constrained device should never
 * have to do without, because it is the layer that says what the picture is.
 */

/** One pattern unit of a class's dash, in metres along an edge. */
const DASH_UNIT_M = 3;
/** The shell stands this far off the modeled faces, so it never z-fights them. */
const SHELL_MARGIN_M = 0.8;
/** Pavement shells float above the pavement decals, as the ghosts do. */
const PAVEMENT_LIFT_M = 0.5;
/** Drawn after the opaque scene and the ghosts, before the selection ring. */
const RENDER_ORDER = 3;

interface LensMaterials {
  fill: THREE.MeshBasicMaterial;
  edge: THREE.LineBasicMaterial | THREE.LineDashedMaterial;
}

function useLensMaterials(): Record<EvidenceClassification, LensMaterials> {
  const materials = useMemo(() => {
    const entries = EVIDENCE_CLASSIFICATIONS.map((classification) => {
      const { color, dash } = LENS_PALETTE[classification];
      const fill = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const edge =
        dash.length === 0
          ? new THREE.LineBasicMaterial({
              color,
              transparent: true,
              opacity: 0.95,
              depthWrite: false,
            })
          : new THREE.LineDashedMaterial({
              color,
              transparent: true,
              opacity: 0.95,
              depthWrite: false,
              dashSize: (dash[0] ?? 1) * DASH_UNIT_M,
              gapSize: (dash[1] ?? 1) * DASH_UNIT_M,
            });
      return [classification, { fill, edge }] as const;
    });
    return Object.fromEntries(entries) as Record<EvidenceClassification, LensMaterials>;
  }, []);
  useEffect(
    () => () => {
      for (const { fill, edge } of Object.values(materials)) {
        fill.dispose();
        edge.dispose();
      }
    },
    [materials],
  );
  return materials;
}

/** Shells take no clicks: the building inside is what a click is for. */
const NO_RAYCAST = () => null;

/**
 * Edge lines with their distances computed, which a dashed material needs
 * and which the declarative form has no hook for.
 */
function useEdgeLines(
  geometry: THREE.BufferGeometry,
  material: LensMaterials["edge"],
  segments: boolean,
): THREE.Line {
  return useMemo(() => {
    const line = segments
      ? new THREE.LineSegments(geometry, material)
      : new THREE.Line(geometry, material);
    line.computeLineDistances();
    line.renderOrder = RENDER_ORDER;
    line.raycast = NO_RAYCAST;
    return line;
  }, [geometry, material, segments]);
}

function StructureShell({
  def,
  materials,
}: {
  def: StructureDef;
  materials: LensMaterials;
}) {
  const [width, height, depth] = def.size;
  const geometry = useMemo(
    () =>
      new THREE.BoxGeometry(
        width + SHELL_MARGIN_M * 2,
        height + SHELL_MARGIN_M,
        depth + SHELL_MARGIN_M * 2,
      ),
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
  const lines = useEdgeLines(edges, materials.edge, true);

  return (
    <group
      position={[def.position[0], (height + SHELL_MARGIN_M) / 2, def.position[1]]}
      rotation={[0, def.rotation, 0]}
      userData={{ entityId: def.id, evidenceLens: true }}
    >
      <mesh
        geometry={geometry}
        material={materials.fill}
        renderOrder={RENDER_ORDER}
        raycast={NO_RAYCAST}
      />
      <primitive object={lines} />
    </group>
  );
}

/** A flat rectangle outline, centred, `length` along local z and `width` across. */
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

function PavementShell({
  item,
  materials,
}: {
  item: SegmentDef | ApronDef;
  materials: LensMaterials;
}) {
  const { fill, outline, position, rotationY } = useMemo(() => {
    if ("kind" in item) {
      const [cx, cz] = segmentCenter(item);
      const length = segmentLength(item);
      return {
        fill: new THREE.PlaneGeometry(item.width, length),
        outline: rectangleOutline(length, item.width),
        position: [cx, PAVEMENT_LIFT_M, cz] as [number, number, number],
        rotationY: segmentAngle(item),
      };
    }
    // The same frame `EvidenceGhosts` uses for an apron: a yaw of -rotation
    // puts the outline's local x on the apron's width axis.
    return {
      fill: new THREE.PlaneGeometry(item.size[0], item.size[1]),
      outline: rectangleOutline(item.size[1], item.size[0]),
      position: [item.center[0], PAVEMENT_LIFT_M, item.center[1]] as [
        number,
        number,
        number,
      ],
      rotationY: -item.rotation,
    };
  }, [item]);
  useEffect(
    () => () => {
      fill.dispose();
      outline.dispose();
    },
    [fill, outline],
  );
  const lines = useEdgeLines(outline, materials.edge, false);

  return (
    <group
      position={position}
      rotation={[0, rotationY, 0]}
      userData={{ entityId: item.id, evidenceLens: true }}
    >
      <mesh
        geometry={fill}
        material={materials.fill}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={RENDER_ORDER}
        raycast={NO_RAYCAST}
      />
      <primitive object={lines} />
    </group>
  );
}

export function EvidenceLens() {
  const showLens = useTwinStore((state) => state.showLens);
  const classificationOf = useSubjectLensClassification();
  const materials = useLensMaterials();

  const painted = useMemo(() => {
    const structures: { def: StructureDef; classification: EvidenceClassification }[] =
      [];
    for (const def of STRUCTURES) {
      const classification = classificationOf(def.id);
      if (classification !== undefined) structures.push({ def, classification });
    }
    const pavements: {
      item: SegmentDef | ApronDef;
      classification: EvidenceClassification;
    }[] = [];
    for (const item of [...ALL_SEGMENTS, ...APRONS]) {
      const classification = classificationOf(item.id);
      if (classification !== undefined) pavements.push({ item, classification });
    }
    return { structures, pavements };
  }, [classificationOf]);

  if (!showLens) return null;

  return (
    <group name="evidence-lens">
      {painted.pavements.map(({ item, classification }) => (
        <PavementShell key={item.id} item={item} materials={materials[classification]} />
      ))}
      {painted.structures.map(({ def, classification }) => (
        <StructureShell key={def.id} def={def} materials={materials[classification]} />
      ))}
    </group>
  );
}
