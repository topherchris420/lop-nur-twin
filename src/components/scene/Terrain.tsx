import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { SITE_SIZE, TERRAIN_ENTITY_ID } from "@/lib/layout";
import { flattenFactor, gravelField, mottle, rawHeight, wadiMask } from "@/lib/terrain";
import { makeGroundNormalTexture } from "@/lib/textures";
import { applyGroundDetailPreset, groundDetailFor } from "@/gfx/groundDetail";
import { SITE_SEED } from "@/lib/noise";
import { useTwinStore, type QualityTier } from "@/lib/store";
import { getQualityProfile } from "@/lib/quality";

/** Lop Nur / Gobi palette: tan lakebed, darker desert-pavement gravel,
 *  pale dry playa, and slightly damp-looking dry-wash channels. */
const C_DARK = new THREE.Color("#7c7660");
const C_BASE = new THREE.Color("#a99e80");
const C_DUST = new THREE.Color("#cabc98");
const C_GRAVEL = new THREE.Color("#6c6653");
const C_PLAYA = new THREE.Color("#c8c0a4");
const C_WADI = new THREE.Color("#867753");
const C_COMPACT = new THREE.Color("#bcb094");

const geometryCache = new Map<number, THREE.PlaneGeometry>();

function buildTerrainGeometry(segments: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(SITE_SIZE, SITE_SIZE, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  if (!pos) return geo;
  const colors = new Float32Array(pos.count * 3);
  // `flattenFactor` is 0 exactly where pavement has levelled the ground, so
  // its complement doubles as a "this has been bladed flat" mask. The detail
  // shader reads it to calm the pebble grain on graded hardstanding, which is
  // a different surface from untouched lakebed even where the colour matches.
  const compact = new Float32Array(pos.count);
  const scratch = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const flat = flattenFactor(x, z);
    pos.setY(i, rawHeight(x, z) * flat);
    compact[i] = 1 - flat;

    const m = mottle(x, z);
    const t = THREE.MathUtils.clamp(m * 0.5 + 0.5, 0, 1);
    scratch.lerpColors(C_DARK, C_BASE, THREE.MathUtils.smoothstep(t, 0.1, 0.9));
    scratch.lerp(C_DUST, Math.pow(Math.max(0, m), 2.2) * 0.5);
    scratch.lerp(C_GRAVEL, gravelField(x, z) * 0.6);
    scratch.lerp(C_PLAYA, THREE.MathUtils.smoothstep(t, 0.82, 1) * 0.5);
    scratch.lerp(C_WADI, wadiMask(x, z) * 0.55);
    scratch.lerp(C_COMPACT, (1 - flat) * 0.5);

    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("gdCompact", new THREE.BufferAttribute(compact, 1));
  geo.computeVertexNormals();
  return geo;
}

function getTerrainGeometry(segments: number): THREE.PlaneGeometry {
  const cached = geometryCache.get(segments);
  if (cached) return cached;
  const geometry = buildTerrainGeometry(segments);
  geometryCache.set(segments, geometry);
  return geometry;
}

export function Terrain() {
  const qualityTier = useTwinStore((state) => state.qualityTier);
  const reducedMotion = useTwinStore((state) => state.reducedMotion);
  const segments = getQualityProfile(qualityTier).terrainSegments;
  const geometry = useMemo(() => getTerrainGeometry(segments), [segments]);

  useEffect(() => {
    const warmTiers: QualityTier[] = [];
    if (qualityTier > 0) warmTiers.push((qualityTier - 1) as QualityTier);
    if (!reducedMotion && qualityTier < 2)
      warmTiers.push((qualityTier + 1) as QualityTier);
    // The adaptive ladder steps up as well as down, and both the terrain
    // geometry and the ground detail maps are a couple of hundred milliseconds
    // of main-thread work at the top tier. Warm the neighbouring tier's
    // versions of both on idle so a step never lands as a stall.
    const jobs: Array<() => void> = [];
    for (const tier of warmTiers) {
      const profile = getQualityProfile(tier);
      jobs.push(() => getTerrainGeometry(profile.terrainSegments));
      if (profile.groundDetailSize > 0) {
        jobs.push(() => {
          // Building the maps is what costs;  caches them.
          groundDetailFor(tier, "desert");
          groundDetailFor(tier, "pavement");
        });
      }
    }
    let cancelled = false;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

    const warmNext = () => {
      const next = jobs.shift();
      if (cancelled || next === undefined) return;
      const build = () => {
        if (cancelled) return;
        next();
        warmNext();
      };
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(build, { timeout: 1500 });
      } else {
        timeoutId = globalThis.setTimeout(build, 150);
      }
    };

    warmNext();
    return () => {
      cancelled = true;
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
    };
  }, [qualityTier, reducedMotion, segments]);

  const normalMap = useMemo(() => {
    const tex = makeGroundNormalTexture(SITE_SEED + 7);
    tex.repeat.set(320, 320);
    return tex;
  }, []);

  useEffect(() => () => normalMap.dispose(), [normalMap]);

  // The vertex colours and the 21 m normal map are the aerial half of this
  // surface; `applyGroundDetailPreset` adds the metre-and-below half, faded
  // out well before any altitude the twin route flies at.
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
      normalMap,
      normalScale: new THREE.Vector2(0.4, 0.4),
    });
    return applyGroundDetailPreset(mat, qualityTier, "desert", {
      compactAttribute: true,
    });
  }, [normalMap, qualityTier]);

  useEffect(() => () => material.dispose(), [material]);

  return (
    <group name="terrain" userData={{ entityId: TERRAIN_ENTITY_ID }}>
      {/* Distant desert floor: a large flat plane sitting just below the
          detailed terrain so the plain reads as endless and no hard mesh
          edge shows at the horizon (it only appears beyond the detail ring
          and fades into the haze). */}
      <mesh position={[0, -6, 0]} rotation={[-Math.PI / 2, 0, 0]} name="desert-floor">
        <planeGeometry args={[40000, 40000]} />
        <meshStandardMaterial color="#9a8f77" roughness={1} metalness={0} />
      </mesh>
      <mesh geometry={geometry} material={material} receiveShadow name="terrain-detail" />
    </group>
  );
}
