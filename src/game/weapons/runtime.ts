import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import {
  HIT_REGION_MULTIPLIER,
  MASK_BULLET,
  SURFACE_PROFILES,
  damageAtRange,
  shotInterval,
  type FireMode,
  type Stance,
  type WeaponDef,
} from "../core/types";
import {
  eyePosition,
  queueDamage,
  queueImpact,
  queueSound,
  queueTracer,
  type Actor,
} from "../core/gameState";
import { recordGunfirePing } from "../core/combat";
import type { CollisionWorld } from "../physics/collisionWorld";

/**
 * Weapon fire control and terminal ballistics.
 *
 * Two things separate this from a naive "raycast on click":
 *
 *  1. **Recoil is a pattern, not noise.** Each weapon derives a fixed sequence
 *     of view kicks from its seed, so a player who learns the spray can
 *     control it, exactly as in the games this is modelled on. Random jitter
 *     is layered on top but stays small.
 *  2. **Rounds pass through things.** A bullet walks the ray through up to
 *     four surfaces, spending penetration budget per material and losing
 *     damage as it goes, so shooting somebody through a sheet-metal hangar
 *     wall works and shooting them through a concrete revetment does not.
 */

export type WeaponState =
  "idle" | "firing" | "reloading" | "raising" | "lowering" | "melee" | "inspecting";

export interface ShotContext {
  shooter: Actor;
  world: CollisionWorld;
  time: number;
  /** Aim direction; the runtime applies spread on top. */
  direction: THREE.Vector3;
  /** Muzzle world position for tracers and flashes. */
  origin: THREE.Vector3;
  /** 0..1 skill scalar; bots use it to widen the cone. */
  accuracy: number;
}

interface Projectile {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  shooterId: number;
  weaponId: string;
  damageScale: number;
  life: number;
  distance: number;
  active: boolean;
}

const PATTERN_LENGTH = 40;
const MAX_PENETRATIONS = 4;

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _next = new THREE.Vector3();
const _hitDir = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Deterministic spray pattern: ramp up, then a stable serpentine. */
function buildRecoilPattern(def: WeaponDef): Float32Array {
  const pattern = new Float32Array(PATTERN_LENGTH * 2);
  const rand = mulberry32(def.seed >>> 0);
  const r = def.recoil;
  let phase = rand() * Math.PI * 2;
  for (let i = 0; i < PATTERN_LENGTH; i += 1) {
    const ramp = Math.min(1, (i + 1) / Math.max(1, r.rampShots));
    const sustain = 1 + (r.sustainScale - 1) * ramp;
    // Vertical climbs fast then plateaus — the classic inverted-L spray.
    pattern[i * 2] = r.verticalDeg * sustain * (0.72 + 0.28 * ramp);
    // Horizontal wanders on a slow sine so the pattern is learnable, with a
    // fixed per-weapon perturbation that gives each gun its own signature.
    phase += 0.55 + rand() * 0.35;
    const wander = Math.sin(phase) * 0.7 + (rand() - 0.5) * 0.6;
    pattern[i * 2 + 1] = r.horizontalDeg * sustain * wander * ramp;
  }
  return pattern;
}

export class WeaponRuntime {
  readonly def: WeaponDef;
  private readonly pattern: Float32Array;
  private readonly rand: () => number;

  state: WeaponState = "idle";
  ammo: number;
  reserve: number;
  fireModeIndex = 0;

  /** 0..1 aim-down-sight blend. */
  ads = 0;
  /** Tac-Stance (45-degree canted stance) active flag. */
  tacStance = false;
  /** Heat level 0..2+ accumulated from rapid automatic fire. Drives barrel mirage. */
  barrelHeat = 0;
  /** Whether the weapon chamber inspect animation is currently active. */
  inspecting = false;
  inspectTimer = 0;
  inspectDuration = 3.4;

  /** Accumulated view kick the camera should apply, in radians. */
  kickPitch = 0;
  kickYaw = 0;
  /** The portion of the kick that will auto-recenter. */
  private recenterPitch = 0;
  private recenterYaw = 0;
  /** Viewmodel recoil impulse, consumed by the animation layer. */
  viewKick = 0;
  viewRoll = 0;
  /** Set for one frame after a shot; the animator cycles the bolt on it. */
  firedThisFrame = false;
  /** Set for one frame when a casing should be ejected. */
  ejectThisFrame = false;

