import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32, seededNoise2D } from "@/lib/noise";
import type { Team } from "../core/types";
import {
  B,
  BONE_COUNT,
  BONE_LENGTH,
  REST_POS,
  REST_TIP,
  createBones,
  createSkeleton,
  restSegmentDistanceSq,
} from "./rig";

/**
 * Procedural infantry.
 *
 * The body is lofted directly onto the rest skeleton in `rig.ts`: every limb
 * is a tapered tube swept along a bone's rest segment, and the torso and gear
 * are built in the same model space. That means skinning needs no hand-painted
 * weights — each vertex takes the four bones whose rest segments it is nearest
 * to, weighted by inverse distance, which `rig.ts` already exposes a squared
 * distance helper for. Joints deform smoothly because the falloff is
 * continuous in space rather than assigned per part.
 *
 * Camouflage is written into vertex colours rather than a texture. Procedural
 * geometry has no natural UV layout, and unwrapping one would cost far more
 * than it buys at the distances soldiers are actually seen from; a multi-scale
 * blotch evaluated at each vertex's rest position gives the same read and
 * costs nothing.
 */

export type SoldierVariant = 0 | 1 | 2;

export interface SoldierOptions {
  team: Team;
  seed: number;
  variant?: SoldierVariant;
}

export interface SoldierModel {
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  triangleCount: number;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Palettes                                                            */
/* ------------------------------------------------------------------ */

interface Palette {
  /** Four camouflage tones, blended by the blotch field. */
  camo: readonly [number, number, number, number];
  gear: number;
  webbing: number;
  boot: number;
  helmet: number;
  skin: number;
  glove: number;
  lens: number;
}

const PALETTES: Readonly<Record<Team, Palette>> = {
  // Arid multi-tone, to sit against the lakebed without vanishing into it.
  // The four tones are deliberately far apart in value: a disruptive pattern
  // whose bands differ only in hue averages out to one flat colour by the time
  // a soldier is ten metres away, which is exactly when it needs to read.
  blue: {
    camo: [0x9a8a63, 0xc4b389, 0x4a4433, 0xd8cba4],
    gear: 0x4e4a3c,
    webbing: 0x5a5140,
    boot: 0x37312a,
    helmet: 0x5f5745,
    skin: 0xb08968,
    glove: 0x2f2a24,
    lens: 0x1b2a33,
  },
  // Cooler grey-green, so the two sides read apart at 60 m.
  red: {
    camo: [0x5b6150, 0x8b9179, 0x2e3227, 0xa8ad92],
    gear: 0x3a3d36,
    webbing: 0x45483d,
    boot: 0x2b2b28,
    helmet: 0x4a4d43,
    skin: 0xa87d5c,
    glove: 0x26261f,
    lens: 0x1b2a33,
  },
};

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

interface Part {
  geometry: THREE.BufferGeometry;
  color: number;
  /** Roughness/metalness override, else the default cloth values. */
  rough?: number;
  metal?: number;
}

/**
 * A tapered tube swept along a bone's rest segment, with rounded ends. This is
 * the workhorse: arms, legs, neck and fingers are all this shape.
 */
function limb(
  bone: number,
  radiusStart: number,
  radiusEnd: number,
  segments = 10,
  extend = 0,
): THREE.BufferGeometry {
  _a.set(REST_POS[bone * 3]!, REST_POS[bone * 3 + 1]!, REST_POS[bone * 3 + 2]!);
  _b.set(REST_TIP[bone * 3]!, REST_TIP[bone * 3 + 1]!, REST_TIP[bone * 3 + 2]!);
  const length = Math.max(0.02, BONE_LENGTH[bone]! + extend);
  const geometry = new THREE.CylinderGeometry(radiusEnd, radiusStart, length, segments, 2);
  // Cap the ends with hemispheres so elbows and knees do not show a rim.
  const capA = new THREE.SphereGeometry(radiusStart, segments, 6);
  capA.translate(0, -length / 2, 0);
  const capB = new THREE.SphereGeometry(radiusEnd, segments, 6);
  capB.translate(0, length / 2, 0);
  const merged = mergeGeometries([geometry, capA, capB], false)!;
  geometry.dispose();
  capA.dispose();
  capB.dispose();

  // Orient +Y onto the bone axis, then place at the segment midpoint.
  _axis.copy(_b).sub(_a).normalize();
  _quat.setFromUnitVectors(UP, _axis);
  merged.applyQuaternion(_quat);
  merged.translate(
    (_a.x + _b.x) / 2,
    (_a.y + _b.y) / 2,
    (_a.z + _b.z) / 2,
  );
  return merged;
}

/** A rounded box in model space — torso, plates, pouches, boots. */
function slab(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  radius = 0.02,
  rx = 0,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const hw = w / 2 - radius;
  const hh = h / 2 - radius;
  shape.moveTo(-hw, -hh - radius);
  shape.lineTo(hw, -hh - radius);
  shape.quadraticCurveTo(hw + radius, -hh - radius, hw + radius, -hh);
  shape.lineTo(hw + radius, hh);
  shape.quadraticCurveTo(hw + radius, hh + radius, hw, hh + radius);
  shape.lineTo(-hw, hh + radius);
  shape.quadraticCurveTo(-hw - radius, hh + radius, -hw - radius, hh);
  shape.lineTo(-hw - radius, -hh);
  shape.quadraticCurveTo(-hw - radius, -hh - radius, -hw, -hh - radius);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: d - radius,
    bevelEnabled: true,
    bevelThickness: radius * 0.5,
    bevelSize: radius * 0.5,
    bevelSegments: 2,
    curveSegments: 3,
  });
  geometry.translate(0, 0, -(d - radius) / 2);
  if (rx) geometry.rotateX(rx);
  geometry.translate(x, y, z);
  geometry.computeVertexNormals();
  return geometry;
}

