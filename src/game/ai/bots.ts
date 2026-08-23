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
  removeActor,
  createActor,
  eyePosition,
  game,
  queueSound,
  type Actor,
} from "../core/gameState";
import type { CollisionWorld } from "../physics/collisionWorld";
import type { MatchDirector } from "../modes/match";
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
  "VOSS",
  "KESTREL",
  "AMARO",
  "DRAKE",
  "SOLIS",
  "RENNER",
  "HOLT",
  "BAIER",
  "NAKATA",
  "ORLOV",
  "PIKE",
  "SANDOVAL",
  "TEAGUE",
  "VANCE",
  "WREN",
  "ZAHRA",
  "BRANDT",
  "CORVI",
  "DELACROIX",
  "EASTON",
  "FARROW",
  "GALINDO",
  "HARKER",
  "IVES",
];

/**
 * What bots carry. These are ids from `weapons/arsenal.ts`, and they have to
 * stay ids from `weapons/arsenal.ts` — `getWeapon` falls back to the reference
 * rifle for anything it does not recognise, so a stale list does not throw,
 * it silently issues the entire opposing force the same gun and quietly
 * disables every class-dependent branch in this file.
 */
const BOT_PRIMARIES = [
  "oslo-14",
  "oslo-14",
  "halberd-762",
  "cinder-33",
  "ronin-68",
  "wasp-9",
  "wasp-9",
  "kestrel-45",
  "hornet-pdw",
  "bulwark-7",
  "longbow-dmr",
  "breaker-12",
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
  | "slide"
  | "cover_peek"
  | "suppress"
  | "flank"
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

  /* Modern Warfare Tactical Squad Behaviors */
  coverPosition: THREE.Vector3;
  hasCover: boolean;
  coverNormal: THREE.Vector3;
  peeking: boolean;
  peekTimer: number;
  peekDuration: number;
  peekSide: number; // -1 or 1
  slideTimer: number;
  isTacSprinting: boolean;
  suppressTarget: THREE.Vector3;
  suppressTimer: number;
  lastCalloutTime: number;
  flankedDetected: boolean;
}

const CALLOUT_COOLDOWNS: Record<Team, number> = { blue: -99, red: -99 };
let calloutId = 1;

export type SquadCalloutType =
  | "contact"
  | "suppressing"
  | "moving_cover"
  | "flanked"
  | "flanking"
  | "pinned"
  | "reloading"
  | "kill";

