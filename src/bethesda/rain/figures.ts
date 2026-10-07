/**
 * The four perspectives as rigged, skinned figures. Presentation only.
 *
 * Who each one is comes from R.A.I.N.'s Godot client (`embodiment.ts`, from
 * `agent_avatar.gd`'s LOOKS and the lab theme); how they are built is this
 * lab's, and it is built the way a character artist would block one out in
 * Blender — but in code, because nothing here ships a binary asset:
 *
 *  - **Surfaces, not stacked primitives.** The head, the torso, James's mantle
 *    and Elena's skirt are lofts through measured cross-sections (a
 *    superellipse per height, front and back depths separate), so a chin, a
 *    waist and a shoulder line exist instead of a capsule. Limbs are swept
 *    along their bones with a radius profile — a calf bulges, a wrist narrows.
 *  - **Hair is a shell of the scalp.** Each style offsets the head surface
 *    outward above a hairline that follows the angle round the head, so hair
 *    meets skin at a line rather than sitting on it like a hat.
 *  - **One skinned mesh per figure, on the shared rig.** The humans use the
 *    34-bone skeleton in `game/characters/rig.ts` (the one the city's
 *    pedestrians and Blacksite's soldiers already agree on) plus face bones —
 *    eyes, upper lids and the mouth — and, for Luca, a scarf tail. James has
 *    his own: a hub, a mantle that breathes, and eight six-bone arms. Weights
 *    come from proximity to each bone's rest segment, restricted per part
 *    (hair to the head, a skirt to the pelvis and thighs), so joints round
 *    over and nothing drags what it should not.
 *  - **One material pair.** Colour, roughness and metalness are per vertex;
 *    `figureMaterial` adds a cloth weave, underside occlusion and a grazing
 *    rim so a silhouette separates from the lab's dark walls. Solid parts and
 *    open sheets (hair, lids, a skirt) are the two draw groups.
 *
 * Every vertex is deterministic: the only noise is `seededNoise2D` with fixed
 * seeds, so the same perspective is the same figure in every browser.
 * Geometry is built once per perspective and kept for the page, shared
 * between the lab and the city.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { seededNoise2D } from "@/lib/noise";
import {
  B,
  BONE_COUNT,
  BONE_NAMES,
  BONE_PARENT,
  REST_POS,
  REST_TIP,
} from "../../game/characters/rig";
import type { Perspective } from "./contracts";
import { EMBODIMENT, LOOKS, type Look } from "./embodiment";

type HumanLook = Extract<Look, { archetype: "humanoid" }>;
type V3 = readonly [number, number, number];

/* ------------------------------------------------------------------ */
/* What a figure is                                                    */
/* ------------------------------------------------------------------ */

export interface FaceBones {
  eyeL: number;
  eyeR: number;
  lidL: number;
  lidR: number;
  mouth: number;
}

export interface FigureRig {
  who: Perspective;
  kind: "humanoid" | "octopus";
  /** Placed in the world by the animator; the skinned mesh and bones hang off it. */
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  face: FaceBones;
  /** Luca's scarf tail, top to bottom; empty for everyone else. */
  tail: readonly number[];
  /** James's hub, head (look), mantle (breath) and eight arm chains. */
  octopus: {
    hub: number;
    head: number;
    mantle: number;
    arms: readonly (readonly number[])[];
    /** Each arm's outward direction in model space, as an angle (0 = back, pi = front). */
    angles: readonly number[];
  } | null;
  /** World metres per model metre: the rig is 1.8 m; Jasmine and Elena are shorter. */
  scale: number;
  /** Ankle spread of a standing figure, model space. */
  stance: number;
  /** Radius of floor the figure covers, model space, for its contact shadow. */
  footprint: number;
  /** Rest local position of every bone, packed xyz, for resetting a pose. */
  rest: Float32Array;
  triangles: number;
  material: THREE.MeshStandardMaterial;
  dispose(): void;
}

/** Where the figure is lit: the lab's dark rooms want more rim than a sunlit street. */
export type FigureSetting = "lab" | "city";

/* ------------------------------------------------------------------ */
/* Colour                                                              */
/* ------------------------------------------------------------------ */

const SRGB = THREE.SRGBColorSpace;
const _srgb = new THREE.Color();

/** Godot's `darkened`/`lightened`, applied in sRGB as the client does. */
function tone(hex: string, darken = 0, lighten = 0): THREE.Color {
  new THREE.Color(hex).getRGB(_srgb, SRGB);
  let { r, g, b } = _srgb;
  r *= 1 - darken;
  g *= 1 - darken;
  b *= 1 - darken;
  r += (1 - r) * lighten;
  g += (1 - g) * lighten;
  b += (1 - b) * lighten;
  return new THREE.Color().setRGB(r, g, b, SRGB);
}
function mix(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return a.clone().lerp(b, t);
}

/* ------------------------------------------------------------------ */
/* Skinning                                                            */
/* ------------------------------------------------------------------ */

interface Influence {
  i: number[];
  w: number[];
}
/** Influences for one vertex; `index` is its position in the piece. */
type Skin = (x: number, y: number, z: number, out: Influence, index: number) => void;

function rigid(bone: number): Skin {
  return (_x, _y, _z, out) => {
    out.i[0] = bone;
    out.w[0] = 1;
    out.i[1] = out.i[2] = out.i[3] = bone;
    out.w[1] = out.w[2] = out.w[3] = 0;
  };
}

/** Squared distance from a point to a bone's rest segment. */
function segmentDistanceSq(
  seg: Float32Array,
  i: number,
  x: number,
  y: number,
  z: number,
) {
  const o = i * 6;
  const ax = seg[o]!,
    ay = seg[o + 1]!,
    az = seg[o + 2]!;
  const dx = seg[o + 3]! - ax,
    dy = seg[o + 4]! - ay,
    dz = seg[o + 5]! - az;
  const len = dx * dx + dy * dy + dz * dz;
  let t = len > 1e-12 ? ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + dx * t - x,
    py = ay + dy * t - y,
    pz = az + dz * t - z;
  return px * px + py * py + pz * pz;
}

/**
 * Four influences by inverse distance to the allowed bones' rest segments.
 * The cube is the soldier's: limbs stay solid and joints round over.
 */
function near(seg: Float32Array, bones: readonly number[]): Skin {
  const d = [0, 0, 0, 0],
    b = [0, 0, 0, 0];
  return (x, y, z, out) => {
    d.fill(Infinity);
    b.fill(bones[0]!);
    for (const bone of bones) {
      const s = segmentDistanceSq(seg, bone, x, y, z);
      for (let k = 0; k < 4; k++) {
        if (s < d[k]!) {
          for (let m = 3; m > k; m--) {
            d[m] = d[m - 1]!;
            b[m] = b[m - 1]!;
          }
          d[k] = s;
          b[k] = bone;
          break;
        }
      }
    }
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const w = Number.isFinite(d[k]!) ? 1 / Math.pow(Math.sqrt(d[k]!) + 0.012, 3) : 0;
      out.w[k] = w;
      out.i[k] = b[k]!;
      total += w;
    }
    for (let k = 0; k < 4; k++) out.w[k] = out.w[k]! / total;
  };
}

/**
 * A chain hung from `parent`: a vertex at chain position `f` (0 at the first
 * bone, `bones.length` at the tip) blends the two bones whose middles it lies
 * between, so the chain bends smoothly rather than at its joints.
 */
function chain(parent: number, bones: readonly number[], f: number, out: Influence) {
  const n = bones.length;
  const at = Math.max(0, Math.min(n, f)) - 0.5;
  const k = Math.floor(at);
  const t = at - k;
  const lo = k < 0 ? parent : bones[Math.min(n - 1, k)]!;
  const hi = bones[Math.min(n - 1, k + 1)]!;
  out.i[0] = lo;
  out.w[0] = 1 - t;
  out.i[1] = hi;
  out.w[1] = t;
  out.i[2] = out.i[3] = lo;
  out.w[2] = out.w[3] = 0;
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

interface Piece {
  g: THREE.BufferGeometry;
  /** Flat colour, unless the geometry carries its own `color`. */
  color?: THREE.Color;
  rough: number;
  metal?: number;
  /**
   * Skin: 1 for a whole piece, or the skin colour, in which case only the
   * vertices painted that colour count (a sleeve and its bare wrist).
   */
  sss?: number | THREE.Color;
  /** An open sheet, drawn from both sides. */
  thin?: boolean;
  skin: Skin;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function ellipsoid(
  r: V3,
  at: V3,
  rot: V3 = [0, 0, 0],
  seg: [number, number] = [14, 10],
): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg[0], seg[1]);
  g.scale(r[0], r[1], r[2]);
  if (rot[0] || rot[1] || rot[2]) {
    g.applyQuaternion(_q.setFromEuler(_e.set(rot[0], rot[1], rot[2], "YXZ")));
  }
  g.translate(at[0], at[1], at[2]);
  return g;
}

