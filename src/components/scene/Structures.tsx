import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { STRUCTURES, getStructure, type StructureDef } from "@/lib/layout";
import { useTwinStore } from "@/lib/store";
import {
  makeConcreteWallTexture,
  makeCorrugatedTexture,
} from "@/lib/textures";
import { SITE_SEED } from "@/lib/noise";

interface SharedMaterials {
  concrete: THREE.MeshStandardMaterial;
  concreteLight: THREE.MeshStandardMaterial;
  corrugated: THREE.MeshStandardMaterial;
  corrugatedTan: THREE.MeshStandardMaterial;
  metalDark: THREE.MeshStandardMaterial;
  roofDark: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  radomeWhite: THREE.MeshStandardMaterial;
  tankSteel: THREE.MeshStandardMaterial;
  beacon: THREE.MeshStandardMaterial;
}

function useSharedMaterials(): SharedMaterials {
  const night = useTwinStore((s) => s.night);
  const materials = useMemo<SharedMaterials>(() => {
    const concreteTex = makeConcreteWallTexture(SITE_SEED + 500);
    const concreteLightTex = makeConcreteWallTexture(SITE_SEED + 501, "#b3ac9c");
    const corrTex = makeCorrugatedTexture(SITE_SEED + 502, "#969ca1");
    const corrTanTex = makeCorrugatedTexture(SITE_SEED + 503, "#a89f8a");
    return {
      concrete: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.92 }),
      concreteLight: new THREE.MeshStandardMaterial({
        map: concreteLightTex,
        roughness: 0.9,
      }),
      corrugated: new THREE.MeshStandardMaterial({
        map: corrTex,
        roughness: 0.55,
        metalness: 0.45,
      }),
      corrugatedTan: new THREE.MeshStandardMaterial({
        map: corrTanTex,
        roughness: 0.65,
        metalness: 0.3,
      }),
      metalDark: new THREE.MeshStandardMaterial({
        color: "#4b4f53",
        roughness: 0.5,
        metalness: 0.5,
      }),
      roofDark: new THREE.MeshStandardMaterial({ color: "#3c3a36", roughness: 0.95 }),
      glass: new THREE.MeshStandardMaterial({
        color: "#31505f",
        roughness: 0.12,
        metalness: 0.85,
        emissive: new THREE.Color("#ffb45e"),
        emissiveIntensity: 0,
      }),
      radomeWhite: new THREE.MeshStandardMaterial({
        color: "#e9e7df",
        roughness: 0.35,
        flatShading: true,
      }),
      tankSteel: new THREE.MeshStandardMaterial({
        color: "#c9c4b6",
        roughness: 0.45,
        metalness: 0.55,
      }),
      beacon: new THREE.MeshStandardMaterial({
        color: "#ff4136",
        emissive: new THREE.Color("#ff4136"),
        emissiveIntensity: 0.6,
      }),
    };
  }, []);

  useEffect(() => {
    materials.glass.emissiveIntensity = night ? 1.4 : 0;
    materials.beacon.emissiveIntensity = night ? 3 : 0.6;
  }, [night, materials]);

  return materials;
}

/* ------------------------------------------------------------------ */
/* Individual structure builders                                       */
/* ------------------------------------------------------------------ */

interface BuilderProps {
  def: StructureDef;
  m: SharedMaterials;
}

function ControlTower({ def, m }: BuilderProps) {
  const h = def.size[1];
  const shaftH = h - 5;
  return (
    <group>
      <mesh material={m.concrete} castShadow receiveShadow position={[0, 0.5, 0]}>
        <boxGeometry args={[10, 1, 10]} />
      </mesh>
      <mesh material={m.concrete} castShadow position={[0, 1 + shaftH / 2, 0]}>
        <boxGeometry args={[6.5, shaftH, 6.5]} />
      </mesh>
      <mesh material={m.concreteLight} castShadow position={[0, shaftH + 1.25, 0]}>
        <boxGeometry args={[9.5, 0.5, 9.5]} />
      </mesh>
      <mesh material={m.glass} castShadow position={[0, shaftH + 3.1, 0]}>
        <cylinderGeometry args={[4, 4.4, 3.2, 8]} />
      </mesh>
      <mesh material={m.concreteLight} castShadow position={[0, shaftH + 5, 0]}>
        <cylinderGeometry args={[4.7, 4.2, 0.6, 8]} />
      </mesh>
      <mesh material={m.metalDark} position={[0, shaftH + 7.4, 0]}>
        <cylinderGeometry args={[0.08, 0.12, 4.5, 6]} />
      </mesh>
      <mesh material={m.beacon} position={[0, shaftH + 9.8, 0]}>
        <sphereGeometry args={[0.35, 12, 12]} />
      </mesh>
    </group>
  );
}