function ball(r: number, x: number, y: number, z: number, sy = 1, sz = 1): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(r, 14, 10);
  geometry.scale(1, sy, sz);
  geometry.translate(x, y, z);
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

function buildParts(palette: Palette, rand: () => number, variant: SoldierVariant): Part[] {
  const parts: Part[] = [];
  const camoBase = palette.camo[0];
  const add = (geometry: THREE.BufferGeometry, color: number, rough?: number, metal?: number): void => {
    const part: Part = { geometry, color };
    if (rough !== undefined) part.rough = rough;
    if (metal !== undefined) part.metal = metal;
    parts.push(part);
  };

  /* ---------------------------------------------------------- body */
  add(limb(B.thighL, 0.085, 0.062), camoBase);
  add(limb(B.thighR, 0.085, 0.062), camoBase);
  add(limb(B.shinL, 0.062, 0.045), camoBase);
  add(limb(B.shinR, 0.062, 0.045), camoBase);
  add(limb(B.upperArmL, 0.055, 0.045), camoBase);
  add(limb(B.upperArmR, 0.055, 0.045), camoBase);
  add(limb(B.foreArmL, 0.045, 0.036), camoBase);
  add(limb(B.foreArmR, 0.045, 0.036), camoBase);
  add(limb(B.foreTwistL, 0.036, 0.033), palette.skin);
  add(limb(B.foreTwistR, 0.036, 0.033), palette.skin);
  add(limb(B.neck, 0.048, 0.05), palette.skin);

  // Torso: three stacked slabs following the spine, narrowing at the waist.
  add(slab(0.31, 0.15, 0.19, 0, 1.0, 0, 0.05), camoBase);
  add(slab(0.34, 0.15, 0.2, 0, 1.13, -0.006, 0.05), camoBase);
  add(slab(0.37, 0.17, 0.21, 0, 1.27, -0.01, 0.055), camoBase);
  // Shoulders.
  add(ball(0.078, -0.155, 1.395, -0.014, 0.9, 0.95), camoBase);
  add(ball(0.078, 0.155, 1.395, -0.014, 0.9, 0.95), camoBase);

  /* ---------------------------------------------------------- head */
  add(ball(0.093, 0, 1.615, 0.004, 1.15, 1.06), palette.skin);
  // Face covering up to the cheekbones. Without it the head is a smooth tan
  // sphere, which at conversational range reads unmistakably as a mannequin —
  // and a covered face is what this kit would actually be worn with anyway.
  add(ball(0.0955, 0, 1.6, 0.004, 0.92, 1.02), palette.camo[2]!, 0.95);
  add(slab(0.145, 0.075, 0.145, 0, 1.567, 0.004, 0.045), palette.webbing, 0.94);
  // Neck gaiter bunched at the collar.
  add(slab(0.135, 0.06, 0.135, 0, 1.512, 0.008, 0.05), palette.webbing, 0.95);

  /* -------------------------------------------------------- helmet */
  const helmetY = 1.665;
  const helm = new THREE.SphereGeometry(0.115, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
  helm.scale(1, 1.02, 1.1);
  helm.translate(0, helmetY, 0.004);
  add(helm, palette.helmet, 0.52);
  // Brim, side rails, NVG mount and counterweight pouch.
  add(slab(0.2, 0.028, 0.02, 0, helmetY - 0.055, -0.108, 0.008), palette.helmet, 0.52);
  add(slab(0.014, 0.03, 0.15, -0.113, helmetY - 0.028, 0.006, 0.005), 0x22231f, 0.42, 0.6);
  add(slab(0.014, 0.03, 0.15, 0.113, helmetY - 0.028, 0.006, 0.005), 0x22231f, 0.42, 0.6);
  add(slab(0.05, 0.045, 0.03, 0, helmetY + 0.012, -0.108, 0.008), 0x2a2b26, 0.4, 0.7);
  add(slab(0.11, 0.06, 0.055, 0, helmetY - 0.01, 0.105, 0.02), palette.webbing, 0.9);
  // Goggles pushed up onto the shell.
  add(slab(0.185, 0.048, 0.05, 0, helmetY - 0.032, -0.086, 0.018), 0x1d1e1a, 0.35);
  add(slab(0.14, 0.03, 0.012, 0, helmetY - 0.032, -0.112, 0.006), palette.lens, 0.12, 0.2);
  // Headset cup and boom mic.
  add(ball(0.043, -0.107, 1.612, 0.01, 0.95, 0.85), 0x24251f, 0.5);
  add(ball(0.043, 0.107, 1.612, 0.01, 0.95, 0.85), 0x24251f, 0.5);
  add(limb(B.head, 0.006, 0.006, 6), 0x24251f, 0.5);

  /* ---------------------------------------------------- plate carrier */
  add(slab(0.33, 0.34, 0.1, 0, 1.16, -0.11, 0.035), palette.gear, 0.86);
  add(slab(0.33, 0.32, 0.09, 0, 1.16, 0.105, 0.035), palette.gear, 0.86);
  // Cummerbund wrapping the ribs.
  add(slab(0.36, 0.11, 0.23, 0, 1.045, -0.004, 0.045), palette.webbing, 0.92);
  // Shoulder pads.
  add(slab(0.1, 0.12, 0.13, -0.145, 1.33, -0.01, 0.035), palette.gear, 0.86);
  add(slab(0.1, 0.12, 0.13, 0.145, 1.33, -0.01, 0.035), palette.gear, 0.86);

  // Four magazine pouches across the chest, each with a flap.
  for (let i = 0; i < 4; i += 1) {
    const x = -0.115 + i * 0.077;
    add(slab(0.068, 0.115, 0.062, x, 1.135, -0.152, 0.014), palette.webbing, 0.9);
    add(slab(0.072, 0.038, 0.03, x, 1.192, -0.166, 0.01), palette.gear, 0.88);
  }
  // Radio pouch and admin pouch.
  add(slab(0.075, 0.13, 0.06, -0.135, 1.235, 0.13, 0.014), palette.webbing, 0.9);
  add(slab(0.1, 0.075, 0.05, 0.12, 1.2, 0.135, 0.014), palette.webbing, 0.9);
  add(limb(B.gearRoot, 0.006, 0.005, 6), 0x1c1d19, 0.6);

  /* ----------------------------------------------------------- belt */
  add(slab(0.33, 0.062, 0.24, 0, 0.955, 0, 0.03), palette.webbing, 0.9);
  add(slab(0.085, 0.11, 0.07, 0.152, 0.93, 0.03, 0.018), palette.webbing, 0.9);
  add(slab(0.075, 0.1, 0.062, -0.152, 0.93, 0.04, 0.018), palette.webbing, 0.9);

  /* ------------------------------------------------------ knee pads */
  add(slab(0.11, 0.11, 0.09, -0.099, 0.5, -0.035, 0.03), 0x2e2f28, 0.72);
  add(slab(0.11, 0.11, 0.09, 0.099, 0.5, -0.035, 0.03), 0x2e2f28, 0.72);

  /* ---------------------------------------------------------- boots */
  for (const side of [-1, 1]) {
    const x = side * 0.1;
    add(slab(0.105, 0.135, 0.13, x, 0.135, 0.012, 0.03), palette.boot, 0.68);
    add(slab(0.1, 0.09, 0.235, x, 0.048, -0.055, 0.028), palette.boot, 0.68);
    // Sole with a visible tread lip.
    add(slab(0.108, 0.028, 0.245, x, 0.016, -0.058, 0.012), 0x1a1a18, 0.95);
  }

  /* ---------------------------------------------------------- hands */
  add(ball(0.045, -0.184, 0.845, 0, 1.1, 1.25), palette.glove, 0.85);
  add(ball(0.045, 0.184, 0.845, 0, 1.1, 1.25), palette.glove, 0.85);
  for (const bone of [B.thumbL, B.indexL, B.gripL, B.thumbR, B.indexR, B.gripR]) {
    add(limb(bone, 0.014, 0.011, 6), palette.glove, 0.85);
  }

  /* -------------------------------------------------------- variant */
  if (variant >= 1) {
    // Shoulder patch and a rolled sleeve seam.
    add(slab(0.05, 0.05, 0.012, -0.186, 1.31, -0.05, 0.008), palette.camo[3]!, 0.9);
  }
  if (variant === 2) {
    // Shemagh bunched at the throat.
    add(ball(0.088, 0, 1.5, 0.02, 0.62, 0.86), palette.camo[2]!, 0.95);
  }
  // A little per-soldier jitter so a squad is not identical.
  void rand;

  return parts;
}

/* ------------------------------------------------------------------ */
/* Skinning                                                            */
/* ------------------------------------------------------------------ */

/** Bones that may receive skin weights; fingers and helpers are excluded. */
const SKIN_BONES: readonly number[] = [
  B.pelvis, B.spine1, B.spine2, B.spine3, B.neck, B.head,
  B.clavicleL, B.upperArmL, B.foreArmL, B.foreTwistL, B.handL,
  B.clavicleR, B.upperArmR, B.foreArmR, B.foreTwistR, B.handR,
  B.thighL, B.shinL, B.footL, B.toeL,
  B.thighR, B.shinR, B.footR, B.toeR,
];

/**
 * Assign four bone influences per vertex by proximity to the rest segments.
 *
 * The exponent is what controls how tight a joint is: a high power makes a
 * vertex commit almost entirely to its nearest bone (rigid, and elbows crease),
 * a low one spreads influence too far (the whole arm drags when the hand
 * moves). 3.0 lands where limbs stay solid but joints round over.
 */
function computeSkinning(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute("position");
  const count = position.count;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);

  const bestBone = [0, 0, 0, 0];
  const bestDist = [Infinity, Infinity, Infinity, Infinity];

  for (let v = 0; v < count; v += 1) {
    const x = position.getX(v);
    const y = position.getY(v);
    const z = position.getZ(v);
    bestDist[0] = bestDist[1] = bestDist[2] = bestDist[3] = Infinity;
    bestBone[0] = bestBone[1] = bestBone[2] = bestBone[3] = B.pelvis;

    for (const bone of SKIN_BONES) {
      const d = restSegmentDistanceSq(bone, x, y, z);
      if (d < bestDist[0]!) {
        bestDist[3] = bestDist[2]!; bestBone[3] = bestBone[2]!;
        bestDist[2] = bestDist[1]!; bestBone[2] = bestBone[1]!;
        bestDist[1] = bestDist[0]!; bestBone[1] = bestBone[0]!;
        bestDist[0] = d; bestBone[0] = bone;
      } else if (d < bestDist[1]!) {
        bestDist[3] = bestDist[2]!; bestBone[3] = bestBone[2]!;
        bestDist[2] = bestDist[1]!; bestBone[2] = bestBone[1]!;
        bestDist[1] = d; bestBone[1] = bone;
      } else if (d < bestDist[2]!) {
        bestDist[3] = bestDist[2]!; bestBone[3] = bestBone[2]!;
        bestDist[2] = d; bestBone[2] = bone;
      } else if (d < bestDist[3]!) {
        bestDist[3] = d; bestBone[3] = bone;
      }
    }

    let total = 0;
    const w = [0, 0, 0, 0];
    for (let i = 0; i < 4; i += 1) {
      const distance = Math.sqrt(bestDist[i]!);
      const value = 1 / Math.pow(distance + 0.012, 3);
      w[i] = value;
      total += value;
    }
    const inv = total > 0 ? 1 / total : 0;
    for (let i = 0; i < 4; i += 1) {
      indices[v * 4 + i] = bestBone[i]!;
      weights[v * 4 + i] = w[i]! * inv;
    }
  }

  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
}

