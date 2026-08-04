import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import { game, queueDamage, queueSound, type Actor } from "../core/gameState";
import { useGameStore } from "../core/gameStore";
import { OPPOSING_TEAM, type EntityId, type Team } from "../core/types";
import type { CollisionWorld } from "../physics/collisionWorld";
import type { ScoringSystem } from "./scoring";

/**
 * Killstreaks.
 *
 * Each reward is a small object with a lifetime: `activate` arms it, `update`
 * runs it, `deactivate` cleans up. The simulation half (timers, damage,
 * reveal state) lives here and is renderer-agnostic; everything visual goes
 * out through `KillstreakVfxPort`, which the scene implements. That keeps this
 * module runnable headless — the simulation harness passes
 * `NULL_KILLSTREAK_VFX` and gets identical damage numbers.
 *
 * Damage is pushed into `game.damageQueue` like any other source, so the
 * existing `resolveDamage` pipeline produces the kills, the killfeed and the
 * medals with no special-casing.
 */

/* ------------------------------------------------------------------ */
/* Rendering port                                                      */
/* ------------------------------------------------------------------ */

export interface AirstrikeRun {
  /** Where the run enters, high and off-map. */
  from: THREE.Vector3;
  /** Where it exits. */
  to: THREE.Vector3;
  /** Seconds until the first detonation. */
  delay: number;
  /** Ordered detonation points along the run. */
  impacts: readonly THREE.Vector3[];
}

/**
 * Everything a killstreak needs the renderer to do. The scene supplies a real
 * implementation; the simulation harness supplies `NULL_KILLSTREAK_VFX`.
 */
export interface KillstreakVfxPort {
  /** A reward became active. `payload` is streak-specific and optional. */
  onActivated(id: string, team: Team, ownerId: EntityId): void;
  onDeactivated(id: string, team: Team): void;
  /** Radar sweep overlay for the owning team. */
  setRadarSweep(team: Team, active: boolean): void;
  /** Enemy radar jammed for the given team. */
  setRadarJammed(team: Team, active: boolean): void;
  /** Fly a strike run and detonate along it. */
  playAirstrike(run: AirstrikeRun): void;
  /** A single detonation, for cluster submunitions and package impacts. */
  playExplosion(point: THREE.Vector3, radiusM: number): void;
  /** Persistent world marker (care package crate, strike target). */
  setMarker(key: string, point: THREE.Vector3 | null, team: Team, label: string): void;
  /** Take over the camera for the chopper-gunner sequence. */
  setOverheadCamera(active: boolean, position: THREE.Vector3, target: THREE.Vector3): void;
}

/** Headless no-op implementation. */
export const NULL_KILLSTREAK_VFX: KillstreakVfxPort = {
  onActivated: () => {},
  onDeactivated: () => {},
  setRadarSweep: () => {},
  setRadarJammed: () => {},
  playAirstrike: () => {},
  playExplosion: () => {},
  setMarker: () => {},
  setOverheadCamera: () => {},
};

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

export interface KillstreakContext {
  readonly owner: Actor;
  readonly team: Team;
  readonly world: CollisionWorld | null;
  readonly vfx: KillstreakVfxPort;
  /** Deterministic, seeded from the match seed. */
  readonly rng: () => number;
  /** Match time at activation. */
  readonly time: number;
  /** Point the owner designated (usually where they were looking). */
  readonly target: THREE.Vector3;
  /** Radial damage attributed to the owner, routed through the damage queue. */
  explode(point: THREE.Vector3, radiusM: number, maxDamage: number): void;
  /** Reveal/jam bookkeeping owned by the manager. */
  setReveal(team: Team, active: boolean): void;
  setJam(team: Team, active: boolean): void;
  /** Grant a fresh reward (care package). */
  grant(id: string): void;
  announce(title: string, detail: string): void;
}

export interface Killstreak {
  readonly id: string;
  readonly name: string;
  /** Kills required to earn it. */
  readonly cost: number;
  /** Seconds it stays live once activated. */
  readonly duration: number;
  activate(ctx: KillstreakContext): void;
  update(dt: number): void;
  deactivate(): void;
  /** False once the reward has run its course. */
  readonly finished: boolean;
}

