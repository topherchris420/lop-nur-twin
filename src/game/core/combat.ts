import * as THREE from "three";
import { OPPOSING_TEAM, yawToForward, type DamageEvent, type EntityId } from "./types";
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
  regenDelay: 3.5,
  /** Health per second once regeneration begins. */
  regenRate: 55,
  /** Player damage dealt to bots, making hits feel more responsive. */
  playerDamageScale: 1.2,
  /** Incoming bot damage received by the player. */
  playerIncomingDamageScale: 0.7,
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
const _facing = new THREE.Vector3();

/**
 * Which side of a victim a round came in on: `+1` from their left, `-1` from
 * their right. The flinch layer rocks the torso the other way, so a body
 * visibly absorbs the hit rather than twitching in place.
 */
function lateralSign(victim: Actor, incoming: THREE.Vector3): number {
  yawToForward(victim.yaw, _facing);
  // `forward x up` is the actor's own right, so the dot picks the side.
  const rightX = -_facing.z;
  const rightZ = _facing.x;
  return Math.sign(incoming.x * rightX + incoming.z * rightZ) || 1;
}

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

    const damageScale = attacker?.isPlayer
      ? COMBAT.playerDamageScale
      : victim.isPlayer
        ? COMBAT.playerIncomingDamageScale
        : 1;
    const appliedDamage = event.amount * damageScale;
    victim.health -= appliedDamage;
    victim.lastDamageTime = time;
    victim.lastAttackerId = event.attackerId;

    // Near-miss suppression is handled elsewhere; a direct hit always
    // suppresses hard and induces defensive flinch.
    victim.suppression = Math.min(1, victim.suppression + 0.65);

    recordDamage(victim.id, event.attackerId, appliedDamage, time);

    // Every hit shows on the body it landed on. Without this a bot absorbs a
    // magazine with no visible acknowledgement, which reads as "my shots are
    // going through them" even when every round is registering.
    if (!victim.isPlayer) {
      _dir.copy(event.direction).normalize();
      game.characters?.reportHit(victim.id, lateralSign(victim, _dir));
    }

    if (victim.isPlayer) {
      _dir.copy(event.direction).normalize();
      const angle = Math.atan2(_dir.x, _dir.z);
      game.hud.damageDirs.push({ angle, time, amount: appliedDamage });
      if (game.hud.damageDirs.length > 8) game.hud.damageDirs.shift();
      queueSound({ id: "damage", gain: Math.min(1, 0.35 + appliedDamage / 90) });
    }

    if (attacker?.isPlayer) {
      game.hud.hitmarker = victim.health <= 0 ? 420 : 240;
      game.hud.hitmarkerKill = victim.health <= 0;
      if (victim.health <= 0) {
        if (event.region === "head") {
          queueSound({ id: "headshot", gain: 0.88 });
        } else {
          queueSound({ id: "kill", gain: 0.78 });
        }
        if (Math.random() < 0.35) {
          queueSound({ id: "radio-hostile-down", gain: 0.65 });
        }
      } else {
        if (event.region === "head") {
          queueSound({ id: "headshot", gain: 0.72 });
        } else {
          queueSound({ id: "hitmarker", gain: 0.55 });
        }
      }
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

let scoreEventId = 1;

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
  // The body keeps its own momentum and takes a shove from the round, so it
  // carries into the fall instead of stopping dead and folding on the spot.
  // Horizontal only: the vertical channel belongs to gravity.
  victim.deathDir.copy(event.direction).setY(0);
  if (victim.deathDir.lengthSq() < 1e-6) victim.deathDir.set(0, 0, -1);
  victim.deathDir.normalize();
  victim.deathHeadshot = event.region === "head";
  victim.velocity.multiplyScalar(0.45).addScaledVector(victim.deathDir, 1.6);
  victim.velocity.y = 0;

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
        if (helper.isPlayer) {
          game.hud.scoreEvents.push({
            id: scoreEventId++,
            label: "ASSIST",
            points: 50,
            time,
            subtext: victim.name,
            medal: true,
          });
        }
      }
    }
    log.length = 0;
  }

  if (attacker && attacker.id !== victim.id && attacker.team !== victim.team) {
    attacker.kills += 1;
    attacker.streak += 1;
    const isHeadshot = event.region === "head";
    attacker.score += isHeadshot ? 150 : 100;

    if (attacker.isPlayer) {
      // CoD MW style XP medals
      game.hud.scoreEvents.push({
        id: scoreEventId++,
        label: "ELIMINATED",
        points: 100,
        time,
        subtext: victim.name,
        medal: true,
      });
      if (isHeadshot) {
        game.hud.scoreEvents.push({
          id: scoreEventId++,
          label: "HEADSHOT",
          points: 50,
          time: time + 0.05,
          medal: true,
        });
      }
      if (event.distanceM > 40) {
        game.hud.scoreEvents.push({
          id: scoreEventId++,
          label: "LONGSHOT",
          points: 50,
          time: time + 0.1,
          subtext: `${event.distanceM.toFixed(0)}m`,
          medal: true,
        });
      }
      if (event.penetrated) {
        game.hud.scoreEvents.push({
          id: scoreEventId++,
          label: "WALLBANG",
          points: 25,
          time: time + 0.15,
          medal: false,
        });
      }
      if (attacker.streak > 1 && attacker.streak % 2 === 0) {
        game.hud.scoreEvents.push({
          id: scoreEventId++,
          label: `${attacker.streak}X STREAK`,
          points: 50,
          time: time + 0.2,
          medal: true,
        });
      }
    }
  }

  queueSound({ id: "death", position: victim.position.clone(), gain: 0.8 });

  if (victim.isPlayer) {
    game.hud.killedBy = attacker?.name ?? "—";
    game.hud.killedByWeapon = event.weaponId;
    game.hud.killedByHeadshot = event.region === "head";
  }

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

let lastHeartbeatTime = 0;

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

  // Low health heartbeat pulse audio
  if (game.player.alive && game.player.health < 35 && game.player.health > 0) {
    const ratio = game.player.health / game.player.maxHealth;
    const interval = THREE.MathUtils.lerp(0.52, 0.92, Math.max(0, ratio / 0.35));
    if (time - lastHeartbeatTime >= interval) {
      lastHeartbeatTime = time;
      const gain = THREE.MathUtils.lerp(0.85, 0.4, ratio / 0.35);
      queueSound({ id: "heartbeat", gain });
    }
  }
}

/** Record unsuppressed gunfire blips for radar minimap and tactical compass. */
export function recordGunfirePing(shooter: Actor, time: number): void {
  if (!game.hud.gunfirePings) return;
  const camPos = game.cameraPosition;
  const dx = shooter.position.x - camPos.x;
  const dz = shooter.position.z - camPos.z;
  const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
  game.hud.gunfirePings.push({
    x: shooter.position.x,
    y: shooter.position.y + 1.2,
    z: shooter.position.z,
    bearing,
    time,
    shooterTeam: shooter.team,
  });
  if (game.hud.gunfirePings.length > 24) game.hud.gunfirePings.shift();
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
        if (actor.suppression > 0.55 && Math.random() < 0.25) {
          queueSound({ id: "radio-contact", gain: 0.6 });
        }
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