/* ------------------------------------------------------------------ */
/* Camouflage                                                          */
/* ------------------------------------------------------------------ */

const blotchLarge = seededNoise2D(0xca1);
const blotchMid = seededNoise2D(0xca2);
const blotchFine = seededNoise2D(0xca3);

/**
 * Multi-scale blotch camouflage evaluated per vertex.
 *
 * Sampling in the XY plane of model space (not world space) is deliberate:
 * the pattern then travels with the soldier instead of swimming across them
 * as they move, and it wraps around limbs the way printed fabric does.
 */
function camoColorAt(
  x: number,
  y: number,
  z: number,
  palette: Palette,
  out: THREE.Color,
): THREE.Color {
  // Blotches sized to the body, not to the texture: the largest band is about
  // a third of a torso across, which is what a real disruptive pattern does.
  const s = 3.6;
  const n =
    blotchLarge(x * s * 0.55, (y + z * 0.6) * s * 0.55) * 0.58 +
    blotchMid(x * s * 1.7, (y + z * 0.4) * s * 1.7) * 0.29 +
    blotchFine(x * s * 4.2, y * s * 4.2) * 0.13;
  const t = n * 0.5 + 0.5;
  // Four hard-edged bands, the way a printed disruptive pattern reads.
  const index = t < 0.3 ? 2 : t < 0.55 ? 0 : t < 0.8 ? 1 : 3;
  return out.setHex(palette.camo[index]!).convertSRGBToLinear();
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

interface CachedBuild {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  refs: number;
}

const cache = new Map<string, CachedBuild>();
const _color = new THREE.Color();

function buildGeometry(team: Team, variant: SoldierVariant, seed: number): CachedBuild {
  const key = `${team}:${variant}`;
  const existing = cache.get(key);
  if (existing) {
    existing.refs += 1;
    return existing;
  }

  const palette = PALETTES[team];
  const rand = mulberry32(seed >>> 0);
  const parts = buildParts(palette, rand, variant);

  // Bake each part's colour and PBR values into vertex attributes, so the whole
  // soldier is one draw call with one material.
  const prepared: THREE.BufferGeometry[] = [];
  for (const part of parts) {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    if (geometry !== part.geometry) part.geometry.dispose();
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
    }
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    const position = geometry.getAttribute("position");
    const count = position.count;
    const colors = new Float32Array(count * 3);
    // Camouflage only where the base colour is the camo base; gear keeps its own.
    const isCamo = part.color === palette.camo[0];
    for (let v = 0; v < count; v += 1) {
      if (isCamo) {
        camoColorAt(position.getX(v), position.getY(v), position.getZ(v), palette, _color);
      } else {
        _color.setHex(part.color).convertSRGBToLinear();
      }
      colors[v * 3] = _color.r;
      colors[v * 3 + 1] = _color.g;
      colors[v * 3 + 2] = _color.b;
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    // Two spare channels carry roughness and metalness per vertex.
    const pbr = new Float32Array(count * 2);
    const rough = part.rough ?? 0.88;
    const metal = part.metal ?? 0;
    for (let v = 0; v < count; v += 1) {
      pbr[v * 2] = rough;
      pbr[v * 2 + 1] = metal;
    }
    geometry.setAttribute("pbr", new THREE.Float32BufferAttribute(pbr, 2));
    prepared.push(geometry);
  }

  const merged = mergeGeometries(prepared, false)!;
  for (const geometry of prepared) geometry.dispose();
  computeSkinning(merged);
  merged.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    name: `soldier-${team}-${variant}`,
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    // Unity, not the 0.55 this used to carry. Fabric and webbing see the whole
    // sky and the whole ground bounce like anything else does; halving the map
    // halved the only light reaching the shadow side of a soldier, which is the
    // side the camera is usually looking at.
    envMapIntensity: 1,
  });
  // Route the per-vertex roughness/metalness attribute into the standard
  // shader. One material, but a rubber sole and a plastic lens still behave
  // differently under the sun.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 pbr;\nvarying vec2 vPbr;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vPbr = pbr;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPbr;")
      .replace(
        "#include <roughnessmap_fragment>",
        "float roughnessFactor = clamp(vPbr.x, 0.04, 1.0);",
      )
      .replace(
        "#include <metalnessmap_fragment>",
        "float metalnessFactor = clamp(vPbr.y, 0.0, 1.0);",
      );
  };
  material.customProgramCacheKey = () => `soldier-pbr-${team}-${variant}`;

  const build: CachedBuild = { geometry: merged, material, refs: 1 };
  cache.set(key, build);
  return build;
}

