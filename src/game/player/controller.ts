import * as THREE from "three";
import {
  HUMAN_METRICS,
  MASK_MOVEMENT,
  yawToForward,
  type Stance,
  type SurfaceType,
} from "../core/types";
import type { Actor, InputState } from "../core/gameState";
import { queueSound } from "../core/gameState";
import type { CollisionWorld } from "../physics/collisionWorld";

/**
 * First-person movement.
 *
 * The feel targets a modern military shooter: quick acceleration, a hard
 * ground-speed cap that varies by stance and weapon state, air control that
 * lets you adjust but not accelerate, a sprint that has to be cancelled before
 * you can fire, a slide with a real speed boost and decay, and automatic
 * mantling over anything up to chest height. Every number below is in metres
 * and seconds so it can be reasoned about against the real site.
 */

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

export const MOVE: Readonly<Record<string, number>> & {
  walkSpeed: number; sprintSpeed: number; tacSprintSpeed: number; crouchSpeed: number;
  proneSpeed: number; adsSpeedScale: number; groundAccel: number; airAccel: number;
  friction: number; airFriction: number; gravity: number; jumpVelocity: number;
  coyoteTime: number; jumpBuffer: number; slideBoost: number; slideMinSpeed: number;
  slideDuration: number; slideFriction: number; slideCooldown: number;
  mantleMaxHeight: number; mantleMinHeight: number; mantleReach: number;
  mantleDuration: number; crouchTime: number; proneTime: number;
  tacSprintDelay: number; tacSprintDuration: number; leanAngle: number;
  leanOffset: number; leanSpeed: number; fallSafeSpeed: number; fallLethalSpeed: number;
} = {
  walkSpeed: 4.35,
  sprintSpeed: 5.95,
  tacSprintSpeed: 7.6,
  crouchSpeed: 2.35,
  proneSpeed: 1.05,
  adsSpeedScale: 0.52,
  /** How hard we accelerate toward the wish velocity, in m/s². */
  groundAccel: 62,
  airAccel: 18,
  /** Ground friction, in 1/s. */
  friction: 11.5,
  airFriction: 0.12,
  gravity: 18.2,
  jumpVelocity: 5.35,
  /** Seconds after leaving a ledge during which a jump still registers. */
  coyoteTime: 0.11,
  /** Seconds a jump press is buffered before landing. */
  jumpBuffer: 0.14,
  /** Slide. */
  slideBoost: 7.9,
  slideMinSpeed: 3.4,
  slideDuration: 0.95,
  slideFriction: 3.1,
  slideCooldown: 0.55,
  /** Mantle. */
  mantleMaxHeight: 1.62,
  mantleMinHeight: 0.45,
  mantleReach: 1.05,
  mantleDuration: 0.52,
  /** Stance transition seconds. */
  crouchTime: 0.16,
  proneTime: 0.42,
  /** Tac-sprint only engages after holding sprint this long while moving. */
  tacSprintDelay: 0.55,
  /** Seconds of tac-sprint before it drops back to a normal sprint. */
  tacSprintDuration: 4.2,
  /** Lean. */
  leanAngle: 0.28,
  leanOffset: 0.32,
  leanSpeed: 7.5,
  /** Fall damage. */
  fallSafeSpeed: 11.5,
  fallLethalSpeed: 24,
};

export type MoveEvent =
  | { kind: "footstep"; surface: SurfaceType; speed: number }
  | { kind: "land"; speed: number; surface: SurfaceType }
  | { kind: "jump" }
  | { kind: "slide-start" }
  | { kind: "mantle-start"; height: number }
  | { kind: "fall-damage"; amount: number };

export interface ViewOffsets {
  /** Camera offset in view space (right, up, forward). */
  position: THREE.Vector3;
  /** Extra pitch/yaw/roll applied on top of the look angles. */
  pitch: number;
  yaw: number;
  roll: number;
  /** 0..1, how much of the sprint pose the viewmodel should adopt. */
  sprintPose: number;
  slidePose: number;
  mantlePose: number;
  /** Bob phase, so footstep audio and the viewmodel stay in sync. */
  bobPhase: number;
}

/* ------------------------------------------------------------------ */
/* Controller                                                          */
/* ------------------------------------------------------------------ */

const _wish = new THREE.Vector3();
const _flat = new THREE.Vector3();
const _probeOrigin = new THREE.Vector3();
const _probeDir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

export class PlayerController {
  readonly view: ViewOffsets = {
    position: new THREE.Vector3(),
    pitch: 0,
    yaw: 0,
    roll: 0,
    sprintPose: 0,
    slidePose: 0,
    mantlePose: 0,
    bobPhase: 0,
  };

