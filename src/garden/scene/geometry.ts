/**
 * Shape helpers for the sculpted garden. Every helper takes a seed, and
 * every shape comes out a little uneven, the way a hand-rolled or
 * hand-pressed form does: lathed pots lean and swell, tubes thicken and
 * thin, blobs are lumpy. No helper uses UV seams that would show as cracks;
 * the clay material does not need UVs (its marks are tri-planar), so seams
 * are welded before normals are computed.
 */
import * as THREE from "three";
import {
  mergeGeometries,
  mergeVertices,
} from "three/addons/utils/BufferGeometryUtils.js";
import { createNoise3D, type NoiseFunction3D } from "simplex-noise";
import { mulberry32 } from "../../lib/noise.js";
import type { V3 } from "../core/vec.js";

export type Rand = () => number;
export const rng = (seed: number): Rand => mulberry32(seed >>> 0);
export const noise3 = (seed: number): NoiseFunction3D => createNoise3D(rng(seed));

/** Welds coincident vertices (ignoring UVs unless asked to keep them) and recomputes smooth normals. */
export function weld(g: THREE.BufferGeometry, keepUv = false): THREE.BufferGeometry {
  if (!keepUv) g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  const w = mergeVertices(g, 1e-7);
  w.computeVertexNormals();
  g.dispose();
  return w;
}

export interface LatheOptions {
  segments?: number;
  seed?: number;
  /** Radial unevenness as a fraction of the radius. */
  wobble?: number;
  /** How many lumps around (noise frequency on the unit circle). */
  lumps?: number;
  /** Lean: the axis tilts this far (radians) toward `leanDir` over the height. */
  lean?: number;
  leanDir?: number;
}

/** A lathed form from a profile of [radius, height] points, unevenly turned. */
export function lathe(
  profile: [number, number][],
  o: LatheOptions = {},
): THREE.BufferGeometry {
  const seg = o.segments ?? 48;
  const g = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-5), y)),
    seg,
  );
  const n = noise3(o.seed ?? 1);
  const wobble = o.wobble ?? 0.02;
  const lumps = o.lumps ?? 1.6;
  const lean = o.lean ?? 0;
  const ld = o.leanDir ?? 0;
  const top = Math.max(...profile.map((p) => p[1]));
  const bottom = Math.min(...profile.map((p) => p[1]));
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-6) continue;
    const a = Math.atan2(z, x);
    const h = (y - bottom) / Math.max(1e-6, top - bottom);
    const k = 1 + wobble * n(Math.cos(a) * lumps, Math.sin(a) * lumps, h * 2.2);
    const shift = Math.sin(lean) * (y - bottom);
    pos.setXYZ(i, x * k + Math.cos(ld) * shift, y, z * k + Math.sin(ld) * shift);
  }
  return weld(g);
}

export interface TubeOptions {
  radial?: number;
  /** Rings per metre of length (at least 6 rings). */
  density?: number;
  seed?: number;
  /** Radius unevenness, fraction of radius. */
  wobble?: number;
  /** Close the start and end with rounded caps. */
  caps?: boolean;
}

/**
 * A tube along a smooth curve through `points`, its radius interpolated from
 * `radii`: branches, stems, roots, the fly's midge-sized nothing. Frames are
 * parallel-transported so the tube never twists.
 */
