import * as THREE from "three";
import type { InputState } from "../core/gameState";
import type { EntityId, Stance } from "../core/types";
import { aimRegionGeometry, angularRadiusDeg } from "../pilot/hitGeometry";

/**
 * Elite Operator: aim help for a human, in the manner of a polished console
 * shooter — and nothing more.
 *
 * The human is authoritative. This layer only *reshapes the mouse's own
 * motion* for a frame, and only while the crosshair is already on or next to a
 * visible enemy:
 *
 *  - **Friction** — the look is slowed a little across a body, most near its
 *    centre, so a sweep stops on the target instead of sailing past.
 *  - **Rotational assist** — while aiming down the sights and moving (the
 *    mouse or the feet), a small share of the target's own angular motion is
 *    added, capped at a few degrees a second.
 *  - **Learned recoil help** (optional) — part of each shot's deterministic
 *    pattern kick is countered, as a practised hand would. The kick still
 *    lands; jitter is untouched.
 *
 * It never fires, never snaps, never picks a target the crosshair is not
 * already near, never follows one through a wall (sight lines are tested every
 * frame with the same `hasLineOfSight` the bots use), never pulls toward a
 * target the mouse is moving away from, and switches itself off for a moment
 * on any fast flick — the mouse always overpowers it.
 */

export const ELITE = {
  /** A target counts as "near the crosshair" inside this many body-radii… */
  coneRadii: 3,
  /** …and never beyond these angular bounds, degrees. */
  minConeDeg: 1.2,
  maxConeDeg: 4,
  /** Peak look slowdown on the body's centre, hip and fully aimed. */
  frictionHip: 0.22,
  frictionAds: 0.38,
  /** Friction fades to nothing this many body-radii from the aim point. */
  frictionRadii: 1.8,
  /** Share of the target's angular velocity added while aiming and moving. */
  rotationShare: 0.3,
  /** Rotational assist is capped at this rate, °/s. */
  maxAssistDegS: 6,
  /** Aim-down-sights blend from which rotational assist applies. */
  rotationFromAds: 0.5,
  /** A look faster than this is a flick: the assist steps aside, °/s. */
  flickDegS: 220,
  /** …for this long, s. */
  flickHoldS: 0.25,
  /** Moving away from the target faster than this switches the help off, °/s. */
  awayDegS: 15,
  /** Share of the learned recoil pattern countered. A hand, not a machine. */
  recoilShare: 0.45,
  recoilTauS: 0.06,
} as const;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export interface AssistEnemy {
  id: EntityId;
  position: THREE.Vector3;
  stance: Stance;
}

export interface AssistSense {
  dt: number;
  eye: THREE.Vector3;
  aim: THREE.Vector3;
  halfFovDeg: { h: number; v: number };
  /** 0..1 aim-down-sights blend. */
  ads: number;
  /** The player's own speed, m/s — rotational assist needs movement. */
  playerSpeed: number;
  /** Living enemies. Their position is used only when a sight line reaches them. */
  enemies: readonly AssistEnemy[];
  sightline(id: EntityId, point: THREE.Vector3): boolean;
}

export interface AssistTelemetry {
  active: boolean;
  candidateId: EntityId | null;
  /** Share of the mouse's motion removed this frame. */
  friction: number;
  /** Rotation added this frame, degrees. */
  assistDeg: number;
  overridden: boolean;
}

const _point = new THREE.Vector3();
const _to = new THREE.Vector3();

function yawPitch(v: THREE.Vector3): { yaw: number; pitch: number } {
  return {
    yaw: Math.atan2(-v.x, -v.z),
    pitch: Math.asin(THREE.MathUtils.clamp(v.y / (v.length() || 1), -1, 1)),
  };
}