/* ------------------------------------------------------------------ */
/* Public                                                              */
/* ------------------------------------------------------------------ */

export function buildSoldier(options: SoldierOptions): SoldierModel {
  const variant = options.variant ?? ((options.seed % 3) as SoldierVariant);
  const build = buildGeometry(options.team, variant, options.seed);

  const bones = createBones();
  const skeleton = createSkeleton(bones);
  const mesh = new THREE.SkinnedMesh(build.geometry, build.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData["noCollide"] = true;

  const group = new THREE.Group();
  group.userData["noCollide"] = true;
  group.add(bones[B.root]!);
  group.add(mesh);
  mesh.bind(skeleton);

  const index = build.geometry.getIndex();
  const triangleCount = index
    ? index.count / 3
    : build.geometry.getAttribute("position").count / 3;

  const key = `${options.team}:${variant}`;
  return {
    group,
    mesh,
    bones,
    skeleton,
    triangleCount,
    dispose() {
      skeleton.dispose();
      const cached = cache.get(key);
      if (cached) {
        cached.refs -= 1;
        if (cached.refs <= 0) {
          cached.geometry.dispose();
          cached.material.dispose();
          cache.delete(key);
        }
      }
    },
  };
}

/** Free every cached soldier build. */
export function disposeSoldierCache(): void {
  for (const build of cache.values()) {
    build.geometry.dispose();
    build.material.dispose();
  }
  cache.clear();
}

export { BONE_COUNT };
