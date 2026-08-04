import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import { GROUND_ZONES, type GroundZone } from "@/lib/layout";
import {
  HUMAN_METRICS,
  MASK_SIGHT,
  OPPOSING_TEAM,
  forwardToYaw,
  yawDelta,
  yawToForward,
  type EntityId,
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
import { applyNearMissSuppression, respawnActor } from "../core/combat";

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
 *
 * ## Why the fight comes to you
 *
 * The site is 600 m of compound and the zones span all of it, so a force
 * scattered evenly across them fights at 200–500 m — ranges at which a 0.4 m
 * chest box behind a 2.6° hip-fire cone is unhittable, and at which nobody
 * ever meets anybody. The genre this is modelled on works at 10–40 m, and it
 * gets there by *choosing* where the fight is rather than distributing bodies
 * uniformly. Three things here do that:
 *
 *  - **A focus point** (`setFocus`, driven from the player) picks which zones
 *    are live. Patrol goals and spawns come from that subset, so the force
 *    converges instead of dispersing.
 *  - **Scored spawns** put a returning bot in a band around the focus, never
 *    inside somebody's line of sight and never on top of a live enemy.
 *  - **Shared contacts.** A bot that sees or hears an enemy tells its team, so
 *    a single contact pulls the squad in rather than one bot at a time.
 */

const BOT_NAMES = [
  "VOSS", "KESTREL", "AMARO", "DRAKE", "SOLIS", "RENNER", "HOLT", "BAIER",
  "NAKATA", "ORLOV", "PIKE", "SANDOVAL", "TEAGUE", "VANCE", "WREN", "ZAHRA",
  "BRANDT", "CORVI", "DELACROIX", "EASTON", "FARROW", "GALINDO", "HARKER", "IVES",
];

/**
 * What bots carry. These are ids from `weapons/arsenal.ts`, and they have to
 * stay ids from `weapons/arsenal.ts` — `getWeapon` falls back to the reference
 * rifle for anything it does not recognise, so a stale list does not throw,
 * it silently issues the entire opposing force the same gun and quietly
 * disables every class-dependent branch in this file.
 */
const BOT_PRIMARIES = [
  "oslo-14", "oslo-14", "halberd-762", "cinder-33", "ronin-68",
  "wasp-9", "wasp-9", "kestrel-45", "hornet-pdw",
  "bulwark-7", "longbow-dmr", "breaker-12",
];

/** How far a bot can see a target it is facing. */
const SIGHT_RANGE = 165;
/** How far unsuppressed gunfire gives a shooter's position away. */
const HEARING_RANGE = 115;
/** Frames between perception sweeps; the cost is spread across this many. */
const PERCEPTION_STRIDE = 4;
/** Zones this far from the focus point are in play. */
const LIVE_ZONE_RADIUS = 170;
/** Spawns are scored toward this band around the focus point. */
const SPAWN_BAND_MIN = 45;
const SPAWN_BAND_MAX = 135;
/** Never spawn this close to a live enemy, or where one can see you. */
const SPAWN_ENEMY_CLEARANCE = 32;
const SPAWN_SIGHT_CLEARANCE = 90;
/** How long a reported contact is worth acting on. */
const CONTACT_TTL = 9;

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
  /** Timestamp of the team contact this bot has already acted on. */
  actedOnContact: number;
  /** Fixed lateral offset so a squad converging on one contact spreads out. */
  flank: number;
}

/** What one side currently believes about where the other side is. */
interface Contact {
  position: THREE.Vector3;
  targetId: EntityId;
  /** `game.time` the sighting was reported. */
  time: number;
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
const _spawn = new THREE.Vector3();
const _shotEnd = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export interface BotManagerOptions {
  count: number;
  skill: number;
  seed: number;
  /**
   * Where the match is fought. Supplied at construction as well as per frame
   * because the opening spawn is the one that decides whether the first thirty
   * seconds are a firefight or a walk.
   */
  focus?: THREE.Vector3;
}

export class BotManager {
  private readonly bots: Bot[] = [];
  private readonly world: CollisionWorld;
  private readonly rand: () => number;
  private nextId = 1;
  private frame = 0;
  /** Set by the scene so bots respawn where the mode wants them. */
  onFire: ((actor: Actor) => void) | null = null;

