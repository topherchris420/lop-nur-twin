import {
  ACTION_CONTRACT_VERSION,
  AXES,
  AXIS_ACTIONS,
  CONTROL_MODES,
  NAVIGATION_MODES,
  OBSERVATION_SCHEMA_VERSION,
  isAxisAction,
  type Axis,
  type AxisActions,
  type ControlFrame,
} from "../pilot/contract.js";
import {
  CONTACT_SOURCES,
  FIRE_MODES,
  GAME_MODES,
  MATCH_PHASES,
  MAX_ALLIES,
  MAX_CONTACTS,
  MAX_PLACES,
  MAX_VISIBLE_ENEMIES,
  MOTIONS,
  OBJECTIVE_KINDS,
  OBJECTIVE_STATES,
  OBSTACLE_PROBE_M,
  PLACE_KINDS,
  RADAR_RANGE_M,
  SIGHT_RANGE_M,
  STANCES,
  TEAMS,
  WEAPON_CLASSES,
  WEAPON_SLOTS,
  type JevObservation,
  type LegalActions,
  type PlaceKind,
} from "../pilot/observation.js";
import {
  DECISION_RECORD_VERSION,
  EPISODE_DECISIONS_SCHEMA,
  MAX_EPISODE_RECORDS,
  type AxisConfidence,
  type ConfidenceSource,
  type DecisionAccounting,
  type DecisionConfidence,
  type DecisionContext,
  type DecisionExecution,
  type DecisionRecord,
  type DecisionValidation,
  type FailureRecord,
  type OutcomeWindow,
  type RecordSource,
  type ValidationStatus,
} from "./records.js";

/**
 * One episode's decision records, read back from a file and checked before
 * anything is shown.
 *
 * The file is whatever a person chose, or an archived artifact fetched from
 * this site; either way it is checked, not cast. Every field the evaluation
 * page reads is checked for its type, its vocabulary and its bounds, and every
 * array for its length. Nothing is dropped or repaired: one malformed record
 * refuses the whole file, and the refusal names the first record and field
 * that failed, so a reader never sees a trace with holes it was not told about.
 *
 * Archived episodes predate the file's schema id and carry none; a file that
 * names a schema must name `blacksite-episode-decisions/v1`. Observations
 * recorded as `blacksite-jev-observation/v3` have the shape of v4 (v4 changed
 * how places are found, not what is reported about them) and are read as such.
 *
 * Pure apart from `readEpisodeRecords`, which reads a byte stream with the
 * platform's own `DecompressionStream`, so it runs in a browser and under Node.
 */

/** The file size, compressed and decompressed, beyond which nothing is read. */
export const MAX_RECORDS_BYTES = 64 * 1024 * 1024;

export interface EpisodeRecords {
  episodeId: string;
  brain: { id: string; provider: string } | null;
  /** The stale policy the episode ran under, when the file states it. */
  stale: string | null;
  /** Seconds each outcome window runs, when the file states it. */
  outcomeWindowS: number | null;
  decisions: DecisionRecord[];
  failures: FailureRecord[];
}

export type ParsedEpisode =
  { ok: true; value: EpisodeRecords } | { ok: false; error: string };

/** Observation schemas whose shape this reader knows. */
const READABLE_OBSERVATIONS: readonly string[] = [
  "blacksite-jev-observation/v3",
  OBSERVATION_SCHEMA_VERSION,
];

// Keyed by the union, so adding a member to the type without adding it here
// fails to compile instead of refusing every file that uses it.
const RECORD_SOURCES: Record<RecordSource, true> = {
  jev: true,
  glide: true,
  llm: true,
  random: true,
  script: true,
  replay: true,
  "fallback-random": true,
};
const CONFIDENCE_SOURCES: Record<ConfidenceSource, true> = {
  "provider-probability": true,
  verbalized: true,
  none: true,
};
const VALIDATION_STATUSES: Record<ValidationStatus, true> = {
  executed: true,
  executed_illegal: true,
  rejected_stale: true,
  superseded: true,
  not_executed: true,
};
const keysOf = <T extends string>(set: Record<T, true>): readonly T[] =>
  Object.keys(set) as T[];

/* ------------------------------------------------------------------ */
/* Field checks                                                        */
/* ------------------------------------------------------------------ */

class RecordError extends Error {}

function fail(path: string, problem: string): never {
  throw new RecordError(`${path}: ${problem}`);
}

/** An object with exactly these keys: a field nobody reads is not kept unseen. */
function object(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  const o = value as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!keys.includes(key)) fail(`${path}.${key}`, "unexpected field");
  }
  for (const key of keys) {
    if (!(key in o)) fail(`${path}.${key}`, "missing");
  }
  return o;
}

