import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import { GROUND_ZONES, type GroundZone } from "@/lib/layout";
import {
  HUMAN_METRICS,
  MASK_SIGHT,
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
import {
  applyNearMissSuppression,
  areHostile,
  freeForAllActive,
  hostileTo,
  respawnActor,
  seat,
} from "../core/combat";
import { TEAM_HOME_SIDE } from "../modes/spawns";
import { mirageOffset } from "../world/mirage";

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
 *
 * ## Why they do not run at you across the apron
 *
 * The compound is a few large buildings standing on open lakebed, so the
 * ground between them is where a fight is decided by who stood still. A bot
 * that is out of its own weapon's range and in sight of the enemy it wants to
 * close on does not sprint straight at it: it *bounds* — picks a point nearer
 * the threat that the threat cannot see, sprints to it, and looks again from
 * there. Where there is no such point it breaks sight instead of walking into
 * the open. Close in, where its weapon works, it fights as before.
 *
 * This was measured, not assumed. Before it, a scripted policy that held one
 * spot and aimed down the sights went 161 kills to 0 deaths over three
 * two-minute matches, without moving a metre — the same strategy the live
 * model had found. See docs/JEV_BLACKSITE.md, "The marksman exploit".
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
/**
 * No spawn inside an enemy's sight line out to the full sight range. At 90 m a
 * returning bot could appear in the open, in plain view of a rifle that kills
 * at 100 m with one round — which is what a stationary marksman farmed.
 */
const SPAWN_SIGHT_CLEARANCE = SIGHT_RANGE;
/** How long a reported contact is worth acting on. */
const CONTACT_TTL = 9;

/**
 * Slack a bot gives when its target is the player. Bot-on-bot fights keep the
 * full numbers so the match around you still resolves at the same pace; the
 * player gets a longer window before the first round, an aim cone that never
 * closes as tightly, and longer gaps between bursts to move in.
 */
const PLAYER_MERCY = {
  /** Seconds added to the reaction delay on acquiring the player. */
  reaction: 0.4,
  /** Multiplier on the aim-error cone. */
  aimError: 2,
  /** Fraction of the cone left after full convergence (bot targets: 0.35). */
  convergedFloor: 0.6,
  /** Aim wander never drops below this many metres at the target. */
  minMissM: 0.35,
  /**
   * Aim point as a fraction of eye height. Centred on the eye, every upward
   * wander of the cone is a headshot; this puts it on the chest.
   */
  aimHeight: 0.74,
  /** Multiplier on the pause between bursts. */
  burstPause: 1.7,
  /** Target-selection bias toward the player over a nearer bot. */
  priority: 35,
  /** Multiplier on the settled miss radius when the target is the player. */
  settledMiss: 1.3,
} as const;

/**
 * A still target in the open gets found. A bot that is itself steady and has
 * held a target that has not moved for a while stops aiming with an angular
 * cone — whose size in metres grows with range, so that at 100 m no bot could
 * ever hit anyone — and converges to a miss radius in metres at the target
 * instead. Moving targets keep the angular model, so moving is what protects
 * you at range, as it should be. The same rule applies whoever the target is;
 * the player keeps a larger radius (`PLAYER_MERCY.settledMiss`).
 *
 * Measured, not assumed: before it, a scripted marksman standing on the apron
 * took 0 damage in six minutes while every one of its victims could see it.
 */
/** Beyond this, a bot with nowhere hidden to bound to holds instead of charging. */
const HOLD_BEYOND_M = 60;

const SETTLED_AIM = {
  /** Seconds the target must have been nearly still. */
  targetStillS: 1.5,
  /** The target counts as still below this speed, m/s. */
  stillSpeed: 0.6,
  /** The shooter must be moving slower than this, m/s. */
  selfSpeed: 1.2,
  /** And must have held the target this long. */
  holdS: 1,
  /** Converged miss radius at the target, metres: at skill 0 and at skill 1. */
  missM: [1.3, 0.35] as const,
} as const;

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
  | "bound"
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
  /** Game time of the last check that the way ahead is in an enemy's sight. */
  exposureCheckAt: number;
  /** Seconds the current target has been nearly still. */
  targetStillS: number;
  /** Engaging from where it stands: out of range, in the open, nowhere to bound. */
  holding: boolean;
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

export function emitSquadCallout(bot: Bot, type: SquadCalloutType, time: number): void {
  if (
    time - CALLOUT_COOLDOWNS[bot.actor.team] < 2.0 ||
    time - bot.lastCalloutTime < 4.2
  ) {
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
      const phrases = ["I'm pinned down!", "Taking heavy fire!", "Need covering fire!"];
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

  // The callout is kept as data; the HUD no longer prints squad chatter, and a
  // chirp with nothing to read after it is only noise.
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
    const preferred = TEAM_HOME_SIDE[team];
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
  private findSpawnPoint(
    team: Team,
    rand: () => number,
    out: THREE.Vector3,
    selfId: EntityId | null = null,
  ): boolean {
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
      const score = this.scoreSpawn(_spawn, team, selfId);
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
  private scoreSpawn(
    position: THREE.Vector3,
    team: Team,
    selfId: EntityId | null,
  ): number {
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
      if (!other.alive || !hostileTo(team, selfId, other)) continue;
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

      if (!this.findSpawnPoint(team, this.rand, _probe, id)) {
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
        exposureCheckAt: -99,
        targetStillS: 0,
        holding: false,
      });
    }
  }

  /* ---------------------------------------------------------------- */

  update(dt: number, time: number): void {
    this.frame += 1;
    for (const bot of this.bots) {
      const actor = bot.actor;
      if (!actor.alive) {
        if (bot.state !== "dead") this.onBotDown(actor, time);
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

  /**
   * A teammate going down gives away where the round came from: the squad
   * treats the killer's position as a contact, as it would a shot it heard.
   * Without it, a shooter at range could drop one bot after another while the
   * rest kept fighting whatever they were fighting.
   */
  private onBotDown(actor: Actor, time: number): void {
    const killer =
      actor.lastAttackerId !== null ? game.actorById.get(actor.lastAttackerId) : null;
    if (!killer || !killer.alive || !areHostile(actor, killer)) return;
    this.report(actor.team, killer.id, killer.position, time);
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
    if (!this.findSpawnPoint(bot.actor.team, bot.rand, _probe, bot.actor.id)) return;
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
    bot.exposureCheckAt = -99;
    this.pickPatrolGoal(bot);
  }

  /* ---------------------------------------------------------------- */
  /* Perception                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Share a sighting with the rest of the team. A free-for-all has no team to
   * tell: every other body is an enemy, so a sighting stays with whoever made
   * it.
   */
  private report(team: Team, targetId: EntityId, at: THREE.Vector3, time: number): void {
    if (freeForAllActive()) return;
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
    eyePosition(actor, _eye);

    let bestId: number | null = null;
    let bestScore = -Infinity;
    let heardId: number | null = null;
    let heardDistance = Infinity;

    for (const other of game.actors) {
      if (!other.alive || !areHostile(actor, other)) continue;
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
      // Anything very close is noticed regardless of where they are looking —
      // and so is anyone shooting within sight: a report and a muzzle flash
      // turn heads. Without this a shooter at range could drop a squad one by
      // one while every bot facing away kept its back turned.
      if (facing < fov && distance > 6 && !firing) continue;

      eyePosition(other, _targetEye);
      if (!this.world.hasLineOfSight(_eye, _targetEye, MASK_SIGHT, other.id)) continue;

      // Prefer close targets, ones near the centre of view, and ones shooting.
      let score = 140 - distance + facing * 40;
      if (firing) score += 45;
      // The player is the reason the match exists. A bot that can see them and
      // picks a bot four metres closer turns the match into a spectator sport.
      if (other.isPlayer) score += PLAYER_MERCY.priority;
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
        bot.targetStillS = 0;
        // Reaction time: human-like reaction window giving the player tactical initiative
        const baseReaction = THREE.MathUtils.lerp(0.55, 0.22, actor.skill);
        const sprintPenalty = bot.isTacSprinting ? 0.25 : 0;
        const suppressionPenalty = actor.suppression * 0.45;
        const playerBonus =
          target.isPlayer && seat.rules === "mercy" ? PLAYER_MERCY.reaction : 0;
        bot.reaction = baseReaction + sprintPenalty + suppressionPenalty + playerBonus;
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
      if (attacker && areHostile(actor, attacker)) {
        bot.lastKnown.copy(attacker.position);
        this.report(actor.team, attacker.id, attacker.position, time);
        if (
          bot.state !== "engage" &&
          bot.state !== "slide" &&
          bot.state !== "cover_peek"
        ) {
          // Slide or break into cover
          if (
            this.findTacticalCover(
              bot,
              attacker.position,
              bot.coverPosition,
              bot.coverNormal,
            )
          ) {
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
    if (
      actor.suppression > 0.65 &&
      actor.health < 65 &&
      bot.state !== "slide" &&
      bot.state !== "cover_peek"
    ) {
      emitSquadCallout(bot, "pinned", time);
      const threat = hasTarget
        ? bot.lastKnown
        : actor.lastAttackerId
          ? (game.actorById.get(actor.lastAttackerId)?.position ?? bot.lastKnown)
          : bot.lastKnown;
      if (this.findTacticalCover(bot, threat, bot.coverPosition, bot.coverNormal)) {
        this.initiateSlide(bot, bot.coverPosition, time);
      }
    }

    // Flank detection: check if currently holding cover but enemy has flanked our position
    if (bot.state === "cover_peek" && hasTarget) {
      const threatDir = _probe
        .copy(bot.lastKnown)
        .sub(actor.position)
        .setY(0)
        .normalize();
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
          if (
            this.findTacticalCover(
              bot,
              target.position,
              bot.coverPosition,
              bot.coverNormal,
            )
          ) {
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
          bot.goal
            .copy(target.position)
            .addScaledVector(_right, flankDir * (14 + bot.rand() * 12))
            .addScaledVector(_desired, -8);
          bot.goal.y = this.world.groundAt(bot.goal.x, bot.goal.z);
          bot.isTacSprinting = true;
          bot.stateTimer = 0;
          emitSquadCallout(bot, "flanking", time);
          break;
        }

        bot.holding = false;
        if (distance > optimal * 1.6) {
          // Out of range and in the target's sight: bound, do not charge. The
          // search is throttled — it costs a few dozen raycasts.
          if (time - bot.exposureCheckAt > 1) {
            bot.exposureCheckAt = time;
            if (this.beginBound(bot, target.position, time)) break;
            // Nothing nearer is hidden from it. Far out, get out of its sight
            // rather than walk into the open; nearer, close the distance.
            if (
              distance > optimal * 2.5 &&
              this.findTacticalCover(
                bot,
                target.position,
                bot.coverPosition,
                bot.coverNormal,
              )
            ) {
              this.initiateSlide(bot, bot.coverPosition, time);
              break;
            }
          }
          if (distance > HOLD_BEYOND_M) {
            // Far out, in the open, nowhere hidden to go: running at the
            // target is how bots died by the dozen. Hold still, get low and
            // shoot back — a steady shooter aims better at a still target
            // (SETTLED_AIM), so this is a duel, not a gallery.
            bot.goal.copy(actor.position);
            bot.isTacSprinting = false;
            bot.holding = true;
          } else {
            bot.goal.copy(target.position);
            bot.isTacSprinting = distance > 30;
          }
        } else if (distance < optimal * 0.45) {
          // Back off along the line to the target.
          _desired.copy(actor.position).sub(target.position).setY(0).normalize();
          bot.goal.copy(actor.position).addScaledVector(_desired, 8);
        } else if (bot.stateTimer > 3.0 && bot.rand() < 0.03) {
          // Periodic strafe / combat slide
          _desired.copy(target.position).sub(actor.position).setY(0).normalize();
          _right.crossVectors(_desired, UP).normalize();
          const strafeDir = bot.rand() < 0.5 ? -1 : 1;
          bot.goal
            .copy(actor.position)
            .addScaledVector(_right, strafeDir * (5 + bot.rand() * 4));
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
        if (
          !bot.peeking &&
          bot.peekTimer > bot.peekDuration &&
          actor.position.distanceTo(bot.lastKnown) > this.optimalRange(bot) * 1.6 &&
          bot.rand() < 0.5 &&
          this.beginBound(bot, bot.lastKnown, time)
        ) {
          break;
        }
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
          if (
            bot.peekTimer > bot.peekDuration ||
            actor.suppression > 0.55 ||
            time - actor.lastDamageTime < 0.2
          ) {
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
          bot.state = bot.hasCover ? "cover_peek" : hasTarget ? "engage" : "investigate";
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

      case "bound":
        if (actor.position.distanceTo(bot.goal) < 1.6 || bot.stateTimer > 7) {
          // Arrived behind something the threat cannot see through: hold it,
          // and look again from there.
          bot.isTacSprinting = false;
          bot.state = "cover_peek";
          bot.peeking = false;
          bot.peekTimer = 0;
          bot.stateTimer = 0;
        }
        break;

      case "investigate":
        if (hasTarget) {
          bot.state = "engage";
          bot.stateTimer = 0;
        } else if (
          time - bot.exposureCheckAt > 1.2 &&
          actor.position.distanceTo(bot.goal) > 40
        ) {
          // Walking toward where an enemy was: if that spot can see this bot,
          // so could whoever is there. Bound instead of strolling in.
          bot.exposureCheckAt = time;
          if (this.exposedTo(actor, bot.goal)) this.beginBound(bot, bot.goal, time);
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
    if (bot.state !== "engage") bot.holding = false;
    // Some bots fight from a crouch when they stop, some standing: a fixed
    // trait per bot. It used to be re-rolled every frame, which made a
    // stopped bot's head bob between two heights sixty times a second.
    const crouchesWhenStopped = bot.flank > 0;
    const wantsCrouch =
      bot.state === "slide" ||
      (bot.state === "cover_peek" && !bot.peeking) ||
      (bot.state === "engage" && actor.suppression > 0.35) ||
      bot.state === "suppress" ||
      (bot.state === "engage" && bot.holding) ||
      (bot.state === "engage" &&
        actor.position.distanceTo(bot.goal) < 1.5 &&
        crouchesWhenStopped);
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
      if (
        !this.world.isPositionFree(
          _probe,
          HUMAN_METRICS.radius,
          HUMAN_METRICS.colliderHeight.crouch,
        )
      ) {
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

  /** A standing eye at `point` can see this actor's chest. */
  private exposedTo(actor: Actor, point: THREE.Vector3): boolean {
    _targetEye.set(point.x, point.y + HUMAN_METRICS.eyeHeight.stand, point.z);
    _probe.set(
      actor.position.x,
      actor.position.y + HUMAN_METRICS.eyeHeight[actor.stance] - 0.35,
      actor.position.z,
    );
    return this.world.hasLineOfSight(_targetEye, _probe, MASK_SIGHT, actor.id);
  }

  /**
   * Start a bound toward `threat`: a sprint to a nearer point that a standing
   * eye at the threat cannot see, reachable in a straight line. Returns false
   * — and changes nothing — when no such point is within reach, which on the
   * open lakebed is often.
   */
  private beginBound(bot: Bot, threat: THREE.Vector3, time: number): boolean {
    const actor = bot.actor;
    const toThreat = _desired.copy(threat).sub(actor.position).setY(0);
    const range = toThreat.length();
    if (range < 12) return false;
    toThreat.multiplyScalar(1 / range);
    const heading = Math.atan2(toThreat.z, toThreat.x);
    _targetEye.set(threat.x, threat.y + HUMAN_METRICS.eyeHeight.stand, threat.z);

    let bestScore = -Infinity;
    for (let i = 0; i < 18; i += 1) {
      const angle = heading + (bot.rand() - 0.5) * 2.8;
      const reach = 6 + bot.rand() * 20;
      const x = actor.position.x + Math.cos(angle) * reach;
      const z = actor.position.z + Math.sin(angle) * reach;
      const progress = range - Math.hypot(threat.x - x, threat.z - z);
      if (progress < 2) continue;
      const y = this.world.groundAt(x, z);
      _spawn.set(x, y, z);
      if (
        !this.world.isPositionFree(
          _spawn,
          HUMAN_METRICS.radius,
          HUMAN_METRICS.colliderHeight.crouch,
        )
      ) {
        continue;
      }
      // Hidden from the threat, crouched.
      _probe.set(x, y + HUMAN_METRICS.eyeHeight.crouch, z);
      if (this.world.hasLineOfSight(_targetEye, _probe, MASK_SIGHT)) continue;
      // Reachable without running into the thing that hides it.
      _shotEnd.set(x - actor.position.x, 0, z - actor.position.z).normalize();
      _lead.set(actor.position.x, actor.position.y + 0.9, actor.position.z);
      const blocked = this.world.raycast(
        _lead,
        _shotEnd,
        reach - 0.8,
        MASK_SIGHT,
        actor.id,
      );
      if (blocked) continue;
      // A bound is a sprint through the open: prefer the ones the threat sees
      // least of. Two points along the way, at chest height.
      let seen = 0;
      for (const t of [0.35, 0.7]) {
        _probe.set(
          actor.position.x + (x - actor.position.x) * t,
          actor.position.y + 1.2,
          actor.position.z + (z - actor.position.z) * t,
        );
        if (this.world.hasLineOfSight(_targetEye, _probe, MASK_SIGHT)) seen += 1;
      }
      const score = progress - reach * 0.3 - (seen / 2) * reach * 0.6;
      if (score > bestScore) {
        bestScore = score;
        bot.coverPosition.set(x, y, z);
      }
    }
    if (bestScore === -Infinity) return false;
    bot.coverNormal.copy(threat).sub(bot.coverPosition).setY(0).normalize();
    bot.hasCover = true;
    bot.goal.copy(bot.coverPosition);
    bot.state = "bound";
    bot.isTacSprinting = true;
    bot.stateTimer = 0;
    emitSquadCallout(bot, "moving_cover", time);
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
    if (this.findSpawnPoint(bot.actor.team, bot.rand, _probe, bot.actor.id)) {
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
        if (other.id === actor.id || !other.alive || areHostile(actor, other)) continue;
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

    if (
      result.hitWall &&
      actor.speed < 0.6 &&
      bot.state !== "engage" &&
      bot.state !== "cover_peek"
    ) {
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
    const isEngaging =
      (bot.state === "engage" || (bot.state === "cover_peek" && bot.peeking)) &&
      target &&
      target.alive &&
      bot.timeSinceSeen < 0.5;
    const isSuppressing = bot.state === "suppress";

    if (isEngaging && target) {
      // Mercy is a seat rule, not a property of the player: under `?seat=even`
      // the player is aimed at exactly as a bot would be.
      const vsPlayer = target.isPlayer && seat.rules === "mercy";
      eyePosition(actor, _eye);
      eyePosition(target, _targetEye);
      if (vsPlayer) {
        _targetEye.y = THREE.MathUtils.lerp(
          target.position.y,
          _targetEye.y,
          PLAYER_MERCY.aimHeight,
        );
      }

      // Aim at the body as this bot sees it: displaced by the heat shimmer
      // at range, by the same rule that displaces it for every other seat.
      _targetEye.add(mirageOffset(_eye, target.position, target.id, time, _lead));

      // Lead the target by its own velocity over the round's flight time.
      const distance = _eye.distanceTo(_targetEye);
      const flight = distance / Math.max(80, bot.weapon.def.ballistics.muzzleVelocity);
      _lead
        .copy(target.velocity)
        .multiplyScalar(flight * THREE.MathUtils.lerp(0.2, 1, actor.skill));
      _aim.copy(_targetEye).add(_lead).sub(_eye).normalize();

      // Suppression mechanics: aim error cone widens significantly when taking heavy fire / near misses
      const baseError =
        THREE.MathUtils.lerp(5.5, 0.55, actor.skill) *
        (vsPlayer ? PLAYER_MERCY.aimError : 1);
      const floor = vsPlayer ? PLAYER_MERCY.convergedFloor : 0.35;
      const converge = Math.exp(-bot.timeOnTarget * (0.9 + actor.skill * 1.6));
      const suppressionMultiplier = 1 + actor.suppression * 2.8;
      const errorDeg =
        baseError * (floor + (1 - floor) * converge) * suppressionMultiplier;
      bot.aimNoisePhase += dt * (3.1 + actor.suppression * 4.2);
      // An angular cone shrinks to nothing in metres up close, which is where
      // bots end up against a player who stays put.
      let errorRad = Math.max(
        (errorDeg * Math.PI) / 180,
        vsPlayer ? PLAYER_MERCY.minMissM / Math.max(1, distance) : 0,
      );
      bot.targetStillS =
        target.speed < SETTLED_AIM.stillSpeed ? bot.targetStillS + dt : 0;
      if (
        bot.targetStillS > SETTLED_AIM.targetStillS &&
        actor.speed < SETTLED_AIM.selfSpeed &&
        bot.timeOnTarget > SETTLED_AIM.holdS
      ) {
        const missM =
          THREE.MathUtils.lerp(SETTLED_AIM.missM[0], SETTLED_AIM.missM[1], actor.skill) *
          (vsPlayer ? PLAYER_MERCY.settledMiss : 1) *
          (1 + actor.suppression * 1.5);
        errorRad = Math.min(errorRad, missM / Math.max(1, distance));
      }
      _right.crossVectors(_aim, UP).normalize();
      _aim
        .addScaledVector(_right, Math.sin(bot.aimNoisePhase * 1.7) * errorRad)
        .addScaledVector(UP, Math.sin(bot.aimNoisePhase * 1.1 + 2) * errorRad * 0.7)
        .normalize();

      // Turn toward aim with suppression dampening
      const wantYaw = forwardToYaw(_aim.x, _aim.z);
      const wantPitch = Math.asin(THREE.MathUtils.clamp(_aim.y, -1, 1));
      const turnSpeed =
        THREE.MathUtils.lerp(5, 13, actor.skill) / (1 + actor.suppression * 0.6);
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
      applyNearMissSuppression(_eye, _shotEnd, actor);
      bot.burst -= 1;
      if (bot.burst <= 0) {
        bot.burstPause =
          THREE.MathUtils.lerp(0.72, 0.2, actor.skill) *
          (0.7 + bot.rand() * 0.6) *
          (target?.isPlayer && seat.rules === "mercy" ? PLAYER_MERCY.burstPause : 1);
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
