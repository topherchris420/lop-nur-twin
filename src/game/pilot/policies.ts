import {
  TILT_STEP_DEG,
  TURN_STEP_DEG,
  type AimAction,
  type ControlFrame,
  type GoAction,
  type TargetAction,
  type TiltAction,
  type TurnAction,
  type WeaponAction,
} from "./contract";
import type { JevObservation, LegalActions, PlaceKind } from "./observation";
import type { DecisionProvider, DecisionRequest, ProviderResult } from "./loop";

/**
 * Scripted reference policies: hand-written players that sit in the same seat.
 *
 * They exist for measurement, not for show. A policy reads exactly the
 * observation a model reads, chooses only from the legal options it was
 * offered, and goes through the same executor, motor controller and rules. It
 * has no probabilities and claims none; the HUD labels it SCRIPTED.
 *
 * Why write them at all, when there is a random baseline and a live model:
 *
 *  - **Reproducing a strategy offline.** The matched benchmark found the model
 *    playing as a stationary long-range marksman the bots could not answer.
 *    `marksman` is that strategy written down. It runs without the network and
 *    without spending credit, so the question "does this game still reward
 *    standing in the open?" can be asked after every change to the game — and
 *    asked on matched seeds.
 *  - **A competent floor.** Random tells you what the controls do by
 *    themselves. A policy tells you what a plain, legible plan does with them,
 *    which is the more useful thing for a model to be compared against.
 *
 * Each policy is a pure function of the observation plus a few integers of its
 * own memory, so a seed, a policy name and the build reproduce its choices.
 * They describe behaviour, not skill: none of them aims — aiming is the motor
 * controller's job under precision control, and under direct control they turn
 * the view in the same fixed steps any brain would.
 */

export const SCRIPT_POLICIES = ["marksman", "skirmisher"] as const;
export type ScriptPolicy = (typeof SCRIPT_POLICIES)[number];

export const SCRIPT_POLICY_DESCRIPTIONS: Readonly<Record<ScriptPolicy, string>> = {
  marksman:
    "Holds its ground, aims down the sights and engages the enemy nearest the crosshair, the head beyond 40 m. The strategy the model found in the matched benchmark, written down.",
  skirmisher:
    "Keeps moving between the places the observation offers: toward cover when it is hurt or under fire, toward the objective or the last contact otherwise, and engages what it sees on the way.",
};

/** Largest offered rotation not larger than the wanted one; toward zero. */
function stepToward<T extends string>(
  wantedDeg: number,
  legal: readonly T[],
  steps: Readonly<Record<string, number>>,
  none: T,
): T {
  let best: T = none;
  let bestSize = 0;
  for (const action of legal) {
    const size = steps[action] ?? 0;
    if (size === 0 || Math.sign(size) !== Math.sign(wantedDeg)) continue;
    // TURN_AROUND is a 180° step, and only right-signed: skip it unless the
    // wanted turn is nearly behind.
    if (Math.abs(size) <= Math.abs(wantedDeg) + 0.25 && Math.abs(size) > bestSize) {
      best = action;
      bestSize = Math.abs(size);
    }
  }
  return legal.includes(best) ? best : (legal[0] as T);
}

function has<T>(options: readonly T[], value: T): boolean {
  return options.includes(value);
}

/** What the policy remembers between decisions. Integers and one bearing. */
interface PolicyMemory {
  decisions: number;
  /** Decisions since an enemy was last in view. */
  quiet: number;
}

function lookToward(
  obs: JevObservation,
  bearingDeg: number,
): { turn: TurnAction; tilt: TiltAction } {
  const turn = stepToward(bearingDeg, obs.legal.turn, TURN_STEP_DEG, "NO_TURN");
  const tilt = levelTilt(obs);
  return { turn, tilt };
}

/** Bring the view back toward level: the fight is on the ground. */
function levelTilt(obs: JevObservation): TiltAction {
  const pitch = obs.player.pitchDeg;
  if (Math.abs(pitch) < 0.4) return "NO_TILT";
  return stepToward(-pitch, obs.legal.tilt, TILT_STEP_DEG, "NO_TILT");
}

/** The freshest thing heard or felt, as a bearing from the crosshair. */
function freshestLead(obs: JevObservation): number | null {
  const damage = obs.perception.damage;
  if (damage) return damage.bearingDeg;
  const contact = obs.perception.contacts[0];
  return contact ? contact.bearingDeg : null;
}

