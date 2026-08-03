import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { STRUCTURES, getStructure, type StructureDef } from "@/lib/layout";
import { useTwinStore } from "@/lib/store";
import {
  makeConcreteWallTexture,
  makeCorrugatedTexture,
  makeFacadeTextures,
  makeSolarTexture,
  makeWhitePanelTexture,
  makeRustStainTexture,
  makeStuccoTexture,
  makeDirtyConcreteTexture,
  makeChainLinkTexture,
} from "@/lib/textures";
import { SITE_SEED } from "@/lib/noise";
import { applyPreset, makeGreebleGeometry } from "@/gfx/greeble";

import { isVisibleAtTimelineYear } from '@/lib/layout';

interface SharedMaterials {
  concrete: THREE.MeshStandardMaterial;
  concreteLight: THREE.MeshStandardMaterial;
  corrugated: THREE.MeshStandardMaterial;
  corrugatedTan: THREE.MeshStandardMaterial;
  corrugatedWhite: THREE.MeshStandardMaterial;
  whitePanel: THREE.MeshStandardMaterial;
  monolithRoof: THREE.MeshStandardMaterial;
  monolithWallLong: THREE.MeshStandardMaterial;
  monolithWallEnd: THREE.MeshStandardMaterial;
  hqWall: THREE.MeshStandardMaterial;
  barracksWall: THREE.MeshStandardMaterial;
  interiorDark: THREE.MeshStandardMaterial;
  metalDark: THREE.MeshStandardMaterial;
  roofDark: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  radomeWhite: THREE.MeshStandardMaterial;
  tankSteel: THREE.MeshStandardMaterial;
  beacon: THREE.MeshStandardMaterial;
  solar: THREE.MeshStandardMaterial;
  gravel: THREE.MeshStandardMaterial;
  hazard: THREE.MeshStandardMaterial;
  airframeDark: THREE.MeshStandardMaterial;
  airframeLight: THREE.MeshStandardMaterial;
  canopy: THREE.MeshStandardMaterial;
  tire: THREE.MeshStandardMaterial;
  stucco: THREE.MeshStandardMaterial;
  rustyMetal: THREE.MeshStandardMaterial;
  chainLink: THREE.MeshStandardMaterial;
  pvcPipe: THREE.MeshStandardMaterial;
  dirtyConcreteWall: THREE.MeshStandardMaterial;
}

function facadeMaterial(
  seed: number,
  base: string,
  bands: Parameters<typeof makeFacadeTextures>[0]["bands"],
): THREE.MeshStandardMaterial {
  const { map, emissive } = makeFacadeTextures({ seed, base, bands });
  return new THREE.MeshStandardMaterial({
    map,
    emissiveMap: emissive,
    emissive: new THREE.Color("#ffffff"),
    emissiveIntensity: 0,
    roughness: 0.85,
  });
}

/**
 * Injects the procedural hard-surface pipeline (panel lines, plate seams,
 * per-plate PBR variation, weathering, grazing rim light) into the shared
 * materials — see `@/gfx/greeble` and
 * `.claude/skills/blender-hardsurface/SKILL.md`.
 *
 * Deliberately skipped: gravel, tyres, glass, canopies, beacons, the solar
 * texture and the chain-link alpha cutout. Panel lines on those read as a
 * mistake rather than as engineering.
 */
function decorateHardSurfaces(m: SharedMaterials): SharedMaterials {
  // poured concrete: wide expansion joints, no rivets
  applyPreset(m.concrete, "concrete", { seed: 11 });
  applyPreset(m.concreteLight, "concrete", { seed: 23, dust: 0.4 });
  applyPreset(m.dirtyConcreteWall, "concrete", { seed: 37, streaks: 0.55 });
  applyPreset(m.stucco, "concrete", { seed: 41, plateScale: 9, seamRelief: 0.22 });

  // sheet cladding: tight plates, rivets, oxidisation running down the seams
  applyPreset(m.corrugated, "cladding", { seed: 53 });
  applyPreset(m.corrugatedTan, "cladding", { seed: 59, rust: 0.28 });
  applyPreset(m.corrugatedWhite, "cladding", { seed: 67, rust: 0.18, dust: 0.34 });
  applyPreset(m.rustyMetal, "cladding", { seed: 71, rust: 0.7, streaks: 0.65 });

  // building envelopes: larger architectural panels on a straight grid, no
  // rust. A running bond at this scale reads as roof tiles, not cladding.
  const facade = {
    rust: 0,
    plateScale: 3.2,
    plateAspect: 0.72,
    stagger: 0,
    seamDarken: 0.74,
    rivets: false,
  } as const;
  applyPreset(m.whitePanel, "cladding", { seed: 79, ...facade });
  applyPreset(m.monolithRoof, "cladding", {
    seed: 83,
    ...facade,
    plateScale: 6,
    plateAspect: 0.9,
    seamDarken: 0.82,
    plateAlbedo: 0.05,
    dust: 0.42,
  });
  applyPreset(m.monolithWallLong, "cladding", { seed: 89, ...facade });
  applyPreset(m.monolithWallEnd, "cladding", { seed: 97, ...facade });
  applyPreset(m.hqWall, "cladding", { seed: 101, ...facade, streaks: 0.42 });
  applyPreset(m.barracksWall, "cladding", { seed: 103, ...facade, streaks: 0.45 });
  applyPreset(m.roofDark, "concrete", {
    seed: 107,
    plateScale: 4,
    plateAspect: 0.9,
    seamRelief: 0.25,
    seamDarken: 0.82,
    dust: 0.5,
    rimIntensity: 0.06,
  });

  // machined metal: fine plates, strong rim, almost no grime
  applyPreset(m.metalDark, "machined", { seed: 109 });
  applyPreset(m.pvcPipe, "machined", { seed: 113, plateScale: 1.6, rivets: false });

  // welded plate: tanks and radomes
  applyPreset(m.tankSteel, "plated", { seed: 127 });
  applyPreset(m.radomeWhite, "plated", {
    seed: 131,
    plateScale: 2.2,
    rust: 0,
    streaks: 0.12,
    dust: 0.18,
  });

  // airframe skin: small plates, crisp seams, cool rim
  applyPreset(m.airframeDark, "airframe", { seed: 137 });
  applyPreset(m.airframeLight, "airframe", { seed: 139 });

  return m;
}

/**
 * Procedural roof clutter. One merged geometry, one draw call; the seed is
 * derived from the structure id so a given roof is always identical.
 */
function GreebleDeck({
  seed,
  width,
  depth,
  position,
  material,
  count = 20,
  maxHeight = 1.5,
  rows = 3,
}: {
  seed: number;
  width: number;
  depth: number;
  position: [number, number, number];
  material: THREE.Material;
  count?: number;
  maxHeight?: number;
  rows?: number;
}) {
  const geometry = useMemo(
    () => makeGreebleGeometry({ seed, width, depth, count, maxHeight, rows }),
    [seed, width, depth, count, maxHeight, rows],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={position}
      castShadow
      receiveShadow
    />
  );
}

