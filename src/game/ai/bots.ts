import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import { GROUND_ZONES, type GroundZone } from "@/lib/layout";
import {
  HUMAN_METRICS,
  MASK_SIGHT,
  OPPOSING_TEAM,
  type Team,
} from "../core/types";
import {
  addActor,
  createActor,
  eyePosition,
  game,
  type Actor,
} from "../core/gameState";
import type { CollisionWorld } from "../physics/collisionWorld";
import { WeaponRuntime } from "../weapons/runtime";
import { getWeapon } from "../weapons/arsenal";
import { respawnActor } from "../core/combat";

/**
 * Bot brains.
 *
 * The behaviour is a small explicit state machine rather than a behaviour
 * tree, because at this size a tree is harder to read than the thing it
 * models. What makes bots feel fair rather than robotic is not the graph, it
 * is three numbers: a reaction delay before a spotted target can be shot at,
 * an aim error cone that *converges* the longer they hold a target rather than
 * snapping to zero, and burst discipline that leaves gaps you can move in.
 * All three scale with `actor.skill`.
 *
 * Navigation is steering plus whisker avoidance, not a full path search. The
 * compound is open ground between large convex buildings, which is the case
 * where steering does well and a grid search mostly buys corners; the nav grid
 * in `navmesh.ts` is there for when that stops being true.
 */

const BOT_NAMES = [
  "VOSS", "KESTREL", "AMARO", "DRAKE", "SOLIS", "RENNER", "HOLT", "BAIER",
  "NAKATA", "ORLOV", "PIKE", "SANDOVAL", "TEAGUE", "VANCE", "WREN", "ZAHRA",
  "BRANDT", "CORVI", "DELACROIX", "EASTON", "FARROW", "GALINDO", "HARKER", "IVES",
];

type BotState =
  | "idle"
  | "patrol"
  | "investigate"
  | "engage"
  | "reposition"
  | "reload"
  | "dead";

interface Bot {
  actor: Actor;
  weapon: WeaponRuntime;
  state: BotState;
  rand: () => number;
  /** Destination the bot is steering toward. */
  goal: THREE.Vector3;
  goalZone: GroundZone | null;
  /** Current target, and how long it has been continuously visible. */
  targetId: number | null;
  timeOnTarget: number;
  timeSinceSeen: number;
  lastKnown: THREE.Vector3;
  /** Counts down before the bot may fire at a newly acquired target. */
  reaction: number;
  /** Rounds left in the current burst, and the pause after it. */
  burst: number;
  burstPause: number;
  /** Staggered so perception raycasts spread across frames. */
  perceptionPhase: number;
  stateTimer: number;
  /** Deterministic aim wander, so shots do not all land on the same point. */
  aimNoisePhase: number;
}

const _eye = new THREE.Vector3();
const _targetEye = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _steer = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _right = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _lead = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Zones a team prefers to hold, so the two sides meet in the middle. */
function zonesForTeam(team: Team): GroundZone[] {
  const preferred = team === "blue" ? "north" : "south";
  const own = GROUND_ZONES.filter((z) => z.side === preferred);
  const neutral = GROUND_ZONES.filter((z) => z.side === "neutral");
  return own.length > 0 ? [...own, ...neutral] : [...GROUND_ZONES];
}

export interface BotManagerOptions {
  count: number;
  skill: number;
  seed: number;
}

export class BotManager {
  private readonly bots: Bot[] = [];
  private readonly world: CollisionWorld;
  private readonly rand: () => number;
  private nextId = 1;
  private frame = 0;
  /** Set by the scene so bots respawn where the mode wants them. */
  onFire: ((actor: Actor) => void) | null = null;

  constructor(world: CollisionWorld, options: BotManagerOptions) {
    this.world = world;
    this.rand = mulberry32(options.seed >>> 0);
    this.spawnAll(options);
  }

  get actors(): readonly Actor[] {
    return this.bots.map((b) => b.actor);
  }

