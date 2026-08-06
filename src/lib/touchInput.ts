/**
 * Touch-control channel between the on-screen joystick / look-pad (DOM) and the
 * first-person camera rig (scene). Like `telemetry`, it is a mutable singleton
 * poked imperatively from pointer handlers and read in `useFrame`, so the HUD
 * never re-renders while you drive.
 */
export interface TouchInput {
  /** left thumb-stick, normalized: +x right, +y forward */
  moveX: number;
  moveY: number;
  /** true when the stick is pushed near full deflection */
  sprint: boolean;
  /** look-drag pixels accumulated since the last frame (consumed each frame) */
  lookDX: number;
  lookDY: number;
}

export const touchInput: TouchInput = {
  moveX: 0,
  moveY: 0,
  sprint: false,
  lookDX: 0,
  lookDY: 0,
};

export function resetTouchInput(): void {
  touchInput.moveX = 0;
  touchInput.moveY = 0;
  touchInput.sprint = false;
  touchInput.lookDX = 0;
  touchInput.lookDY = 0;
}

/** True on phones/tablets (primary pointer is coarse), false on desktops. */
export function isCoarsePointer(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(pointer: coarse)").matches ||
    (typeof navigator !== "undefined" &&
      navigator.maxTouchPoints > 0 &&
      !window.matchMedia?.("(pointer: fine)").matches)
  );
}
