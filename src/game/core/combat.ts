import * as THREE from "three";
import {
  OPPOSING_TEAM,
  type DamageEvent,
  type EntityId,
} from "./types";
import { game, queueSound, type Actor } from "./gameState";

/**
 * Damage resolution, health regeneration and death.
 *
 * The rules follow the genre: no health bar, a short delay then a fast
 * regeneration, friendly fire off by default, and an assist window so the
 * player who did most of the work still gets paid when someone else finishes
 * the kill.
 */

export const COMBAT = {
  /** Seconds after taking damage before regeneration starts. */
  regenDelay: 5,
  /** Health per second once regeneration begins. */
  regenRate: 40,
  /** Seconds a damage contribution counts toward an assist. */
  assistWindow: 8,
  /** Seconds a corpse stays before the actor respawns. */
  respawnDelay: 5,
  friendlyFire: false,
} as const;

interface DamageRecord {
  attackerId: EntityId;
  amount: number;
  time: number;
}

const damageLog = new Map<EntityId, DamageRecord[]>();

export interface KillReport {
  attacker: Actor | null;
  victim: Actor;
  weaponId: string;
  headshot: boolean;
  penetrated: boolean;
  distanceM: number;
  assists: Actor[];
}

const _dir = new THREE.Vector3();

/**
 * Apply everything in `game.damageQueue`. Returns the kills that happened so
 * the mode layer can score them and the HUD can show a killfeed.
 */
export function resolveDamage(time: number, out: KillReport[]): void {
  out.length = 0;
  for (const event of game.damageQueue) {
    const victim = game.actorById.get(event.targetId);
    if (!victim || !victim.alive) continue;
    const attacker = game.actorById.get(event.attackerId) ?? null;

    if (
      !COMBAT.friendlyFire &&
      attacker &&
      attacker.id !== victim.id &&
      attacker.team === victim.team
    ) {
      continue;
    }

    victim.health -= event.amount;
    victim.lastDamageTime = time;
    victim.lastAttackerId = event.attackerId;

    // Near-miss suppression is handled elsewhere; a direct hit always
    // suppresses hard.
    victim.suppression = Math.min(1, victim.suppression + 0.45);

    recordDamage(victim.id, event.attackerId, event.amount, time);

    if (victim.isPlayer) {
      _dir.copy(event.direction).normalize();
      const angle = Math.atan2(_dir.x, _dir.z);
      game.hud.damageDirs.push({ angle, time });
      if (game.hud.damageDirs.length > 6) game.hud.damageDirs.shift();
      queueSound({ id: "damage", gain: Math.min(1, 0.35 + event.amount / 90) });
    }

    if (attacker?.isPlayer) {
      game.hud.hitmarker = victim.health <= 0 ? 420 : 240;
      game.hud.hitmarkerKill = victim.health <= 0;
      queueSound({
        id: victim.health <= 0 ? "kill" : event.region === "head" ? "headshot" : "hitmarker",
        gain: 0.55,
      });
    }

    if (victim.health <= 0) {
      out.push(killActor(victim, attacker, event, time));
    }
  }
  game.damageQueue.length = 0;
}

function recordDamage(
  victimId: EntityId,
  attackerId: EntityId,
  amount: number,
  time: number,
): void {
  let log = damageLog.get(victimId);
  if (!log) {
    log = [];
    damageLog.set(victimId, log);
  }
  const existing = log.find((r) => r.attackerId === attackerId);
  if (existing && time - existing.time < COMBAT.assistWindow) {
    existing.amount += amount;
    existing.time = time;
  } else {
    log.push({ attackerId, amount, time });
    if (log.length > 8) log.shift();
  }
}

function killActor(
  victim: Actor,
  attacker: Actor | null,
  event: DamageEvent,
  time: number,
): KillReport {
  victim.health = 0;
  victim.alive = false;
  victim.state = "dead";
  victim.deaths += 1;
  victim.streak = 0;
  victim.respawnTimer = COMBAT.respawnDelay;
  victim.velocity.set(0, 0, 0);

  const assists: Actor[] = [];
  const log = damageLog.get(victim.id);
  if (log) {
    for (const record of log) {
      if (record.attackerId === event.attackerId) continue;
      if (time - record.time > COMBAT.assistWindow) continue;
      if (record.amount < 20) continue;
      const helper = game.actorById.get(record.attackerId);
      if (helper && helper.team !== victim.team) {
        helper.assists += 1;
        assists.push(helper);
      }
    }
    log.length = 0;
  }

  if (attacker && attacker.id !== victim.id && attacker.team !== victim.team) {
    attacker.kills += 1;
    attacker.streak += 1;
    attacker.score += event.region === "head" ? 150 : 100;
  }

  queueSound({ id: "death", position: victim.position.clone(), gain: 0.8 });

  return {
    attacker,
    victim,
    weaponId: event.weaponId,
    headshot: event.region === "head",
    penetrated: event.penetrated,
    distanceM: event.distanceM,
    assists,
  };
}

/** Health regeneration, suppression decay and respawn timers. */
export function tickActorState(dt: number, time: number): void {
  for (const actor of game.actors) {
    actor.suppression = Math.max(0, actor.suppression - dt * 0.55);
    if (!actor.alive) {
      actor.respawnTimer -= dt;
      continue;
    }
    if (
      actor.health < actor.maxHealth &&
      time - actor.lastDamageTime > COMBAT.regenDelay
    ) {
      actor.health = Math.min(actor.maxHealth, actor.health + COMBAT.regenRate * dt);
    }
  }
}

/** Raise suppression on anyone a round passed close to. */
export function applyNearMissSuppression(
  from: THREE.Vector3,
  to: THREE.Vector3,
  shooterTeam: string,
): void {
  _dir.copy(to).sub(from);
  const length = _dir.length();
  if (length < 1e-3) return;
  _dir.multiplyScalar(1 / length);
  for (const actor of game.actors) {
    if (!actor.alive || actor.team === shooterTeam) continue;
    _tmp.copy(actor.position).sub(from);
    const along = _tmp.dot(_dir);
    if (along < 0 || along > length) continue;
    _tmp.sub(_scratch.copy(_dir).multiplyScalar(along));
    const distance = _tmp.length();
    if (distance < 2.2) {
      actor.suppression = Math.min(1, actor.suppression + (1 - distance / 2.2) * 0.4);
      if (actor.isPlayer && distance < 1.4) {
        queueSound({ id: "whizz", gain: 0.6 - distance * 0.25 });
      }
    }
  }
}

const _tmp = new THREE.Vector3();
const _scratch = new THREE.Vector3();

export function respawnActor(actor: Actor, position: THREE.Vector3, yaw: number): void {
  actor.position.copy(position);
  actor.velocity.set(0, 0, 0);
  actor.yaw = yaw;
  actor.pitch = 0;
  actor.health = actor.maxHealth;
  actor.alive = true;
  actor.state = "idle";
  actor.stance = "stand";
  actor.respawnTimer = 0;
  actor.suppression = 0;
  actor.lastDamageTime = -99;
  damageLog.delete(actor.id);
}

/** Count of live actors per team, for the mode layer. */
export function countAlive(team: string): number {
  let count = 0;
  for (const actor of game.actors) if (actor.alive && actor.team === team) count += 1;
  return count;
}

export function enemyTeamOf(actor: Actor): string {
  return OPPOSING_TEAM[actor.team];
}