  /** Drained by the caller each frame. */
  readonly events: MoveEvent[] = [];

  private stanceBlend = 0;
  private proneBlend = 0;
  private targetStance: Stance = "stand";
  private coyote = 0;
  private jumpBuffered = 0;
  private sprintHeld = 0;
  private tacSprintTimer = 0;
  private sliding = false;
  private slideTimer = 0;
  private slideCooldown = 0;
  private slideDir = new THREE.Vector3();
  private mantling = false;
  private mantleTimer = 0;
  private mantleFrom = new THREE.Vector3();
  private mantleTo = new THREE.Vector3();
  private bobDistance = 0;
  private lastFootstep = 0;
  private leanAmount = 0;
  private landDip = 0;
  private landDipVel = 0;
  private wasGrounded = true;
  private stepUpSmooth = 0;
  private prevY = 0;
  /** Cached so the caller can drive weapon spread and animation. */
  speed = 0;
  sprinting = false;
  tacSprinting = false;

  get isSliding(): boolean {
    return this.sliding;
  }

  get isMantling(): boolean {
    return this.mantling;
  }

  /** True while the player may not fire (sprint or mantle). */
  get firingBlocked(): boolean {
    return this.mantling || this.view.sprintPose > 0.6;
  }

  /** Height of the eye above the feet for the current stance blend. */
  eyeHeight(): number {
    const e = HUMAN_METRICS.eyeHeight;
    const standCrouch = e.stand + (e.crouch - e.stand) * this.stanceBlend;
    return standCrouch + (e.prone - standCrouch) * this.proneBlend;
  }

  private colliderHeight(): number {
    const h = HUMAN_METRICS.colliderHeight;
    const standCrouch = h.stand + (h.crouch - h.stand) * this.stanceBlend;
    return standCrouch + (h.prone - standCrouch) * this.proneBlend;
  }

  private maxSpeed(input: InputState, adsBlend: number): number {
    if (this.sliding) return MOVE.slideBoost;
    let base = MOVE.walkSpeed;
    if (this.proneBlend > 0.5) base = MOVE.proneSpeed;
    else if (this.stanceBlend > 0.5) base = MOVE.crouchSpeed;
    else if (this.tacSprinting) base = MOVE.tacSprintSpeed;
    else if (this.sprinting) base = MOVE.sprintSpeed;
    if (adsBlend > 0 && !this.sprinting) {
      base *= 1 + (MOVE.adsSpeedScale - 1) * adsBlend;
    }
    if (input.moveY < 0) base *= 0.86; // backpedal penalty
    return base;
  }

