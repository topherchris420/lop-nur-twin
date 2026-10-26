/** Small, allocation-light vector arithmetic for the garden's pure modules (metres, y up). */
export type V3 = [number, number, number];

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const addScaled = (a: V3, b: V3, s: number): V3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const distance = (a: V3, b: V3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function normalize(a: V3): V3 {
  const n = length(a);
  return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 1, 0];
}
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const mix = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;
export const clamp01 = (x: number) => clamp(x, 0, 1);
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** `v` with its component along unit `n` removed, normalized (a fallback when degenerate). */
export function tangentOf(v: V3, n: V3, fallback: V3 = [1, 0, 0]): V3 {
  const t = sub(v, scale(n, dot(v, n)));
  if (length(t) > 1e-9) return normalize(t);
  const f = sub(fallback, scale(n, dot(fallback, n)));
  return length(f) > 1e-9 ? normalize(f) : normalize(cross(n, [0, 0, 1]));
}
/** Rotates `v` about unit `axis` by `angle` (Rodrigues). */
export function rotateAbout(v: V3, axis: V3, angle: number): V3 {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [
    v[0] * c + k[0] * s + axis[0] * d,
    v[1] * c + k[1] * s + axis[1] * d,
    v[2] * c + k[2] * s + axis[2] * d,
  ];
}
/** Spherical interpolation of unit vectors (falls back to a normalized lerp near antipodes). */
export function slerpDir(a: V3, b: V3, t: number): V3 {
  const d = clamp(dot(a, b), -1, 1);
  if (d > 0.9995 || d < -0.9995) return normalize(mix(a, b, t));
  const w = Math.acos(d);
  const sa = Math.sin((1 - t) * w) / Math.sin(w),
    sb = Math.sin(t * w) / Math.sin(w);
  return [a[0] * sa + b[0] * sb, a[1] * sa + b[1] * sb, a[2] * sa + b[2] * sb];
}
/** Wraps an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** FNV-1a over a string: a stable 32-bit seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/** A stable value in [0, 1) for any key: the same for every visitor. */
export function hash01(...parts: (string | number)[]): number {
  return hashString(parts.join("|")) / 4294967296;
}
