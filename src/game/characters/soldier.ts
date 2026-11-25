import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { seededNoise2D } from "@/lib/noise";
import type { Team } from "../core/types";
import {
  applySoldierShade,
  SOLDIER_MAT,
  type CamoPalette,
  type SoldierMat,
} from "./soldierShade";
import { B, BONE_COUNT, createBones, createSkeleton, restSegmentDistanceSq } from "./rig";
import { AO_GROUP, bakeOcclusion, type AoGroup } from "./soldierBake";
import {
  bendY,
  clean,
  cylinder,
  ellipsoid,
  place,
  rbox,
  strap,
  sweep,
  weld,
  type SweepRing,
  type V3,
} from "./soldierGeometry";

/**
 * Procedural infantry.
 *
 * The body is built directly on the rest skeleton in `rig.ts` and dressed in
 * layers, the way the real thing is: a combat shirt and trousers lofted from
 * anatomical cross-sections with their folds pushed into the geometry, then a
 * plate carrier, cummerbund, pouches, battle belt, knee pads, gloves and
 * boots on top, then a helmet with its rails, shroud, counterweight and
 * headset. What makes a soldier read at gameplay range is that layering — a
 * silhouette stepped by kit — and none of it survives if the body underneath
 * is a stack of capsules, so the limbs carry a real profile (deltoid, calf,
 * a bloused trouser cuff) rather than a taper.
 *
 * Skinning is by proximity to the rest bones, as before, but each part names
 * the bones it may follow. Proximity alone let a magazine pouch on the plate
 * follow the upper arm beside it, which is how the plate carrier came apart
 * into shards whenever a soldier raised his rifle. Rigid kit (plates, pouches,
 * helmet furniture) takes one set of weights from its centroid so it moves as
 * a solid; cloth takes them per vertex so joints bend.
 *
 * Material classes, camouflage and a per-vertex occlusion/convexity bake ride
 * along as vertex attributes; `soldierShade.ts` turns them into ripstop,
 * cordura, webbing, polymer, rubber and skin. One geometry, one material, one
 * draw call per soldier.
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
/* Kits                                                                */
/* ------------------------------------------------------------------ */

interface Kit {
  camo: CamoPalette;
  /** Body of the combat shirt under the carrier: a solid, not the print. */
  shirt: number;
  gear: number;
  /** Carrier and pouches printed with the uniform's pattern. */
  gearCamo: boolean;
  webbing: number;
  helmet: number;
  /** Helmet wears a cloth cover in the uniform's print. */
  helmetCover: boolean;
  hardware: number;
  boot: number;
  bootMat: SoldierMat;
  sole: number;
  glove: number;
  palm: number;
  pad: number;
  mag: number;
  headset: number;
  /** Lower face: a gaiter over skin, or a full balaclava. */
  face: "gaiter" | "balaclava";
  faceCloth: number;
  skin: number;
  /** A tall whip antenna off the back: a vertical against the sky. */
  antenna: boolean;
  /** An assault pack: a deeper back silhouette. */
  pack: boolean;
  /** Pistol on a drop-leg platform rather than the belt. */
  dropLeg: boolean;
}

const KITS: Readonly<Record<Team, Kit>> = {
  // Arid multi-tone print with coyote nylon: the pale side. Read at range by
  // value (light) and by the antenna, drop-leg and covered helmet.
  blue: {
    camo: [0xa89676, 0x7b6a50, 0x6f6d51, 0x473a2c, 0xcbbd9b],
    shirt: 0x9c8b6c,
    gear: 0x7a6a4f,
    gearCamo: false,
    webbing: 0x6c5c45,
    helmet: 0x8a7a5c,
    helmetCover: true,
    hardware: 0x2b2a27,
    boot: 0x8d7759,
    bootMat: SOLDIER_MAT.suede,
    sole: 0x3a332b,
    glove: 0x7d6c52,
    palm: 0x4a4034,
    pad: 0x6e604a,
    mag: 0x5f5444,
    headset: 0x5b5544,
    face: "gaiter",
    faceCloth: 0x8f7f63,
    skin: 0x9c7860,
    antenna: true,
    pack: false,
    dropLeg: true,
  },
  // Ranger green over a near-black print, black hardware and a balaclava:
  // the dark side, with a pack and a bare polymer helmet for a different
  // outline as well as a different value.
  red: {
    camo: [0x3b3f36, 0x2a2d27, 0x4d5244, 0x1d1f1b, 0x5d6253],
    shirt: 0x2f322c,
    gear: 0x434936,
    gearCamo: false,
    webbing: 0x383d2e,
    helmet: 0x2a2b29,
    helmetCover: false,
    hardware: 0x1e1f1e,
    boot: 0x262624,
    bootMat: SOLDIER_MAT.leather,
    sole: 0x1c1c1b,
    glove: 0x262725,
    palm: 0x1d1e1c,
    pad: 0x252624,
    mag: 0x232322,
    headset: 0x262724,
    face: "balaclava",
    faceCloth: 0x242522,
    skin: 0x8f6c55,
    antenna: false,
    pack: true,
    dropLeg: false,
  },
};

/* ------------------------------------------------------------------ */
/* Parts                                                               */
/* ------------------------------------------------------------------ */

interface Part {
  geometry: THREE.BufferGeometry;
  color: number;
  mat: SoldierMat;
  rough: number;
  metal: number;
  camo: boolean;
  /** Bones this part may be skinned to. */
  bones: readonly number[];
  /** One set of weights from the centroid: the part moves as a solid. */
  rigid: boolean;
  group: AoGroup;
}

interface PartSpec {
  color: number;
  mat: SoldierMat;
  rough?: number;
  metal?: number;
  camo?: boolean;
  bones: readonly number[];
  rigid?: boolean;
  group?: AoGroup;
}

const ROUGH: Readonly<Record<SoldierMat, number>> = {
  [SOLDIER_MAT.cloth]: 0.86,
  [SOLDIER_MAT.nylon]: 0.74,
  [SOLDIER_MAT.pals]: 0.78,
  [SOLDIER_MAT.loop]: 0.98,
  [SOLDIER_MAT.skin]: 0.6,
  [SOLDIER_MAT.rubber]: 0.9,
  [SOLDIER_MAT.polymer]: 0.5,
  [SOLDIER_MAT.metal]: 0.36,
  [SOLDIER_MAT.glass]: 0.06,
  [SOLDIER_MAT.suede]: 0.94,
  [SOLDIER_MAT.knit]: 0.95,
  [SOLDIER_MAT.leather]: 0.52,
};

const TORSO = [B.pelvis, B.spine1, B.spine2, B.spine3] as const;
const CHEST = [B.spine2, B.spine3] as const;
const WAIST = [B.pelvis, B.spine1] as const;
const NECK = [B.spine3, B.neck, B.head] as const;
const HEAD = [B.head] as const;
const SHIRT = [
  B.pelvis,
  B.spine1,
  B.spine2,
  B.spine3,
  B.neck,
  B.clavicleL,
  B.clavicleR,
] as const;

function armBones(side: number): readonly number[] {
  return side < 0
    ? [B.clavicleL, B.upperArmL, B.foreArmL, B.foreTwistL, B.handL]
    : [B.clavicleR, B.upperArmR, B.foreArmR, B.foreTwistR, B.handR];
}
function legBones(side: number): readonly number[] {
  return side < 0
    ? [B.pelvis, B.thighL, B.shinL, B.footL]
    : [B.pelvis, B.thighR, B.shinR, B.footR];
}
function bootBones(side: number): readonly number[] {
  return side < 0 ? [B.shinL, B.footL, B.toeL] : [B.shinR, B.footR, B.toeR];
}
const armGroup = (side: number): AoGroup => (side < 0 ? AO_GROUP.armL : AO_GROUP.armR);
const legGroup = (side: number): AoGroup => (side < 0 ? AO_GROUP.legL : AO_GROUP.legR);

/* ------------------------------------------------------------------ */
/* Shape helpers                                                       */
/* ------------------------------------------------------------------ */

const foldNoise = seededNoise2D(0x50d1);

/** Periodic noise around a ring: sampled on a circle, so no seam at 2 pi. */
function ringNoise(
  theta: number,
  y: number,
  scale: number,
  freqY: number,
  seed = 0,
): number {
  return foldNoise(
    Math.cos(theta) * scale + seed * 7.3 + y * freqY,
    Math.sin(theta) * scale - seed * 3.1,
  );
}

function bump(x: number, centre: number, width: number): number {
  const d = (x - centre) / width;
  return Math.exp(-d * d);
}

