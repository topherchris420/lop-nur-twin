import * as THREE from "three";
import type { Actor } from "../core/gameState";
import { B, resetToRest } from "./rig";

/**
 * Procedural character animation.
 *
 * No clip data: every pose is computed from the actor's own state. The gait is
 * a phase-driven articulation of hips, knees and ankles whose stride length
 * and cadence come from the actor's measured speed, so a bot that decelerates
 * into cover shortens its stride rather than sliding. On top of that sit an
 * aim layer that rotates the spine and head toward whatever the actor is
 * looking at, a stance blend, and additive flinches.
 *
 * Everything is written straight into bone quaternions from preallocated
 * scratch objects — the update path allocates nothing.
 */

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _flat = new THREE.Vector3();

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

/** Shortest signed angular difference, radians. */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class CharacterAnimator {
  /** Gait phase in radians; one full stride is 2π. */
  private phase = 0;
  private crouch = 0;
  private prone = 0;
  private lean = 0;
  /** Body yaw, which lags the aim yaw so the torso twists before the feet turn. */
  private bodyYaw = 0;
  private flinch = 0;
  private flinchSide = 0;
  private fire = 0;
  private deathTime = -1;
  private lastSpeed = 0;

  reset(actor: Actor): void {
    this.phase = 0;
    this.bodyYaw = actor.yaw;
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

  update(bones: readonly THREE.Bone[], group: THREE.Object3D, actor: Actor, dt: number): void {
    const speed = actor.speed;
    this.lastSpeed = damp(this.lastSpeed, speed, 12, dt);

    if (!actor.alive) {
      if (this.deathTime < 0) this.deathTime = 0;
      this.deathTime += dt;
      this.applyDeath(bones, group, actor);
      return;
    }
    this.deathTime = -1;

    resetToRest(bones);

    /* ------------------------------------------------------- stance */
    this.crouch = damp(this.crouch, actor.stance === "stand" ? 0 : 1, 9, dt);
    this.prone = damp(this.prone, actor.stance === "prone" ? 1 : 0, 6, dt);

    /* --------------------------------------------------------- gait */
    // Stride length grows with speed but saturates, which is what makes a
    // sprint read as faster cadence rather than absurdly long steps.
    const stride = 0.72 + Math.min(1, this.lastSpeed / 6) * 0.85;
    const cadence = this.lastSpeed / Math.max(0.3, stride);
    this.phase += cadence * dt * Math.PI;
    if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;

    const moving = Math.min(1, this.lastSpeed / 1.4);
    const run = Math.min(1, this.lastSpeed / 5.2);
    const swing = (0.38 + run * 0.42) * moving * (1 - this.prone * 0.85);
    const sin = Math.sin(this.phase);
    const cos = Math.cos(this.phase);

    // Legs: the thigh swings about the hip, the knee only ever bends one way,
    // and the ankle counter-rotates so the foot stays flat through stance.
    const thighL = -sin * swing - this.crouch * 0.62;
    const thighR = sin * swing - this.crouch * 0.62;
    const kneeL = Math.max(0, -Math.sin(this.phase - 0.7)) * swing * 1.5 + this.crouch * 1.15;
    const kneeR = Math.max(0, -Math.sin(this.phase + Math.PI - 0.7)) * swing * 1.5 + this.crouch * 1.15;
    setEuler(bones[B.thighL]!, thighL, 0, 0.03);
    setEuler(bones[B.thighR]!, thighR, 0, -0.03);
    setEuler(bones[B.shinL]!, kneeL, 0, 0);
    setEuler(bones[B.shinR]!, kneeR, 0, 0);
    setEuler(bones[B.footL]!, -thighL * 0.45 - kneeL * 0.4 + 0.06, 0, 0);
    setEuler(bones[B.footR]!, -thighR * 0.45 - kneeR * 0.4 + 0.06, 0, 0);

    // Pelvis: vertical bob at twice the stride rate, plus a roll onto the
    // supporting leg and a counter-yaw against the shoulders.
    const bob = -Math.abs(cos) * 0.035 * moving * (1 - this.crouch * 0.4);
    const hipRoll = sin * 0.06 * moving;
    const hipYaw = -sin * 0.13 * moving;
    bones[B.pelvis]!.position.y += bob - this.crouch * 0.24 - this.prone * 0.55;
    setEuler(bones[B.pelvis]!, this.crouch * 0.2 + this.prone * 1.2, hipYaw, hipRoll);

    /* --------------------------------------------------------- aim */
    // The body turns to follow the aim, but lazily: the spine takes up the
    // difference first, and the feet only catch up once it exceeds a limit.
    const yawError = angleDelta(this.bodyYaw, actor.yaw);
    const twistLimit = 0.62;
    const overrun = Math.max(0, Math.abs(yawError) - twistLimit) * Math.sign(yawError);
    this.bodyYaw += overrun + yawError * Math.min(1, dt * (moving > 0.1 ? 9 : 3.2));
    group.rotation.y = this.bodyYaw;

    const twist = THREE.MathUtils.clamp(angleDelta(this.bodyYaw, actor.yaw), -twistLimit, twistLimit);
    const pitch = THREE.MathUtils.clamp(actor.pitch, -0.9, 0.9);
    const lift = 0.06 + run * 0.1;
    addEuler(bones[B.spine1]!, lift * 0.3, twist * 0.3, -hipRoll * 0.5);
    addEuler(bones[B.spine2]!, lift * 0.3 + pitch * 0.12, twist * 0.35, 0);
    addEuler(bones[B.spine3]!, pitch * 0.2, twist * 0.35, sin * 0.05 * moving);
    addEuler(bones[B.neck]!, pitch * 0.3, twist * 0.15, 0);
    addEuler(bones[B.head]!, pitch * 0.35, twist * 0.12, 0);

    /* --------------------------------------------------------- arms */
    // Weapon carry: both arms forward, the right hand on the grip and the left
    // reaching across to the handguard. Blended out toward an arm swing as the
    // actor sprints, because nobody sprints with a rifle shouldered.
    const sprinting = actor.state === "sprint" ? 1 : 0;
    const carry = 1 - sprinting * 0.75;
    const armSwing = sin * swing * 0.75 * sprinting;

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

  /** A simple collapse; the ragdoll system replaces this when it lands. */
  private applyDeath(
    bones: readonly THREE.Bone[],
    group: THREE.Object3D,
    actor: Actor,
  ): void {
    const t = Math.min(1, this.deathTime / 0.85);
    const ease = 1 - (1 - t) * (1 - t);
    resetToRest(bones);
    group.rotation.y = this.bodyYaw;
    // Fold at the knees and hips, then pitch forward onto the ground.
    setEuler(bones[B.pelvis]!, ease * 1.35, 0, 0);
    bones[B.pelvis]!.position.y -= ease * 0.78;
    setEuler(bones[B.thighL]!, -ease * 1.15, 0, ease * 0.24);
    setEuler(bones[B.thighR]!, -ease * 0.95, 0, -ease * 0.3);
    setEuler(bones[B.shinL]!, ease * 1.5, 0, 0);
    setEuler(bones[B.shinR]!, ease * 1.25, 0, 0);
    setEuler(bones[B.spine1]!, ease * 0.3, 0, ease * 0.15);
    setEuler(bones[B.spine2]!, ease * 0.24, 0, ease * 0.12);
    setEuler(bones[B.neck]!, ease * 0.4, 0, 0);
    setEuler(bones[B.upperArmL]!, -ease * 0.6, ease * 0.5, -ease * 0.9);
    setEuler(bones[B.upperArmR]!, -ease * 0.5, -ease * 0.5, ease * 0.9);
    _flat.set(0, 0, 0);
    void actor;
  }
}
