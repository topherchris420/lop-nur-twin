/**
 * Signed distance fields and a surface-nets polygoniser.
 *
 * Organic shapes do not survive being assembled from primitives: a finger
 * built from a cylinder and two spheres is a string of beads, and a palm made
 * of an ellipsoid with tubes glued on reads as a mannequin at 40 cm. A signed
 * distance field lets the palm, the knuckles, the webbing between fingers and
 * the glove cuff blend into one surface with a smooth minimum, and it gives
 * three things for free that a mesh does not: an exact normal (the gradient),
 * ambient occlusion from a handful of samples along that normal, and contact
 * with the weapon expressed as the same kind of function the hand is.
 *
 * Everything here is pure arithmetic — no DOM, no randomness — so a field
 * always meshes to the same triangles.
 */

export type Field = ((x: number, y: number, z: number) => number) & {
  /**
   * A sphere the surface lies inside. Unions use it to skip a primitive whose
   * nearest possible distance cannot change the result — exact for `min`, and
   * exact for `smin` once the gap exceeds the blend width.
   */
  bound?: { c: V3; r: number };
};

/** `Math.hypot` is several times slower than this in V8, and it is the hot path. */
function len3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

function len2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

function bounded(f: Field, c: V3, r: number): Field {
  f.bound = { c, r };
  return f;
}

/* ------------------------------------------------------------------ */
/* Combinators                                                         */
/* ------------------------------------------------------------------ */

/** Polynomial smooth minimum. `k` is the blend width in metres. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Smooth maximum, for carving one field out of another with a fillet. */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/* ------------------------------------------------------------------ */
/* Frames                                                              */
/* ------------------------------------------------------------------ */

/**
 * An orthonormal frame: `x`, `y`, `z` are unit axes in the parent space and
 * `o` is the origin. Stored flat so the hot path does not allocate.
 */
export interface Frame {
  o: [number, number, number];
  x: [number, number, number];
  y: [number, number, number];
  z: [number, number, number];
}

export type V3 = [number, number, number];

export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  length: (a: V3): number => Math.hypot(a[0], a[1], a[2]),
  normalize: (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a: V3, b: V3, t: number): V3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
  /** Rotate `v` about unit axis `k` by `angle` (Rodrigues). */
  rotate: (v: V3, k: V3, angle: number): V3 => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const d = (k[0] * v[0] + k[1] * v[1] + k[2] * v[2]) * (1 - c);
    return [
      v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d,
      v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d,
      v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d,
    ];
  },
};

/** Build a right-handed frame from a primary axis and a hint for the second. */
export function frameFrom(origin: V3, yAxis: V3, zHint: V3): Frame {
  const y = v3.normalize(yAxis);
  const x = v3.normalize(v3.cross(y, zHint));
  const z = v3.cross(x, y);
  return { o: origin, x, y, z };
}

