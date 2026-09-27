import type { InputState } from "../core/gameState";
import type { PlaceKind } from "./observation";

/**
 * The place navigator: the feet's counterpart of the precision motor
 * controller.
 *
 * A brain under places navigation may name a place the observation listed.
 * The navigator then walks or runs the body toward that fixed world point, a
 * step at a time, through exactly the fields a keyboard fills — `moveX`,
 * `moveY` and `sprint` — so the player controller, its speeds, its collision
 * and its stamina rules apply exactly as they do to a person pressing W. It
 * never turns the view (the brain's turn and tilt choices, or the motor
 * controller, own the crosshair), never jumps, never changes stance, never
 * fires. It moves relative to the body's current facing, so it can strafe
 * toward cover while the crosshair stays on an enemy.
 *
 * It lets go — and says why — when the body arrives, when it makes no
 * progress for a second and a half (something in the way the straight line
 * did not show), when no decision has re-confirmed the destination for 1.5 s
 * (an outage), or when a decision chooses NONE. A new place replaces the old.
 * There is no fallback destination: it never chooses where to go.
 *
 * Steering is a straight line with feelers: if a short probe along the wanted
 * direction meets something at waist height, it tries 35° and then 70° either
 * side, nearer side first. Places are offered only when the straight walk is
 * clear, so the feelers are for bodies and props that moved in the meantime.
 */

export const ARRIVE_M = 1.1;
/** No re-confirmation for this long releases the destination. */
export const CONFIRM_TIMEOUT_S = 1.5;
/** Requested movement with less progress than this for STUCK_S releases it. */
const STUCK_S = 1.5;
const STUCK_PROGRESS_M = 0.6;
/** Sprint only toward a place this far off, when not firing. */
const SPRINT_BEYOND_M = 6;
const FEELER_M = 1.6;
const FEELER_ANGLES = [0, 0.61, -0.61, 1.22, -1.22];

export type NavigatorRelease = "arrived" | "blocked" | "timeout" | "cleared" | "replaced";

export interface NavSense {
  now: number;
  x: number;
  z: number;
  /** Body yaw, radians; yaw 0 faces -z. */
  yaw: number;
  /** Distance to the nearest obstacle along a horizontal direction at waist height, or null. */
  probe: (dirX: number, dirZ: number, range: number) => number | null;
}

export interface NavTelemetry {
  active: boolean;
  kind: PlaceKind | null;
  remainingM: number | null;
  sprinting: boolean;
}

export interface NavEvents {
  onGo?: (kind: PlaceKind, distanceM: number) => void;
  onRelease?: (reason: NavigatorRelease, kind: PlaceKind, travelledS: number) => void;
}

interface Destination {
  x: number;
  z: number;
  kind: PlaceKind;
  since: number;
  confirmedAt: number;
  progressAt: number;
  bestRemaining: number;
}

export class PlaceNavigator {
  private destination: Destination | null = null;
  readonly telemetry: NavTelemetry = {
    active: false,
    kind: null,
    remainingM: null,
    sprinting: false,
  };
  events: NavEvents = {};

  get active(): boolean {
    return this.destination !== null;
  }

  get kind(): PlaceKind | null {
    return this.destination?.kind ?? null;
  }

  /** Where it is going, for the observation's `travel` field. Never sent as coordinates. */
  get target(): { x: number; z: number; kind: PlaceKind } | null {
    const d = this.destination;
    return d ? { x: d.x, z: d.z, kind: d.kind } : null;
  }

  /** A decision named a place. */
  go(
    place: { x: number; z: number; kind: PlaceKind },
    now: number,
    from: { x: number; z: number },
  ): void {
    if (this.destination) this.release("replaced", now);
    const remaining = Math.hypot(place.x - from.x, place.z - from.z);
    this.destination = {
      x: place.x,
      z: place.z,
      kind: place.kind,
      since: now,
      confirmedAt: now,
      progressAt: now,
      bestRemaining: remaining,
    };
    this.events.onGo?.(place.kind, remaining);
  }

  /** A decision chose CONTINUE. */
  confirm(now: number): void {
    if (this.destination) this.destination.confirmedAt = now;
  }

  /** A decision chose NONE. */
  clear(now: number): void {
    if (this.destination) this.release("cleared", now);
  }

  /** Death, respawn, takeover, pause, a brain switch: drop everything. */
  reset(): void {
    this.destination = null;
    this.syncTelemetry(null, false);
  }

  private release(reason: NavigatorRelease, now: number): void {
    const d = this.destination;
    if (!d) return;
    this.destination = null;
    this.syncTelemetry(null, false);
    this.events.onRelease?.(reason, d.kind, Math.max(0, now - d.since));
  }

  private syncTelemetry(remaining: number | null, sprinting: boolean): void {
    const t = this.telemetry;
    t.active = this.destination !== null;
    t.kind = this.destination?.kind ?? null;
    t.remainingM = remaining;
    t.sprinting = sprinting;
  }

  /**
   * One simulation step. Writes the movement axes and sprint while a
   * destination is held; otherwise leaves the input exactly as it was.
   * `firing` is true when this step's weapon choice pulls the trigger — a
   * sprint would block the weapon, so the navigator walks instead.
   */
  apply(input: InputState, sense: NavSense, firing: boolean): void {
    const d = this.destination;
    if (!d) return;
    const dx = d.x - sense.x;
    const dz = d.z - sense.z;
    const remaining = Math.hypot(dx, dz);
    if (remaining <= ARRIVE_M) {
      this.release("arrived", sense.now);
      input.moveX = 0;
      input.moveY = 0;
      input.sprint = false;
      return;
    }
    if (sense.now - d.confirmedAt > CONFIRM_TIMEOUT_S) {
      this.release("timeout", sense.now);
      input.moveX = 0;
      input.moveY = 0;
      input.sprint = false;
      return;
    }
    if (remaining < d.bestRemaining - STUCK_PROGRESS_M) {
      d.bestRemaining = remaining;
      d.progressAt = sense.now;
    } else if (sense.now - d.progressAt > STUCK_S) {
      this.release("blocked", sense.now);
      input.moveX = 0;
      input.moveY = 0;
      input.sprint = false;
      return;
    }

    // Wanted world direction, bent round anything a feeler meets.
    let wx = dx / remaining;
    let wz = dz / remaining;
    const reach = Math.min(FEELER_M, remaining);
    for (const bend of FEELER_ANGLES) {
      const c = Math.cos(bend);
      const s = Math.sin(bend);
      const bx = wx * c - wz * s;
      const bz = wx * s + wz * c;
      if (sense.probe(bx, bz, reach) === null) {
        wx = bx;
        wz = bz;
        break;
      }
    }

    // World direction → the body's own axes. yaw 0 faces -z; right is +x.
    const fx = -Math.sin(sense.yaw);
    const fz = -Math.cos(sense.yaw);
    const rx = -fz;
    const rz = fx;
    let forward = wx * fx + wz * fz;
    let right = wx * rx + wz * rz;
    // Keys give full deflection; scale so the larger axis is 1.
    const scale = 1 / Math.max(Math.abs(forward), Math.abs(right), 1e-6);
    forward *= scale;
    right *= scale;
    // Sprint is a forward run: only when the place is mostly ahead.
    const sprint =
      !firing && remaining > SPRINT_BEYOND_M && forward > 0.95 && Math.abs(right) < 0.45;
    input.moveX = right;
    input.moveY = forward;
    input.sprint = sprint;
    this.syncTelemetry(remaining, sprint);
  }
}
