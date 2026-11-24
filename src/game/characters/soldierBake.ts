/**
 * Per-vertex bakes for the soldier, computed once per kit in the rest pose.
 *
 * **Occlusion.** A layered kit is mostly crevices: a magazine pouch standing
 * proud of a plate, a cummerbund over a shirt, a helmet brim over the brow.
 * Shadow maps are metres per texel at gameplay range and screen-space AO only
 * sees what is on screen at its own radius, so neither darkens a two
 * centimetre gap — and without that darkening every part reads as a separate
 * primitive pasted onto a mannequin. So the soldier is voxelised once and each
 * vertex marches a cosine-weighted fan of short rays through the grid.
 *
 * Parts move relative to each other, so occluders are filtered by body
 * group: an arm hangs beside the ribs in the rest pose but is raised in front
 * of the chest in every pose a player sees, and baking the one into the other
 * would paint a permanent arm-shaped shadow on the plate carrier.
 *
 * **Convexity.** The mean angle between a vertex's normal and its neighbours'
 * offsets: positive on an edge, negative in a fold. Edge wear (abraded nylon,
 * scuffed polymer) and cavity grime both key off it in the shader.
 */

export const AO_GROUP = {
  torso: 1,
  armL: 2,
  armR: 4,
  legL: 8,
  legR: 16,
} as const;

export type AoGroup = (typeof AO_GROUP)[keyof typeof AO_GROUP];

/** Which groups may occlude a vertex of the given group. */
function occluderMask(group: number): number {
  switch (group) {
    case AO_GROUP.legL:
      return AO_GROUP.legL | AO_GROUP.torso;
    case AO_GROUP.legR:
      return AO_GROUP.legR | AO_GROUP.torso;
    default:
      return group;
  }
}

const CELL = 0.011;
const ORIGIN = [-0.42, -0.02, -0.4] as const;
const DIMS = [
  Math.ceil(0.84 / CELL),
  Math.ceil(1.94 / CELL),
  Math.ceil(0.8 / CELL),
] as const;

/** Twelve directions on the +z hemisphere, cosine-distributed. */
const DIRS: ReadonlyArray<readonly [number, number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  const count = 14;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const r = Math.sqrt((i + 0.5) / count);
    const phi = i * golden;
    const x = r * Math.cos(phi);
    const y = r * Math.sin(phi);
    out.push([x, y, Math.sqrt(Math.max(0, 1 - r * r))]);
  }
  return out;
})();

/**
 * Bake occlusion and convexity into `out` (two floats per vertex).
 *
 * `positions`/`normals` are the merged rest-pose arrays, `index` the merged
 * triangle list, and `groups` one AO group per vertex.
 */
