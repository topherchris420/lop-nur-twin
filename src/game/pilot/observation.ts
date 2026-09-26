import {
  ACTION_CONTRACT_VERSION,
  AXES,
  AXIS_ACTIONS,
  OBSERVATION_SCHEMA_VERSION,
  PITCH_LIMIT_DEG,
  isAxisAction,
  type Axis,
  type ControlFrame,
  type MoveAction,
  type TiltAction,
  type TurnAction,
  type WeaponAction,
} from "./contract.js";

/**
 * What a brain is allowed to know, and the validator that enforces it.
 *
 * The observation is deliberately small, numeric and closed. Every string in it
 * comes from a fixed vocabulary and every number is bounded, so the server can
 * reject anything else outright — which is what stops `/api/jev/decision` from
 * being a general-purpose prompt proxy. There is no free text anywhere in it.
 *
 * It describes what the player could perceive and what the HUD shows, not the
 * simulation's internals:
 *
 *  - **Visible enemies** need an unobstructed sight line and must be inside the
 *    view cone — the same rules the bots perceive by, measured from the eye.
 *  - **Contacts** are the awareness the game already gives a human: gunfire
 *    pings on the radar and compass, and where an enemy was last *seen*. A
 *    contact's position is where it was heard or seen, never where it is now.
 *  - **Damage** is the direction indicator the HUD draws.
 *
 * Angles are relative to the crosshair: bearing is clockwise-positive (right),
 * elevation up-positive. Absolute coordinates are withheld — a brain needs to
 * know where things are relative to its view, not where they are in the model.
 */

export const GAME_MODES = ["tdm", "domination", "ffa", "hardpoint", "gunfight"] as const;
export const MATCH_PHASES = ["warmup", "live", "overtime", "post"] as const;
export const TEAMS = ["blue", "red"] as const;
export const STANCES = ["stand", "crouch", "prone"] as const;
export const MOTIONS = [
  "still",
  "walking",
  "running",
  "sprinting",
  "sliding",
  "airborne",
  "climbing",
] as const;
export const WEAPON_SLOTS = ["primary", "secondary"] as const;
export const WEAPON_CLASSES = [
  "assault",
  "smg",
  "lmg",
  "marksman",
  "sniper",
  "shotgun",
  "pistol",
  "launcher",
  "melee",
] as const;
export const FIRE_MODES = ["auto", "semi", "burst", "bolt", "pump"] as const;
export const CONTACT_SOURCES = ["gunfire", "last_seen"] as const;
export const OBJECTIVE_KINDS = ["none", "zone", "hardpoint"] as const;
export const OBJECTIVE_STATES = ["neutral", "friendly", "enemy", "contested"] as const;

/** Caps, so the state a brain reads (and the request the server accepts) stays small. */
export const MAX_VISIBLE_ENEMIES = 4;
export const MAX_CONTACTS = 3;
/** Probes report obstacles out to this range; beyond it a direction is "clear". */
export const OBSTACLE_PROBE_M = 8;
/** Enemies further than this are not reported as visible (the bots' sight range). */
export const SIGHT_RANGE_M = 165;

export type GameModeName = (typeof GAME_MODES)[number];
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export interface VisibleEnemy {
  /** Degrees from the crosshair, clockwise-positive. */
  bearingDeg: number;
  /** Degrees above (+) or below (−) the crosshair. */
  elevationDeg: number;
  distanceM: number;
  /** The crosshair ray currently resolves to this enemy's hitboxes. */
  onCrosshair: boolean;
  /** Muzzle flash seen in the last second. */
  firing: boolean;
}

export interface Contact {
  source: ContactSource;
  /** Bearing of the *remembered* position, relative to the current crosshair. */
  bearingDeg: number;
  distanceM: number;
  ageS: number;
}

export interface PreviousOutcome {
  shotsFired: number;
  /** The HUD showed a hitmarker during the frame. */
  hitConfirmed: boolean;
  killConfirmed: boolean;
  damageTaken: boolean;
  /** Movement was requested but the body barely moved. */
  movementBlocked: boolean;
}

