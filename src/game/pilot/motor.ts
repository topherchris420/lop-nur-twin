import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import type { EntityId, FireMode, Stance, WeaponClass } from "../core/types";
import { forwardToYaw, yawDelta } from "../core/types";
import type { InputState } from "../core/gameState";
import type { AimAction } from "./contract";
import { aimRegionGeometry, angularRadiusDeg, coneHitFraction } from "./hitGeometry";
import { SIGHT_RANGE_M } from "./observation";

/**
 * The precision motor controller: the local, deterministic layer that carries
 * out a brain's *engagement intent* at frame rate.
 *
 * Jev answers in 130–230 ms. That is ample for choosing what to do and far too
 * slow to hold a crosshair on a moving torso through recoil, which needs a
 * correction every frame. So the work is split, the way it is split in a
 * person: the brain chooses — which visible enemy, which part of it, whether
 * the trigger may be pulled, how to move — and this controller executes that
 * choice with a bounded, continuous control law.
 *
 * What it does, every simulation step while a target is bound:
 *
 *  - **Tracks** the chosen aim point with a rate- and acceleration-limited
 *    closed loop: a velocity profile that is time-optimal far from the target
 *    (it can decelerate within its own acceleration limit, so it never
 *    overshoots) and first-order — critically damped, no oscillation — near it,
 *    plus the target's own angular velocity as feed-forward.
 *  - **Sees like a player.** It reads the target only while a sight line from
 *    the eye reaches it, samples it with a short perceptual delay, and
 *    estimates motion from those samples alone, extrapolating a capped
 *    horizon. It never reads a velocity, a plan or anything through a wall.
 *  - **Knows the recoil pattern**, as a practised player does: after each shot
 *    it counters most of that shot's *deterministic* kick
 *    (`WeaponRuntime.lastPatternKickDeg`). The random jitter is left to the
 *    feedback loop, and the kick itself still happens in full.
 *  - **Gates the trigger.** Fire intent is permission to engage, not an order
 *    to empty the magazine: it presses only while the geometric share of the
 *    weapon's real spread cone that falls on the chosen region clears a
 *    threshold. The round is still drawn and traced by `WeaponRuntime` and the
 *    collision world; nothing here decides a hit.
 *  - **Shapes, never invents.** It drops a sprint that would block a shot it
 *    was asked to take, and briefly counter-strafes to settle a shot the
 *    movement spread is spoiling — then gives the brain's movement back.
 *
 * What it never does: pick a target (it tracks only the one it was given, and
 * lets go when that one dies, leaves sight, or is not re-confirmed in time),
 * track through a wall, touch the camera, the actor, a collider or the damage
 * queue. Its entire output is the `InputState` a mouse and keyboard write.
 */

/* ------------------------------------------------------------------ */
/* Tuning — every limit is a limit on a person-like hand               */
/* ------------------------------------------------------------------ */