function useSharedMaterials(): SharedMaterials {
  const night = useTwinStore((s) => s.night);
  const materials = useMemo<SharedMaterials>(() => {
    const concreteTex = makeConcreteWallTexture(SITE_SEED + 500);
    const concreteLightTex = makeConcreteWallTexture(SITE_SEED + 501, "#b3ac9c");
    const corrTex = makeCorrugatedTexture(SITE_SEED + 502, "#969ca1");
    const corrTanTex = makeCorrugatedTexture(SITE_SEED + 503, "#a89f8a");
    const corrWhiteTex = makeCorrugatedTexture(SITE_SEED + 504, "#d9d6cc");
    const whitePanelTex = makeWhitePanelTexture(SITE_SEED + 505);
    const monolithRoofTex = makeWhitePanelTexture(SITE_SEED + 506);
    monolithRoofTex.repeat.set(0.06, 0.06);
    return decorateHardSurfaces({
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
      corrugatedWhite: new THREE.MeshStandardMaterial({
        map: corrWhiteTex,
        roughness: 0.6,
        metalness: 0.25,
      }),
      whitePanel: new THREE.MeshStandardMaterial({ map: whitePanelTex, roughness: 0.7 }),
      monolithRoof: new THREE.MeshStandardMaterial({ map: monolithRoofTex, roughness: 0.65 }),
      monolithWallLong: facadeMaterial(SITE_SEED + 510, "#dcd8cd", [
        { top: 0.14, height: 0.1, cols: 16 },
        { top: 0.32, height: 0.1, cols: 16 },
      ]),
      monolithWallEnd: facadeMaterial(SITE_SEED + 511, "#dcd8cd", [
        { top: 0.14, height: 0.1, cols: 8 },
        { top: 0.32, height: 0.1, cols: 8 },
      ]),
      hqWall: facadeMaterial(SITE_SEED + 512, "#b6ab93", [
        { top: 0.2, height: 0.2, cols: 10 },
        { top: 0.56, height: 0.2, cols: 10 },
      ]),
      barracksWall: facadeMaterial(SITE_SEED + 513, "#bfb49b", [
        { top: 0.3, height: 0.26, cols: 12 },
      ]),
      interiorDark: new THREE.MeshStandardMaterial({ color: "#15130f", roughness: 1 }),
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
      solar: new THREE.MeshStandardMaterial({
        map: makeSolarTexture(SITE_SEED + 520),
        roughness: 0.35,
        metalness: 0.4,
        side: THREE.DoubleSide,
      }),
      gravel: new THREE.MeshStandardMaterial({ color: "#9b8c6f", roughness: 1 }),
      hazard: new THREE.MeshStandardMaterial({ color: "#c9452c", roughness: 0.6 }),
      airframeDark: new THREE.MeshStandardMaterial({
        color: "#33363a",
        roughness: 0.5,
        metalness: 0.35,
      }),
      airframeLight: new THREE.MeshStandardMaterial({
        color: "#969ba0",
        roughness: 0.45,
        metalness: 0.4,
      }),
      canopy: new THREE.MeshStandardMaterial({
        color: "#182a36",
        roughness: 0.1,
        metalness: 0.85,
      }),
      tire: new THREE.MeshStandardMaterial({ color: "#17181a", roughness: 0.95 }),
      stucco: new THREE.MeshStandardMaterial({
        map: makeStuccoTexture(SITE_SEED + 530),
        roughness: 0.92,
      }),
      rustyMetal: new THREE.MeshStandardMaterial({
        map: makeRustStainTexture(SITE_SEED + 531),
        roughness: 0.7,
        metalness: 0.35,
      }),
      // Alpha-tested, not alpha-blended: a cutout sorts correctly against
      // itself and still writes depth, which `transparent: true` does not.
      // The panel geometry carries the tiling in its UVs (see `FencePanel`),
      // so one material serves fences of any size.
      chainLink: new THREE.MeshStandardMaterial({
        map: makeChainLinkTexture(SITE_SEED + 532),
        // Low enough that a mip-blurred wire still registers rather than
        // flickering in and out as the camera moves.
        alphaTest: 0.26,
        roughness: 0.6,
        metalness: 0.5,
        side: THREE.DoubleSide,
      }),
      pvcPipe: new THREE.MeshStandardMaterial({
        color: "#5a5e63",
        roughness: 0.4,
        metalness: 0.15,
      }),
      dirtyConcreteWall: new THREE.MeshStandardMaterial({
        map: makeDirtyConcreteTexture(SITE_SEED + 533),
        roughness: 0.95,
      }),
    });
  }, []);

  useEffect(() => {
    materials.glass.emissiveIntensity = night ? 1.4 : 0;
    materials.beacon.emissiveIntensity = night ? 3 : 0.6;
    const facadeGlow = night ? 1.2 : 0;
    materials.monolithWallLong.emissiveIntensity = facadeGlow;
    materials.monolithWallEnd.emissiveIntensity = facadeGlow;
    materials.hqWall.emissiveIntensity = facadeGlow;
    materials.barracksWall.emissiveIntensity = facadeGlow;
  }, [night, materials]);

  return materials;
}

/** Extruded gable-roof prism: `width` across, `rise` tall, `depth` long. */
function useGableGeometry(width: number, rise: number, depth: number): THREE.ExtrudeGeometry {
  return useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0);
    shape.lineTo(width / 2, 0);
    shape.lineTo(0, rise);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geo.translate(0, 0, -depth / 2);
    return geo;
  }, [width, rise, depth]);
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
      {/* base annex with equipment room */}
      <mesh material={m.concrete} castShadow receiveShadow position={[0, 0.5, 0]}>
        <boxGeometry args={[11, 1, 11]} />
      </mesh>
      <mesh material={m.concreteLight} castShadow position={[4.6, 2.2, 0]}>
        <boxGeometry args={[5, 3.4, 8]} />
      </mesh>
      <mesh material={m.roofDark} position={[4.6, 4.05, 0]}>
        <boxGeometry args={[5.4, 0.25, 8.4]} />
      </mesh>
      {/* HVAC unit on equipment room roof */}
      <mesh material={m.metalDark} castShadow position={[4.6, 4.5, -2]}>
        <boxGeometry args={[1.8, 0.7, 1.4]} />
      </mesh>
      {/* conduit box on base */}
      <mesh material={m.metalDark} position={[7.3, 1.2, 0]}>
        <boxGeometry args={[0.4, 1.2, 0.6]} />
      </mesh>
      {/* tapered shaft with ring ledges */}
      <mesh material={m.concrete} castShadow position={[0, 1 + shaftH / 2, 0]}>
        <cylinderGeometry args={[3.1, 4.1, shaftH, 8]} />
      </mesh>
      {[0.35, 0.65].map((f) => (
        <mesh key={f} material={m.concreteLight} position={[0, 1 + shaftH * f, 0]}>
          <cylinderGeometry args={[3.55, 3.55, 0.35, 8]} />
        </mesh>
      ))}
      {/* external zigzag staircase on +x face */}
      {Array.from({ length: Math.floor(shaftH / 2.5) }, (_, i) => (
        <group key={`stair${i}`}>
          <mesh material={m.metalDark} castShadow position={[
            3.8 + (i % 2 === 0 ? 0.5 : -0.5),
            1.5 + i * 2.5,
            0,
          ]}>
            <boxGeometry args={[2.4, 0.12, 1.2]} />
          </mesh>
          <mesh material={m.metalDark} position={[
            3.8 + (i % 2 === 0 ? 1.6 : -1.6),
            1.5 + i * 2.5 + 1.25,
            0,
          ]}>
            <boxGeometry args={[0.1, 2.5, 0.1]} />
          </mesh>
        </group>
      ))}
      {/* cable tray running down shaft on -x face */}
      <mesh material={m.metalDark} position={[-3.6, 1 + shaftH / 2, 0]}>
        <boxGeometry args={[0.3, shaftH, 0.5]} />
      </mesh>
      {/* catwalk and cab */}
      <mesh material={m.concreteLight} castShadow position={[0, shaftH + 1.25, 0]}>
        <cylinderGeometry args={[5.1, 4.6, 0.5, 8]} />
      </mesh>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <mesh
          key={i}
          material={m.metalDark}
          position={[
            Math.cos((i / 8) * Math.PI * 2) * 4.9,
            shaftH + 2.05,
            Math.sin((i / 8) * Math.PI * 2) * 4.9,
          ]}
        >
          <cylinderGeometry args={[0.05, 0.05, 1.1, 4]} />
        </mesh>
      ))}
      <mesh material={m.metalDark} position={[0, shaftH + 2.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[4.9, 0.05, 6, 24]} />
      </mesh>
      <mesh material={m.glass} castShadow position={[0, shaftH + 3.1, 0]}>
        <cylinderGeometry args={[4, 4.4, 3.2, 8]} />
      </mesh>
      {/* cab mullions */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <mesh
          key={`mul${i}`}
          material={m.metalDark}
          position={[
            Math.cos(((i + 0.5) / 8) * Math.PI * 2) * 4.15,
            shaftH + 3.1,
            Math.sin(((i + 0.5) / 8) * Math.PI * 2) * 4.15,
          ]}
        >
          <boxGeometry args={[0.16, 3.2, 0.16]} />
        </mesh>
      ))}
      <mesh material={m.concreteLight} castShadow position={[0, shaftH + 5, 0]}>
        <cylinderGeometry args={[4.7, 4.2, 0.6, 8]} />
      </mesh>
      {/* VHF/UHF antenna array on roof */}
      <mesh material={m.metalDark} position={[0, shaftH + 7.4, 0]}>
        <cylinderGeometry args={[0.08, 0.12, 4.5, 6]} />
      </mesh>
      {/* cross-arm antenna dipoles */}
      {[0, Math.PI / 2].map((rot, i) => (
        <mesh key={`ant${i}`} material={m.metalDark} position={[0, shaftH + 6.8, 0]} rotation={[0, rot, 0]}>
          <boxGeometry args={[2.4, 0.06, 0.06]} />
        </mesh>
      ))}
      {/* whip antennas */}
      {[-1, 1].map((side) => (
        <mesh key={`whip${side}`} material={m.metalDark} position={[side * 2.2, shaftH + 5.8, 0]}>
          <cylinderGeometry args={[0.02, 0.03, 2.0, 4]} />
        </mesh>
      ))}
      {/* small radar dish */}
      <mesh material={m.whitePanel} castShadow position={[1.5, shaftH + 6, -1.5]} rotation={[0.3, -0.8, 0]}>
        <circleGeometry args={[0.8, 12]} />
      </mesh>
      <mesh material={m.beacon} position={[0, shaftH + 9.8, 0]}>
        <sphereGeometry args={[0.35, 12, 12]} />
      </mesh>
    </group>
  );
}