  private shotClock = 0;
  private shotsInBurst = 0;
  private burstCooldown = 0;
  private triggerHeld = false;
  private triggerWasHeld = false;
  private shotIndex = 0;
  private lastShotTime = -99;
  private bloom = 0;
  private stateTimer = 0;
  private reloadDuration = 0;
  private reloadWasEmpty = false;
  private pendingChamber = false;
  private readonly projectiles: Projectile[] = [];

  constructor(def: WeaponDef) {
    this.def = def;
    this.pattern = buildRecoilPattern(def);
    this.rand = mulberry32((def.seed ^ 0x5bf03635) >>> 0);
    this.ammo = def.magSize;
    this.reserve = def.startingReserve;
  }

  get fireMode(): FireMode {
    return this.def.fireModes[this.fireModeIndex] ?? "semi";
  }

  get isReloading(): boolean {
    return this.state === "reloading";
  }

  get isInspecting(): boolean {
    return this.inspecting;
  }

  get inspectProgress(): number {
    return this.inspectDuration > 0
      ? Math.min(1, this.inspectTimer / this.inspectDuration)
      : 0;
  }

  get reloadProgress(): number {
    return this.reloadDuration > 0
      ? Math.min(1, this.stateTimer / this.reloadDuration)
      : 0;
  }

  get needsReload(): boolean {
    return this.ammo <= 0 && this.reserve > 0;
  }

  toggleTacStance(): boolean {
    this.tacStance = !this.tacStance;
    return this.tacStance;
  }

  setTacStance(enabled: boolean): void {
    this.tacStance = enabled;
  }

  beginInspect(): boolean {
    if (
      this.state === "reloading" ||
      this.state === "raising" ||
      this.state === "lowering"
    ) {
      return false;
    }
    this.inspecting = true;
    this.inspectTimer = 0;
    this.state = "inspecting";
    queueSound({ id: "weapon-raise", gain: 0.35, pitch: 1.1, weaponId: this.def.id });
    return true;
  }

  cancelInspect(): void {
    if (this.inspecting) {
      this.inspecting = false;
      this.inspectTimer = 0;
      if (this.state === "inspecting") this.state = "idle";
    }
  }

  cycleFireMode(): void {
    if (this.def.fireModes.length < 2) return;
    this.fireModeIndex = (this.fireModeIndex + 1) % this.def.fireModes.length;
    queueSound({ id: "ui-select", gain: 0.5 });
  }

  /** Current cone half-angle in degrees, for the crosshair and for shooting. */
  spreadDeg(stance: Stance, speed: number, airborne: boolean): number {
    const s = this.def.spread;
    // In Tac-Stance, aimed spread is tightly collimated for tactical laser point-shooting
    const targetAimed = this.tacStance ? s.hipDeg * 0.25 + s.adsDeg * 0.75 : s.adsDeg;
    const aimed = s.hipDeg + (targetAimed - s.hipDeg) * this.ads;
    let spread = aimed;
    const adsDamping = 1 - this.ads * 0.88;
    spread += s.moveDeg * Math.min(1, speed / 5) * adsDamping;
    if (airborne) spread += s.airDeg * (1 - this.ads * 0.5);
    if (stance === "crouch") spread *= s.crouchScale;
    else if (stance === "prone") spread *= s.crouchScale * 0.72;
    return spread + this.bloom * adsDamping;
  }

  /* ---------------------------------------------------------------- */
  /* Per-frame                                                         */
  /* ---------------------------------------------------------------- */