export const MOTOR = {
  /** Peak view rotation from the hip, °/s. A fast flick, not a teleport. */
  maxRateDegS: 560,
  /** Peak view rotation fully aimed down the sights, °/s. */
  maxRateAdsDegS: 300,
  /** Peak angular acceleration, °/s². */
  maxAccelDegS2: 4200,
  /** Proportional gain of the near-target loop, 1/s (time constant ≈ 85 ms). */
  gain: 11.5,
  /** Margin on the braking curve, so saturation never overshoots. */
  brakeMargin: 0.82,
  /**
   * Target samples are used this old: a perceptual delay. A person's visual
   * loop is slower still; the brain's own decision latency sits on top.
   */
  perceptionDelayS: 0.05,
  /** Extrapolation beyond the delay, s — covers the one-frame shot lag. */
  leadS: 1 / 60,
  /** Longest extrapolation of observed motion, s. */
  maxHorizonS: 0.22,
  /** Velocity estimate smoothing (per-sample blend). */
  velocityBlend: 0.35,
  /** Sight lost for longer than this releases the target. */
  losGraceS: 0.12,
  /** A binding not re-confirmed by a decision within this long is released. */
  bindingTimeoutS: 1.0,
  /** Share of the learned recoil pattern countered. Not 1: skilled, not perfect. */
  recoilLearned: 0.9,
  /** Time constant over which a recoil counter-rotation is applied, s. */
  recoilTauS: 0.03,
  /**
   * Micro-tremor of the hand, degrees (seeded, smooth). The first live run at
   * 0.03° held a 100 m head for one-shot kills 17 times in 45 s — steadier than
   * any person. 0.06° is an elite marksman's hold, not a machine's.
   */
  tremorDeg: 0.06,
  /** Fire gate: share of the spread cone on the region needed to start. */
  gateOpen: { auto: 0.42, single: 0.55 },
  /** Fire gate: share needed to keep an automatic burst going. */
  gateHold: 0.24,
  /**
   * Inside close range rounds are cheap and time is not: hip fire at a body a
   * few metres away is the right trade even when most of the cone misses.
   */
  gateOpenClose: { auto: 0.16, single: 0.3 },
  gateHoldClose: 0.1,
  /** A multi-pellet shell needs only part of its pattern on the body. */
  gateOpenPellets: 0.18,
  /** Longest automatic burst before the gate re-checks against `gateOpen`. */
  maxBurstRounds: 9,
  /** Aimed shots wait for this much of the sight picture, beyond close range. */
  adsSettled: 0.7,
  closeRangeM: 12,
  /** Longest counter-strafe to settle one shot, s, then movement is returned. */
  stabilizeMaxS: 0.28,
  stabilizeCooldownS: 0.7,
  /** Below this speed the body counts as settled, m/s. */
  settledSpeed: 0.7,
} as const;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const G = 9.81;

/* ------------------------------------------------------------------ */
/* What the controller may sense                                        */
/* ------------------------------------------------------------------ */

export interface MotorWeapon {
  readonly fireMode: FireMode;
  readonly weaponClass: WeaponClass;
  /** Metres per second; used for projectile lead and drop only. */
  readonly muzzleVelocity: number;
  /** Pellets per round: 1 except for shotguns. */
  readonly pellets: number;
  readonly ads: number;
  /**
   * A pull this step would release a round: the action cycles within this
   * step, there is a round, the weapon is not reloading or raising, and the
   * rig is not blocking the shot. The rig advances the weapon's clock after
   * the controller runs, so "ready now" would lag a held trigger by a round.
   */
  readonly readyToFire: boolean;
  readonly isReloading: boolean;
  spreadDeg(stance: Stance, speed: number, airborne: boolean): number;
}

export interface MotorBody {
  stance: Stance;
  position: THREE.Vector3;
}

export interface MotorSense {
  /** Simulation seconds. */
  now: number;
  /** Where rounds leave from: the player's eye. */
  eye: THREE.Vector3;
  /** Where rounds go this step: the camera's forward, unit length. */
  aim: THREE.Vector3;
  /** Half the current horizontal and vertical field of view, degrees. */
  halfFovDeg: { h: number; v: number };
  player: {
    speed: number;
    stance: Stance;
    grounded: boolean;
    yaw: number;
    velocity: THREE.Vector3;
  };
  weapon: MotorWeapon | null;
  /** A living body by id, or null. Its position is read only when in sight. */
  body(id: EntityId): MotorBody | null;
  /** An unobstructed sight line from the eye to `point`, ignoring `id`'s own boxes. */
  sightline(id: EntityId, point: THREE.Vector3): boolean;
}

/** What the brain asked for, re-stated every decision. */
export interface EngagementIntent {
  targetId: EntityId;
  aim: AimAction;
}