export interface KillstreakDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly cost: number;
  readonly duration: number;
  /** Care packages may not roll another care package. */
  readonly inPackagePool: boolean;
  create(): Killstreak;
}

/* ------------------------------------------------------------------ */
/* Base                                                                */
/* ------------------------------------------------------------------ */

abstract class BaseKillstreak implements Killstreak {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly cost: number;
  abstract readonly duration: number;
  protected ctx: KillstreakContext | null = null;
  protected elapsed = 0;
  finished = false;

  activate(ctx: KillstreakContext): void {
    this.ctx = ctx;
    this.elapsed = 0;
    this.finished = false;
    this.onActivate(ctx);
  }

  update(dt: number): void {
    if (this.finished || !this.ctx) return;
    this.elapsed += dt;
    this.onUpdate(dt, this.ctx);
    if (this.duration > 0 && this.elapsed >= this.duration) this.finished = true;
  }

  deactivate(): void {
    if (this.ctx) this.onDeactivate(this.ctx);
    this.finished = true;
    this.ctx = null;
  }

  protected abstract onActivate(ctx: KillstreakContext): void;
  protected abstract onUpdate(dt: number, ctx: KillstreakContext): void;
  protected abstract onDeactivate(ctx: KillstreakContext): void;
}

/* ------------------------------------------------------------------ */
/* UAV                                                                 */
/* ------------------------------------------------------------------ */

class Uav extends BaseKillstreak {
  readonly id = "uav";
  readonly name = "UAV";
  readonly cost = 3;
  readonly duration = 30;

  protected onActivate(ctx: KillstreakContext): void {
    ctx.setReveal(ctx.team, true);
    ctx.vfx.setRadarSweep(ctx.team, true);
    ctx.announce("UAV", "Recon drone overhead");
  }

  protected onUpdate(): void {}

  protected onDeactivate(ctx: KillstreakContext): void {
    ctx.setReveal(ctx.team, false);
    ctx.vfx.setRadarSweep(ctx.team, false);
  }
}

/* ------------------------------------------------------------------ */
/* Counter-UAV                                                         */
/* ------------------------------------------------------------------ */

class CounterUav extends BaseKillstreak {
  readonly id = "counter-uav";
  readonly name = "Counter-UAV";
  readonly cost = 4;
  readonly duration = 30;

  protected onActivate(ctx: KillstreakContext): void {
    const enemy = OPPOSING_TEAM[ctx.team];
    ctx.setJam(enemy, true);
    ctx.vfx.setRadarJammed(enemy, true);
    ctx.announce("Counter-UAV", "Enemy radar jammed");
  }

  protected onUpdate(): void {}

  protected onDeactivate(ctx: KillstreakContext): void {
    const enemy = OPPOSING_TEAM[ctx.team];
    ctx.setJam(enemy, false);
    ctx.vfx.setRadarJammed(enemy, false);
  }
}

/* ------------------------------------------------------------------ */
/* Care package                                                        */
/* ------------------------------------------------------------------ */

/** Rewards a care package can roll, with relative weights. */
const PACKAGE_POOL: readonly { id: string; weight: number }[] = [
  { id: "uav", weight: 3 },
  { id: "counter-uav", weight: 2 },
  { id: "precision-airstrike", weight: 3 },
  { id: "cluster-strike", weight: 2 },
  { id: "chopper-gunner", weight: 1 },
];

class CarePackage extends BaseKillstreak {
  readonly id = "care-package";
  readonly name = "Care Package";
  readonly cost = 4;
  /** Time the crate stays on the ground before it despawns. */
  readonly duration = 60;

  private landing = new THREE.Vector3();
  private landed = false;
  private fallTime = 0;
  private contents = "uav";