  /**
   * Advance one simulation step. `yaw`/`pitch` are the current look angles;
   * `adsBlend` is 0..1 from the weapon runtime.
   */
  update(
    actor: Actor,
    input: InputState,
    world: CollisionWorld,
    dt: number,
    adsBlend: number,
  ): void {
    this.events.length = 0;
    const grounded = actor.grounded;

    /* -------------------------------------------------- stance ---- */
    if (input.pronePressed) {
      this.targetStance = this.targetStance === "prone" ? "stand" : "prone";
    } else if (input.crouchPressed) {
      this.targetStance = this.targetStance === "crouch" ? "stand" : "crouch";
    }
    if (input.sprint && input.moveY > 0.1) this.targetStance = "stand";

    // Refuse to stand up under a low ceiling.
    const wantsStand = this.targetStance === "stand";
    if (wantsStand && (this.stanceBlend > 0.01 || this.proneBlend > 0.01)) {
      _tmp.copy(actor.position);
      if (!world.isPositionFree(_tmp, HUMAN_METRICS.radius, HUMAN_METRICS.colliderHeight.stand)) {
        this.targetStance = this.proneBlend > 0.5 ? "prone" : "crouch";
      }
    }
    const crouchTarget = this.targetStance === "stand" ? 0 : 1;
    const proneTarget = this.targetStance === "prone" ? 1 : 0;
    this.stanceBlend = damp(this.stanceBlend, crouchTarget, 1 / MOVE.crouchTime, dt);
    this.proneBlend = damp(this.proneBlend, proneTarget, 1 / MOVE.proneTime, dt);
    actor.stance =
      this.proneBlend > 0.6 ? "prone" : this.stanceBlend > 0.55 ? "crouch" : "stand";

    /* -------------------------------------------------- sprint ---- */
    const wantsSprint =
      input.sprint &&
      input.moveY > 0.15 &&
      this.proneBlend < 0.4 &&
      !this.sliding &&
      !this.mantling;
    if (wantsSprint) {
      this.sprintHeld += dt;
      if (this.sprintHeld > MOVE.tacSprintDelay && this.tacSprintTimer <= 0 && !this.tacSprinting) {
        this.tacSprinting = true;
        this.tacSprintTimer = MOVE.tacSprintDuration;
      }
    } else {
      this.sprintHeld = 0;
      this.tacSprinting = false;
      this.tacSprintTimer = 0;
    }
    if (this.tacSprinting) {
      this.tacSprintTimer -= dt;
      if (this.tacSprintTimer <= 0) this.tacSprinting = false;
    }
    this.sprinting = wantsSprint;

    /* --------------------------------------------------- slide ---- */
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    _flat.set(actor.velocity.x, 0, actor.velocity.z);
    const horizontalSpeed = _flat.length();
    if (
      !this.sliding &&
      input.crouchPressed &&
      grounded &&
      this.slideCooldown <= 0 &&
      horizontalSpeed > MOVE.slideMinSpeed &&
      this.proneBlend < 0.3
    ) {
      this.sliding = true;
      this.slideTimer = MOVE.slideDuration;
      this.slideDir.copy(_flat).normalize();
      const boost = Math.max(MOVE.slideBoost, horizontalSpeed * 1.18);
      actor.velocity.x = this.slideDir.x * boost;
      actor.velocity.z = this.slideDir.z * boost;
      this.targetStance = "crouch";
      this.events.push({ kind: "slide-start" });
      queueSound({ id: "slide", position: actor.position.clone(), gain: 0.9 });
    }
    if (this.sliding) {
      this.slideTimer -= dt;
      const speedNow = Math.hypot(actor.velocity.x, actor.velocity.z);
      if (this.slideTimer <= 0 || speedNow < 2.4 || !grounded || input.jumpPressed) {
        this.sliding = false;
        this.slideCooldown = MOVE.slideCooldown;
        if (!input.crouch) this.targetStance = "stand";
      }
    }

    /* -------------------------------------------------- mantle ---- */
    if (this.mantling) {
      this.mantleTimer += dt;
      const t = Math.min(1, this.mantleTimer / MOVE.mantleDuration);
      // Ease out on the vertical, ease in on the horizontal — this is what
      // makes a mantle read as "pull up, then step forward".
      const up = 1 - (1 - t) * (1 - t);
      const fwd = t * t;
      actor.position.set(
        this.mantleFrom.x + (this.mantleTo.x - this.mantleFrom.x) * fwd,
        this.mantleFrom.y + (this.mantleTo.y - this.mantleFrom.y) * up,
        this.mantleFrom.z + (this.mantleTo.z - this.mantleFrom.z) * fwd,
      );
      actor.velocity.set(0, 0, 0);
      this.view.mantlePose = Math.sin(t * Math.PI);
      if (t >= 1) {
        this.mantling = false;
        this.view.mantlePose = 0;
      }
      actor.state = "mantle";
      actor.speed = 0;
      this.updateView(input, dt, adsBlend, 0);
      return;
    }
    if (input.jumpPressed && !this.mantling) {
      this.tryMantle(actor, world);
    }

    /* --------------------------------------------------- input ---- */
    yawToForward(actor.yaw, _fwd);
    _right.set(-_fwd.z, 0, _fwd.x);
    _wish
      .set(0, 0, 0)
      .addScaledVector(_fwd, input.moveY)
      .addScaledVector(_right, input.moveX);
    const wishLen = _wish.length();
    if (wishLen > 1e-4) _wish.multiplyScalar(1 / wishLen);
    const wishSpeed = Math.min(1, wishLen) * this.maxSpeed(input, adsBlend);

    /* ---------------------------------------------------- jump ---- */
    if (grounded) this.coyote = MOVE.coyoteTime;
    else this.coyote = Math.max(0, this.coyote - dt);
    if (input.jumpPressed) this.jumpBuffered = MOVE.jumpBuffer;
    else this.jumpBuffered = Math.max(0, this.jumpBuffered - dt);
    if (this.jumpBuffered > 0 && this.coyote > 0 && !this.mantling) {
      actor.velocity.y = MOVE.jumpVelocity;
      this.jumpBuffered = 0;
      this.coyote = 0;
      this.sliding = false;
      if (this.targetStance !== "stand") this.targetStance = "stand";
      this.events.push({ kind: "jump" });
    }

    /* ------------------------------------------------ integrate ---- */
    if (grounded && !this.sliding) {
      // Exponential friction, then accelerate toward the wish velocity.
      const drop = Math.exp(-MOVE.friction * dt);
      actor.velocity.x *= drop;
      actor.velocity.z *= drop;
      const currentAlong = actor.velocity.x * _wish.x + actor.velocity.z * _wish.z;
      const add = Math.min(MOVE.groundAccel * dt, Math.max(0, wishSpeed - currentAlong));
      actor.velocity.x += _wish.x * add;
      actor.velocity.z += _wish.z * add;
    } else if (this.sliding) {
      const drop = Math.exp(-MOVE.slideFriction * dt);
      actor.velocity.x *= drop;
      actor.velocity.z *= drop;
      // Small steering authority while sliding.
      actor.velocity.x += _wish.x * 6 * dt;
      actor.velocity.z += _wish.z * 6 * dt;
    } else {
      const currentAlong = actor.velocity.x * _wish.x + actor.velocity.z * _wish.z;
      const add = Math.min(MOVE.airAccel * dt, Math.max(0, wishSpeed - currentAlong));
      actor.velocity.x += _wish.x * add;
      actor.velocity.z += _wish.z * add;
      const drop = Math.exp(-MOVE.airFriction * dt);
      actor.velocity.x *= drop;
      actor.velocity.z *= drop;
    }
    actor.velocity.y -= MOVE.gravity * dt;
    if (actor.velocity.y < -70) actor.velocity.y = -70;

    this.prevY = actor.position.y;
    const result = world.moveCapsule(
      actor.position,
      actor.velocity,
      HUMAN_METRICS.radius,
      this.colliderHeight(),
      dt,
      HUMAN_METRICS.stepHeight,
      HUMAN_METRICS.maxSlope,
      this.wasGrounded,
    );
    actor.position.copy(result.position);
    actor.velocity.copy(result.velocity);
    actor.grounded = result.grounded;
    actor.groundSurface = result.groundSurface;

    // Smooth the eye through step-ups so stairs don't strobe the camera.
    const rise = actor.position.y - this.prevY;
    if (result.grounded && rise > 0.02 && rise < HUMAN_METRICS.stepHeight + 0.05) {
      this.stepUpSmooth -= rise;
    }
    this.stepUpSmooth = damp(this.stepUpSmooth, 0, 16, dt);

    /* -------------------------------------------------- landing ---- */
    if (result.grounded && !this.wasGrounded) {
      const impact = result.impactSpeed;
      this.landDipVel -= Math.min(0.22, impact * 0.012);
      this.events.push({ kind: "land", speed: impact, surface: result.groundSurface });
      queueSound({
        id: "land",
        position: actor.position.clone(),
        gain: Math.min(1, 0.3 + impact / 18),
        surface: result.groundSurface,
      });
      if (impact > MOVE.fallSafeSpeed) {
        const t =
          (impact - MOVE.fallSafeSpeed) / (MOVE.fallLethalSpeed - MOVE.fallSafeSpeed);
        this.events.push({ kind: "fall-damage", amount: Math.min(100, t * 100) });
      }
    }
    this.wasGrounded = result.grounded;

    /* --------------------------------------------------- state ---- */
    this.speed = Math.hypot(actor.velocity.x, actor.velocity.z);
    actor.speed = this.speed;
    actor.state = !result.grounded
      ? actor.velocity.y > 0.5
        ? "jump"
        : "fall"
      : this.sliding
        ? "slide"
        : this.speed < 0.35
          ? "idle"
          : this.tacSprinting || (this.sprinting && this.speed > MOVE.walkSpeed + 0.2)
            ? "sprint"
            : this.speed > MOVE.walkSpeed * 0.72
              ? "run"
              : "walk";

    /* ---------------------------------------------- footsteps ---- */
    if (result.grounded && !this.sliding) {
      this.bobDistance += this.speed * dt;
      const strideLength =
        actor.stance === "prone" ? 0.9 : actor.stance === "crouch" ? 1.05 : 1.55;
      if (this.bobDistance - this.lastFootstep > strideLength) {
        this.lastFootstep = this.bobDistance;
        this.events.push({
          kind: "footstep",
          surface: result.groundSurface,
          speed: this.speed,
        });
        queueSound({
          id: "footstep",
          position: actor.position.clone(),
          surface: result.groundSurface,
          gain: Math.min(1, 0.28 + this.speed / 9),
          pitch: 0.94 + ((this.lastFootstep * 7919) % 12) / 100,
        });
      }
    }

    this.updateView(input, dt, adsBlend, this.speed);
  }