  update(
    dt: number,
    context: {
      wantsFire: boolean;
      wantsAds: boolean;
      canFire: boolean;
      adsTimeScale?: number;
    },
  ): void {
    this.firedThisFrame = false;
    this.ejectThisFrame = false;
    this.triggerWasHeld = this.triggerHeld;
    this.triggerHeld = context.wantsFire;

    // Any combat input instantly cancels weapon inspect
    if (
      this.inspecting &&
      (context.wantsFire ||
        context.wantsAds ||
        !context.canFire ||
        this.state === "reloading")
    ) {
      this.cancelInspect();
    }

    if (this.inspecting) {
      this.inspectTimer += dt;
      if (this.inspectTimer >= this.inspectDuration) {
        this.cancelInspect();
      }
    }

    // Dissipate barrel heat from sustained automatic fire
    this.barrelHeat = Math.max(0, this.barrelHeat - dt * 0.22);

    const h = this.def.handling;
    const adsTarget =
      context.wantsAds && context.canFire && this.state !== "reloading" ? 1 : 0;
    const adsRate = dt / Math.max(0.02, h.adsTime * (context.adsTimeScale ?? 1));
    this.ads =
      adsTarget > this.ads
        ? Math.min(1, this.ads + adsRate)
        : Math.max(0, this.ads - adsRate * 1.25);

    this.shotClock = Math.max(0, this.shotClock - dt);
    this.burstCooldown = Math.max(0, this.burstCooldown - dt);
    this.bloom = Math.max(0, this.bloom - this.def.spread.bloomDecayDegPerSec * dt);

    // View kick recovery: the recentring portion springs back, the rest is
    // permanent and has to be pulled down by the player.
    const recovery = Math.min(1, dt / Math.max(0.02, this.def.recoil.recoveryTime));
    const dPitch = this.recenterPitch * recovery;
    const dYaw = this.recenterYaw * recovery;
    this.kickPitch -= dPitch;
    this.kickYaw -= dYaw;
    this.recenterPitch -= dPitch;
    this.recenterYaw -= dYaw;

    this.viewKick *= Math.exp(-14 * dt);
    this.viewRoll *= Math.exp(-12 * dt);

    if (
      this.state === "reloading" ||
      this.state === "raising" ||
      this.state === "lowering"
    ) {
      this.stateTimer += dt;
      this.tickReloadStages();
      if (this.stateTimer >= this.reloadDuration) {
        if (this.state === "reloading") this.completeReload();
        this.state = "idle";
        this.stateTimer = 0;
      }
    }

    // Auto-reload when the trigger is pulled on an empty chamber.
    if (
      this.state === "idle" &&
      this.ammo <= 0 &&
      this.reserve > 0 &&
      context.wantsFire &&
      !this.triggerWasHeld
    ) {
      this.beginReload();
    }
  }

  /** Returns true when the trigger should produce a shot this instant. */
  wantsShot(canFire: boolean): boolean {
    if (!canFire || this.state === "reloading" || this.state === "raising") return false;
    if (this.shotClock > 0 || this.burstCooldown > 0) return false;
    if (this.ammo <= 0) {
      if (this.triggerHeld && !this.triggerWasHeld) {
        queueSound({ id: "dry-fire", gain: 0.6, weaponId: this.def.id });
        this.shotClock = 0.2;
      }
      return false;
    }
    const mode = this.fireMode;
    if (mode === "auto") return this.triggerHeld;
    if (mode === "burst") {
      if (this.shotsInBurst > 0) return true;
      return this.triggerHeld && !this.triggerWasHeld;
    }
    return this.triggerHeld && !this.triggerWasHeld;
  }

  /* ---------------------------------------------------------------- */
  /* Firing                                                            */
  /* ---------------------------------------------------------------- */

  fire(context: ShotContext): void {
    const def = this.def;
    this.cancelInspect();
    this.ammo -= 1;
    this.shotClock = shotInterval(def.rpm);
    this.lastShotTime = context.time;
    this.firedThisFrame = true;
    this.ejectThisFrame = def.weaponClass !== "melee" && def.weaponClass !== "launcher";
    this.shotIndex += 1;
    // Accumulate barrel heat for mirage distortion effects
    this.barrelHeat = Math.min(2.5, this.barrelHeat + (def.weaponClass === "lmg" ? 0.09 : 0.12));

    if (this.fireMode === "burst") {
      this.shotsInBurst =
        this.shotsInBurst === 0 ? def.burstCount - 1 : this.shotsInBurst - 1;
      if (this.shotsInBurst === 0) this.burstCooldown = def.burstDelay;
    }

    /* -------------------------------------------------- view kick */
    const index = Math.min(PATTERN_LENGTH - 1, this.shotIndex - 1);
    const jitter = (this.rand() - 0.5) * 2 * def.recoil.jitterDeg;
    const pitchDeg = this.pattern[index * 2]!;
    const yawDeg = this.pattern[index * 2 + 1]! + jitter;
    const adsScale = 1 - this.ads * (this.tacStance ? 0.18 : 0.24);
    const pitchRad = THREE.MathUtils.degToRad(pitchDeg) * adsScale;
    const yawRad = THREE.MathUtils.degToRad(yawDeg) * adsScale;
    this.kickPitch += pitchRad;
    this.kickYaw += yawRad;
    this.recenterPitch += pitchRad * def.recoil.recenterFraction;
    this.recenterYaw += yawRad * def.recoil.recenterFraction;
    this.viewKick += def.recoil.viewKickM;
    this.viewRoll += def.recoil.viewRollRad * (this.rand() > 0.5 ? 1 : -1);
    this.bloom = Math.min(
      def.spread.maxBloomDeg,
      this.bloom + def.spread.bloomPerShotDeg,
    );

    /* ------------------------------------------------------ audio */
    queueSound({
      id: "fire",
      position: context.origin.clone(),
      weaponId: def.id,
      gain: 1,
      pitch: 0.985 + this.rand() * 0.03,
      variant: this.shotIndex & 7,
    });
    recordGunfirePing(context.shooter, context.time);

    /* ---------------------------------------------------- rounds */
    const spread = THREE.MathUtils.degToRad(
      this.spreadDeg(
        context.shooter.stance,
        context.shooter.speed,
        !context.shooter.grounded,
      ) *
        (2 - context.accuracy),
    );
    const pellets = def.ballistics.pellets;
    for (let p = 0; p < pellets; p += 1) {
      this.fireOne(context, spread, p, pellets);
    }
  }