  protected onActivate(ctx: KillstreakContext): void {
    const ground = ctx.world?.groundAt(ctx.target.x, ctx.target.z) ?? ctx.target.y;
    this.landing.set(ctx.target.x, ground, ctx.target.z);
    this.landed = false;
    this.fallTime = 4.5;

    let total = 0;
    for (const entry of PACKAGE_POOL) total += entry.weight;
    let roll = ctx.rng() * total;
    this.contents = PACKAGE_POOL[0]!.id;
    for (const entry of PACKAGE_POOL) {
      roll -= entry.weight;
      if (roll <= 0) {
        this.contents = entry.id;
        break;
      }
    }

    ctx.vfx.setMarker("care-package", this.landing, ctx.team, "CARE PACKAGE");
    ctx.announce("Care Package", "Inbound — mark the smoke");
  }

  protected onUpdate(dt: number, ctx: KillstreakContext): void {
    if (!this.landed) {
      this.fallTime -= dt;
      if (this.fallTime <= 0) {
        this.landed = true;
        ctx.vfx.playExplosion(this.landing, 1.5);
        queueSound({ id: "land", position: this.landing.clone(), gain: 0.7 });
      }
      return;
    }
    // First body within reach claims it; enemies can steal.
    for (const actor of game.actors) {
      if (!actor.alive) continue;
      if (actor.position.distanceToSquared(this.landing) > 2.6 * 2.6) continue;
      const stolen = actor.team !== ctx.team;
      ctx.grant(this.contents);
      if (actor.isPlayer || stolen) {
        ctx.announce(stolen ? "Package Stolen" : "Package Secured", this.contents.toUpperCase());
      }
      this.finished = true;
      return;
    }
  }

  protected onDeactivate(ctx: KillstreakContext): void {
    ctx.vfx.setMarker("care-package", null, ctx.team, "");
  }
}

/* ------------------------------------------------------------------ */
/* Precision airstrike                                                 */
/* ------------------------------------------------------------------ */

class PrecisionAirstrike extends BaseKillstreak {
  readonly id = "precision-airstrike";
  readonly name = "Precision Airstrike";
  readonly cost = 5;
  readonly duration = 12;

  private readonly impacts: THREE.Vector3[] = [];
  private nextImpact = 0;
  private index = 0;

  protected onActivate(ctx: KillstreakContext): void {
    // A straight run through the designated point on a seeded bearing, eight
    // bombs walking along it.
    const bearing = ctx.rng() * Math.PI * 2;
    const dirX = Math.cos(bearing);
    const dirZ = Math.sin(bearing);
    const spacing = 11;
    this.impacts.length = 0;
    for (let i = 0; i < 8; i += 1) {
      const offset = (i - 3.5) * spacing;
      const x = ctx.target.x + dirX * offset;
      const z = ctx.target.z + dirZ * offset;
      const y = ctx.world?.groundAt(x, z) ?? ctx.target.y;
      this.impacts.push(new THREE.Vector3(x, y, z));
    }
    this.index = 0;
    this.nextImpact = 4;

    const first = this.impacts[0]!;
    const last = this.impacts[this.impacts.length - 1]!;
    ctx.vfx.playAirstrike({
      from: new THREE.Vector3(first.x - dirX * 900, first.y + 420, first.z - dirZ * 900),
      to: new THREE.Vector3(last.x + dirX * 900, last.y + 420, last.z + dirZ * 900),
      delay: this.nextImpact,
      impacts: this.impacts.map((p) => p.clone()),
    });
    ctx.vfx.setMarker("airstrike", ctx.target.clone(), ctx.team, "STRIKE");
    ctx.announce("Precision Airstrike", "Danger close — 4 seconds");
    queueSound({ id: "jet-pass", gain: 0.8 });
  }

  protected onUpdate(dt: number, ctx: KillstreakContext): void {
    if (this.index >= this.impacts.length) return;
    this.nextImpact -= dt;
    while (this.nextImpact <= 0 && this.index < this.impacts.length) {
      const point = this.impacts[this.index]!;
      ctx.explode(point, 12, 180);
      ctx.vfx.playExplosion(point, 12);
      this.index += 1;
      this.nextImpact += 0.22;
    }
    if (this.index >= this.impacts.length) this.finished = true;
  }