export interface LegalActions {
  move: MoveAction[];
  turn: TurnAction[];
  tilt: TiltAction[];
  weapon: WeaponAction[];
}

export interface JevObservation {
  schemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
  actionContract: typeof ACTION_CONTRACT_VERSION;
  sequence: number;
  match: {
    mode: GameModeName;
    phase: (typeof MATCH_PHASES)[number];
    timeRemainingS: number;
    team: (typeof TEAMS)[number];
    ownScore: number;
    enemyScore: number;
  };
  player: {
    alive: boolean;
    health: number;
    /** Compass heading of the view, 0 = north, clockwise. */
    headingDeg: number;
    pitchDeg: number;
    speedMps: number;
    stance: (typeof STANCES)[number];
    motion: (typeof MOTIONS)[number];
    grounded: boolean;
    /** 0 = hip, 1 = fully aimed down sights. */
    adsProgress: number;
  };
  weapon: {
    slot: (typeof WEAPON_SLOTS)[number];
    weaponClass: (typeof WEAPON_CLASSES)[number];
    fireMode: (typeof FIRE_MODES)[number];
    ammo: number;
    magSize: number;
    reserve: number;
    reloading: boolean;
    /** False while sprinting or climbing — the rig will not let a shot out. */
    canFire: boolean;
  };
  perception: {
    visibleEnemies: VisibleEnemy[];
    contacts: Contact[];
    damage: { ageS: number; bearingDeg: number } | null;
    obstacles: {
      /** Metres to the nearest obstacle at waist height, or null when clear. */
      forwardM: number | null;
      leftM: number | null;
      rightM: number | null;
      backM: number | null;
      /** The obstacle ahead is low enough to climb (clear at head height). */
      forwardClimbable: boolean;
    };
  };
  objective: {
    kind: (typeof OBJECTIVE_KINDS)[number];
    bearingDeg: number | null;
    distanceM: number | null;
    state: (typeof OBJECTIVE_STATES)[number] | null;
  };
  previous: {
    frame: ControlFrame | null;
    outcome: PreviousOutcome | null;
  };
  legal: LegalActions;
}

/* ------------------------------------------------------------------ */
/* Legal actions                                                       */
/* ------------------------------------------------------------------ */

/**
 * The controls that can have an effect in this state, in contract order.
 *
 * Filtering is about mechanics, not tactics: nothing is removed because it
 * would be a poor choice, only because the rig would ignore it — firing an empty
 * or reloading weapon, reloading a full one, standing up while standing.
 */
export function legalActionsFor(
  player: Pick<JevObservation["player"], "stance" | "grounded" | "pitchDeg">,
  weapon: Pick<
    JevObservation["weapon"],
    "ammo" | "magSize" | "reserve" | "reloading" | "canFire"
  >,
): LegalActions {
  const move = AXIS_ACTIONS.move.filter((action) => {
    switch (action) {
      case "SPRINT_FORWARD":
        return player.stance !== "prone";
      case "JUMP":
        return player.grounded;
      case "CROUCH":
        return player.stance !== "crouch";
      case "PRONE":
        return player.stance !== "prone";
      case "STAND":
        return player.stance !== "stand";
      default:
        return true;
    }
  });
  const turn = [...AXIS_ACTIONS.turn];
  const tilt = AXIS_ACTIONS.tilt.filter((action) => {
    if (action.startsWith("LOOK_UP")) return player.pitchDeg < PITCH_LIMIT_DEG;
    if (action.startsWith("LOOK_DOWN")) return player.pitchDeg > -PITCH_LIMIT_DEG;
    return true;
  });
  const weaponActions = AXIS_ACTIONS.weapon.filter((action) => {
    switch (action) {
      case "FIRE":
      case "ADS_FIRE":
        return weapon.canFire && !weapon.reloading && weapon.ammo > 0;
      case "ADS":
        return weapon.canFire && !weapon.reloading;
      case "RELOAD":
        return !weapon.reloading && weapon.ammo < weapon.magSize && weapon.reserve > 0;
      default:
        return true;
    }
  });
  return { move, turn, tilt, weapon: weaponActions };
}

