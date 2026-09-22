import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32, seededNoise2D } from "@/lib/noise";
import type { Team } from "../core/types";
import { applySoldierShade } from "./soldierShade";
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
 *
 * One material covers the whole mesh. Per-vertex roughness and metalness, plus
 * a cloth weave and lakebed dust, are injected in `soldierShade.ts` so a
 * helmet, a buckle and a sleeve do not share a highlight.
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
  /** Magazine and cargo pouches. Darker than the plate so the chest breaks up. */
  pouch: number;
  boot: number;
  sole: number;
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
    gear: 0x4a4538,
    webbing: 0x8a7f62,
    pouch: 0x2a261c,
    boot: 0x2a261f,
    sole: 0x1f1c18,
    helmet: 0x5f5745,
    skin: 0xa07e64,
    glove: 0x2f2a24,
    lens: 0x1b2a33,
  },
  // Cooler grey-green, so the two sides read apart at 60 m.
  red: {
    camo: [0x5b6150, 0x8b9179, 0x2e3227, 0xa8ad92],
    gear: 0x55574a,
    webbing: 0x6f6d59,
    pouch: 0x3a3c32,
    boot: 0x2c2c28,
    sole: 0x1e1e1c,
    helmet: 0x4a4d43,
    skin: 0x96745c,
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
  _a.set(REST_POS[bone * 3]!, REST_POS[bone * 3 + 1]!, REST_POS[bone * 3 + 2]);
  _b.set(REST_TIP[bone * 3]!, REST_TIP[bone * 3 + 1]!, REST_TIP[bone * 3 + 2]);
  const length = Math.max(0.02, BONE_LENGTH[bone]! + extend);
  const geometry = new THREE.CylinderGeometry(
    radiusEnd,
    radiusStart,
    length,
    segments,
    2,
  );
  // Cap the ends with hemispheres so elbows and knees do not show a rim.
  const capA = new THREE.SphereGeometry(radiusStart, segments, 6);
  capA.translate(0, -length / 2, 0);
  const capB = new THREE.SphereGeometry(radiusEnd, segments, 6);
  capB.translate(0, length / 2, 0);
  const merged = mergeGeometries([geometry, capA, capB], false);
  geometry.dispose();
  capA.dispose();
  capB.dispose();

  // Orient +Y onto the bone axis, then place at the segment midpoint.
  _axis.copy(_b).sub(_a).normalize();
  _quat.setFromUnitVectors(UP, _axis);
  merged.applyQuaternion(_quat);
  merged.translate((_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2);
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

function ball(
  r: number,
  x: number,
  y: number,
  z: number,
  sy = 1,
  sz = 1,
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(r, 14, 10);
  geometry.scale(1, sy, sz);
  geometry.translate(x, y, z);
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

function buildParts(
  palette: Palette,
  rand: () => number,
  variant: SoldierVariant,
): Part[] {
  const parts: Part[] = [];
  const camoBase = palette.camo[0];
  // Roughness is the material class the shade shader splits on:
  // ~0.88 cloth (weave), ~0.72 skin (matte, no weave), ~0.46–0.58 helmet
  // polymer and boot leather, ~0.32 metal, ~0.98 rubber, ~0.12 glass.
  const add = (
    geometry: THREE.BufferGeometry,
    color: number,
    rough?: number,
    metal?: number,
  ): void => {
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
  add(limb(B.foreTwistL, 0.036, 0.033), palette.glove, 0.88);
  add(limb(B.foreTwistR, 0.036, 0.033), palette.glove, 0.88);
  add(limb(B.neck, 0.048, 0.05), palette.skin, 0.72);

  // Torso: three stacked slabs following the spine, narrowing at the waist.
  add(slab(0.31, 0.15, 0.19, 0, 1.0, 0, 0.05), camoBase);
  add(slab(0.34, 0.15, 0.2, 0, 1.13, -0.006, 0.05), camoBase);
  add(slab(0.37, 0.17, 0.21, 0, 1.27, -0.01, 0.055), camoBase);
  // Shoulders.
  add(ball(0.078, -0.155, 1.395, -0.014, 0.9, 0.95), camoBase);
  add(ball(0.078, 0.155, 1.395, -0.014, 0.9, 0.95), camoBase);

  /* ---------------------------------------------------------- head */
  add(ball(0.093, 0, 1.615, 0.004, 1.15, 1.06), palette.skin, 0.72);

  // Face covering, from the bridge of the nose down.
  //
  // This was a *complete* sphere half a millimetre larger than the head, in
  // the darkest tone in the palette — so it did not cover the face, it
  // replaced the head with a black ball, which is exactly what a portrait
  // showed. A partial sphere starting just above the equator leaves the brow
  // and eyes in skin, and that is the whole difference between a soldier and
  // a void under a helmet.
  const mask = new THREE.SphereGeometry(
    0.0945,
    16,
    12,
    0,
    Math.PI * 2,
    Math.PI * 0.53,
    Math.PI * 0.47,
  );
  mask.scale(1, 1.19, 1.09);
  mask.translate(0, 1.615, 0.004);
  add(mask, palette.webbing, 0.9);

  // Brow shadow, a nose, and eye sockets. Three small solids, and between them
  // they are what stop a head reading as a bald sphere at three metres.
  add(ball(0.018, 0, 1.612, -0.085, 1.35, 1.0), palette.skin, 0.72);
  // Recessed, not stuck on. A sphere proud of the skin is a sticker.
  add(ball(0.019, -0.036, 1.633, -0.09, 0.55, 0.4), 0xe8e0d4, 0.42);
  add(ball(0.019, 0.036, 1.633, -0.09, 0.55, 0.4), 0xe8e0d4, 0.42);
  add(ball(0.012, -0.036, 1.635, -0.098, 0.7, 0.52), 0x5a4030, 0.28);
  add(ball(0.012, 0.036, 1.635, -0.098, 0.7, 0.52), 0x5a4030, 0.28);
  add(ball(0.0058, -0.036, 1.637, -0.106, 0.75, 0.55), 0x0a0806, 0.1);
  add(ball(0.0058, 0.036, 1.637, -0.106, 0.75, 0.55), 0x0a0806, 0.1);
  add(ball(0.0032, -0.03, 1.642, -0.11), 0xfff8ee, 0.08);
  add(ball(0.0032, 0.042, 1.642, -0.11), 0xfff8ee, 0.08);
  add(slab(0.026, 0.007, 0.012, -0.036, 1.644, -0.094, 0.0015, -0.4), palette.skin, 0.7);
  add(slab(0.026, 0.007, 0.012, 0.036, 1.644, -0.094, 0.0015, -0.4), palette.skin, 0.7);
  add(slab(0.088, 0.011, 0.018, 0, 1.654, -0.086, 0.003, -0.22), palette.skin, 0.68);

  add(slab(0.145, 0.075, 0.145, 0, 1.567, 0.004, 0.045), palette.webbing, 0.9);
  // Neck gaiter bunched at the collar — tall enough that a skinned head
  // never reads as floating above the kit.
  add(slab(0.14, 0.09, 0.14, 0, 1.495, 0.01, 0.05), palette.webbing, 0.9);
  add(slab(0.12, 0.055, 0.12, 0, 1.545, 0.006, 0.04), 0x3a3830, 0.88);
  // Collar stand behind the gaiter, so the neck is not a bare tube under the helmet.
  add(slab(0.13, 0.078, 0.042, 0, 1.53, 0.086, 0.012), palette.gear, 0.9);

  /* -------------------------------------------------------- helmet */
  // FAST/ACH shell: wider than it is tall, longer front-to-back, crown pulled
  // down. A near-sphere reads as a mannequin head at 8 m even with small
  // accessories stuck to it. The brim, the shroud and the nape are what break
  // that outline, and they only work if they stay clear of the eyes — the rim
  // sits near y = 1.67. Dropping it onto the brow turns the face back into a void.
  const helmetY = 1.69;
  const helm = new THREE.SphereGeometry(0.114, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58);
  // Low crown, long front-to-back. The rim stays near y = 1.67, above the eyes.
  helm.scale(1.14, 0.74, 1.38);
  helm.translate(0, helmetY, 0.006);
  add(helm, palette.helmet, 0.46);
  // Brow brim, tilted so the profile has a peak instead of a circular cut.
  add(slab(0.21, 0.026, 0.07, 0, 1.668, -0.158, 0.006, -0.18), palette.helmet, 0.5);
  // Side rails. Thick enough to step the front silhouette, and metal rather
  // than the shell's matte polymer.
  add(slab(0.022, 0.034, 0.12, -0.142, 1.662, 0.01, 0.004), 0x2c2e28, 0.32, 0.74);
  add(slab(0.022, 0.034, 0.12, 0.142, 1.662, 0.01, 0.004), 0x2c2e28, 0.32, 0.74);
  // NVG shroud: the rectangular bump on the front of a modern helmet.
  add(slab(0.078, 0.062, 0.05, 0, 1.708, -0.168, 0.006), 0x2a2c26, 0.34, 0.7);
  add(slab(0.034, 0.04, 0.02, 0, 1.71, -0.198, 0.004), 0x23241e, 0.3, 0.76);
  // Nape and a flat crown patch, so the shell is not a dome from any side.
  add(slab(0.14, 0.024, 0.04, 0, 1.656, 0.152, 0.006), palette.helmet, 0.5);
  add(slab(0.07, 0.012, 0.09, 0, 1.782, -0.004, 0.003), palette.webbing, 0.9);
  // Counterweight pouch on the rear.
  add(slab(0.1, 0.052, 0.048, 0, 1.668, 0.182, 0.012), palette.pouch, 0.9);
  // Goggles pushed up onto the shell. The lens is glass, not cloth.
  add(slab(0.15, 0.032, 0.036, 0, 1.742, -0.132, 0.008), 0x24261f, 0.4, 0.08);
  add(slab(0.11, 0.016, 0.012, 0, 1.744, -0.152, 0.004), palette.lens, 0.12, 0.12);
  // Headset cups and a boom toward the mouth, not a spike through the skull.
  add(ball(0.038, -0.12, 1.598, 0.012, 0.9, 0.82), 0x2a2b26, 0.55);
  add(ball(0.038, 0.12, 1.598, 0.012, 0.9, 0.82), 0x2a2b26, 0.55);
  add(slab(0.01, 0.01, 0.08, -0.062, 1.582, -0.028, 0.003), 0x2c2d27, 0.42, 0.28);

  /* ---------------------------------------------------- plate carrier */
  // A plate bag, not a slab.
  //
  // The front used to be one 0.33 x 0.34 panel — most of a torso in a single
  // flat facet, which read as a riot shield rather than as kit. What makes a
  // real carrier legible is the *rows*: bands of webbing across it that break
  // a large vertical surface into strips, each catching light at a slightly
  // different angle. Narrower and shorter than before as well, so the
  // camouflage underneath shows at the edges and the torso keeps a waist.
  const plateY = 1.192;
  add(slab(0.3, 0.27, 0.09, 0, plateY, -0.125, 0.026), palette.gear, 0.9);
  add(slab(0.26, 0.22, 0.07, 0, plateY - 0.02, -0.118, 0.022), 0x4a4638, 0.86);
  add(slab(0.3, 0.26, 0.08, 0, plateY - 0.01, 0.12, 0.026), palette.gear, 0.9);
  // PALS rows across the plate. The lower ones end up behind the magazine
  // pouches, which is exactly where they are on the real thing.
  // A darker admin panel and a vertical strap, large enough that a portrait
  // at two metres still shows more than one value after the image is scaled.
  add(slab(0.2, 0.15, 0.018, 0, plateY + 0.02, -0.192, 0.005), 0x1a1814, 0.88);
  add(slab(0.016, 0.22, 0.016, 0, plateY, -0.204, 0.003), 0x12110e, 0.84);
  for (let i = 0; i < 4; i += 1) {
    add(
      slab(0.24, 0.026, 0.014, 0, plateY - 0.09 + i * 0.052, -0.21, 0.004),
      i % 2 === 0 ? palette.webbing : 0x2e2c24,
      0.9,
    );
  }
  // Yoke: the front panel carries over each shoulder to the back panel.
  for (const side of [-1, 1]) {
    add(slab(0.058, 0.05, 0.255, side * 0.107, 1.372, -0.004, 0.018), palette.gear, 0.9);
    // Buckle where the yoke meets the plate. Metal, not nylon.
    add(
      slab(0.05, 0.036, 0.022, side * 0.107, 1.318, -0.182, 0.006),
      0x2a2b26,
      0.36,
      0.62,
    );
  }
  // Cummerbund wrapping the ribs, with a side plate pocket on each flank.
  add(slab(0.355, 0.108, 0.226, 0, 1.048, -0.004, 0.045), palette.webbing, 0.9);
  for (const side of [-1, 1]) {
    add(slab(0.03, 0.15, 0.16, side * 0.178, 1.14, 0.002, 0.02), palette.gear, 0.9);
  }
  // Shoulder caps sit on the trapezius, inboard of the deltoid. A pad out on
  // the upper-arm bone swings up into the helmet when the rifle pose lifts
  // the arm, because those vertices are skinned by proximity.
  add(slab(0.11, 0.045, 0.13, -0.132, 1.39, -0.02, 0.014), palette.gear, 0.9);
  add(slab(0.11, 0.045, 0.13, 0.132, 1.39, -0.02, 0.014), palette.gear, 0.9);
  // Radio antenna off the left shoulder: a thin vertical against the sky is
  // worth more to a silhouette at distance than any amount of surface detail.
  // Antenna off the radio pouch, behind the shoulder. A mast rooted at the
  // neck reads as a spike through the helmet.
  add(slab(0.012, 0.34, 0.012, -0.12, 1.42, 0.21, 0.004), 0x2c2e28, 0.4, 0.45);

  // Four magazine pouches across the chest, each with a flap.
  //
  // These have to stand *proud* of the carrier to exist at all. The carrier's
  // front face is at z = -0.16, and the pouches used to sit at -0.152, which
  // left about two centimetres showing on a 0.34 m panel — so the chest read
  // as one flat dark slab with no kit on it.
  // Three pouches, not four narrow ones. At 8 m the narrow row fused into the
  // plate and the chest went back to being one slab. The flaps are the lighter
  // webbing tone so each pouch has a lit edge.
  for (let i = 0; i < 3; i += 1) {
    const x = -0.092 + i * 0.092;
    add(
      slab(0.08, 0.132, 0.086, x, 1.118, -0.222, 0.012),
      i === 1 ? 0x1c1a14 : palette.pouch,
      0.9,
    );
    add(slab(0.084, 0.04, 0.034, x, 1.182, -0.252, 0.008), palette.webbing, 0.88);
    add(slab(0.018, 0.03, 0.012, x, 1.154, -0.268, 0.004), palette.gear, 0.86);
  }
  // Radio pouch and admin pouch, proud of the back plate.
  add(slab(0.072, 0.12, 0.055, -0.12, 1.22, 0.188, 0.012), palette.pouch, 0.9);
  add(slab(0.096, 0.07, 0.05, 0.12, 1.2, 0.186, 0.012), palette.pouch, 0.9);
  add(limb(B.gearRoot, 0.006, 0.005, 6), 0x2a2b26, 0.45, 0.35);

  /* ----------------------------------------------------------- belt */
  add(slab(0.33, 0.062, 0.24, 0, 0.955, 0, 0.03), palette.webbing, 0.9);
  // Hip pouches offset fore and aft so a side view is not a smooth belt line.
  add(slab(0.078, 0.12, 0.058, 0.12, 0.9, -0.155, 0.014), palette.pouch, 0.9);
  add(slab(0.072, 0.1, 0.05, -0.1, 0.92, 0.155, 0.014), palette.pouch, 0.9);

  /* ------------------------------------------------- elbow / thighs */
  // Pads and cargo pockets break the tube silhouette of the limbs.
  add(slab(0.064, 0.078, 0.046, -0.214, 1.098, 0.022, 0.012), 0x2e2f28, 0.5);
  add(slab(0.064, 0.078, 0.046, 0.214, 1.098, 0.022, 0.012), 0x2e2f28, 0.5);
  for (const side of [-1, 1]) {
    const x = side * 0.1;
    add(slab(0.086, 0.1, 0.042, x, 0.68, -0.092, 0.01), palette.pouch, 0.9);
    add(slab(0.09, 0.026, 0.018, x, 0.728, -0.104, 0.006), palette.gear, 0.88);
  }

  /* ------------------------------------------------------ knee pads */
  add(slab(0.11, 0.11, 0.09, -0.099, 0.5, -0.04, 0.03), 0x2e2f28, 0.5);
  add(slab(0.11, 0.11, 0.09, 0.099, 0.5, -0.04, 0.03), 0x2e2f28, 0.5);

  /* ---------------------------------------------------------- boots */
  for (const side of [-1, 1]) {
    const x = side * 0.1;
    // Ankle cuff, then a boot that tapers toward the toe. It used to be a
    // near-cuboid 0.235 m deep with a bevelled nose, which portraits showed
    // reading as a wedge rather than a boot.
    // Trousers bloused over the boot: wider than the upper, and camo, so the
    // ankle reads as cloth meeting darker leather.
    add(slab(0.112, 0.04, 0.14, x, 0.205, 0.008, 0.02), camoBase, 0.9);
    add(slab(0.102, 0.09, 0.118, x, 0.168, 0.014, 0.026), palette.boot, 0.58);
    add(slab(0.096, 0.088, 0.125, x, 0.098, 0.006, 0.024), palette.boot, 0.58);
    add(slab(0.092, 0.072, 0.2, x, 0.056, -0.05, 0.022), palette.boot, 0.56);
    add(slab(0.072, 0.05, 0.06, x, 0.042, -0.132, 0.018), palette.boot, 0.58);
    add(slab(0.026, 0.07, 0.014, x, 0.11, -0.078, 0.004), 0x3a342c, 0.62);
    // Sole, proud of the upper, with a heel block. Rubber, not leather.
    add(slab(0.1, 0.026, 0.215, x, 0.017, -0.046, 0.008), palette.sole, 0.98);
    add(slab(0.098, 0.03, 0.07, x, 0.03, 0.026, 0.008), palette.sole, 0.98);
  }

  /* ---------------------------------------------------------- hands */
  // Keep the palms as the silhouette anchor, but do not model separate finger
  // chains here. At gameplay distance those chains overlap the held weapon and
  // read as extra hands wrapped around the receiver; the first-person viewmodel
  // owns its own detailed gripping hands.
  add(ball(0.031, -0.184, 0.845, 0, 1.12, 1.24), palette.glove, 0.88);
  add(ball(0.031, 0.184, 0.845, 0, 1.12, 1.24), palette.glove, 0.88);

  /* -------------------------------------------------------- variant */
  if (variant >= 1) {
    // Shoulder patch and a rolled sleeve seam.
    add(slab(0.05, 0.05, 0.012, -0.186, 1.31, -0.05, 0.008), palette.camo[3], 0.9);
  }
  if (variant === 2) {
    // Shemagh bunched at the throat.
    add(ball(0.088, 0, 1.5, 0.02, 0.62, 0.86), palette.camo[2], 0.95);
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
  B.pelvis,
  B.spine1,
  B.spine2,
  B.spine3,
  B.neck,
  B.head,
  B.clavicleL,
  B.upperArmL,
  B.foreArmL,
  B.foreTwistL,
  B.handL,
  B.clavicleR,
  B.upperArmR,
  B.foreArmR,
  B.foreTwistR,
  B.handR,
  B.thighL,
  B.shinL,
  B.footL,
  B.toeL,
  B.thighR,
  B.shinR,
  B.footR,
  B.toeR,
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
      if (d < bestDist[0]) {
        bestDist[3] = bestDist[2]!;
        bestBone[3] = bestBone[2]!;
        bestDist[2] = bestDist[1]!;
        bestBone[2] = bestBone[1]!;
        bestDist[1] = bestDist[0]!;
        bestBone[1] = bestBone[0]!;
        bestDist[0] = d;
        bestBone[0] = bone;
      } else if (d < bestDist[1]) {
        bestDist[3] = bestDist[2]!;
        bestBone[3] = bestBone[2]!;
        bestDist[2] = bestDist[1]!;
        bestBone[2] = bestBone[1]!;
        bestDist[1] = d;
        bestBone[1] = bone;
      } else if (d < bestDist[2]) {
        bestDist[3] = bestDist[2]!;
        bestBone[3] = bestBone[2]!;
        bestDist[2] = d;
        bestBone[2] = bone;
      } else if (d < bestDist[3]) {
        bestDist[3] = d;
        bestBone[3] = bone;
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
  // Blotches sized to the body, not to the texture. The largest band is about
  // 0.25 m across — a torso wide enough for three of them, a limb wide enough
  // for one, which is what a real disruptive pattern does at this scale. It
  // used to be twice that, and a leg is only 0.1 m across, so every limb came
  // out one flat colour.
  //
  // `z` is folded into *both* axes rather than only the second. With `x` alone
  // leading, the front and back of a limb sample the same point and a tapered
  // tube gets a single band all the way round it.
  const s = 7.2;
  const u = x + z * 0.42;
  const v = y + z * 0.55;
  const n =
    blotchLarge(u * s * 0.55, v * s * 0.55) * 0.58 +
    blotchMid(u * s * 1.7, v * s * 1.7) * 0.29 +
    blotchFine(u * s * 4.2, v * s * 4.2) * 0.13;
  const t = n * 0.5 + 0.5;
  // Four hard-edged bands, the way a printed disruptive pattern reads.
  // Band widths, not the four tone values. The pale band has to be large
  // enough to show up on a limb, or the leg averages back to one colour by 8 m.
  const index = t < 0.22 ? 2 : t < 0.46 ? 0 : t < 0.7 ? 1 : 3;
  // setHex already decodes sRGB into the linear working space. A second
  // conversion crushes the four value bands toward black, which is how a
  // disruptive pattern disappears at the range it was built for.
  return out.setHex(palette.camo[index]);
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
        camoColorAt(
          position.getX(v),
          position.getY(v),
          position.getZ(v),
          palette,
          _color,
        );
      } else {
        _color.setHex(part.color);
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

  const merged = mergeGeometries(prepared, false);
  for (const geometry of prepared) geometry.dispose();
  computeSkinning(merged);
  merged.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    name: `soldier-${team}-${variant}`,
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    // Half the sky, not unity. At 1.0 the daytime map still over-fills
    // fabric and the shadow side of a soldier reads as a silhouette no
    // longer — it reads as a lit cutout. Night stays a separate authoring.
    envMapIntensity: 0.5,
  });
  // Per-vertex roughness/metalness, plus a cloth weave and dust. One material,
  // but a rubber sole, a polymer helmet and a glass lens still split under the sun.
  applySoldierShade(material);

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