  protected onDeactivate(ctx: KillstreakContext): void {
    ctx.vfx.setMarker("airstrike", null, ctx.team, "");
  }
}

/* ------------------------------------------------------------------ */
/* Cluster strike                                                      */
/* ------------------------------------------------------------------ */

class ClusterStrike extends BaseKillstreak {
  readonly id = "cluster-strike";
  readonly name = "Cluster Strike";
  readonly cost = 7;
  readonly duration = 14;

  private readonly impacts: { point: THREE.Vector3; at: number }[] = [];
  private index = 0;

  protected onActivate(ctx: KillstreakContext): void {
    this.impacts.length = 0;
    this.index = 0;
    const count = 16;
    for (let i = 0; i < count; i += 1) {
      // Deterministic disc scatter around the designated point.
      const angle = ctx.rng() * Math.PI * 2;
      const radius = Math.sqrt(ctx.rng()) * 26;
      const x = ctx.target.x + Math.cos(angle) * radius;
      const z = ctx.target.z + Math.sin(angle) * radius;
      const y = ctx.world?.groundAt(x, z) ?? ctx.target.y;
      this.impacts.push({ point: new THREE.Vector3(x, y, z), at: 3 + i * 0.28 });
    }
    ctx.vfx.setMarker("cluster", ctx.target.clone(), ctx.team, "CLUSTER");
    ctx.announce("Cluster Strike", "Mortars on target");
  }

  protected onUpdate(_dt: number, ctx: KillstreakContext): void {
    while (this.index < this.impacts.length) {
      const entry = this.impacts[this.index]!;
      if (entry.at > this.elapsed) break;
      ctx.explode(entry.point, 9, 130);
      ctx.vfx.playExplosion(entry.point, 9);
      this.index += 1;
    }
    if (this.index >= this.impacts.length) this.finished = true;
  }

  protected onDeactivate(ctx: KillstreakContext): void {
    ctx.vfx.setMarker("cluster", null, ctx.team, "");
  }
}

/* ------------------------------------------------------------------ */
/* Chopper gunner (lite)                                               */
/* ------------------------------------------------------------------ */

/**
 * An orbiting overhead camera the owner shoots from. The full version needs a
 * rendered gunship and a dedicated weapon; the simulation half is an orbit, a
 * camera hand-off and a cannon that fires on a cadence at whatever the orbit
 * can see, which is enough for the mode layer, the scoreboard and the AI.
 */
class ChopperGunner extends BaseKillstreak {
  readonly id = "chopper-gunner";
  readonly name = "Chopper Gunner";
  readonly cost = 8;
  readonly duration = 32;

  private readonly centre = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private angle = 0;
  private cooldown = 0;
  private radius = 190;
  private altitude = 130;

  protected onActivate(ctx: KillstreakContext): void {
    this.centre.copy(ctx.target);
    this.angle = ctx.rng() * Math.PI * 2;
    this.cooldown = 1.5;
    this.updateTransform();
    ctx.vfx.setOverheadCamera(true, this.position, this.centre);
    ctx.announce("Chopper Gunner", "You have the gun");
  }

  private updateTransform(): void {
    this.position.set(
      this.centre.x + Math.cos(this.angle) * this.radius,
      this.centre.y + this.altitude,
      this.centre.z + Math.sin(this.angle) * this.radius,
    );
    this.look.copy(this.centre);
  }

  protected onUpdate(dt: number, ctx: KillstreakContext): void {
    this.angle += dt * 0.16;
    this.updateTransform();
    ctx.vfx.setOverheadCamera(true, this.position, this.look);

    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown = 0.9;

    // Pick the nearest visible enemy to the orbit and put a burst on it.
    let best: Actor | null = null;
    let bestDist = Infinity;
    for (const actor of game.actors) {
      if (!actor.alive || actor.team === ctx.team) continue;
      const d = actor.position.distanceToSquared(this.centre);
      if (d > 260 * 260 || d >= bestDist) continue;
      if (ctx.world && !ctx.world.hasLineOfSight(this.position, actor.position, undefined, actor.id)) {
        continue;
      }
      best = actor;
      bestDist = d;
    }
    if (!best) return;
    ctx.explode(best.position, 5.5, 110);
    ctx.vfx.playExplosion(best.position, 5.5);
  }

