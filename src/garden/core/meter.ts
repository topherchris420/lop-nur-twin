/**
 * The close-up lenses' light meter, as arithmetic: what a reading of the
 * picture means, and how far the lens follows it. The reading itself is taken
 * on the GPU (`scene/post.ts`): the mean log luminance of each cell of a
 * `METER` × `METER` grid, as bytes over `METER_STOPS` stops from `METER_LOW`.
 * Nothing here reaches the simulation; it changes only how bright a picture is.
 */
import { clamp } from "./vec.js";

/** The meter's grid, and the range of log2 luminance its bytes cover. */
export const METER = 8;
export const METER_LOW = -14;
export const METER_STOPS = 18;

/** Middle grey: where a close-up lens would put what it meters. */
export const KEY = 0.2;

/**
 * Centre-weighted mean of a reading (RGBA bytes, rows running up from the
 * bottom; the weight centres a little low, where the close-up lenses put the
 * fly), as scene luminance before exposure.
 */
export function centreWeighted(px: Uint8Array, n = METER): number {
  let sum = 0,
    weight = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n - 0.5,
        v = (y + 0.5) / n - 0.42;
      const w = Math.exp(-(u * u + v * v) / (2 * 0.22 * 0.22));
      sum += w * (((px[(y * n + x) * 4] ?? 0) / 255) * METER_STOPS + METER_LOW);
      weight += w;
    }
  return 2 ** (sum / weight);
}

/**
 * How far a close-up lens opens up (> 1) or stops down from the light's
 * `exposure` for what it meters (`metered`: scene luminance before exposure):
 * half the way to middle grey, at most a stop up by day (less at night, which
 * should stay dark) and a third of a stop down. A fly in shade is seen; the
 * sunlit garden behind it goes brighter.
 */
export function meterGain(exposure: number, metered: number, daylight: number): number {
  const want = KEY / Math.max(metered * exposure, 1e-6);
  return clamp(Math.sqrt(want), 0.8, 1.25 + 0.75 * daylight);
}
