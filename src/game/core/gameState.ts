import * as THREE from "three";
import {
  HUMAN_METRICS,
  PLAYER_ENTITY_ID,
  type CharacterState,
  type DamageEvent,
  type EntityId,
  type ImpactRequest,
  type KillEvent,
  type SoundRequest,
  type Stance,
  type SurfaceType,
  type Team,
  type TracerRequest,
} from "./types";
import type { CollisionWorld } from "../physics/collisionWorld";

/**
 * Per-frame mutable game state.
 *
 * House rule from AGENTS.md: nothing that changes every frame may live in
 * React state. Systems read and write this singleton from `useFrame`; React
 * only subscribes to the discrete zustand store in `gameStore.ts`, and the HUD
 * samples the numbers here on its own throttled cadence.
 */

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

export interface InputState {
  /** -1..1, right positive. */
  moveX: number;
  /** -1..1, forward positive. */
  moveY: number;
  /** Accumulated mouse delta since the last simulation step, in radians. */
  lookYaw: number;
  lookPitch: number;
  jump: boolean;
  jumpPressed: boolean;
  crouch: boolean;
  crouchPressed: boolean;
  pronePressed: boolean;
  sprint: boolean;
  fire: boolean;
  firePressed: boolean;
  ads: boolean;
  reloadPressed: boolean;
  swapPressed: boolean;
  meleePressed: boolean;
  usePressed: boolean;
  grenadePressed: boolean;
  tacticalPressed: boolean;
  leanLeft: boolean;
  leanRight: boolean;
  killstreakPressed: number;
  fireModePressed: boolean;
  scoreboard: boolean;
}

export function createInputState(): InputState {
  return {
    moveX: 0,
    moveY: 0,
    lookYaw: 0,
    lookPitch: 0,
    jump: false,
    jumpPressed: false,
    crouch: false,
    crouchPressed: false,
    pronePressed: false,
    sprint: false,
    fire: false,
    firePressed: false,
    ads: false,
    reloadPressed: false,
    swapPressed: false,
    meleePressed: false,
    usePressed: false,
    grenadePressed: false,
    tacticalPressed: false,
    leanLeft: false,
    leanRight: false,
    killstreakPressed: -1,
    fireModePressed: false,
    scoreboard: false,
  };
}

/** Clear the one-shot "pressed" edges after a simulation step consumes them. */
export function clearInputEdges(input: InputState): void {
  input.jumpPressed = false;
  input.crouchPressed = false;
  input.pronePressed = false;
  input.firePressed = false;
  input.reloadPressed = false;
  input.swapPressed = false;
  input.meleePressed = false;
  input.usePressed = false;
  input.grenadePressed = false;
  input.tacticalPressed = false;
  input.killstreakPressed = -1;
  input.fireModePressed = false;
  input.lookYaw = 0;
  input.lookPitch = 0;
}

/* ------------------------------------------------------------------ */
/* Actors                                                              */
/* ------------------------------------------------------------------ */

export interface Actor {
  id: EntityId;
  name: string;
  team: Team;
  /** Feet position. */
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Facing, radians. Yaw 0 looks toward -z (north). */
  yaw: number;
  pitch: number;
  stance: Stance;
  state: CharacterState;
  health: number;
  maxHealth: number;
  alive: boolean;
  /** Seconds until this actor respawns; <= 0 when live. */
  respawnTimer: number;
  grounded: boolean;
  /** Horizontal speed, cached for animation. */
  speed: number;
  /** Surface underfoot, for footsteps and dust. */
  groundSurface: SurfaceType;
  /** Weapon currently held. */
  weaponId: string;
  /** Set by whatever last damaged this actor. */
  lastAttackerId: EntityId | null;
  lastDamageTime: number;
  /** Score bookkeeping. */
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  streak: number;
  /** Cheap per-actor deterministic seed. */
  seed: number;
  /** True for the local player. */
  isPlayer: boolean;
  /** Bot difficulty 0..1; unused for the player. */
  skill: number;
  /** Muzzle position in world space, refreshed by the weapon/animation system. */
  muzzle: THREE.Vector3;
  /** Where this actor is currently looking; unit vector. */
  aimDir: THREE.Vector3;
  /** Time of the actor's last shot, for AI reaction and HUD. */
  lastFireTime: number;
  /** Suppression 0..1 — raised by near misses, decays over time. */
  suppression: number;
}

