import * as THREE from "three";
import type { WeaponModel } from "./model";
import type { WeaponRuntime } from "./runtime";
import type { ViewOffsets } from "../player/controller";

/**
 * Viewmodel animation.
 *
 * There is no clip data anywhere in this file. Every pose is a spring settling
 * toward a target, which means the weapon reacts continuously to what the
 * player is doing rather than playing a canned animation over the top of it —
 * a sprint that is interrupted halfway blends out from wherever it got to, and
 * recoil that lands mid-reload stacks correctly.
 *
 * All state lives in preallocated scratch objects; the update path does not
 * allocate.
 */

interface Spring3 {
  value: THREE.Vector3;
  velocity: THREE.Vector3;
}

function makeSpring3(): Spring3 {
  return { value: new THREE.Vector3(), velocity: new THREE.Vector3() };
}

/** Critically-damped-ish spring integration, stable at any frame rate. */
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
const _euler = new THREE.Euler();
const _adsPos = new THREE.Vector3();

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
   * tangent. The weapon is scaled by this and held at a fixed distance, which
   * reproduces the apparent size a dedicated narrow-FOV viewmodel camera would
   * give. Scaling position *and* size together would be a no-op — a uniform
   * scale about the eye leaves the projected size unchanged.
   */
  fovScale: number;
}

export class ViewmodelAnimator {
  /** Sway from mouse movement — the weapon lags the view. */
  private readonly sway = makeSpring3();
  /** Recoil translation. */
  private readonly recoil = makeSpring3();
  /** Recoil rotation, stored as euler radians in a Vector3. */
  private readonly recoilRot = makeSpring3();
  /** Blended pose position/rotation. */
  private readonly pose = makeSpring3();
  private readonly poseRot = makeSpring3();
  private boltOffset = 0;
  private boltVelocity = 0;
  private chargeOffset = 0;
  private triggerPull = 0;
  private magDrop = 0;
  private breathPhase = 0;
  private lastAds = 0;