function num(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "not a finite number");
  }
  if (value < min || value > max) fail(path, `outside [${min}, ${max}]`);
  return value;
}

function int(value: unknown, path: string, min: number, max: number): number {
  const n = num(value, path, min, max);
  if (!Number.isInteger(n)) fail(path, "not an integer");
  return n;
}

function numOrNull(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number | null {
  return value === null ? null : num(value, path, min, max);
}

function intOrNull(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number | null {
  return value === null ? null : int(value, path, min, max);
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "not a boolean");
  return value;
}

function boolOrNull(value: unknown, path: string): boolean | null {
  return value === null ? null : bool(value, path);
}

function str(value: unknown, path: string, max: number): string {
  if (typeof value !== "string") fail(path, "not a string");
  if (value.length > max) fail(path, `longer than ${max} characters`);
  return value;
}

function strOrNull(value: unknown, path: string, max: number): string | null {
  return value === null ? null : str(value, path, max);
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

/* ------------------------------------------------------------------ */
/* Record sections                                                     */
/* ------------------------------------------------------------------ */

const ANGLE = 180;
const MAX_DISTANCE_M = 5000;
/** Simulation seconds; a match is minutes long, so this is a bound, not a limit. */
const MAX_SIM_S = 1e6;
/** Milliseconds; a request is abandoned long before this. */
const MAX_MS = 3.6e6;
const MAX_COUNT = 1e9;
const MAX_ID = 200;

function frameOf(value: unknown, path: string): ControlFrame {
  const f = object(value, path, AXES);
  const axis = <A extends Axis>(name: A): AxisActions[A] => {
    const choice = f[name];
    if (!isAxisAction(name, choice)) fail(`${path}.${name}`, "not a contract action");
    return choice;
  };
  return {
    move: axis("move"),
    turn: axis("turn"),
    tilt: axis("tilt"),
    weapon: axis("weapon"),
    target: axis("target"),
    aim: axis("aim"),
    go: axis("go"),
  };
}

function legalOf(value: unknown, path: string): LegalActions {
  const l = object(value, path, AXES);
  const options = <A extends Axis>(name: A): AxisActions[A][] => {
    const entries = list(l[name], `${path}.${name}`, AXIS_ACTIONS[name].length);
    const seen = new Set<unknown>();
    entries.forEach((entry, i) => {
      if (!isAxisAction(name, entry))
        fail(`${path}.${name}[${i}]`, "not a contract action");
      if (seen.has(entry)) fail(`${path}.${name}[${i}]`, "listed twice");
      seen.add(entry);
    });
    if (entries.length === 0) fail(`${path}.${name}`, "offers no option");
    return entries as AxisActions[A][];
  };
  return {
    move: options("move"),
    turn: options("turn"),
    tilt: options("tilt"),
    weapon: options("weapon"),
    target: options("target"),
    aim: options("aim"),
    go: options("go"),
  };
}

/**
 * The observation as recorded: the same fields and bounds the server's
 * validator enforces, without re-deriving the legal options from the state —
 * the record's `legal` is what was offered, and is read as such.
 */
function observationOf(value: unknown, path: string): JevObservation {
  const o = object(value, path, [
    "schemaVersion",
    "actionContract",
    "sequence",
    "control",
    "navigation",
    "match",
    "player",
    "weapon",
    "perception",
    "objective",
    "travel",
    "previous",
    "legal",
  ]);
  if (!READABLE_OBSERVATIONS.includes(o["schemaVersion"] as string)) {
    fail(`${path}.schemaVersion`, "not an observation schema this page reads");
  }
  if (o["actionContract"] !== ACTION_CONTRACT_VERSION) {
    fail(`${path}.actionContract`, "not this build's action contract");
  }
  const m = object(o["match"], `${path}.match`, [
    "mode",
    "phase",
    "timeRemainingS",
    "team",
    "ownScore",
    "enemyScore",
  ]);
  const p = object(o["player"], `${path}.player`, [
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
  const w = object(o["weapon"], `${path}.weapon`, [
    "slot",
    "weaponClass",
    "fireMode",
    "ammo",
    "magSize",
    "reserve",
    "reloading",
    "canFire",
    "spreadDeg",
    "aimedSpreadDeg",
  ]);
  const pp = `${path}.perception`;
  const per = object(o["perception"], pp, [
    "visibleEnemies",
    "contacts",
    "damage",
    "obstacles",
    "places",
    "allies",
  ]);
  const obs = object(per["obstacles"], `${pp}.obstacles`, [
    "forwardM",
    "leftM",
    "rightM",
    "backM",
    "forwardClimbable",
  ]);
  const objective = object(o["objective"], `${path}.objective`, [
    "kind",
    "bearingDeg",
    "distanceM",
    "state",
  ]);
  const previous = object(o["previous"], `${path}.previous`, ["frame", "outcome"]);
  const probe = (key: string): number | null =>
    numOrNull(obs[key], `${pp}.obstacles.${key}`, 0, OBSTACLE_PROBE_M);
  return {
    // Kept as recorded. Typed as today's version because the shape is the same.
    schemaVersion: o["schemaVersion"] as typeof OBSERVATION_SCHEMA_VERSION,
    actionContract: ACTION_CONTRACT_VERSION,
    sequence: int(o["sequence"], `${path}.sequence`, 1, 2 ** 31 - 1),
    control: oneOf(o["control"], `${path}.control`, CONTROL_MODES),
    navigation: oneOf(o["navigation"], `${path}.navigation`, NAVIGATION_MODES),
    match: {
      mode: oneOf(m["mode"], `${path}.match.mode`, GAME_MODES),
      phase: oneOf(m["phase"], `${path}.match.phase`, MATCH_PHASES),
      timeRemainingS: num(m["timeRemainingS"], `${path}.match.timeRemainingS`, 0, 7200),
      team: oneOf(m["team"], `${path}.match.team`, TEAMS),
      ownScore: int(m["ownScore"], `${path}.match.ownScore`, 0, 100000),
      enemyScore: int(m["enemyScore"], `${path}.match.enemyScore`, 0, 100000),
    },
    player: {
      alive: bool(p["alive"], `${path}.player.alive`),
      health: num(p["health"], `${path}.player.health`, 0, 1000),
      headingDeg: num(p["headingDeg"], `${path}.player.headingDeg`, 0, 360),
      pitchDeg: num(p["pitchDeg"], `${path}.player.pitchDeg`, -90, 90),
      speedMps: num(p["speedMps"], `${path}.player.speedMps`, 0, 100),
      stance: oneOf(p["stance"], `${path}.player.stance`, STANCES),
      motion: oneOf(p["motion"], `${path}.player.motion`, MOTIONS),
      grounded: bool(p["grounded"], `${path}.player.grounded`),
      adsProgress: num(p["adsProgress"], `${path}.player.adsProgress`, 0, 1),
    },
    weapon: {
      slot: oneOf(w["slot"], `${path}.weapon.slot`, WEAPON_SLOTS),
      weaponClass: oneOf(w["weaponClass"], `${path}.weapon.weaponClass`, WEAPON_CLASSES),
      fireMode: oneOf(w["fireMode"], `${path}.weapon.fireMode`, FIRE_MODES),
      ammo: int(w["ammo"], `${path}.weapon.ammo`, 0, 1000),
      magSize: int(w["magSize"], `${path}.weapon.magSize`, 1, 1000),
      reserve: int(w["reserve"], `${path}.weapon.reserve`, 0, 10000),
      reloading: bool(w["reloading"], `${path}.weapon.reloading`),
      canFire: bool(w["canFire"], `${path}.weapon.canFire`),
      spreadDeg: num(w["spreadDeg"], `${path}.weapon.spreadDeg`, 0, 45),
      aimedSpreadDeg: num(w["aimedSpreadDeg"], `${path}.weapon.aimedSpreadDeg`, 0, 45),
    },
    perception: {
      visibleEnemies: list(
        per["visibleEnemies"],
        `${pp}.visibleEnemies`,
        MAX_VISIBLE_ENEMIES,
      ).map((entry, i) => {
        const at = `${pp}.visibleEnemies[${i}]`;
        const e = object(entry, at, [
          "bearingDeg",
          "elevationDeg",
          "distanceM",
          "onCrosshair",
          "firing",
          "headVisible",
          "chestVisible",
          "lateralMps",
          "tracked",
        ]);
        return {
          bearingDeg: num(e["bearingDeg"], `${at}.bearingDeg`, -ANGLE, ANGLE),
          elevationDeg: num(e["elevationDeg"], `${at}.elevationDeg`, -ANGLE, ANGLE),
          distanceM: num(e["distanceM"], `${at}.distanceM`, 0, SIGHT_RANGE_M),
          onCrosshair: bool(e["onCrosshair"], `${at}.onCrosshair`),
          firing: bool(e["firing"], `${at}.firing`),
          headVisible: bool(e["headVisible"], `${at}.headVisible`),
          chestVisible: bool(e["chestVisible"], `${at}.chestVisible`),
          lateralMps: num(e["lateralMps"], `${at}.lateralMps`, -50, 50),
          tracked: bool(e["tracked"], `${at}.tracked`),
        };
      }),
      contacts: list(per["contacts"], `${pp}.contacts`, MAX_CONTACTS).map((entry, i) => {
        const at = `${pp}.contacts[${i}]`;
        const c = object(entry, at, ["source", "bearingDeg", "distanceM", "ageS"]);
        return {
          source: oneOf(c["source"], `${at}.source`, CONTACT_SOURCES),
          bearingDeg: num(c["bearingDeg"], `${at}.bearingDeg`, -ANGLE, ANGLE),
          distanceM: num(c["distanceM"], `${at}.distanceM`, 0, MAX_DISTANCE_M),
          ageS: num(c["ageS"], `${at}.ageS`, 0, 60),
        };
      }),
      damage:
        per["damage"] === null
          ? null
          : (() => {
              const d = object(per["damage"], `${pp}.damage`, ["ageS", "bearingDeg"]);
              return {
                ageS: num(d["ageS"], `${pp}.damage.ageS`, 0, 60),
                bearingDeg: num(
                  d["bearingDeg"],
                  `${pp}.damage.bearingDeg`,
                  -ANGLE,
                  ANGLE,
                ),
              };
            })(),
      obstacles: {
        forwardM: probe("forwardM"),
        leftM: probe("leftM"),
        rightM: probe("rightM"),
        backM: probe("backM"),
        forwardClimbable: bool(
          obs["forwardClimbable"],
          `${pp}.obstacles.forwardClimbable`,
        ),
      },
      places: list(per["places"], `${pp}.places`, MAX_PLACES).map((entry, i) => {
        const at = `${pp}.places[${i}]`;
        const pl = object(entry, at, [
          "kind",
          "bearingDeg",
          "distanceM",
          "hidden",
          "routeExposedM",
          "threatDistanceM",
        ]);
        return {
          kind: oneOf(pl["kind"], `${at}.kind`, PLACE_KINDS),
          bearingDeg: num(pl["bearingDeg"], `${at}.bearingDeg`, -ANGLE, ANGLE),
          distanceM: num(pl["distanceM"], `${at}.distanceM`, 0, MAX_DISTANCE_M),
          hidden: bool(pl["hidden"], `${at}.hidden`),
          routeExposedM: num(
            pl["routeExposedM"],
            `${at}.routeExposedM`,
            0,
            MAX_DISTANCE_M,
          ),
          threatDistanceM: numOrNull(
            pl["threatDistanceM"],
            `${at}.threatDistanceM`,
            0,
            MAX_DISTANCE_M,
          ),
        };
      }),
      allies: list(per["allies"], `${pp}.allies`, MAX_ALLIES).map((entry, i) => {
        const at = `${pp}.allies[${i}]`;
        const a = object(entry, at, ["bearingDeg", "distanceM"]);
        return {
          bearingDeg: num(a["bearingDeg"], `${at}.bearingDeg`, -ANGLE, ANGLE),
          distanceM: num(a["distanceM"], `${at}.distanceM`, 0, RADAR_RANGE_M),
        };
      }),
    },
    travel:
      o["travel"] === null
        ? null
        : (() => {
            const t = object(o["travel"], `${path}.travel`, [
              "kind",
              "bearingDeg",
              "remainingM",
            ]);
            return {
              kind: oneOf(t["kind"], `${path}.travel.kind`, PLACE_KINDS),
              bearingDeg: num(
                t["bearingDeg"],
                `${path}.travel.bearingDeg`,
                -ANGLE,
                ANGLE,
              ),
              remainingM: num(
                t["remainingM"],
                `${path}.travel.remainingM`,
                0,
                MAX_DISTANCE_M,
              ),
            };
          })(),
    objective: {
      kind: oneOf(objective["kind"], `${path}.objective.kind`, OBJECTIVE_KINDS),
      bearingDeg: numOrNull(
        objective["bearingDeg"],
        `${path}.objective.bearingDeg`,
        -ANGLE,
        ANGLE,
      ),
      distanceM: numOrNull(
        objective["distanceM"],
        `${path}.objective.distanceM`,
        0,
        MAX_DISTANCE_M,
      ),
      state:
        objective["state"] === null
          ? null
          : oneOf(objective["state"], `${path}.objective.state`, OBJECTIVE_STATES),
    },
    previous: {
      frame:
        previous["frame"] === null
          ? null
          : frameOf(previous["frame"], `${path}.previous.frame`),
      outcome:
        previous["outcome"] === null
          ? null
          : (() => {
              const at = `${path}.previous.outcome`;
              const r = object(previous["outcome"], at, [
                "shotsFired",
                "hitConfirmed",
                "killConfirmed",
                "damageTaken",
                "movementBlocked",
              ]);
              return {
                shotsFired: int(r["shotsFired"], `${at}.shotsFired`, 0, 1000),
                hitConfirmed: bool(r["hitConfirmed"], `${at}.hitConfirmed`),
                killConfirmed: bool(r["killConfirmed"], `${at}.killConfirmed`),
                damageTaken: bool(r["damageTaken"], `${at}.damageTaken`),
                movementBlocked: bool(r["movementBlocked"], `${at}.movementBlocked`),
              };
            })(),
    },
    legal: legalOf(o["legal"], `${path}.legal`),
  };
}

function contextOfRecord(value: unknown, path: string): DecisionContext {
  const c = object(value, path, [
    "visibleEnemies",
    "enemiesFiring",
    "contacts",
    "damageRecent",
    "health",
    "ammo",
    "magSize",
    "reserve",
    "reloading",
    "stance",
    "motion",
    "targets",
    "places",
    "objectiveDistanceM",
  ]);
  return {
    visibleEnemies: int(
      c["visibleEnemies"],
      `${path}.visibleEnemies`,
      0,
      MAX_VISIBLE_ENEMIES,
    ),
    enemiesFiring: int(
      c["enemiesFiring"],
      `${path}.enemiesFiring`,
      0,
      MAX_VISIBLE_ENEMIES,
    ),
    contacts: int(c["contacts"], `${path}.contacts`, 0, MAX_CONTACTS),
    damageRecent: bool(c["damageRecent"], `${path}.damageRecent`),
    health: num(c["health"], `${path}.health`, 0, 1000),
    ammo: int(c["ammo"], `${path}.ammo`, 0, 1000),
    magSize: int(c["magSize"], `${path}.magSize`, 1, 1000),
    reserve: int(c["reserve"], `${path}.reserve`, 0, 10000),
    reloading: bool(c["reloading"], `${path}.reloading`),
    stance: oneOf(c["stance"], `${path}.stance`, STANCES),
    motion: oneOf(c["motion"], `${path}.motion`, MOTIONS),
    targets: list(c["targets"], `${path}.targets`, MAX_VISIBLE_ENEMIES).map(
      (entry, i) => {
        const at = `${path}.targets[${i}]`;
        const t = object(entry, at, [
          "distanceM",
          "firing",
          "fullyExposed",
          "onCrosshair",
          "tracked",
        ]);
        return {
          distanceM: num(t["distanceM"], `${at}.distanceM`, 0, SIGHT_RANGE_M),
          firing: bool(t["firing"], `${at}.firing`),
          fullyExposed: bool(t["fullyExposed"], `${at}.fullyExposed`),
          onCrosshair: bool(t["onCrosshair"], `${at}.onCrosshair`),
          tracked: bool(t["tracked"], `${at}.tracked`),
        };
      },
    ),
    places: list(c["places"], `${path}.places`, MAX_PLACES).map((entry, i) => {
      const at = `${path}.places[${i}]`;
      const pl = object(entry, at, ["kind", "hidden", "distanceM", "routeExposedM"]);
      return {
        kind: oneOf(pl["kind"], `${at}.kind`, PLACE_KINDS),
        hidden: bool(pl["hidden"], `${at}.hidden`),
        distanceM: num(pl["distanceM"], `${at}.distanceM`, 0, MAX_DISTANCE_M),
        routeExposedM: num(pl["routeExposedM"], `${at}.routeExposedM`, 0, MAX_DISTANCE_M),
      };
    }),
    objectiveDistanceM: numOrNull(
      c["objectiveDistanceM"],
      `${path}.objectiveDistanceM`,
      0,
      MAX_DISTANCE_M,
    ),
  };
}

function confidenceOf(value: unknown, path: string): DecisionConfidence {
  const c = object(value, path, ["source", "perAxis"]);
  const source = oneOf(c["source"], `${path}.source`, keysOf(CONFIDENCE_SOURCES));
  const per = c["perAxis"];
  if (typeof per !== "object" || per === null || Array.isArray(per)) {
    fail(`${path}.perAxis`, "expected an object");
  }
  const perAxis: Partial<Record<Axis, AxisConfidence>> = {};
  for (const [axis, entry] of Object.entries(per)) {
    const at = `${path}.perAxis.${axis}`;
    if (!(AXES as readonly string[]).includes(axis)) fail(at, "not an axis");
    const a = object(entry, at, ["probability", "confidence"]);
    perAxis[axis as Axis] = {
      probability: numOrNull(a["probability"], `${at}.probability`, 0, 1),
      confidence: numOrNull(a["confidence"], `${at}.confidence`, 0, 1),
    };
  }
  // A seat that states nothing has nothing per axis: a figure under "none"
  // would be a number with no claim behind it.
  if (source === "none" && Object.keys(perAxis).length > 0) {
    fail(`${path}.perAxis`, 'figures under source "none"');
  }
  return { source, perAxis };
}

function accountingOf(value: unknown, path: string): DecisionAccounting {
  const a = object(value, path, [
    "provider",
    "model",
    "wallLatencyMs",
    "providerLatencyMs",
    "requestBytes",
    "responseBytes",
    "inputTokens",
    "outputTokens",
    "reportedCostUsd",
    "retries",
    "traceId",
    "questionHash",
    "injectedLatencyMs",
  ]);
  return {
    provider: str(a["provider"], `${path}.provider`, MAX_ID),
    model: strOrNull(a["model"], `${path}.model`, MAX_ID),
    wallLatencyMs: numOrNull(a["wallLatencyMs"], `${path}.wallLatencyMs`, 0, MAX_MS),
    providerLatencyMs: numOrNull(
      a["providerLatencyMs"],
      `${path}.providerLatencyMs`,
      0,
      MAX_MS,
    ),
    requestBytes: intOrNull(a["requestBytes"], `${path}.requestBytes`, 0, MAX_COUNT),
    responseBytes: intOrNull(a["responseBytes"], `${path}.responseBytes`, 0, MAX_COUNT),
    inputTokens: intOrNull(a["inputTokens"], `${path}.inputTokens`, 0, MAX_COUNT),
    outputTokens: intOrNull(a["outputTokens"], `${path}.outputTokens`, 0, MAX_COUNT),
    reportedCostUsd: numOrNull(a["reportedCostUsd"], `${path}.reportedCostUsd`, 0, 1e6),
    retries: intOrNull(a["retries"], `${path}.retries`, 0, 1000),
    traceId: strOrNull(a["traceId"], `${path}.traceId`, MAX_ID),
    questionHash: strOrNull(a["questionHash"], `${path}.questionHash`, 64),
    injectedLatencyMs: num(
      a["injectedLatencyMs"],
      `${path}.injectedLatencyMs`,
      0,
      MAX_MS,
    ),
  };
}

function validationOf(value: unknown, path: string): DecisionValidation {
  const v = object(value, path, [
    "status",
    "ageAtExecutionMs",
    "worldChanged",
    "illegalAtExecution",
  ]);
  return {
    status: oneOf(v["status"], `${path}.status`, keysOf(VALIDATION_STATUSES)),
    ageAtExecutionMs: numOrNull(
      v["ageAtExecutionMs"],
      `${path}.ageAtExecutionMs`,
      0,
      MAX_MS,
    ),
    worldChanged: list(v["worldChanged"], `${path}.worldChanged`, 16).map((entry, i) =>
      str(entry, `${path}.worldChanged[${i}]`, 40),
    ),
    illegalAtExecution: list(
      v["illegalAtExecution"],
      `${path}.illegalAtExecution`,
      AXES.length,
    ).map((entry, i) => oneOf(entry, `${path}.illegalAtExecution[${i}]`, AXES)),
  };
}

function executionOf(value: unknown, path: string): DecisionExecution {
  const e = object(value, path, [
    "actionStart",
    "actionEnd",
    "endReason",
    "targetBound",
    "placeBound",
    "placeKind",
  ]);
  return {
    actionStart: numOrNull(e["actionStart"], `${path}.actionStart`, 0, MAX_SIM_S),
    actionEnd: numOrNull(e["actionEnd"], `${path}.actionEnd`, 0, MAX_SIM_S),
    endReason: strOrNull(e["endReason"], `${path}.endReason`, 40),
    targetBound: boolOrNull(e["targetBound"], `${path}.targetBound`),
    placeBound: boolOrNull(e["placeBound"], `${path}.placeBound`),
    placeKind:
      e["placeKind"] === null
        ? null
        : oneOf<PlaceKind>(e["placeKind"], `${path}.placeKind`, PLACE_KINDS),
  };
}

function outcomeOf(value: unknown, path: string): OutcomeWindow | null {
  if (value === null) return null;
  const o = object(value, path, [
    "windowS",
    "elapsedS",
    "complete",
    "damageTaken",
    "damageDealt",
    "shotsFired",
    "hits",
    "kills",
    "died",
    "timeToDeathS",
    "exposureSamples",
    "exposedSamples",
    "movedM",
    "objectiveStartM",
    "objectiveEndM",
    "enemyShotsInSight",
    "target",
    "place",
  ]);
  const windowS = num(o["windowS"], `${path}.windowS`, 0, 600);
  const exposureSamples = int(
    o["exposureSamples"],
    `${path}.exposureSamples`,
    0,
    MAX_COUNT,
  );
  return {
    windowS,
    // Not capped at the window: a window still open when the file was saved
    // reports the time observed so far, read a frame or so late.
    elapsedS: num(o["elapsedS"], `${path}.elapsedS`, 0, MAX_SIM_S),
    complete: bool(o["complete"], `${path}.complete`),
    damageTaken: num(o["damageTaken"], `${path}.damageTaken`, 0, MAX_COUNT),
    damageDealt: num(o["damageDealt"], `${path}.damageDealt`, 0, MAX_COUNT),
    shotsFired: int(o["shotsFired"], `${path}.shotsFired`, 0, MAX_COUNT),
    hits: int(o["hits"], `${path}.hits`, 0, MAX_COUNT),
    kills: int(o["kills"], `${path}.kills`, 0, MAX_COUNT),
    died: bool(o["died"], `${path}.died`),
    timeToDeathS: numOrNull(o["timeToDeathS"], `${path}.timeToDeathS`, 0, MAX_SIM_S),
    exposureSamples,
    exposedSamples: int(
      o["exposedSamples"],
      `${path}.exposedSamples`,
      0,
      exposureSamples,
    ),
    movedM: num(o["movedM"], `${path}.movedM`, 0, MAX_DISTANCE_M),
    objectiveStartM: numOrNull(
      o["objectiveStartM"],
      `${path}.objectiveStartM`,
      0,
      MAX_DISTANCE_M,
    ),
    objectiveEndM: numOrNull(
      o["objectiveEndM"],
      `${path}.objectiveEndM`,
      0,
      MAX_DISTANCE_M,
    ),
    enemyShotsInSight: int(
      o["enemyShotsInSight"],
      `${path}.enemyShotsInSight`,
      0,
      MAX_COUNT,
    ),
    target:
      o["target"] === null
        ? null
        : (() => {
            const t = object(o["target"], `${path}.target`, ["hit", "killed", "damage"]);
            return {
              hit: bool(t["hit"], `${path}.target.hit`),
              killed: bool(t["killed"], `${path}.target.killed`),
              damage: num(t["damage"], `${path}.target.damage`, 0, MAX_COUNT),
            };
          })(),
    place:
      o["place"] === null
        ? null
        : (() => {
            const pl = object(o["place"], `${path}.place`, ["reached", "endReason"]);
            return {
              reached: bool(pl["reached"], `${path}.place.reached`),
              endReason: strOrNull(pl["endReason"], `${path}.place.endReason`, 40),
            };
          })(),
  };
}

function decisionOf(value: unknown, path: string): DecisionRecord {
  const r = object(value, path, [
    "schema",
    "episodeId",
    "seed",
    "sequence",
    "source",
    "brain",
    "observationHash",
    "observation",
    "context",
    "legal",
    "frame",
    "confidence",
    "accounting",
    "issuedAtSim",
    "acceptedAtSim",
    "validation",
    "execution",
    "outcome",
  ]);
  if (r["schema"] !== DECISION_RECORD_VERSION)
    fail(`${path}.schema`, "not a decision record");
  const legal = legalOf(r["legal"], `${path}.legal`);
  const frame = frameOf(r["frame"], `${path}.frame`);
  // The loop refuses a frame that names an option it was not offered, so a
  // record whose choice is not among its options did not come from the loop.
  for (const axis of AXES) {
    if (!(legal[axis] as readonly string[]).includes(frame[axis])) {
      fail(`${path}.frame.${axis}`, "not among the options the record offered");
    }
  }
  return {
    schema: DECISION_RECORD_VERSION,
    episodeId: str(r["episodeId"], `${path}.episodeId`, MAX_ID),
    seed: int(r["seed"], `${path}.seed`, 0, Number.MAX_SAFE_INTEGER),
    sequence: int(r["sequence"], `${path}.sequence`, 0, 2 ** 31 - 1),
    source: oneOf(r["source"], `${path}.source`, keysOf(RECORD_SOURCES)),
    brain: str(r["brain"], `${path}.brain`, MAX_ID),
    observationHash: str(r["observationHash"], `${path}.observationHash`, 64),
    observation:
      r["observation"] === null
        ? null
        : observationOf(r["observation"], `${path}.observation`),
    context: contextOfRecord(r["context"], `${path}.context`),
    legal,
    frame,
    confidence: confidenceOf(r["confidence"], `${path}.confidence`),
    accounting: accountingOf(r["accounting"], `${path}.accounting`),
    issuedAtSim: num(r["issuedAtSim"], `${path}.issuedAtSim`, 0, MAX_SIM_S),
    acceptedAtSim: num(r["acceptedAtSim"], `${path}.acceptedAtSim`, 0, MAX_SIM_S),
    validation: validationOf(r["validation"], `${path}.validation`),
    execution: executionOf(r["execution"], `${path}.execution`),
    outcome: outcomeOf(r["outcome"], `${path}.outcome`),
  };
}

function failureOf(value: unknown, path: string): FailureRecord {
  const f = object(value, path, [
    "schema",
    "episodeId",
    "sequence",
    "kind",
    "detail",
    "latencyMs",
    "staleAnswer",
  ]);
  if (f["schema"] !== DECISION_RECORD_VERSION)
    fail(`${path}.schema`, "not a failure record");
  return {
    schema: DECISION_RECORD_VERSION,
    episodeId: str(f["episodeId"], `${path}.episodeId`, MAX_ID),
    sequence: int(f["sequence"], `${path}.sequence`, 0, 2 ** 31 - 1),
    kind: str(f["kind"], `${path}.kind`, 40),
    detail: str(f["detail"], `${path}.detail`, 400),
    latencyMs: numOrNull(f["latencyMs"], `${path}.latencyMs`, 0, MAX_MS),
    staleAnswer: bool(f["staleAnswer"], `${path}.staleAnswer`),
  };
}

/* ------------------------------------------------------------------ */
/* The file                                                            */
/* ------------------------------------------------------------------ */

const megabytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${Math.round(bytes / (1024 * 1024))} MB`
    : `${Math.round(bytes / 1024)} KB`;

/**
 * Check one episode's decision records, given as JSON text. A refusal names
 * the first record and field that failed:
 * `decisions[12].accounting.wallLatencyMs: not a finite number`.
 */
export function parseEpisodeRecords(
  text: string,
  limit: number = MAX_RECORDS_BYTES,
): ParsedEpisode {
  // Characters, not bytes: a string this long is at least this many bytes.
  if (text.length > limit) return { ok: false, error: `larger than ${megabytes(limit)}` };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "not JSON" };
  }
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      fail("file", "expected an object");
    }
    const file = value as Record<string, unknown>;
    // Archived episodes predate the schema id; anything that names one must
    // name this one.
    if (file["schema"] !== undefined && file["schema"] !== EPISODE_DECISIONS_SCHEMA) {
      return {
        ok: false,
        error: `unsupported decision-records schema: ${String(file["schema"]).slice(0, 60)}`,
      };
    }
    if (!Array.isArray(file["decisions"]) || !Array.isArray(file["failures"])) {
      return {
        ok: false,
        error: "not an episode's decision records (expected decisions and failures)",
      };
    }
    const decisions = list(file["decisions"], "decisions", MAX_EPISODE_RECORDS).map(
      (entry, i) => decisionOf(entry, `decisions[${i}]`),
    );
    // Sequence numbers identify a decision on the page and in its windows.
    const seen = new Set<number>();
    decisions.forEach((d, i) => {
      if (seen.has(d.sequence))
        fail(`decisions[${i}].sequence`, "repeats an earlier record's");
      seen.add(d.sequence);
    });
    const failures = list(file["failures"], "failures", MAX_EPISODE_RECORDS).map(
      (entry, i) => failureOf(entry, `failures[${i}]`),
    );
    const brain =
      file["brain"] === undefined || file["brain"] === null
        ? null
        : (() => {
            // The descriptor carries capabilities this page does not read;
            // only the two names it prints are checked and kept.
            const b = file["brain"];
            if (typeof b !== "object" || Array.isArray(b))
              fail("brain", "expected an object");
            const d = b as Record<string, unknown>;
            return {
              id: str(d["id"], "brain.id", MAX_ID),
              provider: str(d["provider"], "brain.provider", MAX_ID),
            };
          })();
    return {
      ok: true,
      value: {
        episodeId:
          file["episodeId"] === undefined
            ? "unknown"
            : str(file["episodeId"], "episodeId", MAX_ID),
        brain,
        stale: file["stale"] === undefined ? null : str(file["stale"], "stale", 40),
        outcomeWindowS:
          file["outcomeWindowS"] === undefined
            ? null
            : num(file["outcomeWindowS"], "outcomeWindowS", 0, 600),
        decisions,
        failures,
      },
    };
  } catch (error) {
    if (error instanceof RecordError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Gzip's magic number. A host may already have decoded the body, so it is looked for, not assumed. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Read a stream to its end, refusing it once it passes `limit` bytes. */
async function readBounded(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(`larger than ${megabytes(limit)}`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Read and check one episode's records from a byte stream — a chosen file's
 * or a fetched archive's. Gzip is recognised by its magic bytes and
 * decompressed with the same size limit, so a small file cannot unpack into an
 * unbounded one. Throws an `Error` whose message says why the file was refused.
 */
export async function readEpisodeRecords(
  stream: ReadableStream<Uint8Array>,
  limit: number = MAX_RECORDS_BYTES,
): Promise<EpisodeRecords> {
  let bytes = await readBounded(stream, limit);
  if (isGzip(bytes)) {
    try {
      bytes = await readBounded(
        new Response(bytes).body!.pipeThrough(new DecompressionStream("gzip")),
        limit,
      );
    } catch (error) {
      throw error instanceof Error && error.message.startsWith("larger than")
        ? error
        : new Error("not a readable gzip file");
    }
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("not UTF-8 text");
  }
  const parsed = parseEpisodeRecords(text, limit);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}