/** Main hall reconstructed from the close aerial: shallow roof, bright cap and twin facade bands. */
function MonolithHangar({ def, m }: BuilderProps) {
  const [w, h, d] = def.size;
  const rise = 1.4;
  const wallH = h - rise;
  const roofGeometry = useGableGeometry(w + 1.2, rise, d + 1.2);
  const wallMaterials = [m.monolithWallLong, m.monolithWallLong, m.monolithRoof, m.monolithRoof, m.monolithWallEnd, m.monolithWallEnd];
  return (
    <group>
      <mesh material={m.concrete} receiveShadow position={[0, 0.3, 0]}>
        <boxGeometry args={[w + 2, 0.6, d + 2]} />
      </mesh>
      <mesh material={wallMaterials} castShadow receiveShadow position={[0, 0.6 + wallH / 2, 0]}>
        <boxGeometry args={[w, wallH, d]} />
      </mesh>
      <mesh material={m.monolithRoof} geometry={roofGeometry} castShadow position={[0, 0.6 + wallH, 0]} />
      {/* Bright raised perimeter cap clearly visible in the reference. */}
      {[-1, 1].map((side) => (
        <mesh key={`eave-${side}`} material={m.whitePanel} castShadow position={[side * (w / 2 + 0.45), wallH + 0.75, 0]}>
          <boxGeometry args={[0.9, 1.1, d + 1.8]} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`end-cap-${side}`} material={m.whitePanel} castShadow position={[0, wallH + 0.75, side * (d / 2 + 0.45)]}>
          <boxGeometry args={[w + 1.8, 1.1, 0.9]} />
        </mesh>
      ))}
      {/* Dark lower service strip and the two continuous long-side bands. */}
      {[-1, 1].map((side) => (
        <group key={`facade-${side}`} position={[side * (w / 2 + 0.12), 0, 0]}>
          <mesh material={m.metalDark} position={[0, 2.1, 0]}><boxGeometry args={[0.3, 1.1, d * 0.92]} /></mesh>
          <mesh material={m.glass} position={[0, wallH * 0.48, 0]}><boxGeometry args={[0.35, 1.15, d * 0.9]} /></mesh>
          <mesh material={m.glass} position={[0, wallH * 0.68, 0]}><boxGeometry args={[0.35, 1.15, d * 0.9]} /></mesh>
        </group>
      ))}
      {/* Compact service volumes clustered at the apron-facing end. */}
      <mesh material={m.concreteLight} castShadow position={[-w * 0.25, 3, -d / 2 - 4]}><boxGeometry args={[18, 6, 8]} /></mesh>
      <mesh material={m.roofDark} position={[-w * 0.25, 6.1, -d / 2 - 4]}><boxGeometry args={[18.5, 0.25, 8.5]} /></mesh>
      {/* plant deck on the service annex roof */}
      <GreebleDeck
        seed={SITE_SEED + 610}
        width={16}
        depth={6.5}
        rows={2}
        count={14}
        maxHeight={1.3}
        position={[-w * 0.25, 6.22, -d / 2 - 4]}
        material={m.metalDark}
      />
      <mesh material={m.concreteLight} castShadow position={[w * 0.28, 2.4, -d / 2 - 3]}><boxGeometry args={[10, 4.8, 6]} /></mesh>
      <mesh material={m.corrugated} castShadow position={[0, wallH * 0.42, d / 2 + 0.2]}><boxGeometry args={[w * 0.78, wallH * 0.76, 0.45]} /></mesh>
    </group>
  );
}

/** Three gabled shelter bays with dark open mouths on the +z face. */
function ShelterRow({ def, m }: BuilderProps) {
  const [w, h, d] = def.size;
  const bayW = w / 3;
  const wallH = h * 0.72;
  const roofGeometry = useGableGeometry(bayW + 0.7, h - wallH, d + 1);
  return (
    <group>
      <mesh material={m.concrete} receiveShadow position={[0, 0.25, 0]}>
        <boxGeometry args={[w + 1.6, 0.5, d + 1.6]} />
      </mesh>
      {/* back wall */}
      <mesh material={m.concreteLight} castShadow receiveShadow position={[0, 0.5 + wallH * 0.5, -d / 2 + 0.3]}>
        <boxGeometry args={[w, wallH, 0.6]} />
      </mesh>
      {/* dividing + outer side walls */}
      {[-1.5, -0.5, 0.5, 1.5].map((f) => (
        <mesh
          key={f}
          material={m.concreteLight}
          castShadow
          receiveShadow
          position={[f * bayW, 0.5 + wallH * 0.5, 0]}
        >
          <boxGeometry args={[0.7, wallH, d - 0.8]} />
        </mesh>
      ))}
      {/* per-bay gable roofs and dark interiors */}
      {[-1, 0, 1].map((bay) => (
        <group key={bay} position={[bay * bayW, 0, 0]}>
          <mesh material={m.corrugatedWhite} geometry={roofGeometry} castShadow position={[0, 0.5 + wallH, 0]} />
          <mesh material={m.interiorDark} position={[0, 0.5 + wallH * 0.42, d / 2 - 0.9]}>
            <boxGeometry args={[bayW - 2.2, wallH * 0.84, 0.7]} />
          </mesh>
          <mesh material={m.whitePanel} castShadow position={[0, 0.5 + wallH * 0.92, d / 2 - 0.3]}>
            <boxGeometry args={[bayW + 0.7, wallH * 0.16, 0.6]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Ribbed steel arch shed; length runs along local x. */
function Quonset({ def, m }: BuilderProps) {
  const [w, h, d] = def.size;
  const r = d / 2;
  return (
    <group scale={[1, h / r, 1]}>
      <mesh material={m.corrugatedWhite} castShadow receiveShadow rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[r, r, w, 24, 1, true, 0, Math.PI]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          material={m.whitePanel}
          castShadow
          position={[side * (w / 2), 0, 0]}
          rotation={[0, (side * Math.PI) / 2, 0]}
        >
          <circleGeometry args={[r, 24, 0, Math.PI]} />
        </mesh>
      ))}
      <mesh material={m.interiorDark} position={[w / 2 + 0.1, 1.9, 0]}>
        <boxGeometry args={[0.4, 3.8, 4.4]} />
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
      {/* skylight strips */}
      {[-0.22, 0.22].map((f) => (
        <mesh key={`s${f}`} material={m.whitePanel} position={[0, h + 0.45, d * f]}>
          <boxGeometry args={[w * 0.72, 0.4, 1.6]} />
        </mesh>
      ))}
      {/* roof plant — HVAC units */}
      {[-0.15, 0.15].map((f) => (
        <mesh key={`ac${f}`} material={m.metalDark} castShadow position={[w * 0.3, h + 0.8, d * f]}>
          <boxGeometry args={[2, 1.2, 2]} />
        </mesh>
      ))}
      {/* procedural plant deck filling the rest of the roof, inset from the
          parapet so it never breaks the building's silhouette */}
      <GreebleDeck
        seed={SITE_SEED + 620}
        width={w * 0.5}
        depth={d - 4}
        rows={3}
        count={24}
        position={[-w * 0.18, h + 0.24, 0]}
        material={m.metalDark}
      />
      {/* roller doors on the +z face */}
      {[-0.28, 0, 0.28].map((f) => (
        <mesh key={`d${f}`} material={m.corrugated} position={[w * f, h * 0.38, d / 2 + 0.18]}>
          <boxGeometry args={[6, h * 0.72, 0.35]} />
        </mesh>
      ))}
      {/* rust streaks below the door tracks */}
      {[-0.28, 0, 0.28].map((f) => (
        <mesh key={`rust${f}`} material={m.rustyMetal} position={[w * f, h * 0.04, d / 2 + 0.2]}>
          <boxGeometry args={[6.2, h * 0.08, 0.36]} />
        </mesh>
      ))}
      {/* concrete bollards flanking each roller door */}
      {[-0.28, 0, 0.28].map((f) =>
        [-1, 1].map((side) => (
          <mesh key={`bol${f}${side}`} material={m.concreteLight} castShadow position={[w * f + side * 3.5, 0.4, d / 2 + 0.6]}>
            <cylinderGeometry args={[0.25, 0.3, 0.8, 8]} />
          </mesh>
        )),
      )}
      {/* loading dock */}
      <mesh material={m.concreteLight} castShadow receiveShadow position={[0, 0.6, d / 2 + 2]}>
        <boxGeometry args={[w * 0.55, 1.2, 4]} />
      </mesh>
      {/* rain canopy over loading dock */}
      <mesh material={m.roofDark} castShadow position={[0, h * 0.82, d / 2 + 2.5]}>
        <boxGeometry args={[w * 0.6, 0.15, 5]} />
      </mesh>
      {/* canopy support brackets */}
      {[-0.2, 0, 0.2].map((f) => (
        <mesh key={`brk${f}`} material={m.metalDark} position={[w * f, h * 0.55, d / 2 + 4.5]}>
          <cylinderGeometry args={[0.08, 0.08, h * 0.5, 6]} />
        </mesh>
      ))}
      {/* exterior wall lights */}
      {[-0.35, 0.35].map((f) => (
        <mesh key={`lt${f}`} material={m.glass} position={[w * f, h * 0.75, d / 2 + 0.22]}>
          <boxGeometry args={[0.4, 0.3, 0.25]} />
        </mesh>
      ))}
      {/* wall-mounted utility box on -x face */}
      <mesh material={m.metalDark} position={[-w / 2 - 0.15, h * 0.4, 0]}>
        <boxGeometry args={[0.3, 0.8, 0.6]} />
      </mesh>
    </group>
  );
}

/** Two-storey operations building with window bands and entrance canopy. */
function HqBuilding({ def, m }: BuilderProps) {
  const [w, h, d] = def.size;
  const wallMaterials = [m.hqWall, m.hqWall, m.roofDark, m.roofDark, m.hqWall, m.hqWall];
  return (
    <group>
      <mesh material={m.concrete} receiveShadow position={[0, 0.25, 0]}>
        <boxGeometry args={[w + 1.6, 0.5, d + 1.6]} />
      </mesh>
      <mesh material={wallMaterials} castShadow receiveShadow position={[0, 0.5 + h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      {/* parapet */}
      {[-1, 1].map((side) => (
        <mesh key={`p${side}`} material={m.concreteLight} position={[0, h + 0.75, (side * (d - 0.4)) / 2]}>
          <boxGeometry args={[w, 0.7, 0.4]} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`q${side}`} material={m.concreteLight} position={[(side * (w - 0.4)) / 2, h + 0.75, 0]}>
          <boxGeometry args={[0.4, 0.7, d]} />
        </mesh>
      ))}
      {/* entrance canopy on the -x (street) face */}
      <mesh material={m.roofDark} castShadow position={[-w / 2 - 2, 3.4, 0]}>
        <boxGeometry args={[4, 0.3, 8]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`c${side}`} material={m.metalDark} position={[-w / 2 - 3.6, 1.7, side * 3.4]}>
          <cylinderGeometry args={[0.14, 0.14, 3.4, 8]} />
        </mesh>
      ))}
      <mesh material={m.interiorDark} position={[-w / 2 - 0.05, 1.6, 0]}>
        <boxGeometry args={[0.3, 2.6, 3.4]} />
      </mesh>
      {/* roof plant + comms mast */}
      {[-0.28, 0.1].map((f) => (
        <mesh key={`ac${f}`} material={m.metalDark} castShadow position={[w * f, h + 1, d * 0.15]}>
          <boxGeometry args={[1.8, 1, 1.8]} />
        </mesh>
      ))}
      <group position={[w * 0.32, 0, -d * 0.2]}>
        <mesh material={m.metalDark} castShadow position={[0, h + 3.6, 0]}>
          <cylinderGeometry args={[0.08, 0.14, 6.5, 6]} />
        </mesh>
        <mesh material={m.metalDark} position={[0, h + 5.4, 0]}>
          <boxGeometry args={[1.6, 0.12, 0.12]} />
        </mesh>
        <mesh material={m.metalDark} position={[0, h + 4.6, 0]}>
          <boxGeometry args={[2.2, 0.12, 0.12]} />
        </mesh>
      </group>
    </group>
  );
}

/** Long dormitory block; the whole roof is a tilted photovoltaic array. */
function Barracks({ def, m }: BuilderProps) {
  const [w, h, d] = def.size;
  const wallMaterials = [
    m.barracksWall,
    m.barracksWall,
    m.roofDark,
    m.roofDark,
    m.barracksWall,
    m.barracksWall,
  ];
  return (
    <group>
      <mesh material={m.concrete} receiveShadow position={[0, 0.2, 0]}>
        <boxGeometry args={[w + 1.2, 0.4, d + 1.2]} />
      </mesh>
      <mesh material={wallMaterials} castShadow receiveShadow position={[0, 0.4 + h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      {/* entrance doors with canopies on the +z face */}
      {[-0.25, 0.25].map((f) => (
        <group key={f} position={[w * f, 0, d / 2]}>
          <mesh material={m.interiorDark} position={[0, 1.5, 0.05]}>
            <boxGeometry args={[1.4, 2.4, 0.25]} />
          </mesh>
          <mesh material={m.roofDark} castShadow position={[0, 2.9, 0.8]}>
            <boxGeometry args={[2.4, 0.2, 1.8]} />
          </mesh>
        </group>
      ))}
      {/* rooftop photovoltaic rows facing south (+z) */}
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          material={m.solar}
          castShadow
          position={[0, h + 1.05, -d / 2 + 2.2 + i * ((d - 4) / 3)]}
          rotation={[-0.29, 0, 0]}
        >
          <boxGeometry args={[w - 3, 0.12, 2.6]} />
        </mesh>
      ))}
    </group>
  );
}

