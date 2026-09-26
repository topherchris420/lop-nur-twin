import {
  AXIS_DESCRIPTIONS,
  AXIS_ACTIONS,
  CONTROL_WINDOW_S,
  type Axis,
  type AxisActions,
} from "../../src/game/pilot/contract.js";
import {
  askedAxes,
  type Contact,
  type JevObservation,
  type VisibleEnemy,
} from "../../src/game/pilot/observation.js";
import {
  aimRegionGeometry,
  angularRadiusDeg,
  chanceBand,
  coneHitFraction,
} from "../../src/game/pilot/hitGeometry.js";

/**
 * The TypeSafe question, built on the server from a validated observation.
 *
 * Nothing the browser sends is forwarded as text. The observation is numbers and
 * enums; this module turns them into the state and the four Choice questions
 * Jev answers — one per control axis, asked together so they run in parallel —
 * and the option descriptions come from the versioned action contract.
 *
 * TypeSafe's own guidance shapes the rendering: Jev reads semantic
 * descriptions better than raw numbers, so the arithmetic is done here. An
 * enemy's offset from the crosshair is given in degrees *and* as the size class
 * of the view rotations on offer; a distance comes with a range band. None of
 * it says which control to pick — the descriptions explain what each control
 * does, and the state explains what the player can see.
 */

export interface SystemOneRequest {
  model: string;
  state: Record<string, unknown>;
  questions: Partial<
    Record<
      Axis,
      {
        type: "choice";
        instructions: { context: string; question: string };
        criteria: Record<string, string>;
      }
    >
  >;
}

const MODE_NAMES: Record<JevObservation["match"]["mode"], string> = {
  tdm: "team deathmatch",
  ffa: "free-for-all",
  domination: "domination",
  hardpoint: "hardpoint",
  gunfight: "gunfight",
};

const MODE_RULES: Record<JevObservation["match"]["mode"], string> = {
  tdm: "Two teams fight; a team scores a point for every enemy it eliminates, and eliminated players return after a few seconds.",
  ffa: "Every other player is an enemy; the player scores by eliminating them, and eliminated players return after a few seconds.",
  domination:
    "Two teams score over time for every capture zone they hold; standing inside a zone captures it. Eliminated players return after a few seconds.",
  hardpoint:
    "Two teams score while they hold the single active zone, which moves during the match. Eliminated players return after a few seconds.",
  gunfight: "Two small teams fight short rounds.",
};

const WEAPON_NAMES: Record<JevObservation["weapon"]["weaponClass"], string> = {
  assault: "assault rifle",
  smg: "submachine gun",
  lmg: "light machine gun",
  marksman: "marksman rifle",
  sniper: "sniper rifle",
  shotgun: "shotgun",
  pistol: "pistol",
  launcher: "launcher",
  melee: "knife",
};

const TRIGGER_NAMES: Record<JevObservation["weapon"]["fireMode"], string> = {
  auto: "automatic: fires continuously while the trigger is held",
  semi: "semi-automatic: one round per trigger pull",
  burst: "burst: a short burst per trigger pull",
  bolt: "bolt action: one round, then a pause",
  pump: "pump action: one shell, then a pause",
};

const round = (value: number, digits = 0): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

function side(bearingDeg: number): "left" | "right" {
  return bearingDeg < 0 ? "left" : "right";
}

/**
 * Size class of an angular offset, in the units of the rotations on offer:
 * fine 0.5°, small 2°, medium 6°, large 25°.
 */
function offsetClass(degrees: number): string {
  const magnitude = Math.abs(degrees);
  if (magnitude < 0.25) return "none";
  if (magnitude < 1.2) return "fine";
  if (magnitude < 4) return "small";
  if (magnitude < 15) return "medium";
  if (magnitude <= 90) return "large";
  return "behind you";
}

function rangeBand(distanceM: number): string {
  if (distanceM < 10) return "close range";
  if (distanceM < 40) return "medium range";
  if (distanceM < 100) return "long range";
  return "very long range";
}

