import * as THREE from "three";
import type { HitRegion } from "../core/types";

/**
 * The one skeleton every character system agrees on.
 *
 * `soldier.ts` skins geometry to it, `animation.ts` rotates it, `hitboxes.ts`
 * hangs colliders off it and `ragdoll.ts` simulates a particle per bone. All
 * four index bones through the `B` table below, so the bone order is a hard
 * contract inside this directory.
 *
 * Two conventions make everything downstream simple:
 *
 *  - **Rest rotations are identity.** A bone's rest world matrix is a pure
 *    translation, so `boneInverse = translate(-restPos)` and a bone's "axis" is
 *    just `normalize(tip - rest)` in model space. Two-bone IK and the ragdoll
 *    both lean on this.
 *  - **Model space is metres, feet at y = 0, facing -z.** That matches
 *    `Actor.yaw` (0 looks north / -z) and `HUMAN_METRICS` (1.8 m standing).
 *
 * Proportions follow the 8-head canon for a 1.8 m infantryman: head 0.225 m,
 * biacromial width 0.40 m, 0.43 m thigh, 0.40 m shin, 0.29 m upper arm,
 * 0.25 m forearm.
 */

/* ------------------------------------------------------------------ */
/* Bone table                                                          */
/* ------------------------------------------------------------------ */

export const B = {
  root: 0,
  pelvis: 1,
  spine1: 2,
  spine2: 3,
  spine3: 4,
  neck: 5,
  head: 6,
  headTop: 7,
  clavicleL: 8,
  upperArmL: 9,
  foreArmL: 10,
  foreTwistL: 11,
  handL: 12,
  thumbL: 13,
  indexL: 14,
  gripL: 15,
  clavicleR: 16,
  upperArmR: 17,
  foreArmR: 18,
  foreTwistR: 19,
  handR: 20,
  thumbR: 21,
  indexR: 22,
  gripR: 23,
  thighL: 24,
  shinL: 25,
  footL: 26,
  toeL: 27,
  thighR: 28,
  shinR: 29,
  footR: 30,
  toeR: 31,
  weapon: 32,
  gearRoot: 33,
} as const;

export type BoneKey = keyof typeof B;

export const BONE_COUNT = 34;

interface BoneSpec {
  readonly name: BoneKey;
  readonly parent: number;
  /** Rest position in model space, metres. */
  readonly p: readonly [number, number, number];
  /**
   * Explicit tip for leaf bones (bones with no child that defines their axis).
   * Interior bones derive their tip from their primary child.
   */
  readonly tip?: readonly [number, number, number];
}

/** Indexed by the values in `B` — order is load-bearing. */
const SPECS: readonly BoneSpec[] = [
  { name: "root", parent: -1, p: [0, 0, 0] },
  { name: "pelvis", parent: B.root, p: [0, 0.955, 0.005] },
  { name: "spine1", parent: B.pelvis, p: [0, 1.065, -0.004] },
  { name: "spine2", parent: B.spine1, p: [0, 1.185, -0.012] },
  { name: "spine3", parent: B.spine2, p: [0, 1.31, -0.008] },
  { name: "neck", parent: B.spine3, p: [0, 1.455, 0.01] },
  { name: "head", parent: B.neck, p: [0, 1.56, 0.006] },
  { name: "headTop", parent: B.head, p: [0, 1.8, 0], tip: [0, 1.862, 0] },

  { name: "clavicleL", parent: B.spine3, p: [-0.042, 1.408, -0.02] },
  { name: "upperArmL", parent: B.clavicleL, p: [-0.18, 1.4, -0.014] },
  { name: "foreArmL", parent: B.upperArmL, p: [-0.182, 1.11, -0.008] },
  { name: "foreTwistL", parent: B.foreArmL, p: [-0.183, 0.985, -0.004] },
  { name: "handL", parent: B.foreTwistL, p: [-0.184, 0.862, 0] },
  { name: "thumbL", parent: B.handL, p: [-0.152, 0.832, -0.03], tip: [-0.128, 0.798, -0.056] },
  { name: "indexL", parent: B.handL, p: [-0.196, 0.796, -0.014], tip: [-0.198, 0.733, -0.03] },
  { name: "gripL", parent: B.handL, p: [-0.186, 0.792, 0.018], tip: [-0.186, 0.729, 0.012] },

  { name: "clavicleR", parent: B.spine3, p: [0.042, 1.408, -0.02] },
  { name: "upperArmR", parent: B.clavicleR, p: [0.18, 1.4, -0.014] },
  { name: "foreArmR", parent: B.upperArmR, p: [0.182, 1.11, -0.008] },
  { name: "foreTwistR", parent: B.foreArmR, p: [0.183, 0.985, -0.004] },
  { name: "handR", parent: B.foreTwistR, p: [0.184, 0.862, 0] },
  { name: "thumbR", parent: B.handR, p: [0.152, 0.832, -0.03], tip: [0.128, 0.798, -0.056] },
  { name: "indexR", parent: B.handR, p: [0.196, 0.796, -0.014], tip: [0.198, 0.733, -0.03] },
  { name: "gripR", parent: B.handR, p: [0.186, 0.792, 0.018], tip: [0.186, 0.729, 0.012] },

  { name: "thighL", parent: B.pelvis, p: [-0.095, 0.918, 0.004] },
  { name: "shinL", parent: B.thighL, p: [-0.098, 0.487, 0.012] },
  { name: "footL", parent: B.shinL, p: [-0.1, 0.086, 0.026] },
  { name: "toeL", parent: B.footL, p: [-0.1, 0.03, -0.122], tip: [-0.1, 0.018, -0.205] },

  { name: "thighR", parent: B.pelvis, p: [0.095, 0.918, 0.004] },
  { name: "shinR", parent: B.thighR, p: [0.098, 0.487, 0.012] },
  { name: "footR", parent: B.shinR, p: [0.1, 0.086, 0.026] },
  { name: "toeR", parent: B.footR, p: [0.1, 0.03, -0.122], tip: [0.1, 0.018, -0.205] },

  { name: "weapon", parent: B.handR, p: [0.15, 0.845, -0.075], tip: [0.15, 0.845, -0.44] },
  { name: "gearRoot", parent: B.spine3, p: [0, 1.285, 0.085], tip: [0, 1.19, 0.092] },
];

