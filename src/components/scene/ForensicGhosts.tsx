import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { useFrame } from "@react-three/fiber";
import { STRUCTURES, type StructureDef } from "@/lib/layout";
import { terrainHeight } from "@/lib/terrain";
import { createHardSurfaceShaderMaterial } from "@/gfx/greeble";
import {
  useForensicViewState,
  useSubjectPresentation,
  type SubjectPresentation,
} from "@/lib/sceneVisibility";
import type { EvidenceClassification } from "@/lib/evidence";
import { useTwinStore } from "@/lib/store";

/**
 * The schematic layer: everything the model draws but cannot fully stand behind.
 *
 * A subject whose support is weak is not drawn as a faded building here. It is
 * drawn as a *different kind of object* — a translucent shell with its surface
 * eaten away — and the distinction is the whole point. A uniformly transparent
 * building still reads as a building seen through glass; something with holes
 * through it reads as incomplete, which is the accurate impression and the one
 * a screenshot carries.
 *
 * Three constraints shaped the implementation:
 *
 * - **Shared materials cannot carry per-subject opacity.** `Structures.tsx`
 *   deliberately shares about thirty `MeshStandardMaterial`s across the whole
 *   site, so fading one building would mean cloning its materials. Instead the
 *   detailed body is simply not drawn, and a schematic proxy takes its place —
 *   cheaper, and more honest about what it is.
 * - **One draw call per treatment, not per building.** Subjects are bucketed by
 *   the treatment they resolve to (at most six distinct ones exist) and each
 *   bucket's boxes are merged into a single geometry. Forty-five structures
 *   cost a handful of draws, not ninety.
 * - **No React state on the frame loop.** Lift and dissolve are animated by
 *   mutating uniforms and group transforms inside `useFrame`. React sees only
 *   the discrete control changes.
 *
 * The dissolve pattern is keyed to *world* position, so each building erodes
 * differently without any per-object uniform, and the same building always
 * erodes the same way. Nothing here is random.
 */

/* ------------------------------------------------------------------ */
/* Shader                                                              */
/* ------------------------------------------------------------------ */

const GHOST_HEAD = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uBurnColor;
uniform float uOpacity;
uniform float uDissolve;
uniform float uGroundY;

/* Deterministic 3D hash. The same world cell always yields the same value, so
   a building's erosion pattern is stable across frames and across reloads. */
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
`;

const GHOST_FRAGMENT = /* glsl */ `
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 normal = normalize(vWorldNormal);
  float facing = abs(dot(normal, viewDir));
  float fresnel = pow(1.0 - facing, 2.2);

  /* Erosion runs on ~3 m world cells: coarse enough to read as missing
     material at site scale rather than as noise. */
  float cell = hash13(floor(vWorldPos * 0.34));
  if (cell < uDissolve) discard;

  /* A hot rim at the erosion boundary, so the edge of what is missing is
     legible instead of dissolving into the fill. */
  float burn = smoothstep(uDissolve, uDissolve + 0.14, cell);

  /* A world-space lattice, so a shell reads as a measured volume rather than
     as a solid object that happens to be see-through. */
  vec3 grid = abs(fract(vWorldPos * 0.1) - 0.5);
  float lattice = 1.0 - smoothstep(0.0, 0.045, min(min(grid.x, grid.y), grid.z));

  float alpha = uOpacity * (0.18 + 0.72 * fresnel + 0.35 * lattice);
  alpha = mix(alpha * 2.4, alpha, burn);
  if (vWorldPos.y < uGroundY) discard;

  vec3 tint = mix(uBurnColor, uColor, burn);
  gl_FragColor = vec4(tint * (0.55 + 0.75 * fresnel + 0.5 * lattice), clamp(alpha, 0.0, 1.0));
`;

const DROP_FRAGMENT = /* glsl */ `
  /* Drop lines are clipped at the ground plane rather than scaled, so while a
     stratum is gliding to its altitude the line grows to exactly match it. */
  if (vWorldPos.y < uGroundY) discard;
  /* Dashed and faint. They exist to say "this belongs down there", and a solid
     bright line per structure would out-shout the strata they annotate. */
  if (fract((vWorldPos.y - uGroundY) * 0.06) > 0.55) discard;
  float fade = clamp(1.0 - (vWorldPos.y - uGroundY) / 620.0, 0.1, 1.0);
  gl_FragColor = vec4(uColor, uOpacity * fade * 0.22);
`;

const EDGE_FRAGMENT = /* glsl */ `
  gl_FragColor = vec4(uColor, uOpacity);