function chooseTarget(obs: JevObservation): { target: TargetAction; aim: AimAction } {
  const enemies = obs.perception.visibleEnemies;
  if (enemies.length === 0 || obs.legal.target.length < 2) {
    return { target: obs.legal.target[0]!, aim: obs.legal.aim[0]! };
  }
  // Stay on the enemy already being tracked; otherwise the one nearest the
  // crosshair, which is the order perception lists them in.
  let slot = enemies.findIndex((e) => e.tracked);
  if (slot < 0) slot = 0;
  const target = `TARGET_${slot}` as TargetAction;
  const enemy = enemies[slot]!;
  const aim: AimAction =
    enemy.distanceM > 40 && enemy.headVisible
      ? "HEAD"
      : enemy.chestVisible
        ? "UPPER_CHEST"
        : "HEAD";
  return {
    target: has(obs.legal.target, target) ? target : obs.legal.target[0]!,
    aim: has(obs.legal.aim, aim) ? aim : obs.legal.aim[0]!,
  };
}

function weaponFor(obs: JevObservation, engaging: boolean): WeaponAction {
  const legal = obs.legal.weapon;
  const w = obs.weapon;
  if (engaging) {
    if (has(legal, "ADS_FIRE")) return "ADS_FIRE";
    if (w.ammo === 0 && has(legal, "RELOAD")) return "RELOAD";
    if (w.ammo === 0 && has(legal, "SWAP_WEAPON") && w.reserve === 0)
      return "SWAP_WEAPON";
    return has(legal, "ADS") ? "ADS" : "NO_FIRE";
  }
  if (w.ammo < w.magSize * 0.5 && has(legal, "RELOAD")) return "RELOAD";
  return "NO_FIRE";
}

/**
 * Direct control has no target axis: point the crosshair with fixed steps.
 * The same rotations any brain has, chosen by the same arithmetic the server
 * states in words.
 */
function directAim(obs: JevObservation): { turn: TurnAction; tilt: TiltAction } {
  const enemy = obs.perception.visibleEnemies[0]!;
  const turn = stepToward(enemy.bearingDeg, obs.legal.turn, TURN_STEP_DEG, "NO_TURN");
  const tilt = stepToward(enemy.elevationDeg, obs.legal.tilt, TILT_STEP_DEG, "NO_TILT");
  return { turn, tilt };
}

function marksman(obs: JevObservation, memory: PolicyMemory): ControlFrame {
  const enemies = obs.perception.visibleEnemies;
  const engaging = enemies.length > 0;
  const { target, aim } = chooseTarget(obs);
  let look: { turn: TurnAction; tilt: TiltAction };
  if (engaging) {
    look =
      obs.control === "precision" ? { turn: "NO_TURN", tilt: "NO_TILT" } : directAim(obs);
  } else {
    const lead = freshestLead(obs);
    look =
      lead !== null
        ? lookToward(obs, lead)
        : // Nothing seen or heard: sweep the horizon a quarter turn at a time,
          // pausing between turns so a sweep can actually spot something.
          memory.quiet % 4 === 3
          ? {
              turn: has(obs.legal.turn, "TURN_RIGHT_LARGE")
                ? "TURN_RIGHT_LARGE"
                : "NO_TURN",
              tilt: levelTilt(obs),
            }
          : { turn: "NO_TURN", tilt: levelTilt(obs) };
  }
  return {
    move: "HOLD",
    turn: look.turn,
    tilt: look.tilt,
    weapon: weaponFor(obs, engaging),
    target,
    aim,
    go: "NONE",
  };
}

/** The slot of the first listed place of one of these kinds, in preference order. */
function placeOf(obs: JevObservation, kinds: readonly PlaceKind[]): GoAction | null {
  for (const kind of kinds) {
    const index = obs.perception.places.findIndex((p) => p.kind === kind);
    if (index >= 0) {
      const go = `PLACE_${index}` as GoAction;
      if (has(obs.legal.go, go)) return go;
    }
  }
  return null;
}

/**
 * Under places navigation the skirmisher's plan is short and legible: hurt or
 * hit, get to cover; enemies far off, get nearer without being seen; nothing
 * in view, go where the fighting was heard or to the objective. While a
 * travel is under way it keeps going. It shoots whatever it sees on the way,
 * as the marksman would.
 */
