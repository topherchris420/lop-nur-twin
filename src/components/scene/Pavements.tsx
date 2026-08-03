import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  APRONS,
  ROADS,
  RUNWAYS,
  STREETS,
  STRIPS,
  TAXIWAYS,
  segmentAngle,
  segmentCenter,
  segmentLength,
  isVisibleAtTimelineYear,
  type SegmentDef,
} from "@/lib/layout";
import {
  makeApronTexture,
  makeDirtTexture,
  makePavementTexture,
} from "@/lib/textures";
import { SITE_SEED } from "@/lib/noise";
import { applyGroundDetailPreset, type GroundDetailFamily } from "@/gfx/groundDetail";

import { useTwinStore, type QualityTier } from '@/lib/store';

/**
 * Stacking heights keep coplanar surfaces from z-fighting where they cross
 * (runway over runway, roads over pavement ends).
 */
const LIFT: Record<SegmentDef["kind"], number> = {
  runway: 0.1,
  strip: 0.05,
  taxiway: 0.07,
  street: 0.12,
  road: 0.14,
};

interface StripMeshProps {
  seg: SegmentDef;
  index: number;
  visible: boolean;
}

/**
 * Unit world-XZ direction a strip runs along. Slab joints and traffic polish
 * are both built in this frame — deriving it from the segment's own endpoints
 * rather than from `segmentAngle` keeps it immune to the euler convention the
 * mesh rotation uses, and guarantees joints can never come out diagonal.
 */
function segmentAxis(seg: SegmentDef): [number, number] {
  const dx = seg.to[0] - seg.from[0];
  const dz = seg.to[1] - seg.from[1];
  const len = Math.hypot(dx, dz) || 1;
  return [dx / len, dz / len];
}

/**
 * Ground materials own their own instance so each one can carry the basis of
 * the surface it belongs to. The basis arrives as four scalars rather than two
 * tuples so the memo depends on values, not on array identities rebuilt every
 * render. `useGroundMaterial` also keys the material to the quality tier,
 * which is what turns the close-range detail on and off.
 */
function useGroundMaterial(
  map: THREE.Texture,
  roughness: number,
  family: GroundDetailFamily,
  tier: QualityTier,
  axisX: number,
  axisZ: number,
  originX: number,
  originZ: number,
): THREE.MeshStandardMaterial {
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      map,
      roughness,
      metalness: family === "dirt" ? 0 : 0.02,
    });
    return applyGroundDetailPreset(mat, tier, family, {
      axis: [axisX, axisZ],
      origin: [originX, originZ],
    });
  }, [map, roughness, family, tier, axisX, axisZ, originX, originZ]);

  useEffect(() => () => material.dispose(), [material]);
  return material;
}

function isFilletVisible(id: string, year: number): boolean {
  const source = id === 'apron-fillet' ? TAXIWAYS[1] : TAXIWAYS[0];
  return source !== undefined && isVisibleAtTimelineYear(source, year);
}

function useSegmentTransform(seg: SegmentDef, index: number) {
  return useMemo(() => {
    const [cx, cz] = segmentCenter(seg);
    const y = LIFT[seg.kind] + index * 0.012;
    return {
      length: segmentLength(seg),
      position: [cx, y, cz] as [number, number, number],
      // With euler [-π/2, 0, θ] the plane's +v axis maps to -(sin θ, cos θ)
      // in (x, z), so +segmentAngle lays the strip along its from→to line
      // (the negated variant mirrors angled segments across the x-axis).
      rotation: [-Math.PI / 2, 0, segmentAngle(seg)] as [number, number, number],
    };
  }, [seg, index]);
}

interface PavedMeshProps extends StripMeshProps {
  markings: "runway" | "none";
  seedBase: number;
  roughness: number;
  designators?: [string, string];
}