/** Where something lies around the player, relative to the view direction. */
function around(bearingDeg: number): string {
  const magnitude = Math.abs(bearingDeg);
  const s = side(bearingDeg);
  if (magnitude <= 20) return `ahead (${round(magnitude)} degrees ${s})`;
  if (magnitude <= 70) return `ahead and to the ${s} (${round(magnitude)} degrees ${s})`;
  if (magnitude <= 110) return `to the ${s} (${round(magnitude)} degrees ${s})`;
  if (magnitude <= 160)
    return `behind and to the ${s} (${round(magnitude)} degrees ${s})`;
  return "directly behind";
}

/**
 * One visible enemy. Where it is relative to the crosshair, and the same fact
 * restated as the rotation that would centre the crosshair on it — Jev reads a
 * direct statement better than one it has to invert. Whether to aim at it, and
 * which one, is Jev's decision.
 */
function describeEnemy(enemy: VisibleEnemy): Record<string, unknown> {
  const h = Math.abs(enemy.bearingDeg);
  const v = Math.abs(enemy.elevationDeg);
  const horizontal =
    offsetClass(enemy.bearingDeg) === "none"
      ? "none needed"
      : `${side(enemy.bearingDeg)}, ${offsetClass(enemy.bearingDeg)} (${round(h, 1)} degrees)`;
  const vertical =
    offsetClass(enemy.elevationDeg) === "none"
      ? "none needed"
      : `${enemy.elevationDeg > 0 ? "up" : "down"}, ${offsetClass(enemy.elevationDeg)} (${round(v, 1)} degrees)`;
  return {
    distance: `${round(enemy.distanceM)} m (${rangeBand(enemy.distanceM)})`,
    crosshair_on_enemy: enemy.onCrosshair,
    turn_to_centre_crosshair: horizontal,
    tilt_to_centre_crosshair: vertical,
    shooting: enemy.firing,
  };
}

function motion(lateralMps: number): string {
  const speed = Math.abs(lateralMps);
  if (speed < 0.5) return "not moving across the view";
  return `moving ${lateralMps > 0 ? "right" : "left"} across the view at ${round(speed, 1)} m/s`;
}

function exposure(enemy: VisibleEnemy): string {
  if (enemy.headVisible && enemy.chestVisible) return "fully exposed";
  if (enemy.headVisible) return "partly covered: only the head is in clear sight";
  return "partly covered: the head is hidden";
}

/**
 * The same enemy, for precision control: named by the slot the target choice
 * offers, with how large each aim region looks and what share of the weapon's
 * cone would land on it — hip and aimed. The arithmetic is done here, from the
 * observation's own spread and distance, so Jev compares words, not angles.
 */
function describeTarget(
  enemy: VisibleEnemy,
  obs: JevObservation,
): Record<string, unknown> {
  const w = obs.weapon;
  const regions = AXIS_ACTIONS.aim.map((aim) => {
    const geometry = aimRegionGeometry(aim, "stand");
    const radius = angularRadiusDeg(geometry.radiusM, enemy.distanceM);
    return {
      aim,
      widthDeg: round(radius * 2, 2),
      now: chanceBand(coneHitFraction(0, w.spreadDeg, radius)),
      aimed: chanceBand(coneHitFraction(0, w.aimedSpreadDeg, radius)),
    };
  });
  return {
    ...describeEnemy(enemy),
    exposure: exposure(enemy),
    motion: motion(enemy.lateralMps),
    being_tracked: enemy.tracked,
    chance_per_round_with_crosshair_on_it: Object.fromEntries(
      regions.map((r) => [
        r.aim,
        `${r.widthDeg} degrees wide; ${r.now} with the current spread, ${r.aimed} fully aimed`,
      ]),
    ),
  };
}

function describeContact(contact: Contact): Record<string, unknown> {
  return {
    kind: contact.source === "gunfire" ? "enemy gunfire heard" : "enemy last seen",
    direction: around(contact.bearingDeg),
    distance: `about ${round(contact.distanceM)} m`,
    when: `${round(contact.ageS, 1)} seconds ago`,
  };
}

