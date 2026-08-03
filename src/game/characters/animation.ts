import * as THREE from "three";
import type { Actor } from "../core/gameState";
import { forwardToYaw, yawDelta } from "../core/types";
import {
  B,
  BONE_LENGTH,
  CHAIN_TO_CLAVICLE_L,
  CHAIN_TO_WEAPON,
  REST_POS,
  chainPose,
  resetToRest,
} from "./rig";
import { solveTwoBone } from "./ik";

/**
 * Procedural character animation.
 *
 * No clip data: every pose is computed from the actor's own state.
 *
 * The legs are placed, not rotated. Each foot follows an explicit trajectory —
 * planted through stance, an arc through swing — and two-bone IK works out
 * what the hip and knee have to do to get it there. That inversion is the
 * whole design, and it buys three things a hand-rotated gait cannot have:
 *
 *  - **No foot sliding.** Stride length, duty factor and cadence are tied to
 *    the actor's measured speed by `stride = speed x duty x period`, so a
 *    planted foot travels backward at exactly the speed the body travels
 *    forward. Cadence falls out at 112 steps/min walking and 171 running,
 *    which is roughly where people actually walk and run.
 *  - **No hyperextension.** The solver clamps reach below full extension, so
 *    the knee is physically incapable of straightening through, whatever
 *    target it is handed.
 *  - **Ground adaptation.** Foot targets are dropped onto the sampled ground
 *    height, so a soldier on a slope stands with one leg more flexed than the
 *    other instead of hovering or sinking.
 *
 * On top of the legs sit an aim layer that twists the spine toward whatever
 * the actor is looking at, a stance blend, an off-hand IK pass that puts the
 * support hand on the weapon's handguard, and additive flinch and recoil.
 *
 * Everything is written straight into bone quaternions from preallocated
 * scratch objects — the update path allocates nothing.
 */

/* ------------------------------------------------------------------ */
/* Rig-derived constants                                               */
/* ------------------------------------------------------------------ */

function restDistance(a: number, b: number): number {
  return Math.hypot(
    REST_POS[a * 3]! - REST_POS[b * 3]!,
    REST_POS[a * 3 + 1]! - REST_POS[b * 3 + 1]!,
    REST_POS[a * 3 + 2]! - REST_POS[b * 3 + 2]!,
  );
}

const PELVIS_REST_Y = REST_POS[B.pelvis * 3 + 1]!;
const PELVIS_REST_Z = REST_POS[B.pelvis * 3 + 2]!;
const ANKLE_REST_X = Math.abs(REST_POS[B.footL * 3]!);
const ANKLE_REST_Y = REST_POS[B.footL * 3 + 1]!;
const ANKLE_REST_Z = REST_POS[B.footL * 3 + 2]!;

const THIGH_LEN = BONE_LENGTH[B.thighL]!;
const SHIN_LEN = BONE_LENGTH[B.shinL]!;
/** Usable leg reach; the solver's own clamp sits just inside this. */
const LEG_REACH = (THIGH_LEN + SHIN_LEN) * 0.985;

const UPPER_ARM_LEN = BONE_LENGTH[B.upperArmL]!;
/** The forearm spans a twist bone, so its reach is elbow-to-hand, not one bone. */
const FOREARM_LEN = restDistance(B.foreArmL, B.handL);

/**
 * The furthest a foot may sweep, front to back, relative to the hips.
 *
 * This is the constraint that keeps the whole gait honest. A planted foot has
 * to travel backward at exactly body speed, so speed, cadence and sweep are
 * not independent — pick two and the third follows. Past roughly 3.5 m/s the
 * preferred cadence would demand a sweep longer than a leg can make, and the
 * cadence rises to hold this instead. Which is what sprinting actually is.
 */
const MAX_EXCURSION = 0.86;
/** Fraction of the sweep that lies ahead of the hip at contact. */
const FRONT_BIAS = 0.4;

