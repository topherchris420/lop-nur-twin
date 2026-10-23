/**
 * Deterministic mesh reduction for the FlyBody importer.
 *
 * `weld` merges the triangle soup an OBJ export writes (three vertices per
 * face) at exactly equal positions. `decimate` is quadric-error edge collapse
 * (Garland & Heckbert 1997): every vertex carries the summed squared distance
 * to its faces' planes, each edge collapses to the point minimising the sum,
 * and the cheapest edge goes first. Open boundaries carry a penalty plane so
 * the wing membrane keeps its outline; a collapse that would fold a face over
 * or pinch the surface into a non-manifold shape is skipped. Ties break on
 * vertex indices, so the same input always yields the same mesh.
 */
export interface Mesh {
  positions: Float64Array;
  triangles: Uint32Array;
}

export function weld(soup: readonly number[], faces: readonly number[]): Mesh {
  const index = new Map<string, number>();
  const positions: number[] = [];
  const remap = new Uint32Array(soup.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const x = soup[3 * i]!,
      y = soup[3 * i + 1]!,
      z = soup[3 * i + 2]!;
    const key = `${x},${y},${z}`;
    let k = index.get(key);
    if (k === undefined) {
      k = positions.length / 3;
      index.set(key, k);
      positions.push(x, y, z);
    }
    remap[i] = k;
  }
  const triangles: number[] = [];
  for (let t = 0; t < faces.length; t += 3) {
    const a = remap[faces[t]!]!,
      b = remap[faces[t + 1]!]!,
      c = remap[faces[t + 2]!]!;
    if (a !== b && b !== c && a !== c) triangles.push(a, b, c);
  }
  return {
    positions: Float64Array.from(positions),
    triangles: Uint32Array.from(triangles),
  };
}

/** Symmetric 4×4 quadric as 10 coefficients: aa ab ac ad bb bc bd cc cd dd. */
function addPlane(
  Q: Float64Array,
  o: number,
  a: number,
  b: number,
  c: number,
  d: number,
  w: number,
) {
  Q[o] = Q[o]! + w * a * a;
  Q[o + 1] = Q[o + 1]! + w * a * b;
  Q[o + 2] = Q[o + 2]! + w * a * c;
  Q[o + 3] = Q[o + 3]! + w * a * d;
  Q[o + 4] = Q[o + 4]! + w * b * b;
  Q[o + 5] = Q[o + 5]! + w * b * c;
  Q[o + 6] = Q[o + 6]! + w * b * d;
  Q[o + 7] = Q[o + 7]! + w * c * c;
  Q[o + 8] = Q[o + 8]! + w * c * d;
  Q[o + 9] = Q[o + 9]! + w * d * d;
}
function evalQ(q: ArrayLike<number>, x: number, y: number, z: number): number {
  return (
    q[0]! * x * x +
    2 * q[1]! * x * y +
    2 * q[2]! * x * z +
    2 * q[3]! * x +
    q[4]! * y * y +
    2 * q[5]! * y * z +
    2 * q[6]! * y +
    q[7]! * z * z +
    2 * q[8]! * z +
    q[9]!
  );
}

interface Entry {
  cost: number;
  u: number;
  v: number;
  su: number;
  sv: number;
  x: number;
  y: number;
  z: number;
}
const before = (a: Entry, b: Entry) =>
  a.cost !== b.cost ? a.cost < b.cost : a.u !== b.u ? a.u < b.u : a.v < b.v;

class Heap {
  private items: Entry[] = [];
  get size() {
    return this.items.length;
  }
  push(e: Entry) {
    const h = this.items;
    h.push(e);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }
  pop(): Entry | undefined {
    const h = this.items;
    const top = h[0];
    const last = h.pop();
    if (h.length && last) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < h.length && before(h[l]!, h[m]!)) m = l;
        if (r < h.length && before(h[r]!, h[m]!)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m]!, h[i]!];
        i = m;
      }
    }
    return top;
  }
}