export function emitSquadCallout(
  bot: Bot,
  type: SquadCalloutType,
  time: number,
): void {
  if (time - CALLOUT_COOLDOWNS[bot.actor.team] < 2.0 || time - bot.lastCalloutTime < 4.2) {
    return;
  }
  CALLOUT_COOLDOWNS[bot.actor.team] = time;
  bot.lastCalloutTime = time;

  const name = bot.actor.name;
  let text = "";
  switch (type) {
    case "contact": {
      const phrases = [
        "Contact, front!",
        "Hostile spotted!",
        "Enemy in sector!",
        "Target sighted!",
        "Eyes on hostile!",
      ];
      text = phrases[Math.floor(bot.rand() * phrases.length)]!;
      break;
    }
    case "suppressing": {
      const phrases = [
        "Laying down suppressive fire!",
        "Suppressing target!",
        "Keep them pinned!",
        "Laying down heavy cover!",
      ];
      text = phrases[Math.floor(bot.rand() * phrases.length)]!;
      break;
    }
    case "moving_cover": {
      const phrases = [
        "Sliding into cover!",
        "Moving to hard cover!",
        "Shifting positions!",
        "Repositioning under fire!",
      ];
      text = phrases[Math.floor(bot.rand() * phrases.length)]!;
      break;
    }
    case "flanked": {
      const phrases = [
        "Taking fire from the flank!",
        "We're flanked! Fall back!",
        "Hostile on our flank!",
        "Breaking contact, repositioning!",
      ];
      text = phrases[Math.floor(bot.rand() * phrases.length)]!;
      break;
    }
    case "flanking": {
      const phrases = [
        "Moving on their flank!",
        "Taking the side angle!",
        "Flanking left!",
        "Pushing around their cover!",
      ];
      text = phrases[Math.floor(bot.rand() * phrases.length)]!;
      break;
    }
    case "pinned": {
      const phrases = [
        "I'm pinned down!",
        "Taking heavy fire!",
        "Need covering fire!",
      ];
      text = phrases[Math.floor(bot.rand() * phrases.length)]!;
      break;
    }
    case "reloading": {
      const phrases = [
        "Reloading, cover me!",
        "Mag dry! Watch my sector!",
        "Swapping mags!",
      ];
      text = phrases[Math.floor(bot.rand() * phrases.length)]!;
      break;
    }
    case "kill": {
      const phrases = [
        "Target neutralized!",
        "Hostile down!",
        "Good kill!",
        "Threat eliminated!",
      ];
      text = phrases[Math.floor(bot.rand() * phrases.length)]!;
      break;
    }
  }

  if (game.hud.radioCallouts) {
    game.hud.radioCallouts.push({
      id: calloutId++,
      speaker: `${bot.actor.team.toUpperCase()}-${name}`,
      text,
      team: bot.actor.team,
      time,
    });
    if (game.hud.radioCallouts.length > 5) game.hud.radioCallouts.shift();
  }

  queueSound({ id: "radio-chirp", gain: 0.45 });
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

    _eye.set(position.x, position.y + HUMAN_METRICS.eyeHeight.stand, position.z);
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

      if (!this.findSpawnPoint(team, this.rand, _probe)) {
        // No clear ground anywhere in this team's zones; skip rather than
        // place a bot inside a building.
        continue;
      }
      addActor(actor);
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

        coverPosition: spawnZone.clone(),
        hasCover: false,
        coverNormal: new THREE.Vector3(0, 0, 1),
        peeking: false,
        peekTimer: 0,
        peekDuration: 0.8 + this.rand() * 0.6,
        peekSide: this.rand() > 0.5 ? 1 : -1,
        slideTimer: 0,
        isTacSprinting: false,
        suppressTarget: new THREE.Vector3(),
        suppressTimer: 0,
        lastCalloutTime: -99,
        flankedDetected: false,
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
        if (actor.respawnTimer <= 0) {
          const director = game.matchDirector as MatchDirector | null;
          if (director && director.rules.respawnDelay <= 0) continue;
          this.respawn(bot);
        }
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
    bot.hasCover = false;
    bot.peeking = false;
    bot.peekTimer = 0;
    bot.slideTimer = 0;
    bot.isTacSprinting = false;
    bot.flankedDetected = false;
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
      const fov = Math.cos((actor.suppression > 0.4 ? 0.72 : 1) * 0.96);
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
        // an eighth at the top, delayed while sprinting or suppressed.
        const baseReaction = THREE.MathUtils.lerp(0.48, 0.12, actor.skill);
        const sprintPenalty = bot.isTacSprinting ? 0.22 : 0;
        const suppressionPenalty = actor.suppression * 0.35;
        bot.reaction = baseReaction + sprintPenalty + suppressionPenalty;
        emitSquadCallout(bot, "contact", time);
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
    // Reaction timer recovers slower under heavy suppression
    bot.reaction = Math.max(0, bot.reaction - dt / (1 + actor.suppression * 1.5));

    if (bot.weapon.needsReload && bot.state !== "reload") {
      bot.weapon.beginReload();
      bot.state = "reload";
      bot.stateTimer = 0;
      if (bot.timeSinceSeen < 2.0) {
        emitSquadCallout(bot, "reloading", time);
      }
    }
    if (bot.state === "reload" && !bot.weapon.isReloading) {
      bot.state = bot.targetId !== null ? "engage" : "patrol";
      bot.stateTimer = 0;
    }

    const hasTarget = bot.targetId !== null && bot.timeSinceSeen < 0.5;

    // Being shot at from somewhere you cannot see is information. Turn toward
    // it and go looking, or slide into cover.
    if (
      !hasTarget &&
      time - actor.lastDamageTime < 0.35 &&
      actor.lastAttackerId !== null
    ) {
      const attacker = game.actorById.get(actor.lastAttackerId);
      if (attacker && attacker.team !== actor.team) {
        bot.lastKnown.copy(attacker.position);
        this.report(actor.team, attacker.id, attacker.position, time);
        if (bot.state !== "engage" && bot.state !== "slide" && bot.state !== "cover_peek") {
          // Slide or break into cover
          if (this.findTacticalCover(bot, attacker.position, bot.coverPosition, bot.coverNormal)) {
            this.initiateSlide(bot, bot.coverPosition, time);
          } else {
            bot.state = "investigate";
            bot.goal.copy(attacker.position);
            bot.stateTimer = 0;
          }
        }
      }
    }

    // Heavy suppression check: under heavy suppression and low HP, dive for cover!
    if (actor.suppression > 0.65 && actor.health < 65 && bot.state !== "slide" && bot.state !== "cover_peek") {
      emitSquadCallout(bot, "pinned", time);
      const threat = hasTarget ? bot.lastKnown : (actor.lastAttackerId ? game.actorById.get(actor.lastAttackerId)?.position ?? bot.lastKnown : bot.lastKnown);
      if (this.findTacticalCover(bot, threat, bot.coverPosition, bot.coverNormal)) {
        this.initiateSlide(bot, bot.coverPosition, time);
      }
    }

    // Flank detection: check if currently holding cover but enemy has flanked our position
    if (bot.state === "cover_peek" && hasTarget) {
      const threatDir = _probe.copy(bot.lastKnown).sub(actor.position).setY(0).normalize();
      const coverage = threatDir.dot(bot.coverNormal);
      const takingFlankDamage = time - actor.lastDamageTime < 0.3;

      if (coverage < 0.15 || (takingFlankDamage && actor.suppression > 0.4)) {
        // FLANKED! Break cover and evasively reposition
        emitSquadCallout(bot, "flanked", time);
        bot.flankedDetected = true;
        this.pickCoverGoal(bot, bot.lastKnown);
        this.initiateSlide(bot, bot.goal, time);
      }
    }

    switch (bot.state) {
      case "idle":
      case "patrol":
        bot.isTacSprinting = false;
        if (hasTarget) {
          bot.state = "engage";
          bot.stateTimer = 0;
        } else if (this.followTeamContact(bot, time)) {
          bot.stateTimer = 0;
          if (actor.position.distanceTo(bot.goal) > 22) {
            bot.isTacSprinting = true;
          }
        } else if (bot.actor.position.distanceTo(bot.goal) < 4 || bot.stateTimer > 22) {
          this.pickPatrolGoal(bot);
          bot.stateTimer = 0;
        }
        break;

      case "engage": {
        if (!hasTarget) {
          // If target broke LOS recently (< 2.8s), lay down suppressive fire!
          if (bot.timeSinceSeen < 2.8 && bot.rand() < 0.6) {
            bot.state = "suppress";
            bot.suppressTarget.copy(bot.lastKnown);
            bot.suppressTimer = 1.6 + bot.rand() * 1.2;
            bot.stateTimer = 0;
            emitSquadCallout(bot, "suppressing", time);
            break;
          }
          if (bot.timeSinceSeen < 6) {
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

        // Tactical cover assessment: seek cover node if under fire or available nearby
        if (actor.suppression > 0.35 && distance > 12 && bot.stateTimer > 0.8) {
          if (this.findTacticalCover(bot, target.position, bot.coverPosition, bot.coverNormal)) {
            this.initiateSlide(bot, bot.coverPosition, time);
            break;
          }
        }

        // Flanking decision: if another teammate is engaging, coordinate a flank
        if (distance > optimal * 0.9 && bot.stateTimer > 2.5 && bot.rand() < 0.03) {
          bot.state = "flank";
          _desired.copy(target.position).sub(actor.position).setY(0).normalize();
          _right.crossVectors(_desired, UP).normalize();
          const flankDir = bot.rand() > 0.5 ? 1 : -1;
          bot.goal.copy(target.position).addScaledVector(_right, flankDir * (14 + bot.rand() * 12)).addScaledVector(_desired, -8);
          bot.goal.y = this.world.groundAt(bot.goal.x, bot.goal.z);
          bot.isTacSprinting = true;
          bot.stateTimer = 0;
          emitSquadCallout(bot, "flanking", time);
          break;
        }

        if (distance > optimal * 1.6) {
          bot.goal.copy(target.position);
          bot.isTacSprinting = distance > 30;
        } else if (distance < optimal * 0.45) {
          // Back off along the line to the target.
          _desired.copy(actor.position).sub(target.position).setY(0).normalize();
          bot.goal.copy(actor.position).addScaledVector(_desired, 8);
        } else if (bot.stateTimer > 3.0 && bot.rand() < 0.03) {
          // Periodic strafe / combat slide
          _desired.copy(target.position).sub(actor.position).setY(0).normalize();
          _right.crossVectors(_desired, UP).normalize();
          const strafeDir = bot.rand() < 0.5 ? -1 : 1;
          bot.goal.copy(actor.position).addScaledVector(_right, strafeDir * (5 + bot.rand() * 4));
          bot.stateTimer = 0;
        }
        break;
      }

      case "cover_peek": {
        // Peeking state machine
        if (!hasTarget && bot.timeSinceSeen > 4.0) {
          bot.state = "investigate";
          bot.goal.copy(bot.lastKnown);
          bot.stateTimer = 0;
          break;
        }

        bot.peekTimer += dt;
        if (!bot.peeking) {
          // Tucked in crouched cover: recover suppression and plan peek
          actor.stance = "crouch";
          bot.goal.copy(bot.coverPosition);
          if (bot.peekTimer > bot.peekDuration) {
            // Initiate peek: step or lean out
            bot.peeking = true;
            bot.peekTimer = 0;
            bot.peekDuration = 0.5 + bot.rand() * 0.9;
            _right.crossVectors(bot.coverNormal, UP).normalize();
            bot.goal.copy(bot.coverPosition).addScaledVector(_right, bot.peekSide * 0.85);
          }
        } else {
          // In peek mode: aim & fire burst
          if (bot.peekTimer > bot.peekDuration || actor.suppression > 0.55 || time - actor.lastDamageTime < 0.2) {
            // Duck back into cover!
            bot.peeking = false;
            bot.peekTimer = 0;
            bot.peekDuration = 0.6 + bot.rand() * 1.0;
            bot.goal.copy(bot.coverPosition);
            bot.peekSide = -bot.peekSide; // alternate peek sides
          }
        }
        break;
      }

      case "slide": {
        bot.slideTimer -= dt;
        actor.stance = "crouch";
        if (bot.slideTimer <= 0 || actor.position.distanceTo(bot.goal) < 1.4) {
          bot.state = bot.hasCover ? "cover_peek" : (hasTarget ? "engage" : "investigate");
          bot.stateTimer = 0;
          bot.peeking = false;
          bot.peekTimer = 0;
        }
        break;
      }

      case "suppress": {
        bot.suppressTimer -= dt;
        actor.stance = "crouch";
        if (bot.suppressTimer <= 0 || hasTarget) {
          bot.state = hasTarget ? "engage" : "investigate";
          bot.goal.copy(bot.suppressTarget);
          bot.stateTimer = 0;
        }
        break;
      }

      case "flank": {
        if (hasTarget && actor.position.distanceTo(bot.goal) < 8) {
          bot.state = "engage";
          bot.stateTimer = 0;
          bot.isTacSprinting = false;
        } else if (bot.stateTimer > 8.0) {
          bot.state = "investigate";
          bot.goal.copy(bot.lastKnown);
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

    // Stance update: crouch when suppressed, peeking-tucked, or holding cover
    const wantsCrouch =
      bot.state === "slide" ||
      (bot.state === "cover_peek" && !bot.peeking) ||
      (bot.state === "engage" && actor.suppression > 0.35) ||
      (bot.state === "suppress") ||
      (bot.state === "engage" &&
        actor.position.distanceTo(bot.goal) < 1.5 &&
        bot.rand() < 0.4);
    actor.stance = wantsCrouch ? "crouch" : "stand";
  }

  /** Trigger a tactical combat slide into cover */
  private initiateSlide(bot: Bot, destination: THREE.Vector3, time: number): void {
    bot.state = "slide";
    bot.slideTimer = 0.75;
    bot.hasCover = true;
    bot.goal.copy(destination);
    bot.actor.stance = "crouch";
    bot.actor.state = "slide";
    // Forward impulse
    _desired.copy(destination).sub(bot.actor.position).setY(0).normalize();
    bot.actor.velocity.x += _desired.x * 3.5;
    bot.actor.velocity.z += _desired.z * 3.5;
    queueSound({ id: "slide", position: bot.actor.position.clone(), gain: 0.65 });
    emitSquadCallout(bot, "moving_cover", time);
  }

  /** Find a viable cover position with LOS blocked against the threat */
  private findTacticalCover(
    bot: Bot,
    threatPos: THREE.Vector3,
    outCover: THREE.Vector3,
    outNormal: THREE.Vector3,
  ): boolean {
    const actor = bot.actor;
    let bestScore = -Infinity;
    let found = false;

    _targetEye.copy(threatPos).setY(threatPos.y + 1.4);

    for (let i = 0; i < 14; i += 1) {
      const angle = (i / 14) * Math.PI * 2 + (bot.rand() - 0.5) * 0.4;
      const dist = 3.5 + bot.rand() * 11;
      const x = actor.position.x + Math.cos(angle) * dist;
      const z = actor.position.z + Math.sin(angle) * dist;
      const y = this.world.groundAt(x, z);

      _probe.set(x, y + HUMAN_METRICS.eyeHeight.crouch, z);
      if (!this.world.isPositionFree(_probe, HUMAN_METRICS.radius, HUMAN_METRICS.colliderHeight.crouch)) {
        continue;
      }

      // Check crouched cover
      const blocksSight = !this.world.hasLineOfSight(_probe, _targetEye, MASK_SIGHT);
      if (!blocksSight) continue;

      // Score cover position: proximity, safety, line to threat
      const dThreat = Math.hypot(x - threatPos.x, z - threatPos.z);
      const score = 30 - dist + (dThreat > 10 ? 10 : 0);

      if (score > bestScore) {
        bestScore = score;
        outCover.set(x, y, z);
        outNormal.copy(threatPos).sub(outCover).setY(0).normalize();
        found = true;
      }
    }
    return found;
  }

  /**
   * Move on the team's most recent contact, offset laterally so a squad
   * arrives spread out rather than in single file.
   */
  private followTeamContact(bot: Bot, time: number): boolean {
    const contact = this.currentContact(bot.actor.team, time);
    if (!contact || contact.time <= bot.actedOnContact) return false;
    const distance = bot.actor.position.distanceTo(contact.position);
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
    if (this.findSpawnPoint(bot.actor.team, bot.rand, _probe)) {
      bot.goal.copy(_probe);
    }
  }

  private pickCoverGoal(bot: Bot, threat: THREE.Vector3): void {
    eyePosition(bot.actor, _eye);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const angle = bot.rand() * Math.PI * 2;
      const radius = 5 + bot.rand() * 11;
      const x = bot.actor.position.x + Math.cos(angle) * radius;
      const z = bot.actor.position.z + Math.sin(angle) * radius;
      _probe.set(x, this.world.groundAt(x, z) + HUMAN_METRICS.eyeHeight.crouch, z);
      if (!this.world.hasLineOfSight(_probe, threat, MASK_SIGHT)) {
        bot.goal.set(x, _probe.y, z);
        return;
      }
    }
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
    if (distance > 0.8) {
      _desired.multiplyScalar(1 / distance);
      const engaging = bot.state === "engage" || bot.state === "suppress";

      if (bot.state === "slide") {
        // Rapid sliding speed, decaying
        speed = 6.4 * Math.max(0.3, bot.slideTimer / 0.75);
      } else if (bot.isTacSprinting || distance > 28) {
        // Tactical sprint speed
        speed = 6.8 + actor.skill * 0.6;
      } else if (actor.stance === "crouch") {
        speed = 1.95;
      } else if (engaging) {
        speed = 3.5;
      } else {
        speed = 4.2;
      }

      // Whisker avoidance: probe ahead and to both sides at chest height and
      // steer away from whatever is closest.
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

    if (result.hitWall && actor.speed < 0.6 && bot.state !== "engage" && bot.state !== "cover_peek") {
      if (bot.rand() < 0.05) this.pickPatrolGoal(bot);
    }

    actor.state = !result.grounded
      ? "fall"
      : bot.state === "slide"
        ? "slide"
        : actor.speed < 0.3
          ? "idle"
          : actor.speed > 5.5
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
    const isEngaging = (bot.state === "engage" || (bot.state === "cover_peek" && bot.peeking)) && target && target.alive && bot.timeSinceSeen < 0.5;
    const isSuppressing = bot.state === "suppress";

    if (isEngaging && target) {
      eyePosition(actor, _eye);
      eyePosition(target, _targetEye);

      // Lead the target by its own velocity over the round's flight time.
      const distance = _eye.distanceTo(_targetEye);
      const flight = distance / Math.max(80, bot.weapon.def.ballistics.muzzleVelocity);
      _lead
        .copy(target.velocity)
        .multiplyScalar(flight * THREE.MathUtils.lerp(0.2, 1, actor.skill));
      _aim.copy(_targetEye).add(_lead).sub(_eye).normalize();

      // Suppression mechanics: aim error cone widens significantly when taking heavy fire / near misses
      const baseError = THREE.MathUtils.lerp(5.5, 0.55, actor.skill);
      const converge = Math.exp(-bot.timeOnTarget * (0.9 + actor.skill * 1.6));
      const suppressionMultiplier = 1 + actor.suppression * 2.8;
      const errorDeg = baseError * (0.35 + 0.65 * converge) * suppressionMultiplier;
      bot.aimNoisePhase += dt * (3.1 + actor.suppression * 4.2);
      const errorRad = (errorDeg * Math.PI) / 180;
      _right.crossVectors(_aim, UP).normalize();
      _aim
        .addScaledVector(_right, Math.sin(bot.aimNoisePhase * 1.7) * errorRad)
        .addScaledVector(UP, Math.sin(bot.aimNoisePhase * 1.1 + 2) * errorRad * 0.7)
        .normalize();

      // Turn toward aim with suppression dampening
      const wantYaw = forwardToYaw(_aim.x, _aim.z);
      const wantPitch = Math.asin(THREE.MathUtils.clamp(_aim.y, -1, 1));
      const turnSpeed = THREE.MathUtils.lerp(5, 13, actor.skill) / (1 + actor.suppression * 0.6);
      const turn = turnSpeed * dt;
      const deltaYaw = yawDelta(actor.yaw, wantYaw);
      actor.yaw += THREE.MathUtils.clamp(deltaYaw, -turn, turn);
      actor.pitch += THREE.MathUtils.clamp(wantPitch - actor.pitch, -turn, turn);
      yawToForward(actor.yaw, actor.aimDir, actor.pitch);

      // Burst discipline: fire a class-appropriate burst, then pause.
      bot.burstPause = Math.max(0, bot.burstPause - dt);
      const aimedEnough = Math.abs(deltaYaw) < 0.24;
      if (bot.reaction <= 0 && aimedEnough && bot.burstPause <= 0) {
        if (bot.burst <= 0) {
          bot.burst = this.burstSize(bot, distance);
        }
        wantsFire = true;
      }
    } else if (isSuppressing) {
      // Lay down suppressive fire on target's last known position / corner
      eyePosition(actor, _eye);
      _targetEye.copy(bot.suppressTarget).setY(bot.suppressTarget.y + 1.2);
      _aim.copy(_targetEye).sub(_eye).normalize();
      bot.aimNoisePhase += dt * 4.5;
      const errorRad = 0.08 + actor.suppression * 0.06;
      _right.crossVectors(_aim, UP).normalize();
      _aim
        .addScaledVector(_right, Math.sin(bot.aimNoisePhase * 2.0) * errorRad)
        .addScaledVector(UP, Math.sin(bot.aimNoisePhase * 1.5) * errorRad * 0.5)
        .normalize();

      const wantYaw = forwardToYaw(_aim.x, _aim.z);
      const wantPitch = Math.asin(THREE.MathUtils.clamp(_aim.y, -1, 1));
      const deltaYaw = yawDelta(actor.yaw, wantYaw);
      actor.yaw += THREE.MathUtils.clamp(deltaYaw, -8 * dt, 8 * dt);
      actor.pitch += THREE.MathUtils.clamp(wantPitch - actor.pitch, -8 * dt, 8 * dt);
      yawToForward(actor.yaw, actor.aimDir, actor.pitch);

      bot.burstPause = Math.max(0, bot.burstPause - dt);
      if (bot.burstPause <= 0) {
        if (bot.burst <= 0) {
          bot.burst = bot.weapon.def.weaponClass === "lmg" ? 12 : 7;
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
      wantsAds: isEngaging || isSuppressing,
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
        accuracy: 1,
      });
      actor.lastFireTime = time;
      _shotEnd.copy(_eye).addScaledVector(actor.aimDir, 200);
      applyNearMissSuppression(_eye, _shotEnd, actor.team);
      bot.burst -= 1;
      if (bot.burst <= 0) {
        bot.burstPause =
          THREE.MathUtils.lerp(0.72, 0.2, actor.skill) * (0.7 + bot.rand() * 0.6);
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
        return long ? 8 : 14;
      case "smg":
        return long ? 4 : 9;
      default:
        return long ? 4 : 7;
    }
  }

  dispose(): void {
    for (const bot of this.bots) {
      removeActor(bot.actor.id);
    }
    this.bots.length = 0;
    this.contacts.blue = null;
    this.contacts.red = null;
  }
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}