function skirmisherPlaces(obs: JevObservation, memory: PolicyMemory): ControlFrame {
  const base = marksman(obs, memory);
  const enemies = obs.perception.visibleEnemies;
  const hurt = obs.player.health < 60 || obs.perception.damage !== null;
  const nearest = enemies.reduce((m, e) => Math.min(m, e.distanceM), Infinity);
  const travelling = obs.travel !== null && has(obs.legal.go, "CONTINUE");
  const takingCover =
    travelling && (obs.travel?.kind === "cover" || obs.travel?.kind === "withdraw");
  let go: GoAction | null = null;
  if (hurt) go = takingCover ? "CONTINUE" : placeOf(obs, ["cover", "withdraw"]);
  else if (travelling) go = "CONTINUE";
  else if (enemies.length > 0 && nearest > 45) go = placeOf(obs, ["advance", "flank"]);
  else if (enemies.length === 0) go = placeOf(obs, ["advance", "objective", "flank"]);
  if (go === null && obs.travel && has(obs.legal.go, "CONTINUE")) go = "CONTINUE";
  return { ...base, go: go ?? "NONE" };
}

/**
 * Without a navigation axis the skirmisher can only walk relative to the view:
 * it strafes while engaging and walks toward what it heard otherwise. Once the
 * contract offers places it will choose among those instead.
 */
function skirmisher(obs: JevObservation, memory: PolicyMemory): ControlFrame {
  if (obs.navigation === "places") return skirmisherPlaces(obs, memory);
  const base = marksman(obs, memory);
  const legal = obs.legal.move;
  const engaging = obs.perception.visibleEnemies.length > 0;
  const hurt = obs.player.health < 60 || obs.perception.damage !== null;
  let move = base.move;
  if (engaging) {
    const strafe =
      Math.floor(memory.decisions / 6) % 2 === 0 ? "STRAFE_LEFT" : "STRAFE_RIGHT";
    move = has(legal, strafe) ? strafe : "HOLD";
  } else if (hurt && has(legal, "BACK")) {
    move = "BACK";
  } else if (freshestLead(obs) !== null) {
    move = has(legal, "FORWARD") ? "FORWARD" : "HOLD";
  } else if (obs.objective.kind !== "none" && obs.objective.bearingDeg !== null) {
    move = has(legal, "FORWARD") ? "FORWARD" : "HOLD";
    return {
      ...base,
      move,
      turn: stepToward(
        obs.objective.bearingDeg,
        obs.legal.turn,
        TURN_STEP_DEG,
        "NO_TURN",
      ),
    };
  }
  return { ...base, move };
}

const POLICIES: Readonly<
  Record<ScriptPolicy, (obs: JevObservation, memory: PolicyMemory) => ControlFrame>
> = { marksman, skirmisher };

/** Every axis of a frame is one of the options the observation made legal. */
export function isLegalFrame(frame: ControlFrame, legal: LegalActions): boolean {
  return (
    has(legal.move, frame.move) &&
    has(legal.turn, frame.turn) &&
    has(legal.tilt, frame.tilt) &&
    has(legal.weapon, frame.weapon) &&
    has(legal.target, frame.target) &&
    has(legal.aim, frame.aim) &&
    has(legal.go, frame.go)
  );
}

export class ScriptedProvider implements DecisionProvider {
  readonly kind = "script" as const;
  private readonly memory: PolicyMemory = { decisions: 0, quiet: 0 };

  constructor(readonly policy: ScriptPolicy) {}

  /** One decision from one observation. Deterministic given the history. */
  pick(obs: JevObservation): ControlFrame {
    const frame = POLICIES[this.policy](obs, this.memory);
    this.memory.decisions += 1;
    this.memory.quiet =
      obs.perception.visibleEnemies.length > 0 ? 0 : this.memory.quiet + 1;
    // A policy bug must never become an illegal control: fall back per axis
    // to the first legal option, which is always the "do nothing" one.
    const legal = obs.legal;
    return {
      move: has(legal.move, frame.move) ? frame.move : legal.move[0]!,
      turn: has(legal.turn, frame.turn) ? frame.turn : legal.turn[0]!,
      tilt: has(legal.tilt, frame.tilt) ? frame.tilt : legal.tilt[0]!,
      weapon: has(legal.weapon, frame.weapon) ? frame.weapon : legal.weapon[0]!,
      target: has(legal.target, frame.target) ? frame.target : legal.target[0]!,
      aim: has(legal.aim, frame.aim) ? frame.aim : legal.aim[0]!,
      go: has(legal.go, frame.go) ? frame.go : legal.go[0]!,
    };
  }

  decide({ observation }: DecisionRequest): Promise<ProviderResult> {
    return Promise.resolve({
      ok: true,
      decision: {
        frame: this.pick(observation),
        axes: null,
        model: null,
        serverLatencyMs: null,
        usage: null,
      },
    });
  }
}