/** Whether the brain's weapon choice currently permits firing and aiming. */
export interface TriggerIntent {
  fire: boolean;
  ads: boolean;
  sprintRequested: boolean;
  /**
   * The frame that carries this intent named a target. Its fire permission
   * belongs to that target: once the target is gone, the trigger stays
   * released rather than emptying the magazine into the wall it went behind.
   */
  forTarget?: boolean;
}

export type ReleaseReason =
  "eliminated" | "lost_sight" | "timeout" | "cleared" | "switched";

export type GateState = "idle" | "tracking" | "settling" | "open" | "held";

export interface MotorTelemetry {
  bound: boolean;
  targetId: EntityId | null;
  aim: AimAction | null;
  /** The region actually held when the chosen one is out of sight. */
  heldAim: AimAction | null;
  /** Angle from the crosshair to the live aim point, degrees. */
  errorDeg: number | null;
  /** Share of the spread cone on the region, as the gate estimated it. */
  hitShare: number | null;
  gate: GateState;
  distanceM: number | null;
  stabilizing: boolean;
}

/** Everything the controller counts, for the metrics layer. */
export interface MotorEvents {
  onBind?(targetId: EntityId, switched: boolean): void;
  onRelease?(targetId: EntityId, reason: ReleaseReason): void;
  onAcquired?(seconds: number): void;
  onTrackingSample?(errorDeg: number): void;
  /** One step where the brain's fire intent stood and a round could have left. */
  onTriggerOpportunity?(fired: boolean): void;
  onRecoilCompensation?(degrees: number): void;
}

/* ------------------------------------------------------------------ */

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
}

interface Binding {
  targetId: EntityId;
  aim: AimAction;
  confirmedAt: number;
  boundAt: number;
  acquired: boolean;
  hit: boolean;
  lostFor: number;
  samples: Sample[];
  vx: number;
  vy: number;
  vz: number;
  hasVelocity: boolean;
  lastDesiredYaw: number | null;
  lastDesiredPitch: number | null;
  omegaYaw: number;
  omegaPitch: number;
  lastFeet: THREE.Vector3;
  lastStance: Stance;
}

const _point = new THREE.Vector3();
const _head = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _to = new THREE.Vector3();
const _predicted = new THREE.Vector3();
const _live = new THREE.Vector3();

/** Angle between two directions, degrees. */
function angleBetween(a: THREE.Vector3, b: THREE.Vector3): number {
  const dot = THREE.MathUtils.clamp(a.dot(b) / (a.length() * b.length() || 1), -1, 1);
  return Math.acos(dot) * RAD;
}

function pitchOf(v: THREE.Vector3): number {
  return Math.asin(THREE.MathUtils.clamp(v.y / (v.length() || 1), -1, 1));
}

/**
 * One axis of the control law. `error` and `omega` in degrees and °/s; `v` is
 * the axis's current commanded rate. Returns the new rate.
 */
export function axisRate(
  error: number,
  omega: number,
  v: number,
  dt: number,
  maxRate: number,
  maxAccel: number,
): number {
  const magnitude = Math.abs(error);
  // Far away: the fastest rate that can still stop within `maxAccel`.
  // Close in: proportional, which converges exponentially with no overshoot.
  const approach = Math.min(
    MOTOR.gain * magnitude,
    Math.sqrt(2 * maxAccel * magnitude) * MOTOR.brakeMargin,
  );
  const wanted = THREE.MathUtils.clamp(
    omega + Math.sign(error) * approach,
    -maxRate,
    maxRate,
  );
  const step = maxAccel * dt;
  return v + THREE.MathUtils.clamp(wanted - v, -step, step);
}

