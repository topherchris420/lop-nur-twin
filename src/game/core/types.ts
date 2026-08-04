import * as THREE from "three";

/**
 * Shared vocabulary for the combat simulation.
 *
 * Every game subsystem (physics, weapons, AI, FX, audio, HUD) codes against
 * the types in this file. Nothing here imports a subsystem, so the module
 * graph stays acyclic and each system can be developed independently.
 *
 * Units are SI and match the twin: metres, seconds, kilograms, radians.
 * World axes follow `src/lib/layout.ts` — `+x` east, `+z` south, `y` up.
 */

/* ------------------------------------------------------------------ */
/* Factions                                                            */
/* ------------------------------------------------------------------ */

export type Team = "blue" | "red";

export const OPPOSING_TEAM: Record<Team, Team> = { blue: "red", red: "blue" };

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

/**
 * The material a bullet just hit. Drives impact decals, particle colour,
 * ricochet probability, penetration cost and the impact sound bank.
 */
export type SurfaceType =
  | "concrete"
  | "metal"
  | "thin-metal"
  | "sand"
  | "gravel"
  | "glass"
  | "wood"
  | "rubber"
  | "fabric"
  | "flesh"
  | "foliage";

export interface SurfaceProfile {
  /** Metres of this material a nominal 5.56 round can defeat. */
  readonly penetrationDepthM: number;
  /** Fraction of damage kept per metre travelled through the material. */
  readonly damageRetention: number;
  /** 0..1 chance a grazing hit deflects instead of embedding. */
  readonly ricochetChance: number;
  /** Debris/spark tint used by the impact effect. */
  readonly debrisColor: number;
  /** Multiplier on impact-flash brightness (metal sparks, concrete puffs). */
  readonly sparkiness: number;
  /** Restitution + friction used when grenades and casings bounce. */
  readonly restitution: number;
  readonly friction: number;
}

export const SURFACE_PROFILES: Readonly<Record<SurfaceType, SurfaceProfile>> = {
  concrete: { penetrationDepthM: 0.09, damageRetention: 0.42, ricochetChance: 0.16, debrisColor: 0xb9b1a2, sparkiness: 0.15, restitution: 0.34, friction: 0.72 },
  metal: { penetrationDepthM: 0.014, damageRetention: 0.3, ricochetChance: 0.34, debrisColor: 0xffcf8a, sparkiness: 1, restitution: 0.42, friction: 0.5 },
  "thin-metal": { penetrationDepthM: 0.05, damageRetention: 0.72, ricochetChance: 0.18, debrisColor: 0xffd79b, sparkiness: 0.85, restitution: 0.38, friction: 0.55 },
  sand: { penetrationDepthM: 0.35, damageRetention: 0.24, ricochetChance: 0.05, debrisColor: 0xcbb489, sparkiness: 0, restitution: 0.12, friction: 0.94 },
  gravel: { penetrationDepthM: 0.24, damageRetention: 0.3, ricochetChance: 0.12, debrisColor: 0xa89a83, sparkiness: 0.08, restitution: 0.2, friction: 0.88 },
  glass: { penetrationDepthM: 0.4, damageRetention: 0.92, ricochetChance: 0.02, debrisColor: 0xd6e6ee, sparkiness: 0.3, restitution: 0.25, friction: 0.4 },
  wood: { penetrationDepthM: 0.16, damageRetention: 0.66, ricochetChance: 0.06, debrisColor: 0x9a7a52, sparkiness: 0.04, restitution: 0.28, friction: 0.66 },
  rubber: { penetrationDepthM: 0.07, damageRetention: 0.5, ricochetChance: 0.03, debrisColor: 0x38383a, sparkiness: 0, restitution: 0.5, friction: 0.9 },
  fabric: { penetrationDepthM: 0.5, damageRetention: 0.95, ricochetChance: 0.01, debrisColor: 0x8d8570, sparkiness: 0, restitution: 0.1, friction: 0.95 },
  flesh: { penetrationDepthM: 0.3, damageRetention: 0.55, ricochetChance: 0, debrisColor: 0x6d0d0d, sparkiness: 0, restitution: 0.05, friction: 0.98 },
  foliage: { penetrationDepthM: 1.2, damageRetention: 0.98, ricochetChance: 0, debrisColor: 0x6f7346, sparkiness: 0, restitution: 0.2, friction: 0.85 },
};

/* ------------------------------------------------------------------ */
/* Hit resolution                                                      */
/* ------------------------------------------------------------------ */