function smooth01(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

type ProfileRow = readonly [
  y: number,
  outer: number,
  inner: number,
  front: number,
  back: number,
  z: number,
];

/** Linear-in-y interpolation of a profile table, eased between rows. */
function sampleProfile(table: readonly ProfileRow[], y: number): ProfileRow {
  const top = table[0]!;
  const last = table[table.length - 1]!;
  const descending = top[0] > last[0];
  for (let i = 0; i < table.length - 1; i += 1) {
    const a = table[i]!;
    const b = table[i + 1]!;
    const inside = descending ? y <= a[0] && y >= b[0] : y >= a[0] && y <= b[0];
    if (!inside) continue;
    const span = b[0] - a[0];
    let t = span === 0 ? 0 : (y - a[0]) / span;
    t = t * t * (3 - 2 * t) * 0.5 + t * 0.5;
    return [
      y,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
      a[3] + (b[3] - a[3]) * t,
      a[4] + (b[4] - a[4]) * t,
      a[5] + (b[5] - a[5]) * t,
    ];
  }
  return (descending ? y > top[0] : y < top[0]) ? top : last;
}

/**
 * A vertical body tube from a profile table. `side` mirrors outer/inner;
 * `cx(y)` is the centre line, `disp(y, theta)` the fold displacement.
 */
function bodyTube(
  table: readonly ProfileRow[],
  y0: number,
  y1: number,
  rings: number,
  seg: number,
  side: number,
  cx: (y: number) => number,
  disp: ((y: number, theta: number) => number) | null,
  p = 2,
  inflate = 0,
  caps = { start: true, end: true },
): THREE.BufferGeometry {
  const list: SweepRing[] = [];
  const ys: number[] = [];
  // A ring's +v axis is tangent x u: forward (-z) on a tube that climbs, back
  // on one that descends. Profiles and folds are authored front-first, so a
  // descending tube swaps them and mirrors its angle.
  const down = y1 < y0;
  for (let i = 0; i < rings; i += 1) {
    const y = y0 + ((y1 - y0) * i) / (rings - 1);
    ys.push(y);
    const [, outer, inner, front, back, z] = sampleProfile(table, y);
    const a = side >= 0 ? outer : inner;
    const a2 = side >= 0 ? inner : outer;
    list.push({
      c: [cx(y), y, z],
      a: a + inflate,
      a2: a2 + inflate,
      b: (down ? back : front) + inflate,
      b2: (down ? front : back) + inflate,
      p,
    });
  }
  return sweep(list, {
    seg,
    u: [1, 0, 0],
    capStart: caps.start,
    capEnd: caps.end,
    dome: 0.5,
    ...(disp
      ? { disp: (ring: number, theta: number) => disp(ys[ring]!, down ? -theta : theta) }
      : {}),
  });
}

/**
 * A closed band around a body profile between two heights, with rounded
 * top and bottom edges so it has thickness where it is seen edge-on.
 */
function band(
  table: readonly ProfileRow[],
  y0: number,
  y1: number,
  thickness: number,
  seg: number,
  cx = 0,
  p = 2.4,
  extra?: (y: number, theta: number) => number,
): THREE.BufferGeometry {
  const h = y1 - y0;
  const e = Math.min(thickness * 0.6, h * 0.25);
  const rows: Array<[number, number]> = [
    [y0, thickness * 0.15],
    [y0 + e * 0.35, thickness * 0.8],
    [y0 + e, thickness],
    [y0 + h * 0.5, thickness],
    [y1 - e, thickness],
    [y1 - e * 0.35, thickness * 0.8],
    [y1, thickness * 0.15],
  ];
  const list: SweepRing[] = rows.map(([y, t]) => {
    const [, outer, inner, front, back, z] = sampleProfile(table, y);
    return { c: [cx, y, z], a: outer + t, a2: inner + t, b: front + t, b2: back + t, p };
  });
  return sweep(list, {
    seg,
    u: [1, 0, 0],
    ...(extra
      ? { disp: (ring: number, theta: number) => extra(rows[ring]![0], theta) }
      : {}),
  });
}

const _basis = new THREE.Matrix4();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();

/**
 * Orient a part so its local +z looks along `out` and its local +y is as close
 * to `up` as that allows, then move it to `at`.
 */
function orient(
  geometry: THREE.BufferGeometry,
  at: V3,
  out: V3,
  up: V3 = [0, 1, 0],
): THREE.BufferGeometry {
  _bz.set(out[0], out[1], out[2]).normalize();
  _by.set(up[0], up[1], up[2]);
  _by.addScaledVector(_bz, -_by.dot(_bz));
  if (_by.lengthSq() < 1e-8) _by.set(0, 0, 1).addScaledVector(_bz, -_bz.z);
  _by.normalize();
  _bx.crossVectors(_by, _bz).normalize();
  _basis.makeBasis(_bx, _by, _bz);
  geometry.applyMatrix4(_basis);
  geometry.translate(at[0], at[1], at[2]);
  return geometry;
}

/** Mirror a geometry in x (and fix its winding). */
function mirrorX(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.scale(-1, 1, 1);
  const index = geometry.getIndex();
  if (index) {
    const arr = index.array as Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1]!;
      arr[i + 1] = arr[i + 2]!;
      arr[i + 2] = t;
    }
    index.needsUpdate = true;
  }
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Body profiles (rest pose, metres; arms hang, model faces -z)        */
/* ------------------------------------------------------------------ */

// y, outer half-width, inner half-width, front, back, centre z
const TORSO_PROFILE: readonly ProfileRow[] = [
  [0.84, 0.15, 0.15, 0.1, 0.11, 0.012],
  [0.9, 0.17, 0.17, 0.106, 0.12, 0.01],
  [0.96, 0.168, 0.168, 0.102, 0.112, 0.006],
  [1.03, 0.152, 0.152, 0.098, 0.1, 0],
  [1.12, 0.16, 0.16, 0.108, 0.1, -0.005],
  [1.22, 0.171, 0.171, 0.118, 0.104, -0.01],
  [1.31, 0.181, 0.181, 0.118, 0.108, -0.012],
  [1.38, 0.178, 0.178, 0.106, 0.1, -0.012],
  [1.425, 0.15, 0.15, 0.082, 0.086, -0.006],
  [1.46, 0.092, 0.092, 0.062, 0.068, 0.004],
  [1.49, 0.062, 0.062, 0.054, 0.058, 0.01],
];

const LEG_PROFILE: readonly ProfileRow[] = [
  [0.97, 0.09, 0.085, 0.092, 0.1, 0.012],
  [0.9, 0.091, 0.084, 0.091, 0.099, 0.012],
  [0.83, 0.088, 0.079, 0.089, 0.093, 0.01],
  [0.74, 0.083, 0.074, 0.085, 0.085, 0.008],
  [0.64, 0.076, 0.068, 0.077, 0.075, 0.008],
  [0.56, 0.068, 0.062, 0.069, 0.065, 0.01],
  [0.5, 0.063, 0.059, 0.065, 0.059, 0.012],
  [0.45, 0.061, 0.057, 0.061, 0.059, 0.014],
  [0.38, 0.062, 0.058, 0.055, 0.068, 0.016],
  [0.31, 0.059, 0.056, 0.053, 0.064, 0.018],
  [0.25, 0.055, 0.053, 0.051, 0.056, 0.02],
  [0.215, 0.064, 0.062, 0.063, 0.066, 0.022],
  [0.18, 0.06, 0.058, 0.06, 0.062, 0.022],
  [0.14, 0.047, 0.047, 0.047, 0.047, 0.022],
];

const ARM_PROFILE: readonly ProfileRow[] = [
  [1.458, 0.038, 0.036, 0.038, 0.038, -0.012],
  [1.435, 0.057, 0.051, 0.056, 0.056, -0.014],
  [1.385, 0.062, 0.054, 0.059, 0.058, -0.014],
  [1.32, 0.059, 0.051, 0.056, 0.054, -0.013],
  [1.25, 0.055, 0.048, 0.053, 0.051, -0.012],
  [1.18, 0.052, 0.046, 0.05, 0.049, -0.01],
  [1.12, 0.049, 0.045, 0.047, 0.05, -0.008],
  [1.07, 0.05, 0.046, 0.049, 0.048, -0.006],
  [1.01, 0.049, 0.045, 0.048, 0.046, -0.004],
  [0.96, 0.046, 0.042, 0.044, 0.043, -0.002],
  [0.92, 0.042, 0.038, 0.04, 0.039, -0.001],
  [0.895, 0.04, 0.036, 0.038, 0.037, 0],
];

const HEAD_PROFILE: readonly ProfileRow[] = [
  [1.512, 0.036, 0.036, 0.04, 0.028, -0.04],
  [1.535, 0.055, 0.055, 0.068, 0.05, -0.025],
  [1.56, 0.063, 0.063, 0.084, 0.078, -0.006],
  [1.59, 0.069, 0.069, 0.091, 0.094, 0],
  [1.62, 0.073, 0.073, 0.095, 0.1, 0],
  [1.65, 0.077, 0.077, 0.096, 0.102, 0.002],
  [1.69, 0.078, 0.078, 0.092, 0.1, 0.004],
  [1.73, 0.074, 0.074, 0.082, 0.092, 0.006],
  [1.77, 0.06, 0.06, 0.062, 0.072, 0.008],
  [1.8, 0.03, 0.03, 0.03, 0.034, 0.01],
];