function PavedMesh({
  seg,
  index,
  visible,
  markings,
  seedBase,
  roughness,
  designators,
}: PavedMeshProps) {
  const { length, position, rotation } = useSegmentTransform(seg, index);
  const tier = useTwinStore((s) => s.qualityTier);
  const texture = useMemo(
    () =>
      makePavementTexture({
        lengthM: length,
        widthM: seg.width,
        markings,
        ...(designators ? { designators } : {}),
        seed: seedBase + index,
      }),
    [length, seg.width, index, markings, seedBase, designators],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  const [ax, az] = segmentAxis(seg);
  const material = useGroundMaterial(
    texture,
    roughness,
    "pavement",
    tier,
    ax,
    az,
    seg.from[0],
    seg.from[1],
  );
  return (
    <mesh
      position={position}
      rotation={rotation}
      material={material}
      receiveShadow
      name={seg.id}
      visible={visible}
      userData={{ entityId: seg.id }}
    >
      <planeGeometry args={[seg.width, length]} />
    </mesh>
  );
}

function DirtMesh({ seg, index, visible }: StripMeshProps) {
  const { length, position, rotation } = useSegmentTransform(seg, index);
  const tier = useTwinStore((s) => s.qualityTier);
  const texture = useMemo(() => {
    const tex = makeDirtTexture(SITE_SEED + 300 + index, seg.kind === "road");
    tex.repeat.set(1, Math.max(1, Math.round(length / 160)));
    return tex;
  }, [length, seg.kind, index]);
  useEffect(() => () => texture.dispose(), [texture]);
  const [ax, az] = segmentAxis(seg);
  const material = useGroundMaterial(
    texture,
    0.98,
    "dirt",
    tier,
    ax,
    az,
    seg.from[0],
    seg.from[1],
  );
  return (
    <mesh
      position={position}
      rotation={rotation}
      material={material}
      receiveShadow
      name={seg.id}
      visible={visible}
      userData={{ entityId: seg.id }}
    >
      <planeGeometry args={[seg.width, length]} />
    </mesh>
  );
}

/**
 * One apron slab. Each owns its material so the slab grid and the traffic
 * polish can be built in *that* apron's frame — a shared material would have
 * to pick one rotation and run the joints diagonally across the others.
 */
function ApronMesh({
  apron,
  texture,
  visible,
}: {
  apron: (typeof APRONS)[number];
  texture: THREE.Texture;
  visible: boolean;
}) {
  const tier = useTwinStore((s) => s.qualityTier);
  // `terrain.ts` builds the apron's local frame from (cos, sin) of the same
  // rotation, so the joint basis matches the footprint that flattened the
  // ground underneath it.
  const material = useGroundMaterial(
    texture,
    0.9,
    "pavement",
    tier,
    Math.cos(apron.rotation),
    Math.sin(apron.rotation),
    apron.center[0],
    apron.center[1],
  );
  return (
    <mesh
      position={[apron.center[0], 0.09, apron.center[1]]}
      rotation={[-Math.PI / 2, 0, -apron.rotation]}
      material={material}
      receiveShadow
      name={apron.id}
      visible={visible}
      userData={{ entityId: apron.id }}
    >
      <planeGeometry args={apron.size} />
    </mesh>
  );
}

function FilletMesh({
  id,
  point,
  radius,
  axis,
  texture,
  visible,
  entityId,
}: {
  id: string;
  point: [number, number];
  radius: number;
  axis: [number, number];
  texture: THREE.Texture;
  visible: boolean;
  entityId: string;
}) {
  const tier = useTwinStore((s) => s.qualityTier);
  const material = useGroundMaterial(
    texture,
    0.9,
    "pavement",
    tier,
    axis[0],
    axis[1],
    point[0],
    point[1],
  );
  return (
    <mesh
      key={id}
      position={[point[0], 0.085, point[1]]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={material}
      receiveShadow
      visible={visible}
      userData={{ entityId }}
    >
      <circleGeometry args={[radius, 48]} />
    </mesh>
  );
}

export function Pavements() {
  const activeTimelineYear = useTwinStore((s) => s.activeTimelineYear);
  const apronTexture = useMemo(() => makeApronTexture(SITE_SEED + 400), []);
  useEffect(() => () => apronTexture.dispose(), [apronTexture]);

  // fillets inherit the joint frame of the strip they blend into, so the slab
  // grid runs continuously through the junction instead of turning at it
  const fillets = useMemo(() => {
    const t0 = TAXIWAYS[0];
    const t1 = TAXIWAYS[1];
    return [
      { id: "runway-fillet", point: t0?.from, radius: 31, seg: t0 },
      { id: "taxiway-elbow", point: t0?.to, radius: 27, seg: t0 },
      { id: "apron-fillet", point: t1?.to, radius: 30, seg: t1 },
    ];
  }, []);

  return (
    <group name="pavements">
      {RUNWAYS.map((seg, i) => (
        <PavedMesh
          key={seg.id}
          seg={seg}
          index={i}
          markings="runway"
          designators={["05", "23"]}
          seedBase={SITE_SEED + 100}
          roughness={0.85}
          visible={isVisibleAtTimelineYear(seg, activeTimelineYear)}
        />
      ))}
      {TAXIWAYS.map((seg, i) => (
        <PavedMesh
          key={seg.id}
          seg={seg}
          index={i}
          markings="none"
          seedBase={SITE_SEED + 200}
          roughness={0.88}
          visible={isVisibleAtTimelineYear(seg, activeTimelineYear)}
        />
      ))}
      {/* Circular concrete fillets soften the runway T-junction and apron throat,
          matching the broad rounded transitions visible in the overhead image. */}
      {fillets.map(({ id, point, radius, seg }) =>
        point && seg ? (
          <FilletMesh
            key={id}
            id={id}
            point={point}
            radius={radius}
            axis={segmentAxis(seg)}
            texture={apronTexture}
            visible={isFilletVisible(id, activeTimelineYear)}
            entityId={seg.id}
          />
        ) : null,
      )}
      {STREETS.map((seg, i) => (
        <PavedMesh
          key={seg.id}
          seg={seg}
          index={i}
          markings="none"
          seedBase={SITE_SEED + 250}
          roughness={0.9}
          visible={isVisibleAtTimelineYear(seg, activeTimelineYear)}
        />
      ))}
      {STRIPS.map((seg, i) => (
        <DirtMesh key={seg.id} seg={seg} index={i} visible={isVisibleAtTimelineYear(seg, activeTimelineYear)} />
      ))}
      {ROADS.map((seg, i) => (
        <DirtMesh key={seg.id} seg={seg} index={i + 10} visible={isVisibleAtTimelineYear(seg, activeTimelineYear)} />
      ))}
      {APRONS.map((apron) => (
        <ApronMesh
          key={apron.id}
          apron={apron}
          texture={apronTexture}
          visible={isVisibleAtTimelineYear(apron, activeTimelineYear)}
        />
      ))}
    </group>
  );
}
