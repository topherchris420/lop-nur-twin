/**
 * Keyboard pan channel for the orbit camera (arrow keys / WASD).
 *
 * It is kept apart from `touchInput` on purpose. The two sources behave
 * differently — the touch pan-stick holds its deflection for as long as a thumb
 * is on it, while keyboard pan eases out after the key is released — and they
 * once shared `touchInput.moveX/moveY`, so the keyboard's ease-out ran every
 * tick and wiped the stick's deflection while it was still held. `OrbitRig`
 * sums the two channels; each source only ever writes its own.
 *
 * Like `touchInput` it is a mutable singleton, written from a timer and read in
 * `useFrame`, so panning never touches React state.
 */
export interface KeyboardPan {
  /** +x right, +y forward (away from the camera), in [-1, 1]. */
  moveX: number;
  moveY: number;
}

export const keyboardPan: KeyboardPan = { moveX: 0, moveY: 0 };

/** Deflection while a pan key is held. */
export const KEYBOARD_PAN_STRENGTH = 0.8;
/** Per-tick ease-out factor after release. */
const KEYBOARD_PAN_DECAY = 0.8;
/** Below this the ease-out snaps to exactly zero, so the rig goes idle. */
const KEYBOARD_PAN_EPSILON = 1e-3;

function axis(
  held: ReadonlySet<string>,
  positive: readonly string[],
  negative: readonly string[],
  current: number,
): number {
  if (positive.some((code) => held.has(code))) return KEYBOARD_PAN_STRENGTH;
  if (negative.some((code) => held.has(code))) return -KEYBOARD_PAN_STRENGTH;
  const decayed = current * KEYBOARD_PAN_DECAY;
  return Math.abs(decayed) < KEYBOARD_PAN_EPSILON ? 0 : decayed;
}

/**
 * Advances keyboard pan by one tick from the set of held `KeyboardEvent.code`s.
 * Writes `keyboardPan` and nothing else.
 */
export function stepKeyboardPan(held: ReadonlySet<string>): void {
  keyboardPan.moveY = axis(
    held,
    ["ArrowUp", "KeyW"],
    ["ArrowDown", "KeyS"],
    keyboardPan.moveY,
  );
  keyboardPan.moveX = axis(
    held,
    ["ArrowRight", "KeyD"],
    ["ArrowLeft", "KeyA"],
    keyboardPan.moveX,
  );
}

export function resetKeyboardPan(): void {
  keyboardPan.moveX = 0;
  keyboardPan.moveY = 0;
}