export class PrecisionMotorController {
  private binding: Binding | null = null;
  private rateYaw = 0;
  private ratePitch = 0;
  /** Recoil counter-rotation still to apply, degrees (yaw left-positive, pitch up). */
  private pendingYaw = 0;
  private pendingPitch = 0;
  private triggerDown = false;
  private burstRounds = 0;
  private gateLatched = false;
  private stabilizeFor = 0;
  private stabilizeCooldown = 0;
  private readonly tremor: () => number;
  private tremorYaw = 0;
  private tremorPitch = 0;
  /** Look deltas written on the last step, radians, for weapon sway. */
  lastLookYaw = 0;
  lastLookPitch = 0;
  events: MotorEvents = {};
  readonly telemetry: MotorTelemetry = {
    bound: false,
    targetId: null,
    aim: null,
    heldAim: null,
    errorDeg: null,
    hitShare: null,
    gate: "idle",
    distanceM: null,
    stabilizing: false,
  };

  constructor(seed = 0x6a09e667) {
    this.tremor = mulberry32(seed >>> 0);
  }

  get targetId(): EntityId | null {
    return this.binding?.targetId ?? null;
  }

  get aim(): AimAction | null {
    return this.binding?.aim ?? null;
  }

  /**
   * Adopt the brain's latest engagement choice. The same target re-confirms the
   * binding; a different one switches; null releases.
   */
  engage(intent: EngagementIntent | null, now: number): void {
    const current = this.binding;
    if (!intent) {
      if (current) this.release("cleared");
      return;
    }
    if (current && current.targetId === intent.targetId) {
      current.confirmedAt = now;
      current.aim = intent.aim;
      return;
    }
    const switched = current !== null;
    if (current) this.release("switched");
    this.binding = {
      targetId: intent.targetId,
      aim: intent.aim,
      confirmedAt: now,
      boundAt: now,
      acquired: false,
      hit: false,
      lostFor: 0,
      samples: [],
      vx: 0,
      vy: 0,
      vz: 0,
      hasVelocity: false,
      lastDesiredYaw: null,
      lastDesiredPitch: null,
      omegaYaw: 0,
      omegaPitch: 0,
      lastFeet: new THREE.Vector3(),
      lastStance: "stand",
    };
    this.gateLatched = false;
    this.burstRounds = 0;
    this.events.onBind?.(intent.targetId, switched);
  }

  /**
   * The resolver applied the player's damage to `victimId`. Returns seconds
   * from choosing the target to this, the first hit on it, or null.
   */
  noteHit(victimId: EntityId, now: number): number | null {
    const binding = this.binding;
    if (!binding || binding.hit || binding.targetId !== victimId) return null;
    binding.hit = true;
    return Math.max(0, now - binding.boundAt);
  }

  /** Let go of everything: death, takeover, a brain switch. */
  reset(): void {
    if (this.binding) this.release("cleared");
    this.rateYaw = 0;
    this.ratePitch = 0;
    this.pendingYaw = 0;
    this.pendingPitch = 0;
    this.triggerDown = false;
    this.burstRounds = 0;
    this.gateLatched = false;
    this.stabilizeFor = 0;
    this.stabilizeCooldown = 0;
    this.lastLookYaw = 0;
    this.lastLookPitch = 0;
    this.idleTelemetry();
  }

  private release(reason: ReleaseReason): void {
    const binding = this.binding;
    if (!binding) return;
    this.binding = null;
    this.pendingYaw = 0;
    this.pendingPitch = 0;
    this.gateLatched = false;
    this.burstRounds = 0;
    this.events.onRelease?.(binding.targetId, reason);
  }

  private idleTelemetry(): void {
    const t = this.telemetry;
    t.bound = false;
    t.targetId = null;
    t.aim = null;
    t.heldAim = null;
    t.errorDeg = null;
    t.hitShare = null;
    t.gate = "idle";
    t.distanceM = null;
    t.stabilizing = false;
  }

  /**
   * A round left the weapon. `kickDeg` is that shot's deterministic pattern
   * kick (pitch up, yaw left-positive as the rig applies it), which the
   * controller counters over the next few steps. Returns the correction queued.
   */
  onShot(kickDeg: { pitch: number; yaw: number }): number {
    if (!this.binding) return 0;
    const pitch = -kickDeg.pitch * MOTOR.recoilLearned;
    const yaw = -kickDeg.yaw * MOTOR.recoilLearned;
    this.pendingPitch += pitch;
    this.pendingYaw += yaw;
    this.burstRounds += 1;
    const magnitude = Math.hypot(pitch, yaw);
    this.events.onRecoilCompensation?.(magnitude);
    return magnitude;
  }