export function tube(
  points: V3[],
  radii: number[],
  o: TubeOptions = {},
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    false,
    "centripetal",
  );
  const length = curve.getLength();
  const rings = Math.max(6, Math.ceil(length * (o.density ?? 60)));
  const radial = o.radial ?? 10;
  const frames = curve.computeFrenetFrames(rings, false);
  const n = noise3(o.seed ?? 7);
  const wobble = o.wobble ?? 0.08;
  const radiusAt = (u: number) => {
    const x = u * (radii.length - 1);
    const i = Math.min(radii.length - 2, Math.floor(x));
    const f = x - i;
    return radii[i]! + (radii[i + 1]! - radii[i]!) * f;
  };
  const positions: number[] = [];
  const index: number[] = [];
  const p = new THREE.Vector3(),
    v = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    curve.getPointAt(u, p);
    const N = frames.normals[i]!,
      B = frames.binormals[i]!;
    const r0 = radiusAt(u);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const r =
        r0 * (1 + wobble * n(Math.cos(a) * 1.3, Math.sin(a) * 1.3, u * length * 9));
      v.copy(N)
        .multiplyScalar(Math.cos(a) * r)
        .addScaledVector(B, Math.sin(a) * r)
        .add(p);
      positions.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j,
        b = i * radial + ((j + 1) % radial),
        c = (i + 1) * radial + j,
        d = (i + 1) * radial + ((j + 1) % radial);
      index.push(a, c, b, b, c, d);
    }
  if (o.caps ?? true) {
    for (const [ring, sign] of [
      [0, -1],
      [rings, 1],
    ] as const) {
      const u = ring / rings;
      curve.getPointAt(u, p);
      const t = curve.getTangentAt(u).multiplyScalar(sign);
      const r = radiusAt(u);
      const tip = positions.length / 3;
      positions.push(p.x + t.x * r * 0.6, p.y + t.y * r * 0.6, p.z + t.z * r * 0.6);
      for (let j = 0; j < radial; j++) {
        const a = ring * radial + j,
          b = ring * radial + ((j + 1) % radial);
        if (sign < 0) index.push(tip, a, b);
        else index.push(tip, b, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

export interface BlobOptions {
  detail?: number;
  seed?: number;
  /** Lumpiness, fraction of radius. */
  lumps?: number;
  /** Noise frequency on the unit sphere. */
  frequency?: number;
  squash?: V3;
  /** Flatten the underside below this height (fraction of radius), for things resting on the ground. */
  floor?: number | null;
}

/** A lumpy rolled ball: pebbles, moss cushions, mushroom caps, the pear's body. */
export function blob(radius: number, o: BlobOptions = {}): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, o.detail ?? 3);
  const n = noise3(o.seed ?? 3);
  const lumps = o.lumps ?? 0.12;
  const f = o.frequency ?? 1.4;
  const sq = o.squash ?? [1, 1, 1];
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const k =
      1 +
      lumps *
        (n(x * f, y * f, z * f) + 0.5 * n(x * f * 2.3 + 4, y * f * 2.3, z * f * 2.3));
    let py = y * k * sq[1];
    if (o.floor != null && py < o.floor) py = o.floor + (py - o.floor) * 0.12;
    pos.setXYZ(i, x * k * sq[0] * radius, py * radius, z * k * sq[2] * radius);
  }
  return weld(g);
}

export interface LeafOptions {
  /** Length and width of the blade (m). */
  length: number;
  width: number;
  /** Segments along and across. */
  along?: number;
  across?: number;
  /** Curl along the length (radians over the whole blade, + curls up). */
  curl?: number;
  /** Cupping across (m of rise at the margins per m of width). */
  cup?: number;
  /** Twist about the midrib over the length (radians). */
  twist?: number;
  /** Small irregular buckling (m). */
  buckle?: number;
  seed?: number;
}

/**
 * A leaf, petal or blade as a bent sheet: the stalk end at the origin, the
 * tip along +z, the upper surface facing +y. UVs span the sheet (u across,
 * v from tip 0 to base 1, matching the decal atlas cells).
 */
export function leafSheet(o: LeafOptions): THREE.BufferGeometry {
  const along = o.along ?? 8,
    across = o.across ?? 4;
  const g = new THREE.PlaneGeometry(o.width, o.length, across, along);
  const n = noise3(o.seed ?? 11);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    // Plane y runs −L/2 (base) … +L/2 (tip): map to 0 … L along +z.
    const s = (pos.getY(i) + o.length / 2) / o.length;
    let y =
      ((o.cup ?? 0) * (x * x)) / Math.max(1e-6, o.width / 2) +
      (o.buckle ?? 0) * n(x * 40, s * 6, 0);
    let z = s * o.length;
    // Curl: the midrib bends into an arc of the given total angle, the sheet
    // keeping its offset along the arc's normal.
    const bend = o.curl ?? 0;
    if (Math.abs(bend) > 1e-4) {
      const R = o.length / bend;
      const th = s * bend;
      z = R * Math.sin(th) - y * Math.sin(th);
      y = R * (1 - Math.cos(th)) + y * Math.cos(th);
    }
    const tw = (o.twist ?? 0) * s;
    const xx = x * Math.cos(tw) - y * Math.sin(tw);
    const yy = x * Math.sin(tw) + y * Math.cos(tw);
    pos.setXYZ(i, xx, yy, z);
    uv.setXY(i, uv.getX(i), 1 - s);
  }
  g.computeVertexNormals();
  return g;
}

/** Bakes a transform into a geometry (a copy). */
export function placed(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  return g.clone().applyMatrix4(m);
}

export const compose = (p: V3, q: THREE.Quaternion, s: number | V3 = 1) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...p),
    q,
    typeof s === "number" ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s),
  );

/** Merges same-attribute geometries into one (disposing the parts). */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Every part must carry the same attributes: drop UVs where one lacks them.
  const allUv = parts.every((p) => p.getAttribute("uv"));
  const allColor = parts.every((p) => p.getAttribute("color"));
  for (const p of parts) {
    if (!allUv) p.deleteAttribute("uv");
    if (!allColor) p.deleteAttribute("color");
    if (!p.getAttribute("normal")) p.computeVertexNormals();
  }
  // Indexed and non-indexed parts cannot merge: expand the indexed ones when they are mixed.
  const mixed = parts.some((p) => !p.index);
  const m = mergeGeometries(
    mixed ? parts.map((p) => (p.index ? p.toNonIndexed() : p)) : parts,
  );
  if (!m) throw new Error("merge: incompatible geometries");
  for (const p of parts) p.dispose();
  return m;
}

/** Paints a per-vertex colour (linear RGB from an sRGB hex) on every vertex of a geometry. */
export function tint(
  g: THREE.BufferGeometry,
  f: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color,
): THREE.BufferGeometry {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const nor = g.getAttribute("normal") as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const c = f(p, n);
    col[3 * i] = c.r;
    col[3 * i + 1] = c.g;
    col[3 * i + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/** sRGB hex → linear THREE.Color, with an optional lightness and hue nudge. */
export function clayColor(hex: number, light = 0, hue = 0, sat = 0): THREE.Color {
  const c = new THREE.Color(hex);
  if (light || hue || sat) c.offsetHSL(hue, sat, light);
  return c;
}

export const quatFromTo = (from: V3, to: V3) =>
  new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(...from).normalize(),
    new THREE.Vector3(...to).normalize(),
  );

/** A rotation taking +y to `up` and +z toward `forward` (projected). */
export function frameQuat(up: V3, forward: V3): THREE.Quaternion {
  const u = new THREE.Vector3(...up).normalize();
  const f = new THREE.Vector3(...forward);
  f.addScaledVector(u, -f.dot(u)).normalize();
  const x = new THREE.Vector3().crossVectors(u, f);
  const m = new THREE.Matrix4().makeBasis(x, u, f);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