  private fireOne(
    context: ShotContext,
    spreadRad: number,
    pelletIndex: number,
    pelletCount: number,
  ): void {
    const def = this.def;
    _dir.copy(context.direction).normalize();
    // Build a stable basis around the aim direction so the cone is uniform.
    _right.crossVectors(_dir, WORLD_UP);
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _right.normalize();
    _up.crossVectors(_right, _dir).normalize();

    if (spreadRad > 1e-5) {
      let angle: number;
      let radius: number;
      if (pelletCount > 1) {
        // Shotgun: a deterministic ring pattern with a centre pellet, which
        // is far more readable than uniform random scatter.
        angle = (pelletIndex / pelletCount) * Math.PI * 2 + this.shotIndex * 0.7;
        radius = pelletIndex === 0 ? 0 : 0.45 + 0.55 * ((pelletIndex % 3) / 2);
      } else {
        angle = this.rand() * Math.PI * 2;
        radius = Math.sqrt(this.rand());
      }
      const offset = Math.tan(spreadRad) * radius;
      _dir
        .addScaledVector(_right, Math.cos(angle) * offset)
        .addScaledVector(_up, Math.sin(angle) * offset)
        .normalize();
    }

    if (def.weaponClass === "sniper" || def.weaponClass === "launcher") {
      this.spawnProjectile(context, _dir);
      return;
    }

    this.traceBullet(context, _dir);
  }