function BarrelHangar({ def, m }: BuilderProps) {
  const [w, h, d] = def.size;
  const wallH = h * 0.45;
  const r = d / 2;
  const vaultScale = (h - wallH) / r;
  return (
    <group>
      <mesh material={m.corrugated} castShadow receiveShadow position={[0, wallH / 2, 0]}>
        <boxGeometry args={[w, wallH, d]} />
      </mesh>
      <mesh
        material={m.corrugated}
        castShadow
        position={[0, wallH, 0]}
        rotation={[0, 0, Math.PI / 2]}
        scale={[1, 1, vaultScale]}
      >
        {/* half-cylinder vault: axis re-oriented along x, shell facing up */}
        <cylinderGeometry args={[r, r, w, 24, 1, true, 0, Math.PI]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          material={m.corrugatedTan}
          castShadow
          position={[side * (w / 2), wallH, 0]}
          rotation={[0, (side * Math.PI) / 2, 0]}
          scale={[1, vaultScale, 1]}
        >
          <circleGeometry args={[r, 24, 0, Math.PI]} />
        </mesh>
      ))}
      <mesh material={m.metalDark} castShadow position={[0, (wallH * 0.82) / 2, d / 2 + 0.25]}>
        <boxGeometry args={[w * 0.68, wallH * 0.82, 0.4]} />
      </mesh>
    </group>
  );
}

function GableHangar({ def, m }: BuilderProps) {
  const [w, h, d] = def.size;
  const wallH = h * 0.62;
  const roofGeometry = useMemo(() => {
    const rise = h - wallH;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(0, rise);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    geo.translate(0, 0, -d / 2);
    return geo;
  }, [w, h, d, wallH]);
  return (
    <group>
      <mesh material={m.corrugatedTan} castShadow receiveShadow position={[0, wallH / 2, 0]}>
        <boxGeometry args={[w, wallH, d]} />
      </mesh>
      <mesh material={m.corrugated} geometry={roofGeometry} castShadow position={[0, wallH, 0]} />
      <mesh material={m.metalDark} castShadow position={[0, (wallH * 0.85) / 2, d / 2 + 0.25]}>
        <boxGeometry args={[w * 0.6, wallH * 0.85, 0.4]} />
      </mesh>
    </group>
  );
}

function Warehouse({ def, m }: BuilderProps) {
  const [w, h, d] = def.size;
  return (
    <group>
      <mesh material={m.concrete} castShadow receiveShadow position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      <mesh material={m.roofDark} position={[0, h + 0.12, 0]}>
        <boxGeometry args={[w - 1, 0.25, d - 1]} />
      </mesh>
      {/* parapet */}
      {[-1, 1].map((side) => (
        <mesh key={`p${side}`} material={m.concrete} position={[0, h + 0.4, (side * (d - 0.4)) / 2]}>
          <boxGeometry args={[w, 0.8, 0.4]} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`q${side}`} material={m.concrete} position={[(side * (w - 0.4)) / 2, h + 0.4, 0]}>
          <boxGeometry args={[0.4, 0.8, d]} />
        </mesh>
      ))}
      {/* loading dock */}
      <mesh material={m.concreteLight} castShadow receiveShadow position={[0, 0.6, d / 2 + 2]}>
        <boxGeometry args={[w * 0.45, 1.2, 4]} />
      </mesh>
      <mesh material={m.metalDark} position={[0, h * 0.4, d / 2 + 0.15]}>
        <boxGeometry args={[w * 0.3, h * 0.7, 0.3]} />
      </mesh>
    </group>
  );
}