export function createActor(
  id: EntityId,
  name: string,
  team: Team,
  isPlayer = false,
): Actor {
  return {
    id,
    name,
    team,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    stance: "stand",
    state: "idle",
    health: 100,
    maxHealth: 100,
    alive: true,
    respawnTimer: 0,
    grounded: true,
    speed: 0,
    groundSurface: "sand",
    weaponId: "kilo-141",
    lastAttackerId: null,
    lastDamageTime: -99,
    kills: 0,
    deaths: 0,
    assists: 0,
    score: 0,
    streak: 0,
    seed: (id * 2654435761) >>> 0,
    isPlayer,
    skill: 0.6,
    muzzle: new THREE.Vector3(),
    aimDir: new THREE.Vector3(0, 0, -1),
    lastFireTime: -99,
    suppression: 0,
  };
}

export function eyePosition(actor: Actor, out: THREE.Vector3): THREE.Vector3 {
  return out.set(
    actor.position.x,
    actor.position.y + HUMAN_METRICS.eyeHeight[actor.stance],
    actor.position.z,
  );
}

/* ------------------------------------------------------------------ */
/* Event queues                                                        */
/* ------------------------------------------------------------------ */

/**
 * Single-producer/single-consumer queues drained once per frame by the system
 * that owns them. Allocation-free in the steady state: entries are reused.
 */
class Queue<T> {
  private readonly items: T[] = [];
  private count = 0;

  constructor(private readonly factory: () => T, initial = 32) {
    for (let i = 0; i < initial; i += 1) this.items.push(factory());
  }

  /** Grab the next slot to fill in. */
  push(): T {
    if (this.count >= this.items.length) this.items.push(this.factory());
    return this.items[this.count++]!;
  }

  get length(): number {
    return this.count;
  }

  at(i: number): T {
    return this.items[i]!;
  }

  clear(): void {
    this.count = 0;
  }
}

export interface FrameStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  actorsAlive: number;
  colliders: number;
}

/* ------------------------------------------------------------------ */
/* The singleton                                                       */
/* ------------------------------------------------------------------ */

export interface GameState {
  /** Seconds since the match started, advanced by the simulation. */
  time: number;
  /** Last simulation delta, clamped. */
  dt: number;
  /** Wall-clock frame counter. */
  frame: number;
  /** True while the simulation should advance. */
  running: boolean;

  input: InputState;
  actors: Actor[];
  actorById: Map<EntityId, Actor>;
  player: Actor;

  /** Set once the scene has baked its colliders. */
  world: CollisionWorld | null;

  /**
   * The running match, or `null` outside one.
   *
   * Typed structurally, against `Actor` which is declared here, so this file
   * keeps its place at the bottom of the module graph — importing the modes
   * layer for its concrete type would make the dependency circular.
   */
  matchDirector: {
    phase: string;
    scoreBlue: number;
    scoreRed: number;
    timeRemaining: number;
    onKill(report: { attacker: Actor | null; victim: Actor }): void;
  } | null;

  /**
   * The live character rig, or `null` before one is bound. Structurally typed
   * for the same reason as `matchDirector`. Read by the pose-measurement
   * harness, which steps a single actor's animation with a fixed delta rather
   * than trying to infer a gait from a handful of rendered frames.
   */
  characters: {
    bonesOf(actorId: EntityId): readonly THREE.Bone[] | null;
    poseOnly(actorId: EntityId, dt: number, detail?: boolean): void;
  } | null;

  /* Queues drained by their owning system each frame. */
  damageQueue: DamageEvent[];
  killQueue: KillEvent[];
  soundQueue: SoundRequest[];
  impactQueue: ImpactRequest[];
  tracerQueue: TracerRequest[];

  /** Camera state written by the player rig, read by FX and audio. */
  cameraPosition: THREE.Vector3;
  cameraForward: THREE.Vector3;
  cameraRight: THREE.Vector3;
  cameraUp: THREE.Vector3;
  /** Current vertical FOV in degrees, after ADS blending. */
  cameraFov: number;
  /** 0 = hip, 1 = fully aimed. */
  adsProgress: number;

