/**
 * Units and frames for the digital fly.
 *
 * FlyBody works in centimetres in a body frame with +x anterior, +y the fly's
 * left and +z dorsal. The city and the lab work in metres with +x east, +y up
 * and +z south. A heading `yaw` is measured anticlockwise seen from above,
 * from east: yaw 0 faces east, yaw π/2 faces north (−z).
 *
 * With pitch and roll zero, FlyBody (x, y, z) maps to world (x, z, −y) and
 * then turns by `yaw` about +y. Pitch is nose-up positive about the fly's
 * left axis; roll is right-wing-down positive about its forward axis.
 */
export const CM = 0.01;

export type V3 = [number, number, number];

export const cmToM = (cm: number) => cm * CM;
export const mToCm = (m: number) => m / CM;
export const degToRad = (d: number) => (d * Math.PI) / 180;
export const radToDeg = (r: number) => (r * 180) / Math.PI;

/** World direction the fly faces at heading `yaw` (level). */
export function forward(yaw: number): V3 {
  return [Math.cos(yaw), 0, -Math.sin(yaw)];
}
/** World direction of the fly's left at heading `yaw` (level). */
export function left(yaw: number): V3 {
  return [-Math.sin(yaw), 0, -Math.cos(yaw)];
}
/** Heading of a horizontal world direction. */
export function yawOf(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}
/** Signed smallest difference a − b, in (−π, π]. */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/**
 * A FlyBody body-frame vector (cm) as a world offset (m) for a fly at
 * `yaw`, `pitch`, `roll`. The order is roll about forward, pitch about left,
 * then yaw about up — the order the renderer composes them in.
 */
export function bodyToWorld(v: V3, yaw: number, pitch = 0, roll = 0): V3 {
  let [x, y, z] = v;
  // roll about +x (forward): right wing down is positive, i.e. +y (left) goes up.
  const cr = Math.cos(roll),
    sr = Math.sin(roll);
  [y, z] = [y * cr - z * sr, y * sr + z * cr];
  // pitch about +y (left): nose up positive turns +x toward +z.
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  [x, z] = [x * cp - z * sp, x * sp + z * cp];
  // yaw about +z (up).
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw);
  [x, y] = [x * cy - y * sy, x * sy + y * cy];
  // MuJoCo (x, y, z) → world (x, z, −y), centimetres → metres.
  return [x * CM, z * CM, -y * CM];
}

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: V3): V3 => {
  const n = length(a);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
};
