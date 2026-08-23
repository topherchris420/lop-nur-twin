import * as THREE from "three";
import type { WeaponModel } from "./model";
import type { WeaponRuntime } from "./runtime";
import type { ViewOffsets } from "../player/controller";

/**
 * Viewmodel animation.
 *
 * Fully procedural spring-mass-damper kinetic animation inspired by Call of Duty Modern Warfare:
 * - Second-order spring-mass-damper weapon inertia & sway with physical overshoot settling.
 * - Multi-stage recoil spring simulation (violent linear kick, rotational barrel flip & torque).
 * - Tactical Sprint (Tac-Sprint) one-handed vertical weapon carry and high-cadence bob.
 * - Tac-Stance 45-degree canted point-aiming.
 * - Procedural multi-phase weapon chamber & magazine inspection animation ('I' key).
 *
 * All state lives in preallocated scratch objects; the update path does not allocate.
 */

interface Spring3 {
  value: THREE.Vector3;
  velocity: THREE.Vector3;
}

function makeSpring3(): Spring3 {
  return { value: new THREE.Vector3(), velocity: new THREE.Vector3() };
}

/** Second-order spring-mass-damper integration with tunable stiffness and damping. */
function springTo(
  spring: Spring3,
  target: THREE.Vector3,
  stiffness: number,
  damping: number,
  dt: number,
): void {
  const steps = dt > 1 / 45 ? 2 : 1;
  const h = dt / steps;
  for (let i = 0; i < steps; i += 1) {
    _accel.copy(target).sub(spring.value).multiplyScalar(stiffness);
    _accel.addScaledVector(spring.velocity, -damping);
    spring.velocity.addScaledVector(_accel, h);
    spring.value.addScaledVector(spring.velocity, h);
  }
}

const _accel = new THREE.Vector3();
const _target = new THREE.Vector3();
const _targetRot = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _adsPos = new THREE.Vector3();
const _zero = new THREE.Vector3(0, 0, 0);

export interface ViewmodelInput {
  /** Look delta this frame, radians. Drives sway. */
  lookDeltaYaw: number;
  lookDeltaPitch: number;
  /** Horizontal speed, m/s. */
  speed: number;
  grounded: boolean;
  /** From the player controller. */
  view: ViewOffsets;
  /** Seconds since match start. */
  time: number;
  /** 0..1, how much the weapon is lowered by an interaction. */
  lowered: number;
  /**
   * Ratio of the world half-FOV tangent to the viewmodel's reference half-FOV
   * tangent. The weapon is scaled by this and held at a fixed distance.
   */
  fovScale: number;
}

export class ViewmodelAnimator {
  /** Inertial positional sway from mouse angular velocity and movement momentum. */
  private readonly swayPos = makeSpring3();
  /** Inertial rotational sway (pitch, yaw, torsional roll). */
  private readonly swayRot = makeSpring3();
  /** Recoil linear translation. */
  private readonly recoil = makeSpring3();
  /** Recoil rotation (barrel flip, twist, and settling oscillation). */
  private readonly recoilRot = makeSpring3();
  /** Blended pose position. */
  private readonly pose = makeSpring3();
  /** Blended pose rotation. */
  private readonly poseRot = makeSpring3();

  private boltOffset = 0;
  private boltVelocity = 0;
  private chargeOffset = 0;
  private triggerPull = 0;
  private magDrop = 0;
  private breathPhase = 0;
  private lastAds = 0;
  private tacStanceBlend = 0;
  private inspectBlend = 0;
  private inspectBoltOffset = 0;
  private prevSpeed = 0;
  private speedAccel = 0;

  /** Reset when the weapon is swapped. */
  reset(): void {
    this.swayPos.value.set(0, 0, 0);
    this.swayPos.velocity.set(0, 0, 0);
    this.swayRot.value.set(0, 0, 0);
    this.swayRot.velocity.set(0, 0, 0);
    this.recoil.value.set(0, 0, 0);
    this.recoil.velocity.set(0, 0, 0);
    this.recoilRot.value.set(0, 0, 0);
    this.recoilRot.velocity.set(0, 0, 0);
    this.pose.value.set(0, 0, 0);
    this.pose.velocity.set(0, 0, 0);
    this.poseRot.value.set(0, 0, 0);
    this.poseRot.velocity.set(0, 0, 0);
    this.boltOffset = 0;
    this.boltVelocity = 0;
    this.chargeOffset = 0;
    this.triggerPull = 0;
    this.magDrop = 0;
    this.tacStanceBlend = 0;
    this.inspectBlend = 0;
    this.inspectBoltOffset = 0;
    this.prevSpeed = 0;
    this.speedAccel = 0;
  }