export type HitRegion = "head" | "neck" | "chest" | "stomach" | "arm" | "leg" | "foot";

/** Damage multiplier per hit region, in the CoD tradition. */
export const HIT_REGION_MULTIPLIER: Readonly<Record<HitRegion, number>> = {
  head: 3.2,
  neck: 2.1,
  chest: 1.15,
  stomach: 1,
  arm: 0.85,
  leg: 0.8,
  foot: 0.72,
};

/** Bitmask layers used to filter raycasts and sweeps. */
export const LAYER = {
  world: 1 << 0,
  /** Structures, walls, pavement — anything static and opaque. */
  prop: 1 << 1,
  /** Character hitboxes. */
  character: 1 << 2,
  /** Blocks movement but not sight or bullets (invisible clip volumes). */
  clip: 1 << 3,
  /** Blocks sight/bullets only after penetration is exhausted (glass, mesh). */
  penetrable: 1 << 4,
  /** Water surfaces. */
  water: 1 << 5,
} as const;

export const MASK_SOLID = LAYER.world | LAYER.prop;
export const MASK_MOVEMENT = LAYER.world | LAYER.prop | LAYER.clip;
export const MASK_BULLET = LAYER.world | LAYER.prop | LAYER.character | LAYER.penetrable;
export const MASK_SIGHT = LAYER.world | LAYER.prop;

export interface RayHit {
  /** Distance along the ray, in metres. */
  distance: number;
  point: THREE.Vector3;
  /** Unit surface normal at the hit, pointing back toward the ray origin. */
  normal: THREE.Vector3;
  surface: SurfaceType;
  layer: number;
  /** Entity struck, or `null` for static world geometry. */
  entityId: EntityId | null;
  region: HitRegion | null;
  /** Thickness of the struck volume along the ray, for penetration maths. */
  thicknessM: number;
  /** Collider identifier, useful for decal parenting and debugging. */
  colliderId: number;
}

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

export type EntityId = number;

/** The local player always owns this id, so systems can special-case it. */
export const PLAYER_ENTITY_ID: EntityId = 0;

export type Stance = "stand" | "crouch" | "prone";

export type CharacterState =
  | "idle"
  | "walk"
  | "run"
  | "sprint"
  | "slide"
  | "mantle"
  | "jump"
  | "fall"
  | "dead";

export interface CharacterMetrics {
  /** Capsule radius in metres. */
  readonly radius: number;
  /** Eye height above the feet, per stance. */
  readonly eyeHeight: Readonly<Record<Stance, number>>;
  /** Total collider height, per stance. */
  readonly colliderHeight: Readonly<Record<Stance, number>>;
  /** Maximum step the capsule can walk up without a mantle. */
  readonly stepHeight: number;
  /** Steepest walkable slope, in radians. */
  readonly maxSlope: number;
}

export const HUMAN_METRICS: CharacterMetrics = {
  radius: 0.34,
  eyeHeight: { stand: 1.62, crouch: 1.06, prone: 0.36 },
  colliderHeight: { stand: 1.8, crouch: 1.24, prone: 0.5 },
  stepHeight: 0.42,
  maxSlope: (52 * Math.PI) / 180,
};

/* ------------------------------------------------------------------ */
/* Damage                                                              */
/* ------------------------------------------------------------------ */

export type DamageKind =
  | "bullet"
  | "explosion"
  | "melee"
  | "fall"
  | "fire"
  | "shrapnel";

export interface DamageEvent {
  targetId: EntityId;
  attackerId: EntityId;
  amount: number;
  kind: DamageKind;
  region: HitRegion | null;
  /** Unit vector from attacker toward target, for hit-direction UI. */
  direction: THREE.Vector3;
  point: THREE.Vector3;
  /** Metres between muzzle and impact. */
  distanceM: number;
  /** True when the round passed through geometry before landing. */
  penetrated: boolean;
  weaponId: string;
  time: number;
}

/* ------------------------------------------------------------------ */
/* Weapons                                                             */
/* ------------------------------------------------------------------ */

export type WeaponClass =
  | "assault"
  | "smg"
  | "lmg"
  | "marksman"
  | "sniper"
  | "shotgun"
  | "pistol"
  | "launcher"
  | "melee";

export type FireMode = "auto" | "semi" | "burst" | "bolt" | "pump";

export interface DamageProfilePoint {
  /** Range in metres at which this damage applies. */
  rangeM: number;
  /** Damage per bullet at that range, before hit-region multipliers. */
  damage: number;
}