/** Which child gives an interior bone its axis. */
const PRIMARY_CHILD: Readonly<Record<number, number>> = {
  [B.root]: B.pelvis,
  [B.pelvis]: B.spine1,
  [B.spine1]: B.spine2,
  [B.spine2]: B.spine3,
  [B.spine3]: B.neck,
  [B.neck]: B.head,
  [B.head]: B.headTop,
  [B.clavicleL]: B.upperArmL,
  [B.upperArmL]: B.foreArmL,
  [B.foreArmL]: B.foreTwistL,
  [B.foreTwistL]: B.handL,
  [B.handL]: B.gripL,
  [B.clavicleR]: B.upperArmR,
  [B.upperArmR]: B.foreArmR,
  [B.foreArmR]: B.foreTwistR,
  [B.foreTwistR]: B.handR,
  [B.handR]: B.gripR,
  [B.thighL]: B.shinL,
  [B.shinL]: B.footL,
  [B.footL]: B.toeL,
  [B.thighR]: B.shinR,
  [B.shinR]: B.footR,
  [B.footR]: B.toeR,
};

export const BONE_NAMES: readonly BoneKey[] = SPECS.map((s) => s.name);
export const BONE_PARENT: Int32Array = new Int32Array(BONE_COUNT);
/** Rest position of every bone, model space, packed xyz. */
export const REST_POS: Float32Array = new Float32Array(BONE_COUNT * 3);
/** Tip of every bone, model space, packed xyz. `tip - rest` is the bone axis. */
export const REST_TIP: Float32Array = new Float32Array(BONE_COUNT * 3);
/** `|tip - rest|` per bone; the segment length the IK solvers use. */
export const BONE_LENGTH: Float32Array = new Float32Array(BONE_COUNT);

for (let i = 0; i < BONE_COUNT; i += 1) {
  const spec = SPECS[i]!;
  BONE_PARENT[i] = spec.parent;
  REST_POS[i * 3] = spec.p[0];
  REST_POS[i * 3 + 1] = spec.p[1];
  REST_POS[i * 3 + 2] = spec.p[2];
}
for (let i = 0; i < BONE_COUNT; i += 1) {
  const spec = SPECS[i]!;
  const child = PRIMARY_CHILD[i];
  let tx: number;
  let ty: number;
  let tz: number;
  if (spec.tip) {
    tx = spec.tip[0];
    ty = spec.tip[1];
    tz = spec.tip[2];
  } else if (child !== undefined) {
    tx = REST_POS[child * 3]!;
    ty = REST_POS[child * 3 + 1]!;
    tz = REST_POS[child * 3 + 2]!;
  } else {
    tx = REST_POS[i * 3]!;
    ty = REST_POS[i * 3 + 1]! - 0.05;
    tz = REST_POS[i * 3 + 2]!;
  }
  REST_TIP[i * 3] = tx;
  REST_TIP[i * 3 + 1] = ty;
  REST_TIP[i * 3 + 2] = tz;
  BONE_LENGTH[i] = Math.hypot(
    tx - REST_POS[i * 3]!,
    ty - REST_POS[i * 3 + 1]!,
    tz - REST_POS[i * 3 + 2]!,
  );
}

/** Unit rest axis of each bone in model space (== bone-local, rest is identity). */
export const REST_AXIS: Float32Array = new Float32Array(BONE_COUNT * 3);
for (let i = 0; i < BONE_COUNT; i += 1) {
  const len = BONE_LENGTH[i]! || 1;
  REST_AXIS[i * 3] = (REST_TIP[i * 3]! - REST_POS[i * 3]!) / len;
  REST_AXIS[i * 3 + 1] = (REST_TIP[i * 3 + 1]! - REST_POS[i * 3 + 1]!) / len;
  REST_AXIS[i * 3 + 2] = (REST_TIP[i * 3 + 2]! - REST_POS[i * 3 + 2]!) / len;
}