function SupportBuilding({ def, m }: BuilderProps) {
  const [w, h, d] = def.size;
  return (
    <group>
      <mesh material={m.concrete} receiveShadow position={[0, 0.15, 0]}>
        <boxGeometry args={[w + 0.8, 0.3, d + 0.8]} />
      </mesh>
      <mesh material={m.stucco} castShadow receiveShadow position={[0, 0.3 + h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      <mesh material={m.roofDark} castShadow position={[0, 0.3 + h + 0.12, 0]}>
        <boxGeometry args={[w + 0.8, 0.25, d + 0.8]} />
      </mesh>
      {/* window strip and door on the +z face */}
      <mesh material={m.glass} position={[w * 0.08, 0.3 + h * 0.58, d / 2 + 0.04]}>
        <boxGeometry args={[w * 0.5, 0.9, 0.1]} />
      </mesh>
      <mesh material={m.metalDark} position={[w * 0.08, 0.3 + h * 0.58, d / 2 + 0.09]}>
        <boxGeometry args={[w * 0.5 + 0.12, 0.06, 0.04]} />
      </mesh>
      <mesh material={m.interiorDark} position={[-w * 0.32, 0.3 + h * 0.36, d / 2 + 0.04]}>
        <boxGeometry args={[1.3, h * 0.68, 0.12]} />
      </mesh>
      <mesh material={m.metalDark} position={[-w * 0.32, 0.3 + h * 0.72, d / 2 + 0.05]}>
        <boxGeometry args={[1.5, 0.08, 0.06]} />
      </mesh>
      {/* rooftop condenser, weathered where it drains onto the wall below */}
      <mesh material={m.metalDark} castShadow position={[-w * 0.25, 0.3 + h + 0.7, 0]}>
        <boxGeometry args={[1.6, 0.9, 1.6]} />
      </mesh>
      <mesh material={m.rustyMetal} position={[-w * 0.25, 0.3 + h * 0.55, -d / 2 - 0.02]}>
        <boxGeometry args={[1.4, h * 0.8, 0.04]} />
      </mesh>
      {/* utility conduit run along the base */}
      <mesh material={m.pvcPipe} position={[w / 2 + 0.15, 0.6, 0]}>
        <cylinderGeometry args={[0.1, 0.1, d * 0.6, 8]} />
      </mesh>
    </group>
  );
}

/** Walled yard: perimeter wall with a gate, workshop block and shed inside. */
function WalledCompound({ def, m }: BuilderProps) {
  const [w, h, d] = def.size;
  const wallH = 2.8;
  const gate = 8;
  const segW = (w - gate) / 2;
  return (
    <group>
      {/* perimeter walls; gate gap on the +z side */}
      <mesh material={m.dirtyConcreteWall} castShadow receiveShadow position={[0, wallH / 2, -d / 2 + 0.25]}>
        <boxGeometry args={[w, wallH, 0.5]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={`s${side}`}
          material={m.dirtyConcreteWall}
          castShadow
          receiveShadow
          position={[(side * (gate + segW)) / 2, wallH / 2, d / 2 - 0.25]}
        >
          <boxGeometry args={[segW, wallH, 0.5]} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh
          key={`e${side}`}
          material={m.dirtyConcreteWall}
          castShadow
          receiveShadow
          position={[side * (w / 2 - 0.25), wallH / 2, 0]}
        >
          <boxGeometry args={[0.5, wallH, d - 1]} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`g${side}`} material={m.concrete} castShadow position={[(side * gate) / 2, 1.7, d / 2 - 0.25]}>
          <boxGeometry args={[0.8, 3.4, 0.8]} />
        </mesh>
      ))}
      {/* workshop block */}
      <mesh material={m.concreteLight} castShadow receiveShadow position={[-w * 0.2, h / 2, -d * 0.18]}>
        <boxGeometry args={[w * 0.4, h, d * 0.36]} />
      </mesh>
      <mesh material={m.roofDark} position={[-w * 0.2, h + 0.12, -d * 0.18]}>
        <boxGeometry args={[w * 0.4 + 0.6, 0.25, d * 0.36 + 0.6]} />
      </mesh>
      {/* open-sided shed */}
      <mesh material={m.corrugatedTan} castShadow position={[w * 0.27, h * 0.62, -d * 0.22]}>
        <boxGeometry args={[w * 0.24, 0.3, d * 0.24]} />
      </mesh>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`leg${sx}${sz}`}
            material={m.metalDark}
            position={[w * 0.27 + sx * w * 0.1, h * 0.28, -d * 0.22 + sz * d * 0.1]}
          >
            <cylinderGeometry args={[0.08, 0.08, h * 0.6, 6]} />
          </mesh>
        )),
      )}
      {/* stored crates */}
      {[
        { x: w * 0.18, z: d * 0.22, s: 1.6 },
        { x: w * 0.3, z: d * 0.18, s: 1.2 },
        { x: -w * 0.05, z: d * 0.25, s: 1.4 },
      ].map((c, i) => (
        <mesh key={`crate${i}`} material={m.concrete} castShadow position={[c.x, c.s / 2, c.z]}>
          <boxGeometry args={[c.s, c.s, c.s]} />
        </mesh>
      ))}
    </group>
  );
}