  /** Reset when the weapon is swapped. */
  reset(): void {
    this.sway.value.set(0, 0, 0);
    this.sway.velocity.set(0, 0, 0);
    this.recoil.value.set(0, 0, 0);
    this.recoil.velocity.set(0, 0, 0);
    this.recoilRot.value.set(0, 0, 0);
    this.recoilRot.velocity.set(0, 0, 0);
    this.boltOffset = 0;
    this.magDrop = 0;
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

    /* ------------------------------------------------------- pose */
    // Solve the aim pose so the sight line lands exactly on the optical axis
    // at the weapon's eye relief, for whatever scale the current FOV implies.
    const sight = model.sightOffset;
    _adsPos.set(-k * sight.x, -k * sight.y, model.adsDistance - k * sight.z);
    // Blend hip → ADS, then overlay sprint / slide / lowered poses.
    _target.lerpVectors(model.hipPosition, _adsPos, ads);
    const sprint = view.sprintPose * (1 - ads);
    const slide = view.slidePose * (1 - ads);
    const mantle = view.mantlePose;
    _target.x += sprint * 0.075 + slide * 0.03;
    _target.y += -sprint * 0.06 - slide * 0.1 - mantle * 0.18 - input.lowered * 0.22;
    _target.z += sprint * 0.06 + slide * 0.04 + mantle * 0.08;
    // The reload pulls the weapon in and rolls it toward the shooter, so the
    // magwell faces the off hand.
    const reload = runtime.isReloading ? Math.sin(runtime.reloadProgress * Math.PI) : 0;
    _target.x -= reload * 0.045;
    _target.y -= reload * 0.055;
    _target.z += reload * 0.045;
    springTo(this.pose, _target, 260, 26, dt);

    _target.set(
      model.hipRotation.x * (1 - ads) + model.adsRotation.x * ads,
      model.hipRotation.y * (1 - ads) + model.adsRotation.y * ads,
      model.hipRotation.z * (1 - ads) + model.adsRotation.z * ads,
    );
    // Sprint cants the weapon inboard and drops the muzzle.
    _target.x += sprint * 0.28 + slide * 0.16 + mantle * 0.5 + input.lowered * 0.5;
    _target.y += -sprint * 0.44 - slide * 0.2;
    _target.z += sprint * 0.5 + slide * 0.34 - mantle * 0.3;
    _target.z += reload * 0.55;
    _target.x += reload * 0.22;
    springTo(this.poseRot, _target, 220, 24, dt);

    /* -------------------------------------------------------- sway */
    // The weapon trails the view, more at the hip than aimed.
    const swayScale = (1 - ads * 0.78) * 0.075;
    _target.set(
      THREE.MathUtils.clamp(-input.lookDeltaYaw * 3.4, -0.09, 0.09) * (swayScale / 0.075),
      THREE.MathUtils.clamp(input.lookDeltaPitch * 3.0, -0.08, 0.08) *
        (swayScale / 0.075),
      0,
    );
    springTo(this.sway, _target, 130, 17, dt);

    /* ------------------------------------------------------ recoil */
    if (runtime.firedThisFrame) {
      const kick = runtime.viewKick;
      this.recoil.velocity.z += kick * 44;
      this.recoil.velocity.y += kick * 12;
      this.recoilRot.velocity.x -= kick * 92;
      this.recoilRot.velocity.z += runtime.viewRoll * 34;
      this.boltVelocity = -model.parts.boltTravel * 46;
      this.triggerPull = 1;
    }
    springTo(this.recoil, _zero, 520, 30, dt);
    springTo(this.recoilRot, _zero, 460, 27, dt);

    /* -------------------------------------------------- breathing */
    this.breathPhase += dt * (ads > 0.5 ? 1.15 : 1.65);
    const breathAmp = (ads > 0.5 ? 0.0016 : 0.0042) * (1 - view.sprintPose);
    const breathX = Math.sin(this.breathPhase * 0.63) * breathAmp;
    const breathY = Math.sin(this.breathPhase) * breathAmp * 0.72;

    /* -------------------------------------------------------- bob */
    const bobScale =
      Math.min(1, input.speed / 4.5) * (1 - ads * 0.85) * (input.grounded ? 1 : 0.2);
    const phase = view.bobPhase;
    const bobX = Math.sin(phase) * 0.014 * bobScale;
    const bobY = -Math.abs(Math.cos(phase)) * 0.011 * bobScale;
    const bobRoll = Math.sin(phase) * 0.02 * bobScale;
    // Sprint gets a bigger, slower figure-eight than the walk cycle.
    const sprintBobX = Math.sin(phase * 0.5) * 0.03 * view.sprintPose;
    const sprintBobY = Math.cos(phase) * 0.02 * view.sprintPose;

    /* ------------------------------------------------------- apply */
    const root = model.root;
    root.position.set(
      this.pose.value.x +
        this.sway.value.x +
        bobX +
        sprintBobX +
        breathX +
        this.recoil.value.x,
      this.pose.value.y +
        this.sway.value.y +
        bobY +
        sprintBobY +
        breathY +
        this.recoil.value.y,
      this.pose.value.z + this.recoil.value.z,
    );
    _euler.set(
      this.poseRot.value.x + this.recoilRot.value.x + this.sway.value.y * 0.9,
      this.poseRot.value.y + this.recoilRot.value.y - this.sway.value.x * 1.1,
      this.poseRot.value.z + this.recoilRot.value.z + bobRoll,
      "YXZ",
    );
    root.quaternion.setFromEuler(_euler);

    /* -------------------------------------------- moving sub-parts */
    // Bolt: driven back by the shot, returned by the recoil spring.
    this.boltVelocity += (0 - this.boltOffset) * 900 * dt - this.boltVelocity * 26 * dt;
    this.boltOffset += this.boltVelocity * dt;
    if (this.boltOffset > 0) {
      this.boltOffset = 0;
      this.boltVelocity = 0;
    }
    const travel = Math.max(-model.parts.boltTravel, this.boltOffset);
    model.parts.bolt.position.z = travel * -1;

    // Charging handle: pulled on an empty reload, at the chambering stage.
    const wantsCharge =
      runtime.isReloading && runtime.chambering && runtime.reloadProgress > 0.78 ? 1 : 0;
    this.chargeOffset += (wantsCharge - this.chargeOffset) * Math.min(1, dt * 22);
    model.parts.chargingHandle.position.z =
      this.chargeOffset * model.parts.chargingTravel;

    // Trigger.
    this.triggerPull *= Math.exp(-26 * dt);
    model.parts.trigger.rotation.x = this.triggerPull * 0.32;

    // Magazine: drops out and returns during a reload.
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

    // The reticle only lights up once the optic is close to the eye.
    if (model.parts.opticReticle) {
      const visible = ads > 0.55;
      model.parts.opticReticle.visible = visible;
      if (visible) {
        const material = (model.parts.opticReticle as THREE.Mesh).material;
        if (material instanceof THREE.MeshBasicMaterial) {
          material.opacity = THREE.MathUtils.clamp((ads - 0.55) / 0.35, 0, 1);
        }
      }
    }

    this.lastAds = ads;
  }

  get adsBlend(): number {
    return this.lastAds;
  }
}

const _zero = new THREE.Vector3();