/** A point given in frame-local coordinates, returned in the parent space. */
export function toParent(f: Frame, lx: number, ly: number, lz: number): V3 {
  return [
    f.o[0] + f.x[0] * lx + f.y[0] * ly + f.z[0] * lz,
    f.o[1] + f.x[1] * lx + f.y[1] * ly + f.z[1] * lz,
    f.o[2] + f.x[2] * lx + f.y[2] * ly + f.z[2] * lz,
  ];
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/**
 * A capsule whose radius changes linearly from `ra` at `a` to `rb` at `b`
 * (Quílez's round cone). Fingers, forearms and the thumb are all this shape.
 */
export function roundCone(a: V3, b: V3, ra: number, rb: number): Field {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return bounded(
    (x, y, z) => {
      const pax = x - ax;
      const pay = y - ay;
      const paz = z - az;
      const yy = pax * bax + pay * bay + paz * baz;
      const zz = yy - l2;
      const qx = pax * l2 - bax * yy;
      const qy = pay * l2 - bay * yy;
      const qz = paz * l2 - baz * yy;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yy * yy * l2;
      const z2 = zz * zz * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
    },
    mid,
    Math.sqrt(l2) / 2 + Math.max(ra, rb),
  );
}

/** Rounded box in a local frame. `h` are half extents, `r` the edge radius. */
export function roundBox(f: Frame, hx: number, hy: number, hz: number, r: number): Field {
  const [ox, oy, oz] = f.o;
  const [xx, xy, xz] = f.x;
  const [yx, yy, yz] = f.y;
  const [zx, zy, zz] = f.z;
  const bx = hx - r;
  const by = hy - r;
  const bz = hz - r;
  return bounded(
    (x, y, z) => {
      const px = x - ox;
      const py = y - oy;
      const pz = z - oz;
      const qx = Math.abs(px * xx + py * xy + pz * xz) - bx;
      const qy = Math.abs(px * yx + py * yy + pz * yz) - by;
      const qz = Math.abs(px * zx + py * zy + pz * zz) - bz;
      const outside = len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      return outside + Math.min(Math.max(qx, qy, qz), 0) - r;
    },
    f.o,
    Math.hypot(hx, hy, hz),
  );
}

/** Ellipsoid in a local frame (Quílez's bound; exact enough near the surface). */
export function ellipsoid(f: Frame, rx: number, ry: number, rz: number): Field {
  const [ox, oy, oz] = f.o;
  const [xx, xy, xz] = f.x;
  const [yx, yy, yz] = f.y;
  const [zx, zy, zz] = f.z;
  return bounded(
    (x, y, z) => {
      const px = x - ox;
      const py = y - oy;
      const pz = z - oz;
      const lx = px * xx + py * xy + pz * xz;
      const ly = px * yx + py * yy + pz * yz;
      const lz = px * zx + py * zy + pz * zz;
      const k0 = len3(lx / rx, ly / ry, lz / rz);
      const k1 = len3(lx / (rx * rx), ly / (ry * ry), lz / (rz * rz));
      return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
    },
    f.o,
    Math.max(rx, ry, rz),
  );
}

/** Infinite-free cylinder along the local Y axis, capped at ±`h`. */
export function cylinder(f: Frame, radius: number, h: number): Field {
  const [ox, oy, oz] = f.o;
  const [xx, xy, xz] = f.x;
  const [yx, yy, yz] = f.y;
  const [zx, zy, zz] = f.z;
  return (x, y, z) => {
    const px = x - ox;
    const py = y - oy;
    const pz = z - oz;
    const lx = px * xx + py * xy + pz * xz;
    const ly = px * yx + py * yy + pz * yz;
    const lz = px * zx + py * zy + pz * zz;
    const dr = len2(lx, lz) - radius;
    const dy = Math.abs(ly) - h;
    return Math.min(Math.max(dr, dy), 0) + len2(Math.max(dr, 0), Math.max(dy, 0));
  };
}

/** Union of a list of fields with one blend width. */
export function blend(fields: readonly Field[], k: number): Field {
  if (fields.length === 1) return fields[0]!;
  const list = fields.slice();
  return withBound((x, y, z) => {
    let d = Infinity;
    for (const f of list) {
      const b = f.bound;
      if (b) {
        const lower = len3(x - b.c[0], y - b.c[1], z - b.c[2]) - b.r;
        if (lower >= d + k) continue;
      }
      d = smin(d, f(x, y, z), k);
    }
    return d;
  }, list);
}

export function union(fields: readonly Field[]): Field {
  return blend(fields, 0);
}

/** Give a composite the sphere that contains all of its parts. */
function withBound(f: Field, parts: readonly Field[]): Field {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    if (!p.bound) return f;
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i]!, p.bound.c[i]! - p.bound.r);
      max[i] = Math.max(max[i]!, p.bound.c[i]! + p.bound.r);
    }
  }
  const c: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  return bounded(f, c, v3.length(v3.sub(max, c)));
}

/* ------------------------------------------------------------------ */
/* Polygoniser                                                         */
/* ------------------------------------------------------------------ */

export interface SdfMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface Bounds {
  min: V3;
  max: V3;
}

/** Central-difference gradient, normalised. Writes into `out`. */
export function gradient(
  f: Field,
  x: number,
  y: number,
  z: number,
  h: number,
  out: V3,
): V3 {
  const gx = f(x + h, y, z) - f(x - h, y, z);
  const gy = f(x, y + h, z) - f(x, y - h, z);
  const gz = f(x, y, z + h) - f(x, y, z - h);
  const l = Math.hypot(gx, gy, gz) || 1;
  out[0] = gx / l;
  out[1] = gy / l;
  out[2] = gz / l;
  return out;
}

/**
 * Sample the field on every `step`-th lattice point. Where a coarser level is
 * given, a point is only evaluated if the coarser level's interpolated value
 * puts it near the surface; elsewhere the interpolation is kept, because only
 * its sign will ever be read.
 */
