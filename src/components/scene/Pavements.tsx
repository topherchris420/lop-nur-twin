import { useMemo } from "react";
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

import { useTwinStore } from '@/lib/store';

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

function RunwayMesh({ seg, index, visible }: StripMeshProps) {
  const { length, position, rotation } = useSegmentTransform(seg, index);
  const texture = useMemo(
    () =>
      makePavementTexture({
        lengthM: length,
        widthM: seg.width,
        markings: "runway",
        designators: ["05", "23"],
        seed: SITE_SEED + 100 + index,
      }),
    [length, seg.width, index],
  );
  return (
    <mesh
      position={position}
      rotation={rotation}
      receiveShadow
      name={seg.id}
      visible={visible}
      userData={{ entityId: seg.id }}
    >
      <planeGeometry args={[seg.width, length]} />
      <meshStandardMaterial map={texture} roughness={0.85} metalness={0.02} />
    </mesh>
  );
}

function TaxiwayMesh({ seg, index, visible }: StripMeshProps) {
  const { length, position, rotation } = useSegmentTransform(seg, index);
  const texture = useMemo(
    () =>
      makePavementTexture({
        lengthM: length,
        widthM: seg.width,
        markings: "none",
        seed: SITE_SEED + 200 + index,
      }),
    [length, seg.width, index],
  );
  return (
    <mesh
      position={position}
      rotation={rotation}
      receiveShadow
      name={seg.id}
      visible={visible}
      userData={{ entityId: seg.id }}
    >
      <planeGeometry args={[seg.width, length]} />
      <meshStandardMaterial map={texture} roughness={0.88} metalness={0.02} />
    </mesh>
  );
}

function StreetMesh({ seg, index, visible }: StripMeshProps) {
  const { length, position, rotation } = useSegmentTransform(seg, index);
  const texture = useMemo(
    () =>
      makePavementTexture({
        lengthM: length,
        widthM: seg.width,
        markings: "none",
        seed: SITE_SEED + 250 + index,
      }),
    [length, seg.width, index],
  );
  return (
    <mesh
      position={position}
      rotation={rotation}
      receiveShadow
      name={seg.id}
      visible={visible}
      userData={{ entityId: seg.id }}
    >
      <planeGeometry args={[seg.width, length]} />
      <meshStandardMaterial map={texture} roughness={0.9} metalness={0.02} />
    </mesh>
  );
}

function DirtMesh({ seg, index, visible }: StripMeshProps) {
  const { length, position, rotation } = useSegmentTransform(seg, index);
  const texture = useMemo(() => {
    const tex = makeDirtTexture(SITE_SEED + 300 + index, seg.kind === "road");
    tex.repeat.set(1, Math.max(1, Math.round(length / 160)));
    return tex;
  }, [length, seg.kind, index]);
  return (
    <mesh
      position={position}
      rotation={rotation}
      receiveShadow
      name={seg.id}
      visible={visible}
      userData={{ entityId: seg.id }}
    >
      <planeGeometry args={[seg.width, length]} />
      <meshStandardMaterial map={texture} roughness={0.98} metalness={0} />
    </mesh>
  );
}

export function Pavements() {
  const activeTimelineYear = useTwinStore((s) => s.activeTimelineYear);
  const apronTexture = useMemo(() => makeApronTexture(SITE_SEED + 400), []);

  return (
    <group name="pavements">
      {RUNWAYS.map((seg, i) => (
        <RunwayMesh key={seg.id} seg={seg} index={i} visible={isVisibleAtTimelineYear(seg, activeTimelineYear)} />
      ))}
      {TAXIWAYS.map((seg, i) => (
        <TaxiwayMesh key={seg.id} seg={seg} index={i} visible={isVisibleAtTimelineYear(seg, activeTimelineYear)} />
      ))}
      {/* Circular concrete fillets soften the runway T-junction and apron throat,
          matching the broad rounded transitions visible in the overhead image. */}
      {[
        { id: "runway-fillet", point: TAXIWAYS[0]?.from, radius: 31 },
        { id: "taxiway-elbow", point: TAXIWAYS[0]?.to, radius: 27 },
        { id: "apron-fillet", point: TAXIWAYS[1]?.to, radius: 30 },
      ].map(({ id, point, radius }) =>
        point ? (
          <mesh
            key={id}
            position={[point[0], 0.085, point[1]]}
            rotation={[-Math.PI / 2, 0, 0]}
            receiveShadow
            visible={isFilletVisible(id, activeTimelineYear)}
            userData={{ entityId: id === "apron-fillet" ? TAXIWAYS[1]!.id : TAXIWAYS[0]!.id }}
          >
            <circleGeometry args={[radius, 48]} />
            <meshStandardMaterial map={apronTexture} roughness={0.9} metalness={0.02} />
          </mesh>
        ) : null,
      )}
      {STREETS.map((seg, i) => (
        <StreetMesh key={seg.id} seg={seg} index={i} visible={isVisibleAtTimelineYear(seg, activeTimelineYear)} />
      ))}
      {STRIPS.map((seg, i) => (
        <DirtMesh key={seg.id} seg={seg} index={i} visible={isVisibleAtTimelineYear(seg, activeTimelineYear)} />
      ))}
      {ROADS.map((seg, i) => (
        <DirtMesh key={seg.id} seg={seg} index={i + 10} visible={isVisibleAtTimelineYear(seg, activeTimelineYear)} />
      ))}
      {APRONS.map((apron) => (
        <mesh
          key={apron.id}
          position={[apron.center[0], 0.09, apron.center[1]]}
          rotation={[-Math.PI / 2, 0, -apron.rotation]}
          receiveShadow
          name={apron.id}
          visible={isVisibleAtTimelineYear(apron, activeTimelineYear)}
          userData={{ entityId: apron.id }}
        >
          <planeGeometry args={apron.size} />
          <meshStandardMaterial map={apronTexture} roughness={0.9} metalness={0.02} />
        </mesh>
      ))}
    </group>
  );
}