function obstacle(distanceM: number | null, where: string, climbable = false): string {
  if (distanceM === null) return `clear for at least 8 m ${where}`;
  const base = `blocked ${round(distanceM, 1)} m ${where}`;
  return climbable ? `${base} (low enough to climb)` : base;
}

function magazine(ammo: number, magSize: number): string {
  const fraction = ammo / magSize;
  const band =
    ammo === 0
      ? "empty"
      : ammo === magSize
        ? "full"
        : fraction > 0.5
          ? "more than half"
          : fraction > 0.25
            ? "less than half"
            : "nearly empty";
  return `${ammo} of ${magSize} rounds (${band})`;
}

function health(value: number): string {
  const band =
    value >= 99 ? "full" : value >= 70 ? "healthy" : value >= 40 ? "hurt" : "badly hurt";
  return `${round(value)} of 100 (${band})`;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)} min ${whole % 60} s`;
}

function outcome(obs: JevObservation): string | null {
  const result = obs.previous.outcome;
  if (!result) return null;
  const parts: string[] = [];
  parts.push(
    result.shotsFired > 0
      ? `fired ${result.shotsFired} round${result.shotsFired === 1 ? "" : "s"}`
      : "fired nothing",
  );
  if (result.killConfirmed) parts.push("eliminated an enemy");
  else if (result.hitConfirmed) parts.push("hit an enemy");
  else if (result.shotsFired > 0) parts.push("no hit confirmed");
  if (result.damageTaken) parts.push("took damage");
  if (result.movementBlocked) parts.push("movement was blocked");
  return parts.join("; ");
}

/** The state Jev reads: what the player can see and what the HUD shows. */
export function renderState(obs: JevObservation): Record<string, unknown> {
  const p = obs.player;
  const w = obs.weapon;
  const perception = obs.perception;
  const state: Record<string, unknown> = {
    match: {
      mode: MODE_NAMES[obs.match.mode],
      phase: obs.match.phase,
      time_left: clock(obs.match.timeRemainingS),
      score: `your team ${obs.match.ownScore}, enemies ${obs.match.enemyScore}`,
    },
    you: {
      health: health(p.health),
      stance:
        p.stance === "stand"
          ? "standing"
          : p.stance === "crouch"
            ? "crouching"
            : "lying flat",
      movement: p.motion,
      aiming_down_sights:
        p.adsProgress > 0.9 ? "yes" : p.adsProgress > 0.1 ? "partly" : "no",
      view:
        Math.abs(p.pitchDeg) < 2
          ? "level"
          : `${round(Math.abs(p.pitchDeg))} degrees ${p.pitchDeg > 0 ? "up" : "down"}`,
    },
    weapon: {
      type: WEAPON_NAMES[w.weaponClass],
      slot: w.slot,
      trigger: TRIGGER_NAMES[w.fireMode],
      magazine: magazine(w.ammo, w.magSize),
      spare_rounds: w.reserve,
      reloading: w.reloading,
      can_fire: w.canFire ? "yes" : "no, not while sprinting or climbing",
      ...(obs.control === "precision"
        ? {
            spread: `${round(w.spreadDeg, 2)} degrees now; ${round(w.aimedSpreadDeg, 2)} degrees fully aimed and still`,
          }
        : {}),
    },
    // Nearest to the crosshair first: the order the perception layer sorts in.
    // In precision control each one is keyed by the target slot that names it.
    enemies_in_view_nearest_crosshair_first:
      perception.visibleEnemies.length === 0
        ? "none"
        : obs.control === "precision"
          ? Object.fromEntries(
              perception.visibleEnemies.map((enemy, i) => [
                `TARGET_${i}`,
                describeTarget(enemy, obs),
              ]),
            )
          : perception.visibleEnemies.map(describeEnemy),
    other_contacts:
      perception.contacts.length > 0 ? perception.contacts.map(describeContact) : "none",
    damage: perception.damage
      ? `hit ${round(perception.damage.ageS, 1)} seconds ago from ${around(perception.damage.bearingDeg)}`
      : "none in the last 1.5 seconds",
    surroundings: {
      ahead: obstacle(
        perception.obstacles.forwardM,
        "ahead",
        perception.obstacles.forwardClimbable,
      ),
      left: obstacle(perception.obstacles.leftM, "to the left"),
      right: obstacle(perception.obstacles.rightM, "to the right"),
      behind: obstacle(perception.obstacles.backM, "behind"),
    },
  };
  if (obs.objective.kind !== "none" && obs.objective.bearingDeg !== null) {
    state["objective"] = {
      kind: obs.objective.kind === "hardpoint" ? "active hardpoint zone" : "capture zone",
      direction: around(obs.objective.bearingDeg),
      distance:
        obs.objective.distanceM === null
          ? "unknown"
          : `${round(obs.objective.distanceM)} m`,
      held_by:
        obs.objective.state === "friendly"
          ? "your team"
          : obs.objective.state === "enemy"
            ? "the enemy"
            : obs.objective.state === "contested"
              ? "contested"
              : "nobody",
    };
  }
  const result = outcome(obs);
  if (obs.previous.frame && result) {
    const { target, aim, ...core } = obs.previous.frame;
    state["last_control"] =
      obs.control === "precision"
        ? { ...core, target, aim, result }
        : { ...core, result };
  }
  return state;
}

function context(obs: JevObservation): string {
  return [
    "You control one player in Blacksite, a first-person shooter.",
    MODE_RULES[obs.match.mode],
    "Rounds travel where the crosshair points, give or take weapon spread; aiming down the sights tightens the spread.",
    "Health regenerates a few seconds after the player stops taking damage.",
    ...(obs.control === "precision"
      ? [
          "A local aiming controller carries out the target choice: it turns the view onto the chosen enemy continuously and, while the weapon choice fires, pulls the trigger only when the crosshair is on the chosen part of it. While an enemy is tracked, the turn and tilt choices are not applied. It never picks an enemy by itself.",
        ]
      : []),
    `This choice controls the next ${CONTROL_WINDOW_S} seconds; after it you will see the new situation and choose again.`,
  ].join(" ");
}

const QUESTIONS: Record<Axis, string> = {
  target: `Which enemy in view should the aiming controller track during the next ${CONTROL_WINDOW_S} seconds?`,
  aim: "Which part of the tracked enemy should the crosshair be held on?",
  move: `Which movement should the player make during the next ${CONTROL_WINDOW_S} seconds?`,
  turn: `Which horizontal view rotation should the player make during the next ${CONTROL_WINDOW_S} seconds? The crosshair is at the centre of the view.`,
  tilt: `Which vertical view rotation should the player make during the next ${CONTROL_WINDOW_S} seconds? The crosshair is at the centre of the view.`,
  weapon: `What should the player do with the weapon during the next ${CONTROL_WINDOW_S} seconds?`,
};

function criteria<A extends Axis>(
  axis: A,
  legal: readonly AxisActions[A][],
): Record<string, string> {
  const descriptions = AXIS_DESCRIPTIONS[axis] as Readonly<Record<string, string>>;
  const out: Record<string, string> = {};
  for (const action of legal) out[action] = descriptions[action] ?? "";
  return out;
}

/** The complete TypeSafe request for one decision. The server owns every word. */
export function buildSystemOneRequest(
  obs: JevObservation,
  model: string,
): SystemOneRequest {
  const shared = context(obs);
  const question = (axis: Axis): SystemOneRequest["questions"][Axis] => ({
    type: "choice",
    instructions: { context: shared, question: QUESTIONS[axis] },
    criteria: criteria(axis, obs.legal[axis]),
  });
  // Every asked axis goes in one request: TypeSafe evaluates them in parallel
  // against the same state, so six questions cost barely more time than one.
  // An axis with a single legal option is not a question and is not sent.
  const questions: SystemOneRequest["questions"] = {};
  for (const axis of askedAxes(obs.legal)) questions[axis] = question(axis);
  return { model, state: renderState(obs), questions };
}