  /** Where the fight is. Zone selection and spawn scoring are relative to it. */
  private readonly focus = new THREE.Vector3();
  private hasFocus = false;

  /** The last enemy sighting each team has shared, newest wins. */
  private readonly contacts: Record<Team, Contact | null> = { blue: null, red: null };

  constructor(world: CollisionWorld, options: BotManagerOptions) {
    this.world = world;
    this.rand = mulberry32(options.seed >>> 0);
    if (options.focus) this.setFocus(options.focus);
    this.spawnAll(options);
  }

  get actors(): readonly Actor[] {
    return this.bots.map((b) => b.actor);
  }

  /**
   * Move the point the match is fought around. The scene drives this from the
   * player, because the player is the only actor whose experience of the match
   * is not interchangeable with anyone else's.
   */
  setFocus(position: THREE.Vector3): void {
    this.focus.copy(position);
    this.hasFocus = true;
  }

  /**
   * A validated spawn for any actor, including the player.
   *
   * Exposed so the match director respawns everyone through the same
   * geometry-checked path the bots use — two spawn implementations is exactly
   * how the player ends up inside a hangar while the bots never do.
   */
  spawnPointFor(team: Team): { position: [number, number, number]; yaw: number } | null {
    if (!this.findSpawnPoint(team, this.rand, _probe)) return null;
    return {
      position: [_probe.x, _probe.y, _probe.z],
      yaw: this.rand() * Math.PI * 2,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Where the fight is                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Zones a team may hold. Own side plus neutral ground so the two forces meet
   * in the middle, then narrowed to whatever is near the focus point — which
   * is what keeps engagements inside a couple of hundred metres instead of
   * spread over the whole 600 m compound.
   */
  private zonesForTeam(team: Team): GroundZone[] {
    const preferred = team === "blue" ? "north" : "south";
    const own = GROUND_ZONES.filter((z) => z.side === preferred);
    const neutral = GROUND_ZONES.filter((z) => z.side === "neutral");
    const claimed = own.length > 0 ? [...own, ...neutral] : [...GROUND_ZONES];
    if (!this.hasFocus) return claimed;

    const live = claimed.filter((z) => this.zoneDistance(z) < LIVE_ZONE_RADIUS);
    if (live.length > 0) return live;

    // Nothing near the focus belongs to this team: fall back to its closest
    // zones so it advances toward the fight rather than holding an empty
    // corner of the site.
    return [...claimed]
      .sort((a, b) => this.zoneDistance(a) - this.zoneDistance(b))
      .slice(0, 3);
  }

  private zoneDistance(zone: GroundZone): number {
    return Math.hypot(zone.position[0] - this.focus.x, zone.position[1] - this.focus.z);
  }

  /**
   * Pick a spawn inside one of the team's zones that a standing capsule
   * actually fits in, scored for where it puts the returning body.
   *
   * Scattering inside a zone radius is not enough on its own: the zones are
   * centred on the structures they are named after, so a naive scatter drops
   * a bot inside the assembly hangar about half the time. An embedded bot is
   * then pushed out by the capsule solver over the next few seconds, which
   * looks like it is climbing the wall, and until it escapes nothing can see
   * or shoot it. On top of that, the best geometric spawn is still a bad spawn
   * if it is behind the enemy or already in somebody's sights, so candidates
   * are scored rather than accepted on first fit.
   */
  private findSpawnPoint(team: Team, rand: () => number, out: THREE.Vector3): boolean {
    const zones = this.zonesForTeam(team);
    if (zones.length === 0) return false;
    let bestScore = -Infinity;
    let found = false;

    for (let attempt = 0; attempt < 22; attempt += 1) {
      const zone = zones[Math.floor(rand() * zones.length)]!;
      const spread = zone.radius * 0.9;
      const x = zone.position[0] + (rand() - 0.5) * spread * 2;
      const z = zone.position[1] + (rand() - 0.5) * spread * 2;
      _spawn.set(x, this.world.groundAt(x, z), z);
      if (
        !this.world.isPositionFree(
          _spawn,
          HUMAN_METRICS.radius,
          HUMAN_METRICS.colliderHeight.stand,
        )
      ) {
        continue;
      }
      const score = this.scoreSpawn(_spawn, team);
      if (score > bestScore) {
        bestScore = score;
        out.copy(_spawn);
        found = true;
        // A clean spawn inside the band is good enough; stop paying for
        // raycasts once one turns up.
        if (score >= 0) break;
      }
    }
    return found;
  }

  /** Higher is better; 0 is a spawn with nothing wrong with it. */
  private scoreSpawn(position: THREE.Vector3, team: Team): number {
    const enemyTeam = OPPOSING_TEAM[team];
    let score = 0;

    if (this.hasFocus) {
      const d = Math.hypot(position.x - this.focus.x, position.z - this.focus.z);
      // Too close is a spawn on top of the fight; too far is a long walk back
      // to it. Both are penalised, the near side harder.
      score -= Math.max(0, SPAWN_BAND_MIN - d) * 6;
      score -= Math.max(0, d - SPAWN_BAND_MAX) * 2.5;
    }

    _eye.set(
      position.x,
      position.y + HUMAN_METRICS.eyeHeight.stand,
      position.z,
    );
    for (const other of game.actors) {
      if (!other.alive || other.team !== enemyTeam) continue;
      const d = other.position.distanceTo(position);
      if (d < SPAWN_ENEMY_CLEARANCE) score -= (SPAWN_ENEMY_CLEARANCE - d) * 14;
      if (d > SPAWN_SIGHT_CLEARANCE) continue;
      // Materialising inside somebody's view is the one unforgivable spawn.
      eyePosition(other, _targetEye);
      if (this.world.hasLineOfSight(_targetEye, _eye, MASK_SIGHT, other.id)) {
        score -= 600;
        break;
      }
    }
    return score;
  }

  private spawnAll(options: BotManagerOptions): void {
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
      const weaponId = BOT_PRIMARIES[Math.floor(this.rand() * BOT_PRIMARIES.length)]!;
      actor.weaponId = weaponId;
      addActor(actor);

      if (!this.findSpawnPoint(team, this.rand, _probe)) {
        // No clear ground anywhere in this team's zones; skip rather than
        // place a bot inside a building.
        continue;
      }
      respawnActor(actor, _probe, this.rand() * Math.PI * 2);
      const spawnZone = _probe.clone();

      this.bots.push({
        actor,
        weapon: new WeaponRuntime(getWeapon(weaponId)),
        state: "patrol",
        rand: mulberry32((options.seed ^ (id * 2654435761)) >>> 0),
        goal: spawnZone,
        goalZone: null,
        targetId: null,
        timeOnTarget: 0,
        timeSinceSeen: 99,
        lastKnown: new THREE.Vector3(),
        reaction: 0,
        burst: 0,
        burstPause: 0,
        perceptionPhase: i % PERCEPTION_STRIDE,
        stateTimer: 0,
        aimNoisePhase: this.rand() * 100,
        actedOnContact: -1,
        flank: (this.rand() - 0.5) * 16,
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
        // Corpses still fall. Skipping the sweep entirely leaves a body shot
        // on a stair or a container hanging in the air until it respawns.
        this.settleCorpse(actor, dt);
        if (actor.respawnTimer <= 0) this.respawn(bot);
        continue;
      }
      if (bot.state === "dead") bot.state = "patrol";

      bot.stateTimer += dt;
      // Perception is the expensive part; each bot re-checks on its own phase,
      // so the raycast cost is spread across the stride instead of spiking.
      if ((this.frame + bot.perceptionPhase) % PERCEPTION_STRIDE === 0) {
        this.perceive(bot, dt * PERCEPTION_STRIDE, time);
      } else {
        bot.timeSinceSeen += dt;
      }

      this.think(bot, dt, time);
      this.move(bot, dt);
      this.shoot(bot, dt, time);
    }
  }

  /** Let a dead actor fall to the ground; no steering, no input. */
  private settleCorpse(actor: Actor, dt: number): void {
    if (actor.grounded && actor.velocity.lengthSq() < 1e-4) return;
    actor.velocity.y -= 18.2 * dt;
    // Friction, so a body shoved by a round slides a little and stops.
    const drag = Math.exp(-6 * dt);
    actor.velocity.x *= drag;
    actor.velocity.z *= drag;
    const result = this.world.moveCapsule(
      actor.position,
      actor.velocity,
      HUMAN_METRICS.radius,
      HUMAN_METRICS.colliderHeight.prone,
      dt,
      HUMAN_METRICS.stepHeight,
      HUMAN_METRICS.maxSlope,
      actor.grounded,
    );
    actor.position.copy(result.position);
    actor.velocity.copy(result.velocity);
    actor.grounded = result.grounded;
  }

  private respawn(bot: Bot): void {
    if (!this.findSpawnPoint(bot.actor.team, bot.rand, _probe)) return;
    respawnActor(bot.actor, _probe, bot.rand() * Math.PI * 2);
    bot.weapon.refill();
    bot.state = "patrol";
    bot.targetId = null;
    bot.timeSinceSeen = 99;
    bot.stateTimer = 0;
    bot.actedOnContact = -1;
    this.pickPatrolGoal(bot);
  }

  /* ---------------------------------------------------------------- */
  /* Perception                                                        */
  /* ---------------------------------------------------------------- */

  /** Share a sighting with the rest of the team. */
  private report(team: Team, targetId: EntityId, at: THREE.Vector3, time: number): void {
    const existing = this.contacts[team];
    if (existing) {
      existing.position.copy(at);
      existing.targetId = targetId;
      existing.time = time;
      return;
    }
    this.contacts[team] = { position: at.clone(), targetId, time };
  }

  private currentContact(team: Team, time: number): Contact | null {
    const contact = this.contacts[team];
    if (!contact || time - contact.time > CONTACT_TTL) return null;
    return contact;
  }

  private perceive(bot: Bot, dt: number, time: number): void {
    const actor = bot.actor;
    const enemyTeam = OPPOSING_TEAM[actor.team];
    eyePosition(actor, _eye);

    let bestId: number | null = null;
    let bestScore = -Infinity;
    let heardId: number | null = null;
    let heardDistance = Infinity;

    for (const other of game.actors) {
      if (!other.alive || other.team !== enemyTeam) continue;
      _toTarget.copy(other.position).sub(actor.position);
      const distance = _toTarget.length();
      if (distance > SIGHT_RANGE) continue;

      // Gunfire carries through walls. It does not give a firing solution, but
      // it does say "somebody is over there", which is the difference between
      // a compound where the shooting draws people in and one where you can
      // empty a magazine and nobody looks up.
      const firing = time - other.lastFireTime < 1.4;
      if (firing && distance < HEARING_RANGE && distance < heardDistance) {
        heardId = other.id;
        heardDistance = distance;
      }

      // Field of view, narrowed while suppressed.
      const fov = Math.cos((actor.suppression > 0.4 ? 0.75 : 1) * 0.96);
      yawToForward(actor.yaw, _aim);
      _toTarget.y = 0;
      const facing = _toTarget.normalize().dot(_aim);
      // Anything very close is noticed regardless of where they are looking.
      if (facing < fov && distance > 6) continue;

      eyePosition(other, _targetEye);
      if (!this.world.hasLineOfSight(_eye, _targetEye, MASK_SIGHT, other.id)) continue;

      // Prefer close targets, ones near the centre of view, and ones shooting.
      let score = 140 - distance + facing * 40;
      if (firing) score += 45;
      // The player is the reason the match exists. A bot that can see them and
      // picks a bot four metres closer turns the match into a spectator sport.
      if (other.isPlayer) score += 60;
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
      this.report(actor.team, bestId, target.position, time);
      return;
    }

    bot.timeSinceSeen += dt;
    if (bot.timeSinceSeen > 4) bot.targetId = null;

    if (heardId !== null) {
      const heard = game.actorById.get(heardId);
      if (heard) {
        bot.lastKnown.copy(heard.position);
        this.report(actor.team, heardId, heard.position, time);
        if (bot.state === "patrol" || bot.state === "idle") {
          bot.state = "investigate";
          bot.goal.copy(heard.position);
          bot.stateTimer = 0;
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Decisions                                                         */
  /* ---------------------------------------------------------------- */

  private think(bot: Bot, dt: number, time: number): void {
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

    // Being shot at from somewhere you cannot see is information. Turn toward
    // it and go looking, rather than continuing to walk away from the rounds.
    if (!hasTarget && time - actor.lastDamageTime < 0.35 && actor.lastAttackerId !== null) {
      const attacker = game.actorById.get(actor.lastAttackerId);
      if (attacker && attacker.team !== actor.team) {
        bot.lastKnown.copy(attacker.position);
        this.report(actor.team, attacker.id, attacker.position, time);
        if (bot.state !== "engage") {
          bot.state = "investigate";
          bot.goal.copy(attacker.position);
          bot.stateTimer = 0;
        }
      }
    }

    switch (bot.state) {
      case "idle":
      case "patrol":
        if (hasTarget) {
          bot.state = "engage";
          bot.stateTimer = 0;
        } else if (this.followTeamContact(bot, time)) {
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
          if (!this.followTeamContact(bot, time)) this.pickPatrolGoal(bot);
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

  /**
   * Move on the team's most recent contact, offset laterally so a squad
   * arrives spread out rather than in single file. Returns true when the bot
   * took the contact — each one is acted on once, or a bot re-routes to the
   * same call every frame and never gets anywhere.
   */
  private followTeamContact(bot: Bot, time: number): boolean {
    const contact = this.currentContact(bot.actor.team, time);
    if (!contact || contact.time <= bot.actedOnContact) return false;
    const distance = bot.actor.position.distanceTo(contact.position);
    // Somewhere else entirely: worth crossing the compound for. Right on top
    // of it: nothing to walk toward.
    if (distance < 12) return false;

    bot.actedOnContact = contact.time;
    _desired.copy(contact.position).sub(bot.actor.position).setY(0);
    if (_desired.lengthSq() < 1e-6) return false;
    _desired.normalize();
    _right.crossVectors(_desired, UP).normalize();
    bot.goal.copy(contact.position).addScaledVector(_right, bot.flank);
    bot.goal.y = this.world.groundAt(bot.goal.x, bot.goal.z);
    bot.state = "investigate";
    return true;
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
    // Route through the same validated picker as spawning, so bots never walk
    // toward the inside of a building and grind against its wall — and so a
    // patrol stays inside the live zones rather than wandering off site.
    if (this.findSpawnPoint(bot.actor.team, bot.rand, _probe)) {
      bot.goal.copy(_probe);
    }
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

    if (target && target.alive && bot.timeSinceSeen < 0.5 && bot.state === "engage") {
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
      const wantYaw = forwardToYaw(_aim.x, _aim.z);
      const wantPitch = Math.asin(THREE.MathUtils.clamp(_aim.y, -1, 1));
      const turn = THREE.MathUtils.lerp(5, 13, actor.skill) * dt;
      const deltaYaw = yawDelta(actor.yaw, wantYaw);
      actor.yaw += THREE.MathUtils.clamp(deltaYaw, -turn, turn);
      actor.pitch += THREE.MathUtils.clamp(wantPitch - actor.pitch, -turn, turn);
      yawToForward(actor.yaw, actor.aimDir, actor.pitch);

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
        const wantYaw = forwardToYaw(actor.velocity.x, actor.velocity.z);
        actor.yaw += THREE.MathUtils.clamp(yawDelta(actor.yaw, wantYaw), -4 * dt, 4 * dt);
      }
      actor.pitch = damp(actor.pitch, 0, 4, dt);
      yawToForward(actor.yaw, actor.aimDir);
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
      // Rounds that miss still land near somebody. Without this the player is
      // the only actor in the match whose fire suppresses anyone, and incoming
      // fire arrives with no warning at all — no crack past the ear, no
      // narrowing view, just a health bar that moved.
      _shotEnd.copy(_eye).addScaledVector(actor.aimDir, 200);
      applyNearMissSuppression(_eye, _shotEnd, actor.team);
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
    this.contacts.blue = null;
    this.contacts.red = null;
  }
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}
