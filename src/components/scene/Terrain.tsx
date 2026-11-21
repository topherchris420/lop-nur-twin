import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { SITE_SIZE, TERRAIN_ENTITY_ID } from "@/lib/layout";
import { flattenFactor, rawHeight } from "@/lib/terrain";
import { makeGroundNormalTexture, makeLakebedColorTexture } from "@/lib/textures";
import { applyGroundDetailPreset, groundDetailFor } from "@/gfx/groundDetail";
import { SITE_SEED } from "@/lib/noise";
import { lakebedColor, PLAIN_COLOR } from "@/gfx/lakebed";
import { useTwinStore, type QualityTier } from "@/lib/store";
import { getQualityProfile } from "@/lib/quality";

const FLOOR_SIZE = 40_000;
const geometryCache = new Map<number, THREE.PlaneGeometry>();

/** Vertices between yields, about 12 ms of work on a Snapdragon X laptop. */
const VERTICES_PER_STEP = 8192;

/**
 * The terrain mesh, one step at a time. There is one path through this whether it
 * is drained in a single call or across many tasks, so the mesh cannot depend on
 * how it was built.
 */
function* terrainGeometrySteps(segments: number): Generator<void, THREE.PlaneGeometry> {
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
    const height = rawHeight(x, z);
    pos.setY(i, height * flat);
    compact[i] = 1 - flat;

    lakebedColor(scratch, x, z, height, flat);
    // Dissolve the last few hundred metres into the lower-resolution plain.
    const edge = Math.max(Math.abs(x), Math.abs(z)) / (SITE_SIZE / 2);
    scratch.lerp(PLAIN_COLOR, THREE.MathUtils.smoothstep(edge, 0.82, 1));

    colors[i * 3] = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;

    if ((i + 1) % VERTICES_PER_STEP === 0) yield;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("gdCompact", new THREE.BufferAttribute(compact, 1));
  geo.computeVertexNormals();
  return geo;
}

/** Builds the mesh in one go. Used when nothing got the chance to prebuild it. */
export function buildTerrainGeometry(segments: number): THREE.PlaneGeometry {
  const steps = terrainGeometrySteps(segments);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

function getTerrainGeometry(segments: number): THREE.PlaneGeometry {
  const cached = geometryCache.get(segments);
  if (cached) return cached;
  const geometry = buildTerrainGeometry(segments);
  geometryCache.set(segments, geometry);
  return geometry;
}

/**
 * Builds the mesh a tier needs without holding the main thread, yielding between
 * steps. The top tier's mesh is otherwise a few hundred milliseconds in one task.
 */
export async function prebuildTerrainGeometry(segments: number): Promise<void> {
  if (geometryCache.has(segments)) return;
  const steps = terrainGeometrySteps(segments);
  let step = steps.next();
  while (!step.done) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    step = steps.next();
  }
  geometryCache.set(segments, step.value);
}

/**
 * Everything the terrain's first render would otherwise build at once, built ahead
 * of it in small tasks. The terrain then finds it all in the caches.
 */
export async function prebuildTerrainAssets(tier: QualityTier): Promise<void> {
  await prebuildTerrainGeometry(getQualityProfile(tier).terrainSegments);
  for (const family of ["desert", "pavement"] as const) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    groundDetailFor(tier, family);
  }
}

export function Terrain() {
  const qualityTier = useTwinStore((state) => state.qualityTier);
  const reducedMotion = useTwinStore((state) => state.reducedMotion);
  const segments = getQualityProfile(qualityTier).terrainSegments;
  const geometry = useMemo(() => getTerrainGeometry(segments), [segments]);

  useEffect(() => {
    const warmTiers: QualityTier[] = [];
    if (qualityTier > 0) warmTiers.push((qualityTier - 1) as QualityTier);
    if (!reducedMotion && qualityTier < 3)
      warmTiers.push((qualityTier + 1) as QualityTier);
    // The adaptive ladder steps up as well as down, and both the terrain
    // geometry and the ground detail maps are a couple of hundred milliseconds
    // of main-thread work at the top tier. Warm the neighbouring tier's
    // versions of both on idle so a step never lands as a stall.
    const jobs: Array<() => void | Promise<void>> = [];
    for (const tier of warmTiers) {
      const profile = getQualityProfile(tier);
      jobs.push(() => prebuildTerrainGeometry(profile.terrainSegments));
      if (profile.groundDetailSize > 0) {
        // Building the maps is what costs; `groundDetailFor` caches them. One job
        // each, as the top tier's two together are a long task of their own.
        jobs.push(() => void groundDetailFor(tier, "desert"));
        jobs.push(() => void groundDetailFor(tier, "pavement"));
      }
    }
    let cancelled = false;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

    const warmNext = () => {
      const next = jobs.shift();
      if (cancelled || next === undefined) return;
      const build = async () => {
        if (cancelled) return;
        await next();
        warmNext();
      };
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(() => void build(), { timeout: 1500 });
      } else {
        timeoutId = globalThis.setTimeout(() => void build(), 150);
      }
    };

    warmNext();
    return () => {
      cancelled = true;
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
    };
  }, [qualityTier, reducedMotion, segments]);

  const lakebedMap = useMemo(() => {
    const tex = makeLakebedColorTexture(SITE_SEED + 79);
    tex.repeat.setScalar(SITE_SIZE / 760);
    return tex;
  }, []);
  useEffect(() => () => lakebedMap.dispose(), [lakebedMap]);

  // The same sediment tile continues across the edge at the same scale and
  // phase. Cloning a Texture shares its image; no second canvas is painted.
  const floorMap = useMemo(() => {
    const map = lakebedMap.clone();
    map.repeat.setScalar(FLOOR_SIZE / 760);
    map.offset.setScalar((SITE_SIZE - FLOOR_SIZE) / (2 * 760));
    return map;
  }, [lakebedMap]);
  useEffect(() => () => floorMap.dispose(), [floorMap]);

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
      map: lakebedMap,
      roughness: 0.96,
      metalness: 0,
      normalMap,
      normalScale: new THREE.Vector2(0.25, 0.25),
    });
    return applyGroundDetailPreset(mat, qualityTier, "desert", {
      compactAttribute: true,
    });
  }, [lakebedMap, normalMap, qualityTier]);

  useEffect(() => () => material.dispose(), [material]);

  return (
    <group name="terrain" userData={{ entityId: TERRAIN_ENTITY_ID }}>
      {/* Distant desert floor: a large flat plane sitting just below the
          detailed terrain so the plain reads as endless and no hard mesh
          edge shows at the horizon (it only appears beyond the detail ring
          and fades into the haze). */}
      <mesh position={[0, -6, 0]} rotation={[-Math.PI / 2, 0, 0]} name="desert-floor">
        <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
        <meshStandardMaterial
          color={PLAIN_COLOR}
          map={floorMap}
          roughness={1}
          metalness={0}
        />
      </mesh>
      <mesh geometry={geometry} material={material} receiveShadow name="terrain-detail" />
    </group>
  );
}