export function sameLegalActions(a: LegalActions, b: LegalActions): boolean {
  return AXES.every((axis) => {
    const left = a[axis] as readonly string[];
    const right = b[axis] as readonly string[];
    return left.length === right.length && left.every((value, i) => value === right[i]);
  });
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

class SchemaError extends Error {}

function fail(path: string, problem: string): never {
  throw new SchemaError(`${path}: ${problem}`);
}

/** An object with exactly these keys and no others. */
function record(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    if (!keys.includes(key)) fail(`${path}.${key}`, "unexpected field");
  }
  for (const key of keys) {
    if (!(key in object)) fail(`${path}.${key}`, "missing");
  }
  return object;
}

function number(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(path, "not a finite number");
  if (value < min || value > max) fail(path, `outside [${min}, ${max}]`);
  return value;
}

function integer(value: unknown, path: string, min: number, max: number): number {
  const n = number(value, path, min, max);
  if (!Number.isInteger(n)) fail(path, "not an integer");
  return n;
}

function nullableNumber(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number | null {
  return value === null ? null : number(value, path, min, max);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "not a boolean");
  return value;
}

function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(path, "not an allowed value");
  }
  return value as T;
}

function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  if (value.length > max) fail(path, `more than ${max} entries`);
  return value;
}

function axisList<A extends Axis>(value: unknown, path: string, axis: A): string[] {
  const entries = list(value, path, AXIS_ACTIONS[axis].length);
  const seen = new Set<string>();
  entries.forEach((entry, i) => {
    if (!isAxisAction(axis, entry)) fail(`${path}[${i}]`, "not a contract action");
    if (seen.has(entry)) fail(`${path}[${i}]`, "duplicate");
    seen.add(entry);
  });
  return entries as string[];
}

function frame(value: unknown, path: string): ControlFrame | null {
  if (value === null) return null;
  const f = record(value, path, AXES);
  return {
    move: oneOf(f["move"], `${path}.move`, AXIS_ACTIONS.move),
    turn: oneOf(f["turn"], `${path}.turn`, AXIS_ACTIONS.turn),
    tilt: oneOf(f["tilt"], `${path}.tilt`, AXIS_ACTIONS.tilt),
    weapon: oneOf(f["weapon"], `${path}.weapon`, AXIS_ACTIONS.weapon),
  };
}

const ANGLE = 180;
const MAX_DISTANCE_M = 5000;

/**
 * Parse an untrusted observation. Unknown fields, missing fields, strings
 * outside the vocabularies, non-finite or out-of-range numbers, oversized
 * arrays, and a legal-action list that disagrees with the state are all
 * rejected — the server recomputes legality itself and trusts nothing sent.
 */