  private spawnAll(options: BotManagerOptions): void {
    const primaries = ["kv-141", "mp-9k", "ar-9-tundra", "px-45-striker", "vx-4", "dm-7-quill"];
    for (let i = 0; i < options.count; i += 1) {
      // Alternate teams so both sides fill evenly; the player is on blue.
      const team: Team = i % 2 === 0 ? "red" : "blue";
      const id = ++this.nextId;
      const actor = createActor(id, BOT_NAMES[i % BOT_NAMES.length]!, team);
      // Spread skill around the requested level so a match has range.
      actor.skill = THREE.MathUtils.clamp(
        options.skill + (this.rand() - 0.5) * 0.28,
        0.1,
        1,
      );
      const weaponId = primaries[Math.floor(this.rand() * primaries.length)]!;
      actor.weaponId = weaponId;
      addActor(actor);

      const zones = zonesForTeam(team);
      const zone = zones[Math.floor(this.rand() * zones.length)]!;
      const spread = zone.radius * 0.7;
      const x = zone.position[0] + (this.rand() - 0.5) * spread * 2;
      const z = zone.position[1] + (this.rand() - 0.5) * spread * 2;
      respawnActor(actor, _probe.set(x, this.world.groundAt(x, z), z), this.rand() * Math.PI * 2);

      this.bots.push({
        actor,
        weapon: new WeaponRuntime(getWeapon(weaponId)),
        state: "patrol",
        rand: mulberry32((options.seed ^ (id * 2654435761)) >>> 0),
        goal: new THREE.Vector3(x, 0, z),
        goalZone: zone,
        targetId: null,
        timeOnTarget: 0,
        timeSinceSeen: 99,
        lastKnown: new THREE.Vector3(),
        reaction: 0,
        burst: 0,
        burstPause: 0,
        perceptionPhase: i % 8,
        stateTimer: 0,
        aimNoisePhase: this.rand() * 100,
      });
    }
  }

  /* ---------------------------------------------------------------- */

  update(dt: number, time: number): void {
    this.frame += 1;
    for (const bot of this.bots) {
      const actor = bot.actor;
      if (!actor.alive) {
        bot.state = "dead";
        if (actor.respawnTimer <= 0) this.respawn(bot);
        continue;
      }
      if (bot.state === "dead") bot.state = "patrol";

      bot.stateTimer += dt;
      // Perception is the expensive part; each bot re-checks on its own phase,
      // so the raycast cost is spread over eight frames instead of spiking.
      if ((this.frame + bot.perceptionPhase) % 8 === 0) {
        this.perceive(bot, dt * 8);
      } else {
        bot.timeSinceSeen += dt;
      }

      this.think(bot, dt);
      this.move(bot, dt);
      this.shoot(bot, dt, time);
    }
  }