const NECK_PROFILE: readonly ProfileRow[] = [
  [1.45, 0.056, 0.056, 0.052, 0.056, 0.012],
  [1.52, 0.05, 0.05, 0.048, 0.05, 0.01],
  [1.58, 0.048, 0.048, 0.046, 0.05, 0.004],
];

/** Face relief on the head tube: nose, sockets, brow. theta pi/2 is front. */
function faceRelief(y: number, theta: number): number {
  const front = Math.PI / 2;
  const dt = theta - front;
  const nose =
    0.019 * bump(dt, 0, 0.13) * bump(y, 1.603, 0.022) +
    0.009 * bump(dt, 0, 0.1) * bump(y, 1.632, 0.014);
  const socket =
    -0.006 * (bump(dt, 0.36, 0.16) + bump(dt, -0.36, 0.16)) * bump(y, 1.637, 0.012);
  const brow = 0.004 * bump(dt, 0, 0.6) * bump(y, 1.657, 0.01);
  const cheek =
    0.003 * (bump(dt, 0.55, 0.25) + bump(dt, -0.55, 0.25)) * bump(y, 1.605, 0.02);
  return nose + socket + brow + cheek;
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

function buildParts(kit: Kit, variant: SoldierVariant): Part[] {
  const parts: Part[] = [];
  const add = (geometry: THREE.BufferGeometry, spec: PartSpec): void => {
    parts.push({
      geometry: clean(geometry),
      color: spec.color,
      mat: spec.mat,
      rough: spec.rough ?? ROUGH[spec.mat],
      metal: spec.metal ?? (spec.mat === SOLDIER_MAT.metal ? 0.85 : 0),
      camo: spec.camo ?? false,
      bones: spec.bones,
      rigid: spec.rigid ?? false,
      group: spec.group ?? AO_GROUP.torso,
    });
  };
  const camoCloth = (
    bones: readonly number[],
    group: AoGroup = AO_GROUP.torso,
  ): PartSpec => ({
    color: 0xffffff,
    mat: SOLDIER_MAT.cloth,
    camo: true,
    bones,
    group,
  });
  const gearSpec = (
    bones: readonly number[],
    rigid = true,
    mat: SoldierMat = SOLDIER_MAT.nylon,
  ): PartSpec => ({
    color: kit.gearCamo ? 0xf0f0f0 : kit.gear,
    mat,
    camo: kit.gearCamo,
    bones,
    rigid,
  });

  /* ------------------------------------------------- shirt and trousers */
  add(
    bodyTube(
      TORSO_PROFILE,
      0.84,
      1.49,
      26,
      32,
      1,
      () => 0,
      (y, theta) =>
        0.0025 * ringNoise(theta, y, 1.3, 9, 1) +
        0.0035 *
          bump(y, 1.04, 0.035) *
          Math.sin(y * 290 + theta * 3 + ringNoise(theta, y, 1, 3, 2) * 2),
      2.5,
    ),
    { color: kit.shirt, mat: SOLDIER_MAT.cloth, bones: SHIRT },
  );
  // Collar of the combat shirt.
  add(band(NECK_PROFILE, 1.465, 1.515, 0.008, 22), { ...camoCloth(NECK), rigid: false });
  add(
    bodyTube(NECK_PROFILE, 1.45, 1.58, 6, 16, 1, () => 0, null),
    {
      color: kit.face === "balaclava" ? kit.faceCloth : kit.skin,
      mat: kit.face === "balaclava" ? SOLDIER_MAT.knit : SOLDIER_MAT.skin,
      bones: NECK,
    },
  );

  for (const side of [-1, 1]) {
    const hip = side * 0.095;
    const knee = side * 0.098;
    const ankle = side * 0.1;
    const legX = (y: number) =>
      y > 0.487
        ? knee + (hip - knee) * ((y - 0.487) / (0.918 - 0.487))
        : ankle + (knee - ankle) * ((y - 0.086) / (0.487 - 0.086));
    add(
      bodyTube(
        LEG_PROFILE,
        0.97,
        0.14,
        34,
        24,
        side,
        legX,
        (y, theta) => {
          const back = Math.max(0, -Math.sin(theta));
          const n = ringNoise(theta, y, 1.4, 7, side + 3);
          let d = 0.004 * n;
          // Drape folds down the thigh, diagonal.
          d +=
            0.0028 *
            smooth01(y, 0.55, 0.62) *
            (1 - smooth01(y, 0.84, 0.9)) *
            Math.sin(y * 48 + theta * 2.2 * side + n * 2.5);
          // Behind the knee the cloth bunches; in front it is under the pad.
          d +=
            0.0045 *
            bump(y, 0.48, 0.055) *
            (0.35 + 0.65 * back) *
            Math.sin(y * 260 + theta * 1.5 + n * 2);
          // Shin drape, near vertical.
          d +=
            0.002 *
            smooth01(y, 0.24, 0.3) *
            (1 - smooth01(y, 0.4, 0.44)) *
            Math.sin(theta * 5 + y * 9 + n);
          // Bloused over the boot: gathered pleats.
          d += 0.0055 * bump(y, 0.205, 0.028) * Math.abs(Math.sin(theta * 6.5 + n * 2.5));
          return d;
        },
        2,
        0.004,
      ),
      camoCloth(legBones(side), legGroup(side)),
    );

    const shoulder = side * 0.18;
    const wrist = side * 0.184;
    add(
      bodyTube(
        ARM_PROFILE,
        1.458,
        0.895,
        28,
        20,
        side,
        (y) => shoulder + (wrist - shoulder) * ((1.458 - y) / (1.458 - 0.895)),
        (y, theta) => {
          const front = Math.max(0, Math.sin(theta));
          const n = ringNoise(theta, y, 1.2, 8, side + 9);
          let d = 0.003 * n;
          // Inside of the elbow folds hardest.
          d +=
            0.004 *
            bump(y, 1.115, 0.045) *
            (0.3 + 0.7 * front) *
            Math.sin(y * 300 + theta * 1.6 + n * 2);
          // Sleeve pushed up the forearm.
          d += 0.003 * bump(y, 0.96, 0.03) * Math.sin(y * 340 + theta + n * 2);
          // Drape under the deltoid.
          d += 0.002 * bump(y, 1.3, 0.06) * Math.sin(theta * 3 + y * 20 + n);
          return d;
        },
        2,
        0.003,
      ),
      camoCloth(armBones(side), armGroup(side)),
    );
  }

  buildHead(kit, variant, add);
  buildHelmet(kit, add);
  buildCarrier(kit, add, gearSpec);
  buildBelt(kit, add, gearSpec);
  for (const side of [-1, 1]) {
    buildLegKit(kit, side, add);
    buildArmKit(kit, side, add);
    buildGlove(kit, side, add);
    buildBoot(kit, side, add);
  }
  return parts;
}

type Add = (geometry: THREE.BufferGeometry, spec: PartSpec) => void;

/* ------------------------------------------------------------------ */
/* Head, face covering, eyewear                                        */
/* ------------------------------------------------------------------ */

function buildHead(kit: Kit, variant: SoldierVariant, add: Add): void {
  const balaclava = kit.face === "balaclava";
  add(
    bodyTube(
      HEAD_PROFILE,
      1.512,
      1.8,
      22,
      28,
      1,
      () => 0,
      (y, theta) =>
        faceRelief(y, theta) * (balaclava ? 0.8 : 1) + (balaclava ? 0.004 : 0),
      2.2,
    ),
    {
      color: balaclava ? kit.faceCloth : kit.skin,
      mat: balaclava ? SOLDIER_MAT.knit : SOLDIER_MAT.skin,
      bones: HEAD,
      rigid: true,
    },
  );

  if (!balaclava) {
    // Gaiter pulled up over the nose: follows the head and neck, loosely.
    const table: ProfileRow[] = [
      [1.455, 0.068, 0.068, 0.066, 0.07, 0.012],
      [1.5, 0.064, 0.064, 0.064, 0.064, 0.0],
      ...HEAD_PROFILE.filter((r) => r[0] > 1.53 && r[0] < 1.6),
      [1.618, 0.074, 0.074, 0.096, 0.1, 0],
    ];
    add(
      bodyTube(
        table,
        1.455,
        1.618,
        14,
        28,
        1,
        () => 0,
        (y, theta) => {
          const n = ringNoise(theta, y, 1.5, 12, 21);
          const relief = y > 1.56 ? faceRelief(Math.min(y, 1.612), theta) * 0.9 : 0;
          return (
            0.006 +
            relief +
            0.003 * n +
            0.003 *
              Math.sin(y * 330 + theta * 2 + n * 2) *
              (1 - smooth01(y, 1.58, 1.61)) +
            0.004 * bump(y, 1.612, 0.006)
          );
        },
        2.2,
        0,
        { start: false, end: false },
      ),
      { color: kit.faceCloth, mat: SOLDIER_MAT.cloth, bones: NECK },
    );
  }

  // Eyewear: wraparound ballistic glasses, or goggles on variant 1.
  const lensY = 1.637;
  if (variant === 1) {
    const pts: V3[] = [];
    for (let i = 0; i <= 10; i += 1) {
      const a = -1.15 + (i / 10) * 2.3;
      pts.push([Math.sin(a) * 0.088, lensY, -Math.cos(a) * 0.112 + 0.012]);
    }
    const out = (p: THREE.Vector3) => new THREE.Vector3(p.x, 0, p.z - 0.012).normalize();
    add(strap(pts, 0.046, 0.016, 26, out), {
      color: 0x1d1e1c,
      mat: SOLDIER_MAT.polymer,
      bones: HEAD,
      rigid: true,
    });
    const lens: V3[] = pts
      .slice(2, 9)
      .map((p) => [p[0] * 1.06, p[1], (p[2] - 0.012) * 1.06 + 0.012]);
    add(strap(lens, 0.034, 0.004, 20, out), {
      color: 0x15191b,
      mat: SOLDIER_MAT.glass,
      metal: 0.3,
      bones: HEAD,
      rigid: true,
    });
  } else {
    const lens: V3[] = [];
    for (let i = 0; i <= 8; i += 1) {
      const a = -1.05 + (i / 8) * 2.1;
      lens.push([
        Math.sin(a) * 0.084,
        lensY - Math.abs(Math.sin(a)) * 0.004,
        -Math.cos(a) * 0.11 + 0.011,
      ]);
    }
    const out = (p: THREE.Vector3) => new THREE.Vector3(p.x, 0, p.z - 0.011).normalize();
    add(strap(lens, 0.034, 0.004, 22, out), {
      color: 0x101315,
      mat: SOLDIER_MAT.glass,
      metal: 0.35,
      bones: HEAD,
      rigid: true,
    });
    const bar: V3[] = lens.map((p) => [
      p[0] * 1.01,
      lensY + 0.018,
      (p[2] - 0.011) * 1.01 + 0.011,
    ]);
    add(strap(bar, 0.006, 0.007, 20, out), {
      color: 0x1b1c1b,
      mat: SOLDIER_MAT.polymer,
      bones: HEAD,
      rigid: true,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Helmet                                                              */
/* ------------------------------------------------------------------ */

const HELM = { cx: 0, cy: 1.668, cz: 0.008, rx: 0.123, ry: 0.162, rz: 0.134 } as const;

function superC(c: number, p: number): number {
  return Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
}

/** Point on the shell at azimuth theta (pi/2 = front) and polar angle phi. */
function shellPoint(theta: number, phi: number, offset = 0): THREE.Vector3 {
  const c = superC(Math.cos(theta), 2.35);
  const s = superC(Math.sin(theta), 2.35);
  // A flatter crown: the top third is pulled down a little.
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const crown = 1 - 0.07 * Math.pow(Math.max(0, cp), 3);
  const p = new THREE.Vector3(
    HELM.cx + (HELM.rx + offset) * sp * c,
    HELM.cy + (HELM.ry + offset) * cp * crown,
    HELM.cz - (HELM.rz + offset) * sp * s,
  );
  return p;
}

function shellNormal(theta: number, phi: number): THREE.Vector3 {
  const e = 1e-3;
  const a = shellPoint(theta + e, phi).sub(shellPoint(theta - e, phi));
  const b = shellPoint(theta, phi + e).sub(shellPoint(theta, phi - e));
  const n = new THREE.Vector3().crossVectors(b, a).normalize();
  // Outward.
  const radial = shellPoint(theta, phi).sub(
    new THREE.Vector3(HELM.cx, HELM.cy - 0.03, HELM.cz),
  );
  if (n.dot(radial) < 0) n.negate();
  return n;
}

/** Polar angle of the rim at azimuth theta: brow, high-cut over the ears, nape. */
function rimPhi(theta: number): number {
  let a = Math.abs(((theta - Math.PI / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  a = Math.min(a, Math.PI);
  const brow = 1.5;
  const ear = 1.3;
  const nape = 1.86;
  if (a < 0.62) return brow;
  if (a < 1.22) return brow + (ear - brow) * smooth01(a, 0.62, 1.22);
  if (a < 1.95) return ear;
  return ear + (nape - ear) * smooth01(a, 1.95, Math.PI);
}

function shell(
  seg: number,
  rows: number,
  offset: number,
  phiScale = 1,
): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let r = 0; r <= rows; r += 1) {
    const v = r / rows;
    for (let j = 0; j < seg; j += 1) {
      const theta = (j / seg) * Math.PI * 2;
      const p = shellPoint(theta, v * rimPhi(theta) * phiScale, offset);
      positions.push(p.x, p.y, p.z);
    }
  }
  const indices: number[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let j = 0; j < seg; j += 1) {
      const a = r * seg + j;
      const b = r * seg + ((j + 1) % seg);
      const c = (r + 1) * seg + j;
      const d = (r + 1) * seg + ((j + 1) % seg);
      indices.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3),
  );
  g.setIndex(indices);
  const welded = weld(g);
  welded.computeVertexNormals();
  // Outward check at the brow.
  const n = welded.getAttribute("normal");
  const pos = welded.getAttribute("position");
  let dot = 0;
  for (let i = 0; i < pos.count; i += 37) {
    dot +=
      (pos.getX(i) - HELM.cx) * n.getX(i) +
      (pos.getY(i) - HELM.cy) * n.getY(i) +
      (pos.getZ(i) - HELM.cz) * n.getZ(i);
  }
  if (dot < 0) {
    const index = welded.getIndex()!;
    const arr = index.array as Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1]!;
      arr[i + 1] = arr[i + 2]!;
      arr[i + 2] = t;
    }
    welded.computeVertexNormals();
  }
  return welded;
}

/** A thin curved patch lying on the shell over an azimuth/polar window. */
function shellPatch(
  t0: number,
  t1: number,
  p0: number,
  p1: number,
  lift: number,
  thick: number,
): THREE.BufferGeometry {
  const nu = 8;
  const nv = 6;
  const positions: number[] = [];
  const indices: number[] = [];
  const layer = (off: number) => {
    const base = positions.length / 3;
    for (let i = 0; i <= nv; i += 1) {
      for (let j = 0; j <= nu; j += 1) {
        const p = shellPoint(t0 + ((t1 - t0) * j) / nu, p0 + ((p1 - p0) * i) / nv, off);
        positions.push(p.x, p.y, p.z);
      }
    }
    return base;
  };
  const top = layer(lift + thick);
  const bottom = layer(lift);
  const w = nu + 1;
  for (let i = 0; i < nv; i += 1) {
    for (let j = 0; j < nu; j += 1) {
      const a = i * w + j;
      indices.push(
        top + a,
        top + a + 1,
        top + a + w,
        top + a + 1,
        top + a + w + 1,
        top + a + w,
      );
      indices.push(
        bottom + a,
        bottom + a + w,
        bottom + a + 1,
        bottom + a + 1,
        bottom + a + w,
        bottom + a + w + 1,
      );
    }
  }
  // Side walls.
  const edge = (a: number, b: number) => {
    indices.push(top + a, bottom + a, top + b, top + b, bottom + a, bottom + b);
  };
  for (let j = 0; j < nu; j += 1) {
    edge(j + 1, j);
    edge(nv * w + j, nv * w + j + 1);
  }
  for (let i = 0; i < nv; i += 1) {
    edge(i * w, (i + 1) * w);
    edge((i + 1) * w + nu, i * w + nu);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  // Ensure outward at the top layer's centre.
  const n = g.getAttribute("normal");
  const mid = top + Math.floor(nv / 2) * w + Math.floor(nu / 2);
  const out = shellNormal((t0 + t1) / 2, (p0 + p1) / 2);
  if (n.getX(mid) * out.x + n.getY(mid) * out.y + n.getZ(mid) * out.z < 0) {
    const arr = g.getIndex()!.array as Uint32Array | Uint16Array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1]!;
      arr[i + 1] = arr[i + 2]!;
      arr[i + 2] = t;
    }
    g.computeVertexNormals();
  }
  return g;
}

function buildHelmet(kit: Kit, add: Add): void {
  const shellSpec: PartSpec = kit.helmetCover
    ? { color: 0xe8e2d6, mat: SOLDIER_MAT.cloth, camo: true, bones: HEAD, rigid: true }
    : {
        color: kit.helmet,
        mat: SOLDIER_MAT.polymer,
        rough: 0.46,
        bones: HEAD,
        rigid: true,
      };
  add(shell(44, 14, 0), shellSpec);

  // Rim trim: the rubber edge band, which also gives the shell a thickness.
  const rim: V3[] = [];
  for (let j = 0; j < 40; j += 1) {
    const theta = (j / 40) * Math.PI * 2;
    const p = shellPoint(theta, rimPhi(theta), -0.002);
    rim.push([p.x, p.y, p.z]);
  }
  const centre = new THREE.Vector3(HELM.cx, HELM.cy, HELM.cz);
  add(
    strap(rim, 0.014, 0.011, 80, (p) => p.clone().sub(centre).setY(0).normalize(), true),
    { color: 0x232421, mat: SOLDIER_MAT.rubber, rough: 0.8, bones: HEAD, rigid: true },
  );

  const hw = kit.hardware;
  const front = Math.PI / 2;
  const back = Math.PI * 1.5;

  // NVG shroud on the brow and the stowed mount under it.
  {
    const at = shellPoint(front, 1.12, 0.008);
    const n = shellNormal(front, 1.12);
    add(orient(rbox(0.064, 0.048, 0.02, 0.006), [at.x, at.y, at.z], [n.x, n.y, n.z]), {
      color: hw,
      mat: SOLDIER_MAT.metal,
      rough: 0.42,
      metal: 0.7,
      bones: HEAD,
      rigid: true,
    });
    const at2 = shellPoint(front, 1.22, 0.028);
    add(
      orient(
        rbox(0.036, 0.034, 0.03, 0.006),
        [at2.x, at2.y - 0.004, at2.z],
        [n.x, 0, n.z],
      ),
      {
        color: 0x262725,
        mat: SOLDIER_MAT.polymer,
        bones: HEAD,
        rigid: true,
      },
    );
    for (const s of [-1, 1]) {
      const knob = cylinder(0.008, 0.008, 0.012, 10);
      knob.rotateZ(Math.PI / 2);
      add(place(knob, at2.x + s * 0.024, at2.y - 0.004, at2.z - 0.004), {
        color: 0x1f201e,
        mat: SOLDIER_MAT.polymer,
        bones: HEAD,
        rigid: true,
      });
    }
  }

  // Side rails above the ear cut-outs, with the headset arms hanging off them.
  for (const s of [-1, 1]) {
    const mid = s > 0 ? 0 : Math.PI;
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i += 1) {
      const theta = mid + (i / 6 - 0.5) * 0.95;
      const p = shellPoint(theta, 1.18, 0.006);
      pts.push([p.x, p.y, p.z]);
    }
    add(
      strap(pts, 0.022, 0.011, 18, (p) => p.clone().sub(centre).normalize()),
      {
        color: kit.helmetCover ? 0x6d604a : hw,
        mat: SOLDIER_MAT.polymer,
        rough: 0.55,
        bones: HEAD,
        rigid: true,
      },
    );
    // Rail bolts.
    for (const k of [-0.32, 0.32]) {
      const p = shellPoint(mid + k, 1.18, 0.013);
      const n = shellNormal(mid + k, 1.18);
      const bolt = cylinder(0.0045, 0.0045, 0.004, 8);
      bolt.rotateX(Math.PI / 2);
      add(orient(bolt, [p.x, p.y, p.z], [n.x, n.y, n.z]), {
        color: 0x3a3a38,
        mat: SOLDIER_MAT.metal,
        bones: HEAD,
        rigid: true,
      });
    }
    // Headset: cup over the ear, cushion ring, arm up to the rail.
    const cupX = s * 0.101;
    const cup = ellipsoid(0.022, 0.039, 0.032, 16, 10);
    add(place(cup, cupX, 1.612, 0.012), {
      color: kit.headset,
      mat: SOLDIER_MAT.polymer,
      rough: 0.55,
      bones: HEAD,
      rigid: true,
    });
    const ring: V3[] = [];
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2;
      ring.push([s * 0.083, 1.612 + Math.sin(a) * 0.036, 0.012 + Math.cos(a) * 0.029]);
    }
    add(
      strap(ring, 0.014, 0.012, 32, () => new THREE.Vector3(s, 0, 0), true),
      {
        color: 0x1c1c1b,
        mat: SOLDIER_MAT.leather,
        bones: HEAD,
        rigid: true,
      },
    );
    const top = shellPoint(mid, 1.2, 0.012);
    add(
      strap(
        [
          [top.x, top.y, top.z],
          [s * 0.118, 1.672, 0.014],
          [s * 0.116, 1.648, 0.012],
        ],
        0.012,
        0.006,
        8,
        () => new THREE.Vector3(s, 0, 0),
      ),
      { color: 0x1f1f1e, mat: SOLDIER_MAT.polymer, bones: HEAD, rigid: true },
    );
  }
  // Boom mic from the left cup round to the mouth.
  {
    const boom: SweepRing[] = [];
    const path: V3[] = [
      [-0.112, 1.6, -0.012],
      [-0.104, 1.588, -0.05],
      [-0.083, 1.578, -0.087],
      [-0.05, 1.572, -0.108],
    ];
    const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)));
    for (const p of curve.getSpacedPoints(10))
      boom.push({ c: [p.x, p.y, p.z], a: 0.0032, b: 0.0032 });
    add(sweep(boom, { seg: 6, capStart: true, capEnd: true }), {
      color: 0x1e1e1d,
      mat: SOLDIER_MAT.polymer,
      bones: HEAD,
      rigid: true,
    });
    add(place(ellipsoid(0.008, 0.008, 0.011, 8, 6), -0.046, 1.572, -0.11), {
      color: 0x1a1a19,
      mat: SOLDIER_MAT.loop,
      bones: HEAD,
      rigid: true,
    });
  }

  // Loop patches on crown and rear, counterweight pouch, strobe.
  const loop = kit.helmetCover ? 0x6f6250 : 0x2e2f2c;
  add(shellPatch(front - 0.42, front + 0.42, 0.2, 0.72, 0.003, 0.003), {
    color: loop,
    mat: SOLDIER_MAT.loop,
    bones: HEAD,
    rigid: true,
  });
  add(shellPatch(back - 0.45, back + 0.45, 0.75, 1.15, 0.003, 0.003), {
    color: loop,
    mat: SOLDIER_MAT.loop,
    bones: HEAD,
    rigid: true,
  });
  {
    const at = shellPoint(back, 1.5, 0.02);
    const n = shellNormal(back, 1.5);
    add(
      orient(rbox(0.096, 0.058, 0.036, 0.012), [at.x, at.y, at.z], [n.x, n.y * 0.4, n.z]),
      {
        color: kit.gear,
        mat: SOLDIER_MAT.nylon,
        bones: HEAD,
        rigid: true,
      },
    );
    const at2 = shellPoint(back, 0.8, 0.014);
    const n2 = shellNormal(back, 0.8);
    add(
      orient(
        rbox(0.026, 0.034, 0.02, 0.005),
        [at2.x, at2.y, at2.z],
        [n2.x, n2.y, n2.z],
        [0, 0, -1],
      ),
      {
        color: 0x20211f,
        mat: SOLDIER_MAT.polymer,
        bones: HEAD,
        rigid: true,
      },
    );
  }
  // Bungee cords across the cover / shell.
  for (const k of [-1, 1]) {
    const pts: V3[] = [];
    for (let i = 0; i <= 8; i += 1) {
      const t = i / 8;
      const p = shellPoint(back + k * (0.9 - t * 1.8) * 0.9, 0.55 + t * 0.55, 0.004);
      pts.push([p.x, p.y, p.z]);
    }
    add(
      strap(pts, 0.005, 0.005, 16, (p) => p.clone().sub(centre).normalize()),
      {
        color: 0x2a2620,
        mat: SOLDIER_MAT.knit,
        bones: HEAD,
        rigid: true,
      },
    );
  }
}

