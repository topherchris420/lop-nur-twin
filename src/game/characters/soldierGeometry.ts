import * as THREE from "three";

/**
 * Geometry primitives for the procedural soldier.
 *
 * Everything here returns an indexed `BufferGeometry` carrying only `position`
 * and `normal`, with smooth shared vertices, so the kit can be merged into one
 * skinned mesh and a per-vertex bake (occlusion, convexity) sees a connected
 * surface rather than a soup of split triangles.
 *
 * The shapes are chosen for what reads on a body at three to thirty metres:
 *
 *  - `sweep` lofts superellipse rings along a path, with an optional radial
 *    displacement. Limbs, the torso, boots, straps and the helmet trim are all
 *    sweeps; the displacement is where cloth folds and boot tread come from.
 *  - `rbox` is a rounded box with exact analytic normals. A pouch, a plate or a
 *    rail with a hard 90 degree edge has no highlight line along it, which is
 *    the single quickest way kit reads as primitives.
 *  - `bendY` wraps a part around a vertical axis so a plate, a cummerbund or a
 *    pouch row follows the body's curvature instead of sitting on it as a flat
 *    card.
 */

export type V3 = readonly [number, number, number];

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Strip everything but position and normal, and make sure it is indexed. */
export function clean(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
  }
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  if (!geometry.index) {
    const count = geometry.getAttribute("position").count;
    const index = new Uint32Array(count);
    for (let i = 0; i < count; i += 1) index[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
  }
  geometry.clearGroups();
  return geometry;
}