export function bakeOcclusion(
  positions: Float32Array,
  normals: Float32Array,
  index: ArrayLike<number>,
  groups: Uint8Array,
  out: Float32Array,
): void {
  const [nx, ny, nz] = DIMS;
  const grid = new Uint8Array(nx * ny * nz);
  const cell = (x: number, y: number, z: number): number => {
    const ix = Math.floor((x - ORIGIN[0]) / CELL);
    const iy = Math.floor((y - ORIGIN[1]) / CELL);
    const iz = Math.floor((z - ORIGIN[2]) / CELL);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return -1;
    return (iz * ny + iy) * nx + ix;
  };

  // Surface voxelisation: sample each triangle densely enough to leave no
  // holes at this cell size.
  const triCount = index.length / 3;
  for (let t = 0; t < triCount; t += 1) {
    const a = index[t * 3]!;
    const b = index[t * 3 + 1]!;
    const c = index[t * 3 + 2]!;
    const mask = groups[a]! | groups[b]! | groups[c]!;
    const ax = positions[a * 3]!;
    const ay = positions[a * 3 + 1]!;
    const az = positions[a * 3 + 2]!;
    const bx = positions[b * 3]! - ax;
    const by = positions[b * 3 + 1]! - ay;
    const bz = positions[b * 3 + 2]! - az;
    const cx = positions[c * 3]! - ax;
    const cy = positions[c * 3 + 1]! - ay;
    const cz = positions[c * 3 + 2]! - az;
    const longest = Math.max(Math.hypot(bx, by, bz), Math.hypot(cx, cy, cz));
    const steps = Math.max(1, Math.ceil(longest / (CELL * 0.6)));
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; j <= steps - i; j += 1) {
        const u = i / steps;
        const v = j / steps;
        const id = cell(ax + bx * u + cx * v, ay + by * u + cy * v, az + bz * u + cz * v);
        if (id >= 0) grid[id] = grid[id]! | mask;
      }
    }
  }

  const count = positions.length / 3;
  const maxSteps = 11;
  const tx = [0, 0, 0];
  const bt = [0, 0, 0];
  for (let v = 0; v < count; v += 1) {
    const px = positions[v * 3]!;
    const py = positions[v * 3 + 1]!;
    const pz = positions[v * 3 + 2]!;
    let ux = normals[v * 3]!;
    let uy = normals[v * 3 + 1]!;
    let uz = normals[v * 3 + 2]!;
    const len = Math.hypot(ux, uy, uz) || 1;
    ux /= len;
    uy /= len;
    uz /= len;
    // Tangent frame around the normal.
    if (Math.abs(uy) < 0.9) {
      tx[0] = uz;
      tx[1] = 0;
      tx[2] = -ux;
    } else {
      tx[0] = 0;
      tx[1] = -uz;
      tx[2] = uy;
    }
    const tl = Math.hypot(tx[0], tx[1], tx[2]) || 1;
    tx[0] /= tl;
    tx[1] /= tl;
    tx[2] /= tl;
    bt[0] = uy * tx[2] - uz * tx[1];
    bt[1] = uz * tx[0] - ux * tx[2];
    bt[2] = ux * tx[1] - uy * tx[0];

    const allowed = occluderMask(groups[v]!);
    let occlusion = 0;
    for (const [dx, dy, dz] of DIRS) {
      const rx = tx[0] * dx + bt[0] * dy + ux * dz;
      const ry = tx[1] * dx + bt[1] * dy + uy * dz;
      const rz = tx[2] * dx + bt[2] * dy + uz * dz;
      // Start clear of the vertex's own surface voxel.
      for (let s = 2; s <= maxSteps; s += 1) {
        const d = s * CELL;
        const id = cell(
          px + rx * d + ux * CELL * 0.6,
          py + ry * d + uy * CELL * 0.6,
          pz + rz * d + uz * CELL * 0.6,
        );
        if (id < 0) break;
        if (grid[id]! & allowed) {
          occlusion += 1 - (s - 2) / (maxSteps - 1);
          break;
        }
      }
    }
    out[v * 2] = 1 - Math.min(1, (occlusion / DIRS.length) * 1.35);
  }

  // Convexity from the one-ring.
  const sum = new Float32Array(count);
  const hits = new Uint16Array(count);
  const edge = (a: number, b: number) => {
    const dx = positions[b * 3]! - positions[a * 3]!;
    const dy = positions[b * 3 + 1]! - positions[a * 3 + 1]!;
    const dz = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-7) return;
    const d =
      (dx * normals[a * 3]! + dy * normals[a * 3 + 1]! + dz * normals[a * 3 + 2]!) / l;
    sum[a] = sum[a]! - d;
    hits[a] = hits[a]! + 1;
  };
  for (let t = 0; t < triCount; t += 1) {
    const a = index[t * 3]!;
    const b = index[t * 3 + 1]!;
    const c = index[t * 3 + 2]!;
    edge(a, b);
    edge(a, c);
    edge(b, a);
    edge(b, c);
    edge(c, a);
    edge(c, b);
  }
  for (let v = 0; v < count; v += 1) {
    const h = hits[v]!;
    out[v * 2 + 1] = h > 0 ? Math.max(-1, Math.min(1, (sum[v]! / h) * 2.2)) : 0;
  }
}
