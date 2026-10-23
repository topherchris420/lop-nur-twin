/**
 * Rigid-body kinematics in FlyBody's own conventions, shared by the importer
 * (`scripts/import-flybody.ts`), the leg solver and the renderer, so a pose is
 * computed one way everywhere.
 *
 * FlyBody's MJCF (MuJoCo) frame: +x anterior, +y the fly's left, +z dorsal,
 * lengths in centimetres. Quaternions are MuJoCo's order, [w, x, y, z]. A
 * body's frame is its parent's frame composed with its `pos`/`quat`, then with
 * each of its hinge joints in declaration order — the order MuJoCo multiplies
 * them in (`mj_kinematics`), so a second joint's axis is read in the frame the
 * first one rotated. Pure arithmetic: no renderer, no randomness.
 */
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export interface Frame {
  p: Vec3;
  q: Quat;
}

export const IDENTITY: Frame = { p: [0, 0, 0], q: [1, 0, 0, 0] };

export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

export function quatNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(n > 0) || !Number.isFinite(n)) throw new Error("degenerate quaternion");
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function quatConj(q: Quat): Quat {
  return [q[0], -q[1], -q[2], -q[3]];
}

export function axisAngle(axis: Vec3, angle: number): Quat {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  if (!(n > 0)) throw new Error("zero joint axis");
  const s = Math.sin(angle / 2) / n;
  return [Math.cos(angle / 2), axis[0] * s, axis[1] * s, axis[2] * s];
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  // v' = q v q*, expanded.
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]),
    ty = 2 * (z * v[0] - x * v[2]),
    tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

export function compose(a: Frame, b: Frame): Frame {
  const r = rotate(a.q, b.p);
  return {
    p: [a.p[0] + r[0], a.p[1] + r[1], a.p[2] + r[2]],
    q: quatNormalize(quatMul(a.q, b.q)),
  };
}

export function apply(f: Frame, v: Vec3): Vec3 {
  const r = rotate(f.q, v);
  return [f.p[0] + r[0], f.p[1] + r[1], f.p[2] + r[2]];
}

export function invert(f: Frame): Frame {
  const q = quatConj(f.q);
  const p = rotate(q, f.p);
  return { p: [-p[0], -p[1], -p[2]], q };
}

/** A hinge joint as FlyBody declares it: an axis in its body's frame and a range in radians. */
export interface Hinge {
  name: string;
  axis: Vec3;
  range: [number, number];
  /** The spring reference (`springref`): the angle the joint's spring rests at. */
  rest: number;
}
export interface BodyDef {
  name: string;
  parent: string | null;
  pos: Vec3;
  quat: Quat;
  joints: Hinge[];
}

/** The body's local frame for given joint angles (radians, one per hinge, in order). */
export function bodyLocal(body: BodyDef, angles: readonly number[]): Frame {
  let q = quatNormalize(body.quat);
  body.joints.forEach((j, i) => {
    q = quatMul(q, axisAngle(j.axis, angles[i] ?? 0));
  });
  return { p: [...body.pos], q: quatNormalize(q) };
}

/**
 * Frames of every body in `order` (parents before children), in the frame of
 * the first body. `angles(name)` supplies a body's joint angles; missing
 * angles are zero, which is MuJoCo's `qpos0` for every hinge here.
 */
export function forwardKinematics(
  bodies: readonly BodyDef[],
  angles: (body: BodyDef) => readonly number[] = () => [],
): Map<string, Frame> {
  const out = new Map<string, Frame>();
  for (const b of bodies) {
    const local = bodyLocal(b, angles(b));
    if (b.parent === null) out.set(b.name, local);
    else {
      const parent = out.get(b.parent);
      if (!parent) throw new Error(`body ${b.name} listed before its parent ${b.parent}`);
      out.set(b.name, compose(parent, local));
    }
  }
  return out;
}

export const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;

/** Each joint at its spring reference, clamped to its range. */
export function restAngles(body: BodyDef): number[] {
  return body.joints.map((j) => clamp(j.rest, j.range[0], j.range[1]));
}