  /** Player-facing HUD values, sampled by React on a throttle. */
  hud: {
    health: number;
    maxHealth: number;
    ammo: number;
    reserve: number;
    magSize: number;
    weaponName: string;
    fireMode: string;
    reloading: boolean;
    reloadProgress: number;
    /** Crosshair half-angle in degrees, drives the spread gap. */
    spreadDeg: number;
    /** Milliseconds remaining on the hitmarker. */
    hitmarker: number;
    hitmarkerKill: boolean;
    /** Radians: yaw of the most recent damage source relative to the camera. */
    damageDirs: { angle: number; time: number }[];
    scoreBlue: number;
    scoreRed: number;
    timeRemaining: number;
    grenades: number;
    tacticals: number;
    streakProgress: number;
  };

  stats: FrameStats;
}

function createHud(): GameState["hud"] {
  return {
    health: 100,
    maxHealth: 100,
    ammo: 30,
    reserve: 120,
    magSize: 30,
    weaponName: "",
    fireMode: "AUTO",
    reloading: false,
    reloadProgress: 0,
    spreadDeg: 1,
    hitmarker: 0,
    hitmarkerKill: false,
    damageDirs: [],
    scoreBlue: 0,
    scoreRed: 0,
    timeRemaining: 600,
    grenades: 2,
    tacticals: 2,
    streakProgress: 0,
  };
}

const player = createActor(PLAYER_ENTITY_ID, "You", "blue", true);

export const game: GameState = {
  time: 0,
  dt: 0,
  frame: 0,
  running: false,
  input: createInputState(),
  actors: [player],
  actorById: new Map([[PLAYER_ENTITY_ID, player]]),
  player,
  world: null,
  matchDirector: null,
  characters: null,
  damageQueue: [],
  killQueue: [],
  soundQueue: [],
  impactQueue: [],
  tracerQueue: [],
  cameraPosition: new THREE.Vector3(),
  cameraForward: new THREE.Vector3(0, 0, -1),
  cameraRight: new THREE.Vector3(1, 0, 0),
  cameraUp: new THREE.Vector3(0, 1, 0),
  cameraFov: 80,
  adsProgress: 0,
  hud: createHud(),
  stats: {
    fps: 0,
    frameMs: 0,
    drawCalls: 0,
    triangles: 0,
    actorsAlive: 0,
    colliders: 0,
  },
};

/* Queue helpers — these allocate, but only on discrete events (a few dozen
   per second at most), never per frame. */

export function queueSound(request: SoundRequest): void {
  if (game.soundQueue.length < 96) game.soundQueue.push(request);
}

export function queueImpact(request: ImpactRequest): void {
  if (game.impactQueue.length < 128) game.impactQueue.push(request);
}

export function queueTracer(request: TracerRequest): void {
  if (game.tracerQueue.length < 128) game.tracerQueue.push(request);
}

export function queueDamage(event: DamageEvent): void {
  game.damageQueue.push(event);
}

export function queueKill(event: KillEvent): void {
  game.killQueue.push(event);
}

export function addActor(actor: Actor): void {
  game.actors.push(actor);
  game.actorById.set(actor.id, actor);
}

export function removeActor(id: EntityId): void {
  const index = game.actors.findIndex((a) => a.id === id);
  if (index >= 0) game.actors.splice(index, 1);
  game.actorById.delete(id);
}

export function resetGameState(): void {
  game.time = 0;
  game.frame = 0;
  game.running = false;
  game.actors = [game.player];
  game.actorById = new Map([[game.player.id, game.player]]);
  game.damageQueue.length = 0;
  game.killQueue.length = 0;
  game.soundQueue.length = 0;
  game.impactQueue.length = 0;
  game.tracerQueue.length = 0;
  game.hud = createHud();
  const p = game.player;
  p.health = p.maxHealth;
  p.alive = true;
  p.kills = 0;
  p.deaths = 0;
  p.assists = 0;
  p.score = 0;
  p.streak = 0;
  p.velocity.set(0, 0, 0);
  p.stance = "stand";
}

/** Exported so `Queue` stays available if a system wants a pooled channel. */
export { Queue };