function SupportBuilding({ def, m }: BuilderProps) {
  const [w, h, d] = def.size;
  return (
    <group>
      <mesh material={m.concreteLight} castShadow receiveShadow position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      <mesh material={m.roofDark} castShadow position={[0, h + 0.12, 0]}>
        <boxGeometry args={[w + 0.8, 0.25, d + 0.8]} />
      </mesh>
      <mesh material={m.metalDark} position={[w * 0.2, h * 0.4, d / 2 + 0.08]}>
        <boxGeometry args={[1.2, h * 0.75, 0.15]} />
      </mesh>
      <mesh material={m.metalDark} castShadow position={[-w * 0.25, h + 0.7, 0]}>
        <boxGeometry args={[1.6, 0.9, 1.6]} />
      </mesh>
    </group>
  );
}

function Radome({ def, m }: BuilderProps) {
  const r = def.size[0] / 2;
  return (
    <group>
      <mesh material={m.concrete} castShadow receiveShadow position={[0, 4, 0]}>
        <cylinderGeometry args={[2.6, 3.1, 8, 12]} />
      </mesh>
      <mesh material={m.concreteLight} castShadow position={[0, 8.25, 0]}>
        <boxGeometry args={[7, 0.5, 7]} />
      </mesh>
      <mesh material={m.radomeWhite} castShadow position={[0, 8.5 + r * 0.82, 0]}>
        <icosahedronGeometry args={[r, 2]} />
      </mesh>
      <mesh material={m.metalDark} position={[0, 1.25, 3.4]}>
        <boxGeometry args={[1.4, 2.5, 1]} />
      </mesh>
    </group>
  );
}

function FuelTank({ def, m }: BuilderProps) {
  const r = def.size[0] / 2;
  const h = def.size[1];
  return (
    <group>
      {/* earth bund */}
      <mesh material={m.concrete} receiveShadow position={[0, 0.6, 0]}>
        <cylinderGeometry args={[r + 5.5, r + 6.5, 1.2, 24, 1, true]} />
      </mesh>
      <mesh material={m.tankSteel} castShadow receiveShadow position={[0, h / 2, 0]}>
        <cylinderGeometry args={[r, r, h, 24]} />
      </mesh>
      <mesh material={m.tankSteel} castShadow position={[0, h, 0]} scale={[1, 0.25, 1]}>
        <sphereGeometry args={[r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {[0.25, 0.55, 0.85].map((f) => (
        <mesh key={f} material={m.metalDark} position={[0, h * f, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[r + 0.06, 0.08, 6, 32]} />
        </mesh>
      ))}
      <mesh material={m.metalDark} castShadow position={[r + 0.3, h / 2, 0]}>
        <boxGeometry args={[0.5, h, 0.2]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Dispatcher & selection                                              */
/* ------------------------------------------------------------------ */

function StructureBody(props: BuilderProps) {
  switch (props.def.type) {
    case "tower":
      return <ControlTower {...props} />;
    case "hangar-barrel":
      return <BarrelHangar {...props} />;
    case "hangar-gable":
      return <GableHangar {...props} />;
    case "warehouse":
      return <Warehouse {...props} />;
    case "support":
      return <SupportBuilding {...props} />;
    case "radome":
      return <Radome {...props} />;
    case "fuel-tank":
      return <FuelTank {...props} />;
  }
}

function StructureNode({ def, m }: BuilderProps) {
  const select = useTwinStore((s) => s.select);
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select(def.id);
  };
  return (
    <group
      position={[def.position[0], 0, def.position[1]]}
      rotation={[0, def.rotation, 0]}
      userData={{ structureId: def.id }}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
      }}
    >
      <StructureBody def={def} m={m} />
    </group>
  );
}

function SelectionRing() {
  const selectedId = useTwinStore((s) => s.selectedId);
  const ringRef = useRef<THREE.Mesh>(null);
  const def = selectedId ? getStructure(selectedId) : undefined;

  useFrame((_, delta) => {
    if (ringRef.current) ringRef.current.rotation.z += delta * 0.6;
  });

  if (!def) return null;
  const radius = Math.max(def.size[0], def.size[2]) * 0.85 + 5;
  return (
    <mesh
      ref={ringRef}
      position={[def.position[0], 0.4, def.position[1]]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <ringGeometry args={[radius, radius + 1.6, 48, 1]} />
      <meshBasicMaterial color="#ffb64d" transparent opacity={0.85} side={THREE.DoubleSide} />
    </mesh>
  );
}

export function Structures() {
  const m = useSharedMaterials();
  return (
    <group name="structures">
      {STRUCTURES.map((def) => (
        <StructureNode key={def.id} def={def} m={m} />
      ))}
      <SelectionRing />
    </group>
  );
}
