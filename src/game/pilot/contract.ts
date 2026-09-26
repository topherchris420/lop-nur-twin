/**
 * The action contract between Blacksite and a player "brain".
 *
 * A brain — the TypeSafe Jev model, the seeded random baseline, a recorded
 * trace — never touches game state. It picks one **control frame**: a movement,
 * a horizontal and a vertical view rotation, and a weapon action, each from a
 * closed, host-defined set.
 * The host turns that frame into the same `InputState` a keyboard and mouse
 * produce, holds it for a fixed window, and lets the existing player controller,
 * weapon runtime, collision world and damage resolver decide what actually
 * happens. Jev chooses; Blacksite decides the consequences.
 *
 * Everything a brain can ask for is enumerated here, versioned, and described in
 * words that explain what a control *does* without suggesting when to use it.
 * The server builds its TypeSafe question from these tables, and the browser
 * validates every decision against them, so neither side can execute a control
 * the other has never heard of.
 *
 * Only controls that the player rig actually consumes are listed. The input
 * layer also carries melee, interact, grenade and lean bindings, but nothing in
 * `PlayerRig` acts on the first three and lean only moves the camera — rounds
 * still leave from the un-leaned eye — so offering them would hand a brain
 * choices that do nothing.
 *
 * This module is imported by the Vercel function as well as the browser. The
 * function runs as native Node ESM, which resolves nothing without an explicit
 * extension, so the shared `pilot` modules import each other as `./x.js`
 * (TypeScript and Vite map that back to `./x.ts`) and import no aliases.
 */

export const ACTION_CONTRACT_VERSION = "blacksite-jev-actions/v1";
export const OBSERVATION_SCHEMA_VERSION = "blacksite-jev-observation/v1";
export const DECISION_SCHEMA_VERSION = "blacksite-jev-decision/v1";

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export const MOVE_ACTIONS = [
  "HOLD",
  "FORWARD",
  "BACK",
  "STRAFE_LEFT",
  "STRAFE_RIGHT",
  "FORWARD_LEFT",
  "FORWARD_RIGHT",
  "SPRINT_FORWARD",
  "JUMP",
  "CROUCH",
  "PRONE",
  "STAND",
] as const;

/**
 * Horizontal and vertical view rotation are separate axes, as they are on a
 * mouse. With one "aim" axis a frame could correct either the bearing or the
 * height of the crosshair, never both — and under recoil, which climbs every
 * burst, the crosshair drifted over every target while the corrections took
 * turns. Measured, not assumed: see docs/JEV_BLACKSITE.md.
 */
export const TURN_ACTIONS = [
  "NO_TURN",
  "TURN_LEFT_FINE",
  "TURN_RIGHT_FINE",
  "TURN_LEFT_SMALL",
  "TURN_RIGHT_SMALL",
  "TURN_LEFT_MEDIUM",
  "TURN_RIGHT_MEDIUM",
  "TURN_LEFT_LARGE",
  "TURN_RIGHT_LARGE",
  "TURN_AROUND",
] as const;

export const TILT_ACTIONS = [
  "NO_TILT",
  "LOOK_UP_FINE",
  "LOOK_DOWN_FINE",
  "LOOK_UP_SMALL",
  "LOOK_DOWN_SMALL",
  "LOOK_UP_MEDIUM",
  "LOOK_DOWN_MEDIUM",
] as const;

export const WEAPON_ACTIONS = [
  "NO_FIRE",
  "FIRE",
  "ADS",
  "ADS_FIRE",
  "RELOAD",
  "SWAP_WEAPON",
] as const;

export type MoveAction = (typeof MOVE_ACTIONS)[number];
export type TurnAction = (typeof TURN_ACTIONS)[number];
export type TiltAction = (typeof TILT_ACTIONS)[number];
export type WeaponAction = (typeof WEAPON_ACTIONS)[number];

export const AXES = ["move", "turn", "tilt", "weapon"] as const;
export type Axis = (typeof AXES)[number];

export interface AxisActions {
  move: MoveAction;
  turn: TurnAction;
  tilt: TiltAction;
  weapon: WeaponAction;
}

/** One decision: exactly one control per axis, held for one control window. */
export type ControlFrame = AxisActions;

export const AXIS_ACTIONS: { readonly [A in Axis]: readonly AxisActions[A][] } = {
  move: MOVE_ACTIONS,
  turn: TURN_ACTIONS,
  tilt: TILT_ACTIONS,
  weapon: WEAPON_ACTIONS,
};