function colorize(
  g: THREE.BufferGeometry,
  paint: (x: number, y: number, z: number, out: THREE.Color) => void,
) {
  const p = g.getAttribute("position");
  const c = new Float32Array(p.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    paint(p.getX(i), p.getY(i), p.getZ(i), col);
    c[i * 3] = col.r;
    c[i * 3 + 1] = col.g;
    c[i * 3 + 2] = col.b;
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
  return g;
}

/** Flip every triangle if the sample one faces inward. */
function faceOutward(g: THREE.BufferGeometry, tri: number, centre: THREE.Vector3) {
  const index = g.getIndex()!;
  const p = g.getAttribute("position");
  const a = new THREE.Vector3().fromBufferAttribute(p, index.getX(tri * 3));
  const b = new THREE.Vector3().fromBufferAttribute(p, index.getX(tri * 3 + 1));
  const c = new THREE.Vector3().fromBufferAttribute(p, index.getX(tri * 3 + 2));
  const n = b.clone().sub(a).cross(c.clone().sub(a));
  if (n.dot(a.clone().sub(centre)) >= 0) return;
  const arr = index.array as Uint16Array | Uint32Array;
  for (let i = 0; i < arr.length; i += 3) {
    const t = arr[i + 1]!;
    arr[i + 1] = arr[i + 2]!;
    arr[i + 2] = t;
  }
  index.needsUpdate = true;
}

/**
 * A tube swept from `a` to `b` with a radius profile `[t, lateral, forward]`,
 * eased between keys, and domed ends. `hint` picks which way "forward" is.
 */
function sweep(
  a: V3,
  b: V3,
  keys: readonly (readonly [number, number, number])[],
  opts: { seg?: number; rings?: number; hint?: V3; caps?: [boolean, boolean] } = {},
): THREE.BufferGeometry {
  const seg = opts.seg ?? 14,
    rings = opts.rings ?? 10;
  const A = new THREE.Vector3(...a),
    Bv = new THREE.Vector3(...b);
  const axis = Bv.clone().sub(A);
  const len = axis.length();
  axis.divideScalar(len);
  const hint = new THREE.Vector3(...(opts.hint ?? [0, 0, -1]));
  const fwd = hint.clone().addScaledVector(axis, -hint.dot(axis));
  if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0).addScaledVector(axis, -axis.x);
  fwd.normalize();
  const lat = new THREE.Vector3().crossVectors(axis, fwd).normalize();
  const radius = (t: number): [number, number] => {
    let k = 0;
    while (k < keys.length - 2 && keys[k + 1]![0] < t) k++;
    const k0 = keys[k]!,
      k1 = keys[Math.min(keys.length - 1, k + 1)]!;
    const span = k1[0] - k0[0] || 1;
    let s = Math.max(0, Math.min(1, (t - k0[0]) / span));
    s = s * s * (3 - 2 * s);
    return [k0[1] + (k1[1] - k0[1]) * s, k0[2] + (k1[2] - k0[2]) * s];
  };
  const [capA, capB] = opts.caps ?? [true, true];
  // Ring list: [centre along axis (m), lateral r, forward r].
  const list: [number, number, number][] = [];
  const dome = [0.92, 0.7, 0.38];
  const [ra0, rf0] = radius(0),
    [ra1, rf1] = radius(1);
  if (capA)
    for (const c of dome) {
      const s = Math.sqrt(1 - c * c);
      list.push([-s * Math.min(ra0, rf0), ra0 * c, rf0 * c]);
    }
  list.reverse();
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const [rl, rfw] = radius(t);
    list.push([t * len, rl, rfw]);
  }
  if (capB)
    for (const c of dome) {
      const s = Math.sqrt(1 - c * c);
      list.push([len + s * Math.min(ra1, rf1), ra1 * c, rf1 * c]);
    }
  const pos: number[] = [];
  for (const [d, rl, rfw] of list) {
    for (let k = 0; k < seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      _v.copy(A)
        .addScaledVector(axis, d)
        .addScaledVector(lat, Math.cos(th) * rl)
        .addScaledVector(fwd, Math.sin(th) * rfw);
      pos.push(_v.x, _v.y, _v.z);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < list.length - 1; r++)
    for (let k = 0; k < seg; k++) {
      const i0 = r * seg + k,
        i1 = r * seg + ((k + 1) % seg),
        i2 = (r + 1) * seg + ((k + 1) % seg),
        i3 = (r + 1) * seg + k;
      index.push(i0, i1, i3, i1, i2, i3);
    }
  const poles: [number, number][] = [];
  if (capA) poles.push([0, -Math.min(ra0, rf0)]);
  if (capB) poles.push([list.length - 1, len + Math.min(ra1, rf1)]);
  for (const [row, d] of poles) {
    const p = pos.length / 3;
    _v.copy(A).addScaledVector(axis, d);
    pos.push(_v.x, _v.y, _v.z);
    for (let k = 0; k < seg; k++) {
      const i0 = row * seg + k,
        i1 = row * seg + ((k + 1) % seg);
      if (row === 0) index.push(i1, i0, p);
      else index.push(i0, i1, p);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  const mid = (capA ? dome.length : 0) + Math.floor(rings / 2);
  faceOutward(g, mid * seg * 2, A.clone().addScaledVector(axis, list[mid]![0]));
  g.computeVertexNormals();
  return g;
}

/** A closed or open tube along points, for frames, bands and scarf wraps. */
function tubeAlong(
  points: THREE.Vector3[],
  radius: number,
  closed: boolean,
  seg = 48,
  radial = 8,
) {
  const curve = new THREE.CatmullRomCurve3(points, closed, "centripetal");
  return new THREE.TubeGeometry(curve, seg, radius, radial, closed);
}

/** A flat strap following a path, its width across the surface it lies on. */
function ribbon(
  points: THREE.Vector3[],
  normals: THREE.Vector3[],
  width: number,
  thick: number,
) {
  const pos: number[] = [];
  const t = new THREE.Vector3(),
    bn = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]!,
      next = points[Math.min(points.length - 1, i + 1)]!;
    t.subVectors(next, prev).normalize();
    n.copy(normals[i]!);
    bn.crossVectors(t, n).normalize();
    n.crossVectors(bn, t).normalize();
    const c = points[i]!;
    for (const [sb, sn] of [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ] as const) {
      _v.copy(c)
        .addScaledVector(bn, (sb * width) / 2)
        .addScaledVector(n, (sn * thick) / 2);
      pos.push(_v.x, _v.y, _v.z);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < points.length - 1; i++)
    for (let s = 0; s < 4; s++) {
      const a = i * 4 + s,
        b = i * 4 + ((s + 1) % 4),
        c = (i + 1) * 4 + ((s + 1) % 4),
        d = (i + 1) * 4 + s;
      index.push(a, d, b, b, d, c);
    }
  const last = (points.length - 1) * 4;
  index.push(0, 1, 2, 0, 2, 3, last, last + 2, last + 1, last, last + 3, last + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* Lofted surfaces                                                     */
/* ------------------------------------------------------------------ */

/**
 * One cross-section: half-width `w`, front depth `df` (towards -z, the way a
 * figure faces), back depth `db`, centred at `zc`.
 */
interface Ring {
  y: number;
  w: number;
  df: number;
  db: number;
  zc: number;
}

/**
 * A surface through cross-sections, Catmull-Rom between them. `a` runs round
 * the section: 0 at the back (+z), pi/2 at the figure's right (+x), pi at the
 * front.
 */
class Profile {
  readonly y0: number;
  readonly y1: number;
  constructor(
    private readonly rings: readonly Ring[],
    private readonly n = 2.2,
  ) {
    this.y0 = rings[0]!.y;
    this.y1 = rings[rings.length - 1]!.y;
  }
  section(y: number) {
    const R = this.rings;
    let i = 0;
    while (i < R.length - 2 && R[i + 1]!.y < y) i++;
    const r0 = R[Math.max(0, i - 1)]!,
      r1 = R[i]!,
      r2 = R[i + 1]!,
      r3 = R[Math.min(R.length - 1, i + 2)]!;
    const t = Math.max(0, Math.min(1, (y - r1.y) / (r2.y - r1.y || 1)));
    const cr = (k: "w" | "df" | "db" | "zc") => {
      const p0 = r0[k],
        p1 = r1[k],
        p2 = r2[k],
        p3 = r3[k];
      return (
        0.5 *
        (2 * p1 +
          (-p0 + p2) * t +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
          (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
      );
    };
    return {
      w: Math.max(0.002, cr("w")),
      df: Math.max(0.002, cr("df")),
      db: Math.max(0.002, cr("db")),
      zc: cr("zc"),
    };
  }
  point(a: number, y: number, out: THREE.Vector3) {
    const s = this.section(y);
    const e = 2 / this.n;
    const sa = Math.sin(a),
      ca = Math.cos(a);
    const px = Math.sign(sa) * Math.pow(Math.abs(sa), e);
    const pz = Math.sign(ca) * Math.pow(Math.abs(ca), e);
    return out.set(s.w * px, y, s.zc + (ca >= 0 ? s.db : s.df) * pz);
  }
  normal(a: number, y: number, out: THREE.Vector3) {
    const h = 1e-3;
    const ylo = Math.max(this.y0, y - h),
      yhi = Math.min(this.y1, y + h);
    const pa = this.point(a + h, y, new THREE.Vector3()).sub(
      this.point(a - h, y, new THREE.Vector3()),
    );
    const py = this.point(a, yhi, new THREE.Vector3()).sub(
      this.point(a, ylo, new THREE.Vector3()),
    );
    out.crossVectors(pa, py);
    if (out.lengthSq() < 1e-14) out.set(0, y > (this.y0 + this.y1) / 2 ? 1 : -1, 0);
    return out.normalize();
  }
}

interface Row {
  y: number;
  /** Rows in the same band share vertices; a band edge is a crisp colour line. */
  band: number;
}
function bandRows(
  y0: number,
  y1: number,
  step: number,
  cuts: readonly number[] = [],
): Row[] {
  const edges = [y0, ...cuts.filter((c) => c > y0 && c < y1).sort((p, q) => p - q), y1];
  const rows: Row[] = [];
  for (let b = 0; b < edges.length - 1; b++) {
    const lo = edges[b]!,
      hi = edges[b + 1]!;
    const n = Math.max(1, Math.ceil((hi - lo) / step));
    for (let i = 0; i <= n; i++)
      rows.push({ y: lo + ((hi - lo) * i) / n, band: (lo + hi) / 2 });
  }
  return rows;
}

/**
 * The lofted surface itself, with analytic normals so a duplicated band edge
 * shades as one surface while its colour changes crisply.
 */
function loft(
  p: Profile,
  seg: number,
  rows: readonly Row[],
  paint: (a: number, y: number, band: number, out: THREE.Color) => void,
  caps: { top?: boolean; bottom?: boolean } = {},
): THREE.BufferGeometry {
  const pos: number[] = [],
    nor: number[] = [],
    col: number[] = [];
  const c = new THREE.Color();
  for (const r of rows)
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      p.point(a, r.y, _v);
      p.normal(a, r.y, _w);
      paint(a, r.y, r.band, c);
      pos.push(_v.x, _v.y, _v.z);
      nor.push(_w.x, _w.y, _w.z);
      col.push(c.r, c.g, c.b);
    }
  const index: number[] = [];
  for (let r = 0; r < rows.length - 1; r++) {
    if (rows[r]!.band !== rows[r + 1]!.band) continue;
    for (let k = 0; k < seg; k++) {
      const i0 = r * seg + k,
        i1 = r * seg + ((k + 1) % seg),
        i2 = (r + 1) * seg + ((k + 1) % seg),
        i3 = (r + 1) * seg + k;
      index.push(i0, i1, i3, i1, i2, i3);
    }
  }
  const pole = (row: number, up: boolean) => {
    const r = rows[row]!;
    const s = p.section(r.y);
    const at = pos.length / 3;
    pos.push(0, up ? p.y1 + 0.002 : p.y0 - 0.002, s.zc);
    nor.push(0, up ? 1 : -1, 0);
    paint(Math.PI, r.y, r.band, c);
    col.push(c.r, c.g, c.b);
    for (let k = 0; k < seg; k++) {
      const i0 = row * seg + k,
        i1 = row * seg + ((k + 1) % seg);
      if (up) index.push(i0, i1, at);
      else index.push(i1, i0, at);
    }
  };
  if (caps.top) pole(rows.length - 1, true);
  if (caps.bottom) pole(0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  return g;
}

/**
 * A shell over part of a surface: from a per-angle lower edge up to `top`,
 * lifted outward by `lift(a, v)` (v = 0 at the edge, 1 at the top), closed
 * at the crown by a pole. Hair is this.
 */
function shell(
  p: Profile,
  o: {
    seg: number;
    rows: number;
    from: (a: number) => number;
    top: number;
    arc?: readonly [number, number];
    lift: (a: number, v: number) => number;
    nudge?: (a: number, v: number, out: THREE.Vector3) => void;
    paint: (a: number, v: number, out: THREE.Color) => void;
    pole?: boolean;
  },
): THREE.BufferGeometry {
  const wrap = !o.arc;
  const cols = wrap ? o.seg : o.seg + 1;
  const [a0, a1] = o.arc ?? [0, Math.PI * 2];
  const pos: number[] = [],
    col: number[] = [];
  const c = new THREE.Color(),
    shift = new THREE.Vector3();
  for (let r = 0; r <= o.rows; r++) {
    const v = r / o.rows;
    for (let k = 0; k < cols; k++) {
      const a = a0 + ((a1 - a0) * k) / o.seg;
      const y = o.from(a) + (o.top - o.from(a)) * v;
      p.point(a, y, _v);
      p.normal(a, y, _w);
      _v.addScaledVector(_w, o.lift(a, v));
      if (o.nudge) {
        shift.set(0, 0, 0);
        o.nudge(a, v, shift);
        _v.add(shift);
      }
      o.paint(a, v, c);
      pos.push(_v.x, _v.y, _v.z);
      col.push(c.r, c.g, c.b);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < o.rows; r++)
    for (let k = 0; k < o.seg; k++) {
      const k1 = wrap ? (k + 1) % cols : k + 1;
      const i0 = r * cols + k,
        i1 = r * cols + k1,
        i2 = (r + 1) * cols + k1,
        i3 = (r + 1) * cols + k;
      index.push(i0, i1, i3, i1, i2, i3);
    }
  if (o.pole) {
    const at = pos.length / 3;
    const s = p.section(p.y1);
    pos.push(0, p.y1 + o.lift(Math.PI, 1), s.zc + 0.004);
    o.paint(Math.PI, 1, c);
    col.push(c.r, c.g, c.b);
    const row = o.rows * cols;
    for (let k = 0; k < o.seg; k++) {
      const k1 = wrap ? (k + 1) % cols : k + 1;
      index.push(row + k, row + k1, at);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * A garment laid over a surface: the band between `y0` and `y1`, between two
 * angles that may change with height, lifted a few millimetres. Analytic
 * normals, so it shades as the surface beneath it does.
 */
function patchOn(
  p: Profile,
  o: {
    y0: number;
    y1: number;
    span: (y: number) => readonly [number, number];
    lift: number;
    rows?: number;
    cols?: number;
  },
): THREE.BufferGeometry {
  const rows = o.rows ?? Math.max(4, Math.ceil((o.y1 - o.y0) / 0.01)),
    cols = o.cols ?? 18;
  const pos: number[] = [],
    nor: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const y = o.y0 + ((o.y1 - o.y0) * r) / rows;
    const [a0, a1] = o.span(y);
    for (let c = 0; c <= cols; c++) {
      const a = a0 + ((a1 - a0) * c) / cols;
      p.point(a, y, _v);
      p.normal(a, y, _w);
      _v.addScaledVector(_w, o.lift);
      pos.push(_v.x, _v.y, _v.z);
      nor.push(_w.x, _w.y, _w.z);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i0 = r * (cols + 1) + c,
        i1 = i0 + 1,
        i3 = i0 + cols + 1,
        i2 = i3 + 1;
      index.push(i0, i1, i3, i1, i2, i3);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(index);
  return g;
}

/** Angle from the front of a section: 0 straight ahead, pi straight behind. */
function fromFront(a: number) {
  const d = Math.abs(
    ((((a - Math.PI) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI,
  );
  return d;
}
function smooth(e0: number, e1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
/** Piecewise-linear lookup over sorted `[x, y]` knots. */
function knots(k: readonly (readonly [number, number])[], x: number) {
  if (x <= k[0]![0]) return k[0]![1];
  for (let i = 1; i < k.length; i++) {
    const [x1, y1] = k[i]!;
    if (x <= x1) {
      const [x0, y0] = k[i - 1]!;
      const t = smooth(0, 1, (x - x0) / (x1 - x0));
      return y0 + (y1 - y0) * t;
    }
  }
  return k[k.length - 1]![1];
}

/* ------------------------------------------------------------------ */
/* Skeletons                                                           */
/* ------------------------------------------------------------------ */

interface BoneSpec {
  name: string;
  parent: number;
  p: V3;
  tip: V3;
}

function humanSpecs(): BoneSpec[] {
  const specs: BoneSpec[] = [];
  for (let i = 0; i < BONE_COUNT; i++)
    specs.push({
      name: BONE_NAMES[i]!,
      parent: BONE_PARENT[i]!,
      p: [REST_POS[i * 3]!, REST_POS[i * 3 + 1]!, REST_POS[i * 3 + 2]!],
      tip: [REST_TIP[i * 3]!, REST_TIP[i * 3 + 1]!, REST_TIP[i * 3 + 2]!],
    });
  return specs;
}
function addBone(specs: BoneSpec[], name: string, parent: number, p: V3, tip?: V3) {
  specs.push({ name, parent, p, tip: tip ?? [p[0], p[1], p[2] - 0.01] });
  return specs.length - 1;
}
function segmentsOf(specs: readonly BoneSpec[]) {
  const seg = new Float32Array(specs.length * 6);
  specs.forEach((s, i) => seg.set([...s.p, ...s.tip], i * 6));
  return seg;
}

/* ------------------------------------------------------------------ */
/* Faces, shared by both archetypes                                    */
/* ------------------------------------------------------------------ */

interface EyeSpec {
  centre: V3;
  radius: number;
  /** Which way the iris looks at rest. */
  yaw: number;
  sclera: THREE.Color;
  iris: THREE.Color;
  lid: THREE.Color;
  lash: THREE.Color;
}

/** An eyeball with its iris and pupil, on its own bone. */
function eyePieces(e: EyeSpec, bone: number): Piece[] {
  const r = e.radius;
  const dir = new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
  const at = (d: number): V3 => [
    e.centre[0] + dir.x * d,
    e.centre[1] + dir.y * d,
    e.centre[2] + dir.z * d,
  ];
  return [
    {
      g: ellipsoid([r, r, r], e.centre, [0, 0, 0], [16, 12]),
      color: e.sclera,
      rough: 0.28,
      skin: rigid(bone),
    },
    {
      g: ellipsoid([r * 0.55, r * 0.55, r * 0.22], at(r * 0.86), [0, e.yaw, 0], [16, 8]),
      color: e.iris,
      rough: 0.1,
      skin: rigid(bone),
    },
    {
      g: ellipsoid([r * 0.26, r * 0.26, r * 0.12], at(r * 0.99), [0, e.yaw, 0], [12, 6]),
      color: new THREE.Color(0x060607),
      rough: 0.06,
      skin: rigid(bone),
    },
  ];
}

/**
 * The upper lid: a cap over the top of the eye, on its own bone so a blink
 * is one rotation. Its rim carries the lash line.
 */
function lidPiece(e: EyeSpec, bone: number, heavy: boolean): Piece {
  const r = e.radius * 1.09;
  const g = new THREE.SphereGeometry(r, 18, 7, 0, Math.PI * 2, 0, 1.02);
  colorize(g, (_x, y, _z, out) => {
    const rim = 1 - smooth(r * Math.cos(1.02) * 0.98, r * Math.cos(0.8), y);
    out.copy(e.lid).lerp(e.lash, rim * (heavy ? 1 : 0.6));
  });
  g.applyQuaternion(_q.setFromEuler(_e.set(-0.06, e.yaw, 0, "YXZ")));
  g.translate(...e.centre);
  return { g, rough: 0.5, thin: true, sss: 1, skin: rigid(bone) };
}

/* ------------------------------------------------------------------ */
/* The humans                                                          */
/* ------------------------------------------------------------------ */

const HEAD = new Profile(
  [
    { y: 1.522, w: 0.012, df: 0.012, db: 0.012, zc: -0.062 },
    { y: 1.532, w: 0.03, df: 0.022, db: 0.03, zc: -0.052 },
    { y: 1.55, w: 0.05, df: 0.045, db: 0.055, zc: -0.032 },
    { y: 1.575, w: 0.062, df: 0.07, db: 0.075, zc: -0.012 },
    { y: 1.605, w: 0.07, df: 0.086, db: 0.088, zc: -0.002 },
    { y: 1.64, w: 0.075, df: 0.092, db: 0.096, zc: 0.004 },
    { y: 1.68, w: 0.077, df: 0.09, db: 0.1, zc: 0.008 },
    { y: 1.715, w: 0.072, df: 0.078, db: 0.094, zc: 0.01 },
    { y: 1.742, w: 0.058, df: 0.06, db: 0.075, zc: 0.012 },
    { y: 1.758, w: 0.036, df: 0.036, db: 0.046, zc: 0.012 },
    { y: 1.766, w: 0.012, df: 0.012, db: 0.016, zc: 0.012 },
  ],
  2.15,
);

const TORSO_MASCULINE = new Profile(
  [
    { y: 0.8, w: 0.08, df: 0.055, db: 0.062, zc: 0.014 },
    { y: 0.845, w: 0.125, df: 0.083, db: 0.09, zc: 0.012 },
    { y: 0.9, w: 0.158, df: 0.098, db: 0.105, zc: 0.008 },
    { y: 0.96, w: 0.163, df: 0.1, db: 0.108, zc: 0.006 },
    { y: 1.02, w: 0.152, df: 0.098, db: 0.1, zc: 0 },
    { y: 1.09, w: 0.148, df: 0.098, db: 0.098, zc: -0.004 },
    { y: 1.17, w: 0.158, df: 0.104, db: 0.1, zc: -0.008 },
    { y: 1.25, w: 0.172, df: 0.112, db: 0.104, zc: -0.01 },
    { y: 1.32, w: 0.18, df: 0.112, db: 0.102, zc: -0.01 },
    { y: 1.38, w: 0.178, df: 0.1, db: 0.096, zc: -0.008 },
    { y: 1.425, w: 0.16, df: 0.08, db: 0.082, zc: -0.004 },
    { y: 1.455, w: 0.115, df: 0.062, db: 0.066, zc: 0.004 },
    { y: 1.474, w: 0.066, df: 0.048, db: 0.052, zc: 0.01 },
    { y: 1.492, w: 0.036, df: 0.032, db: 0.036, zc: 0.012 },
  ],
  2.4,
);
const TORSO_FEMININE = new Profile(
  [
    { y: 0.8, w: 0.085, df: 0.056, db: 0.066, zc: 0.014 },
    { y: 0.845, w: 0.13, df: 0.084, db: 0.094, zc: 0.012 },
    { y: 0.9, w: 0.165, df: 0.1, db: 0.112, zc: 0.01 },
    { y: 0.96, w: 0.168, df: 0.1, db: 0.115, zc: 0.008 },
    { y: 1.02, w: 0.15, df: 0.095, db: 0.1, zc: 0 },
    { y: 1.09, w: 0.13, df: 0.09, db: 0.09, zc: -0.004 },
    { y: 1.17, w: 0.14, df: 0.1, db: 0.092, zc: -0.008 },
    { y: 1.25, w: 0.155, df: 0.122, db: 0.096, zc: -0.012 },
    { y: 1.31, w: 0.162, df: 0.118, db: 0.096, zc: -0.012 },
    { y: 1.37, w: 0.162, df: 0.098, db: 0.09, zc: -0.008 },
    { y: 1.415, w: 0.148, df: 0.078, db: 0.078, zc: -0.004 },
    { y: 1.45, w: 0.108, df: 0.06, db: 0.064, zc: 0.004 },
    { y: 1.47, w: 0.062, df: 0.046, db: 0.05, zc: 0.01 },
    { y: 1.49, w: 0.034, df: 0.03, db: 0.034, zc: 0.012 },
  ],
  2.4,
);

const EYE_Y = 1.649,
  EYE_X = 0.032,
  EYE_Z = -0.074;
const MOUTH: V3 = [0, 1.5805, -0.08];

const rest = (i: number): V3 => [
  REST_POS[i * 3]!,
  REST_POS[i * 3 + 1]!,
  REST_POS[i * 3 + 2]!,
];

interface Built {
  specs: BoneSpec[];
  pieces: Piece[];
  face: FaceBones;
  tail: number[];
  octopus: FigureRig["octopus"];
  scale: number;
  stance: number;
  footprint: number;
}

function buildHuman(who: Perspective, look: HumanLook): Built {
  const e = EMBODIMENT[who];
  const fem = look.build === "feminine";
  const body = tone(e.body),
    bodyShade = tone(e.body, 0.22),
    bodyLight = tone(e.body, 0, 0.25),
    accent = tone(e.accent),
    accentShade = tone(e.accent, 0.25),
    accentLight = tone(e.accent, 0, 0.3),
    skin = tone(e.skin),
    hair = tone(e.hair),
    hairLight = tone(e.hair, 0, 0.22),
    outline = "#1b2230",
    shoe = tone(outline, 0, 0.12),
    white = tone("#f5f3ea"),
    gold = tone("#f2c14e"),
    frame = tone(outline, 0, 0.1);
  const lips = look.lips ? tone(look.lips) : mix(skin, tone("#a8645c"), 0.5);
  const lipsDark = look.lips ? tone(look.lips, 0.45) : tone("#5d2d2d", 0.3);
  const legSkin = tone(e.skin, 0.08);

  const specs = humanSpecs();
  const face: FaceBones = {
    eyeL: addBone(specs, "eyeL", B.head, [-EYE_X, EYE_Y, EYE_Z]),
    eyeR: addBone(specs, "eyeR", B.head, [EYE_X, EYE_Y, EYE_Z]),
    lidL: addBone(specs, "lidL", B.head, [-EYE_X, EYE_Y, EYE_Z]),
    lidR: addBone(specs, "lidR", B.head, [EYE_X, EYE_Y, EYE_Z]),
    mouth: addBone(specs, "mouth", B.head, MOUTH),
  };
  const tail: number[] = [];
  if (look.outfit === "scarf") {
    const at: V3[] = [
      [-0.04, 1.445, -0.112],
      [-0.046, 1.355, -0.142],
      [-0.05, 1.265, -0.15],
    ];
    const tip: V3 = [-0.053, 1.175, -0.152];
    at.forEach((p, i) =>
      tail.push(
        addBone(specs, `scarf${i}`, i ? tail[i - 1]! : B.spine3, p, at[i + 1] ?? tip),
      ),
    );
  }
  const seg = segmentsOf(specs);
  const pieces: Piece[] = [];
  const add = (p: Piece) => pieces.push(p);

  /* ------------------------------------------------------ torso */
  const torso = fem ? TORSO_FEMININE : TORSO_MASCULINE;
  const torsoSkin = near(seg, [
    B.pelvis,
    B.spine1,
    B.spine2,
    B.spine3,
    B.neck,
    B.clavicleL,
    B.clavicleR,
    B.thighL,
    B.thighR,
  ]);
  const waist =
    look.outfit === "overalls" ? 1.075 : look.outfit === "scarf" ? 0.99 : 0.985;
  const cuts = look.outfit === "scarf" ? [waist, 1.025, 1.13, 1.155] : [waist, 1.165];
  add({
    g: loft(torso, 48, bandRows(torso.y0, torso.y1, 0.012, cuts), (a, _y, band, out) => {
      const f = fromFront(a);
      if (band < waist) {
        out.copy(look.outfit === "overalls" ? accent : accentShade);
        return;
      }
      switch (look.outfit) {
        case "overalls":
          // The shirt; the bib is laid over it below.
          out.copy(body);
          break;
        case "scarf":
          // A ribbed hem and Godot's light stripe across the sweater.
          out.copy(
            band < 1.025 ? bodyShade : band > 1.13 && band < 1.155 ? bodyLight : body,
          );
          break;
        case "blazer_skirt":
          // The jacket's closing edge below the button; the shirt and lapels are laid over it.
          out.copy(band < 1.165 && f < 0.012 ? accentShade : body);
          break;
      }
    }),
    rough: 0.86,
    skin: torsoSkin,
  });
  // Garments laid over the torso as their own surfaces, so their edges are
  // edges and not a blend between two vertex colours.
  if (look.outfit === "overalls") {
    const bib = (
      a0: number,
      a1: number,
      y0: number,
      y1: number,
      lift: number,
      color: THREE.Color,
    ) =>
      add({
        g: patchOn(torso, { y0, y1, span: () => [a0, a1], lift }),
        color,
        rough: 0.84,
        skin: torsoSkin,
      });
    bib(Math.PI - 0.6, Math.PI + 0.6, waist - 0.01, 1.31, 0.004, accent);
    bib(Math.PI - 0.6, Math.PI + 0.6, 1.296, 1.31, 0.0062, accentShade);
    bib(Math.PI - 0.24, Math.PI + 0.24, 1.15, 1.245, 0.0068, accentShade);
    bib(Math.PI - 0.24, Math.PI + 0.24, 1.233, 1.245, 0.0082, accent);
    // A shirt collar round the neck.
    const collar: THREE.Vector3[] = [];
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      collar.push(
        new THREE.Vector3(
          0.066 * Math.sin(t),
          1.468 + 0.007 * Math.cos(t),
          0.008 + 0.06 * Math.cos(t),
        ),
      );
    }
    add({
      g: tubeAlong(collar, 0.011, true),
      color: bodyShade,
      rough: 0.86,
      skin: torsoSkin,
    });
  }
  if (look.outfit === "blazer_skirt") {
    // The shirt's V, and the lapels either side of it down to the button.
    const v = (y: number) =>
      y < 1.24 ? (0.04 * (y - 1.165)) / 0.075 : 0.04 + (0.4 * (y - 1.24)) / 0.23;
    const w = (y: number) =>
      0.065 + 0.045 * smooth(1.17, 1.32, y) - 0.03 * smooth(1.4, 1.47, y);
    add({
      g: patchOn(torso, {
        y0: 1.24,
        y1: 1.468,
        span: (y) => [Math.PI - v(y), Math.PI + v(y)],
        lift: 0.0025,
      }),
      color: white,
      rough: 0.8,
      skin: torsoSkin,
    });
    for (const s of [-1, 1])
      add({
        g: patchOn(torso, {
          y0: 1.165,
          y1: 1.462,
          span: (y) =>
            s > 0
              ? [Math.PI + v(y), Math.PI + v(y) + w(y)]
              : [Math.PI - v(y) - w(y), Math.PI - v(y)],
          lift: 0.0048,
        }),
        color: accent,
        rough: 0.82,
        skin: torsoSkin,
      });
  }

  /* ------------------------------------------------------- neck */
  add({
    g: sweep(
      [0, 1.44, 0.014],
      [0, 1.585, 0.004],
      [
        [0, 0.052, 0.05],
        [0.5, 0.045, 0.045],
        [1, 0.047, 0.05],
      ],
    ),
    color: skin,
    rough: 0.52,
    sss: 1,
    skin: near(seg, [B.spine3, B.neck, B.head]),
  });

  /* ------------------------------------------------------- head */
  const eyes = [-1, 1].map((s) => [s * EYE_X, EYE_Y] as const);
  const cheek = tone("#c8705e");
  add({
    g: loft(
      HEAD,
      40,
      bandRows(HEAD.y0, HEAD.y1, 0.009),
      (a, y, _band, out) => {
        HEAD.point(a, y, _v);
        out.copy(skin);
        if (_v.z < -0.04) {
          // Sockets: a little shadow round each eye, so a face has a brow.
          let d = Infinity;
          for (const [ex, ey] of eyes)
            d = Math.min(d, Math.hypot(_v.x - ex, (_v.y - ey) * 1.25));
          out.multiplyScalar(1 - 0.17 * (1 - smooth(0.012, 0.03, d)));
          const c = Math.min(
            Math.hypot(_v.x + 0.046, _v.y - 1.607),
            Math.hypot(_v.x - 0.046, _v.y - 1.607),
          );
          out.lerp(cheek, 0.07 * (1 - smooth(0.0, 0.028, c)));
        }
      },
      { top: true, bottom: true },
    ),
    rough: 0.52,
    sss: 1,
    skin: rigid(B.head),
  });
  // The nose: a bridge that leans back into the brow, a tip, two wings.
  add({
    g: ellipsoid([0.0082, 0.019, 0.0105], [0, 1.627, -0.087], [0.34, 0, 0]),
    color: skin,
    rough: 0.5,
    sss: 1,
    skin: rigid(B.head),
  });
  add({
    g: ellipsoid([0.0102, 0.0086, 0.0096], [0, 1.6095, -0.0955]),
    color: mix(skin, cheek, 0.1),
    rough: 0.46,
    sss: 1,
    skin: rigid(B.head),
  });
  for (const s of [-1, 1])
    add({
      g: ellipsoid([0.0062, 0.0052, 0.0062], [s * 0.0092, 1.6075, -0.0905]),
      color: mix(skin, cheek, 0.14),
      rough: 0.5,
      sss: 1,
      skin: rigid(B.head),
    });
  for (const s of [-1, 1])
    add({
      g: ellipsoid([0.011, 0.026, 0.017], [s * 0.076, 1.638, 0.012], [0, s * 0.25, 0]),
      color: tone(e.skin, 0.06),
      rough: 0.55,
      sss: 1,
      skin: rigid(B.head),
    });
  // Eyes, lids, brows.
  const tint = look.accessory === "glasses" ? mix(white, tone("#d8f1ff"), 0.25) : white;
  const lidColor = tone(e.skin, 0.12);
  const lashColor = tone("#1a1214");
  const eyeL: EyeSpec = {
    centre: [-EYE_X, EYE_Y, EYE_Z],
    radius: 0.0125,
    yaw: 0,
    sclera: tint,
    iris: tone(who === "Luca" ? "#4b3a24" : "#3a2a22"),
    lid: lidColor,
    lash: lashColor,
  };
  const eyeR: EyeSpec = { ...eyeL, centre: [EYE_X, EYE_Y, EYE_Z] };
  for (const p of eyePieces(eyeL, face.eyeL)) add(p);
  for (const p of eyePieces(eyeR, face.eyeR)) add(p);
  add(lidPiece(eyeL, face.lidL, look.lashes));
  add(lidPiece(eyeR, face.lidR, look.lashes));
  for (const s of [-1, 1]) {
    // A lower lid, still: it frames the eye.
    const g = new THREE.SphereGeometry(0.0134, 14, 4, 0, Math.PI * 2, Math.PI - 0.7, 0.7);
    g.rotateX(0.35);
    g.translate(s * EYE_X, EYE_Y, EYE_Z);
    add({ g, color: lidColor, rough: 0.5, thin: true, sss: 1, skin: rigid(B.head) });
    add({
      g: ellipsoid(
        [0.017, 0.0042, 0.006],
        [s * 0.033, 1.676, -0.087],
        [0.1, 0, s * -0.1],
      ),
      color: tone(e.hair, 0.1),
      rough: 0.8,
      skin: rigid(B.head),
    });
  }
  // Lips: the upper on the head, the lower and the mouth's dark on the mouth bone.
  add({
    g: ellipsoid([0.0175, 0.0046, 0.0072], [0, 1.5855, -0.0835]),
    color: lips,
    rough: 0.42,
    skin: rigid(B.head),
  });
  add({
    g: ellipsoid([0.0155, 0.0052, 0.0072], [0, 1.5755, -0.0815]),
    color: lips,
    rough: 0.4,
    skin: rigid(face.mouth),
  });
  add({
    g: ellipsoid([0.0135, 0.0026, 0.0022], [0, 1.5805, -0.0838]),
    color: lipsDark,
    rough: 0.6,
    skin: rigid(face.mouth),
  });

  /* ------------------------------------------------------ hair */
  for (const p of hairPieces(look, hair, hairLight)) add(p);

  /* ------------------------------------------------------ arms */
  const k = fem ? 0.88 : 1;
  // Sleeves in the garment's own colour; the light separates them from the torso.
  const sleeve = body;
  for (const side of [-1, 1] as const) {
    const L = side < 0;
    const clav = L ? B.clavicleL : B.clavicleR,
      upper = L ? B.upperArmL : B.upperArmR,
      fore = L ? B.foreArmL : B.foreArmR,
      twist = L ? B.foreTwistL : B.foreTwistR,
      hand = L ? B.handL : B.handR;
    const sh = rest(upper),
      el = rest(fore),
      wr = rest(hand);
    // A small deltoid under the sleeve's cap, rounding shoulder into arm.
    add({
      g: ellipsoid(
        [0.044 * k + 0.004, 0.052 * k, 0.048 * k],
        [side * 0.172, 1.382, -0.012],
      ),
      color: sleeve,
      rough: 0.86,
      skin: near(seg, [clav, upper, B.spine3]),
    });
    // One tube from shoulder to wrist, so the elbow is a bend in a sleeve and
    // not two capsules meeting. The bones do the bending.
    const elbow = (sh[1] - el[1]) / (sh[1] - wr[1]);
    const rolled = look.outfit === "overalls";
    const cuffTop = el[1] - 0.03,
      cuffBottom = el[1] - 0.062;
    const cuffT = (sh[1] - (cuffTop + cuffBottom) / 2) / (sh[1] - wr[1]);
    const armKeys: [number, number, number][] = [
      [0, 0.046, 0.05],
      [0.18, 0.047, 0.049],
      [0.45, 0.041, 0.043],
      [elbow, 0.039, 0.04],
      // The forearm's swell, or a rolled cuff where the swell would be.
      ...(rolled
        ? ([
            [cuffT - 0.05, 0.042, 0.045],
            [cuffT, 0.046, 0.049],
            [cuffT + 0.06, 0.038, 0.041],
          ] as [number, number, number][])
        : ([[elbow + 0.1, 0.041, 0.044]] as [number, number, number][])),
      [0.9, 0.03, 0.032],
      [1, 0.027, 0.029],
    ];
    const armG = sweep(
      sh,
      wr,
      armKeys.map(([t, a, b]) => [t, a * k, b * k] as const),
      { seg: 16, rings: 26 },
    );
    const cuff = wr[1] + 0.03;
    add({
      g: colorize(armG, (_x, y, _z, out) => {
        if (rolled) {
          // Jasmine's sleeves are rolled to the elbow.
          if (y > cuffTop) out.copy(sleeve);
          else if (y > cuffBottom) out.copy(bodyShade);
          else out.copy(skin);
        } else if (y > cuff) out.copy(sleeve);
        else if (look.outfit === "blazer_skirt" && y > cuff - 0.012) out.copy(white);
        else out.copy(skin);
      }),
      rough: 0.84,
      sss: skin,
      skin: near(seg, [clav, upper, fore, twist, hand]),
    });
    // The hand: palm, fingers curled a little toward the thigh, thumb ahead.
    const hx = wr[0];
    add({
      g: ellipsoid(
        [0.016 * k + 0.003, 0.045, 0.037 * k],
        [hx + side * 0.002, 0.822, -0.004],
      ),
      color: skin,
      rough: 0.55,
      sss: 1,
      skin: near(seg, [twist, hand]),
    });
    add({
      g: ellipsoid(
        [0.013 * k + 0.002, 0.04, 0.034 * k],
        [hx, 0.762, -0.006],
        [0, 0, side * -0.22],
      ),
      color: skin,
      rough: 0.55,
      sss: 1,
      skin: rigid(hand),
    });
    add({
      g: sweep(
        [hx - side * 0.006, 0.852, -0.024],
        [hx - side * 0.012, 0.802, -0.046],
        [
          [0, 0.011, 0.011],
          [1, 0.0085, 0.0085],
        ],
        { seg: 8, rings: 3 },
      ),
      color: skin,
      rough: 0.55,
      sss: 1,
      skin: rigid(hand),
    });
  }

  /* ------------------------------------------------------ legs */
  const leg =
    look.outfit === "overalls" ? accent : look.outfit === "scarf" ? accentShade : legSkin;
  const sole =
    look.outfit === "overalls"
      ? tone("#d9d4c8")
      : look.outfit === "scarf"
        ? tone("#2a2420")
        : shoe;
  const upperShoe = look.outfit === "scarf" ? tone("#4a3426") : shoe;
  for (const side of [-1, 1] as const) {
    const L = side < 0;
    const thigh = L ? B.thighL : B.thighR,
      shin = L ? B.shinL : B.shinR,
      foot = L ? B.footL : B.footR,
      toe = L ? B.toeL : B.toeR;
    // One tube from hip to ankle; the knee is the bones' business.
    const knee = (rest(thigh)[1] - rest(shin)[1]) / (rest(thigh)[1] - rest(foot)[1]);
    // Bare legs follow the calf; trousers fall straight from the knee.
    const trousers = leg !== legSkin;
    const legKeys: [number, number, number][] = trousers
      ? [
          [0, 0.086, 0.09],
          [0.1, 0.088, 0.093],
          [0.35, 0.077, 0.08],
          [knee, 0.067, 0.069],
          [0.75, 0.063, 0.065],
          [0.92, 0.06, 0.062],
          [1, 0.058, 0.06],
        ]
      : fem
        ? [
            [0, 0.083, 0.088],
            [0.1, 0.084, 0.09],
            [0.35, 0.07, 0.073],
            [knee, 0.052, 0.055],
            [knee + 0.08, 0.052, 0.058],
            [knee + 0.2, 0.047, 0.052],
            [0.88, 0.037, 0.041],
            [1, 0.034, 0.038],
          ]
        : [
            [0, 0.08, 0.085],
            [0.1, 0.082, 0.088],
            [0.35, 0.07, 0.074],
            [knee, 0.054, 0.057],
            [knee + 0.08, 0.055, 0.062],
            [knee + 0.2, 0.05, 0.055],
            [0.88, 0.04, 0.044],
            [1, 0.036, 0.04],
          ];
    const legG = sweep(rest(thigh), rest(foot), legKeys, { seg: 18, rings: 26 });
    // Under Elena's skirt the thigh is in the skirt's shade, so a stride that
    // pushes it through the hem shows cloth rather than a gap.
    const hidden = leg === legSkin ? accentShade : leg;
    add({
      g: colorize(legG, (_x, y, _z, out) => out.copy(y > 0.6 ? hidden : leg)),
      rough: leg === legSkin ? 0.5 : 0.86,
      sss: leg === legSkin ? legSkin : 0,
      skin: near(seg, [B.pelvis, thigh, shin, foot]),
    });
    if (leg !== legSkin) {
      // Trouser hem, a little wider than the ankle, breaking over the shoe.
      add({
        g: sweep(
          [side * 0.1, 0.2, 0.022],
          [side * 0.1, 0.112, 0.03],
          [
            [0, 0.061, 0.063],
            [1, 0.065, 0.068],
          ],
          { seg: 16, rings: 2, caps: [false, true] },
        ),
        color: look.outfit === "overalls" ? accentLight : leg,
        rough: 0.86,
        skin: near(seg, [shin, foot]),
      });
    }
    // Coloured by height: trainers with a pale sole for Jasmine, brown
    // leather for Luca, Godot's dark shoe for Elena's pumps.
    add({
      g: colorize(shoeGeometry(side, look.outfit === "blazer_skirt"), (_x, y, _z, out) =>
        out.copy(y < 0.022 ? sole : upperShoe),
      ),
      rough: 0.5,
      skin: near(seg, [shin, foot, toe]),
    });
  }

  /* --------------------------------------------------- outfits */
  if (look.outfit === "blazer_skirt") {
    // A-line skirt to the knee, hung from the pelvis and moved by the thighs.
    const skirt = new Profile(
      [
        { y: 0.53, w: 0.218, df: 0.152, db: 0.162, zc: 0.012 },
        { y: 0.66, w: 0.207, df: 0.142, db: 0.152, zc: 0.011 },
        { y: 0.8, w: 0.194, df: 0.127, db: 0.14, zc: 0.01 },
        { y: 0.92, w: 0.178, df: 0.112, db: 0.124, zc: 0.008 },
        { y: 1.005, w: 0.153, df: 0.1, db: 0.108, zc: 0.004 },
      ],
      2.3,
    );
    const pleat = tone(e.accent, 0.4);
    add({
      g: loft(skirt, 40, bandRows(0.53, 1.005, 0.03, [0.55]), (a, _y, band, out) => {
        out.copy(band < 0.55 || fromFront(a) < 0.03 ? pleat : accentShade);
      }),
      rough: 0.84,
      thin: true,
      skin: (x, y, _z, out) => {
        const hip = smooth(0.6, 1.0, y);
        const right = smooth(-0.07, 0.07, x);
        out.i[0] = B.pelvis;
        out.w[0] = hip;
        out.i[1] = B.thighR;
        out.w[1] = (1 - hip) * right;
        out.i[2] = B.thighL;
        out.w[2] = (1 - hip) * (1 - right);
        out.i[3] = B.pelvis;
        out.w[3] = 0;
      },
    });
    // The blazer's one gold button.
    torso.point(Math.PI, 1.168, _v);
    add({
      g: ellipsoid([0.008, 0.008, 0.004], [_v.x, _v.y, _v.z - 0.003]),
      color: gold,
      rough: 0.3,
      metal: 1,
      skin: near(seg, [B.spine1, B.spine2]),
    });
  }
  if (look.outfit === "overalls") {
    // Straps from the bib over each shoulder to the back, gold buttons where they meet.
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [],
        nrm: THREE.Vector3[] = [];
      const path: [number, number][] = [
        [Math.PI - s * 0.5, 1.302],
        [Math.PI - s * 0.46, 1.37],
        [Math.PI - s * 0.48, 1.425],
      ];
      for (const [a, y] of path) {
        torso.point(a, y, _v);
        torso.normal(a, y, _w);
        pts.push(_v.clone().addScaledVector(_w, 0.005));
        nrm.push(_w.clone());
      }
      pts.push(new THREE.Vector3(s * 0.098, 1.462, 0.004));
      nrm.push(new THREE.Vector3(s * 0.2, 1, 0).normalize());
      for (const [a, y] of [
        [s * 0.48, 1.42],
        [s * 0.44, 1.32],
        [s * 0.4, 1.2],
        [s * 0.36, 1.09],
      ] as const) {
        torso.point(a, y, _v);
        torso.normal(a, y, _w);
        pts.push(_v.clone().addScaledVector(_w, 0.005));
        nrm.push(_w.clone());
      }
      add({
        g: ribbon(pts, nrm, 0.03, 0.006),
        color: accent,
        rough: 0.84,
        thin: true,
        skin: near(seg, [B.spine2, B.spine3, B.clavicleL, B.clavicleR]),
      });
      torso.point(Math.PI - s * 0.5, 1.288, _v);
      torso.normal(Math.PI - s * 0.5, 1.288, _w);
      _v.addScaledVector(_w, 0.01);
      add({
        g: ellipsoid([0.0085, 0.0085, 0.0085], [_v.x, _v.y, _v.z], [0, 0, 0], [10, 6]),
        color: gold,
        rough: 0.3,
        metal: 1,
        skin: near(seg, [B.spine2, B.spine3]),
      });
    }
  }
  if (look.outfit === "scarf") {
    const scarf = tone("#b4583a"),
      scarfEnd = tone("#b4583a", 0.25);
    const wrap = (y: number, rx: number, rz: number, zc: number, tilt: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 16; i++) {
        const t = (i / 16) * Math.PI * 2;
        pts.push(
          new THREE.Vector3(
            rx * Math.sin(t),
            y + tilt * Math.cos(t),
            zc + rz * Math.cos(t),
          ),
        );
      }
      return pts;
    };
    const scarfSkin = near(seg, [B.spine3, B.neck, B.clavicleL, B.clavicleR]);
    add({
      g: tubeAlong(wrap(1.49, 0.071, 0.067, 0.008, 0.012), 0.024, true),
      color: scarf,
      rough: 0.92,
      skin: scarfSkin,
    });
    add({
      g: tubeAlong(wrap(1.462, 0.1, 0.082, 0.002, 0.014), 0.022, true),
      color: scarf,
      rough: 0.92,
      skin: scarfSkin,
    });
    add({
      g: ellipsoid([0.03, 0.028, 0.022], [-0.032, 1.458, -0.092]),
      color: scarf,
      rough: 0.92,
      skin: scarfSkin,
    });
    const top = 1.45,
      bottom = 1.17;
    const pts: THREE.Vector3[] = [],
      nrm: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const y = top + (bottom - top) * t;
      pts.push(new THREE.Vector3(-0.036 - 0.018 * t, y, -0.11 - 0.04 * Math.sqrt(t)));
      nrm.push(new THREE.Vector3(0, 0.15, -1).normalize());
    }
    const tg = ribbon(pts, nrm, 0.074, 0.014);
    colorize(tg, (_x, y, _z, out) => out.copy(y < bottom + 0.025 ? scarfEnd : scarf));
    add({
      g: tg,
      rough: 0.92,
      skin: (_x, y, _z, out) =>
        chain(B.spine3, tail, ((top - y) / (top - bottom)) * tail.length, out),
    });
  }

  /* ------------------------------------------------- accessories */
  if (look.accessory === "glasses") {
    const loop = (cx: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 16; i++) {
        const t = (i / 16) * Math.PI * 2;
        const c = Math.cos(t),
          s = Math.sin(t);
        pts.push(
          new THREE.Vector3(
            cx + 0.0185 * Math.sign(c) * Math.pow(Math.abs(c), 0.7),
            EYE_Y + 0.001 + 0.0128 * Math.sign(s) * Math.pow(Math.abs(s), 0.7),
            -0.0965 + 0.004 * Math.abs(c) * Math.sign(cx) * Math.sign(c),
          ),
        );
      }
      return pts;
    };
    const fr = { color: frame, rough: 0.3, metal: 0.85, skin: rigid(B.head) };
    for (const s of [-1, 1]) {
      add({ ...fr, g: tubeAlong(loop(s * 0.033), 0.0017, true, 40, 6) });
      add({
        ...fr,
        g: tubeAlong(
          [
            new THREE.Vector3(s * 0.051, EYE_Y + 0.006, -0.093),
            new THREE.Vector3(s * 0.074, EYE_Y + 0.006, -0.06),
            new THREE.Vector3(s * 0.081, EYE_Y + 0.002, -0.015),
            new THREE.Vector3(s * 0.08, EYE_Y - 0.012, 0.012),
          ],
          0.0016,
          false,
          16,
          6,
        ),
      });
    }
    add({
      ...fr,
      g: tubeAlong(
        [
          new THREE.Vector3(-0.0155, EYE_Y + 0.004, -0.098),
          new THREE.Vector3(0, EYE_Y + 0.008, -0.101),
          new THREE.Vector3(0.0155, EYE_Y + 0.004, -0.098),
        ],
        0.0016,
        false,
        8,
        6,
      ),
    });
  }
  if (look.earrings) {
    for (const s of [-1, 1]) {
      const g = new THREE.TorusGeometry(0.011, 0.0021, 6, 20);
      g.rotateY(Math.PI / 2);
      g.translate(s * 0.08, 1.578, 0.008);
      add({ g, color: gold, rough: 0.28, metal: 1, skin: rigid(B.head) });
    }
  }

  return {
    specs,
    pieces,
    face,
    tail,
    octopus: null,
    scale: who === "Jasmine" ? 0.95 : who === "Elena" ? 0.965 : 1,
    stance: fem ? 0.088 : 0.1,
    footprint: 0.34,
  };
}

/** A shoe from heel to toe, flat on the floor. Coloured afterwards by height. */
function shoeGeometry(side: number, pump: boolean): THREE.BufferGeometry {
  const prof: [number, number, number][] = [
    // t, half width, top height
    [0, 0.03, 0.074],
    [0.07, 0.042, 0.1],
    [0.25, 0.047, 0.108],
    [0.45, 0.05, 0.084],
    [0.65, 0.054, 0.064],
    [0.85, 0.05, 0.054],
    [0.95, 0.042, 0.046],
    [1, 0.03, 0.036],
  ];
  const zHeel = 0.082,
    zToe = pump ? -0.212 : -0.205;
  const seg = 20;
  const pos: number[] = [];
  const rings = 28;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    let k = 0;
    while (k < prof.length - 2 && prof[k + 1]![0] < t) k++;
    const a = prof[k]!,
      b = prof[k + 1]!;
    const s = smooth(0, 1, (t - a[0]) / (b[0] - a[0]));
    const hw = (a[1] + (b[1] - a[1]) * s) * (pump ? 0.9 : 1);
    const top = (a[2] + (b[2] - a[2]) * s) * (pump ? 0.82 : 1);
    const z = zHeel + (zToe - zHeel) * t;
    const x0 = side * (0.1 + 0.012 * t);
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const c = Math.cos(th),
        sn = Math.sin(th);
      const x = x0 + hw * Math.sign(c) * Math.pow(Math.abs(c), 0.75);
      // A flat sole and a rounded upper: the lower half is squarer than the top.
      const e = sn < 0 ? 0.35 : 0.8;
      const y = top / 2 + (top / 2) * Math.sign(sn) * Math.pow(Math.abs(sn), e);
      pos.push(x, y, z);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rings; r++)
    for (let i = 0; i < seg; i++) {
      const i0 = r * seg + i,
        i1 = r * seg + ((i + 1) % seg),
        i2 = (r + 1) * seg + ((i + 1) % seg),
        i3 = (r + 1) * seg + i;
      index.push(i0, i3, i1, i1, i3, i2);
    }
  for (const [row, z] of [
    [0, zHeel + 0.004],
    [rings, zToe - 0.004],
  ] as const) {
    const at = pos.length / 3;
    pos.push(side * (0.1 + 0.012 * (row ? 1 : 0)), row ? 0.016 : 0.035, z);
    for (let i = 0; i < seg; i++) {
      const i0 = row * seg + i,
        i1 = row * seg + ((i + 1) % seg);
      // The band is wound (i0, i3, i1); the caps follow it outward.
      if (row) index.push(i1, i0, at);
      else index.push(i0, i1, at);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  faceOutward(
    g,
    ((rings >> 1) * seg + 4) * 2,
    new THREE.Vector3(side * 0.106, 0.04, (zHeel + zToe) / 2),
  );
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* Hair                                                                */
/* ------------------------------------------------------------------ */

const curl = seededNoise2D(0x7a1f);
const strand = seededNoise2D(0x7a20);

function hairPieces(look: HumanLook, hair: THREE.Color, light: THREE.Color): Piece[] {
  const head = rigid(B.head);
  const top = HEAD.y1 - 0.004;
  switch (look.hair) {
    case "afro": {
      // A full, rounded natural afro framing the face, with curl highlights.
      const pieces: Piece[] = [];
      const edge = (a: number) =>
        knots(
          [
            [0, 1.722],
            [0.55, 1.716],
            [1.0, 1.672],
            [1.3, 1.612],
            [1.6, 1.598],
            [2.3, 1.585],
            [Math.PI, 1.575],
          ],
          fromFront(a),
        );
      const lift = (a: number, v: number) => {
        const f = fromFront(a);
        const bulk =
          0.016 + 0.064 * smooth(0, 0.42, v) * (0.82 + 0.18 * smooth(0.3, 1.4, f));
        const lumps =
          curl(Math.cos(a) * 4 + 9, v * 5 + Math.sin(a) * 4) * 0.008 +
          curl(Math.cos(a) * 11, v * 13 + Math.sin(a) * 11) * 0.004;
        return bulk + lumps * smooth(0, 0.3, v);
      };
      pieces.push({
        g: shell(HEAD, {
          seg: 64,
          rows: 22,
          from: edge,
          top,
          lift,
          pole: true,
          paint: (a, v, out) => {
            const n = curl(Math.cos(a) * 14 + 3, v * 16 + Math.sin(a) * 14);
            out.copy(hair).lerp(light, smooth(0.4, 0.85, n) * 0.28);
          },
        }),
        rough: 0.88,
        thin: true,
        skin: head,
      });
      if (look.accessory === "goggles") {
        // Safety goggles worn as a headband, the lenses over the hairline.
        const band: THREE.Vector3[] = [];
        const v = 0.36;
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2;
          const y = edge(a) + (top - edge(a)) * v;
          HEAD.point(a, y, _v);
          HEAD.normal(a, y, _w);
          band.push(_v.clone().addScaledVector(_w, lift(a, v) + 0.004));
        }
        const strap = tone(EMBODIMENT.Jasmine.accent);
        pieces.push({
          g: tubeAlong(band, 0.0062, true, 64, 6),
          color: strap,
          rough: 0.7,
          skin: head,
        });
        for (const s of [-1, 1]) {
          const a = Math.PI - s * 0.42;
          const y = edge(a) + (top - edge(a)) * v;
          HEAD.point(a, y, _v);
          HEAD.normal(a, y, _w);
          const c = _v.clone().addScaledVector(_w, lift(a, v) + 0.012);
          const housing = new THREE.CylinderGeometry(0.02, 0.022, 0.016, 18);
          housing.applyQuaternion(_q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _w));
          housing.translate(c.x, c.y, c.z);
          pieces.push({
            g: housing,
            color: tone(EMBODIMENT.Jasmine.accent, 0.25),
            rough: 0.5,
            skin: head,
          });
          const glass = new THREE.CylinderGeometry(0.016, 0.016, 0.004, 18);
          glass.applyQuaternion(_q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _w));
          glass.translate(c.x + _w.x * 0.008, c.y + _w.y * 0.008, c.z + _w.z * 0.008);
          pieces.push({
            g: glass,
            color: tone("#d8f1ff", 0.15),
            rough: 0.06,
            metal: 0.2,
            skin: head,
          });
        }
      }
      return pieces;
    }
    case "swept": {
      // Short on the sides, volume on top, the front swept to his left.
      const edge = (a: number) => {
        const f = fromFront(a);
        return knots(
          [
            [0, 1.713],
            [0.65, 1.703],
            [1.0, 1.672],
            [1.32, 1.655],
            [1.55, 1.64],
            [2.0, 1.605],
            [2.6, 1.59],
            [Math.PI, 1.585],
          ],
          f,
        );
      };
      return [
        {
          g: shell(HEAD, {
            seg: 56,
            rows: 18,
            from: edge,
            top,
            lift: (a, v) => {
              const f = fromFront(a);
              const base = 0.003 + 0.011 * smooth(0, 0.35, v) + 0.006 * smooth(0.4, 1, v);
              const quiff =
                0.016 *
                Math.exp(-(((f - 0.25) / 0.5) ** 2)) *
                smooth(0, 0.3, v) *
                (1 - smooth(0.55, 0.95, v));
              return base + quiff;
            },
            nudge: (a, v, out) => {
              const front = 1 - smooth(0.2, 1.2, fromFront(a));
              out.x -= 0.012 * front * smooth(0.05, 0.6, v);
              out.y += 0.004 * front * smooth(0, 0.4, v);
            },
            paint: (a, v, out) => {
              const n = strand(a * 9, v * 2.5);
              out.copy(hair).lerp(light, smooth(0.2, 0.9, n) * 0.45);
            },
            pole: true,
          }),
          rough: 0.6,
          thin: true,
          skin: head,
        },
      ];
    }
    case "long": {
      // A side part, the fringe falling across her left brow, the rest to the shoulders.
      const pieces: Piece[] = [];
      const edge = (a: number) => {
        const f = fromFront(a);
        const left = Math.sin(a) < 0 ? 1 : 0;
        return knots(
          [
            [0, 1.716 - 0.012 * left],
            [0.6, 1.71 - 0.016 * left],
            [1.0, 1.675],
            [1.35, 1.63],
            [1.7, 1.615],
            [Math.PI, 1.6],
          ],
          f,
        );
      };
      pieces.push({
        g: shell(HEAD, {
          seg: 56,
          rows: 18,
          from: edge,
          top,
          lift: (a, v) => {
            const part =
              Math.exp(-(((a - (Math.PI - 0.32)) / 0.12) ** 2)) *
              (1 - smooth(0.3, 0.9, v));
            return 0.004 + 0.012 * smooth(0, 0.35, v) - 0.004 * part;
          },
          paint: (a, v, out) => {
            const part =
              Math.exp(-(((a - (Math.PI - 0.32)) / 0.06) ** 2)) * smooth(0.2, 0.5, v);
            const n = strand(a * 12, v * 2);
            out
              .copy(hair)
              .lerp(light, smooth(0.25, 0.9, n) * 0.4)
              .multiplyScalar(1 - part * 0.35);
          },
          pole: true,
        }),
        rough: 0.55,
        thin: true,
        skin: head,
      });
      // The fall: an open curtain from the back of the head to below the shoulders.
      const fall = new Profile(
        [
          { y: 1.33, w: 0.172, df: 0.06, db: 0.11, zc: 0.045 },
          { y: 1.4, w: 0.158, df: 0.065, db: 0.112, zc: 0.04 },
          { y: 1.46, w: 0.13, df: 0.07, db: 0.115, zc: 0.035 },
          { y: 1.52, w: 0.1, df: 0.08, db: 0.12, zc: 0.03 },
          { y: 1.58, w: 0.088, df: 0.085, db: 0.116, zc: 0.022 },
          { y: 1.64, w: 0.09, df: 0.092, db: 0.114, zc: 0.016 },
          { y: 1.69, w: 0.088, df: 0.088, db: 0.11, zc: 0.012 },
        ],
        2.1,
      );
      const opening = (y: number) =>
        knots(
          [
            [1.33, 1.6],
            [1.4, 1.5],
            [1.46, 1.35],
            [1.52, 1.15],
            [1.6, 1.0],
            [1.69, 1.05],
          ],
          y,
        );
      const seg = 40,
        rows = 20;
      const pos: number[] = [],
        col: number[] = [];
      const c = new THREE.Color();
      for (let r = 0; r <= rows; r++) {
        const v = r / rows;
        for (let k = 0; k <= seg; k++) {
          const u = k / seg;
          const yBase = 1.33 + 0.36 * v;
          const y = yBase - (r === 0 ? 0.018 * (0.5 + 0.5 * strand(u * 9, 3)) : 0);
          const span = Math.PI - opening(yBase);
          const a = (u - 0.5) * 2 * span;
          fall.point(a, y, _v);
          pos.push(_v.x, _v.y, _v.z);
          const n = strand(u * 14, v * 1.5);
          c.copy(hair).lerp(light, smooth(0.3, 0.9, n) * 0.4);
          col.push(c.r, c.g, c.b);
        }
      }
      const index: number[] = [];
      for (let r = 0; r < rows; r++)
        for (let k = 0; k < seg; k++) {
          const i0 = r * (seg + 1) + k,
            i1 = i0 + 1,
            i3 = i0 + seg + 1,
            i2 = i3 + 1;
          index.push(i0, i1, i3, i1, i2, i3);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(index);
      g.computeVertexNormals();
      pieces.push({
        g,
        rough: 0.55,
        thin: true,
        skin: (_x, y, _z, out) => {
          const h = smooth(1.5, 1.64, y);
          out.i[0] = B.head;
          out.w[0] = h;
          out.i[1] = B.spine3;
          out.w[1] = 1 - h;
          out.i[2] = out.i[3] = B.head;
          out.w[2] = out.w[3] = 0;
        },
      });
      return pieces;
    }
  }
}

/* ------------------------------------------------------------------ */
/* James                                                               */
/* ------------------------------------------------------------------ */

const MANTLE = new Profile(
  [
    { y: 0.69, w: 0.06, df: 0.06, db: 0.06, zc: 0 },
    { y: 0.71, w: 0.13, df: 0.13, db: 0.13, zc: 0 },
    { y: 0.75, w: 0.19, df: 0.185, db: 0.19, zc: 0 },
    { y: 0.81, w: 0.232, df: 0.228, db: 0.232, zc: 0 },
    { y: 0.9, w: 0.255, df: 0.25, db: 0.256, zc: 0.004 },
    { y: 1.0, w: 0.262, df: 0.256, db: 0.266, zc: 0.012 },
    // The mantle swells above the eyes and leans back: a head, not an egg.
    { y: 1.1, w: 0.272, df: 0.255, db: 0.28, zc: 0.03 },
    { y: 1.22, w: 0.282, df: 0.25, db: 0.3, zc: 0.055 },
    { y: 1.33, w: 0.272, df: 0.228, db: 0.292, zc: 0.075 },
    { y: 1.42, w: 0.24, df: 0.19, db: 0.262, zc: 0.09 },
    { y: 1.49, w: 0.185, df: 0.14, db: 0.21, zc: 0.1 },
    { y: 1.535, w: 0.11, df: 0.08, db: 0.13, zc: 0.105 },
    { y: 1.555, w: 0.03, df: 0.025, db: 0.04, zc: 0.105 },
    { y: 1.56, w: 0.01, df: 0.01, db: 0.012, zc: 0.105 },
  ],
  2.1,
);

const ARMS = 8,
  ARM_BONES = 6;

function buildOctopus(who: Perspective): Built {
  const e = EMBODIMENT[who];
  const body = tone(e.body),
    bodyShade = tone(e.body, 0.22),
    bodyLight = tone(e.body, 0, 0.25),
    accent = tone(e.accent),
    accentLight = tone(e.accent, 0, 0.3),
    outline = "#1b2230";
  const specs: BoneSpec[] = [];
  const root = addBone(specs, "root", -1, [0, 0, 0], [0, 0.1, 0]);
  const hub = addBone(specs, "hub", root, [0, 0.74, 0], [0, 0.9, 0]);
  const head = addBone(specs, "head", hub, [0, 0.76, 0], [0, 1.6, 0.06]);
  const mantle = addBone(specs, "mantle", head, [0, 0.76, 0], [0, 1.6, 0.06]);

  // Eyes on the front of the mantle, looking forward rather than out.
  const eyeY = 1.0,
    eyeA = 0.38,
    radius = 0.039;
  const eyeAt = (s: number): { c: V3; yaw: number } => {
    const a = Math.PI - s * eyeA;
    MANTLE.point(a, eyeY, _v);
    MANTLE.normal(a, eyeY, _w);
    _v.addScaledVector(_w, -0.012);
    // The irises look straight ahead at rest, so a gaze lands where it is aimed.
    return { c: [_v.x, _v.y, _v.z], yaw: 0 };
  };
  const L = eyeAt(-1),
    R = eyeAt(1);
  MANTLE.point(Math.PI, 0.922, _v);
  const mouthAt: V3 = [0, 0.922, _v.z - 0.002];
  const face: FaceBones = {
    eyeL: addBone(specs, "eyeL", head, L.c),
    eyeR: addBone(specs, "eyeR", head, R.c),
    lidL: addBone(specs, "lidL", head, L.c),
    lidR: addBone(specs, "lidR", head, R.c),
    mouth: addBone(specs, "mouth", head, mouthAt),
  };

  // Arms: eight curves, out and down to the floor, the tips curling up and round.
  const arms: number[][] = [],
    angles: number[] = [],
    curves: THREE.CatmullRomCurve3[] = [];
  const jitter = seededNoise2D(0x0c70);
  for (let i = 0; i < ARMS; i++) {
    const a = ((i + 0.5) / ARMS) * Math.PI * 2;
    angles.push(a);
    const d = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(
      i % 2 ? 1 : -1,
    );
    const reach = 0.94 + 0.12 * (0.5 + 0.5 * jitter(i * 3.1, 0.7));
    const pts = (
      [
        [0.14, 0.72, 0],
        [0.26, 0.5, 0],
        [0.37, 0.23, 0],
        [0.5, 0.05, 0.01],
        [0.64, 0.032, 0.03],
        [0.75, 0.07, 0.07],
        [0.77, 0.14, 0.12],
      ] as const
    ).map(([r, y, curlSide], k) =>
      d
        .clone()
        .multiplyScalar(k ? 0.14 + (r - 0.14) * reach : r)
        .addScaledVector(side, curlSide)
        .setY(y),
    );
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    curves.push(curve);
    const chainBones: number[] = [];
    for (let k = 0; k < ARM_BONES; k++) {
      const p = curve.getPointAt(k / ARM_BONES),
        t = curve.getPointAt((k + 1) / ARM_BONES);
      chainBones.push(
        addBone(
          specs,
          `arm${i}_${k}`,
          k ? chainBones[k - 1]! : hub,
          [p.x, p.y, p.z],
          [t.x, t.y, t.z],
        ),
      );
    }
    arms.push(chainBones);
  }

  const pieces: Piece[] = [];
  const spots = seededNoise2D(0x5b07);
  pieces.push({
    g: loft(
      MANTLE,
      48,
      bandRows(MANTLE.y0, MANTLE.y1, 0.016),
      (a, y, _band, out) => {
        // Godot's mantle: body colour, a few darker freckles on the crown, lighter beneath.
        const n = spots(Math.cos(a) * 9 + 2, y * 16 + Math.sin(a) * 9);
        out.copy(body).lerp(bodyLight, 0.35 * (1 - smooth(0.72, 0.86, y)));
        out.lerp(bodyShade, smooth(0.62, 0.74, n) * smooth(1.12, 1.3, y) * 0.5);
      },
      { top: true, bottom: true },
    ),
    rough: 0.42,
    skin: (_x, y, _z, out) => {
      const m = smooth(0.7, 0.8, y);
      out.i[0] = mantle;
      out.w[0] = m;
      out.i[1] = hub;
      out.w[1] = 1 - m;
      out.i[2] = out.i[3] = mantle;
      out.w[2] = out.w[3] = 0;
    },
  });

  // Each arm, swept along its curve: flattened a little, tapering, suckers beneath.
  for (let i = 0; i < ARMS; i++) {
    const curve = curves[i]!;
    const seg = 12,
      rings = 44;
    const pos: number[] = [],
      col: number[] = [],
      sAt: number[] = [];
    const T = new THREE.Vector3(),
      N = new THREE.Vector3(),
      Bn = new THREE.Vector3(),
      up = new THREE.Vector3(0, 1, 0),
      c = new THREE.Color(),
      pale = mix(accentLight, tone("#dfe8f2"), 0.4);
    for (let r = 0; r <= rings; r++) {
      const s = r / rings;
      const p = curve.getPointAt(s);
      curve.getTangentAt(s, T);
      N.copy(up).addScaledVector(T, -up.dot(T));
      if (N.lengthSq() < 1e-6) N.set(Math.sin(angles[i]!), 0, Math.cos(angles[i]!));
      N.normalize();
      Bn.crossVectors(T, N).normalize();
      const rad = 0.056 * Math.pow(1 - s, 0.85) + 0.0065;
      for (let k = 0; k < seg; k++) {
        const th = (k / seg) * Math.PI * 2;
        const ct = Math.cos(th),
          st = Math.sin(th);
        _v.copy(p)
          .addScaledVector(Bn, ct * rad)
          .addScaledVector(N, st * rad * 0.84);
        pos.push(_v.x, _v.y, _v.z);
        sAt.push(s);
        const sucker = st < -0.55 && s > 0.1 && r % 2 === 0;
        c.copy(accent).lerp(accentLight, 0.25 * s);
        if (sucker) c.copy(pale);
        col.push(c.r, c.g, c.b);
      }
    }
    const tip = curve.getPointAt(1).addScaledVector(T, 0.008);
    const at = pos.length / 3;
    pos.push(tip.x, tip.y, tip.z);
    sAt.push(1);
    col.push(accentLight.r, accentLight.g, accentLight.b);
    const index: number[] = [];
    for (let r = 0; r < rings; r++)
      for (let k = 0; k < seg; k++) {
        const i0 = r * seg + k,
          i1 = r * seg + ((k + 1) % seg),
          i2 = (r + 1) * seg + ((k + 1) % seg),
          i3 = (r + 1) * seg + k;
        index.push(i0, i1, i3, i1, i2, i3);
      }
    for (let k = 0; k < seg; k++)
      index.push(rings * seg + k, rings * seg + ((k + 1) % seg), at);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(index);
    const mid = curve.getPointAt(0.5);
    faceOutward(g, ((rings >> 1) * seg + 2) * 2, mid);
    g.computeVertexNormals();
    const bones = arms[i]!;
    pieces.push({
      g,
      rough: 0.4,
      // Weighted by position along the arm, which the geometry remembers.
      skin: (_x, _y, _z, out, v) => chain(hub, bones, sAt[v]! * ARM_BONES, out),
    });
  }

  // Face: eyes, lids in the mantle's colour, brows, a mouth below.
  const lid = tone(e.body, 0.08);
  const eyeSpec = (c: V3, yaw: number): EyeSpec => ({
    centre: c,
    radius,
    yaw,
    sclera: tone("#f5f3ea"),
    iris: tone("#2c2a33"),
    lid,
    lash: tone(e.body, 0.5),
  });
  const eL = eyeSpec(L.c, L.yaw),
    eR = eyeSpec(R.c, R.yaw);
  for (const p of eyePieces(eL, face.eyeL)) pieces.push(p);
  for (const p of eyePieces(eR, face.eyeR)) pieces.push(p);
  pieces.push(lidPiece(eL, face.lidL, false), lidPiece(eR, face.lidR, false));
  for (const [s, at] of [
    [-1, L.c],
    [1, R.c],
  ] as const)
    pieces.push({
      g: ellipsoid(
        [0.032, 0.0075, 0.011],
        [at[0], at[1] + 0.057, at[2] - 0.006],
        [0.15, 0, s * -0.14],
      ),
      color: tone(e.body, 0.5),
      rough: 0.6,
      skin: rigid(head),
    });
  pieces.push({
    g: ellipsoid([0.026, 0.0055, 0.009], [0, mouthAt[1] + 0.004, mouthAt[2] - 0.002]),
    color: tone(e.body, 0.3),
    rough: 0.45,
    skin: rigid(head),
  });
  pieces.push({
    g: ellipsoid([0.023, 0.0058, 0.0085], [0, mouthAt[1] - 0.0065, mouthAt[2] - 0.001]),
    color: tone(e.body, 0.3),
    rough: 0.45,
    skin: rigid(face.mouth),
  });
  pieces.push({
    g: ellipsoid([0.02, 0.0028, 0.0024], [0, mouthAt[1], mouthAt[2] - 0.003]),
    color: tone("#5d2d2d", 0.45),
    rough: 0.6,
    skin: rigid(face.mouth),
  });

  // Spectacles: round rims with a browline, a bridge, and arms back along the mantle.
  const rim = tone("#c9ced2"),
    brow = tone(outline, 0, 0.1);
  for (const [s, at] of [
    [-1, L.c],
    [1, R.c],
  ] as const) {
    const cx = at[0],
      cy = at[1],
      cz = at[2] - radius - 0.012;
    const loop: THREE.Vector3[] = [],
      browline: THREE.Vector3[] = [];
    for (let i = 0; i < 20; i++) {
      const t = (i / 20) * Math.PI * 2;
      loop.push(
        new THREE.Vector3(
          cx + 0.047 * Math.cos(t),
          cy + 0.043 * Math.sin(t),
          cz - 0.004 * Math.sin(t) * 0,
        ),
      );
    }
    for (let i = 0; i <= 8; i++) {
      const t = 0.15 * Math.PI + (i / 8) * 0.7 * Math.PI;
      browline.push(
        new THREE.Vector3(cx + 0.048 * Math.cos(t), cy + 0.045 * Math.sin(t), cz),
      );
    }
    pieces.push({
      g: tubeAlong(loop, 0.0028, true, 48, 6),
      color: rim,
      rough: 0.25,
      metal: 0.9,
      skin: rigid(head),
    });
    pieces.push({
      g: tubeAlong(browline, 0.0058, false, 20, 8),
      color: brow,
      rough: 0.35,
      metal: 0.2,
      skin: rigid(head),
    });
    const hinge = new THREE.Vector3(cx + s * 0.047, cy + 0.01, cz);
    const back: THREE.Vector3[] = [hinge];
    for (const [yy, zz] of [
      [1.02, -0.17],
      [1.03, -0.06],
    ] as const) {
      const a = Math.PI - s * (zz < -0.1 ? 0.95 : 1.35);
      MANTLE.point(a, yy, _v);
      MANTLE.normal(a, yy, _w);
      back.push(_v.clone().addScaledVector(_w, 0.006));
    }
    pieces.push({
      g: tubeAlong(back, 0.0024, false, 16, 6),
      color: rim,
      rough: 0.25,
      metal: 0.9,
      skin: rigid(head),
    });
  }
  const bridgeY = L.c[1] + 0.008,
    bridgeZ = L.c[2] - radius - 0.016;
  pieces.push({
    g: tubeAlong(
      [
        new THREE.Vector3(L.c[0] + 0.046, bridgeY, bridgeZ),
        new THREE.Vector3(0, bridgeY + 0.012, bridgeZ - 0.006),
        new THREE.Vector3(R.c[0] - 0.046, bridgeY, bridgeZ),
      ],
      0.003,
      false,
      12,
      6,
    ),
    color: rim,
    rough: 0.25,
    metal: 0.9,
    skin: rigid(head),
  });

  return {
    specs,
    pieces,
    face,
    tail: [],
    octopus: { hub, head, mantle, arms, angles },
    scale: 1,
    stance: 0,
    footprint: 0.62,
  };
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

function prepare(p: Piece): THREE.BufferGeometry {
  const g = p.g;
  if (!g.getIndex()) {
    const n = g.getAttribute("position").count;
    g.setIndex(Array.from({ length: n }, (_, i) => i));
  }
  for (const name of Object.keys(g.attributes))
    if (name !== "position" && name !== "normal" && name !== "color")
      g.deleteAttribute(name);
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  const pos = g.getAttribute("position");
  const n = pos.count;
  if (!g.getAttribute("color")) {
    const c = p.color ?? new THREE.Color(1, 0, 1);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.Float32BufferAttribute(arr, 3));
  }
  const pbr = new Float32Array(n * 3);
  const col = g.getAttribute("color");
  for (let i = 0; i < n; i++) {
    pbr[i * 3] = p.rough;
    pbr[i * 3 + 1] = p.metal ?? 0;
    const sss = p.sss;
    pbr[i * 3 + 2] =
      typeof sss === "number"
        ? sss
        : sss &&
            Math.abs(col.getX(i) - sss.r) +
              Math.abs(col.getY(i) - sss.g) +
              Math.abs(col.getZ(i) - sss.b) <
              1e-3
          ? 1
          : 0;
  }
  g.setAttribute("pbr", new THREE.Float32BufferAttribute(pbr, 3));
  const si = new Uint16Array(n * 4),
    sw = new Float32Array(n * 4);
  const inf: Influence = { i: [0, 0, 0, 0], w: [0, 0, 0, 0] };
  for (let v = 0; v < n; v++) {
    p.skin(pos.getX(v), pos.getY(v), pos.getZ(v), inf, v);
    for (let k = 0; k < 4; k++) {
      si[v * 4 + k] = inf.i[k]!;
      sw[v * 4 + k] = inf.w[k]!;
    }
  }
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
  return g;
}

function assemble(pieces: readonly Piece[]): THREE.BufferGeometry {
  const solid: THREE.BufferGeometry[] = [],
    thin: THREE.BufferGeometry[] = [];
  for (const p of pieces) (p.thin ? thin : solid).push(prepare(p));
  const a = mergeGeometries(solid, false),
    b = mergeGeometries(thin, false);
  for (const g of [...solid, ...thin]) g.dispose();
  const merged = mergeGeometries([a, b], true);
  a.dispose();
  b.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/* ------------------------------------------------------------------ */
/* Material                                                            */
/* ------------------------------------------------------------------ */

const RIM: Record<FigureSetting, { color: THREE.Color; power: number }> = {
  // The lab is dark teal glass and steel: a cool rim keeps a figure off the walls.
  lab: { color: new THREE.Color(0.12, 0.19, 0.2), power: 3.2 },
  // In daylight the sun already separates them; a trace, no more.
  city: { color: new THREE.Color(0.09, 0.1, 0.11), power: 3.5 },
};

const FIGURE_VERTEX_COMMON = /* glsl */ `
attribute vec3 pbr;
varying vec3 vFigPbr;
varying vec3 vFigRest;
varying vec3 vFigWorldN;
`;
const FIGURE_VERTEX_PROJECT = /* glsl */ `
vFigPbr = pbr;
// Rest position: the weave is printed on the cloth and must not swim when a joint bends.
vFigRest = position;
vFigWorldN = normalize(mat3(modelMatrix) * objectNormal);
#include <project_vertex>
`;
const FIGURE_FRAGMENT_COMMON = /* glsl */ `
varying vec3 vFigPbr;
varying vec3 vFigRest;
varying vec3 vFigWorldN;
uniform vec3 uFigRim;
uniform float uFigRimPower;
float figWeave(vec3 p, float freq) {
  vec3 q = p * freq;
  vec3 fw = max(fwidth(q), vec3(1e-4));
  float fade = 1.0 - smoothstep(0.45, 1.2, max(fw.x, max(fw.y, fw.z)));
  return (sin(q.x + q.z * 0.7) * sin(q.y)) * fade;
}
`;
const FIGURE_ROUGHNESS = /* glsl */ `
float roughnessFactor = clamp(vFigPbr.x, 0.04, 1.0);
`;
const FIGURE_METALNESS = /* glsl */ `
float metalnessFactor = clamp(vFigPbr.y, 0.0, 1.0);
{
  // Cloth is the 0.8-0.93 roughness band: a fine weave in albedo and roughness.
  float cloth = smoothstep(0.76, 0.82, roughnessFactor)
    * (1.0 - smoothstep(0.93, 0.97, roughnessFactor))
    * (1.0 - metalnessFactor);
  float weave = figWeave(vFigRest, 420.0) * 0.6 + figWeave(vFigRest, 840.0) * 0.4;
  diffuseColor.rgb *= 1.0 - (weave * 0.5 + 0.5) * 0.12 * cloth;
  roughnessFactor = clamp(roughnessFactor + weave * 0.06 * cloth, 0.04, 1.0);
  // Faces turned to the floor see less of the room.
  // A sheet seen from behind (hair, a lid, a strap) faces the other way.
  float under = max(-normalize(vFigWorldN).y * (gl_FrontFacing ? 1.0 : -1.0), 0.0);
  diffuseColor.rgb *= 1.0 - under * under * 0.22;
}
`;
const FIGURE_RIM = /* glsl */ `
#include <emissivemap_fragment>
{
  // A grazing rim for the dark side of a silhouette; tinted a little by the surface.
  float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  float rim = pow(1.0 - ndv, uFigRimPower);
  totalEmissiveRadiance += uFigRim * rim * mix(vec3(1.0), diffuseColor.rgb * 2.0, 0.4);
  // Skin is not a painted surface: light scattered under it warms the whole
  // face a little, and the edges, where it is thinnest, more.
  totalEmissiveRadiance += diffuseColor.rgb * vFigPbr.z
    * (0.1 + 0.18 * pow(1.0 - ndv, 2.0)) * vec3(1.0, 0.68, 0.55);
}
`;

function patch(source: string, needle: string, insert: string): string {
  if (!source.includes(needle))
    throw new Error(`figures: missing shader chunk ${needle}`);
  return source.replace(needle, insert);
}

/** The figures' material: per-vertex colour and PBR, a cloth weave, a rim. */
export function figureMaterial(
  setting: FigureSetting,
  thin: boolean,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    name: `rain-figure-${setting}${thin ? "-thin" : ""}`,
    vertexColors: true,
    roughness: 0.8,
    metalness: 0,
    side: thin ? THREE.DoubleSide : THREE.FrontSide,
  });
  const rim = RIM[setting];
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFigRim = { value: rim.color };
    shader.uniforms.uFigRimPower = { value: rim.power };
    shader.vertexShader = patch(
      shader.vertexShader,
      "#include <common>",
      `#include <common>\n${FIGURE_VERTEX_COMMON}`,
    );
    shader.vertexShader = patch(
      shader.vertexShader,
      "#include <project_vertex>",
      FIGURE_VERTEX_PROJECT,
    );
    shader.fragmentShader = patch(
      shader.fragmentShader,
      "#include <common>",
      `#include <common>\n${FIGURE_FRAGMENT_COMMON}`,
    );
    shader.fragmentShader = patch(
      shader.fragmentShader,
      "#include <roughnessmap_fragment>",
      FIGURE_ROUGHNESS,
    );
    shader.fragmentShader = patch(
      shader.fragmentShader,
      "#include <metalnessmap_fragment>",
      FIGURE_METALNESS,
    );
    shader.fragmentShader = patch(
      shader.fragmentShader,
      "#include <emissivemap_fragment>",
      FIGURE_RIM,
    );
  };
  material.customProgramCacheKey = () => `rain-figure-v2-${setting}`;
  return material;
}

/* ------------------------------------------------------------------ */
/* Public                                                              */
/* ------------------------------------------------------------------ */

interface Cached {
  built: Built;
  geometry: THREE.BufferGeometry;
}
/**
 * Built geometry is kept for the life of the page, about 1 MB a figure: the
 * lab and the city are never mounted together, and a cache that let go when
 * the last figure was disposed would rebuild all four on every visit.
 */
const cache = new Map<Perspective, Cached>();

function build(who: Perspective): Built {
  const look = LOOKS[who];
  return look.archetype === "octopus" ? buildOctopus(who) : buildHuman(who, look);
}

function cached(who: Perspective): Cached {
  let c = cache.get(who);
  if (!c) {
    const built = build(who);
    c = { built, geometry: assemble(built.pieces) };
    built.pieces.length = 0;
    cache.set(who, c);
  }
  return c;
}

/** The geometry and skeleton a perspective is drawn with, without a renderer. */
export function figureGeometry(who: Perspective) {
  const c = cached(who);
  return { geometry: c.geometry, bones: c.built.specs.length, face: c.built.face };
}

/** A fresh, uncached build of a perspective's geometry: for checking it is deterministic. */
export function assembleFigure(who: Perspective): THREE.BufferGeometry {
  return assemble(build(who).pieces);
}

/** Each piece before assembly, for checking every closed one faces outward. */
export function figurePieces(who: Perspective): {
  geometry: THREE.BufferGeometry;
  thin: boolean;
}[] {
  return build(who).pieces.map((p) => ({ geometry: p.g, thin: !!p.thin }));
}

export function buildFigure(who: Perspective, setting: FigureSetting): FigureRig {
  const c = cached(who);
  const { specs } = c.built;
  const bones = specs.map((s) => {
    const b = new THREE.Bone();
    b.name = s.name;
    return b;
  });
  const rest = new Float32Array(specs.length * 3);
  specs.forEach((s, i) => {
    const pp: V3 = s.parent >= 0 ? specs[s.parent]!.p : [0, 0, 0];
    rest.set([s.p[0] - pp[0], s.p[1] - pp[1], s.p[2] - pp[2]], i * 3);
    bones[i]!.position.set(rest[i * 3]!, rest[i * 3 + 1]!, rest[i * 3 + 2]);
    if (s.parent >= 0) bones[s.parent]!.add(bones[i]!);
  });
  const inverses = specs.map((s) =>
    new THREE.Matrix4().makeTranslation(-s.p[0], -s.p[1], -s.p[2]),
  );
  const skeleton = new THREE.Skeleton(bones, inverses);
  const solid = figureMaterial(setting, false),
    thin = figureMaterial(setting, true);
  const mesh = new THREE.SkinnedMesh(c.geometry, [solid, thin]);
  mesh.name = `rain-figure-${who}`;
  mesh.frustumCulled = false;
  // Presentation only: a figure is never what a tap selects, in the lab or the
  // city, visible or hidden.
  mesh.raycast = () => {};
  mesh.castShadow = setting === "city";
  const root = new THREE.Group();
  root.name = `rain-perspective-${who}`;
  root.add(bones[0]!);
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(skeleton);
  root.scale.setScalar(c.built.scale);
  const index = c.geometry.getIndex();
  let released = false;
  return {
    who,
    kind: c.built.octopus ? "octopus" : "humanoid",
    root,
    mesh,
    bones,
    face: c.built.face,
    tail: c.built.tail,
    octopus: c.built.octopus,
    scale: c.built.scale,
    stance: c.built.stance,
    footprint: c.built.footprint,
    rest,
    triangles: index ? index.count / 3 : 0,
    material: solid,
    dispose() {
      if (released) return;
      released = true;
      skeleton.dispose();
      solid.dispose();
      thin.dispose();
    },
  };
}