function sampleLevel(
  f: Field,
  nx: number,
  ny: number,
  nz: number,
  x0: number,
  y0: number,
  z0: number,
  cell: number,
  step: number,
  coarser: Float32Array | null,
): Float32Array {
  const out = coarser ?? new Float32Array(nx * ny * nz);
  const parent = step * 2;
  const band = parent * cell * 1.8;
  const sy = nx;
  const sz = nx * ny;
  for (let k = 0; k < nz; k += step) {
    for (let j = 0; j < ny; j += step) {
      for (let i = 0; i < nx; i += step) {
        const idx = i + sy * j + sz * k;
        if (!coarser) {
          out[idx] = f(x0 + i * cell, y0 + j * cell, z0 + k * cell);
          continue;
        }
        // Points already on the parent lattice are exact.
        if (i % parent === 0 && j % parent === 0 && k % parent === 0) continue;
        const i0 = i - (i % parent);
        const j0 = j - (j % parent);
        const k0 = k - (k % parent);
        const i1 = Math.min(i0 + parent, lastOn(nx, parent));
        const j1 = Math.min(j0 + parent, lastOn(ny, parent));
        const k1 = Math.min(k0 + parent, lastOn(nz, parent));
        const tx = i1 > i0 ? (i - i0) / (i1 - i0) : 0;
        const ty = j1 > j0 ? (j - j0) / (j1 - j0) : 0;
        const tz = k1 > k0 ? (k - k0) / (k1 - k0) : 0;
        const c000 = out[i0 + sy * j0 + sz * k0]!;
        const c100 = out[i1 + sy * j0 + sz * k0]!;
        const c010 = out[i0 + sy * j1 + sz * k0]!;
        const c110 = out[i1 + sy * j1 + sz * k0]!;
        const c001 = out[i0 + sy * j0 + sz * k1]!;
        const c101 = out[i1 + sy * j0 + sz * k1]!;
        const c011 = out[i0 + sy * j1 + sz * k1]!;
        const c111 = out[i1 + sy * j1 + sz * k1]!;
        const c00 = c000 + (c100 - c000) * tx;
        const c10 = c010 + (c110 - c010) * tx;
        const c01 = c001 + (c101 - c001) * tx;
        const c11 = c011 + (c111 - c011) * tx;
        const c0 = c00 + (c10 - c00) * ty;
        const c1 = c01 + (c11 - c01) * ty;
        const approx = c0 + (c1 - c0) * tz;
        out[idx] =
          Math.abs(approx) > band
            ? approx
            : f(x0 + i * cell, y0 + j * cell, z0 + k * cell);
      }
    }
  }
  return out;
}

/** The last lattice index on a level of spacing `step`. */
function lastOn(n: number, step: number): number {
  return Math.floor((n - 1) / step) * step;
}

/**
 * Naive surface nets with a narrow band.
 *
 * The field is sampled on a coarse lattice first and refined twice, each
 * time only near the surface. Everywhere else only the sign matters, and the
 * coarser value has the right sign. That keeps a 2 mm hand to about a hundred
 * thousand field evaluations instead of most of a million.
 *
 * Each vertex is then pulled onto the zero set with one Newton step and given
 * the field gradient as its normal, so the facets of the lattice never show.
 */