/** The frame that does nothing. What every brain's input decays to. */
export const IDLE_FRAME: ControlFrame = {
  move: "HOLD",
  turn: "NO_TURN",
  tilt: "NO_TILT",
  weapon: "NO_FIRE",
};

export function isAxisAction<A extends Axis>(
  axis: A,
  value: unknown,
): value is AxisActions[A] {
  return (
    typeof value === "string" && (AXIS_ACTIONS[axis] as readonly string[]).includes(value)
  );
}

/** `STRAFE_LEFT · TURN_RIGHT_SMALL · LOOK_DOWN_SMALL · FIRE`, for the HUD and the trace. */
export function frameLabel(frame: ControlFrame): string {
  return AXES.map((axis) => frame[axis]).join(" · ");
}

/* ------------------------------------------------------------------ */
/* Timing — owned by the host, never by a brain                        */
/* ------------------------------------------------------------------ */

/**
 * How long one control frame is held, in **simulation** seconds.
 *
 * Measured TypeSafe round trips from a browser run 250–500 ms, so a new frame
 * normally replaces the previous one before this expires and control is
 * continuous. When decisions stop arriving — a timeout, an error, a takeover —
 * this is the longest any AI-held key can stay down.
 */
export const CONTROL_WINDOW_S = 0.4;

/** A view rotation completes within this much of the window, then holds. */
export const LOOK_APPLY_S = 0.15;

/** The browser never starts decisions closer together than this. */
export const MIN_DECISION_INTERVAL_MS = 200;

/** The server refuses a session's requests closer together than this. */
export const SERVER_MIN_INTERVAL_MS = 150;

/** The browser abandons a decision request after this long. */
export const REQUEST_TIMEOUT_MS = 2200;

/** The server abandons its call to TypeSafe after this long. */
export const UPSTREAM_TIMEOUT_MS = 1800;

/**
 * A decision about a situation older than this is stale and is discarded, not
 * executed: the world it was chosen for has moved on.
 */
export const MAX_DECISION_AGE_MS = 1500;

/* ------------------------------------------------------------------ */
/* What each control does to the input                                 */
/* ------------------------------------------------------------------ */

/** Held movement axes: `x` is right-positive, `y` forward-positive. */
export const MOVE_INPUT: Readonly<
  Record<MoveAction, { x: number; y: number; sprint: boolean }>
> = {
  HOLD: { x: 0, y: 0, sprint: false },
  FORWARD: { x: 0, y: 1, sprint: false },
  BACK: { x: 0, y: -1, sprint: false },
  STRAFE_LEFT: { x: -1, y: 0, sprint: false },
  STRAFE_RIGHT: { x: 1, y: 0, sprint: false },
  FORWARD_LEFT: { x: -1, y: 1, sprint: false },
  FORWARD_RIGHT: { x: 1, y: 1, sprint: false },
  SPRINT_FORWARD: { x: 0, y: 1, sprint: true },
  JUMP: { x: 0, y: 0, sprint: false },
  CROUCH: { x: 0, y: 0, sprint: false },
  PRONE: { x: 0, y: 0, sprint: false },
  STAND: { x: 0, y: 0, sprint: false },
};

/** Fixed horizontal rotations, degrees, clockwise-positive (right). */
export const TURN_STEP_DEG: Readonly<Record<TurnAction, number>> = {
  NO_TURN: 0,
  TURN_LEFT_FINE: -0.5,
  TURN_RIGHT_FINE: 0.5,
  TURN_LEFT_SMALL: -2,
  TURN_RIGHT_SMALL: 2,
  TURN_LEFT_MEDIUM: -6,
  TURN_RIGHT_MEDIUM: 6,
  TURN_LEFT_LARGE: -25,
  TURN_RIGHT_LARGE: 25,
  TURN_AROUND: 180,
};

/** Fixed vertical rotations, degrees, up-positive. */
export const TILT_STEP_DEG: Readonly<Record<TiltAction, number>> = {
  NO_TILT: 0,
  LOOK_UP_FINE: 0.5,
  LOOK_DOWN_FINE: -0.5,
  LOOK_UP_SMALL: 2,
  LOOK_DOWN_SMALL: -2,
  LOOK_UP_MEDIUM: 6,
  LOOK_DOWN_MEDIUM: -6,
};

