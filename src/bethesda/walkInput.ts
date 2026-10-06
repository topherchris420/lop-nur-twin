/**
 * What a walker's controls ask for — held keys or a thumb-stick — before the
 * view's heading turns it into a step. The city's walker and the lab's both
 * read it, so a touch screen and a keyboard cannot disagree about which way is
 * forward or what counts as hurrying.
 *
 * It decides intent only. In the city the step it produces still goes through
 * `CitySimulation.movePlayer`, which records it, so a walk taken by thumb
 * replays exactly like one taken on WASD.
 */

/** A thumb-stick's deflection: `x` right, `y` forward, magnitude at most 1. */
export interface Stick {
  x: number;
  y: number;
}

/** Below this deflection a resting thumb asks for nothing. */
export const STICK_DEADZONE = 0.15;
/** At or beyond this deflection the stick hurries, as the twin's does. */
export const STICK_HURRY = 0.9;
/** Radians of turn per pixel a finger drags the view, as the twin's touch look. */
export const TOUCH_LOOK = 0.004;
/** Radians of turn per pixel for a mouse drag or a locked pointer. */
export const MOUSE_LOOK = 0.002;
/** The slowest pace a stick past its dead zone asks for, as a share of a walk. */
const STICK_SLOWEST = 0.2;

export interface WalkIntent {
  /** Right of the heading. */
  x: number;
  /** Behind the heading (forward is negative), as the camera sees it. */
  z: number;
  /** Share of walking speed, 0–1; a hurry ignores it. */
  pace: number;
  hurry: boolean;
}

/**
 * Held keys win over the stick, so a tablet with a keyboard behaves like a
 * desktop. `arrows` adds the arrow keys, which walk the lab but not the city.
 */
export function walkIntent(
  keys: ReadonlySet<string>,
  stick: Stick,
  arrows = false,
): WalkIntent | null {
  const held = (key: string, arrow: string) =>
    keys.has(key) || (arrows && keys.has(arrow));
  let x = 0,
    z = 0;
  if (held("KeyW", "ArrowUp")) z--;
  if (held("KeyS", "ArrowDown")) z++;
  if (held("KeyA", "ArrowLeft")) x--;
  if (held("KeyD", "ArrowRight")) x++;
  if (x !== 0 || z !== 0) return { x, z, pace: 1, hurry: keys.has("ShiftLeft") };
  if (!Number.isFinite(stick.x) || !Number.isFinite(stick.y)) return null;
  const m = Math.min(1, Math.hypot(stick.x, stick.y));
  if (m < STICK_DEADZONE) return null;
  const hurry = m >= STICK_HURRY;
  const pace = hurry
    ? 1
    : Math.max(STICK_SLOWEST, (m - STICK_DEADZONE) / (STICK_HURRY - STICK_DEADZONE));
  return { x: stick.x, z: -stick.y, pace, hurry };
}

/** The step an intent takes along a heading, at the given walk and hurry speeds. */
export function stepFor(
  intent: WalkIntent,
  yaw: number,
  walk: number,
  hurry: number,
): { dx: number; dz: number } {
  const n = Math.hypot(intent.x, intent.z);
  const speed = intent.hurry ? hurry : walk * intent.pace;
  return {
    dx: ((intent.x * Math.cos(yaw) + intent.z * Math.sin(yaw)) * speed) / n,
    dz: ((-intent.x * Math.sin(yaw) + intent.z * Math.cos(yaw)) * speed) / n,
  };
}

/**
 * Drag-to-look that works for a finger as well as a mouse. Touch pointer
 * events do not report `movementX` everywhere, so a drag is measured from the
 * finger's own last position; only a locked mouse uses `movementX`. One finger
 * looks at a time, so a second one on the view does not double the turn.
 */
export class LookDrag {
  private finger: { id: number; x: number; y: number } | null = null;

  /** `mouse` is the radians per pixel a mouse turns (the lab's is a touch faster). */
  constructor(private readonly mouse = MOUSE_LOOK) {}

  /** Starts a drag; returns false if another pointer is already looking. */
  begin(e: PointerEvent): boolean {
    if (this.finger) return false;
    this.finger = { id: e.pointerId, x: e.clientX, y: e.clientY };
    return true;
  }

  /** The turn this event asks for, in radians, or null if it is not the drag. */
  turn(e: PointerEvent, locked: boolean): { yaw: number; pitch: number } | null {
    if (locked)
      return { yaw: -e.movementX * this.mouse, pitch: -e.movementY * this.mouse };
    const f = this.finger;
    if (!f || f.id !== e.pointerId) return null;
    const dx = e.clientX - f.x,
      dy = e.clientY - f.y;
    f.x = e.clientX;
    f.y = e.clientY;
    const k = e.pointerType === "touch" ? TOUCH_LOOK : this.mouse;
    return { yaw: -dx * k, pitch: -dy * k };
  }

  /** Ends the drag if this is its pointer. */
  end(e: PointerEvent): void {
    if (this.finger?.id === e.pointerId) this.finger = null;
  }

  get active(): boolean {
    return this.finger !== null;
  }
}