export function surfaceNets(f: Field, bounds: Bounds, cell: number): SdfMesh {
  const nx = Math.max(2, Math.ceil((bounds.max[0] - bounds.min[0]) / cell) + 1);
  const ny = Math.max(2, Math.ceil((bounds.max[1] - bounds.min[1]) / cell) + 1);
  const nz = Math.max(2, Math.ceil((bounds.max[2] - bounds.min[2]) / cell) + 1);
  const x0 = bounds.min[0];
  const y0 = bounds.min[1];
  const z0 = bounds.min[2];

  // Three lattices, each refined only where the one above says the surface
  // could be. A trilinear interpolation of distances is off by at most the
  // distance to the farthest corner, so a band of √3 × spacing is safe.
  const fine = sampleLevel(f, nx, ny, nz, x0, y0, z0, cell, 4, null);
  sampleLevel(f, nx, ny, nz, x0, y0, z0, cell, 2, fine);
  sampleLevel(f, nx, ny, nz, x0, y0, z0, cell, 1, fine);

  // One vertex per sign-changing cell, at the mean of its edge crossings.
  const cellIndex = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const positions: number[] = [];
  const corner = new Float32Array(8);
  const EDGES = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ] as const;
  const indices: number[] = [];
  const sx = 1;
  const sy = nx;
  const sz = nx * ny;
  const csx = 1;
  const csy = nx - 1;
  const csz = (nx - 1) * (ny - 1);

  for (let k = 0; k < nz - 1; k += 1) {
    for (let j = 0; j < ny - 1; j += 1) {
      for (let i = 0; i < nx - 1; i += 1) {
        const g = i + nx * (j + ny * k);
        let mask = 0;
        for (let c = 0; c < 8; c += 1) {
          const v = fine[g + (c & 1 ? sx : 0) + (c & 2 ? sy : 0) + (c & 4 ? sz : 0)]!;
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let px = 0;
        let py = 0;
        let pz = 0;
        let count = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a]!;
          const vb = corner[b]!;
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const ax = a & 1;
          const ay = (a >> 1) & 1;
          const az = (a >> 2) & 1;
          const bx = b & 1;
          const by = (b >> 1) & 1;
          const bz = (b >> 2) & 1;
          px += ax + (bx - ax) * t;
          py += ay + (by - ay) * t;
          pz += az + (bz - az) * t;
          count += 1;
        }
        const ci = i + csy * j + csz * k;
        cellIndex[ci] = positions.length / 3;
        positions.push(
          x0 + (i + px / count) * cell,
          y0 + (j + py / count) * cell,
          z0 + (k + pz / count) * cell,
        );

        // Faces: one quad per sign change on the three edges leaving corner 0.
        const inside = (mask & 1) !== 0;
        for (let axis = 0; axis < 3; axis += 1) {
          const bit = 1 << (axis === 0 ? 1 : axis === 1 ? 2 : 4);
          if (((mask & 1) !== 0) === ((mask & bit) !== 0)) continue;
          const u = axis === 0 ? 1 : axis === 1 ? 2 : 0;
          const w = axis === 0 ? 2 : axis === 1 ? 0 : 1;
          const coord = [i, j, k];
          if (coord[u]! === 0 || coord[w]! === 0) continue;
          const du = u === 0 ? csx : u === 1 ? csy : csz;
          const dw = w === 0 ? csx : w === 1 ? csy : csz;
          const a0 = cellIndex[ci];
          const a1 = cellIndex[ci - du]!;
          const a2 = cellIndex[ci - du - dw]!;
          const a3 = cellIndex[ci - dw]!;
          if (a1 < 0 || a2 < 0 || a3 < 0) continue;
          if (inside) indices.push(a0, a1, a2, a0, a2, a3);
          else indices.push(a0, a2, a1, a0, a3, a2);
        }
      }
    }
  }

  // Project onto the surface and take the analytic normal. A tetrahedral
  // stencil gives the value (its mean) and the gradient from four samples.
  const count = positions.length / 3;
  const pos = new Float32Array(positions);
  const nrm = new Float32Array(count * 3);
  const h = cell * 0.35;
  for (let v = 0; v < count; v += 1) {
    let x = pos[v * 3]!;
    let y = pos[v * 3 + 1]!;
    let z = pos[v * 3 + 2]!;
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (let step = 0; step < 2; step += 1) {
      const a = f(x + h, y - h, z - h);
      const b = f(x - h, y - h, z + h);
      const c = f(x - h, y + h, z - h);
      const d = f(x + h, y + h, z + h);
      gx = a - b - c + d;
      gy = -a - b + c + d;
      gz = -a + b - c + d;
      const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
      gx /= l;
      gy /= l;
      gz /= l;
      const move = Math.max(-cell, Math.min(cell, (a + b + c + d) * 0.25));
      x -= gx * move;
      y -= gy * move;
      z -= gz * move;
    }
    pos[v * 3] = x;
    pos[v * 3 + 1] = y;
    pos[v * 3 + 2] = z;
    nrm[v * 3] = gx;
    nrm[v * 3 + 1] = gy;
    nrm[v * 3 + 2] = gz;
  }
  return { positions: pos, normals: nrm, indices: new Uint32Array(indices) };
}

/**
 * Ambient occlusion from the field itself: march a few steps out along the
 * normal and measure how much closer the nearest surface is than the step.
 * `occluder` is everything that shadows but is not meshed — the weapon.
 */
export function fieldOcclusion(
  f: Field,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  step: number,
): number {
  let occ = 0;
  let weight = 1;
  for (let i = 1; i <= 5; i += 1) {
    const t = step * i;
    const d = f(x + nx * t, y + ny * t, z + nz * t);
    occ += (t - Math.max(0, d)) * weight;
    weight *= 0.62;
  }
  return Math.max(0, Math.min(1, 1 - (occ / step) * 0.34));
}