export const WEAPON_INPUT: Readonly<
  Record<WeaponAction, { fire: boolean; ads: boolean; reload: boolean; swap: boolean }>
> = {
  NO_FIRE: { fire: false, ads: false, reload: false, swap: false },
  FIRE: { fire: true, ads: false, reload: false, swap: false },
  ADS: { fire: false, ads: true, reload: false, swap: false },
  ADS_FIRE: { fire: true, ads: true, reload: false, swap: false },
  RELOAD: { fire: false, ads: false, reload: true, swap: false },
  SWAP_WEAPON: { fire: false, ads: false, reload: false, swap: true },
};

/* ------------------------------------------------------------------ */
/* Descriptions — what a control does, never when to use it            */
/* ------------------------------------------------------------------ */

export const MOVE_DESCRIPTIONS: Readonly<Record<MoveAction, string>> = {
  HOLD: "Keep the feet still for this window.",
  FORWARD: "Walk forward, in the direction the view faces.",
  BACK: "Walk backward, away from the direction the view faces.",
  STRAFE_LEFT: "Step sideways to the left without turning the view.",
  STRAFE_RIGHT: "Step sideways to the right without turning the view.",
  FORWARD_LEFT: "Walk diagonally forward and to the left.",
  FORWARD_RIGHT: "Walk diagonally forward and to the right.",
  SPRINT_FORWARD:
    "Run forward at full speed. The weapon cannot fire or aim while sprinting.",
  JUMP: "Jump. Facing a ledge up to shoulder height, climb onto it instead.",
  CROUCH: "Crouch: a lower profile, slower movement and tighter weapon spread.",
  PRONE: "Lie flat: the lowest profile and tightest spread, but very slow movement.",
  STAND: "Stand up from a crouch or from lying flat.",
};

export const TURN_DESCRIPTIONS: Readonly<Record<TurnAction, string>> = {
  NO_TURN: "Keep the view facing the same direction.",
  TURN_LEFT_FINE: "Rotate the view 0.5 degrees to the left.",
  TURN_RIGHT_FINE: "Rotate the view 0.5 degrees to the right.",
  TURN_LEFT_SMALL: "Rotate the view 2 degrees to the left.",
  TURN_RIGHT_SMALL: "Rotate the view 2 degrees to the right.",
  TURN_LEFT_MEDIUM: "Rotate the view 6 degrees to the left.",
  TURN_RIGHT_MEDIUM: "Rotate the view 6 degrees to the right.",
  TURN_LEFT_LARGE: "Rotate the view 25 degrees to the left.",
  TURN_RIGHT_LARGE: "Rotate the view 25 degrees to the right.",
  TURN_AROUND: "Rotate the view 180 degrees, to face the opposite direction.",
};

export const TILT_DESCRIPTIONS: Readonly<Record<TiltAction, string>> = {
  NO_TILT: "Keep the view at the same height.",
  LOOK_UP_FINE: "Tilt the view 0.5 degrees up.",
  LOOK_DOWN_FINE: "Tilt the view 0.5 degrees down.",
  LOOK_UP_SMALL: "Tilt the view 2 degrees up.",
  LOOK_DOWN_SMALL: "Tilt the view 2 degrees down.",
  LOOK_UP_MEDIUM: "Tilt the view 6 degrees up.",
  LOOK_DOWN_MEDIUM: "Tilt the view 6 degrees down.",
};

export const WEAPON_DESCRIPTIONS: Readonly<Record<WeaponAction, string>> = {
  NO_FIRE: "Keep the trigger released and the weapon at the hip.",
  FIRE: "Hold the trigger and fire from the hip where the crosshair points.",
  ADS: "Aim down the sights without firing: tighter spread, slower movement.",
  ADS_FIRE: "Aim down the sights and hold the trigger.",
  RELOAD: "Start reloading the magazine from spare rounds.",
  SWAP_WEAPON: "Switch between the primary and the secondary weapon.",
};

export const AXIS_DESCRIPTIONS: {
  readonly [A in Axis]: Readonly<Record<AxisActions[A], string>>;
} = {
  move: MOVE_DESCRIPTIONS,
  turn: TURN_DESCRIPTIONS,
  tilt: TILT_DESCRIPTIONS,
  weapon: WEAPON_DESCRIPTIONS,
};

/** Maximum pitch a brain may tilt toward, in degrees; the rig clamps at ~88.9. */
export const PITCH_LIMIT_DEG = 80;
