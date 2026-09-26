import {
  CONTROL_WINDOW_S,
  LOOK_APPLY_S,
  TILT_STEP_DEG,
  TURN_STEP_DEG,
  MOVE_INPUT,
  WEAPON_INPUT,
  type ControlFrame,
} from "./contract";
import type { InputState } from "../core/gameState";
import type { FireMode, Stance } from "../core/types";

/**
 * Turns one control frame into the `InputState` the player rig consumes.
 *
 * This is the only code a brain's decision passes through on its way to the
 * game, and it writes exactly the fields a keyboard and mouse would:
 *
 *  - **Held controls** (movement, sprint, trigger, aim-down-sights) are written
 *    every frame while the control window is open and cleared when it closes.
 *    A frame always expires: if no new decision arrives — a timeout, an error,
 *    a takeover — nothing stays held for more than `CONTROL_WINDOW_S`.
 *  - **One-shot controls** (jump, stance, reload, swap) raise the matching
 *    `*Pressed` edge once, on the first frame. The rig clears edges after each
 *    step, exactly as it does for a key press.
 *  - **View rotation** is a fixed step spread over `LOOK_APPLY_S` through
 *    `lookYaw`/`lookPitch` — the mouse path. Nothing here writes the camera or
 *    the player's yaw; the rig integrates the deltas, and recoil is added on
 *    top of them as it is for a human.
 *
 * Stance controls resolve against the stance at execution time, not at
 * decision time, so a STAND chosen while crouched cannot toggle a player who
 * has since stood up back into a crouch.
 */

export interface ExecutionContext {
  /** Simulation time, seconds. */
  simTime: number;
  /** This frame's simulation step, seconds. */
  dt: number;
  stance: Stance;
  fireMode: FireMode;
}

export type FrameEndReason = "expired" | "replaced" | "cleared";

const DEG = Math.PI / 180;

export class ActionExecutor {
  private frame: ControlFrame | null = null;
  private startedAt = 0;
  private expiresAt = 0;
  private edgesPending = false;
  private yawRemainingDeg = 0;
  private pitchRemainingDeg = 0;
  private yawRateDegPerS = 0;
  private pitchRateDegPerS = 0;
  /** Whether the trigger was down last frame, so a semi-auto can re-press. */
  private triggerDown = false;
  /** Look deltas written on the last applied frame, for weapon sway. */
  lastLookYaw = 0;
  lastLookPitch = 0;

  /** Called when a frame stops executing, for the recorder. */
  onFrameEnd:
    ((frame: ControlFrame, reason: FrameEndReason, simTime: number) => void) | null =
    null;

  get current(): ControlFrame | null {
    return this.frame;
  }

  get startTime(): number {
    return this.startedAt;
  }

  get expiryTime(): number {
    return this.expiresAt;
  }

  /** Begin executing a frame now, replacing whatever was running. */
  start(frame: ControlFrame, simTime: number): void {
    if (this.frame) this.onFrameEnd?.(this.frame, "replaced", simTime);
    this.frame = frame;
    this.startedAt = simTime;
    this.expiresAt = simTime + CONTROL_WINDOW_S;
    this.edgesPending = true;
    const yaw = TURN_STEP_DEG[frame.turn];
    const pitch = TILT_STEP_DEG[frame.tilt];
    this.yawRemainingDeg = yaw;
    this.pitchRemainingDeg = pitch;
    this.yawRateDegPerS = Math.abs(yaw) / LOOK_APPLY_S;
    this.pitchRateDegPerS = Math.abs(pitch) / LOOK_APPLY_S;
  }