export function validateObservation(value: unknown): Validated<JevObservation> {
  try {
    const o = record(value, "observation", [
      "schemaVersion",
      "actionContract",
      "sequence",
      "match",
      "player",
      "weapon",
      "perception",
      "objective",
      "previous",
      "legal",
    ]);
    if (o["schemaVersion"] !== OBSERVATION_SCHEMA_VERSION) {
      fail("observation.schemaVersion", "unsupported schema");
    }
    if (o["actionContract"] !== ACTION_CONTRACT_VERSION) {
      fail("observation.actionContract", "unsupported action contract");
    }

    const m = record(o["match"], "match", [
      "mode",
      "phase",
      "timeRemainingS",
      "team",
      "ownScore",
      "enemyScore",
    ]);
    const p = record(o["player"], "player", [
      "alive",
      "health",
      "headingDeg",
      "pitchDeg",
      "speedMps",
      "stance",
      "motion",
      "grounded",
      "adsProgress",
    ]);
    const w = record(o["weapon"], "weapon", [
      "slot",
      "weaponClass",
      "fireMode",
      "ammo",
      "magSize",
      "reserve",
      "reloading",
      "canFire",
    ]);
    const perception = record(o["perception"], "perception", [
      "visibleEnemies",
      "contacts",
      "damage",
      "obstacles",
    ]);
    const obstacles = record(perception["obstacles"], "perception.obstacles", [
      "forwardM",
      "leftM",
      "rightM",
      "backM",
      "forwardClimbable",
    ]);
    const objective = record(o["objective"], "objective", [
      "kind",
      "bearingDeg",
      "distanceM",
      "state",
    ]);
    const previous = record(o["previous"], "previous", ["frame", "outcome"]);
    const legal = record(o["legal"], "legal", AXES);

    const observation: JevObservation = {
      schemaVersion: OBSERVATION_SCHEMA_VERSION,
      actionContract: ACTION_CONTRACT_VERSION,
      sequence: integer(o["sequence"], "observation.sequence", 1, 2 ** 31 - 1),
      match: {
        mode: oneOf(m["mode"], "match.mode", GAME_MODES),
        phase: oneOf(m["phase"], "match.phase", MATCH_PHASES),
        timeRemainingS: number(m["timeRemainingS"], "match.timeRemainingS", 0, 7200),
        team: oneOf(m["team"], "match.team", TEAMS),
        ownScore: integer(m["ownScore"], "match.ownScore", 0, 100000),
        enemyScore: integer(m["enemyScore"], "match.enemyScore", 0, 100000),
      },
      player: {
        alive: boolean(p["alive"], "player.alive"),
        health: number(p["health"], "player.health", 0, 1000),
        headingDeg: number(p["headingDeg"], "player.headingDeg", 0, 360),
        pitchDeg: number(p["pitchDeg"], "player.pitchDeg", -90, 90),
        speedMps: number(p["speedMps"], "player.speedMps", 0, 100),
        stance: oneOf(p["stance"], "player.stance", STANCES),
        motion: oneOf(p["motion"], "player.motion", MOTIONS),
        grounded: boolean(p["grounded"], "player.grounded"),
        adsProgress: number(p["adsProgress"], "player.adsProgress", 0, 1),
      },
      weapon: {
        slot: oneOf(w["slot"], "weapon.slot", WEAPON_SLOTS),
        weaponClass: oneOf(w["weaponClass"], "weapon.weaponClass", WEAPON_CLASSES),
        fireMode: oneOf(w["fireMode"], "weapon.fireMode", FIRE_MODES),
        ammo: integer(w["ammo"], "weapon.ammo", 0, 1000),
        magSize: integer(w["magSize"], "weapon.magSize", 1, 1000),
        reserve: integer(w["reserve"], "weapon.reserve", 0, 10000),
        reloading: boolean(w["reloading"], "weapon.reloading"),
        canFire: boolean(w["canFire"], "weapon.canFire"),
      },
      perception: {
        visibleEnemies: list(
          perception["visibleEnemies"],
          "perception.visibleEnemies",
          MAX_VISIBLE_ENEMIES,
        ).map((entry, i) => {
          const path = `perception.visibleEnemies[${i}]`;
          const e = record(entry, path, [
            "bearingDeg",
            "elevationDeg",
            "distanceM",
            "onCrosshair",
            "firing",
          ]);
          return {
            bearingDeg: number(e["bearingDeg"], `${path}.bearingDeg`, -ANGLE, ANGLE),
            elevationDeg: number(
              e["elevationDeg"],
              `${path}.elevationDeg`,
              -ANGLE,
              ANGLE,
            ),
            distanceM: number(e["distanceM"], `${path}.distanceM`, 0, SIGHT_RANGE_M),
            onCrosshair: boolean(e["onCrosshair"], `${path}.onCrosshair`),
            firing: boolean(e["firing"], `${path}.firing`),
          };
        }),
        contacts: list(perception["contacts"], "perception.contacts", MAX_CONTACTS).map(
          (entry, i) => {
            const path = `perception.contacts[${i}]`;
            const c = record(entry, path, ["source", "bearingDeg", "distanceM", "ageS"]);
            return {
              source: oneOf(c["source"], `${path}.source`, CONTACT_SOURCES),
              bearingDeg: number(c["bearingDeg"], `${path}.bearingDeg`, -ANGLE, ANGLE),
              distanceM: number(c["distanceM"], `${path}.distanceM`, 0, MAX_DISTANCE_M),
              ageS: number(c["ageS"], `${path}.ageS`, 0, 60),
            };
          },
        ),
        damage:
          perception["damage"] === null
            ? null
            : (() => {
                const d = record(perception["damage"], "perception.damage", [
                  "ageS",
                  "bearingDeg",
                ]);
                return {
                  ageS: number(d["ageS"], "perception.damage.ageS", 0, 60),
                  bearingDeg: number(
                    d["bearingDeg"],
                    "perception.damage.bearingDeg",
                    -ANGLE,
                    ANGLE,
                  ),
                };
              })(),
        obstacles: {
          forwardM: nullableNumber(
            obstacles["forwardM"],
            "obstacles.forwardM",
            0,
            OBSTACLE_PROBE_M,
          ),
          leftM: nullableNumber(
            obstacles["leftM"],
            "obstacles.leftM",
            0,
            OBSTACLE_PROBE_M,
          ),
          rightM: nullableNumber(
            obstacles["rightM"],
            "obstacles.rightM",
            0,
            OBSTACLE_PROBE_M,
          ),
          backM: nullableNumber(
            obstacles["backM"],
            "obstacles.backM",
            0,
            OBSTACLE_PROBE_M,
          ),
          forwardClimbable: boolean(
            obstacles["forwardClimbable"],
            "obstacles.forwardClimbable",
          ),
        },
      },
      objective: {
        kind: oneOf(objective["kind"], "objective.kind", OBJECTIVE_KINDS),
        bearingDeg: nullableNumber(
          objective["bearingDeg"],
          "objective.bearingDeg",
          -ANGLE,
          ANGLE,
        ),
        distanceM: nullableNumber(
          objective["distanceM"],
          "objective.distanceM",
          0,
          MAX_DISTANCE_M,
        ),
        state:
          objective["state"] === null
            ? null
            : oneOf(objective["state"], "objective.state", OBJECTIVE_STATES),
      },
      previous: {
        frame: frame(previous["frame"], "previous.frame"),
        outcome:
          previous["outcome"] === null
            ? null
            : (() => {
                const r = record(previous["outcome"], "previous.outcome", [
                  "shotsFired",
                  "hitConfirmed",
                  "killConfirmed",
                  "damageTaken",
                  "movementBlocked",
                ]);
                return {
                  shotsFired: integer(
                    r["shotsFired"],
                    "previous.outcome.shotsFired",
                    0,
                    1000,
                  ),
                  hitConfirmed: boolean(
                    r["hitConfirmed"],
                    "previous.outcome.hitConfirmed",
                  ),
                  killConfirmed: boolean(
                    r["killConfirmed"],
                    "previous.outcome.killConfirmed",
                  ),
                  damageTaken: boolean(r["damageTaken"], "previous.outcome.damageTaken"),
                  movementBlocked: boolean(
                    r["movementBlocked"],
                    "previous.outcome.movementBlocked",
                  ),
                };
              })(),
      },
      legal: {
        move: axisList(legal["move"], "legal.move", "move") as MoveAction[],
        turn: axisList(legal["turn"], "legal.turn", "turn") as TurnAction[],
        tilt: axisList(legal["tilt"], "legal.tilt", "tilt") as TiltAction[],
        weapon: axisList(legal["weapon"], "legal.weapon", "weapon") as WeaponAction[],
      },
    };

    if (observation.weapon.ammo > observation.weapon.magSize) {
      fail("weapon.ammo", "exceeds the magazine");
    }
    const expected = legalActionsFor(observation.player, observation.weapon);
    if (!sameLegalActions(expected, observation.legal)) {
      fail("legal", "does not match the state it was sent with");
    }
    for (const axis of AXES) {
      if (observation.legal[axis].length < 2)
        fail(`legal.${axis}`, "fewer than two options");
    }
    return { ok: true, value: observation };
  } catch (error) {
    if (error instanceof SchemaError) return { ok: false, error: error.message };
    throw error;
  }
}