/* ------------------------------------------------------------------ */
/* Convenience bone groups                                             */
/* ------------------------------------------------------------------ */

export const SPINE_CHAIN: readonly number[] = [B.spine1, B.spine2, B.spine3];
export const LEG_CHAIN_L: readonly number[] = [B.thighL, B.shinL, B.footL, B.toeL];
export const LEG_CHAIN_R: readonly number[] = [B.thighR, B.shinR, B.footR, B.toeR];
export const ARM_CHAIN_L: readonly number[] = [B.clavicleL, B.upperArmL, B.foreArmL, B.foreTwistL, B.handL];
export const ARM_CHAIN_R: readonly number[] = [B.clavicleR, B.upperArmR, B.foreArmR, B.foreTwistR, B.handR];
export const FINGER_BONES: readonly number[] = [
  B.thumbL, B.indexL, B.gripL, B.thumbR, B.indexR, B.gripR,
];

/** Which bone a damage region should push on when a ragdoll takes its impulse. */
export const REGION_BONE: Readonly<Record<HitRegion, number>> = {
  head: B.head,
  neck: B.neck,
  chest: B.spine3,
  stomach: B.spine1,
  arm: B.foreArmR,
  leg: B.thighR,
  foot: B.footR,
};

/* ------------------------------------------------------------------ */
/* Construction                                                        */
/* ------------------------------------------------------------------ */

/**
 * Build a fresh bone hierarchy in the rest pose. `bones[B.root]` is the
 * hierarchy root; parent it under the character's group before binding.
 */
export function createBones(): THREE.Bone[] {
  const bones: THREE.Bone[] = new Array<THREE.Bone>(BONE_COUNT);
  for (let i = 0; i < BONE_COUNT; i += 1) {
    const bone = new THREE.Bone();
    bone.name = BONE_NAMES[i]!;
    bones[i] = bone;
  }
  for (let i = 0; i < BONE_COUNT; i += 1) {
    const bone = bones[i]!;
    const parent = BONE_PARENT[i]!;
    const px = parent >= 0 ? REST_POS[parent * 3]! : 0;
    const py = parent >= 0 ? REST_POS[parent * 3 + 1]! : 0;
    const pz = parent >= 0 ? REST_POS[parent * 3 + 2]! : 0;
    bone.position.set(
      REST_POS[i * 3]! - px,
      REST_POS[i * 3 + 1]! - py,
      REST_POS[i * 3 + 2]! - pz,
    );
    if (parent >= 0) bones[parent]!.add(bone);
  }
  bones[B.root]!.updateMatrixWorld(true);
  return bones;
}

/** Skeleton with analytically derived bind inverses (rest rotations are identity). */
export function createSkeleton(bones: readonly THREE.Bone[]): THREE.Skeleton {
  const inverses: THREE.Matrix4[] = new Array<THREE.Matrix4>(BONE_COUNT);
  for (let i = 0; i < BONE_COUNT; i += 1) {
    inverses[i] = new THREE.Matrix4().makeTranslation(
      -REST_POS[i * 3]!,
      -REST_POS[i * 3 + 1]!,
      -REST_POS[i * 3 + 2]!,
    );
  }
  return new THREE.Skeleton(bones as THREE.Bone[], inverses);
}

/** Reset every bone to its rest transform. */
export function resetToRest(bones: readonly THREE.Bone[]): void {
  for (let i = 0; i < BONE_COUNT; i += 1) {
    const bone = bones[i];
    if (!bone) continue;
    const parent = BONE_PARENT[i]!;
    const px = parent >= 0 ? REST_POS[parent * 3]! : 0;
    const py = parent >= 0 ? REST_POS[parent * 3 + 1]! : 0;
    const pz = parent >= 0 ? REST_POS[parent * 3 + 2]! : 0;
    bone.position.set(
      REST_POS[i * 3]! - px,
      REST_POS[i * 3 + 1]! - py,
      REST_POS[i * 3 + 2]! - pz,
    );
    bone.quaternion.set(0, 0, 0, 1);
    bone.scale.set(1, 1, 1);
  }
}

/** Squared distance from a point to the rest segment of bone `i`. */
export function restSegmentDistanceSq(
  i: number,
  x: number,
  y: number,
  z: number,
): number {
  const ax = REST_POS[i * 3]!;
  const ay = REST_POS[i * 3 + 1]!;
  const az = REST_POS[i * 3 + 2]!;
  const bx = REST_TIP[i * 3]!;
  const by = REST_TIP[i * 3 + 1]!;
  const bz = REST_TIP[i * 3 + 2]!;
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const lenSq = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (lenSq > 1e-12) {
    t = ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / lenSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const px = ax + dx * t - x;
  const py = ay + dy * t - y;
  const pz = az + dz * t - z;
  return px * px + py * py + pz * pz;
}