  /**
   * Walk the ray through the world, spending penetration budget per surface.
   * Returns the final impact point.
   */
  private traceBullet(context: ShotContext, direction: THREE.Vector3): void {
    const def = this.def;
    const world = context.world;
    _origin.copy(context.origin);
    let remaining = 1;
    let travelled = 0;
    let penetrations = 0;
    let tracerEmitted = false;
    const maxRange = def.weaponClass === "shotgun" ? 60 : 420;

    while (penetrations <= MAX_PENETRATIONS) {
      const hit = world.raycast(
        _origin,
        direction,
        maxRange - travelled,
        MASK_BULLET,
        context.shooter.id,
      );
      if (!hit) {
        if (!tracerEmitted) {
          this.emitTracer(
            context,
            _origin,
            _next.copy(_origin).addScaledVector(direction, 120),
          );
        }
        return;
      }
      travelled += hit.distance;

      if (!tracerEmitted) {
        this.emitTracer(context, context.origin, hit.point);
        tracerEmitted = true;
      }

      const profile = SURFACE_PROFILES[hit.surface];

      /* ------------------------------------------------ character */
      if (hit.entityId !== null && hit.region !== null) {
        const base = damageAtRange(def.ballistics.damage, travelled);
        const amount = base * HIT_REGION_MULTIPLIER[hit.region] * remaining;
        _hitDir.copy(direction);
        queueDamage({
          targetId: hit.entityId,
          attackerId: context.shooter.id,
          amount,
          kind: "bullet",
          region: hit.region,
          direction: _hitDir.clone(),
          point: hit.point.clone(),
          distanceM: travelled,
          penetrated: penetrations > 0,
          weaponId: def.id,
          time: context.time,
        });
        queueImpact({
          kind: hit.region === "head" ? "blood-headshot" : "blood",
          point: hit.point.clone(),
          normal: hit.normal.clone(),
          surface: "flesh",
          incoming: direction.clone(),
          energy: Math.min(1, remaining),
        });
        // A round that defeats a body keeps going, at a cost.
        remaining *= 0.45;
        penetrations += 1;
        if (remaining < 0.12) return;
        _origin.copy(hit.point).addScaledVector(direction, 0.35);
        continue;
      }

      /* ---------------------------------------------------- world */
      // Ricochet: shallow hits on hard materials skip rather than embed.
      const grazing = Math.abs(direction.dot(hit.normal));
      if (grazing < 0.28 && this.rand() < profile.ricochetChance && penetrations === 0) {
        queueImpact({
          kind: "ricochet",
          point: hit.point.clone(),
          normal: hit.normal.clone(),
          surface: hit.surface,
          incoming: direction.clone(),
          energy: remaining,
        });
        queueSound({
          id: "ricochet",
          position: hit.point.clone(),
          surface: hit.surface,
          gain: 0.7,
        });
        direction.reflect(hit.normal).normalize();
        _origin.copy(hit.point).addScaledVector(direction, 0.02);
        remaining *= 0.45;
        penetrations += 1;
        if (remaining < 0.15) return;
        continue;
      }

      queueImpact({
        kind: penetrations > 0 ? "penetration-exit" : "bullet",
        point: hit.point.clone(),
        normal: hit.normal.clone(),
        surface: hit.surface,
        incoming: direction.clone(),
        energy: remaining,
      });
      queueSound({
        id: "impact",
        position: hit.point.clone(),
        surface: hit.surface,
        gain: Math.min(1, 0.55 * remaining + 0.2),
      });

      const budget = profile.penetrationDepthM * def.ballistics.penetrationScale;
      const thickness = Math.min(hit.thicknessM, 2);
      if (thickness > budget) return;

      // Damage retention falls off with how much of the budget was spent.
      remaining *=
        profile.damageRetention * (1 - (thickness / Math.max(1e-4, budget)) * 0.5);
      penetrations += 1;
      if (remaining < 0.1) return;
      _origin.copy(hit.point).addScaledVector(direction, thickness + 0.02);
    }
  }