  protected onDeactivate(ctx: KillstreakContext): void {
    ctx.vfx.setOverheadCamera(false, this.position, this.look);
  }
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

export const KILLSTREAK_DEFS: readonly KillstreakDef[] = [
  {
    id: "uav",
    name: "UAV",
    description: "Reveals enemy positions on the minimap for 30 seconds.",
    cost: 3,
    duration: 30,
    inPackagePool: true,
    create: () => new Uav(),
  },
  {
    id: "counter-uav",
    name: "Counter-UAV",
    description: "Jams the enemy minimap for 30 seconds.",
    cost: 4,
    duration: 30,
    inPackagePool: true,
    create: () => new CounterUav(),
  },
  {
    id: "care-package",
    name: "Care Package",
    description: "Airdrops a crate containing a random reward. It can be stolen.",
    cost: 4,
    duration: 60,
    inPackagePool: false,
    create: () => new CarePackage(),
  },
  {
    id: "precision-airstrike",
    name: "Precision Airstrike",
    description: "Walks eight bombs through a designated line.",
    cost: 5,
    duration: 12,
    inPackagePool: true,
    create: () => new PrecisionAirstrike(),
  },
  {
    id: "cluster-strike",
    name: "Cluster Strike",
    description: "Saturates a 26 m circle with sixteen mortars.",
    cost: 7,
    duration: 14,
    inPackagePool: true,
    create: () => new ClusterStrike(),
  },
  {
    id: "chopper-gunner",
    name: "Chopper Gunner",
    description: "Take the gun on an orbiting gunship for 32 seconds.",
    cost: 8,
    duration: 32,
    inPackagePool: true,
    create: () => new ChopperGunner(),
  },
];

export const KILLSTREAKS_BY_ID: Readonly<Record<string, KillstreakDef>> = Object.fromEntries(
  KILLSTREAK_DEFS.map((def) => [def.id, def]),
);

/** The default three-slot selection, cheapest first. */
export const DEFAULT_STREAK_LOADOUT: readonly string[] = [
  "uav",
  "precision-airstrike",
  "chopper-gunner",
];

/* ------------------------------------------------------------------ */
/* Manager                                                             */
/* ------------------------------------------------------------------ */

interface ActiveStreak {
  streak: Killstreak;
  ctx: KillstreakContext;
  ownerId: EntityId;
  team: Team;
}

export interface KillstreakManagerOptions {
  vfx?: KillstreakVfxPort;
  world?: CollisionWorld | null;
  seed: number;
  scoring?: ScoringSystem | null;
  /** Set false in headless tests to skip zustand writes. */
  syncStore?: boolean;
}

export class KillstreakManager {
  private readonly vfx: KillstreakVfxPort;
  private world: CollisionWorld | null;
  private readonly rng: () => number;
  private readonly scoring: ScoringSystem | null;
  private readonly syncStore: boolean;

  private readonly active: ActiveStreak[] = [];
  /** Earned-but-unspent rewards, per actor, in earn order. */
  private readonly earned = new Map<EntityId, string[]>();
  /** Highest cost already paid out this life, so a streak pays once. */
  private readonly paidTo = new Map<EntityId, number>();
  private loadout: string[] = [...DEFAULT_STREAK_LOADOUT];

  private readonly reveal: Record<Team, number> = { blue: 0, red: 0 };
  private readonly jam: Record<Team, number> = { blue: 0, red: 0 };
  private time = 0;

  constructor(options: KillstreakManagerOptions) {
    this.vfx = options.vfx ?? NULL_KILLSTREAK_VFX;
    this.world = options.world ?? null;
    this.rng = mulberry32((options.seed ^ 0x9e3779b9) >>> 0);
    this.scoring = options.scoring ?? null;
    this.syncStore = options.syncStore !== false;
  }