function Guardhouse({ def, m }: BuilderProps) {
  void def;
  return (
    <group>
      <mesh material={m.concrete} receiveShadow position={[0, 0.1, 0]}>
        <boxGeometry args={[3.8, 0.2, 3.8]} />
      </mesh>
      <mesh material={m.stucco} castShadow receiveShadow position={[0, 1.6, 0]}>
        <boxGeometry args={[3.4, 3, 3.4]} />
      </mesh>
      <mesh material={m.glass} position={[0, 2.05, 0]}>
        <boxGeometry args={[3.5, 0.9, 3.5]} />
      </mesh>
      <mesh material={m.metalDark} position={[0, 2.05, 0]}>
        <boxGeometry args={[3.56, 0.06, 3.56]} />
      </mesh>
      {/* overhanging eave */}
      <mesh material={m.roofDark} castShadow position={[0, 3.25, 0]}>
        <boxGeometry args={[4.6, 0.25, 4.6]} />
      </mesh>
      {/* roof-mounted beacon */}
      <mesh material={m.beacon} position={[1.4, 3.5, 1.4]}>
        <sphereGeometry args={[0.15, 8, 8]} />
      </mesh>
      {/* barrier arm across the approach */}
      <mesh material={m.metalDark} castShadow position={[1.6, 0.6, 2.2]}>
        <boxGeometry args={[0.3, 1.2, 0.3]} />
      </mesh>
      <mesh material={m.hazard} castShadow position={[-1, 1.15, 2.2]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, 5.4, 8]} />
      </mesh>
      {/* counterweight box on the pivot */}
      <mesh material={m.metalDark} castShadow position={[1.6, 1.3, 2.2]}>
        <boxGeometry args={[0.5, 0.35, 0.5]} />
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
      {/* equipment shelter + generator */}
      <mesh material={m.concreteLight} castShadow receiveShadow position={[0.4, 1.25, 4.6]}>
        <boxGeometry args={[3.4, 2.5, 2.2]} />
      </mesh>
      <mesh material={m.metalDark} position={[-3.2, 0.8, 3.4]}>
        <boxGeometry args={[1.6, 1.6, 1]} />
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
      {/* rust bleed at the base seam */}
      <mesh material={m.rustyMetal} position={[0, h * 0.06, 0]}>
        <cylinderGeometry args={[r + 0.02, r + 0.02, h * 0.12, 24, 1, true]} />
      </mesh>
      <mesh material={m.tankSteel} castShadow position={[0, h, 0]} scale={[1, 0.25, 1]}>
        <sphereGeometry args={[r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {[0.25, 0.55, 0.85].map((f) => (
        <mesh key={f} material={m.metalDark} position={[0, h * f, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[r + 0.06, 0.08, 6, 32]} />
        </mesh>
      ))}
      {/* access ladder and transfer pipe */}
      <mesh material={m.metalDark} castShadow position={[r + 0.3, h / 2, 0]}>
        <boxGeometry args={[0.5, h, 0.2]} />
      </mesh>
      <mesh material={m.metalDark} position={[0, 0.5, -r - 2.5]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 5, 8]} />
      </mesh>
    </group>
  );
}

/** Ground-mounted photovoltaic field: tilted rows on a graded pad. */
function SolarArray({ def, m }: BuilderProps) {
  const [w, , d] = def.size;
  const rows = 6;
  const pitch = (d - 8) / (rows - 1);
  return (
    <group>
      <mesh material={m.gravel} receiveShadow position={[0, 0.08, 0]}>
        <boxGeometry args={[w, 0.16, d]} />
      </mesh>
      {Array.from({ length: rows }, (_, i) => (
        <mesh
          key={i}
          material={m.solar}
          castShadow
          position={[0, 1.6, -d / 2 + 4 + i * pitch]}
          rotation={[-0.31, 0, 0]}
        >
          <boxGeometry args={[w - 8, 0.14, 3.4]} />
        </mesh>
      ))}
      <mesh material={m.concreteLight} castShadow receiveShadow position={[w / 2 - 4, 1.1, d / 2 - 3]}>
        <boxGeometry args={[3, 2.2, 2]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Aircraft                                                            */
/* ------------------------------------------------------------------ */

/** Tailless flying-wing UCAV, nose toward local -z. */
function AircraftDelta({ def, m }: BuilderProps) {
  const [span, , len] = def.size;
  const wingGeometry = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, len * 0.52);
    s.lineTo(span * 0.5, -len * 0.3);
    s.lineTo(span * 0.5 - 0.8, -len * 0.4);
    s.lineTo(span * 0.16, -len * 0.46);
    s.lineTo(0, -len * 0.34);
    s.lineTo(-span * 0.16, -len * 0.46);
    s.lineTo(-(span * 0.5 - 0.8), -len * 0.4);
    s.lineTo(-span * 0.5, -len * 0.3);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.4,
      bevelEnabled: true,
      bevelThickness: 0.24,
      bevelSize: 0.5,
      bevelSegments: 2,
    });
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [span, len]);
  return (
    <group>
      <mesh material={m.airframeDark} geometry={wingGeometry} castShadow position={[0, 1.0, 0]} />
      {/* dorsal hump: inlet, engine and bay fairing */}
      <mesh material={m.airframeDark} castShadow position={[0, 1.35, -len * 0.08]} scale={[1.25, 0.55, 2.1]}>
        <sphereGeometry args={[1.15, 20, 14]} />
      </mesh>
      <mesh material={m.metalDark} position={[0, 1.25, len * 0.37]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.3, 0.36, 0.9, 12]} />
      </mesh>
      {/* landing gear */}
      <mesh material={m.metalDark} position={[0, 0.6, -len * 0.28]}>
        <cylinderGeometry args={[0.07, 0.07, 0.9, 6]} />
      </mesh>
      <mesh material={m.tire} position={[0, 0.24, -len * 0.28]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.24, 0.24, 0.16, 12]} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 1.3, 0, len * 0.1]}>
          <mesh material={m.metalDark} position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.08, 0.08, 0.9, 6]} />
          </mesh>
          <mesh material={m.tire} position={[0, 0.28, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.28, 0.28, 0.18, 12]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Twin-tail multirole fighter, nose toward local -z. */
function AircraftFighter({ def, m }: BuilderProps) {
  const [span, , len] = def.size;
  const cy = 1.15;
  const wingGeometry = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0.8, len * 0.1);
    s.lineTo(span * 0.5, -len * 0.11);
    s.lineTo(span * 0.5, -len * 0.16);
    s.lineTo(0.8, -len * 0.21);
    s.lineTo(-0.8, -len * 0.21);
    s.lineTo(-span * 0.5, -len * 0.16);
    s.lineTo(-span * 0.5, -len * 0.11);
    s.lineTo(-0.8, len * 0.1);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.16,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.1,
      bevelSegments: 1,
    });
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [span, len]);
  const stabGeometry = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0.45, 0.6);
    s.lineTo(2.6, -0.5);
    s.lineTo(2.6, -1.0);
    s.lineTo(0.45, -1.1);
    s.lineTo(-0.45, -1.1);
    s.lineTo(-2.6, -1.0);
    s.lineTo(-2.6, -0.5);
    s.lineTo(-0.45, 0.6);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);
  return (
    <group>
      {/* fuselage: nose cone, barrel, tail taper */}
      <mesh material={m.airframeLight} castShadow position={[0, cy, -len * 0.435]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.85, 0.12, len * 0.22, 16]} />
      </mesh>
      <mesh material={m.airframeLight} castShadow position={[0, cy, -len * 0.05]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.85, 0.85, len * 0.55, 16]} />
      </mesh>
      <mesh material={m.airframeLight} castShadow position={[0, cy, len * 0.315]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.55, 0.85, len * 0.18, 16]} />
      </mesh>
      <mesh material={m.metalDark} position={[0, cy, -len * 0.5 - 0.55]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 1.1, 6]} />
      </mesh>
      {/* canopy */}
      <mesh material={m.canopy} castShadow position={[0, cy + 0.68, -len * 0.22]} scale={[0.75, 0.6, 1.8]}>
        <sphereGeometry args={[0.8, 18, 12]} />
      </mesh>
      {/* intakes */}
      {[-1, 1].map((side) => (
        <mesh key={`i${side}`} material={m.airframeLight} castShadow position={[side * 0.95, cy - 0.3, -len * 0.1]}>
          <boxGeometry args={[0.55, 0.75, len * 0.16]} />
        </mesh>
      ))}
      {/* wings and stabilators */}
      <mesh material={m.airframeLight} geometry={wingGeometry} castShadow position={[0, cy - 0.28, 0]} />
      <mesh material={m.airframeLight} geometry={stabGeometry} castShadow position={[0, cy - 0.05, len * 0.36]} />
      {/* twin canted fins */}
      {[-1, 1].map((side) => (
        <mesh
          key={`f${side}`}
          material={m.airframeLight}
          castShadow
          position={[side * 0.95, cy + 1.35, len * 0.3]}
          rotation={[0.42, 0, side * -0.28]}
        >
          <boxGeometry args={[0.12, 2.2, 1.7]} />
        </mesh>
      ))}
      {/* engine nozzles */}
      {[-1, 1].map((side) => (
        <mesh
          key={`n${side}`}
          material={m.metalDark}
          position={[side * 0.46, cy - 0.05, len * 0.43]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.4, 0.44, 1.1, 12]} />
        </mesh>
      ))}
      {/* landing gear */}
      <mesh material={m.metalDark} position={[0, 0.6, -len * 0.28]}>
        <cylinderGeometry args={[0.06, 0.06, 1.1, 6]} />
      </mesh>
      <mesh material={m.tire} position={[0, 0.26, -len * 0.28]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.26, 0.26, 0.18, 12]} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={`g${side}`} position={[side * 1.35, 0, len * 0.06]}>
          <mesh material={m.metalDark} position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 1.1, 6]} />
          </mesh>
          <mesh material={m.tire} position={[0, 0.3, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.3, 0.3, 0.2, 12]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** J-36: Large modified delta wing heavy fighter with three engines. */
function AircraftJ36({ def, m }: BuilderProps) {
  const [span, , len] = def.size;
  const cy = 1.4;

  // Large modified delta wing geometry. The planform is written against the
  // half-span/half-length so wingtips and nose land exactly on `def.size` —
  // that value is the reported wingspan and length and is shown in the
  // dossier, so the model has to actually measure it.
  const wingGeometry = useMemo(() => {
    const hx = span * 0.5;
    const hz = len * 0.5;
    const s = new THREE.Shape();
    // Delta wing with slightly swept leading edges
    s.moveTo(0, hz);
    s.lineTo(hx, -hz * 0.729);
    s.lineTo(hx - 1.15, -hz * 0.875);
    s.lineTo(hx * 0.346, -hz);
    s.lineTo(0, -hz * 0.792);
    s.lineTo(-hx * 0.346, -hz);
    s.lineTo(-(hx - 1.15), -hz * 0.875);
    s.lineTo(-hx, -hz * 0.729);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.5,
      bevelEnabled: true,
      bevelThickness: 0.3,
      bevelSize: 0.6,
      bevelSegments: 2,
    });
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [span, len]);

  /**
   * Long, low blended centrebody. The reference photographs show a flat spine
   * running nearly the whole length and faired into the wing, not a discrete
   * tube fuselage, so this is an extruded plan outline rather than a sphere.
   */
  const bodyGeometry = useMemo(() => {
    const halfW = span * 0.115;
    const hz = len * 0.5;
    const s = new THREE.Shape();
    s.moveTo(0, hz * 0.94);
    s.lineTo(halfW, hz * 0.12);
    s.lineTo(halfW * 0.86, -hz * 0.86);
    s.lineTo(-halfW * 0.86, -hz * 0.86);
    s.lineTo(-halfW, hz * 0.12);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 1.25,
      bevelEnabled: true,
      bevelThickness: 0.5,
      bevelSize: 0.4,
      bevelSegments: 2,
    });
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [span, len]);

  return (
    <group>
      {/* Main delta wing */}
      <mesh material={m.airframeDark} geometry={wingGeometry} castShadow position={[0, cy, 0]} />

      {/* Blended centrebody */}
      <mesh material={m.airframeDark} geometry={bodyGeometry} castShadow position={[0, cy, 0]} />

      {/* Canopy, set well forward and faired flat into the spine */}
      <mesh material={m.canopy} castShadow position={[0, cy + 1.02, -len * 0.27]} scale={[0.8, 0.5, 2.1]}>
        <sphereGeometry args={[0.9, 18, 12]} />
      </mesh>

      {/* Dorsal intake aft of the canopy — the feature that makes this
          airframe a trijet rather than a conventional twin. */}
      <mesh material={m.airframeDark} castShadow position={[0, cy + 1.3, -len * 0.04]}>
        <boxGeometry args={[span * 0.16, 0.7, len * 0.2]} />
      </mesh>

      {/* Three exhausts at the trailing edge: one on the centreline, one
          either side of the spine. */}
      <mesh material={m.metalDark} position={[0, cy - 0.05, len * 0.41]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.45, 0.5, 1.2, 14]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={`nozzle${side}`}
          material={m.metalDark}
          position={[side * span * 0.13, cy - 0.05, len * 0.46]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.4, 0.44, 1.0, 12]} />
        </mesh>
      ))}

      {/* Two long ventral fairings flanking the centreline — the pair of dark
          rectangles that dominate the underside in the reference imagery. */}
      {[-1, 1].map((side) => (
        <mesh
          key={`bay${side}`}
          material={m.airframeDark}
          castShadow
          position={[side * span * 0.19, cy - 0.34, -len * 0.02]}
        >
          <boxGeometry args={[span * 0.09, 0.55, len * 0.36]} />
        </mesh>
      ))}

      {/* Landing gear - nose */}
      <mesh material={m.metalDark} position={[0, 0.6, -len * 0.3]}>
        <cylinderGeometry args={[0.08, 0.08, 1.1, 6]} />
      </mesh>
      <mesh material={m.tire} position={[0, 0.24, -len * 0.3]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.28, 0.28, 0.2, 12]} />
      </mesh>

      {/* Landing gear - main, twin wheels on each leg */}
      {[-1, 1].map((side) => (
        <group key={`g${side}`} position={[side * span * 0.24, 0, len * 0.06]}>
          <mesh material={m.metalDark} position={[0, 0.65, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 1.2, 6]} />
          </mesh>
          {[-1, 1].map((wheel) => (
            <mesh
              key={`w${wheel}`}
              material={m.tire}
              position={[wheel * 0.24, 0.32, 0]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.34, 0.34, 0.2, 12]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** J-XDS (J-50): Lambda wing heavy fighter with twin engines. */
function AircraftJXDS({ def, m }: BuilderProps) {
  const [span, , len] = def.size;
  const cy = 1.25;

  // Lambda wing geometry - angular notch in leading edge. As with the J-36,
  // the planform is normalised to the half-span/half-length so the model
  // measures the reported wingspan and length rather than 84% of the span.
  const wingGeometry = useMemo(() => {
    const hx = span * 0.5;
    const hz = len * 0.5;
    const s = new THREE.Shape();
    // Nose point
    s.moveTo(0, hz);
    // Outer wing - Lambda notch pattern
    s.lineTo(hx * 0.429, hz * 0.333);
    s.lineTo(hx, -hz * 0.556);
    s.lineTo(hx, -hz * 0.844);
    s.lineTo(hx * 0.286, -hz);
    s.lineTo(0, -hz * 0.778);
    // Mirror for left side
    s.lineTo(-hx * 0.286, -hz);
    s.lineTo(-hx, -hz * 0.844);
    s.lineTo(-hx, -hz * 0.556);
    s.lineTo(-hx * 0.429, hz * 0.333);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.45,
      bevelEnabled: true,
      bevelThickness: 0.25,
      bevelSize: 0.5,
      bevelSegments: 2,
    });
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [span, len]);

  /** Slimmer, lower blended body than the J-36's, carried further aft. */
  const bodyGeometry = useMemo(() => {
    const halfW = span * 0.085;
    const hz = len * 0.5;
    const s = new THREE.Shape();
    s.moveTo(0, hz * 0.96);
    s.lineTo(halfW, hz * 0.2);
    s.lineTo(halfW * 0.8, -hz * 0.88);
    s.lineTo(-halfW * 0.8, -hz * 0.88);
    s.lineTo(-halfW, hz * 0.2);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 1.05,
      bevelEnabled: true,
      bevelThickness: 0.42,
      bevelSize: 0.38,
      bevelSegments: 2,
    });
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [span, len]);

  return (
    <group>
      {/* Lambda wing */}
      <mesh material={m.airframeLight} geometry={wingGeometry} castShadow position={[0, cy, 0]} />

      {/* Blended centrebody. The head-on reference shows a wide, flat,
          faceted body chined into the wing — not the tube of cylinders this
          used to be built from. */}
      <mesh material={m.airframeLight} geometry={bodyGeometry} castShadow position={[0, cy, 0]} />

      {/* Canopy - single seat, low and well forward */}
      <mesh material={m.canopy} castShadow position={[0, cy + 0.92, -len * 0.24]} scale={[0.72, 0.45, 1.7]}>
        <sphereGeometry args={[0.8, 18, 12]} />
      </mesh>

      {/* Twin engine nozzles at the trailing edge */}
      {[-1, 1].map((side) => (
        <mesh
          key={`n${side}`}
          material={m.metalDark}
          position={[side * span * 0.055, cy - 0.05, len * 0.4]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.38, 0.42, 1.0, 12]} />
        </mesh>
      ))}

      {/* Chined side intakes tucked under the leading-edge root extensions */}
      {[-1, 1].map((side) => (
        <mesh
          key={`i${side}`}
          material={m.airframeLight}
          castShadow
          position={[side * span * 0.1, cy - 0.28, -len * 0.1]}
        >
          <boxGeometry args={[span * 0.06, 0.65, len * 0.22]} />
        </mesh>
      ))}

      {/* Landing gear - nose, twin wheels as in the head-on reference */}
      <mesh material={m.metalDark} position={[0, 0.6, -len * 0.28]}>
        <cylinderGeometry args={[0.07, 0.07, 1.1, 6]} />
      </mesh>
      {[-1, 1].map((wheel) => (
        <mesh
          key={`nw${wheel}`}
          material={m.tire}
          position={[wheel * 0.17, 0.26, -len * 0.28]}
          rotation={[0, 0, Math.PI / 2]}
        >
          <cylinderGeometry args={[0.26, 0.26, 0.16, 12]} />
        </mesh>
      ))}

      {/* Landing gear - main */}
      {[-1, 1].map((side) => (
        <group key={`g${side}`} position={[side * span * 0.12, 0, len * 0.05]}>
          <mesh material={m.metalDark} position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.08, 0.08, 1.1, 6]} />
          </mesh>
          <mesh material={m.tire} position={[0, 0.28, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.3, 0.3, 0.2, 12]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* New structure builders from satellite imagery                        */
/* ------------------------------------------------------------------ */

/** Elevated cylindrical water tank on a lattice steel frame. */
function WaterTower({ def, m }: BuilderProps) {
  const h = def.size[1];
  const tankR = def.size[0] / 2;
  const tankH = 3.5;
  const legH = h - tankH;
  return (
    <group>
      {/* four lattice legs */}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`leg${sx}${sz}`} material={m.metalDark} castShadow position={[sx * (tankR - 0.3), legH / 2, sz * (tankR - 0.3)]}>
            <boxGeometry args={[0.25, legH, 0.25]} />
          </mesh>
        )),
      )}
      {/* cross bracing rings */}
      {[0.25, 0.55, 0.85].map((f) => (
        <mesh key={`brace${f}`} material={m.metalDark} position={[0, legH * f, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[tankR - 0.3, 0.06, 4, 16]} />
        </mesh>
      ))}
      {/* diagonal bracing */}
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((rot, i) => (
        <mesh key={`diag${i}`} material={m.metalDark} position={[0, legH * 0.4, 0]} rotation={[0.5, rot, 0]}>
          <boxGeometry args={[0.08, legH * 0.6, 0.08]} />
        </mesh>
      ))}
      {/* tank body */}
      <mesh material={m.tankSteel} castShadow position={[0, legH + tankH / 2, 0]}>
        <cylinderGeometry args={[tankR, tankR, tankH, 16]} />
      </mesh>
      {/* domed top */}
      <mesh material={m.tankSteel} castShadow position={[0, legH + tankH, 0]} scale={[1, 0.3, 1]}>
        <sphereGeometry args={[tankR, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {/* access ladder */}
      <mesh material={m.metalDark} position={[tankR + 0.2, h / 2, 0]}>
        <boxGeometry args={[0.35, h, 0.15]} />
      </mesh>
      {/* pipe run to ground */}
      <mesh material={m.pvcPipe} position={[-tankR - 0.3, legH / 2, 0]}>
        <cylinderGeometry args={[0.12, 0.12, legH, 8]} />
      </mesh>
    </group>
  );
}

/** Hardened comms shelter with antenna farm on roof. */
function CommsShelter({ def, m }: BuilderProps) {
  const [w, h, d] = def.size;
  return (
    <group>
      <mesh material={m.concreteLight} castShadow receiveShadow position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      <mesh material={m.roofDark} position={[0, h + 0.12, 0]}>
        <boxGeometry args={[w + 0.6, 0.25, d + 0.6]} />
      </mesh>
      {/* door on +z face */}
      <mesh material={m.interiorDark} position={[-w * 0.25, 1.3, d / 2 + 0.05]}>
        <boxGeometry args={[1.2, 2.2, 0.15]} />
      </mesh>
      {/* HVAC unit */}
      <mesh material={m.metalDark} castShadow position={[w * 0.25, h + 0.6, 0]}>
        <boxGeometry args={[1.8, 0.8, 1.4]} />
      </mesh>
      {/* whip antennas — VHF/HF */}
      {[-0.3, 0, 0.3].map((f) => (
        <mesh key={`whip${f}`} material={m.metalDark} castShadow position={[w * f, h + 2.5, -d * 0.2]}>
          <cylinderGeometry args={[0.02, 0.04, 4.5, 4]} />
        </mesh>
      ))}
      {/* satellite dish on roof */}
      <mesh material={m.whitePanel} castShadow position={[-w * 0.2, h + 1.2, d * 0.2]} rotation={[-0.6, 0, 0]}>
        <circleGeometry args={[1.1, 16]} />
      </mesh>
      <mesh material={m.metalDark} position={[-w * 0.2, h + 0.6, d * 0.2]}>
        <cylinderGeometry args={[0.06, 0.06, 1.0, 6]} />
      </mesh>
      {/* cable tray to tower */}
      <mesh material={m.metalDark} position={[w / 2 + 1.5, h * 0.6, 0]}>
        <boxGeometry args={[3, 0.15, 0.4]} />
      </mesh>
    </group>
  );
}

/** Fenced high-voltage switchyard with transformers and insulators. */
function TransformerYard({ def, m }: BuilderProps) {
  const [w, h, d] = def.size;
  return (
    <group>
      {/* gravel pad */}
      <mesh material={m.gravel} receiveShadow position={[0, 0.06, 0]}>
        <boxGeometry args={[w, 0.12, d]} />
      </mesh>
      {/* chain-link fence perimeter */}
      {[-1, 1].map((side) => (
        <FencePanel
          key={`fz${side}`}
          material={m.chainLink}
          width={w}
          height={h}
          position={[0, h / 2, (side * d) / 2]}
        />
      ))}
      {[-1, 1].map((side) => (
        <FencePanel
          key={`fx${side}`}
          material={m.chainLink}
          width={d}
          height={h}
          rotation={Math.PI / 2}
          position={[(side * w) / 2, h / 2, 0]}
        />
      ))}
      {/* fence posts */}
      {[-1, 0, 1].map((f) =>
        [-1, 1].map((side) => (
          <mesh key={`post${f}${side}`} material={m.metalDark} position={[w * f * 0.45, h / 2, side * d / 2]}>
            <cylinderGeometry args={[0.06, 0.06, h + 0.4, 6]} />
          </mesh>
        )),
      )}
      {/* two transformer units */}
      {[-0.25, 0.25].map((f) => (
        <group key={`tx${f}`} position={[w * f, 0, 0]}>
          <mesh material={m.metalDark} castShadow position={[0, 1.4, 0]}>
            <boxGeometry args={[3.5, 2.8, 2.8]} />
          </mesh>
          {/* cooling fins */}
          <mesh material={m.corrugated} position={[1.9, 1.4, 0]}>
            <boxGeometry args={[0.3, 2.4, 2.2]} />
          </mesh>
          {/* bushing insulators on top */}
          {[-0.6, 0, 0.6].map((bz) => (
            <mesh key={`ins${bz}`} material={m.whitePanel} castShadow position={[0, 3.2, bz]}>
              <cylinderGeometry args={[0.12, 0.16, 1.2, 8]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* overhead bus bars */}
      <mesh material={m.metalDark} position={[0, h - 0.5, 0]}>
        <boxGeometry args={[w * 0.8, 0.06, 0.06]} />
      </mesh>
      {/* warning sign */}
      <mesh material={m.hazard} position={[0, h * 0.6, d / 2 + 0.08]}>
        <boxGeometry args={[0.8, 0.6, 0.05]} />
      </mesh>
    </group>
  );
}

/** Elevated observation tower with a covered cab and searchlight. */
function GuardTower({ def, m }: BuilderProps) {
  const h = def.size[1];
  const cabH = 2.6;
  const legH = h - cabH;
  return (
    <group>
      {/* four steel legs */}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`leg${sx}${sz}`} material={m.metalDark} castShadow position={[sx * 1.3, legH / 2, sz * 1.3]}>
            <boxGeometry args={[0.2, legH, 0.2]} />
          </mesh>
        )),
      )}
      {/* cross braces */}
      {[0.3, 0.7].map((f) => (
        <group key={`brace${f}`}>
          <mesh material={m.metalDark} position={[0, legH * f, 1.3]} rotation={[0, 0, 0.6]}>
            <boxGeometry args={[0.08, 3.2, 0.08]} />
          </mesh>
          <mesh material={m.metalDark} position={[1.3, legH * f, 0]} rotation={[0.6, 0, 0]}>
            <boxGeometry args={[0.08, 0.08, 3.2]} />
          </mesh>
        </group>
      ))}
      {/* platform */}
      <mesh material={m.metalDark} castShadow position={[0, legH, 0]}>
        <boxGeometry args={[3.4, 0.15, 3.4]} />
      </mesh>
      {/* cab — concrete walls with window band */}
      <mesh material={m.concreteLight} castShadow position={[0, legH + cabH / 2, 0]}>
        <boxGeometry args={[2.8, cabH, 2.8]} />
      </mesh>
      <mesh material={m.glass} position={[0, legH + cabH * 0.65, 0]}>
        <boxGeometry args={[2.9, cabH * 0.35, 2.9]} />
      </mesh>
      {/* roof slab */}
      <mesh material={m.roofDark} castShadow position={[0, legH + cabH + 0.1, 0]}>
        <boxGeometry args={[3.2, 0.2, 3.2]} />
      </mesh>
      {/* searchlight */}
      <mesh material={m.glass} position={[0.8, legH + cabH + 0.5, 0.8]}>
        <cylinderGeometry args={[0.2, 0.3, 0.4, 8]} />
      </mesh>
      {/* access ladder */}
      <mesh material={m.metalDark} position={[1.5, legH / 2, 0]}>
        <boxGeometry args={[0.4, legH, 0.15]} />
      </mesh>
    </group>
  );
}

/** Roofed steel-frame corridor / covered walkway. */
function CoveredWalkway({ def, m }: BuilderProps) {
  const [w, h, d] = def.size;
  const postSpacing = 4;
  const nPosts = Math.max(2, Math.floor(d / postSpacing) + 1);
  return (
    <group>
      {/* concrete path */}
      <mesh material={m.concreteLight} receiveShadow position={[0, 0.06, 0]}>
        <boxGeometry args={[w + 0.6, 0.12, d]} />
      </mesh>
      {/* roof */}
      <mesh material={m.corrugatedWhite} castShadow position={[0, h, 0]}>
        <boxGeometry args={[w + 1.0, 0.12, d + 0.5]} />
      </mesh>
      {/* support posts on both sides */}
      {Array.from({ length: nPosts }, (_, i) => {
        const z = -d / 2 + i * (d / (nPosts - 1));
        return [-1, 1].map((side) => (
          <mesh key={`post${i}${side}`} material={m.metalDark} castShadow position={[side * (w / 2 + 0.3), h / 2, z]}>
            <cylinderGeometry args={[0.06, 0.06, h, 6]} />
          </mesh>
        ));
      })}
      {/* horizontal rail along top on both sides */}
      {[-1, 1].map((side) => (
        <mesh key={`rail${side}`} material={m.metalDark} position={[side * (w / 2 + 0.3), h * 0.45, 0]}>
          <boxGeometry args={[0.04, 0.04, d]} />
        </mesh>
      ))}
    </group>
  );
}

/** Compact wastewater treatment: circular clarifier, aeration basin, control building. */
function SewageTreatment({ def, m }: BuilderProps) {
  const [w, h] = def.size;
  const tankR = w * 0.2;
  return (
    <group>
      {/* gravel pad */}
      <mesh material={m.gravel} receiveShadow position={[0, 0.06, 0]}>
        <boxGeometry args={[w, 0.12, w]} />
      </mesh>
      {/* circular clarifier tank */}
      <mesh material={m.concrete} castShadow receiveShadow position={[-w * 0.18, h / 2, -w * 0.15]}>
        <cylinderGeometry args={[tankR, tankR, h, 20, 1, true]} />
      </mesh>
      {/* water surface inside clarifier */}
      <mesh material={m.glass} position={[-w * 0.18, h * 0.8, -w * 0.15]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[tankR - 0.3, 20]} />
      </mesh>
      {/* rotating scraper arm */}
      <mesh material={m.metalDark} position={[-w * 0.18, h + 0.2, -w * 0.15]}>
        <boxGeometry args={[tankR * 1.8, 0.1, 0.15]} />
      </mesh>
      {/* center pier */}
      <mesh material={m.concrete} position={[-w * 0.18, h * 0.6, -w * 0.15]}>
        <cylinderGeometry args={[0.4, 0.4, h * 1.2, 8]} />
      </mesh>
      {/* rectangular aeration basin */}
      <mesh material={m.concrete} castShadow receiveShadow position={[w * 0.18, h * 0.35, -w * 0.15]}>
        <boxGeometry args={[w * 0.32, h * 0.7, w * 0.32]} />
      </mesh>
      <mesh material={m.glass} position={[w * 0.18, h * 0.68, -w * 0.15]} rotation={[-Math.PI / 2, 0, 0]}>
        <boxGeometry args={[w * 0.28, w * 0.28, 0.05]} />
      </mesh>
      {/* control building */}
      <mesh material={m.concreteLight} castShadow receiveShadow position={[w * 0.15, 1.6, w * 0.22]}>
        <boxGeometry args={[6, 3.2, 5]} />
      </mesh>
      <mesh material={m.roofDark} position={[w * 0.15, 3.32, w * 0.22]}>
        <boxGeometry args={[6.4, 0.25, 5.4]} />
      </mesh>
      {/* pipe run between clarifier and aeration basin */}
      <mesh material={m.pvcPipe} position={[0, h * 0.3, -w * 0.15]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.15, 0.15, w * 0.25, 8]} />
      </mesh>
      {/* outlet pipe */}
      <mesh material={m.pvcPipe} position={[-w * 0.18, 0.3, -w * 0.15 + tankR + 1.5]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.12, 0.12, 3, 8]} />
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
    case "hangar-monolith":
      return <MonolithHangar {...props} />;
    case "shelter-row":
      return <ShelterRow {...props} />;
    case "quonset":
      return <Quonset {...props} />;
    case "warehouse":
      return <Warehouse {...props} />;
    case "hq":
      return <HqBuilding {...props} />;
    case "barracks":
      return <Barracks {...props} />;
    case "support":
      return <SupportBuilding {...props} />;
    case "compound-walled":
      return <WalledCompound {...props} />;
    case "guardhouse":
      return <Guardhouse {...props} />;
    case "radome":
      return <Radome {...props} />;
    case "fuel-tank":
      return <FuelTank {...props} />;
    case "solar-array":
      return <SolarArray {...props} />;
    case "water-tower":
      return <WaterTower {...props} />;
    case "comms-shelter":
      return <CommsShelter {...props} />;
    case "transformer-yard":
      return <TransformerYard {...props} />;
    case "guard-tower":
      return <GuardTower {...props} />;
    case "covered-walkway":
      return <CoveredWalkway {...props} />;
    case "sewage-treatment":
      return <SewageTreatment {...props} />;
    case "aircraft-delta":
      return <AircraftDelta {...props} />;
    case "aircraft-fighter":
      return <AircraftFighter {...props} />;
    case "aircraft-j36":
      return <AircraftJ36 {...props} />;
    case "aircraft-jxds":
      return <AircraftJXDS {...props} />;
  }
}

/**
 * A single run of chain-link.
 *
 * The mesh is a plane, not a box: a box shows the wire twice, once through
 * each face, which is what makes a procedural fence read as a moiré rather
 * than as a fence. The tiling lives in the geometry's UVs rather than in the
 * material's `repeat`, so every panel can be a different length while they all
 * share one material — and, more importantly, so the diamonds come out the
 * size of real chain-link (about 50 mm) instead of being stretched to whatever
 * the panel happens to be wide.
 */
function FencePanel({
  material,
  width,
  height,
  position,
  rotation = 0,
}: {
  material: THREE.Material;
  width: number;
  height: number;
  position: [number, number, number];
  rotation?: number;
}) {
  const geometry = useMemo(() => {
    // The texture holds 16 diamonds across and about 11 down; at a 50 mm mesh
    // that is 0.8 m by 0.53 m of real fence per tile.
    const tileW = 0.8;
    const tileH = 0.53;
    const plane = new THREE.PlaneGeometry(width, height);
    const uv = plane.getAttribute("uv");
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, uv.getX(i) * (width / tileW), uv.getY(i) * (height / tileH));
    }
    uv.needsUpdate = true;
    return plane;
  }, [width, height]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={position}
      rotation={[0, rotation, 0]}
      castShadow={false}
      receiveShadow={false}
    />
  );
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
      userData={{ entityId: def.id, structureId: def.id }}
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
  const activeTimelineYear = useTwinStore((s) => s.activeTimelineYear);
  const reducedMotion = useTwinStore((s) => s.reducedMotion);
  const ringRef = useRef<THREE.Mesh>(null);
  const def = selectedId ? getStructure(selectedId) : undefined;

  useFrame((_, delta) => {
    if (!reducedMotion && ringRef.current) ringRef.current.rotation.z += delta * 0.6;
  });

  if (!def || !isVisibleAtTimelineYear(def, activeTimelineYear)) return null;
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
  const activeTimelineYear = useTwinStore((s) => s.activeTimelineYear);
  const visibleStructures = useMemo(
    () =>
      STRUCTURES.filter((structure) =>
        isVisibleAtTimelineYear(structure, activeTimelineYear),
      ),
    [activeTimelineYear],
  );
  return (
    <group name="structures">
      {visibleStructures.map((def) => (
        <StructureNode key={def.id} def={def} m={m} />
      ))}
      <SelectionRing />
    </group>
  );
}