  /* ---------------------------------------------------------------- */
  /* Mantling                                                          */
  /* ---------------------------------------------------------------- */

  private tryMantle(actor: Actor, world: CollisionWorld): boolean {
    yawToForward(actor.yaw, _fwd);
    // Probe forward at chest height for a wall.
    _probeOrigin.set(
      actor.position.x,
      actor.position.y + 0.95,
      actor.position.z,
    );
    const wall = world.raycast(_probeOrigin, _fwd, MOVE.mantleReach, MASK_MOVEMENT);
    if (!wall) return false;

    // Then probe down from above the hit to find the ledge top.
    const forwardDist = wall.distance + HUMAN_METRICS.radius * 0.8;
    _probeOrigin.set(
      actor.position.x + _fwd.x * forwardDist,
      actor.position.y + MOVE.mantleMaxHeight + 0.45,
      actor.position.z + _fwd.z * forwardDist,
    );
    _probeDir.set(0, -1, 0);
    const ledge = world.raycast(_probeOrigin, _probeDir, MOVE.mantleMaxHeight + 0.5, MASK_MOVEMENT);
    if (!ledge) return false;
    if (ledge.normal.y < 0.6) return false;

    const height = ledge.point.y - actor.position.y;
    if (height < MOVE.mantleMinHeight || height > MOVE.mantleMaxHeight) return false;

    // The destination must actually fit a crouching player.
    _tmp.set(ledge.point.x, ledge.point.y + 0.02, ledge.point.z);
    if (!world.isPositionFree(_tmp, HUMAN_METRICS.radius * 0.95, HUMAN_METRICS.colliderHeight.crouch)) {
      return false;
    }

    this.mantling = true;
    this.mantleTimer = 0;
    this.mantleFrom.copy(actor.position);
    this.mantleTo.copy(_tmp).addScaledVector(_fwd, 0.24);
    this.sliding = false;
    this.events.push({ kind: "mantle-start", height });
    queueSound({ id: "vault", position: actor.position.clone(), gain: 0.85 });
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* View offsets                                                      */
  /* ---------------------------------------------------------------- */

  private updateView(
    input: InputState,
    dt: number,
    adsBlend: number,
    speed: number,
  ): void {
    const v = this.view;

    // Landing dip — a critically damped spring so it never oscillates.
    const stiffness = 220;
    const damping = 2 * Math.sqrt(stiffness) * 0.85;
    this.landDipVel += (-stiffness * this.landDip - damping * this.landDipVel) * dt;
    this.landDip += this.landDipVel * dt;

    // Lean.
    const leanTarget = (input.leanRight ? 1 : 0) - (input.leanLeft ? 1 : 0);
    this.leanAmount = damp(this.leanAmount, leanTarget * (1 - adsBlend * 0.4), MOVE.leanSpeed, dt);

    // Head bob: a figure-eight whose amplitude scales with speed and drops
    // away almost completely while aiming.
    const bobScale =
      Math.min(1, speed / MOVE.walkSpeed) * (1 - adsBlend * 0.82) * (1 - this.proneBlend * 0.7);
    const phase = this.bobDistance * 2.0;
    v.bobPhase = phase;
    const bobX = Math.sin(phase) * 0.035 * bobScale;
    const bobY = -Math.abs(Math.cos(phase)) * 0.028 * bobScale;

    v.sprintPose = damp(
      v.sprintPose,
      this.tacSprinting ? 1 : this.sprinting && speed > MOVE.walkSpeed ? 0.78 : 0,
      12,
      dt,
    );
    v.slidePose = damp(v.slidePose, this.sliding ? 1 : 0, 14, dt);

    v.position.set(
      bobX + this.leanAmount * MOVE.leanOffset,
      bobY + this.landDip + this.stepUpSmooth - v.slidePose * 0.22,
      0,
    );
    v.roll =
      -this.leanAmount * MOVE.leanAngle -
      Math.sin(phase) * 0.012 * bobScale -
      // A touch of roll when strafing sells the weight of the body.
      input.moveX * 0.018 * (1 - adsBlend);
    v.pitch = this.landDip * 0.55 + v.slidePose * 0.05;
    v.yaw = 0;
  }

  /** Reset on respawn. */
  reset(): void {
    this.stanceBlend = 0;
    this.proneBlend = 0;
    this.targetStance = "stand";
    this.sliding = false;
    this.mantling = false;
    this.tacSprinting = false;
    this.sprinting = false;
    this.landDip = 0;
    this.landDipVel = 0;
    this.leanAmount = 0;
    this.bobDistance = 0;
    this.lastFootstep = 0;
    this.stepUpSmooth = 0;
    this.view.position.set(0, 0, 0);
    this.view.pitch = 0;
    this.view.roll = 0;
    this.view.sprintPose = 0;
    this.view.slidePose = 0;
    this.view.mantlePose = 0;
  }
}