export function decimate(mesh: Mesh, targetTriangles: number): Mesh {
  const P = Float64Array.from(mesh.positions);
  const T = Uint32Array.from(mesh.triangles);
  const n = P.length / 3,
    m = T.length / 3;
  if (m <= targetTriangles) return { positions: P, triangles: T };
  const Q = new Float64Array(n * 10);
  const alive = new Uint8Array(m).fill(1);
  const adj: number[][] = Array.from({ length: n }, () => []);
  const stamp = new Uint32Array(n);
  const dead = new Uint8Array(n);
  const normal = (t: number, override = -1, ox = 0, oy = 0, oz = 0) => {
    const p = (k: number) => {
      const v = T[3 * t + k]!;
      return v === override ? [ox, oy, oz] : [P[3 * v]!, P[3 * v + 1]!, P[3 * v + 2]!];
    };
    const a = p(0),
      b = p(1),
      c = p(2);
    const ux = b[0]! - a[0]!,
      uy = b[1]! - a[1]!,
      uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!,
      vy = c[1]! - a[1]!,
      vz = c[2]! - a[2]!;
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx] as const;
  };
  // Face planes, area-weighted.
  let scale = 0;
  for (let t = 0; t < m; t++) {
    for (let k = 0; k < 3; k++) adj[T[3 * t + k]!]!.push(t);
    const [nx, ny, nz] = normal(t);
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 0)) continue;
    const a = nx / len,
      b = ny / len,
      c = nz / len;
    const v0 = T[3 * t]!;
    const d = -(a * P[3 * v0]! + b * P[3 * v0 + 1]! + c * P[3 * v0 + 2]!);
    for (let k = 0; k < 3; k++) addPlane(Q, T[3 * t + k]! * 10, a, b, c, d, len / 2);
    scale += len / 2;
  }
  // Boundary edges: a plane through the edge, perpendicular to its face, heavily weighted.
  const edgeCount = new Map<string, { n: number; t: number }>();
  for (let t = 0; t < m; t++)
    for (let k = 0; k < 3; k++) {
      const a = T[3 * t + k]!,
        b = T[3 * t + ((k + 1) % 3)]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const e = edgeCount.get(key);
      if (e) e.n++;
      else edgeCount.set(key, { n: 1, t });
    }
  const meanArea = scale / m;
  for (const [key, e] of edgeCount) {
    if (e.n !== 1) continue;
    const [a, b] = key.split(",").map(Number) as [number, number];
    const [fx, fy, fz] = normal(e.t);
    const ex = P[3 * b]! - P[3 * a]!,
      ey = P[3 * b + 1]! - P[3 * a + 1]!,
      ez = P[3 * b + 2]! - P[3 * a + 2]!;
    let px = ey * fz - ez * fy,
      py = ez * fx - ex * fz,
      pz = ex * fy - ey * fx;
    const len = Math.hypot(px, py, pz);
    if (!(len > 0)) continue;
    px /= len;
    py /= len;
    pz /= len;
    const d = -(px * P[3 * a]! + py * P[3 * a + 1]! + pz * P[3 * a + 2]!);
    const w = 20 * meanArea;
    addPlane(Q, a * 10, px, py, pz, d, w);
    addPlane(Q, b * 10, px, py, pz, d, w);
  }

  const neighbours = (v: number): Set<number> => {
    const s = new Set<number>();
    for (const t of adj[v]!)
      if (alive[t])
        for (let k = 0; k < 3; k++) {
          const w = T[3 * t + k]!;
          if (w !== v) s.add(w);
        }
    return s;
  };
  const sumQ = new Float64Array(10);
  const plan = (u: number, v: number): Entry => {
    for (let k = 0; k < 10; k++) sumQ[k] = Q[u * 10 + k]! + Q[v * 10 + k]!;
    const q = sumQ;
    const ax = P[3 * u]!,
      ay = P[3 * u + 1]!,
      az = P[3 * u + 2]!;
    const bx = P[3 * v]!,
      by = P[3 * v + 1]!,
      bz = P[3 * v + 2]!;
    const candidates: [number, number, number][] = [
      [ax, ay, az],
      [bx, by, bz],
      [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2],
    ];
    // Solve the 3×3 system for the optimum when it is well conditioned.
    const a11 = q[0]!,
      a12 = q[1]!,
      a13 = q[2]!,
      a22 = q[4]!,
      a23 = q[5]!,
      a33 = q[7]!;
    const det =
      a11 * (a22 * a33 - a23 * a23) -
      a12 * (a12 * a33 - a23 * a13) +
      a13 * (a12 * a23 - a22 * a13);
    const norm = Math.abs(a11) + Math.abs(a22) + Math.abs(a33);
    if (Math.abs(det) > 1e-12 * norm * norm * norm) {
      const b1 = -q[3]!,
        b2 = -q[6]!,
        b3 = -q[8]!;
      const x =
        (b1 * (a22 * a33 - a23 * a23) -
          a12 * (b2 * a33 - a23 * b3) +
          a13 * (b2 * a23 - a22 * b3)) /
        det;
      const y =
        (a11 * (b2 * a33 - a23 * b3) -
          b1 * (a12 * a33 - a23 * a13) +
          a13 * (a12 * b3 - b2 * a13)) /
        det;
      const z =
        (a11 * (a22 * b3 - b2 * a23) -
          a12 * (a12 * b3 - b2 * a13) +
          b1 * (a12 * a23 - a22 * a13)) /
        det;
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      const mx = (ax + bx) / 2,
        my = (ay + by) / 2,
        mz = (az + bz) / 2;
      if (Math.hypot(x - mx, y - my, z - mz) <= len) candidates.push([x, y, z]);
    }
    let best = candidates[0]!,
      cost = Infinity;
    for (const c of candidates) {
      const e = evalQ(q, c[0], c[1], c[2]);
      if (e < cost) {
        cost = e;
        best = c;
      }
    }
    return {
      cost: Math.max(0, cost),
      u: Math.min(u, v),
      v: Math.max(u, v),
      su: stamp[Math.min(u, v)]!,
      sv: stamp[Math.max(u, v)]!,
      x: best[0],
      y: best[1],
      z: best[2],
    };
  };
  const heap = new Heap();
  for (const key of edgeCount.keys()) {
    const [a, b] = key.split(",").map(Number) as [number, number];
    heap.push(plan(a, b));
  }
  let live = m;
  while (live > targetTriangles && heap.size) {
    const e = heap.pop()!;
    const { u, v } = e;
    if (dead[u] || dead[v] || stamp[u] !== e.su || stamp[v] !== e.sv) continue;
    const nu = neighbours(u);
    if (!nu.has(v)) continue;
    // Link condition: the edge's two endpoints may share only the opposite
    // vertices of its one or two faces, or the collapse pinches the surface.
    const nv = neighbours(v);
    let shared = 0,
      faces = 0;
    for (const w of nu) if (nv.has(w)) shared++;
    for (const t of adj[u]!)
      if (alive[t]) {
        const a = T[3 * t]!,
          b = T[3 * t + 1]!,
          c = T[3 * t + 2]!;
        if (a === v || b === v || c === v) faces++;
      }
    if (shared !== faces) continue;
    // No face may flip or collapse to nothing.
    let ok = true;
    for (const w of [u, v]) {
      for (const t of adj[w]!) {
        if (!alive[t]) continue;
        const a = T[3 * t]!,
          b = T[3 * t + 1]!,
          c = T[3 * t + 2]!;
        if ((a === u || b === u || c === u) && (a === v || b === v || c === v)) continue;
        const [ox, oy, oz] = normal(t);
        const [qx, qy, qz] = normal(t, w, e.x, e.y, e.z);
        const lo = Math.hypot(ox, oy, oz),
          ln = Math.hypot(qx, qy, qz);
        if (
          !(ln > 1e-14 * (lo + 1e-30)) ||
          (ox * qx + oy * qy + oz * qz) / (lo * ln) < 0.2
        ) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (!ok) continue;
    P[3 * u] = e.x;
    P[3 * u + 1] = e.y;
    P[3 * u + 2] = e.z;
    for (let k = 0; k < 10; k++) Q[u * 10 + k] = Q[u * 10 + k]! + Q[v * 10 + k]!;
    for (const t of adj[v]!) {
      if (!alive[t]) continue;
      const has = [0, 1, 2].some((k) => T[3 * t + k] === u);
      if (has) {
        alive[t] = 0;
        live--;
      } else {
        for (let k = 0; k < 3; k++) if (T[3 * t + k] === v) T[3 * t + k] = u;
        adj[u]!.push(t);
      }
    }
    adj[u] = adj[u]!.filter((t) => alive[t]);
    adj[v] = [];
    dead[v] = 1;
    stamp[u]++;
    for (const w of neighbours(u)) heap.push(plan(u, w));
  }
  // Compact, renumbering vertices in order of first use.
  const order = new Int32Array(n).fill(-1);
  const positions: number[] = [];
  const triangles: number[] = [];
  for (let t = 0; t < m; t++) {
    if (!alive[t]) continue;
    for (let k = 0; k < 3; k++) {
      const v = T[3 * t + k]!;
      if (order[v] === -1) {
        order[v] = positions.length / 3;
        positions.push(P[3 * v]!, P[3 * v + 1]!, P[3 * v + 2]!);
      }
      triangles.push(order[v]!);
    }
  }
  return {
    positions: Float64Array.from(positions),
    triangles: Uint32Array.from(triangles),
  };
}

/** Renumbers vertices in order of first use, so delta-coded indices stay small. */
export function reorder(mesh: Mesh): Mesh {
  return decimate(mesh, Infinity);
}