  /**
   * One simulation step. Writes look, trigger, sights and — only to make the
   * requested action coherent — movement into `input`, which already holds the
   * executor's frame. With nothing bound it leaves `input` alone.
   */
  apply(input: InputState, sense: MotorSense, trigger: TriggerIntent, dt: number): void {
    this.lastLookYaw = 0;
    this.lastLookPitch = 0;
    this.stabilizeCooldown = Math.max(0, this.stabilizeCooldown - dt);
    const binding = this.binding;
    if (binding && sense.now - binding.confirmedAt > MOTOR.bindingTimeoutS) {
      this.release("timeout");
    }
    const bound = this.binding;
    if (!bound || dt <= 0) {
      this.rateYaw = 0;
      this.ratePitch = 0;
      this.triggerDown = false;
      this.stabilizeFor = 0;
      this.idleTelemetry();
      if (trigger.forTarget) {
        input.fire = false;
        input.firePressed = false;
      }
      return;
    }

    const body = sense.body(bound.targetId);
    if (!body) {
      this.release("eliminated");
      this.rateYaw = 0;
      this.ratePitch = 0;
      this.idleTelemetry();
      if (trigger.fire) input.fire = false;
      return;
    }

    /* ---------------------------------------------------- sight */
    const headGeo = aimRegionGeometry("HEAD", body.stance);
    const chestGeo = aimRegionGeometry("UPPER_CHEST", body.stance);
    _head.set(body.position.x, body.position.y + headGeo.heightM, body.position.z);
    _chest.set(body.position.x, body.position.y + chestGeo.heightM, body.position.z);
    const distance = _chest.distanceTo(sense.eye);
    const inView = (point: THREE.Vector3): boolean => {
      _to.copy(point).sub(sense.eye);
      const bearing =
        yawDelta(forwardToYaw(sense.aim.x, sense.aim.z), forwardToYaw(_to.x, _to.z)) *
        RAD;
      const elevation = (pitchOf(_to) - pitchOf(sense.aim)) * RAD;
      return (
        Math.abs(bearing) <= sense.halfFovDeg.h &&
        Math.abs(elevation) <= sense.halfFovDeg.v
      );
    };
    const headSeen =
      distance <= SIGHT_RANGE_M &&
      inView(_head) &&
      sense.sightline(bound.targetId, _head);
    const chestSeen =
      distance <= SIGHT_RANGE_M &&
      inView(_chest) &&
      sense.sightline(bound.targetId, _chest);
    const visible = headSeen || chestSeen;

    // The chosen region, unless it is the part out of sight: then the part
    // that can be seen. The brain chose the enemy; hiding its head behind a
    // crate does not turn the choice into a shot at the crate.
    let held: AimAction = bound.aim;
    if (visible) {
      if (held === "HEAD" && !headSeen) held = "UPPER_CHEST";
      else if (held !== "HEAD" && !chestSeen) held = "HEAD";
    }
    const region = aimRegionGeometry(held, body.stance);

    if (visible) {
      bound.lostFor = 0;
      bound.lastFeet.copy(body.position);
      bound.lastStance = body.stance;
      this.observe(bound, sense.now, body.position);
    } else {
      bound.lostFor += dt;
      if (bound.lostFor > MOTOR.losGraceS) {
        this.release("lost_sight");
        this.rateYaw = 0;
        this.ratePitch = 0;
        this.idleTelemetry();
        if (trigger.fire) input.fire = false;
        return;
      }
    }

    /* ----------------------------------------------- prediction */
    // The newest sample the delay allows, carried forward by the estimated
    // velocity. During the sight-loss grace the last sample is extrapolated —
    // nothing is read from the body while it is out of sight.
    const delayed = this.delayedSample(bound, sense.now - MOTOR.perceptionDelayS);
    const sampleAge = Math.max(0, sense.now - delayed.t);
    const flight =
      sense.weapon &&
      (sense.weapon.weaponClass === "sniper" || sense.weapon.weaponClass === "launcher")
        ? distance / Math.max(60, sense.weapon.muzzleVelocity)
        : 0;
    const horizon = Math.min(MOTOR.maxHorizonS, sampleAge + MOTOR.leadS + flight);
    const vx = bound.hasVelocity ? bound.vx : 0;
    const vy = bound.hasVelocity ? bound.vy : 0;
    const vz = bound.hasVelocity ? bound.vz : 0;
    _predicted.set(
      delayed.x + vx * horizon,
      delayed.y + vy * horizon + region.heightM + 0.5 * G * flight * flight,
      delayed.z + vz * horizon,
    );
    // What the gate judges: where the region is *now*, by the same estimate
    // (no extra lead), not by reading the body.
    const nowHorizon = Math.min(MOTOR.maxHorizonS, sampleAge + flight);
    _point.set(
      delayed.x + vx * nowHorizon,
      delayed.y + vy * nowHorizon + region.heightM + 0.5 * G * flight * flight,
      delayed.z + vz * nowHorizon,
    );

    /* -------------------------------------------------- tremor */
    this.tremorYaw +=
      ((this.tremor() - 0.5) * 2 * MOTOR.tremorDeg - this.tremorYaw) *
      Math.min(1, dt * 6);
    this.tremorPitch +=
      ((this.tremor() - 0.5) * 2 * MOTOR.tremorDeg - this.tremorPitch) *
      Math.min(1, dt * 6);

    /* ------------------------------------------------- control */
    _to.copy(_predicted).sub(sense.eye);
    const desiredYaw = forwardToYaw(_to.x, _to.z) + this.tremorYaw * DEG;
    const desiredPitch = pitchOf(_to) + this.tremorPitch * DEG;
    const currentYaw = forwardToYaw(sense.aim.x, sense.aim.z);
    const currentPitch = pitchOf(sense.aim);

    if (bound.lastDesiredYaw !== null && bound.lastDesiredPitch !== null) {
      const wYaw = (yawDelta(bound.lastDesiredYaw, desiredYaw) * RAD) / dt;
      const wPitch = ((desiredPitch - bound.lastDesiredPitch) * RAD) / dt;
      const blend = Math.min(1, dt * 18);
      bound.omegaYaw += (THREE.MathUtils.clamp(wYaw, -400, 400) - bound.omegaYaw) * blend;
      bound.omegaPitch +=
        (THREE.MathUtils.clamp(wPitch, -200, 200) - bound.omegaPitch) * blend;
    }
    bound.lastDesiredYaw = desiredYaw;
    bound.lastDesiredPitch = desiredPitch;

    // The part of the error the queued recoil counter-rotation will remove is
    // not the feedback loop's to chase; without this the two corrections add
    // and the crosshair dips under the target after every shot.
    const errorYaw = yawDelta(currentYaw, desiredYaw) * RAD - this.pendingYaw;
    const errorPitch = (desiredPitch - currentPitch) * RAD - this.pendingPitch;
    const ads = sense.weapon?.ads ?? 0;
    const maxRate = THREE.MathUtils.lerp(MOTOR.maxRateDegS, MOTOR.maxRateAdsDegS, ads);
    this.rateYaw = axisRate(
      errorYaw,
      bound.omegaYaw,
      this.rateYaw,
      dt,
      maxRate,
      MOTOR.maxAccelDegS2,
    );
    this.ratePitch = axisRate(
      errorPitch,
      bound.omegaPitch,
      this.ratePitch,
      dt,
      maxRate * 0.7,
      MOTOR.maxAccelDegS2 * 0.7,
    );
    const recoilBlend = 1 - Math.exp(-dt / MOTOR.recoilTauS);
    const counterYaw = this.pendingYaw * recoilBlend;
    const counterPitch = this.pendingPitch * recoilBlend;
    this.pendingYaw -= counterYaw;
    this.pendingPitch -= counterPitch;
    const stepYaw = this.rateYaw * dt + counterYaw;
    const stepPitch = this.ratePitch * dt + counterPitch;
    // The executor's fixed rotations are the brain's search controls; while a
    // target is tracked the tracking loop owns the view instead.
    input.lookYaw = stepYaw * DEG;
    input.lookPitch = stepPitch * DEG;
    this.lastLookYaw = input.lookYaw;
    this.lastLookPitch = input.lookPitch;

    /* ------------------------------------------------ measure */
    const gateError = angleBetween(sense.aim, _to.copy(_point).sub(sense.eye));
    const radiusDeg = angularRadiusDeg(region.radiusM, distance);
    // The live error is a measurement for telemetry and statistics, taken only
    // while the region is in sight; the controller itself never uses it.
    let liveError: number | null = null;
    if (visible) {
      _live.set(body.position.x, body.position.y + region.heightM, body.position.z);
      liveError = angleBetween(sense.aim, _to.copy(_live).sub(sense.eye));
      if (!bound.acquired && liveError <= radiusDeg) {
        bound.acquired = true;
        this.events.onAcquired?.(sense.now - bound.boundAt);
      }
      if (bound.acquired) this.events.onTrackingSample?.(liveError);
    }

    /* ------------------------------------------------ trigger */
    const weapon = sense.weapon;
    const spread = weapon
      ? weapon.spreadDeg(sense.player.stance, sense.player.speed, !sense.player.grounded)
      : 90;
    const share = coneHitFraction(gateError, spread, radiusDeg);
    const single = weapon ? weapon.fireMode !== "auto" : true;
    const close = distance <= MOTOR.closeRangeM;
    const openAt =
      weapon && weapon.pellets > 1
        ? MOTOR.gateOpenPellets
        : close
          ? single
            ? MOTOR.gateOpenClose.single
            : MOTOR.gateOpenClose.auto
          : single
            ? MOTOR.gateOpen.single
            : MOTOR.gateOpen.auto;
    const holdAt = close ? MOTOR.gateHoldClose : MOTOR.gateHold;
    const adsSettled =
      !trigger.ads || ads >= MOTOR.adsSettled || distance <= MOTOR.closeRangeM;

    let gate: GateState = "tracking";
    let wantFire = false;
    if (trigger.fire && weapon && visible && !weapon.isReloading) {
      if (!adsSettled) {
        gate = "settling";
      } else if (single) {
        wantFire = share >= openAt;
      } else {
        if (this.gateLatched) {
          // Judged only when a round could leave: between rounds the kick has
          // just displaced the view and the counter-rotation is still landing,
          // and holding the trigger through that costs nothing.
          if (weapon.readyToFire) {
            const burstSpent = this.burstRounds >= MOTOR.maxBurstRounds && share < openAt;
            this.gateLatched = share >= holdAt && !burstSpent;
          }
        } else {
          this.gateLatched = share >= openAt;
          if (this.gateLatched) this.burstRounds = 0;
        }
        wantFire = this.gateLatched;
      }
      if (gate !== "settling") gate = wantFire ? "open" : "held";
    } else {
      this.gateLatched = false;
    }

    let fire = false;
    if (wantFire && weapon) {
      if (single) {
        // One press per round: release for a step after each press, and press
        // only when the action has cycled, so no pull is wasted on a bolt.
        fire = !this.triggerDown && weapon.readyToFire;
      } else {
        fire = true;
      }
    }
    if (trigger.fire && weapon && weapon.readyToFire && visible) {
      this.events.onTriggerOpportunity?.(fire);
    }
    input.fire = fire;
    if (fire && !this.triggerDown) input.firePressed = true;
    this.triggerDown = fire;
    input.ads = trigger.ads;

    /* ----------------------------------------------- movement */
    let stabilizing = false;
    if (trigger.fire) {
      // A sprint blocks the weapon; asked to fire, the body walks instead.
      if (input.sprint) input.sprint = false;
      if (weapon && visible && sense.player.grounded) {
        const still = coneHitFraction(
          gateError,
          weapon.spreadDeg(sense.player.stance, 0, false),
          radiusDeg,
        );
        const movementSpoils =
          share < openAt && still >= openAt && sense.player.speed > MOTOR.settledSpeed;
        if (
          movementSpoils &&
          this.stabilizeCooldown <= 0 &&
          this.stabilizeFor < MOTOR.stabilizeMaxS
        ) {
          stabilizing = true;
          this.stabilizeFor += dt;
          // Counter-strafe: press against the body's own drift, in its frame.
          const fx = -Math.sin(sense.player.yaw);
          const fz = -Math.cos(sense.player.yaw);
          const forward = sense.player.velocity.x * fx + sense.player.velocity.z * fz;
          const right = sense.player.velocity.x * -fz + sense.player.velocity.z * fx;
          input.moveX = Math.abs(right) > 0.4 ? -Math.sign(right) : 0;
          input.moveY = Math.abs(forward) > 0.4 ? -Math.sign(forward) : 0;
          input.sprint = false;
        } else if (this.stabilizeFor > 0) {
          this.stabilizeFor = 0;
          this.stabilizeCooldown = MOTOR.stabilizeCooldownS;
        }
      }
    } else {
      this.stabilizeFor = 0;
    }

    const t = this.telemetry;
    t.bound = true;
    t.targetId = bound.targetId;
    t.aim = bound.aim;
    t.heldAim = held;
    t.errorDeg = liveError;
    t.hitShare = visible ? share : null;
    t.gate = gate;
    t.distanceM = distance;
    t.stabilizing = stabilizing;
  }