export interface RecoilProfile {
  /** Degrees of upward view kick per shot at the start of the pattern. */
  verticalDeg: number;
  /** Degrees of horizontal kick; sign alternates through the pattern. */
  horizontalDeg: number;
  /** How quickly the pattern ramps to its sustained value, in shots. */
  rampShots: number;
  /** Sustained vertical multiplier once the ramp completes. */
  sustainScale: number;
  /** Fraction of the kick that recenters automatically, 0..1. */
  recenterFraction: number;
  /** Seconds for the visual kick to settle. */
  recoveryTime: number;
  /** Deterministic per-shot horizontal jitter, in degrees. */
  jitterDeg: number;
  /** Backward + rotational kick of the viewmodel, metres and radians. */
  viewKickM: number;
  viewRollRad: number;
}

export interface SpreadProfile {
  /** Cone half-angle in degrees when standing and hip-firing. */
  hipDeg: number;
  /** Cone half-angle when fully aimed down sight. */
  adsDeg: number;
  /** Added while moving at full speed. */
  moveDeg: number;
  /** Added while airborne. */
  airDeg: number;
  /** Multiplier while crouched. */
  crouchScale: number;
  /** Degrees added per shot, up to `maxBloomDeg`. */
  bloomPerShotDeg: number;
  maxBloomDeg: number;
  /** Degrees of bloom recovered per second. */
  bloomDecayDegPerSec: number;
}

export interface WeaponHandling {
  /** Seconds from hip to fully aimed. */
  adsTime: number;
  /** Seconds to swap this weapon in / out. */
  raiseTime: number;
  lowerTime: number;
  /** Tactical (magazine retained) and empty (bolt catch) reload seconds. */
  reloadTime: number;
  reloadEmptyTime: number;
  /** Seconds from sprint to able-to-fire. */
  sprintOutTime: number;
  /** ADS field of view, in degrees. */
  adsFov: number;
  /** Movement speed multipliers. */
  moveScale: number;
  adsMoveScale: number;
}

export interface WeaponBallistics {
  /** Muzzle velocity in m/s; drives tracer speed and lead. */
  muzzleVelocity: number;
  /** Rounds that a single trigger event fires (shotgun pellets). */
  pellets: number;
  /** Damage-versus-range curve, ordered by range. */
  damage: readonly DamageProfilePoint[];
  /** Multiplier on `SurfaceProfile.penetrationDepthM`. */
  penetrationScale: number;
  /** Bullets per tracer, or 0 for none. */
  tracerEvery: number;
  tracerColor: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  /** Short in-fiction designation shown in the HUD. */
  shortName: string;
  weaponClass: WeaponClass;
  fireModes: readonly FireMode[];
  /** Rounds per minute for the primary fire mode. */
  rpm: number;
  burstCount: number;
  /** Seconds between bursts. */
  burstDelay: number;
  magSize: number;
  startingReserve: number;
  ballistics: WeaponBallistics;
  recoil: RecoilProfile;
  spread: SpreadProfile;
  handling: WeaponHandling;
  /** Deterministic seed for this weapon's procedural model and audio. */
  seed: number;
  /** Description shown in the loadout screen. */
  blurb: string;
}

/* ------------------------------------------------------------------ */
/* Audio                                                               */
/* ------------------------------------------------------------------ */

export type SoundId =
  | "fire"
  | "fire-suppressed"
  | "dry-fire"
  | "reload-start"
  | "reload-mag-out"
  | "reload-mag-in"
  | "reload-bolt"
  | "weapon-raise"
  | "impact"
  | "ricochet"
  | "whizz"
  | "footstep"
  | "land"
  | "slide"
  | "vault"
  | "explosion"
  | "grenade-bounce"
  | "grenade-pin"
  | "hitmarker"
  | "kill"
  | "headshot"
  | "damage"
  | "death"
  | "ui-select"
  | "ui-confirm"
  | "killstreak-ready"
  | "jet-pass"
  | "shell-drop";

export interface SoundRequest {
  id: SoundId;
  /** World position; omit for 2D/UI sounds. */
  position?: THREE.Vector3;
  /** Linear gain multiplier. */
  gain?: number;
  /** Playback-rate multiplier, used for pitch variation. */
  pitch?: number;
  /** Surface for impact/footstep variants. */
  surface?: SurfaceType;
  /** Weapon that produced the sound, for per-weapon timbre. */
  weaponId?: string;
  /** Deterministic variation index. */
  variant?: number;
}