  update(
    model: WeaponModel,
    runtime: WeaponRuntime,
    input: ViewmodelInput,
    dt: number,
  ): void {
    const ads = runtime.ads;
    const view = input.view;
    const k = input.fovScale;
    model.root.scale.setScalar(k);

    // Track acceleration for movement inertia
    this.speedAccel = (input.speed - this.prevSpeed) / Math.max(1e-4, dt);
    this.prevSpeed = input.speed;

    // Tac-Stance blend
    const isTacStance = runtime.tacStance;
    this.tacStanceBlend +=
      ((isTacStance ? 1 : 0) - this.tacStanceBlend) * Math.min(1, dt * 18);

    // Inspect blend
    const isInspecting = runtime.isInspecting;
    this.inspectBlend +=
      ((isInspecting ? 1 : 0) - this.inspectBlend) * Math.min(1, dt * 16);

    /* ------------------------------------------------------- pose */
    const sight = model.sightOffset;
    _adsPos.set(-k * sight.x, -k * sight.y, model.adsDistance - k * sight.z);

    // Tac-Stance aim positioning: shifts to point-aim high ready rather than optic center
    if (this.tacStanceBlend > 0.001) {
      const ts = this.tacStanceBlend * ads;
      _adsPos.x += ts * 0.052;
      _adsPos.y += ts * 0.034;
      _adsPos.z += ts * 0.045;
    }

    // Blend hip → ADS
    _target.lerpVectors(model.hipPosition, _adsPos, ads);

    const sprint = view.sprintPose * (1 - ads);
    const tacSprint = view.tacSprintPose * (1 - ads);
    const slide = view.slidePose * (1 - ads);
    const mantle = view.mantlePose;

    // Sprint & Slide offsets
    _target.x += sprint * 0.075 + tacSprint * 0.055 + slide * 0.03;
    _target.y +=
      -sprint * 0.06 +
      tacSprint * 0.045 -
      slide * 0.1 -
      mantle * 0.18 -
      input.lowered * 0.22;
    _target.z += sprint * 0.06 - tacSprint * 0.04 + slide * 0.04 + mantle * 0.08;

    // Reload pose
    const reload = runtime.isReloading ? Math.sin(runtime.reloadProgress * Math.PI) : 0;
    _target.x -= reload * 0.045;
    _target.y -= reload * 0.055;
    _target.z += reload * 0.045;

    // Multi-phase Chamber Inspect animation pose
    this.inspectBoltOffset = 0;
    if (this.inspectBlend > 0.001) {
      const t = runtime.inspectProgress;
      let inspX = 0;
      let inspY = 0;
      let inspZ = 0;

      if (t < 0.35) {
        // Phase 1: Roll left, tilt up towards eye, pull bolt back to inspect chamber
        const p1 = Math.sin((t / 0.35) * (Math.PI / 2));
        inspX = -p1 * 0.025;
        inspY = p1 * 0.032;
        inspZ = p1 * 0.02;
        this.inspectBoltOffset =
          -model.parts.boltTravel * 0.38 * Math.sin((t / 0.35) * Math.PI);
      } else if (t < 0.72) {
        // Phase 2: Bolt closed, roll right to inspect ejection port and markings
        const p2 = Math.sin(((t - 0.35) / 0.37) * Math.PI);
        inspX = p2 * 0.032;
        inspY = p2 * 0.015;
        inspZ = -p2 * 0.015;
      } else {
        // Phase 3: Settle back smoothly
        const p3 = 1 - (t - 0.72) / 0.28;
        inspX = p3 * 0.01;
        inspY = p3 * 0.005;
      }
      _target.x += inspX * this.inspectBlend;
      _target.y += inspY * this.inspectBlend;
      _target.z += inspZ * this.inspectBlend;
    }

    springTo(this.pose, _target, 280, 28, dt);

    // Target rotation: hip -> ADS blend
    _targetRot.set(
      model.hipRotation.x * (1 - ads) + model.adsRotation.x * ads,
      model.hipRotation.y * (1 - ads) + model.adsRotation.y * ads,
      model.hipRotation.z * (1 - ads) + model.adsRotation.z * ads,
    );

    // Tac-Stance: 45-degree canted roll and CQB angle
    if (this.tacStanceBlend > 0.001) {
      const ts = this.tacStanceBlend * ads;
      _targetRot.z -= ts * 0.785398; // 45 degrees cant
      _targetRot.x += ts * 0.055;
      _targetRot.y += ts * 0.045;
    }

    // Sprint poses
    _targetRot.x +=
      sprint * 0.28 +
      tacSprint * 1.15 +
      slide * 0.16 +
      mantle * 0.5 +
      input.lowered * 0.5;
    _targetRot.y += -sprint * 0.44 - tacSprint * 0.26 - slide * 0.2;
    _targetRot.z +=
      sprint * 0.5 - tacSprint * 0.42 + slide * 0.34 - mantle * 0.3 + reload * 0.55;
    _targetRot.x += reload * 0.22;

    // Chamber Inspect rotation
    if (this.inspectBlend > 0.001) {
      const t = runtime.inspectProgress;
      let rotX = 0;
      let rotY = 0;
      let rotZ = 0;
      if (t < 0.35) {
        const p1 = Math.sin((t / 0.35) * (Math.PI / 2));
        rotZ = -p1 * 0.72; // 41 degrees left roll
        rotY = p1 * 0.36;
        rotX = -p1 * 0.16;
      } else if (t < 0.72) {
        const p2 = Math.sin(((t - 0.35) / 0.37) * Math.PI);
        rotZ = p2 * 0.55; // 31 degrees right roll
        rotY = -p2 * 0.42;
        rotX = p2 * 0.14;
      }
      _targetRot.x += rotX * this.inspectBlend;
      _targetRot.y += rotY * this.inspectBlend;
      _targetRot.z += rotZ * this.inspectBlend;
    }

    springTo(this.poseRot, _targetRot, 240, 25, dt);

    /* ---------------------- spring-mass-damper inertia & sway ---- */
    // Mouse angular velocity induces translational and rotational inertia lag
    const swayScale = (1 - ads * 0.76) * 0.085;
    const yawVel = input.lookDeltaYaw;
    const pitchVel = input.lookDeltaPitch;

    // Positional sway with second-order spring settling
    _target.set(
      THREE.MathUtils.clamp(-yawVel * 3.6, -0.11, 0.11) * (swayScale / 0.085),
      THREE.MathUtils.clamp(pitchVel * 3.2, -0.09, 0.09) * (swayScale / 0.085),
      THREE.MathUtils.clamp(this.speedAccel * -0.004, -0.04, 0.04),
    );
    springTo(this.swayPos, _target, 220, 22, dt);

    // Rotational sway: pitch, yaw lag, and torsional roll on rapid turns
    const rollSway = THREE.MathUtils.clamp(yawVel * 2.8, -0.12, 0.12) * (1 - ads * 0.6);
    _target.set(
      THREE.MathUtils.clamp(pitchVel * 3.0, -0.1, 0.1) * (swayScale / 0.085),
      THREE.MathUtils.clamp(-yawVel * 3.2, -0.12, 0.12) * (swayScale / 0.085),
      rollSway,
    );
    springTo(this.swayRot, _target, 260, 24, dt);

    /* --------------------------------- multi-stage recoil spring ---- */
    if (runtime.firedThisFrame) {
      const kick = runtime.viewKick;
      // Violent primary linear impulse
      this.recoil.velocity.z += kick * 56;
      this.recoil.velocity.y += kick * 16;
      this.recoil.velocity.x += (Math.random() - 0.5) * kick * 20;

      // Violent rotational barrel flip, torsional twist, and lateral whip
      this.recoilRot.velocity.x -= kick * 125;
      this.recoilRot.velocity.z += runtime.viewRoll * 38 + (Math.random() - 0.5) * kick * 26;
      this.recoilRot.velocity.y += (Math.random() - 0.5) * kick * 24;

      this.boltVelocity = -model.parts.boltTravel * 52;
      this.triggerPull = 1.0;
    }
    // High-stiffness recoil recovery with subtle kinetic settling oscillation
    springTo(this.recoil, _zero, 560, 32, dt);
    springTo(this.recoilRot, _zero, 490, 28, dt);

    /* -------------------------------------------------- breathing */
    this.breathPhase += dt * (ads > 0.5 ? 1.15 : 1.65);
    const breathAmp = (ads > 0.5 ? 0.0015 : 0.0042) * (1 - view.sprintPose);
    const breathX = Math.sin(this.breathPhase * 0.63) * breathAmp;
    const breathY = Math.sin(this.breathPhase) * breathAmp * 0.72;

    /* -------------------------------------------------------- bob */
    const bobScale =
      Math.min(1, input.speed / 4.5) * (1 - ads * 0.85) * (input.grounded ? 1 : 0.2);
    const phase = view.bobPhase;
    const bobX = Math.sin(phase) * 0.014 * bobScale;
    const bobY = -Math.abs(Math.cos(phase)) * 0.011 * bobScale;
    const bobRoll = Math.sin(phase) * 0.02 * bobScale;

    // Tac-Sprint higher cadence pumping bob
    const tacSprintPose = view.tacSprintPose;
    const tacBobX = Math.sin(phase * 1.4) * 0.038 * tacSprintPose;
    const tacBobY = Math.cos(phase * 1.4) * 0.028 * tacSprintPose;
    const tacBobRoll = Math.sin(phase * 1.4) * 0.045 * tacSprintPose;

    // Normal Sprint bob
    const normalSprint = Math.max(0, view.sprintPose - tacSprintPose);
    const sprintBobX = Math.sin(phase * 0.5) * 0.03 * normalSprint;
    const sprintBobY = Math.cos(phase) * 0.02 * normalSprint;

    /* ------------------------------------------------------- apply */
    const root = model.root;
    root.position.set(
      this.pose.value.x +
        this.swayPos.value.x +
        bobX +
        sprintBobX +
        tacBobX +
        breathX +
        this.recoil.value.x,
      this.pose.value.y +
        this.swayPos.value.y +
        bobY +
        sprintBobY +
        tacBobY +
        breathY +
        this.recoil.value.y,
      this.pose.value.z + this.swayPos.value.z + this.recoil.value.z,
    );

    _euler.set(
      this.poseRot.value.x +
        this.recoilRot.value.x +
        this.swayRot.value.x +
        this.swayPos.value.y * 0.85,
      this.poseRot.value.y +
        this.recoilRot.value.y +
        this.swayRot.value.y -
        this.swayPos.value.x * 1.05,
      this.poseRot.value.z +
        this.recoilRot.value.z +
        this.swayRot.value.z +
        bobRoll +
        tacBobRoll,
      "YXZ",
    );
    root.quaternion.setFromEuler(_euler);

    /* -------------------------------------------- moving sub-parts */
    // Bolt: driven back by the shot or inspect, returned by recoil spring
    this.boltVelocity += (0 - this.boltOffset) * 920 * dt - this.boltVelocity * 28 * dt;
    this.boltOffset += this.boltVelocity * dt;
    if (this.boltOffset > 0) {
      this.boltOffset = 0;
      this.boltVelocity = 0;
    }
    const combinedBolt = Math.min(this.boltOffset, this.inspectBoltOffset);
    const travel = Math.max(-model.parts.boltTravel, combinedBolt);
    model.parts.bolt.position.z = travel * -1;

    // Charging handle: pulled on an empty reload at chambering stage
    const wantsCharge =
      runtime.isReloading && runtime.chambering && runtime.reloadProgress > 0.78 ? 1 : 0;
    this.chargeOffset += (wantsCharge - this.chargeOffset) * Math.min(1, dt * 22);
    model.parts.chargingHandle.position.z =
      this.chargeOffset * model.parts.chargingTravel;

    // Trigger
    this.triggerPull *= Math.exp(-26 * dt);
    model.parts.trigger.rotation.x = this.triggerPull * 0.32;

    // Magazine
    const magTarget = runtime.isReloading
      ? runtime.reloadProgress < 0.2
        ? runtime.reloadProgress / 0.2
        : runtime.reloadProgress < 0.55
          ? 1
          : Math.max(0, 1 - (runtime.reloadProgress - 0.55) / 0.25)
      : 0;
    this.magDrop += (magTarget - this.magDrop) * Math.min(1, dt * 18);
    model.parts.magazine.position.y = -0.012 - this.magDrop * 0.16;
    model.parts.magazine.rotation.x = this.magDrop * 0.5;
    model.parts.magazine.rotation.z = this.magDrop * 0.28;

    // Reticle: in Tac-Stance the optic is canted out of line of sight, so fade reticle
    if (model.parts.opticReticle) {
      const visible = ads > 0.35;
      model.parts.opticReticle.visible = visible;
      if (visible) {
        const material = (model.parts.opticReticle as THREE.Mesh).material;
        const adsAlpha = THREE.MathUtils.clamp((ads - 0.35) / 0.45, 0, 1);
        const tacAlpha = 1 - this.tacStanceBlend * 0.85;
        const totalAlpha = adsAlpha * tacAlpha;
        if (material instanceof THREE.ShaderMaterial && material.uniforms.uAds) {
          material.uniforms.uAds.value = totalAlpha;
          if (material.uniforms.uEyeOffset) {
            (material.uniforms.uEyeOffset.value as THREE.Vector2).set(
              this.swayPos.value.x * 2.5 + this.recoil.value.x * 1.8,
              this.swayPos.value.y * 2.5 + this.recoil.value.y * 1.8,
            );
          }
        } else if (material instanceof THREE.MeshBasicMaterial) {
          material.opacity = totalAlpha;
        }
      }
    }

    this.lastAds = ads;
  }

  get adsBlend(): number {
    return this.lastAds;
  }

  get tacStance(): number {
    return this.tacStanceBlend;
  }
}