  private emitTracer(context: ShotContext, from: THREE.Vector3, to: THREE.Vector3): void {
    const every = this.def.ballistics.tracerEvery;
    if (every <= 0) return;
    if (this.shotIndex % every !== 0) return;
    queueTracer({
      from: from.clone(),
      to: to.clone(),
      speed: this.def.ballistics.muzzleVelocity,
      color: this.def.ballistics.tracerColor,
      local: context.shooter.isPlayer,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Projectiles (heavy calibre + launcher)                            */
  /* ---------------------------------------------------------------- */

  private spawnProjectile(context: ShotContext, direction: THREE.Vector3): void {
    let slot = this.projectiles.find((p) => !p.active);
    if (!slot) {
      slot = {
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        shooterId: 0,
        weaponId: this.def.id,
        damageScale: 1,
        life: 0,
        distance: 0,
        active: false,
      };
      this.projectiles.push(slot);
    }
    slot.position.copy(context.origin);
    slot.velocity.copy(direction).multiplyScalar(this.def.ballistics.muzzleVelocity);
    slot.shooterId = context.shooter.id;
    slot.weaponId = this.def.id;
    slot.damageScale = 1;
    slot.life = 0;
    slot.distance = 0;
    slot.active = true;
    queueTracer({
      from: context.origin.clone(),
      to: _next.copy(context.origin).addScaledVector(direction, 4).clone(),
      speed: this.def.ballistics.muzzleVelocity,
      color: this.def.ballistics.tracerColor,
      local: context.shooter.isPlayer,
    });
  }

  /** Integrate in-flight rounds. Call once per frame from the game loop. */
  updateProjectiles(dt: number, world: CollisionWorld, time: number): void {
    const gravity = 9.81;
    const drag = this.def.weaponClass === "launcher" ? 0.02 : 0.0008;
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.life += dt;
      if (p.life > 6) {
        p.active = false;
        continue;
      }
      p.velocity.y -= gravity * dt;
      p.velocity.multiplyScalar(1 - drag * dt * 60);
      const step = p.velocity.length() * dt;
      _dir.copy(p.velocity).normalize();
      const hit = world.raycast(p.position, _dir, step, MASK_BULLET, p.shooterId);
      if (hit) {
        p.active = false;
        p.distance += hit.distance;
        const base = damageAtRange(this.def.ballistics.damage, p.distance);
        if (hit.entityId !== null && hit.region !== null) {
          queueDamage({
            targetId: hit.entityId,
            attackerId: p.shooterId,
            amount: base * HIT_REGION_MULTIPLIER[hit.region],
            kind: this.def.weaponClass === "launcher" ? "explosion" : "bullet",
            region: hit.region,
            direction: _dir.clone(),
            point: hit.point.clone(),
            distanceM: p.distance,
            penetrated: false,
            weaponId: p.weaponId,
            time,
          });
        }
        queueImpact({
          kind: this.def.weaponClass === "launcher" ? "explosion" : "bullet",
          point: hit.point.clone(),
          normal: hit.normal.clone(),
          surface: hit.surface,
          incoming: _dir.clone(),
          energy: 1,
        });
        queueSound({
          id: this.def.weaponClass === "launcher" ? "explosion" : "impact",
          position: hit.point.clone(),
          surface: hit.surface,
        });
        continue;
      }
      p.position.addScaledVector(p.velocity, dt);
      p.distance += step;
    }
  }

  getActiveProjectiles(): readonly Projectile[] {
    return this.projectiles;
  }

  /* ---------------------------------------------------------------- */
  /* Reloading                                                         */
  /* ---------------------------------------------------------------- */

  beginReload(): boolean {
    if (this.state === "reloading") return false;
    if (this.ammo >= this.def.magSize || this.reserve <= 0) return false;
    if (this.def.weaponClass === "melee") return false;
    this.reloadWasEmpty = this.ammo <= 0;
    this.reloadDuration = this.reloadWasEmpty
      ? this.def.handling.reloadEmptyTime
      : this.def.handling.reloadTime;
    this.state = "reloading";
    this.stateTimer = 0;
    this.pendingChamber = this.reloadWasEmpty;
    queueSound({ id: "reload-start", gain: 0.7, weaponId: this.def.id });
    return true;
  }

  private reloadStage = 0;

  private tickReloadStages(): void {
    if (this.state !== "reloading") return;
    const t = this.stateTimer / Math.max(1e-3, this.reloadDuration);
    const stages: [number, "reload-mag-out" | "reload-mag-in" | "reload-bolt"][] = [
      [0.22, "reload-mag-out"],
      [0.58, "reload-mag-in"],
      [0.85, "reload-bolt"],
    ];
    for (let i = this.reloadStage; i < stages.length; i += 1) {
      const [at, id] = stages[i]!;
      if (t < at) break;
      if (id === "reload-bolt" && !this.reloadWasEmpty) {
        this.reloadStage = i + 1;
        continue;
      }
      queueSound({ id, gain: 0.75, weaponId: this.def.id });
      this.reloadStage = i + 1;
    }
  }

  private completeReload(): void {
    const wanted = this.def.magSize - this.ammo;
    const taken = Math.min(wanted, this.reserve);
    this.ammo += taken;
    this.reserve -= taken;
    this.shotIndex = 0;
    this.reloadStage = 0;
    this.pendingChamber = false;
  }

  /** Called when the weapon is swapped in. */
  raise(): void {
    this.state = "raising";
    this.stateTimer = 0;
    this.reloadDuration = this.def.handling.raiseTime;
    this.ads = 0;
    queueSound({ id: "weapon-raise", gain: 0.5, weaponId: this.def.id });
  }

  /** Reset spray memory when the trigger has been released long enough. */
  maybeResetPattern(time: number): void {
    if (this.shotIndex > 0 && time - this.lastShotTime > 0.42) this.shotIndex = 0;
  }

  refill(): void {
    this.ammo = this.def.magSize;
    this.reserve = this.def.startingReserve;
    this.shotIndex = 0;
    this.bloom = 0;
    this.kickPitch = 0;
    this.kickYaw = 0;
    this.recenterPitch = 0;
    this.recenterYaw = 0;
    this.state = "idle";
    this.stateTimer = 0;
    this.reloadStage = 0;
    for (const p of this.projectiles) p.active = false;
  }

  get chambering(): boolean {
    return this.pendingChamber;
  }
}

/** Convenience for AI and the player rig: muzzle world position + direction. */
export function computeMuzzleRay(
  actor: Actor,
  out: { origin: THREE.Vector3; direction: THREE.Vector3 },
): void {
  eyePosition(actor, out.origin);
  out.direction.copy(actor.aimDir).normalize();
}
