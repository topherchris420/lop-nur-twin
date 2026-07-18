/**
 * Frame-rate telemetry channel between the 3D scene and the HUD.
 *
 * The scene writes into this mutable singleton from useFrame; the HUD reads
 * it on its own requestAnimationFrame loop and pokes the values straight into
 * DOM nodes. No React state is involved, so the HUD never re-renders on frame.
 */
export interface Telemetry {
  /** world position (meters) */
  x: number;
  y: number;
  z: number;
  /** compass heading in degrees, 0 = north */
  heading: number;
  /** smoothed frames per second */
  fps: number;
  /** index of the cinematic leg currently in frame (-1 = none) */
  cinematicLeg: number;
}

export const telemetry: Telemetry = {
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  fps: 60,
  cinematicLeg: -1,
};