`;

function makeGhostMaterial(color: string, burnColor: string): THREE.ShaderMaterial {
  const material = createHardSurfaceShaderMaterial({
    head: GHOST_HEAD,
    fragmentBody: GHOST_FRAGMENT,
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uBurnColor: { value: new THREE.Color(burnColor) },
      uOpacity: { value: 0 },
      uDissolve: { value: 0 },
      uGroundY: { value: 0 },
    },
  });
  material.depthWrite = false;
  // Normal blending, not additive. The sky over this site is a bright tan haze
  // and an additive shell drawn against it saturates to white — the layer would
  // be invisible in exactly the framing the stratified view puts it in.
  material.blending = THREE.NormalBlending;
  return material;
}

function makeEdgeMaterial(color: string): THREE.ShaderMaterial {
  const material = createHardSurfaceShaderMaterial({
    head: GHOST_HEAD,
    fragmentBody: EDGE_FRAGMENT,
    transparent: true,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uBurnColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
      uDissolve: { value: 0 },
      uGroundY: { value: 0 },
    },
  });
  material.depthWrite = false;
  return material;
}

function makeDropMaterial(color: string): THREE.ShaderMaterial {
  const material = createHardSurfaceShaderMaterial({
    head: GHOST_HEAD,
    fragmentBody: DROP_FRAGMENT,
    transparent: true,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uBurnColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
      uDissolve: { value: 0 },
      uGroundY: { value: 0 },
    },
  });
  material.depthWrite = false;
  return material;
}

/* ------------------------------------------------------------------ */
/* Buckets                                                             */
/* ------------------------------------------------------------------ */

/**
 * Shell tints, one per evidence layer plus one for the strip-down.
 *
 * Colour is a secondary cue throughout this project and it is secondary here
 * too: the ordinal channel a viewer reads is how much of the shell is *missing*,
 * which survives a monochrome screenshot, and every layer is named in words in
 * the HUD and on `/analysis`.
 */
const LAYER_COLOR: Record<EvidenceClassification, string> = {
  observed: "#4ade80",
  reported: "#38bdf8",
  interpreted: "#fbbf24",
  // Cool rather than neutral grey: the sky over this site is a warm tan haze,
  // and a neutral shell drawn against it disappears.
  illustrative: "#cbd5e1",
};

const STRIPPED_COLOR = "#f87171";
const BURN_COLOR = "#fff3d6";

interface Bucket {
  key: string;
  color: string;
  liftM: number;
  opacity: number;
  dissolve: number;
  structures: StructureDef[];
}

/** One box in world space, at the structure's own position, size and heading. */
function shellBox(structure: StructureDef): THREE.BoxGeometry {
  const [width, height, depth] = structure.size;
  const box = new THREE.BoxGeometry(width, height, depth);
  const [x, z] = structure.position;
  box.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(x, terrainHeight(x, z) + height / 2, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, structure.rotation, 0)),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  return box;
}

/** Boxes merged into one geometry, positioned and rotated in world space. */
function mergeShells(structures: readonly StructureDef[]): THREE.BufferGeometry | null {
  const parts = structures.map(shellBox);
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

/**
 * Silhouettes for the same boxes.
 *
 * The eroded fill on its own reads as confetti at site scale — the holes win
 * and the volume disappears. A crisp wireframe under it is what keeps a shell
 * legible as *a building this project drew* while the surface says the evidence
 * does not support it. Edges survive the dissolve untouched, deliberately: the
 * outline is the model's claim, and the missing surface is the commentary on it.
 */
function mergeShellEdges(
  structures: readonly StructureDef[],
): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const structure of structures) {
    const box = shellBox(structure);
    parts.push(new THREE.EdgesGeometry(box));
    box.dispose();
  }
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

/** One vertical segment per structure, from its base down through the ground. */
function mergeDropLines(
  structures: readonly StructureDef[],
  liftM: number,
): THREE.BufferGeometry | null {
  if (structures.length === 0 || liftM <= 0) return null;
  const positions = new Float32Array(structures.length * 6);
  structures.forEach((structure, index) => {
    const [x, z] = structure.position;
    const base = terrainHeight(x, z);
    const offset = index * 6;
    positions[offset] = x;
    positions[offset + 1] = base;
    positions[offset + 2] = z;
    positions[offset + 3] = x;
    // Reaches below the ground; the shader clips it at the ground plane, which
    // is what makes a gliding stratum's line the right length at every instant.
    positions[offset + 4] = base - liftM;
    positions[offset + 5] = z;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

/**
 * One drawable stratum: merged shells, merged drop lines, and the two materials
 * whose uniforms are animated toward the bucket's target treatment.
 */
function Stratum({ bucket, reduced }: { bucket: Bucket; reduced: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const material = useMemo(
    () => makeGhostMaterial(bucket.color, BURN_COLOR),
    [bucket.color],
  );
  const dropMaterial = useMemo(() => makeDropMaterial(bucket.color), [bucket.color]);
  const edgeMaterial = useMemo(() => makeEdgeMaterial(bucket.color), [bucket.color]);
  const geometry = useMemo(() => mergeShells(bucket.structures), [bucket.structures]);
  const edgeGeometry = useMemo(
    () => mergeShellEdges(bucket.structures),
    [bucket.structures],
  );
  const dropGeometry = useMemo(
    () => mergeDropLines(bucket.structures, bucket.liftM),
    [bucket.structures, bucket.liftM],
  );

  // Start every stratum at the ground and let it rise, so switching into a
  // stratified view reads as the model coming apart rather than as a cut.
  const lift = useRef(reduced ? bucket.liftM : 0);
  const fade = useRef(reduced ? 1 : 0);

  useEffect(
    () => () => {
      material.dispose();
      dropMaterial.dispose();
      edgeMaterial.dispose();
      geometry?.dispose();
      edgeGeometry?.dispose();
      dropGeometry?.dispose();
    },
    [material, dropMaterial, edgeMaterial, geometry, edgeGeometry, dropGeometry],
  );

  useFrame((_, delta) => {
    // Frame-rate independent approach, clamped so a long frame cannot overshoot.
    const step = Math.min(1, delta * (reduced ? 60 : 3.4));
    lift.current += (bucket.liftM - lift.current) * step;
    fade.current += (1 - fade.current) * Math.min(1, delta * 4.2);
    if (groupRef.current) groupRef.current.position.y = lift.current;
    material.uniforms["uOpacity"]!.value = bucket.opacity * fade.current;
    material.uniforms["uDissolve"]!.value = bucket.dissolve;
    edgeMaterial.uniforms["uOpacity"]!.value =
      (0.3 + bucket.opacity * 0.62) * fade.current;
    dropMaterial.uniforms["uOpacity"]!.value = fade.current;
  });

  if (geometry === null) return null;

  return (
    <group ref={groupRef} name={`forensic-stratum-${bucket.key}`}>
      <mesh
        geometry={geometry}
        material={material}
        renderOrder={3}
        frustumCulled={false}
      />
      {edgeGeometry === null ? null : (
        <lineSegments
          geometry={edgeGeometry}
          material={edgeMaterial}
          renderOrder={4}
          frustumCulled={false}
        />
      )}
      {dropGeometry === null ? null : (
        <lineSegments
          geometry={dropGeometry}
          material={dropMaterial}
          renderOrder={2}
          frustumCulled={false}
        />
      )}
    </group>
  );
}

/**
 * The strip-down: everything PROVE IT removes, dissolving out over about a
 * second instead of blinking off.
 *
 * The pause matters. The claim the mode makes is that most of what a viewer was
 * just admiring is undefended, and a cut would read as a rendering glitch —
 * watching it erode is what makes the point land.
 */
function StripDown({ structures }: { structures: readonly StructureDef[] }) {
  const reduced = useTwinStore((state) => state.reducedMotion);
  const material = useMemo(() => makeGhostMaterial(STRIPPED_COLOR, BURN_COLOR), []);
  const geometry = useMemo(() => mergeShells(structures), [structures]);
  const progress = useRef(reduced ? 1 : 0);

  useEffect(
    () => () => {
      material.dispose();
      geometry?.dispose();
    },
    [material, geometry],
  );

  useFrame((_, delta) => {
    progress.current = Math.min(1, progress.current + delta * (reduced ? 6 : 0.95));
    const eased = progress.current * progress.current;
    material.uniforms["uDissolve"]!.value = eased;
    // Brightens as it goes, so the last fragments are the most visible thing on
    // screen at the moment they disappear.
    material.uniforms["uOpacity"]!.value = 0.5 * (1 - eased) + 0.42 * eased;
  });

  if (geometry === null) return null;
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={4}
      frustumCulled={false}
      name="forensic-strip-down"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Layer                                                               */
/* ------------------------------------------------------------------ */

function bucketKey(presentation: SubjectPresentation): string {
  return [
    presentation.classification,
    Math.round(presentation.liftM),
    Math.round(presentation.opacity * 100),
    Math.round(presentation.dissolve * 100),
  ].join("|");
}

export function ForensicGhosts() {
  const present = useSubjectPresentation();
  const { proveIt } = useForensicViewState();
  const qualityTier = useTwinStore((state) => state.qualityTier);
  const reducedMotion = useTwinStore((state) => state.reducedMotion);

  const { buckets, stripped } = useMemo(() => {
    const byKey = new Map<string, Bucket>();
    const removed: StructureDef[] = [];

    for (const structure of STRUCTURES) {
      const presentation = present(structure);
      if (proveIt && !presentation.visible) {
        removed.push(structure);
        continue;
      }
      if (presentation.body !== "ghost") continue;
      const key = bucketKey(presentation);
      const bucket = byKey.get(key);
      if (bucket === undefined) {
        byKey.set(key, {
          key,
          color: LAYER_COLOR[presentation.classification],
          liftM: presentation.liftM,
          opacity: presentation.opacity,
          dissolve: presentation.dissolve,
          structures: [structure],
        });
      } else {
        bucket.structures.push(structure);
      }
    }

    return {
      // Sorted so the render order of the strata is stable between rebuilds.
      buckets: [...byKey.values()].sort((left, right) =>
        left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
      ),
      stripped: removed,
    };
  }, [present, proveIt]);

  // Tier 0 is the constrained-device tier. The information is not withheld —
  // every verdict stays in the dossier, the HUD readout and `/analysis` — only
  // its volumetric rendering, which is the expensive part.
  if (qualityTier < 1) return null;

  return (
    <group name="forensic-ghosts">
      {buckets.map((bucket) => (
        <Stratum key={bucket.key} bucket={bucket} reduced={reducedMotion} />
      ))}
      {proveIt && stripped.length > 0 ? <StripDown structures={stripped} /> : null}
    </group>
  );
}