  setWorld(world: CollisionWorld | null): void {
    this.world = world;
  }

  setLoadout(ids: readonly string[]): void {
    this.loadout = ids.filter((id) => KILLSTREAKS_BY_ID[id] !== undefined).slice(0, 3);
    if (this.loadout.length === 0) this.loadout = [...DEFAULT_STREAK_LOADOUT];
  }

  getLoadout(): readonly string[] {
    return this.loadout;
  }

  reset(): void {
    for (const entry of this.active) entry.streak.deactivate();
    this.active.length = 0;
    this.earned.clear();
    this.paidTo.clear();
    this.reveal.blue = 0;
    this.reveal.red = 0;
    this.jam.blue = 0;
    this.jam.red = 0;
    this.time = 0;
    if (this.syncStore) useGameStore.getState().setStreaks([]);
  }

  /* ---------------------------------------------------------------- */
  /* Earning                                                           */
  /* ---------------------------------------------------------------- */

  /** Call once per kill by the attacker. Awards any streaks that just landed. */
  onKill(actor: Actor): void {
    const paid = this.paidTo.get(actor.id) ?? 0;
    let highest = paid;
    for (const id of this.loadoutFor(actor)) {
      const def = KILLSTREAKS_BY_ID[id];
      if (!def) continue;
      if (actor.streak < def.cost || def.cost <= paid) continue;
      this.grant(actor, id);
      highest = Math.max(highest, def.cost);
    }
    if (highest > paid) this.paidTo.set(actor.id, highest);
  }

  /** A death wipes the "already paid" watermark, like the genre does. */
  onDeath(actor: Actor): void {
    this.paidTo.set(actor.id, 0);
  }

  /** Bots use a fixed sensible ladder; the player uses their selection. */
  private loadoutFor(actor: Actor): readonly string[] {
    return actor.isPlayer ? this.loadout : DEFAULT_STREAK_LOADOUT;
  }

  grant(actor: Actor, id: string): void {
    if (!KILLSTREAKS_BY_ID[id]) return;
    let list = this.earned.get(actor.id);
    if (!list) {
      list = [];
      this.earned.set(actor.id, list);
    }
    if (list.length >= 3) list.shift();
    list.push(id);
    if (actor.isPlayer) {
      queueSound({ id: "killstreak-ready", gain: 0.7 });
      if (this.syncStore) useGameStore.getState().setStreaks([...list]);
    }
  }

  /** Rewards this actor is holding. */
  available(actor: Actor): readonly string[] {
    return this.earned.get(actor.id) ?? [];
  }

  /* ---------------------------------------------------------------- */
  /* Activation                                                        */
  /* ---------------------------------------------------------------- */

  /** Activate the reward in slot `index` (0-based) for an actor. */
  activateSlot(actor: Actor, index: number): boolean {
    const list = this.earned.get(actor.id);
    if (!list || index < 0 || index >= list.length) return false;
    const id = list[index]!;
    if (!this.activate(actor, id)) return false;
    list.splice(index, 1);
    if (actor.isPlayer && this.syncStore) useGameStore.getState().setStreaks([...list]);
    return true;
  }

  /** Activate a specific reward, spending it if the actor holds it. */
  activate(actor: Actor, id: string): boolean {
    const def = KILLSTREAKS_BY_ID[id];
    if (!def) return false;
    if (!actor.alive) return false;

    const streak = def.create();
    const target = this.designatedPoint(actor);
    const ctx = this.makeContext(actor, target);
    streak.activate(ctx);
    this.active.push({ streak, ctx, ownerId: actor.id, team: actor.team });
    this.vfx.onActivated(def.id, actor.team, actor.id);
    if (this.scoring) this.scoring.awardRaw(actor, 0, def.name, 0);
    return true;
  }