/* ------------------------------------------------------------------ */
/* Scratch                                                             */
/* ------------------------------------------------------------------ */

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _pelvisQuat = new THREE.Quaternion();
const _pelvisInv = new THREE.Quaternion();
const _pelvisPos = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _hipLocal = new THREE.Vector3();
const _footLocal = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _poleLocal = new THREE.Vector3();
const _shinQuat = new THREE.Quaternion();
const _footQuat = new THREE.Quaternion();
const _stride = new THREE.Vector3();
const _weaponPos = new THREE.Vector3();
const _weaponQuat = new THREE.Quaternion();
const _grip = new THREE.Vector3();
const _clavPos = new THREE.Vector3();
const _clavQuat = new THREE.Quaternion();
const _clavInv = new THREE.Quaternion();
const _armOrigin = new THREE.Vector3();
const _armTarget = new THREE.Vector3();
const _armPole = new THREE.Vector3();
const _savedUpper = new THREE.Quaternion();
const _savedFore = new THREE.Quaternion();
const _solvedUpper = new THREE.Quaternion();
const _solvedFore = new THREE.Quaternion();

/** Per-foot working state, so the two legs can be solved from one code path. */
interface FootPlan {
  /** Target in model space. */
  readonly target: THREE.Vector3;
  /** Ankle pitch: positive lifts the toe. */
  pitch: number;
  /** Model-space heading the foot points along. */
  yaw: number;
}

