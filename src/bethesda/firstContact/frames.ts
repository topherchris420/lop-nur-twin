/**
 * Coordinate frames: how a position in one individual's world is placed in
 * another's.
 *
 * The two originals do not share a space. Eva's garden is an abstract 2D
 * plane in fractions of its extent (x right, y down) with no metric scale and
 * no heights; ECHO's city is metres (+x east, +y up, +z south). A research
 * subject's arena is metres in the same convention as the city. Putting one
 * fly into another's world is therefore always a declared mapping, never a
 * fact, and every map here says what it is and where its numbers come from.
 *
 * A `FrameMap` is a similarity about the vertical axis: rotate by `yaw` (as
 * Three's `rotateY`, the repository's convention), scale, then translate.
 */
import type { V3 } from "../fly/units.js";

export type FrameClass =
  /** A choice made by the experimenter, e.g. where a playback is placed. */
  | "design"
  /** Derived from data the repository already holds, by the stated method. */
  | "derived"
  /** An assumption with no measurement behind it. */
  | "model";

export interface FrameMap {
  id: string;
  from: string;
  to: string;
  /** Rotation about +y (rad), applied first. */
  yaw: number;
  /** Metres in `to` per unit of `from`. */
  scale: number;
  translate: V3;
  class: FrameClass;
  note: string;
}

export function checkFrameMap(m: FrameMap): FrameMap {
  if (!m.id || !m.from || !m.to)
    throw new Error("a frame map names itself and both frames");
  if (!Number.isFinite(m.yaw)) throw new Error(`${m.id}: yaw is not finite`);
  if (!(m.scale > 0 && m.scale < 1e4 && Number.isFinite(m.scale)))
    throw new Error(`${m.id}: scale must be finite and positive`);
  if (!m.translate.every((v) => Number.isFinite(v) && Math.abs(v) < 1e7))
    throw new Error(`${m.id}: translation is not finite`);
  if (!m.note.trim()) throw new Error(`${m.id}: a frame map says what it is`);
  return m;
}

export const identityMap = (frame: string, note: string): FrameMap => ({
  id: `identity:${frame}`,
  from: frame,
  to: frame,
  yaw: 0,
  scale: 1,
  translate: [0, 0, 0],
  class: "design",
  note,
});

/** Rotate by yaw about +y (Three's rotateY), scale, translate. */
export function applyMap(m: FrameMap, p: V3): V3 {
  const c = Math.cos(m.yaw),
    s = Math.sin(m.yaw);
  const x = p[0] * c + p[2] * s,
    z = -p[0] * s + p[2] * c;
  return [
    x * m.scale + m.translate[0],
    p[1] * m.scale + m.translate[1],
    z * m.scale + m.translate[2],
  ];
}

/** Turns a heading (rad, the repository's yaw) from `from` into `to`. */
export const mapYaw = (m: FrameMap, yaw: number) => yaw + m.yaw;

export function invertMap(m: FrameMap): FrameMap {
  const inv: FrameMap = {
    id: `inverse:${m.id}`,
    from: m.to,
    to: m.from,
    yaw: -m.yaw,
    scale: 1 / m.scale,
    translate: [0, 0, 0],
    class: m.class,
    note: `the inverse of ${m.id}`,
  };
  const back = applyMap(inv, m.translate);
  inv.translate = [-back[0], -back[1], -back[2]];
  return inv;
}

/** `second` after `first`. */
export function composeMaps(first: FrameMap, second: FrameMap): FrameMap {
  if (first.to !== second.from)
    throw new Error(`cannot compose ${first.id} (to ${first.to}) with ${second.id}`);
  const t = applyMap(second, first.translate);
  return {
    id: `${second.id}∘${first.id}`,
    from: first.from,
    to: second.to,
    yaw: first.yaw + second.yaw,
    scale: first.scale * second.scale,
    translate: t,
    class:
      first.class === "model" || second.class === "model"
        ? "model"
        : first.class === "derived" || second.class === "derived"
          ? "derived"
          : "design",
    note: `${first.note}; then ${second.note}`,
  };
}

/**
 * The least-squares similarity from 2D points `a` to `b` (Umeyama 1991,
 * restricted to the plane), with its residuals: used to derive a metric scale
 * for the garden from the clay page's own staging of its places.
 */
export function fitSimilarity2D(
  a: readonly (readonly [number, number])[],
  b: readonly (readonly [number, number])[],
): { scale: number; angle: number; tx: number; ty: number; rmsResidual: number } {
  if (a.length !== b.length || a.length < 2) throw new Error("need two or more pairs");
  const n = a.length;
  let ax = 0,
    ay = 0,
    bx = 0,
    by = 0;
  for (let i = 0; i < n; i++) {
    ax += a[i]![0];
    ay += a[i]![1];
    bx += b[i]![0];
    by += b[i]![1];
  }
  ax /= n;
  ay /= n;
  bx /= n;
  by /= n;
  let sxx = 0,
    sxy = 0,
    va = 0;
  for (let i = 0; i < n; i++) {
    const px = a[i]![0] - ax,
      py = a[i]![1] - ay,
      qx = b[i]![0] - bx,
      qy = b[i]![1] - by;
    sxx += px * qx + py * qy;
    sxy += px * qy - py * qx;
    va += px * px + py * py;
  }
  if (va <= 0) throw new Error("the source points coincide");
  const angle = Math.atan2(sxy, sxx);
  const scale = Math.hypot(sxx, sxy) / va;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const tx = bx - scale * (c * ax - s * ay),
    ty = by - scale * (s * ax + c * ay);
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const [px, py] = a[i]!;
    const qx = scale * (c * px - s * py) + tx,
      qy = scale * (s * px + c * py) + ty;
    ss += (qx - b[i]![0]) ** 2 + (qy - b[i]![1]) ** 2;
  }
  return { scale, angle, tx, ty, rmsResidual: Math.sqrt(ss / n) };
}