  private respawn(bot: Bot): void {
    const zones = zonesForTeam(bot.actor.team);
    const player = game.player;
    let best: THREE.Vector3 | null = null;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const zone = zones[Math.floor(bot.rand() * zones.length)]!;
      const x = zone.position[0] + (bot.rand() - 0.5) * zone.radius * 1.6;
      const z = zone.position[1] + (bot.rand() - 0.5) * zone.radius * 1.6;
      _probe.set(x, this.world.groundAt(x, z), z);
      if (!this.world.isPositionFree(_probe, HUMAN_METRICS.radius, HUMAN_METRICS.colliderHeight.stand)) {
        continue;
      }
      // Prefer somewhere the player is not looking at from close range.
      const distance = _probe.distanceTo(player.position);
      let score = Math.min(distance, 120);
      if (distance < 25) score -= 200;
      if (best === null || score > bestScore) {
        bestScore = score;
        best = _probe.clone();
      }
    }
    if (!best) return;
    respawnActor(bot.actor, best, bot.rand() * Math.PI * 2);
    bot.weapon.refill();
    bot.state = "patrol";
    bot.targetId = null;
    bot.timeSinceSeen = 99;
    bot.stateTimer = 0;
    this.pickPatrolGoal(bot);
  }

  /* ---------------------------------------------------------------- */
  /* Perception                                                        */
  /* ---------------------------------------------------------------- */

  private perceive(bot: Bot, dt: number): void {
    const actor = bot.actor;
    const enemyTeam = OPPOSING_TEAM[actor.team];
    eyePosition(actor, _eye);

    let bestId: number | null = null;
    let bestScore = -Infinity;

    for (const other of game.actors) {
      if (!other.alive || other.team !== enemyTeam) continue;
      _toTarget.copy(other.position).sub(actor.position);
      const distance = _toTarget.length();
      if (distance > 160) continue;

      // Field of view, narrowed while suppressed.
      const fov = Math.cos((actor.suppression > 0.4 ? 0.75 : 1) * 0.96);
      _aim.set(Math.sin(actor.yaw), 0, -Math.cos(actor.yaw));
      _toTarget.y = 0;
      const facing = _toTarget.normalize().dot(_aim);
      // Anything very close is noticed regardless of where they are looking.
      if (facing < fov && distance > 6) continue;

      eyePosition(other, _targetEye);
      if (!this.world.hasLineOfSight(_eye, _targetEye, MASK_SIGHT, other.id)) continue;

      // Prefer close targets, ones near the centre of view, and ones shooting.
      let score = 140 - distance + facing * 40;
      if (game.time - other.lastFireTime < 1.5) score += 45;
      if (other.isPlayer) score += 12;
      if (score > bestScore) {
        bestScore = score;
        bestId = other.id;
      }
    }

    if (bestId !== null) {
      const target = game.actorById.get(bestId)!;
      if (bot.targetId !== bestId) {
        bot.targetId = bestId;
        bot.timeOnTarget = 0;
        // Reaction time: half a second at the bottom of the skill range,
        // an eighth at the top.
        bot.reaction = THREE.MathUtils.lerp(0.5, 0.12, actor.skill);
      }
      bot.timeOnTarget += dt;
      bot.timeSinceSeen = 0;
      bot.lastKnown.copy(target.position);
    } else {
      bot.timeSinceSeen += dt;
      if (bot.timeSinceSeen > 4) bot.targetId = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Decisions                                                         */
  /* ---------------------------------------------------------------- */

  private think(bot: Bot, dt: number): void {
    const actor = bot.actor;
    bot.reaction = Math.max(0, bot.reaction - dt);

    if (bot.weapon.needsReload && bot.state !== "reload") {
      bot.weapon.beginReload();
      bot.state = "reload";
      bot.stateTimer = 0;
    }
    if (bot.state === "reload" && !bot.weapon.isReloading) {
      bot.state = bot.targetId !== null ? "engage" : "patrol";
      bot.stateTimer = 0;
    }

    const hasTarget = bot.targetId !== null && bot.timeSinceSeen < 0.5;

    switch (bot.state) {
      case "idle":
      case "patrol":
        if (hasTarget) {
          bot.state = "engage";
          bot.stateTimer = 0;
        } else if (bot.actor.position.distanceTo(bot.goal) < 4 || bot.stateTimer > 22) {
          this.pickPatrolGoal(bot);
          bot.stateTimer = 0;
        }
        break;

      case "engage": {
        if (!hasTarget) {
          if (bot.timeSinceSeen < 5) {
            bot.state = "investigate";
            bot.goal.copy(bot.lastKnown);
          } else {
            bot.state = "patrol";
            this.pickPatrolGoal(bot);
          }
          bot.stateTimer = 0;
          break;
        }
        const target = game.actorById.get(bot.targetId!);
        if (!target) break;
        const distance = actor.position.distanceTo(target.position);
        const optimal = this.optimalRange(bot);
        // Close if too far to be effective, break off if suppressed and hurt.
        if (actor.suppression > 0.7 && actor.health < 45 && bot.rand() < 0.02) {
          bot.state = "reposition";
          this.pickCoverGoal(bot, target.position);
          bot.stateTimer = 0;
        } else if (distance > optimal * 1.6) {
          bot.goal.copy(target.position);
        } else if (distance < optimal * 0.45) {
          // Back off along the line to the target.
          _desired.copy(actor.position).sub(target.position).setY(0).normalize();
          bot.goal.copy(actor.position).addScaledVector(_desired, 8);
        } else if (bot.stateTimer > 3.5 && bot.rand() < 0.02) {
          // Periodic strafe so a firefight is not two statues.
          _desired.copy(target.position).sub(actor.position).setY(0).normalize();
          _right.crossVectors(_desired, UP).normalize();
          bot.goal
            .copy(actor.position)
            .addScaledVector(_right, (bot.rand() < 0.5 ? -1 : 1) * (4 + bot.rand() * 5));
          bot.stateTimer = 0;
        }
        break;
      }

      case "investigate":
        if (hasTarget) {
          bot.state = "engage";
          bot.stateTimer = 0;
        } else if (actor.position.distanceTo(bot.goal) < 3 || bot.stateTimer > 9) {
          bot.state = "patrol";
          this.pickPatrolGoal(bot);
          bot.stateTimer = 0;
        }
        break;

      case "reposition":
        if (actor.position.distanceTo(bot.goal) < 2.5 || bot.stateTimer > 6) {
          bot.state = hasTarget ? "engage" : "patrol";
          bot.stateTimer = 0;
        }
        break;

      case "reload":
      case "dead":
        break;
    }

    // Stance: crouch when holding a position under fire.
    const wantsCrouch =
      (bot.state === "engage" && actor.suppression > 0.35) ||
      (bot.state === "engage" && actor.position.distanceTo(bot.goal) < 1.5 && bot.rand() < 0.4);
    actor.stance = wantsCrouch ? "crouch" : "stand";
  }

  private optimalRange(bot: Bot): number {
    switch (bot.weapon.def.weaponClass) {
      case "smg":
        return 16;
      case "shotgun":
        return 8;
      case "sniper":
      case "marksman":
        return 70;
      case "lmg":
        return 45;
      default:
        return 30;
    }
  }

  private pickPatrolGoal(bot: Bot): void {
    const zones = zonesForTeam(bot.actor.team);
    const zone = zones[Math.floor(bot.rand() * zones.length)]!;
    bot.goalZone = zone;
    const spread = zone.radius * 0.8;
    const x = zone.position[0] + (bot.rand() - 0.5) * spread * 2;
    const z = zone.position[1] + (bot.rand() - 0.5) * spread * 2;
    bot.goal.set(x, this.world.groundAt(x, z), z);
  }

  private pickCoverGoal(bot: Bot, threat: THREE.Vector3): void {
    // Look for somewhere within 14 m that breaks line of sight to the threat.
    eyePosition(bot.actor, _eye);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const angle = bot.rand() * Math.PI * 2;
      const radius = 5 + bot.rand() * 9;
      const x = bot.actor.position.x + Math.cos(angle) * radius;
      const z = bot.actor.position.z + Math.sin(angle) * radius;
      _probe.set(x, this.world.groundAt(x, z) + HUMAN_METRICS.eyeHeight.crouch, z);
      if (!this.world.hasLineOfSight(_probe, threat, MASK_SIGHT)) {
        bot.goal.set(x, _probe.y, z);
        return;
      }
    }
    // Nothing breaks sight; fall back to putting distance between them.
    _desired.copy(bot.actor.position).sub(threat).setY(0).normalize();
    bot.goal.copy(bot.actor.position).addScaledVector(_desired, 10);
  }

  /* ---------------------------------------------------------------- */
  /* Movement                                                          */
  /* ---------------------------------------------------------------- */

  private move(bot: Bot, dt: number): void {
    const actor = bot.actor;
    _desired.copy(bot.goal).sub(actor.position);
    _desired.y = 0;
    const distance = _desired.length();

    let speed = 0;
    if (distance > 1.2) {
      _desired.multiplyScalar(1 / distance);
      const engaging = bot.state === "engage";
      speed =
        actor.stance === "crouch"
          ? 1.9
          : engaging
            ? 3.4
            : distance > 25
              ? 5.6
              : 3.9;

      // Whisker avoidance: probe ahead and to both sides at chest height and
      // steer away from whatever is closest. Cheaper than a path search and
      // enough for a compound of large convex buildings.
      _probe.set(actor.position.x, actor.position.y + 0.9, actor.position.z);
      _steer.copy(_desired);
      _right.crossVectors(_desired, UP).normalize();
      const feelers: [THREE.Vector3, number][] = [
        [_desired, 3.2],
        [_aim.copy(_desired).addScaledVector(_right, 0.6).normalize(), 2.4],
        [_lead.copy(_desired).addScaledVector(_right, -0.6).normalize(), 2.4],
      ];
      for (const [direction, reach] of feelers) {
        const hit = this.world.raycast(_probe, direction, reach, MASK_SIGHT, actor.id);
        if (hit) {
          // Push along the wall rather than straight back off it.
          _steer.addScaledVector(hit.normal, (1 - hit.distance / reach) * 2.2);
        }
      }
      // Separate from nearby teammates so squads do not stack.
      for (const other of game.actors) {
        if (other.id === actor.id || !other.alive || other.team !== actor.team) continue;
        const dx = actor.position.x - other.position.x;
        const dz = actor.position.z - other.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 4 && d2 > 1e-4) {
          const d = Math.sqrt(d2);
          _steer.x += (dx / d) * (1 - d / 2) * 1.6;
          _steer.z += (dz / d) * (1 - d / 2) * 1.6;
        }
      }
      _steer.y = 0;
      if (_steer.lengthSq() > 1e-6) _steer.normalize();

      actor.velocity.x += (_steer.x * speed - actor.velocity.x) * Math.min(1, dt * 9);
      actor.velocity.z += (_steer.z * speed - actor.velocity.z) * Math.min(1, dt * 9);
    } else {
      actor.velocity.x *= Math.exp(-9 * dt);
      actor.velocity.z *= Math.exp(-9 * dt);
    }

    actor.velocity.y -= 18.2 * dt;
    const result = this.world.moveCapsule(
      actor.position,
      actor.velocity,
      HUMAN_METRICS.radius,
      HUMAN_METRICS.colliderHeight[actor.stance],
      dt,
      HUMAN_METRICS.stepHeight,
      HUMAN_METRICS.maxSlope,
      actor.grounded,
    );
    actor.position.copy(result.position);
    actor.velocity.copy(result.velocity);
    actor.grounded = result.grounded;
    actor.groundSurface = result.groundSurface;
    actor.speed = Math.hypot(actor.velocity.x, actor.velocity.z);

    // A bot that walks into a wall for long enough picks somewhere else.
    if (result.hitWall && actor.speed < 0.6 && bot.state !== "engage") {
      if (bot.rand() < 0.05) this.pickPatrolGoal(bot);
    }

    actor.state = !result.grounded
      ? "fall"
      : actor.speed < 0.3
        ? "idle"
        : actor.speed > 4.6
          ? "sprint"
          : actor.speed > 2.6
            ? "run"
            : "walk";
  }

  /* ---------------------------------------------------------------- */
  /* Aiming and firing                                                 */
  /* ---------------------------------------------------------------- */

  private shoot(bot: Bot, dt: number, time: number): void {
    const actor = bot.actor;
    const target =
      bot.targetId !== null ? (game.actorById.get(bot.targetId) ?? null) : null;

    let wantsFire = false;

    if (target && target.alive && bot.timeSinceSeen < 0.35 && bot.state === "engage") {
      eyePosition(actor, _eye);
      eyePosition(target, _targetEye);

      // Lead the target by its own velocity over the round's flight time.
      const distance = _eye.distanceTo(_targetEye);
      const flight = distance / Math.max(80, bot.weapon.def.ballistics.muzzleVelocity);
      _lead.copy(target.velocity).multiplyScalar(flight * THREE.MathUtils.lerp(0.2, 1, actor.skill));
      _aim.copy(_targetEye).add(_lead).sub(_eye).normalize();

      // Aim error: wide on acquisition, converging the longer the target is
      // held. This is what stops a bot from being an instant-death laser while
      // still making it dangerous if you stand still in the open.
      const baseError = THREE.MathUtils.lerp(6, 0.6, actor.skill);
      const converge = Math.exp(-bot.timeOnTarget * (0.9 + actor.skill * 1.6));
      const suppressed = 1 + actor.suppression * 1.8;
      const errorDeg = (baseError * (0.35 + 0.65 * converge)) * suppressed;
      bot.aimNoisePhase += dt * 3.1;
      const errorRad = (errorDeg * Math.PI) / 180;
      _right.crossVectors(_aim, UP).normalize();
      _aim
        .addScaledVector(_right, Math.sin(bot.aimNoisePhase * 1.7) * errorRad)
        .addScaledVector(UP, Math.sin(bot.aimNoisePhase * 1.1 + 2) * errorRad * 0.7)
        .normalize();

      // Turn toward the aim rather than snapping to it.
      const wantYaw = Math.atan2(_aim.x, -_aim.z);
      const wantPitch = Math.asin(THREE.MathUtils.clamp(_aim.y, -1, 1));
      const turn = THREE.MathUtils.lerp(5, 13, actor.skill) * dt;
      let deltaYaw = (wantYaw - actor.yaw) % (Math.PI * 2);
      if (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
      if (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
      actor.yaw += THREE.MathUtils.clamp(deltaYaw, -turn, turn);
      actor.pitch += THREE.MathUtils.clamp(wantPitch - actor.pitch, -turn, turn);
      actor.aimDir.set(
        Math.sin(actor.yaw) * Math.cos(actor.pitch),
        Math.sin(actor.pitch),
        -Math.cos(actor.yaw) * Math.cos(actor.pitch),
      );

      // Burst discipline: fire a class-appropriate burst, then pause.
      bot.burstPause = Math.max(0, bot.burstPause - dt);
      const aimedEnough = Math.abs(deltaYaw) < 0.22;
      if (bot.reaction <= 0 && aimedEnough && bot.burstPause <= 0) {
        if (bot.burst <= 0) {
          bot.burst = this.burstSize(bot, distance);
        }
        wantsFire = true;
      }
    } else {
      // No target: face the direction of travel.
      if (actor.speed > 0.4) {
        const wantYaw = Math.atan2(actor.velocity.x, -actor.velocity.z);
        let deltaYaw = (wantYaw - actor.yaw) % (Math.PI * 2);
        if (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
        if (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
        actor.yaw += THREE.MathUtils.clamp(deltaYaw, -4 * dt, 4 * dt);
      }
      actor.pitch = damp(actor.pitch, 0, 4, dt);
      actor.aimDir.set(Math.sin(actor.yaw), 0, -Math.cos(actor.yaw));
      bot.burst = 0;
    }

    bot.weapon.update(dt, {
      wantsFire,
      wantsAds: bot.state === "engage",
      canFire: actor.alive,
    });

    if (wantsFire && bot.weapon.wantsShot(true)) {
      eyePosition(actor, _eye);
      bot.weapon.fire({
        shooter: actor,
        world: this.world,
        time,
        direction: actor.aimDir,
        origin: _eye,
        // Bots apply their own error above, so the runtime's spread stays tight.
        accuracy: 1,
      });
      actor.lastFireTime = time;
      bot.burst -= 1;
      if (bot.burst <= 0) {
        bot.burstPause = THREE.MathUtils.lerp(0.75, 0.22, actor.skill) * (0.7 + bot.rand() * 0.6);
      }
      this.onFire?.(actor);
    }

    bot.weapon.updateProjectiles(dt, this.world, time);
    bot.weapon.maybeResetPattern(time);
  }

  private burstSize(bot: Bot, distance: number): number {
    const long = distance > 45;
    switch (bot.weapon.def.weaponClass) {
      case "sniper":
      case "marksman":
        return 1;
      case "shotgun":
        return 1;
      case "lmg":
        return long ? 6 : 10;
      case "smg":
        return long ? 4 : 9;
      default:
        return long ? 3 : 6;
    }
  }

  dispose(): void {
    this.bots.length = 0;
  }
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}
