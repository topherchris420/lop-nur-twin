/**
 * Stop-motion presentation: the garden is photographed a frame at a time.
 *
 * Only the picture is stepped. Animated things (the fly's pose, its place on
 * a flight path, the wind in the leaves, the water) are sampled at the start
 * of the current frame of a 12–15 fps clock running on presented time, and
 * each frame gets its own small, seeded "boil" (the hand-made wobble of a
 * re-posed puppet). The simulation, the polling and the presented clock are
 * untouched: a frame is a sample of the same continuous performance every
 * visitor sees, and frame boundaries fall at the same instants for everyone
 * because they are counted on the server's clock.
 *
 * The camera is not stepped: it answers the visitor's hand at the display's
 * rate. When it is still, the renderer only needs to draw when the frame
 * changes, which is most of the power saving on phones.
 */
import { hashString } from "./vec.js";

export const STOP_MOTION_FPS = { min: 12, max: 15, default: 12 } as const;

export interface StopMotion {
  enabled: boolean;
  fps: number;
}

export interface Frame {
  /** Frame number since the epoch on the presented clock (shared by every visitor). */
  index: number;
  /** Presented time at which this frame was "photographed". */
  time: number;
}

export function clampFps(fps: number): number {
  return Number.isFinite(fps)
    ? Math.min(STOP_MOTION_FPS.max, Math.max(STOP_MOTION_FPS.min, Math.round(fps)))
    : STOP_MOTION_FPS.default;
}

/** The frame containing presented time `t`. With the effect off, every instant is its own frame. */
export function frameAt(t: number, sm: StopMotion): Frame {
  if (!sm.enabled) return { index: Math.floor(t * 60), time: t };
  const fps = clampFps(sm.fps);
  const index = Math.floor(t * fps);
  return { index, time: index / fps };
}

/**
 * Seeded per-frame wobble in [−1, 1] for `channel` (a joint, a leaf, a light):
 * the same for every visitor on the same frame, different from frame to frame.
 */
export function boil(index: number, channel: string | number): number {
  return (hashString(`${index}|${channel}`) / 4294967295) * 2 - 1;
}

/**
 * Exposure for the optional motion blur: how far, as a fraction of a frame,
 * the shutter stays open. A real stop-motion frame is a still exposure; the
 * smear on fast things (a beating wing, a fly darting) is go-motion's look.
 */
export const SHUTTER = 0.5;