  /**
   * Write this frame's controls into `input`. Call once per simulation step,
   * before the rig consumes the input.
   */
  apply(input: InputState, context: ExecutionContext): void {
    this.lastLookYaw = 0;
    this.lastLookPitch = 0;
    const frame = this.frame;
    if (frame && context.simTime >= this.expiresAt) {
      this.frame = null;
      this.onFrameEnd?.(frame, "expired", context.simTime);
    }
    if (!this.frame) {
      releaseHeld(input);
      this.triggerDown = false;
      return;
    }
    const active = this.frame;

    const move = MOVE_INPUT[active.move];
    input.moveX = move.x;
    input.moveY = move.y;
    input.sprint = move.sprint;
    input.jump = false;
    input.crouch = false;
    input.leanLeft = false;
    input.leanRight = false;

    const weapon = WEAPON_INPUT[active.weapon];
    input.ads = weapon.ads;
    // A semi-automatic weapon fires on the trigger's rising edge, so a new
    // FIRE frame after a held one releases for a single step first. Automatic
    // fire keeps the trigger down across frames, as a held mouse button would.
    const repress =
      this.edgesPending && weapon.fire && this.triggerDown && context.fireMode !== "auto";
    input.fire = weapon.fire && !repress;
    this.triggerDown = input.fire;

    if (this.edgesPending) {
      this.edgesPending = false;
      switch (active.move) {
        case "JUMP":
          input.jumpPressed = true;
          break;
        case "CROUCH":
          if (context.stance !== "crouch") input.crouchPressed = true;
          break;
        case "PRONE":
          if (context.stance !== "prone") input.pronePressed = true;
          break;
        case "STAND":
          if (context.stance === "crouch") input.crouchPressed = true;
          else if (context.stance === "prone") input.pronePressed = true;
          break;
        default:
          break;
      }
      if (weapon.reload) input.reloadPressed = true;
      if (weapon.swap) input.swapPressed = true;
      if (input.fire) input.firePressed = true;
    }

    // The rig's convention: positive yaw turns left, positive pitch looks up.
    if (this.yawRemainingDeg !== 0) {
      const step = Math.min(
        Math.abs(this.yawRemainingDeg),
        this.yawRateDegPerS * context.dt,
      );
      const signed = Math.sign(this.yawRemainingDeg) * step;
      this.yawRemainingDeg -= signed;
      if (Math.abs(this.yawRemainingDeg) < 1e-9) this.yawRemainingDeg = 0;
      input.lookYaw -= signed * DEG;
      this.lastLookYaw = -signed * DEG;
    }
    if (this.pitchRemainingDeg !== 0) {
      const step = Math.min(
        Math.abs(this.pitchRemainingDeg),
        this.pitchRateDegPerS * context.dt,
      );
      const signed = Math.sign(this.pitchRemainingDeg) * step;
      this.pitchRemainingDeg -= signed;
      if (Math.abs(this.pitchRemainingDeg) < 1e-9) this.pitchRemainingDeg = 0;
      input.lookPitch += signed * DEG;
      this.lastLookPitch = signed * DEG;
    }
  }

  /**
   * Stop immediately and release everything a brain could be holding: takeover,
   * death, a brain switch, the end of a match.
   */
  clear(input: InputState, simTime: number): void {
    const frame = this.frame;
    this.frame = null;
    this.edgesPending = false;
    this.yawRemainingDeg = 0;
    this.pitchRemainingDeg = 0;
    this.triggerDown = false;
    this.lastLookYaw = 0;
    this.lastLookPitch = 0;
    releaseHeld(input);
    releaseEdges(input);
    if (frame) this.onFrameEnd?.(frame, "cleared", simTime);
  }
}

/** Every held control a brain can set, released. */
export function releaseHeld(input: InputState): void {
  input.moveX = 0;
  input.moveY = 0;
  input.sprint = false;
  input.fire = false;
  input.ads = false;
  input.jump = false;
  input.crouch = false;
  input.leanLeft = false;
  input.leanRight = false;
  input.scoreboard = false;
}

/** Every one-shot edge and pending look delta, cleared. */
export function releaseEdges(input: InputState): void {
  input.jumpPressed = false;
  input.crouchPressed = false;
  input.pronePressed = false;
  input.firePressed = false;
  input.reloadPressed = false;
  input.swapPressed = false;
  input.meleePressed = false;
  input.usePressed = false;
  input.grenadePressed = false;
  input.tacticalPressed = false;
  input.killstreakPressed = -1;
  input.fireModePressed = false;
  input.inspectPressed = false;
  input.tacStancePressed = false;
  input.tacSprintPressed = false;
  input.slideCancelPressed = false;
  input.lookYaw = 0;
  input.lookPitch = 0;
}