/** Translate, then rotate (YXZ Euler, radians) about the given pivot. */
export function place(
  geometry: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.BufferGeometry {
  if (rx || ry || rz) {
    _e.set(rx, ry, rz, "YXZ");
    _q.setFromEuler(_e);
    _m.makeRotationFromQuaternion(_q);
    geometry.applyMatrix4(_m);
  }
  geometry.translate(x, y, z);
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Sweep                                                               */
/* ------------------------------------------------------------------ */

export interface SweepRing {
  /** Ring centre. */
  c: V3;
  /** Half extent along the ring's first axis (+u side and -u side). */
  a: number;
  /** Half extent along +v. */
  b: number;
  /** Half extent along -v; defaults to `b`. Front/back asymmetry of a limb. */
  b2?: number;
  /** Half extent along -u; defaults to `a`. */
  a2?: number;
  /** Superellipse exponent: 2 is an ellipse, higher is squarer. */
  p?: number;
}

export interface SweepOptions {
  /** Radial segments. */
  seg: number;
  /** First in-plane axis for every ring, before orthogonalising to the path. */
  u?: V3;
  /** Close the first / last ring with a domed cap. */
  capStart?: boolean;
  capEnd?: boolean;
  /** Cap dome height as a fraction of the ring's mean radius. */
  dome?: number;
  /**
   * Radial displacement in metres, given the ring index, the angle around the
   * ring (0 on +u, pi/2 on +v) and the ring's parameter along the path.
   */
  disp?: (ring: number, theta: number, t: number) => number;
}

function superCos(c: number, p: number): number {
  return Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
}

/**
 * Loft rings along their centres. The path tangent is estimated from the
 * neighbouring centres; `u` is projected off it to give each ring's frame.
 */
export function sweep(rings: readonly SweepRing[], options: SweepOptions): THREE.BufferGeometry {
  const seg = options.seg;
  const n = rings.length;
  const capStart = options.capStart ?? false;
  const capEnd = options.capEnd ?? false;
  const vertexCount = n * seg + (capStart ? 1 : 0) + (capEnd ? 1 : 0);
  const positions = new Float32Array(vertexCount * 3);
  const uHint = new THREE.Vector3(...(options.u ?? [1, 0, 0]));
  const tangent = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const prevU = new THREE.Vector3().copy(uHint);

  // Cumulative path length, so displacement can be authored along it.
  const lengths: number[] = [0];
  for (let i = 1; i < n; i += 1) {
    const a = rings[i - 1]!.c;
    const b = rings[i]!.c;
    lengths.push(lengths[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = lengths[n - 1]! || 1;

  for (let i = 0; i < n; i += 1) {
    const r = rings[i]!;
    const a = rings[Math.max(0, i - 1)]!.c;
    const b = rings[Math.min(n - 1, i + 1)]!.c;
    tangent.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (tangent.lengthSq() < 1e-12) tangent.set(0, 1, 0);
    tangent.normalize();
    // Transport the previous frame so a curving strap does not twist.
    u.copy(i === 0 ? uHint : prevU).addScaledVector(tangent, -(i === 0 ? uHint : prevU).dot(tangent));
    if (u.lengthSq() < 1e-8) u.set(0, 0, 1).addScaledVector(tangent, -tangent.z);
    u.normalize();
    prevU.copy(u);
    v.crossVectors(tangent, u).normalize();
    const p = r.p ?? 2;
    const t = lengths[i]! / total;
    for (let j = 0; j < seg; j += 1) {
      const theta = (j / seg) * Math.PI * 2;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const ra = c >= 0 ? r.a : (r.a2 ?? r.a);
      const rb = s >= 0 ? r.b : (r.b2 ?? r.b);
      const d = options.disp ? options.disp(i, theta, t) : 0;
      const cu = superCos(c, p);
      const sv = superCos(s, p);
      // Displace along the ring's own outward direction.
      const ox = u.x * cu * ra + v.x * sv * rb;
      const oy = u.y * cu * ra + v.y * sv * rb;
      const oz = u.z * cu * ra + v.z * sv * rb;
      const len = Math.hypot(ox, oy, oz) || 1;
      const k = 1 + d / len;
      const o = (i * seg + j) * 3;
      positions[o] = r.c[0] + ox * k;
      positions[o + 1] = r.c[1] + oy * k;
      positions[o + 2] = r.c[2] + oz * k;
    }
  }

  const dome = options.dome ?? 0.6;
  let next = n * seg;
  const startIndex = capStart ? next++ : -1;
  const endIndex = capEnd ? next++ : -1;
  const capAt = (ringIndex: number, sign: number, target: number) => {
    const r = rings[ringIndex]!;
    const a = rings[Math.max(0, ringIndex - 1)]!.c;
    const b = rings[Math.min(n - 1, ringIndex + 1)]!.c;
    tangent.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const mean = (r.a + (r.a2 ?? r.a) + r.b + (r.b2 ?? r.b)) / 4;
    positions[target * 3] = r.c[0] + tangent.x * mean * dome * sign;
    positions[target * 3 + 1] = r.c[1] + tangent.y * mean * dome * sign;
    positions[target * 3 + 2] = r.c[2] + tangent.z * mean * dome * sign;
  };
  if (capStart) capAt(0, -1, startIndex);
  if (capEnd) capAt(n - 1, 1, endIndex);

  const indices: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = 0; j < seg; j += 1) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      const c = (i + 1) * seg + j;
      const d = (i + 1) * seg + ((j + 1) % seg);
      indices.push(a, c, b, b, c, d);
    }
  }
  if (capStart) {
    for (let j = 0; j < seg; j += 1) indices.push(startIndex, j, (j + 1) % seg);
  }
  if (capEnd) {
    const base = (n - 1) * seg;
    for (let j = 0; j < seg; j += 1)
      indices.push(endIndex, base + ((j + 1) % seg), base + j);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Winding depends on the frame's handedness; flip if the normals point in.
  if (pointsInward(geometry, rings)) flip(geometry);
  return geometry;
}

/** True when the first ring's normals face its centre. */
function pointsInward(geometry: THREE.BufferGeometry, rings: readonly SweepRing[]): boolean {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const mid = Math.floor(rings.length / 2);
  const c = rings[mid]!.c;
  const seg = position.count >= rings.length ? Math.floor(position.count / rings.length) : 1;
  const i = mid * seg;
  _v.set(position.getX(i) - c[0], position.getY(i) - c[1], position.getZ(i) - c[2]);
  _n.set(normal.getX(i), normal.getY(i), normal.getZ(i));
  return _v.dot(_n) < 0;
}

export function flip(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const index = geometry.getIndex();
  if (index) {
    const arr = index.array as Uint32Array | Uint16Array | number[];
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1]!;
      arr[i + 1] = arr[i + 2]!;
      arr[i + 2] = t;
    }
    index.needsUpdate = true;
  }
  const normal = geometry.getAttribute("normal");
  for (let i = 0; i < normal.count; i += 1) {
    normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
  }
  normal.needsUpdate = true;
  return geometry;
}

/**
 * A vertical tube between two heights with a radius profile. `profile(t)`
 * returns the ring at parameter t in [0, 1] from `y0` to `y1`.
 */
export function vtube(
  y0: number,
  y1: number,
  rings: number,
  seg: number,
  profile: (t: number) => Omit<SweepRing, "c"> & { x: number; z: number },
  disp?: SweepOptions["disp"],
  caps: { start?: boolean; end?: boolean; dome?: number } = {},
): THREE.BufferGeometry {
  const list: SweepRing[] = [];
  for (let i = 0; i < rings; i += 1) {
    const t = i / (rings - 1);
    const r = profile(t);
    const y = y0 + (y1 - y0) * t;
    list.push({ ...r, c: [r.x, y, r.z] });
  }
  const options: SweepOptions = {
    seg,
    u: [1, 0, 0],
    capStart: caps.start ?? true,
    capEnd: caps.end ?? true,
  };
  if (caps.dome !== undefined) options.dome = caps.dome;
  if (disp) options.disp = disp;
  return sweep(list, options);
}

/**
 * A strap: a rounded rectangle swept along a smoothed path. `out` gives the
 * direction the strap's face looks at each sample (usually away from the
 * body), which fixes its roll.
 */
export function strap(
  points: readonly V3[],
  width: number,
  thick: number,
  samples: number,
  out: (p: THREE.Vector3) => THREE.Vector3,
  closed = false,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    closed,
    "centripetal",
  );
  const pts = curve.getSpacedPoints(samples);
  if (closed) pts.pop();
  const count = pts.length;
  // Rounded rectangle cross-section, 10 points.
  const profile: Array<[number, number]> = [];
  const hw = width / 2;
  const ht = thick / 2;
  const r = Math.min(ht, hw) * 0.85;
  const corners: Array<[number, number, number]> = [
    [hw - r, ht - r, 0],
    [-(hw - r), ht - r, Math.PI / 2],
    [-(hw - r), -(ht - r), Math.PI],
    [hw - r, -(ht - r), Math.PI * 1.5],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k < 3; k += 1) {
      const a = a0 + (k / 2) * (Math.PI / 2);
      profile.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  const ps = profile.length;
  const positions = new Float32Array(count * ps * 3);
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const face = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    const p = pts[i]!;
    const a = pts[closed ? (i - 1 + count) % count : Math.max(0, i - 1)]!;
    const b = pts[closed ? (i + 1) % count : Math.min(count - 1, i + 1)]!;
    tangent.subVectors(b, a).normalize();
    face.copy(out(p));
    face.addScaledVector(tangent, -face.dot(tangent)).normalize();
    side.crossVectors(tangent, face).normalize();
    for (let k = 0; k < ps; k += 1) {
      const [sx, sy] = profile[k]!;
      const o = (i * ps + k) * 3;
      positions[o] = p.x + side.x * sx + face.x * sy;
      positions[o + 1] = p.y + side.y * sx + face.y * sy;
      positions[o + 2] = p.z + side.z * sx + face.z * sy;
    }
  }
  const indices: number[] = [];
  const rows = closed ? count : count - 1;
  for (let i = 0; i < rows; i += 1) {
    const i2 = (i + 1) % count;
    for (let k = 0; k < ps; k += 1) {
      const a = i * ps + k;
      const b = i * ps + ((k + 1) % ps);
      const c = i2 * ps + k;
      const d = i2 * ps + ((k + 1) % ps);
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Orientation check: the face vertex at the first sample should point out.
  const normal = geometry.getAttribute("normal");
  const p0 = pts[Math.floor(count / 2)]!;
  const iMid = Math.floor(count / 2) * ps + 1;
  _v.set(positions[iMid * 3]! - p0.x, positions[iMid * 3 + 1]! - p0.y, positions[iMid * 3 + 2]! - p0.z);
  _n.set(normal.getX(iMid), normal.getY(iMid), normal.getZ(iMid));
  if (_v.dot(_n) < 0) flip(geometry);
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Rounded box                                                         */
/* ------------------------------------------------------------------ */

/**
 * Rounded box centred on the origin, with exact normals from the spherised
 * corner direction. `seg` rounding steps per edge (1 is a chamfer that still
 * shades round, 2 is visibly rounded).
 */
export function rbox(
  w: number,
  h: number,
  d: number,
  radius: number,
  seg = 2,
): THREE.BufferGeometry {
  const r = Math.max(1e-4, Math.min(radius, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const n = seg * 2 + 1;
  const box = new THREE.BoxGeometry(1, 1, 1, n, n, n);
  const position = box.getAttribute("position");
  const normal = box.getAttribute("normal");
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  // Map the uniform grid so the outer `seg` cells per side span the rounding.
  const remap = (u: number, half: number) => {
    const g = u * 2; // -1..1
    const a = Math.abs(g);
    const inner = 1 / n;
    let q: number;
    if (a <= inner) q = (a / inner) * (half - r);
    else q = half - r + ((a - inner) / (1 - inner)) * r;
    return Math.sign(g) * q;
  };
  for (let i = 0; i < position.count; i += 1) {
    const x = remap(position.getX(i), hx);
    const y = remap(position.getY(i), hy);
    const z = remap(position.getZ(i), hz);
    const ix = Math.max(-(hx - r), Math.min(hx - r, x));
    const iy = Math.max(-(hy - r), Math.min(hy - r, y));
    const iz = Math.max(-(hz - r), Math.min(hz - r, z));
    _n.set(x - ix, y - iy, z - iz);
    if (_n.lengthSq() < 1e-12) _n.set(normal.getX(i), normal.getY(i), normal.getZ(i));
    _n.normalize();
    position.setXYZ(i, ix + _n.x * r, iy + _n.y * r, iz + _n.z * r);
    normal.setXYZ(i, _n.x, _n.y, _n.z);
  }
  box.deleteAttribute("uv");
  return weld(box);
}

/**
 * Merge coincident vertices whose normals agree, so a box's six faces become
 * one connected surface for the bakes.
 */
export function weld(geometry: THREE.BufferGeometry, tolerance = 1e-5): THREE.BufferGeometry {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.getIndex();
  const map = new Map<string, number>();
  const remap = new Int32Array(position.count);
  const outPos: number[] = [];
  const outNor: number[] = [];
  const inv = 1 / tolerance;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    const found = map.get(key);
    if (found !== undefined) {
      remap[i] = found;
      continue;
    }
    const id = outPos.length / 3;
    map.set(key, id);
    remap[i] = id;
    outPos.push(x, y, z);
    outNor.push(normal.getX(i), normal.getY(i), normal.getZ(i));
  }
  const indices: number[] = [];
  const src = index ? (index.array as ArrayLike<number>) : null;
  const triCount = src ? src.length : position.count;
  for (let i = 0; i < triCount; i += 3) {
    const a = remap[src ? src[i]! : i]!;
    const b = remap[src ? src[i + 1]! : i + 1]!;
    const c = remap[src ? src[i + 2]! : i + 2]!;
    if (a === b || b === c || a === c) continue;
    indices.push(a, b, c);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(outPos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(outNor, 3));
  out.setIndex(indices);
  geometry.dispose();
  return out;
}

/* ------------------------------------------------------------------ */
/* Deformers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Wrap a part around a vertical axis at (cx, cz): x becomes arc length on a
 * circle of the given radius, so a flat panel follows a torso. `radius` is
 * measured to the part's own z = 0 plane; positive bends the panel's ends
 * toward +z (around a body behind it).
 */
export function bendY(
  geometry: THREE.BufferGeometry,
  radius: number,
  sign = 1,
): THREE.BufferGeometry {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const theta = x / radius;
    const rr = radius - z * sign;
    const nx = Math.sin(theta) * rr;
    const nz = (radius - Math.cos(theta) * rr) * sign;
    position.setX(i, nx);
    position.setZ(i, nz);
    const ux = normal.getX(i);
    const uz = normal.getZ(i);
    const c = Math.cos(theta);
    // The Jacobian's rotation: d/dx follows (cos, sin), d/dz follows
    // (-sin, cos), mirrored in z when bending the other way.
    const s = Math.sin(theta) * sign;
    normal.setX(i, ux * c - uz * s);
    normal.setZ(i, ux * s + uz * c);
  }
  position.needsUpdate = true;
  normal.needsUpdate = true;
  return geometry;
}

/** Narrow a part toward +y (scale x by `top` at the top, 1 at the bottom). */
export function taper(
  geometry: THREE.BufferGeometry,
  top: number,
  axis: "x" | "z" = "x",
): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const h = box.max.y - box.min.y || 1;
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i += 1) {
    const t = (position.getY(i) - box.min.y) / h;
    const k = 1 + (top - 1) * t;
    if (axis === "x") position.setX(i, position.getX(i) * k);
    else position.setZ(i, position.getZ(i) * k);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/** Push vertices along their normal by `f(x, y, z)` metres. */
export function inflate(
  geometry: THREE.BufferGeometry,
  f: (x: number, y: number, z: number) => number,
): THREE.BufferGeometry {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const d = f(x, y, z);
    position.setXYZ(
      i,
      x + normal.getX(i) * d,
      y + normal.getY(i) * d,
      z + normal.getZ(i) * d,
    );
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/** A capsule-ish ball, indexed. */
export function ellipsoid(
  rx: number,
  ry: number,
  rz: number,
  wSeg = 14,
  hSeg = 10,
): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg);
  g.scale(rx, ry, rz);
  g.deleteAttribute("uv");
  return weld(g);
}

/** A capped cylinder along Y, indexed and welded. */
export function cylinder(
  rTop: number,
  rBottom: number,
  h: number,
  seg = 10,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, false);
  g.deleteAttribute("uv");
  return g;
}