  private observe(binding: Binding, now: number, feet: THREE.Vector3): void {
    const samples = binding.samples;
    const last = samples[samples.length - 1];
    if (last && now - last.t > 1e-6) {
      const dt = now - last.t;
      const vx = (feet.x - last.x) / dt;
      const vy = (feet.y - last.y) / dt;
      const vz = (feet.z - last.z) / dt;
      // A respawn or a teleport is not motion.
      if (Math.hypot(vx, vz) < 15) {
        if (binding.hasVelocity) {
          const k = MOTOR.velocityBlend;
          binding.vx += (vx - binding.vx) * k;
          binding.vy += (vy - binding.vy) * k;
          binding.vz += (vz - binding.vz) * k;
        } else {
          binding.vx = vx;
          binding.vy = vy;
          binding.vz = vz;
          binding.hasVelocity = true;
        }
      }
    }
    if (!last || now - last.t > 1e-6) {
      samples.push({ t: now, x: feet.x, y: feet.y, z: feet.z });
      if (samples.length > 24) samples.shift();
    }
  }

  /** The sample at `t`, interpolated; the oldest or newest when out of range. */
  private delayedSample(binding: Binding, t: number): Sample {
    const samples = binding.samples;
    if (samples.length === 0) {
      const f = binding.lastFeet;
      return { t, x: f.x, y: f.y, z: f.z };
    }
    const newest = samples[samples.length - 1]!;
    if (t >= newest.t) return newest;
    for (let i = samples.length - 1; i > 0; i -= 1) {
      const b = samples[i]!;
      const a = samples[i - 1]!;
      if (a.t <= t && t <= b.t) {
        const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
        return {
          t,
          x: a.x + (b.x - a.x) * k,
          y: a.y + (b.y - a.y) * k,
          z: a.z + (b.z - a.z) * k,
        };
      }
    }
    return samples[0]!;
  }
}