function wrap(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class EliteOperatorAssist {
  private candidate: EntityId | null = null;
  private last: { yaw: number; pitch: number } | null = null;
  private omegaYaw = 0;
  private omegaPitch = 0;
  private flickFor = 0;
  private pendingYaw = 0;
  private pendingPitch = 0;
  readonly telemetry: AssistTelemetry = {
    active: false,
    candidateId: null,
    friction: 0,
    assistDeg: 0,
    overridden: false,
  };

  reset(): void {
    this.candidate = null;
    this.last = null;
    this.omegaYaw = 0;
    this.omegaPitch = 0;
    this.flickFor = 0;
    this.pendingYaw = 0;
    this.pendingPitch = 0;
    this.telemetry.active = false;
    this.telemetry.candidateId = null;
    this.telemetry.friction = 0;
    this.telemetry.assistDeg = 0;
    this.telemetry.overridden = false;
  }

  /** A round left the weapon; `kickDeg` is its deterministic pattern kick. */
  onShot(kickDeg: { pitch: number; yaw: number }, recoilAssist: boolean): void {
    if (!recoilAssist) return;
    this.pendingPitch -= kickDeg.pitch * ELITE.recoilShare;
    this.pendingYaw -= kickDeg.yaw * ELITE.recoilShare;
  }

  /**
   * Reshape this frame's mouse look in `input` (radians, rig convention: yaw
   * left-positive, pitch up-positive). Fire, movement and every other field are
   * never touched.
   */
  apply(input: InputState, sense: AssistSense): void {
    const t = this.telemetry;
    t.friction = 0;
    t.assistDeg = 0;
    t.overridden = false;
    const dt = Math.max(1e-4, sense.dt);

    // Learned recoil help rides on top of whatever the mouse does.
    const blend = 1 - Math.exp(-dt / ELITE.recoilTauS);
    const counterYaw = this.pendingYaw * blend;
    const counterPitch = this.pendingPitch * blend;
    this.pendingYaw -= counterYaw;
    this.pendingPitch -= counterPitch;

    const mouseYawDeg = input.lookYaw * RAD;
    const mousePitchDeg = input.lookPitch * RAD;
    const mouseRate = Math.hypot(mouseYawDeg, mousePitchDeg) / dt;
    this.flickFor =
      mouseRate > ELITE.flickDegS ? ELITE.flickHoldS : Math.max(0, this.flickFor - dt);

    const found = this.pick(sense);
    if (!found || this.flickFor > 0) {
      if (found && this.flickFor > 0) t.overridden = true;
      this.candidate = this.flickFor > 0 ? null : this.candidate;
      this.last = null;
      t.active = false;
      t.candidateId = null;
      input.lookYaw += counterYaw * DEG;
      input.lookPitch += counterPitch * DEG;
      return;
    }

    const { errorYaw, errorPitch, errorDeg, radiusDeg } = found;
    // Where the mouse is heading, relative to the target: positive is toward.
    const toward =
      errorDeg > 1e-6
        ? (mouseYawDeg * errorYaw + mousePitchDeg * errorPitch) / (errorDeg * dt)
        : 0;
    const movingAway = toward < -ELITE.awayDegS;

    // Angular velocity of the target's aim point, from successive sightings.
    _to.copy(found.point).sub(sense.eye);
    const now = yawPitch(_to);
    if (this.last && this.candidate === found.id) {
      const k = Math.min(1, dt * 12);
      this.omegaYaw += ((wrap(now.yaw - this.last.yaw) * RAD) / dt - this.omegaYaw) * k;
      this.omegaPitch +=
        (((now.pitch - this.last.pitch) * RAD) / dt - this.omegaPitch) * k;
    } else {
      this.omegaYaw = 0;
      this.omegaPitch = 0;
    }
    this.last = now;
    this.candidate = found.id;

    // Friction: only on the body, strongest at its centre, never when leaving it.
    const zone = radiusDeg * ELITE.frictionRadii;
    const proximity = Math.max(0, 1 - errorDeg / Math.max(1e-6, zone));
    const peak = THREE.MathUtils.lerp(ELITE.frictionHip, ELITE.frictionAds, sense.ads);
    const friction = movingAway ? 0 : peak * proximity;
    let yaw = mouseYawDeg * (1 - friction);
    let pitch = mousePitchDeg * (1 - friction);

    // Rotational assist: aimed, moving, not moving away — a nudge, capped.
    let assist = 0;
    const moving = mouseRate > 2 || sense.playerSpeed > 0.6;
    if (sense.ads >= ELITE.rotationFromAds && moving && !movingAway) {
      let addYaw = this.omegaYaw * ELITE.rotationShare;
      let addPitch = this.omegaPitch * ELITE.rotationShare;
      const rate = Math.hypot(addYaw, addPitch);
      if (rate > ELITE.maxAssistDegS) {
        addYaw *= ELITE.maxAssistDegS / rate;
        addPitch *= ELITE.maxAssistDegS / rate;
      }
      yaw += addYaw * dt;
      pitch += addPitch * dt;
      assist = Math.hypot(addYaw, addPitch) * dt;
    }

    input.lookYaw = (yaw + counterYaw) * DEG;
    input.lookPitch = (pitch + counterPitch) * DEG;
    t.active = true;
    t.candidateId = found.id;
    t.friction = friction;
    t.assistDeg = assist;
  }

  /**
   * The visible enemy nearest the crosshair inside the assist cone. The one
   * already held keeps priority while it stays inside a slightly larger cone,
   * so the help never jumps between two bodies crossing each other.
   */
  private pick(sense: AssistSense): {
    id: EntityId;
    point: THREE.Vector3;
    errorYaw: number;
    errorPitch: number;
    errorDeg: number;
    radiusDeg: number;
  } | null {
    const aim = yawPitch(sense.aim);
    let best: {
      id: EntityId;
      point: THREE.Vector3;
      errorYaw: number;
      errorPitch: number;
      errorDeg: number;
      radiusDeg: number;
      score: number;
    } | null = null;
    for (const enemy of sense.enemies) {
      const region = aimRegionGeometry("UPPER_CHEST", enemy.stance);
      _point.set(enemy.position.x, enemy.position.y + region.heightM, enemy.position.z);
      _to.copy(_point).sub(sense.eye);
      const distance = _to.length();
      if (distance < 0.5 || distance > 165) continue;
      const dir = yawPitch(_to);
      const errorYaw = wrap(dir.yaw - aim.yaw) * RAD;
      const errorPitch = (dir.pitch - aim.pitch) * RAD;
      if (
        Math.abs(errorYaw) > sense.halfFovDeg.h ||
        Math.abs(errorPitch) > sense.halfFovDeg.v
      )
        continue;
      const errorDeg = Math.hypot(errorYaw, errorPitch);
      const radiusDeg = angularRadiusDeg(region.radiusM, distance);
      const cone = THREE.MathUtils.clamp(
        radiusDeg * ELITE.coneRadii,
        ELITE.minConeDeg,
        ELITE.maxConeDeg,
      );
      const held = enemy.id === this.candidate;
      if (errorDeg > cone * (held ? 1.25 : 1)) continue;
      const score = errorDeg / (held ? 1.5 : 1);
      if (best && score >= best.score) continue;
      if (!sense.sightline(enemy.id, _point)) continue;
      best = {
        id: enemy.id,
        point: _point.clone(),
        errorYaw,
        errorPitch,
        errorDeg,
        radiusDeg,
        score,
      };
    }
    return best;
  }
}