const _plan: readonly [FootPlan, FootPlan] = [
  { target: new THREE.Vector3(), pitch: 0, yaw: 0 },
  { target: new THREE.Vector3(), pitch: 0, yaw: 0 },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function setEuler(bone: THREE.Bone, x: number, y: number, z: number): void {
  _e.set(x, y, z, "YXZ");
  bone.quaternion.setFromEuler(_e);
}

function addEuler(bone: THREE.Bone, x: number, y: number, z: number): void {
  _e.set(x, y, z, "YXZ");
  _q.setFromEuler(_e);
  bone.quaternion.multiply(_q);
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

/** Ankle pitch through the planted phase: heel strike, flat, then toe-off. */
function stanceRoll(s: number): number {
  if (s < 0.18) return (1 - s / 0.18) * 0.24;
  if (s > 0.7) {
    const t = (s - 0.7) / 0.3;
    return -t * t * 0.58;
  }
  return 0;
}

/**
 * How far the ankle sits above the flat through stance.
 *
 * The foot is only flat through the middle of it: at contact the heel is down
 * and the ankle rides above it, and at push-off the whole body is over the
 * toes. Both raise the ankle, which is what lets the leg reach the ends of the
 * sweep without straightening through — the same geometry the ankle pitch is
 * already describing, told to the IK so the two agree.
 */
function stanceRise(s: number): number {
  const heel = Math.max(0, 1 - s / 0.16) * 0.06;
  const toe = s > 0.72 ? ((s - 0.72) / 0.28) ** 1.5 * 0.13 : 0;
  return heel + toe;
}

/** Ankle pitch through swing: recover from toe-off, dorsiflex to land heel-first. */
function swingRoll(s: number): number {
  return THREE.MathUtils.lerp(-0.58, 0.24, THREE.MathUtils.smoothstep(s, 0, 0.55));
}

/** Ankle height through swing, matching `stanceRise` at both ends. */
function swingRise(s: number): number {
  return THREE.MathUtils.lerp(0.13, 0.06, THREE.MathUtils.smoothstep(s, 0, 0.6));
}

export class CharacterAnimator {
  /** Gait phase in radians; one full cycle (both feet) is 2 pi. */
  private phase = 0;
  private crouch = 0;
  private prone = 0;
  private lean = 0;
  /** Body yaw, which lags the aim yaw so the torso twists before the feet turn. */
  private bodyYaw = 0;
  /** Model-space heading of travel; 0 is straight ahead. */
  private strideYaw = 0;
  private flinch = 0;
  private flinchSide = 0;
  private fire = 0;
  private deathTime = -1;
  private lastSpeed = 0;

  /**
   * World-space ground height sampler. Injected rather than imported so the
   * animation layer never reaches into the physics module; left null, feet
   * plant on the actor's own ground plane.
   */
  groundAt: ((x: number, z: number) => number) | null = null;

  reset(actor: Actor): void {
    this.phase = 0;
    this.bodyYaw = actor.yaw;
    this.strideYaw = 0;
    this.crouch = 0;
    this.prone = 0;
    this.flinch = 0;
    this.fire = 0;
    this.deathTime = -1;
  }

  /** Called when the actor takes a hit, to add a directional flinch. */
  hit(direction: number): void {
    this.flinch = Math.min(1, this.flinch + 0.6);
    this.flinchSide = Math.sign(direction) || 1;
  }

  /** Called on each shot the actor fires. */
  recoil(): void {
    this.fire = 1;
  }

  /**
   * `detail` enables the per-foot ground sampling and the off-hand IK. Both
   * are only legible up close, and the ground sampler is the most expensive
   * thing in this function, so distant characters skip them.
   */
  update(
    bones: readonly THREE.Bone[],
    group: THREE.Object3D,
    actor: Actor,
    dt: number,
    detail = true,
  ): void {
    this.lastSpeed = damp(this.lastSpeed, actor.speed, 12, dt);

    if (!actor.alive) {
      if (this.deathTime < 0) this.deathTime = 0;
      this.deathTime += dt;
      this.applyDeath(bones, group);
      return;
    }
    this.deathTime = -1;

    resetToRest(bones);

    /* ------------------------------------------------------- stance */
    this.crouch = damp(this.crouch, actor.stance === "stand" ? 0 : 1, 9, dt);
    this.prone = damp(this.prone, actor.stance === "prone" ? 1 : 0, 6, dt);

    /* ---------------------------------------------------- body yaw */
    // The body turns to follow the aim, but lazily: the spine takes up the
    // difference first, and the feet only catch up once it exceeds a limit.
    // This runs before the gait because it defines the model space the feet
    // are placed in.
    const moving = THREE.MathUtils.smoothstep(this.lastSpeed, 0.2, 1.1);
    const yawError = yawDelta(this.bodyYaw, actor.yaw);
    const twistLimit = 0.62;
    const overrun = Math.max(0, Math.abs(yawError) - twistLimit) * Math.sign(yawError);
    this.bodyYaw += overrun + yawError * Math.min(1, dt * (moving > 0.1 ? 9 : 3.2));
    group.rotation.y = this.bodyYaw;

    /* --------------------------------------------------------- gait */
    // Where the actor is actually travelling, in model space, so that
    // strafing side-steps instead of moon-walking.
    const cosBody = Math.cos(this.bodyYaw);
    const sinBody = Math.sin(this.bodyYaw);
    const vx = actor.velocity.x;
    const vz = actor.velocity.z;
    if (vx * vx + vz * vz > 0.12) {
      const targetYaw = forwardToYaw(vx * cosBody - vz * sinBody, vx * sinBody + vz * cosBody);
      this.strideYaw += yawDelta(this.strideYaw, targetYaw) * (1 - Math.exp(-9 * dt));
    } else {
      this.strideYaw = damp(this.strideYaw, 0, 6, dt);
    }

    // The walk-to-run transition, which is a change of gait rather than a
    // change of pace: duty factor falls off a cliff at about 2 m/s as the
    // double-support phase disappears and a flight phase opens up.
    const run = THREE.MathUtils.smoothstep(this.lastSpeed, 1.6, 3.2);
    const duty = (0.6 - run * 0.24) * (1 + this.crouch * 0.06);
    const lift = 0.055 + run * 0.115;
    const speed = Math.max(0.25, this.lastSpeed);

    // Preferred cadence, then the excursion cap. Whichever wants the shorter
    // period wins, so the feet stay under the body at any speed.
    const stepsPerSec = (1.8 + run * 1.1) * (1 + this.crouch * 0.12);
    const period = Math.min(2 / stepsPerSec, MAX_EXCURSION / (speed * duty));
    const excursion = speed * duty * period * (1 - this.crouch * 0.22);

    this.phase += (2 * Math.PI * dt) / period;
    if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;

    _stride.set(-Math.sin(this.strideYaw), 0, -Math.cos(this.strideYaw));

    /* -------------------------------------------------- foot targets */
    const groundY = detail ? this.groundAt : null;
    for (let i = 0; i < 2; i += 1) {
      const side = i === 0 ? -1 : 1;
      const plan = _plan[i]!;
      // The right foot is half a cycle behind the left.
      let u = (this.phase / (Math.PI * 2) + (i === 0 ? 0 : 0.5)) % 1;
      if (u < 0) u += 1;

      let along: number;
      let height: number;
      let pitch: number;
      if (u < duty) {
        // Planted: the foot holds still on the ground, so relative to the hips
        // it slides straight back at exactly body speed. No sliding to hide.
        const s = u / duty;
        along = (FRONT_BIAS - s) * excursion;
        height = stanceRise(s);
        pitch = stanceRoll(s);
      } else {
        // Swinging: back to front on an eased curve, over a lift arc.
        const s = (u - duty) / (1 - duty);
        along = (FRONT_BIAS - 1 + s * s * (3 - 2 * s)) * excursion;
        height = swingRise(s) + lift * Math.sin(Math.PI * s);
        pitch = swingRoll(s);
      }

      // Stance widens a little when crouched, and the legs trail when prone.
      const spread = ANKLE_REST_X * (1 + this.crouch * 0.3) * side;
      const proneBack = this.prone * 0.62;
      const x = spread + _stride.x * along * moving;
      const z = ANKLE_REST_Z + _stride.z * along * moving + proneBack;

      // Drop the target onto the ground. `actor.position.y` is already the
      // ground under the actor's centre, so this only needs the local
      // difference — clamped, so a soldier standing on a container does not
      // stretch a leg down to the terrain far below it.
      let lift0 = 0;
      if (groundY) {
        const wx = actor.position.x + x * cosBody + z * sinBody;
        const wz = actor.position.z - x * sinBody + z * cosBody;
        lift0 = THREE.MathUtils.clamp(groundY(wx, wz) - actor.position.y, -0.35, 0.35);
      }

      plan.target.set(
        x,
        lift0 + (ANKLE_REST_Y + height * moving) * (1 - this.prone * 0.55),
        z,
      );
      plan.pitch = pitch * moving * (1 - this.prone);
      plan.yaw = this.strideYaw * moving - side * 0.1;
    }

    /* ------------------------------------------------------- pelvis */
    // Highest at mid-stance on either leg, so the bob runs at twice the step
    // rate and lines up with single support rather than against it.
    const bob = Math.cos(2 * (this.phase - Math.PI * duty)) * (0.012 + run * 0.018) * moving;
    let pelvisY = PELVIS_REST_Y - this.crouch * 0.33 - this.prone * 0.62 + bob;

    const sin = Math.sin(this.phase);
    const hipRoll = sin * 0.055 * moving;
    const hipYaw = -sin * 0.11 * moving;
    const hipPitch = this.crouch * 0.26 + this.prone * 1.2 + run * 0.09 * moving;

    _e.set(hipPitch, hipYaw, hipRoll, "YXZ");
    _pelvisQuat.setFromEuler(_e);

    // Drop the hips until both feet are within reach.
    //
    // This is what carves most of the vertical oscillation, and it does it for
    // the right reason: the pelvis is lowest exactly when a leg is stretched
    // furthest, which is double support. Without it a long stride would pull
    // the trailing foot up off the ground rather than extend the leg — the
    // floating gait that gives procedural animation away.
    //
    // Solved rather than iterated. Lowering the hips shortens the distance to
    // the foot by less than the drop itself, so a subtract-the-excess pass
    // under-corrects, the solver clamps the remainder, and the planted foot
    // creeps. The exact height is one square root away.
    for (let i = 0; i < 2; i += 1) {
      const thigh = i === 0 ? B.thighL : B.thighR;
      const target = _plan[i]!.target;
      _hip.copy(bones[thigh]!.position).applyQuaternion(_pelvisQuat);
      const dx = _hip.x - target.x;
      const dz = _hip.z + PELVIS_REST_Z - target.z;
      const horizontal = dx * dx + dz * dz;
      const vertical = Math.sqrt(Math.max(0, LEG_REACH * LEG_REACH - horizontal));
      const needed = target.y - _hip.y + vertical;
      if (needed < pelvisY) pelvisY = Math.max(needed, PELVIS_REST_Y - 0.62);
    }

    _pelvisPos.set(0, pelvisY, PELVIS_REST_Z);
    _pelvisInv.copy(_pelvisQuat).invert();

    bones[B.pelvis]!.position.set(0, pelvisY, PELVIS_REST_Z);
    bones[B.pelvis]!.quaternion.copy(_pelvisQuat);

    /* ---------------------------------------------------------- legs */
    for (let i = 0; i < 2; i += 1) {
      const side = i === 0 ? -1 : 1;
      const plan = _plan[i]!;
      const thigh = i === 0 ? B.thighL : B.thighR;
      const shin = i === 0 ? B.shinL : B.shinR;
      const foot = i === 0 ? B.footL : B.footR;

      // Everything is solved in pelvis space, which is the space the thigh's
      // quaternion is relative to.
      _hipLocal.copy(bones[thigh]!.position);
      _footLocal.copy(plan.target).sub(_pelvisPos).applyQuaternion(_pelvisInv);
      // The knee tracks the foot's heading, splayed a little outward. This is
      // the only thing deciding which way the joint folds.
      _pole
        .set(-Math.sin(plan.yaw) + side * 0.22, 0, -Math.cos(plan.yaw))
        .normalize();
      _poleLocal.copy(_pole).applyQuaternion(_pelvisInv);

      solveTwoBone(
        bones[thigh]!,
        bones[shin]!,
        thigh,
        shin,
        _hipLocal,
        _footLocal,
        _poleLocal,
        THIGH_LEN,
        SHIN_LEN,
        _shinQuat,
      );

      // Plant the sole flat and roll it, independent of how the leg got there.
      _e.set(plan.pitch, plan.yaw, 0, "YXZ");
      _footQuat.setFromEuler(_e);
      _footQuat.premultiply(_pelvisInv);
      bones[foot]!.quaternion.copy(_shinQuat).invert().multiply(_footQuat);
    }

    /* --------------------------------------------------------- aim */
    const twist = THREE.MathUtils.clamp(yawDelta(this.bodyYaw, actor.yaw), -twistLimit, twistLimit);
    const pitch = THREE.MathUtils.clamp(actor.pitch, -0.9, 0.9);
    const liftSpine = 0.06 + run * 0.1;
    addEuler(bones[B.spine1]!, liftSpine * 0.3, twist * 0.3, -hipRoll * 0.5);
    addEuler(bones[B.spine2]!, liftSpine * 0.3 + pitch * 0.12, twist * 0.35, 0);
    addEuler(bones[B.spine3]!, pitch * 0.2, twist * 0.35, sin * 0.05 * moving);
    addEuler(bones[B.neck]!, pitch * 0.3, twist * 0.15, 0);
    addEuler(bones[B.head]!, pitch * 0.35, twist * 0.12, 0);

    /* --------------------------------------------------------- arms */
    // Weapon carry: both arms forward, the right hand on the grip and the left
    // reaching across to the handguard. Blended out toward an arm swing as the
    // actor sprints, because nobody sprints with a rifle shouldered.
    const sprinting = actor.state === "sprint" ? 1 : 0;
    const carry = 1 - sprinting * 0.75;
    const armSwing = sin * 0.42 * moving * sprinting;

    setEuler(bones[B.clavicleR]!, 0, -0.12 * carry, -0.08 * carry);
    setEuler(
      bones[B.upperArmR]!,
      -1.02 * carry - armSwing * 0.5 + pitch * 0.5 * carry,
      -0.42 * carry,
      0.55 * carry + 0.2,
    );
    setEuler(bones[B.foreArmR]!, -1.28 * carry - 0.5 * sprinting, 0, 0.2 * carry);

    setEuler(bones[B.clavicleL]!, 0, 0.16 * carry, 0.08 * carry);
    setEuler(
      bones[B.upperArmL]!,
      -1.18 * carry + armSwing * 0.5 + pitch * 0.5 * carry,
      0.52 * carry,
      -0.72 * carry - 0.2,
    );
    setEuler(bones[B.foreArmL]!, -1.55 * carry - 0.5 * sprinting, 0, -0.25 * carry);

    if (detail) this.placeSupportHand(bones, carry);

    /* ---------------------------------------------------- additives */
    this.fire = damp(this.fire, 0, 16, dt);
    if (this.fire > 0.001) {
      addEuler(bones[B.upperArmR]!, this.fire * 0.16, 0, 0);
      addEuler(bones[B.spine3]!, this.fire * 0.06, 0, 0);
      addEuler(bones[B.head]!, this.fire * 0.05, 0, 0);
    }

    this.flinch = damp(this.flinch, 0, 7, dt);
    if (this.flinch > 0.001) {
      addEuler(bones[B.spine2]!, -this.flinch * 0.16, 0, this.flinch * 0.2 * this.flinchSide);
      addEuler(bones[B.head]!, -this.flinch * 0.2, this.flinch * 0.18 * this.flinchSide, 0);
    }

    // Suppression makes the whole body hunch.
    if (actor.suppression > 0.02) {
      const s = actor.suppression;
      addEuler(bones[B.spine1]!, s * 0.14, 0, 0);
      addEuler(bones[B.spine2]!, s * 0.12, 0, 0);
      addEuler(bones[B.neck]!, -s * 0.1, 0, 0);
    }

    // Breathing, visible when standing still.
    const breathe = Math.sin(performance.now() * 0.0014) * 0.012 * (1 - moving);
    addEuler(bones[B.spine2]!, breathe, 0, 0);

    this.lean = damp(this.lean, 0, 8, dt);
  }

  /**
   * Put the support hand on the weapon's handguard.
   *
   * The weapon hangs off the right hand, so where it ends up is only known
   * after the right arm has been posed. Forward kinematics finds it, and the
   * left arm is solved to reach it — which is why the off hand tracks the
   * weapon through recoil and aim pitch instead of hanging near it.
   */
  private placeSupportHand(bones: readonly THREE.Bone[], carry: number): void {
    const weight = THREE.MathUtils.smoothstep(carry, 0.62, 0.96);
    if (weight < 0.01) return;

    chainPose(bones, CHAIN_TO_WEAPON, _weaponPos, _weaponQuat);
    // Under the barrel, forward of the grip: where a support hand actually goes.
    _grip.set(-0.03, -0.028, -0.285).applyQuaternion(_weaponQuat).add(_weaponPos);

    chainPose(bones, CHAIN_TO_CLAVICLE_L, _clavPos, _clavQuat);
    _clavInv.copy(_clavQuat).invert();
    _armOrigin.copy(bones[B.upperArmL]!.position);
    _armTarget.copy(_grip).sub(_clavPos).applyQuaternion(_clavInv);
    // The elbow of the support arm hangs down and out.
    _armPole.set(-0.45, -0.86, 0.24).normalize().applyQuaternion(_clavInv);

    _savedUpper.copy(bones[B.upperArmL]!.quaternion);
    _savedFore.copy(bones[B.foreArmL]!.quaternion);
    solveTwoBone(
      bones[B.upperArmL]!,
      bones[B.foreArmL]!,
      B.upperArmL,
      B.foreArmL,
      _armOrigin,
      _armTarget,
      _armPole,
      UPPER_ARM_LEN,
      FOREARM_LEN,
    );
    _solvedUpper.copy(bones[B.upperArmL]!.quaternion);
    _solvedFore.copy(bones[B.foreArmL]!.quaternion);
    bones[B.upperArmL]!.quaternion.copy(_savedUpper).slerp(_solvedUpper, weight);
    bones[B.foreArmL]!.quaternion.copy(_savedFore).slerp(_solvedFore, weight);
  }

  /** A simple collapse; the ragdoll system replaces this when it lands. */
  private applyDeath(bones: readonly THREE.Bone[], group: THREE.Object3D): void {
    const t = Math.min(1, this.deathTime / 0.85);
    const ease = 1 - (1 - t) * (1 - t);
    resetToRest(bones);
    group.rotation.y = this.bodyYaw;
    // Fold at the knees and hips, then pitch forward onto the ground. The hips
    // flex (positive, forward) and the knees fold (negative, heel to buttock),
    // which is the only way a knee is allowed to move.
    setEuler(bones[B.pelvis]!, ease * 1.35, 0, 0);
    bones[B.pelvis]!.position.y -= ease * 0.78;
    setEuler(bones[B.thighL]!, ease * 0.95, 0, ease * 0.24);
    setEuler(bones[B.thighR]!, ease * 1.15, 0, -ease * 0.3);
    setEuler(bones[B.shinL]!, -ease * 1.5, 0, 0);
    setEuler(bones[B.shinR]!, -ease * 1.25, 0, 0);
    setEuler(bones[B.footL]!, ease * 0.35, 0, 0);
    setEuler(bones[B.footR]!, ease * 0.3, 0, 0);
    setEuler(bones[B.spine1]!, ease * 0.3, 0, ease * 0.15);
    setEuler(bones[B.spine2]!, ease * 0.24, 0, ease * 0.12);
    setEuler(bones[B.neck]!, ease * 0.4, 0, 0);
    setEuler(bones[B.upperArmL]!, -ease * 0.6, ease * 0.5, -ease * 0.9);
    setEuler(bones[B.upperArmR]!, -ease * 0.5, -ease * 0.5, ease * 0.9);
  }
}