/* ------------------------------------------------------------------ */
/* Plate carrier                                                       */
/* ------------------------------------------------------------------ */

function buildCarrier(
  kit: Kit,
  add: Add,
  gear: (bones: readonly number[], rigid?: boolean, mat?: SoldierMat) => PartSpec,
): void {
  // Front panel space: origin at the plate centre, +z outward, bent round the
  // chest. Everything sewn to the front shares the bend.
  const frontY = 1.212;
  const frontZ = -0.153;
  const frontR = 0.26;
  const toFront = (g: THREE.BufferGeometry, x: number, y: number, z: number) => {
    g.translate(x, y, -z);
    bendY(g, frontR, 1);
    g.translate(0, frontY, frontZ);
    return g;
  };
  // Back panel space: +z outward (toward +z world).
  const backY = 1.222;
  const backZ = 0.117;
  const backR = 0.28;
  const toBack = (g: THREE.BufferGeometry, x: number, y: number, z: number) => {
    g.translate(x, y, z);
    bendY(g, backR, -1);
    g.translate(0, backY, backZ);
    return g;
  };
  /** A front-space part whose outward face is +z: flip into -z first. */
  const front = (g: THREE.BufferGeometry, x: number, y: number, z: number) => {
    g.rotateY(Math.PI);
    return toFront(g, x, y, z);
  };

  const plate = (w: number, h: number) => {
    const g = rbox(w, h, 0.046, 0.016, 2);
    // Shoulder cut: narrow the top corners.
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i);
      const t = smooth01(y, h * 0.1, h / 2);
      pos.setX(i, pos.getX(i) * (1 - 0.2 * t));
    }
    g.computeVertexNormals();
    return g;
  };
  add(front(plate(0.272, 0.305), 0, 0, 0), gear(CHEST));
  add(toBack(plate(0.29, 0.325), 0, 0, 0), gear(CHEST));

  // Shoulder straps over the trapezius, front plate to back plate.
  for (const s of [-1, 1]) {
    const pts: V3[] = [
      [s * 0.088, 1.35, -0.152],
      [s * 0.096, 1.418, -0.118],
      [s * 0.103, 1.468, -0.048],
      [s * 0.105, 1.476, 0.02],
      [s * 0.1, 1.438, 0.086],
      [s * 0.092, 1.372, 0.118],
    ];
    add(
      strap(pts, 0.058, 0.017, 24, (p) =>
        p
          .clone()
          .sub(new THREE.Vector3(s * 0.05, 1.28, 0))
          .normalize(),
      ),
      { ...gear([B.spine3, B.clavicleL, B.clavicleR], false), mat: SOLDIER_MAT.nylon },
    );
    // Buckle where the strap meets the front plate.
    add(front(rbox(0.036, 0.024, 0.012, 0.004), s * 0.088, 0.13, 0.03), {
      color: kit.hardware,
      mat: SOLDIER_MAT.polymer,
      rough: 0.45,
      bones: CHEST,
      rigid: true,
    });
  }

  // Cummerbund wrapping the ribs.
  add(
    band(
      TORSO_PROFILE,
      1.035,
      1.19,
      0.016,
      40,
      0,
      2.5,
      (y, theta) => 0.0015 * ringNoise(theta, y, 2, 5, 30),
    ),
    gear(TORSO, false, SOLDIER_MAT.pals),
  );

  // Three open-top rifle magazine pouches on the lower front, magazines
  // standing out of them, pull tabs on top. These have to stand proud of the
  // plate to exist at gameplay range.
  for (let i = 0; i < 3; i += 1) {
    const x = (i - 1) * 0.086;
    add(front(rbox(0.08, 0.118, 0.044, 0.011, 2), x, -0.075, 0.045), gear(CHEST));
    // Elastic band across the pouch mouth.
    add(front(rbox(0.082, 0.016, 0.046, 0.005, 1), x, -0.028, 0.046), {
      color: kit.webbing,
      mat: SOLDIER_MAT.pals,
      bones: CHEST,
      rigid: true,
    });
    add(front(rbox(0.066, 0.05, 0.026, 0.006, 1), x, -0.006, 0.045), {
      color: kit.mag,
      mat: SOLDIER_MAT.polymer,
      rough: 0.62,
      bones: CHEST,
      rigid: true,
    });
    add(front(rbox(0.024, 0.014, 0.008, 0.003, 1), x + 0.01, 0.022, 0.045), {
      color: kit.webbing,
      mat: SOLDIER_MAT.nylon,
      bones: CHEST,
      rigid: true,
    });
  }
  // Admin panel with a loop field, a name tape and a flag-sized patch.
  add(front(rbox(0.19, 0.095, 0.016, 0.006, 1), 0, 0.075, 0.03), gear(CHEST));
  add(front(rbox(0.16, 0.05, 0.004, 0.002, 1), 0, 0.083, 0.04), {
    color: kit.gear,
    mat: SOLDIER_MAT.loop,
    bones: CHEST,
    rigid: true,
  });
  add(front(rbox(0.06, 0.04, 0.004, 0.002, 1), -0.04, 0.083, 0.043), {
    color: kit.face === "balaclava" ? 0x3a3c36 : 0x8b7d62,
    mat: SOLDIER_MAT.loop,
    bones: CHEST,
    rigid: true,
  });

  // Radio pouch and IFAK on the cummerbund flanks.
  for (const s of [-1, 1]) {
    const pouch = rbox(0.11, 0.13, 0.05, 0.012, 2);
    bendY(pouch, 0.2, -1);
    pouch.rotateY(s * Math.PI * 0.5);
    add(place(pouch, s * 0.195, 1.115, 0.012), gear(TORSO));
  }

  // Back: a zip-on utility panel, or an assault pack.
  if (kit.pack) {
    add(toBack(rbox(0.27, 0.36, 0.13, 0.04, 2), 0, -0.01, 0.088), gear(CHEST));
    add(toBack(rbox(0.28, 0.08, 0.1, 0.03, 2), 0, 0.165, 0.092), gear(CHEST));
    for (const s of [-1, 1]) {
      add(toBack(rbox(0.022, 0.3, 0.014, 0.004, 1), s * 0.09, -0.01, 0.156), {
        color: kit.webbing,
        mat: SOLDIER_MAT.pals,
        bones: CHEST,
        rigid: true,
      });
    }
  } else {
    add(
      toBack(rbox(0.22, 0.25, 0.05, 0.016, 2), 0, -0.012, 0.047),
      gear(CHEST, true, SOLDIER_MAT.pals),
    );
    add(toBack(rbox(0.07, 0.13, 0.05, 0.012, 2), -0.105, 0.03, 0.05), gear(CHEST));
  }
  // Drag handle across the top of the back plate.
  add(
    strap(
      [
        [-0.05, 1.38, 0.13],
        [-0.035, 1.405, 0.142],
        [0.035, 1.405, 0.142],
        [0.05, 1.38, 0.13],
      ],
      0.03,
      0.01,
      12,
      () => new THREE.Vector3(0, 0.3, 1).normalize(),
    ),
    { color: kit.webbing, mat: SOLDIER_MAT.nylon, bones: CHEST, rigid: true },
  );
  if (kit.antenna) {
    const mast = cylinder(0.0022, 0.0042, 0.48, 6);
    mast.translate(0, 0.24, 0);
    mast.rotateX(-0.12);
    mast.rotateZ(0.1);
    add(place(mast, -0.11, 1.3, 0.19), {
      color: 0x262624,
      mat: SOLDIER_MAT.polymer,
      rough: 0.5,
      bones: [B.spine3],
      rigid: true,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Belt                                                                */
/* ------------------------------------------------------------------ */

function buildBelt(
  kit: Kit,
  add: Add,
  gear: (bones: readonly number[], rigid?: boolean, mat?: SoldierMat) => PartSpec,
): void {
  add(
    band(TORSO_PROFILE, 0.928, 0.99, 0.02, 40, 0, 2.4),
    gear(WAIST, false, SOLDIER_MAT.pals),
  );
  add(place(rbox(0.056, 0.04, 0.016, 0.005, 1), 0, 0.96, -0.122), {
    color: kit.hardware,
    mat: SOLDIER_MAT.metal,
    rough: 0.38,
    metal: 0.8,
    bones: WAIST,
    rigid: true,
  });
  // Pistol magazine pair, front left.
  for (const k of [0, 1]) {
    const g = rbox(0.034, 0.085, 0.03, 0.007, 1);
    g.rotateY(0.55);
    add(place(g, -0.105 - k * 0.032, 0.94, -0.118 + k * 0.02), gear(WAIST));
  }
  // Dump pouch, IFAK at the back.
  add(
    place(rbox(0.11, 0.075, 0.05, 0.014, 2), 0.095, 0.945, 0.15, 0, -0.35),
    gear(WAIST),
  );
  add(
    place(rbox(0.12, 0.085, 0.055, 0.014, 2), -0.07, 0.955, 0.152, 0, 0.3),
    gear(WAIST),
  );
  if (!kit.dropLeg) {
    // Pistol on the right hip.
    add(place(rbox(0.036, 0.16, 0.085, 0.01, 2), 0.205, 0.875, 0.01, 0, 0, 0.06), {
      color: 0x1f201e,
      mat: SOLDIER_MAT.polymer,
      bones: [B.pelvis],
      rigid: true,
    });
    add(place(rbox(0.03, 0.065, 0.034, 0.008, 1), 0.205, 0.975, 0.022, -0.25), {
      color: 0x1b1c1b,
      mat: SOLDIER_MAT.polymer,
      bones: [B.pelvis],
      rigid: true,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Legs, arms                                                          */
/* ------------------------------------------------------------------ */

function buildLegKit(kit: Kit, side: number, add: Add): void {
  const shin = side < 0 ? B.shinL : B.shinR;
  const thigh = side < 0 ? B.thighL : B.thighR;
  const legX = (y: number) =>
    side *
    (y > 0.487
      ? 0.098 - 0.003 * ((y - 0.487) / 0.431)
      : 0.1 - 0.002 * ((y - 0.086) / 0.401));
  const group = legGroup(side);

  // Knee pad: a hard cap on a soft pad, strapped above and below the knee.
  {
    const cap = rbox(0.092, 0.11, 0.036, 0.017, 2);
    const pos = cap.getAttribute("position");
    for (let i = 0; i < pos.count; i += 1) {
      const z = pos.getZ(i);
      if (z < 0) continue;
      const r = Math.hypot(pos.getX(i) / 0.046, pos.getY(i) / 0.055);
      pos.setZ(i, z + 0.012 * Math.max(0, 1 - r * r));
    }
    cap.computeVertexNormals();
    cap.rotateY(Math.PI);
    bendY(cap, 0.07, 1);
    add(place(cap, legX(0.49), 0.492, -0.07, 0.05), {
      color: kit.pad,
      mat: SOLDIER_MAT.polymer,
      rough: 0.55,
      bones: [shin],
      rigid: true,
      group,
    });
    const backing = rbox(0.104, 0.13, 0.016, 0.007, 1);
    backing.rotateY(Math.PI);
    bendY(backing, 0.065, 1);
    add(place(backing, legX(0.49), 0.49, -0.052, 0.05), {
      color: kit.webbing,
      mat: SOLDIER_MAT.nylon,
      bones: [shin],
      rigid: true,
      group,
    });
    for (const y of [0.545, 0.43]) {
      add(band(LEG_PROFILE, y - 0.011, y + 0.011, 0.009, 20, legX(y)), {
        color: kit.webbing,
        mat: SOLDIER_MAT.pals,
        bones: legBones(side),
        group,
      });
    }
  }

  // Cargo pocket on the outside of the thigh.
  {
    const pocket = rbox(0.11, 0.15, 0.026, 0.01, 2);
    pocket.rotateY(Math.PI);
    bendY(pocket, 0.088, 1);
    pocket.rotateY(-side * Math.PI * 0.5);
    add(place(pocket, side * 0.183, 0.67, 0.01), {
      color: 0xffffff,
      mat: SOLDIER_MAT.cloth,
      camo: true,
      bones: [thigh],
      rigid: true,
      group,
    });
    const flap = rbox(0.118, 0.042, 0.012, 0.005, 1);
    flap.rotateY(Math.PI);
    bendY(flap, 0.09, 1);
    flap.rotateY(-side * Math.PI * 0.5);
    add(place(flap, side * 0.198, 0.735, 0.01), {
      color: 0xf4f4f4,
      mat: SOLDIER_MAT.cloth,
      camo: true,
      bones: [thigh],
      rigid: true,
      group,
    });
  }

  // Drop-leg holster on the right thigh.
  if (kit.dropLeg && side > 0) {
    add(place(rbox(0.04, 0.17, 0.085, 0.012, 2), 0.2, 0.75, -0.004, 0, 0, 0.04), {
      color: 0x22231f,
      mat: SOLDIER_MAT.polymer,
      bones: [thigh],
      rigid: true,
      group,
    });
    add(place(rbox(0.032, 0.07, 0.036, 0.008, 1), 0.198, 0.86, 0.01, -0.3), {
      color: 0x1b1c1a,
      mat: SOLDIER_MAT.polymer,
      bones: [thigh],
      rigid: true,
      group,
    });
    for (const y of [0.7, 0.8]) {
      add(band(LEG_PROFILE, y - 0.012, y + 0.012, 0.01, 20, legX(y)), {
        color: kit.webbing,
        mat: SOLDIER_MAT.pals,
        bones: [thigh],
        group,
      });
    }
    // Strap from the belt down to the platform.
    add(
      strap(
        [
          [0.17, 0.95, 0.0],
          [0.19, 0.9, -0.002],
          [0.2, 0.84, -0.004],
        ],
        0.03,
        0.006,
        8,
        () => new THREE.Vector3(1, 0, 0),
      ),
      { color: kit.webbing, mat: SOLDIER_MAT.nylon, bones: [B.pelvis, thigh], group },
    );
  }
}

function buildArmKit(kit: Kit, side: number, add: Add): void {
  const upper = side < 0 ? B.upperArmL : B.upperArmR;
  const group = armGroup(side);
  // Sleeve pocket with a loop field, lateral-front of the upper arm.
  const facing = 0.35;
  const cx = side * (0.1805 + 0.062 * Math.cos(facing));
  const cz = -0.013 - 0.062 * Math.sin(facing);
  const out: V3 = [side * Math.cos(facing), 0, -Math.sin(facing)];
  const pocket = rbox(0.08, 0.105, 0.018, 0.008, 2);
  pocket.rotateY(Math.PI);
  bendY(pocket, 0.06, 1);
  pocket.rotateY(Math.PI);
  add(orient(pocket, [cx, 1.3, cz], out), {
    color: 0xffffff,
    mat: SOLDIER_MAT.cloth,
    camo: true,
    bones: [upper],
    rigid: true,
    group,
  });
  const patch = rbox(0.066, 0.046, 0.005, 0.002, 1);
  add(orient(patch, [cx + out[0] * 0.01, 1.315, cz + out[2] * 0.01], out), {
    color: side < 0 ? (kit.face === "balaclava" ? 0x34362f : 0x8a7c60) : kit.gear,
    mat: SOLDIER_MAT.loop,
    bones: [upper],
    rigid: true,
    group,
  });
}

/* ------------------------------------------------------------------ */
/* Gloves                                                              */
/* ------------------------------------------------------------------ */

/**
 * A gloved fist closed round a bar, built in the rest pose. The bar runs
 * along z (index finger forward), on the palm side of the hand: a rifle grip
 * for the right hand once the animation turns the wrist, a handguard for the
 * left. Four separate fingers so the knuckle line and the gaps read.
 */
function buildGlove(kit: Kit, side: number, add: Add): void {
  const wx = side * 0.184;
  const wy = 0.862;
  const wz = 0;
  const group = armGroup(side);
  const hand = side < 0 ? B.handL : B.handR;
  const twist = side < 0 ? B.foreTwistL : B.foreTwistR;
  // Local frame: x toward the back of the hand (outboard), y up the arm, z
  // back. Built for the right hand, mirrored for the left.
  const barR = side < 0 ? 0.021 : 0.016;
  const bx = -(0.019 + barR);
  const by = -0.074;
  const parts: Array<{
    g: THREE.BufferGeometry;
    color: number;
    mat: SoldierMat;
    bones: readonly number[];
  }> = [];

  // Back of the hand / palm.
  const palm = rbox(0.032, 0.088, 0.086, 0.013, 2);
  palm.translate(-0.002, -0.045, 0.002);
  parts.push({ g: palm, color: kit.glove, mat: SOLDIER_MAT.nylon, bones: [hand] });
  // Knuckle guard.
  const guard = rbox(0.01, 0.024, 0.07, 0.004, 1);
  guard.translate(0.016, -0.074, 0.0);
  parts.push({ g: guard, color: kit.palm, mat: SOLDIER_MAT.rubber, bones: [hand] });

  // Fingers: index, middle, ring, pinky, front (-z) to back.
  const fingers = [
    { z: -0.03, r: 0.0098, sweep: 3.6 },
    { z: -0.0095, r: 0.0102, sweep: 3.75 },
    { z: 0.0115, r: 0.0098, sweep: 3.6 },
    { z: 0.031, r: 0.0086, sweep: 3.3 },
  ];
  for (const f of fingers) {
    const rings: SweepRing[] = [];
    const start = Math.atan2(-0.088 - by, 0.004 - bx);
    const arcR = barR + f.r * 1.05;
    const n = 12;
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const a = start - t * f.sweep;
      const rr = arcR + (i === 0 ? 0.004 : 0);
      const taper = 1 - t * 0.18;
      rings.push({
        c: [bx + Math.cos(a) * rr, by + Math.sin(a) * rr, f.z],
        a: f.r * taper,
        b: f.r * taper * 0.92,
      });
    }
    parts.push({
      g: sweep(rings, { seg: 8, capStart: true, capEnd: true, dome: 0.8, u: [0, 0, 1] }),
      color: kit.glove,
      mat: SOLDIER_MAT.nylon,
      bones: [hand],
    });
  }
  // Thumb: from the heel of the palm on the index side, over the fingers.
  {
    const path: V3[] = [
      [-0.006, -0.03, -0.032],
      [bx + 0.002, -0.05, -0.046],
      [bx - barR * 0.6, by - 0.012, -0.044],
      [bx - barR * 0.9, by - 0.03, -0.034],
    ];
    const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)));
    const rings: SweepRing[] = curve.getSpacedPoints(9).map((p, i) => ({
      c: [p.x, p.y, p.z],
      a: 0.012 * (1 - i * 0.025),
      b: 0.011 * (1 - i * 0.025),
    }));
    parts.push({
      g: sweep(rings, { seg: 8, capStart: true, capEnd: true, dome: 0.8, u: [1, 0, 0] }),
      color: kit.glove,
      mat: SOLDIER_MAT.nylon,
      bones: [hand],
    });
  }
  // Cuff over the sleeve end.
  {
    const rings: SweepRing[] = [
      { c: [0.0, 0.03, 0.0], a: 0.034, b: 0.036, p: 2.2 },
      { c: [0.0, 0.026, 0.0], a: 0.041, b: 0.043, p: 2.2 },
      { c: [0.0, 0.0, 0.0], a: 0.04, b: 0.044, p: 2.2 },
      { c: [0.0, -0.012, 0.0], a: 0.034, b: 0.042, p: 2.2 },
    ];
    parts.push({
      g: sweep(rings, { seg: 16, u: [1, 0, 0] }),
      color: kit.palm,
      mat: SOLDIER_MAT.nylon,
      bones: [twist, hand],
    });
  }

  for (const part of parts) {
    let g = part.g;
    if (side < 0) g = mirrorX(g);
    g.translate(wx, wy, wz);
    add(g, {
      color: part.color,
      mat: part.mat,
      bones: part.bones,
      rigid: part.bones.length === 1,
      group,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Boots                                                               */
/* ------------------------------------------------------------------ */

function buildBoot(kit: Kit, side: number, add: Add): void {
  const x = side * 0.1;
  const bones = bootBones(side);
  const group = legGroup(side);
  const upper: PartSpec = { color: kit.boot, mat: kit.bootMat, bones, group };

  // Shaft round the ankle, with a padded collar.
  add(
    sweep(
      [
        { c: [x, 0.07, 0.022], a: 0.05, b: 0.058, b2: 0.054 },
        { c: [x, 0.13, 0.024], a: 0.05, b: 0.052, b2: 0.054 },
        { c: [x, 0.19, 0.024], a: 0.054, b: 0.054, b2: 0.056 },
        { c: [x, 0.205, 0.024], a: 0.058, b: 0.058, b2: 0.06 },
        { c: [x, 0.214, 0.024], a: 0.052, b: 0.052, b2: 0.054 },
      ],
      { seg: 20, u: [1, 0, 0], capStart: true, capEnd: true, dome: 0.2 },
    ),
    upper,
  );
  // Foot: heel to toe, flat soled.
  const footRings: Array<[number, number, number, number, number]> = [
    // z, half-width, top, bottom, centre y
    [0.082, 0.036, 0.034, 0.034, 0.068],
    [0.06, 0.045, 0.06, 0.045, 0.074],
    [0.02, 0.048, 0.07, 0.048, 0.078],
    [-0.03, 0.05, 0.055, 0.045, 0.064],
    [-0.08, 0.052, 0.042, 0.038, 0.054],
    [-0.13, 0.05, 0.034, 0.034, 0.047],
    [-0.17, 0.044, 0.028, 0.03, 0.043],
    [-0.195, 0.034, 0.022, 0.027, 0.041],
    [-0.21, 0.018, 0.014, 0.02, 0.041],
  ];
  add(
    sweep(
      footRings.map(([z, w, top, bottom, y]) => ({
        c: [x, y, z],
        a: w,
        b: bottom,
        b2: top,
        p: 2.6,
      })),
      { seg: 20, u: [1, 0, 0], capStart: true, capEnd: true, dome: 0.5 },
    ),
    upper,
  );
  // Toe cap and heel counter in rubberised overlay.
  add(place(rbox(0.1, 0.03, 0.06, 0.014, 2), x, 0.038, -0.175), {
    color: kit.sole,
    mat: SOLDIER_MAT.rubber,
    rough: 0.8,
    bones,
    group,
  });
  // Lacing panel down the front of the shaft and instep.
  add(
    strap(
      [
        [x, 0.205, -0.03],
        [x, 0.15, -0.034],
        [x, 0.11, -0.042],
        [x, 0.085, -0.075],
        [x, 0.075, -0.1],
      ],
      0.026,
      0.008,
      14,
      (p) => new THREE.Vector3(0, p.y < 0.1 ? 0.8 : 0.1, -1).normalize(),
    ),
    { color: 0x2c2822, mat: SOLDIER_MAT.knit, bones, group },
  );
  // Outsole and heel block, proud of the upper.
  add(place(rbox(0.108, 0.026, 0.298, 0.01, 2), x, 0.015, -0.062), {
    color: kit.sole,
    mat: SOLDIER_MAT.rubber,
    bones,
    rigid: false,
    group,
  });
  add(place(rbox(0.1, 0.022, 0.075, 0.008, 1), x, 0.03, 0.045), {
    color: kit.sole,
    mat: SOLDIER_MAT.rubber,
    bones: [side < 0 ? B.footL : B.footR],
    rigid: true,
    group,
  });
}

/* ------------------------------------------------------------------ */
/* Skinning                                                            */
/* ------------------------------------------------------------------ */

const _w = [0, 0, 0, 0];
const _bi = [0, 0, 0, 0];

/** Up to four weights from the candidate bones, by inverse distance. */
function weightsAt(
  bones: readonly number[],
  x: number,
  y: number,
  z: number,
  outIndex: number[],
  outWeight: number[],
): void {
  const dist = [Infinity, Infinity, Infinity, Infinity];
  for (let i = 0; i < 4; i += 1) {
    outIndex[i] = bones[0]!;
    outWeight[i] = 0;
  }
  for (const bone of bones) {
    const d = restSegmentDistanceSq(bone, x, y, z);
    for (let k = 0; k < 4; k += 1) {
      if (d < dist[k]!) {
        for (let m = 3; m > k; m -= 1) {
          dist[m] = dist[m - 1]!;
          outIndex[m] = outIndex[m - 1]!;
        }
        dist[k] = d;
        outIndex[k] = bone;
        break;
      }
    }
  }
  let total = 0;
  for (let i = 0; i < 4; i += 1) {
    if (!Number.isFinite(dist[i]!)) {
      outWeight[i] = 0;
      continue;
    }
    const w = 1 / Math.pow(Math.sqrt(dist[i]!) + 0.012, 3);
    outWeight[i] = w;
    total += w;
  }
  for (let i = 0; i < 4; i += 1)
    outWeight[i] = total > 0 ? outWeight[i]! / total : i === 0 ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* Cache and assembly                                                  */
/* ------------------------------------------------------------------ */

interface CachedBuild {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  refs: number;
}

const cache = new Map<string, CachedBuild>();
const _color = new THREE.Color();

function buildGeometry(team: Team, variant: SoldierVariant): CachedBuild {
  const key = `${team}:${variant}`;
  const existing = cache.get(key);
  if (existing) {
    existing.refs += 1;
    return existing;
  }

  const kit = KITS[team];
  const parts = buildParts(kit, variant);

  // Per-part attributes, then one merge.
  const prepared: THREE.BufferGeometry[] = [];
  const groupRuns: Array<[number, AoGroup]> = [];
  for (const part of parts) {
    const geometry = part.geometry;
    const position = geometry.getAttribute("position");
    const count = position.count;
    const colors = new Float32Array(count * 3);
    _color.setHex(part.color);
    const pbr = new Float32Array(count * 4);
    const skinIndex = new Uint16Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let v = 0; v < count; v += 1) {
      cx += position.getX(v);
      cy += position.getY(v);
      cz += position.getZ(v);
    }
    if (part.rigid) weightsAt(part.bones, cx / count, cy / count, cz / count, _bi, _w);
    for (let v = 0; v < count; v += 1) {
      colors[v * 3] = _color.r;
      colors[v * 3 + 1] = _color.g;
      colors[v * 3 + 2] = _color.b;
      pbr[v * 4] = part.rough;
      pbr[v * 4 + 1] = part.metal;
      pbr[v * 4 + 2] = part.mat;
      pbr[v * 4 + 3] = part.camo ? 1 : 0;
      if (!part.rigid)
        weightsAt(
          part.bones,
          position.getX(v),
          position.getY(v),
          position.getZ(v),
          _bi,
          _w,
        );
      for (let k = 0; k < 4; k += 1) {
        skinIndex[v * 4 + k] = _bi[k]!;
        skinWeight[v * 4 + k] = _w[k]!;
      }
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("pbr", new THREE.Float32BufferAttribute(pbr, 4));
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
    groupRuns.push([count, part.group]);
    prepared.push(geometry);
  }

  const merged = mergeGeometries(prepared, false);
  for (const geometry of prepared) geometry.dispose();

  // Bakes need the merged arrays.
  const position = merged.getAttribute("position").array as Float32Array;
  const normal = merged.getAttribute("normal").array as Float32Array;
  const count = position.length / 3;
  const groups = new Uint8Array(count);
  let cursor = 0;
  for (const [n, g] of groupRuns) {
    groups.fill(g, cursor, cursor + n);
    cursor += n;
  }
  const occ = new Float32Array(count * 2);
  bakeOcclusion(position, normal, merged.getIndex()!.array, groups, occ);
  merged.setAttribute("occ", new THREE.Float32BufferAttribute(occ, 2));
  merged.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    name: `soldier-${team}-${variant}`,
    vertexColors: true,
    roughness: 0.86,
    metalness: 0,
    // Under unity: the daytime sky over-fills fabric at 1.0 and a soldier's
    // shadow side stops reading as shadow.
    envMapIntensity: 0.6,
  });
  applySoldierShade(material, kit.camo);

  const build: CachedBuild = { geometry: merged, material, refs: 1 };
  cache.set(key, build);
  return build;
}

/* ------------------------------------------------------------------ */
/* Public                                                              */
/* ------------------------------------------------------------------ */

/**
 * A generous fixed bound in model space, so skinned soldiers can be frustum
 * culled without recomputing a sphere from the posed vertices every frame.
 * Covers a raised rifle, a prone body and the death topple about the feet.
 */
const BOUND = new THREE.Sphere(new THREE.Vector3(0, 0.85, 0), 1.45);

export function buildSoldier(options: SoldierOptions): SoldierModel {
  const variant = options.variant ?? ((options.seed % 3) as SoldierVariant);
  const build = buildGeometry(options.team, variant);

  const bones = createBones();
  const skeleton = createSkeleton(bones);
  const mesh = new THREE.SkinnedMesh(build.geometry, build.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.boundingSphere = BOUND.clone();
  mesh.frustumCulled = true;
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