  /** Where an actor is pointing, projected onto the ground. */
  private designatedPoint(actor: Actor): THREE.Vector3 {
    const point = new THREE.Vector3()
      .copy(actor.position)
      .addScaledVector(actor.aimDir, 60);
    point.y = this.world?.groundAt(point.x, point.z) ?? actor.position.y;
    return point;
  }

  private makeContext(actor: Actor, target: THREE.Vector3): KillstreakContext {
    const manager = this;
    return {
      owner: actor,
      team: actor.team,
      world: this.world,
      vfx: this.vfx,
      rng: this.rng,
      time: this.time,
      target,
      explode(point, radiusM, maxDamage) {
        manager.explode(actor, point, radiusM, maxDamage);
      },
      setReveal(team, active) {
        manager.reveal[team] += active ? 1 : -1;
        if (manager.reveal[team] < 0) manager.reveal[team] = 0;
      },
      setJam(team, active) {
        manager.jam[team] += active ? 1 : -1;
        if (manager.jam[team] < 0) manager.jam[team] = 0;
      },
      grant(id) {
        manager.grant(actor, id);
      },
      announce(title, detail) {
        if (!manager.syncStore) return;
        useGameStore.getState().pushToast({
          text: title,
          detail,
          kind: "streak",
          time: game.time,
        });
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Damage                                                            */
  /* ---------------------------------------------------------------- */

  private readonly _dir = new THREE.Vector3();

  private explode(owner: Actor, point: THREE.Vector3, radiusM: number, maxDamage: number): void {
    for (const actor of game.actors) {
      if (!actor.alive) continue;
      const distance = actor.position.distanceTo(point);
      if (distance > radiusM) continue;
      // Cover works: a wall between the blast and the body stops it.
      if (this.world) {
        const chest = this._dir.set(
          actor.position.x,
          actor.position.y + 1.1,
          actor.position.z,
        );
        if (!this.world.hasLineOfSight(point, chest, undefined, actor.id)) continue;
      }
      const falloff = 1 - distance / radiusM;
      const amount = maxDamage * falloff * falloff;
      if (amount < 1) continue;
      queueDamage({
        targetId: actor.id,
        attackerId: owner.id,
        amount,
        kind: "explosion",
        region: null,
        direction: new THREE.Vector3().subVectors(actor.position, point).normalize(),
        point: point.clone(),
        distanceM: distance,
        penetrated: false,
        weaponId: "killstreak",
        time: game.time,
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Tick                                                              */
  /* ---------------------------------------------------------------- */

  update(dt: number, time: number): void {
    this.time = time;
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const entry = this.active[i]!;
      entry.streak.update(dt);
      if (!entry.streak.finished) continue;
      entry.streak.deactivate();
      this.vfx.onDeactivated(entry.streak.id, entry.team);
      this.active.splice(i, 1);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Queries used by the HUD                                           */
  /* ---------------------------------------------------------------- */

  /** True when `team` currently has working radar (UAV up, not jammed). */
  isUavActive(team: Team): boolean {
    return this.reveal[team] > 0 && this.jam[team] === 0;
  }

  /** True when `team`'s radar is being jammed by an enemy Counter-UAV. */
  isRadarJammed(team: Team): boolean {
    return this.jam[team] > 0;
  }

  /** Ids of every live reward, for HUD chips and debugging. */
  activeIds(): readonly string[] {
    return this.active.map((entry) => entry.streak.id);
  }

  /** True while a chopper-gunner sequence owns the camera. */
  isCameraOwned(): boolean {
    return this.active.some((entry) => entry.streak.id === "chopper-gunner");
  }

  /** Progress 0..1 toward the actor's next unearned reward. */
  streakProgress(actor: Actor): number {
    const paid = this.paidTo.get(actor.id) ?? 0;
    let next = Infinity;
    for (const id of this.loadoutFor(actor)) {
      const def = KILLSTREAKS_BY_ID[id];
      if (!def || def.cost <= paid) continue;
      next = Math.min(next, def.cost);
    }
    if (!Number.isFinite(next)) return 1;
    const floor = paid;
    return Math.max(0, Math.min(1, (actor.streak - floor) / Math.max(1, next - floor)));
  }
}