/* ------------------------------------------------------------------ */
/* Effects                                                             */
/* ------------------------------------------------------------------ */

export type ImpactKind =
  | "bullet"
  | "ricochet"
  | "penetration-exit"
  | "explosion"
  | "blood"
  | "blood-headshot";

export interface ImpactRequest {
  kind: ImpactKind;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  surface: SurfaceType;
  /** Incoming direction, for directional debris. */
  incoming: THREE.Vector3;
  /** 0..1 energy scalar; scales particle counts and decal size. */
  energy: number;
}

export interface TracerRequest {
  from: THREE.Vector3;
  to: THREE.Vector3;
  speed: number;
  color: number;
  /** Thicker, brighter tracer for the local player's own rounds. */
  local: boolean;
}

/* ------------------------------------------------------------------ */
/* Match / mode                                                        */
/* ------------------------------------------------------------------ */

export type GameModeId = "tdm" | "domination" | "ffa" | "hardpoint" | "gunfight";

export type MatchPhase = "warmup" | "live" | "overtime" | "post";

export interface KillEvent {
  attackerId: EntityId;
  attackerName: string;
  attackerTeam: Team;
  victimId: EntityId;
  victimName: string;
  victimTeam: Team;
  weaponId: string;
  headshot: boolean;
  penetrated: boolean;
  distanceM: number;
  time: number;
}

/* ------------------------------------------------------------------ */
/* Small helpers shared across systems                                 */
/* ------------------------------------------------------------------ */

/** Sample a damage-versus-range curve with linear interpolation. */
export function damageAtRange(
  curve: readonly DamageProfilePoint[],
  rangeM: number,
): number {
  if (curve.length === 0) return 0;
  const first = curve[0]!;
  if (rangeM <= first.rangeM) return first.damage;
  for (let i = 1; i < curve.length; i += 1) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (rangeM <= b.rangeM) {
      const t = (rangeM - a.rangeM) / Math.max(1e-6, b.rangeM - a.rangeM);
      return a.damage + (b.damage - a.damage) * t;
    }
  }
  return curve[curve.length - 1]!.damage;
}

/** Seconds between shots for a given rate of fire. */
export function shotInterval(rpm: number): number {
  return 60 / Math.max(1, rpm);
}

/* ------------------------------------------------------------------ */
/* Field of view                                                       */
/* ------------------------------------------------------------------ */

/**
 * Every field-of-view number in this game is **horizontal**, in degrees.
 *
 * That is the convention the genre uses and the one the settings slider is
 * scaled for (70–120, like a shooter's). `THREE.PerspectiveCamera.fov` is
 * *vertical*, so the two must be converted between, and feeding a horizontal
 * figure straight into the camera is a mistake that looks plausible until you
 * measure it: 90 taken as vertical on a 16:9 frame is 121° horizontal — a
 * fisheye. Under it a soldier at 25 m is thirty pixels tall, aiming down the
 * sights narrows the view by barely a third, and the whole game reads as
 * happening a long way away from you.
 */
export function horizontalToVerticalFov(horizontalDeg: number, aspect: number): number {
  const safeAspect = Math.max(0.2, aspect);
  const half = (horizontalDeg * Math.PI) / 360;
  return (2 * Math.atan(Math.tan(half) / safeAspect) * 180) / Math.PI;
}

/* ------------------------------------------------------------------ */
/* Heading                                                             */
/* ------------------------------------------------------------------ */

/**
 * Yaw, and the one direction it means.
 *
 * `actor.yaw` is fed straight into `Object3D.rotation.y` — for the camera, for
 * character models, for hitbox orientation. three.js rotates an object's local
 * −Z by that angle, which gives a forward vector of `(−sin y, 0, −cos y)`.
 * Deriving the same vector by hand at each call site is how a sign error gets
 * in: writing the more intuitive-looking `(sin y, 0, −cos y)` produces a
 * heading mirrored about the Z axis, which agrees with the renderer at yaw 0
 * and is 90° wrong at yaw 90 — so it looks correct in the first screenshot
 * anyone takes, facing north, and is silently broken everywhere else.
 *
 * Everything that converts between a yaw and a direction goes through these.
 */

/** Unit forward vector for a yaw (and optional pitch), in world space. */
export function yawToForward(
  yaw: number,
  out: THREE.Vector3,
  pitch = 0,
): THREE.Vector3 {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/** The yaw that makes `yawToForward` point along the given horizontal delta. */
export function forwardToYaw(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Shortest signed difference between two yaws, in radians. */
export function yawDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
