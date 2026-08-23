import * as THREE from "three";
import {
  LAYER,
  MASK_MOVEMENT,
  MASK_SOLID,
  type EntityId,
  type HitRegion,
  type RayHit,
  type SurfaceType,
} from "../core/types";

/**
 * Static + dynamic collision for the combat layer.
 *
 * The world is a set of oriented boxes (OBBs) indexed by a uniform grid.
 * Static boxes are baked once from the rendered scene graph, so collision
 * always matches what the player can see — including hangar walls, aircraft
 * landing gear, fuel tanks and tower legs — without a hand-authored proxy
 * mesh. Dynamic boxes (character hitboxes, doors, vehicles) are re-registered
 * every frame into a separate list that is small enough to test linearly.
 *
 * Ground is analytic: `terrainHeight` from `src/lib/terrain.ts` is the same
 * function the terrain mesh is displaced by, so feet never float or sink.
 */

/* ------------------------------------------------------------------ */
/* Colliders                                                           */
/* ------------------------------------------------------------------ */

export interface Collider {
  readonly id: number;
  /** Box centre in world space. */
  readonly center: THREE.Vector3;
  /** Half extents along the collider's own axes. */
  readonly halfExtents: THREE.Vector3;
  /**
   * Rotation from local box space to world space. Stored as three unit axis
   * vectors so the hot loops avoid quaternion maths.
   */
  readonly axisX: THREE.Vector3;
  readonly axisY: THREE.Vector3;
  readonly axisZ: THREE.Vector3;
  readonly layer: number;
  readonly surface: SurfaceType;
  /** Set for character/vehicle hitboxes; `null` for world geometry. */
  entityId: EntityId | null;
  region: HitRegion | null;
  /** World-space AABB, for broadphase. */
  readonly min: THREE.Vector3;
  readonly max: THREE.Vector3;
}

let nextColliderId = 1;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _mat = new THREE.Matrix4();

export function makeCollider(
  center: THREE.Vector3,
  halfExtents: THREE.Vector3,
  quaternion: THREE.Quaternion,
  layer: number,
  surface: SurfaceType,
  entityId: EntityId | null = null,
  region: HitRegion | null = null,
): Collider {
  const axisX = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  const axisY = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  const axisZ = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  const ex =
    Math.abs(axisX.x) * halfExtents.x +
    Math.abs(axisY.x) * halfExtents.y +
    Math.abs(axisZ.x) * halfExtents.z;
  const ey =
    Math.abs(axisX.y) * halfExtents.x +
    Math.abs(axisY.y) * halfExtents.y +
    Math.abs(axisZ.y) * halfExtents.z;
  const ez =
    Math.abs(axisX.z) * halfExtents.x +
    Math.abs(axisY.z) * halfExtents.y +
    Math.abs(axisZ.z) * halfExtents.z;
  return {
    id: nextColliderId++,
    center: center.clone(),
    halfExtents: halfExtents.clone(),
    axisX,
    axisY,
    axisZ,
    layer,
    surface,
    entityId,
    region,
    min: new THREE.Vector3(center.x - ex, center.y - ey, center.z - ez),
    max: new THREE.Vector3(center.x + ex, center.y + ey, center.z + ez),
  };
}

/** Rewrite a collider in place — used for per-frame character hitboxes. */
export function updateCollider(
  collider: Collider,
  center: THREE.Vector3,
  quaternion: THREE.Quaternion,
): void {
  collider.center.copy(center);
  collider.axisX.set(1, 0, 0).applyQuaternion(quaternion);
  collider.axisY.set(0, 1, 0).applyQuaternion(quaternion);
  collider.axisZ.set(0, 0, 1).applyQuaternion(quaternion);
  const h = collider.halfExtents;
  const ex =
    Math.abs(collider.axisX.x) * h.x +
    Math.abs(collider.axisY.x) * h.y +
    Math.abs(collider.axisZ.x) * h.z;
  const ey =
    Math.abs(collider.axisX.y) * h.x +
    Math.abs(collider.axisY.y) * h.y +
    Math.abs(collider.axisZ.y) * h.z;
  const ez =
    Math.abs(collider.axisX.z) * h.x +
    Math.abs(collider.axisY.z) * h.y +
    Math.abs(collider.axisZ.z) * h.z;
  collider.min.set(center.x - ex, center.y - ey, center.z - ez);
  collider.max.set(center.x + ex, center.y + ey, center.z + ez);
}

/* ------------------------------------------------------------------ */
/* Local-space helpers                                                 */
/* ------------------------------------------------------------------ */

function toLocal(c: Collider, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const dx = p.x - c.center.x;
  const dy = p.y - c.center.y;
  const dz = p.z - c.center.z;
  return out.set(
    dx * c.axisX.x + dy * c.axisX.y + dz * c.axisX.z,
    dx * c.axisY.x + dy * c.axisY.y + dz * c.axisY.z,
    dx * c.axisZ.x + dy * c.axisZ.y + dz * c.axisZ.z,
  );
}

function dirToLocal(c: Collider, d: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.set(
    d.x * c.axisX.x + d.y * c.axisX.y + d.z * c.axisX.z,
    d.x * c.axisY.x + d.y * c.axisY.y + d.z * c.axisY.z,
    d.x * c.axisZ.x + d.y * c.axisZ.y + d.z * c.axisZ.z,
  );
}

function localToWorldDir(
  c: Collider,
  l: THREE.Vector3,
  out: THREE.Vector3,
): THREE.Vector3 {
  return out.set(
    c.axisX.x * l.x + c.axisY.x * l.y + c.axisZ.x * l.z,
    c.axisX.y * l.x + c.axisY.y * l.y + c.axisZ.y * l.z,
    c.axisX.z * l.x + c.axisY.z * l.y + c.axisZ.z * l.z,
  );
}

/**
 * Slab test in the box's own frame.
 * Returns entry/exit distances along the ray, or `null` if it misses.
 */
function raySlab(
  lo: THREE.Vector3,
  ld: THREE.Vector3,
  h: THREE.Vector3,
): { tMin: number; tMax: number; axis: number; sign: number } | null {
  let tMin = -Infinity;
  let tMax = Infinity;
  let axis = 0;
  let sign = 1;
  for (let i = 0; i < 3; i += 1) {
    const o = i === 0 ? lo.x : i === 1 ? lo.y : lo.z;
    const d = i === 0 ? ld.x : i === 1 ? ld.y : ld.z;
    const e = i === 0 ? h.x : i === 1 ? h.y : h.z;
    if (Math.abs(d) < 1e-8) {
      if (o < -e || o > e) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (-e - o) * inv;
    let t2 = (e - o) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      axis = i;
      sign = s;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  return { tMin, tMax, axis, sign };
}

/** Closest point on an OBB to a world point. */
export function closestPointOnCollider(
  c: Collider,
  p: THREE.Vector3,
  out: THREE.Vector3,
): THREE.Vector3 {
  const l = toLocal(c, p, _v3);
  const h = c.halfExtents;
  l.x = Math.min(h.x, Math.max(-h.x, l.x));
  l.y = Math.min(h.y, Math.max(-h.y, l.y));
  l.z = Math.min(h.z, Math.max(-h.z, l.z));
  localToWorldDir(c, l, out);
  return out.add(c.center);
}

/* ------------------------------------------------------------------ */
/* Broadphase grid                                                     */
/* ------------------------------------------------------------------ */

const CELL = 16;

class Grid {
  private readonly cells = new Map<number, number[]>();
  private readonly items: Collider[] = [];

  private key(ix: number, iz: number): number {
    // 16-bit signed lanes; the site is ~7 km across so 16 m cells fit easily.
    return ((ix + 32768) << 16) | (iz + 32768);
  }

  insert(c: Collider): void {
    const index = this.items.length;
    this.items.push(c);
    const x0 = Math.floor(c.min.x / CELL);
    const x1 = Math.floor(c.max.x / CELL);
    const z0 = Math.floor(c.min.z / CELL);
    const z1 = Math.floor(c.max.z / CELL);
    // A pathological collider (a whole runway) would spam the grid; those are
    // handled by the analytic ground instead, so clamp defensively.
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) return;
    for (let ix = x0; ix <= x1; ix += 1) {
      for (let iz = z0; iz <= z1; iz += 1) {
        const k = this.key(ix, iz);
        const bucket = this.cells.get(k);
        if (bucket) bucket.push(index);
        else this.cells.set(k, [index]);
      }
    }
  }

  get size(): number {
    return this.items.length;
  }

  at(index: number): Collider {
    return this.items[index]!;
  }

  /** Append every collider index overlapping an AABB into `out` (deduped by stamp). */
  queryBox(
    min: THREE.Vector3,
    max: THREE.Vector3,
    stamps: Int32Array,
    stamp: number,
    out: number[],
  ): void {
    const x0 = Math.floor(min.x / CELL);
    const x1 = Math.floor(max.x / CELL);
    const z0 = Math.floor(min.z / CELL);
    const z1 = Math.floor(max.z / CELL);
    for (let ix = x0; ix <= x1; ix += 1) {
      for (let iz = z0; iz <= z1; iz += 1) {
        const bucket = this.cells.get(this.key(ix, iz));
        if (!bucket) continue;
        for (const index of bucket) {
          if (stamps[index] === stamp) continue;
          stamps[index] = stamp;
          out.push(index);
        }
      }
    }
  }

  /** Walk the grid along a ray (2D DDA) calling `visit` per candidate. */
  traverseRay(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    stamps: Int32Array,
    stamp: number,
    visit: (index: number) => void,
  ): void {
    let ix = Math.floor(origin.x / CELL);
    let iz = Math.floor(origin.z / CELL);
    const stepX = dir.x > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;
    const invX = dir.x !== 0 ? 1 / dir.x : Infinity;
    const invZ = dir.z !== 0 ? 1 / dir.z : Infinity;
    const nextBoundaryX = (ix + (stepX > 0 ? 1 : 0)) * CELL;
    const nextBoundaryZ = (iz + (stepZ > 0 ? 1 : 0)) * CELL;
    let tMaxX = dir.x !== 0 ? (nextBoundaryX - origin.x) * invX : Infinity;
    let tMaxZ = dir.z !== 0 ? (nextBoundaryZ - origin.z) * invZ : Infinity;
    const tDeltaX = dir.x !== 0 ? Math.abs(CELL * invX) : Infinity;
    const tDeltaZ = dir.z !== 0 ? Math.abs(CELL * invZ) : Infinity;

    let travelled = 0;
    let guard = 0;
    while (travelled <= maxDist && guard++ < 4096) {
      const bucket = this.cells.get(this.key(ix, iz));
      if (bucket) {
        for (const index of bucket) {
          if (stamps[index] === stamp) continue;
          stamps[index] = stamp;
          visit(index);
        }
      }
      if (tMaxX < tMaxZ) {
        travelled = tMaxX;
        ix += stepX;
        tMaxX += tDeltaX;
      } else {
        travelled = tMaxZ;
        iz += stepZ;
        tMaxZ += tDeltaZ;
      }
      if (!Number.isFinite(travelled)) break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Surface classification                                              */
/* ------------------------------------------------------------------ */

const SURFACE_HINTS: readonly (readonly [RegExp, SurfaceType])[] = [
  [/glass|window|canopy/i, "glass"],
  [/tire|rubber|tyre/i, "rubber"],
  [/corrugat|panel|metal|steel|alum|airframe|tank|duct|pipe|antenna|mast|rail/i, "metal"],
  [/sheet|cladding|siding|roofsheet/i, "thin-metal"],
  [/wood|timber|crate|pallet/i, "wood"],
  [/sand|dirt|earth|dune/i, "sand"],
  [/gravel|ballast|rubble/i, "gravel"],
  [/canvas|tarp|sock|flag|cloth/i, "fabric"],
  [/concrete|slab|apron|wall|kerb|curb|plinth|foundation|barrier/i, "concrete"],
];

function classifySurface(mesh: THREE.Mesh): SurfaceType {
  const explicit = mesh.userData["surface"];
  if (typeof explicit === "string") return explicit as SurfaceType;
  const material = mesh.material;
  const name = Array.isArray(material)
    ? material.map((m) => m.name).join(" ")
    : (material?.name ?? "");
  const probe = `${name} ${mesh.name}`;
  for (const [pattern, surface] of SURFACE_HINTS) {
    if (pattern.test(probe)) return surface;
  }
  // Metallic PBR values are a reliable fallback when names are absent.
  const single = Array.isArray(material) ? material[0] : material;
  if (single instanceof THREE.MeshStandardMaterial) {
    if (single.metalness > 0.55) return "metal";
    if (single.transparent && single.opacity < 0.85) return "glass";
  }
  return "concrete";
}

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

export interface SweepResult {
  /** Resolved position of the capsule's *feet*. */
  position: THREE.Vector3;
  /** Velocity after sliding along contact planes. */
  velocity: THREE.Vector3;
  grounded: boolean;
  /** Ground normal when grounded, otherwise `+y`. */
  groundNormal: THREE.Vector3;
  /** Surface underfoot, used for footstep audio and dust colour. */
  groundSurface: SurfaceType;
  /** True when a wall stopped horizontal motion this step. */
  hitWall: boolean;
  /** Speed lost to the collision, for landing/impact feedback. */
  impactSpeed: number;
}

export type GroundHeightFn = (x: number, z: number) => number;

export class CollisionWorld {
  private readonly staticGrid = new Grid();
  private readonly dynamic: Collider[] = [];
  private stamps = new Int32Array(0);
  private stamp = 0;
  private readonly scratchIndices: number[] = [];
  private readonly groundHeight: GroundHeightFn;
  /** Surface returned for the analytic ground; overridden near pavement. */
  private groundSurfaceFn: (x: number, z: number) => SurfaceType = () => "sand";
  /** Bump this whenever static geometry changes so navmeshes can rebuild. */
  version = 0;

  constructor(groundHeight: GroundHeightFn = () => 0) {
    this.groundHeight = groundHeight;
  }

  setGroundSurfaceFn(fn: (x: number, z: number) => SurfaceType): void {
    this.groundSurfaceFn = fn;
  }

  groundAt(x: number, z: number): number {
    return this.groundHeight(x, z);
  }

  groundSurfaceAt(x: number, z: number): SurfaceType {
    return this.groundSurfaceFn(x, z);
  }

  addStatic(collider: Collider): void {
    this.staticGrid.insert(collider);
    if (this.stamps.length < this.staticGrid.size) {
      const next = new Int32Array(Math.max(64, this.staticGrid.size * 2));
      next.set(this.stamps);
      this.stamps = next;
    }
    this.version += 1;
  }

  addDynamic(collider: Collider): void {
    this.dynamic.push(collider);
  }

  removeDynamic(collider: Collider): void {
    const i = this.dynamic.indexOf(collider);
    if (i >= 0) this.dynamic.splice(i, 1);
  }

  get staticCount(): number {
    return this.staticGrid.size;
  }

  get dynamicCount(): number {
    return this.dynamic.length;
  }

  /* ---------------------------------------------------------------- */
  /* Baking                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Walk a rendered subtree and bake every meaningful mesh into a static OBB.
   *
   * Meshes opt out with `userData.noCollide`. Very small or paper-thin meshes
   * (decals, panel lines, lights) are skipped so the grid stays lean; the
   * `minVolume` threshold is in cubic metres.
   */
  bakeFromObject(
    root: THREE.Object3D,
    options: { minVolume?: number; layer?: number; maxColliders?: number } = {},
  ): number {
    const minVolume = options.minVolume ?? 0.02;
    const layer = options.layer ?? LAYER.prop;
    const maxColliders = options.maxColliders ?? 20000;
    let added = 0;
    root.updateWorldMatrix(true, true);
    root.traverse((object) => {
      if (added >= maxColliders) return;
      if (object.userData["noCollide"] === true) return;
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry;
      if (!geometry) return;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      if (!bounds) return;

      object.updateWorldMatrix(true, false);
      _mat.copy(object.matrixWorld);
      _mat.decompose(_v1, _q, _scale);

      const sizeX = (bounds.max.x - bounds.min.x) * Math.abs(_scale.x);
      const sizeY = (bounds.max.y - bounds.min.y) * Math.abs(_scale.y);
      const sizeZ = (bounds.max.z - bounds.min.z) * Math.abs(_scale.z);
      if (sizeX * sizeY * sizeZ < minVolume) return;

      // Geometry-local centre through the full world matrix.
      _v2
        .set(
          (bounds.min.x + bounds.max.x) / 2,
          (bounds.min.y + bounds.max.y) / 2,
          (bounds.min.z + bounds.max.z) / 2,
        )
        .applyMatrix4(object.matrixWorld);

      const isInstanced = object instanceof THREE.InstancedMesh;
      if (isInstanced) {
        // Instanced clutter uses per-instance matrices; bake each instance.
        const instanced = object;
        const count = Math.min(instanced.count, maxColliders - added);
        for (let i = 0; i < count; i += 1) {
          instanced.getMatrixAt(i, _mat);
          _mat.premultiply(object.matrixWorld);
          _mat.decompose(_v3, _q, _scale);
          _v4
            .set(
              (bounds.min.x + bounds.max.x) / 2,
              (bounds.min.y + bounds.max.y) / 2,
              (bounds.min.z + bounds.max.z) / 2,
            )
            .applyMatrix4(_mat);
          const half = new THREE.Vector3(
            ((bounds.max.x - bounds.min.x) / 2) * Math.abs(_scale.x),
            ((bounds.max.y - bounds.min.y) / 2) * Math.abs(_scale.y),
            ((bounds.max.z - bounds.min.z) / 2) * Math.abs(_scale.z),
          );
          if (half.x * half.y * half.z * 8 < minVolume) continue;
          this.addStatic(makeCollider(_v4, half, _q, layer, classifySurface(instanced)));
          added += 1;
        }
        return;
      }

      const half = new THREE.Vector3(sizeX / 2, sizeY / 2, sizeZ / 2);
      this.addStatic(makeCollider(_v2, half, _q, layer, classifySurface(object)));
      added += 1;
    });
    return added;
  }

  /* ---------------------------------------------------------------- */
  /* Raycasting                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Nearest hit along a ray. `dir` must be normalised.
   * Static geometry uses the grid; dynamic colliders are tested linearly.
   */
  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    mask: number = MASK_SOLID,
    ignoreEntity: EntityId | null = null,
  ): RayHit | null {
    this.stamp += 1;
    const stamp = this.stamp;
    let best: RayHit | null = null;
    let bestT = maxDist;

    const consider = (c: Collider): void => {
      if ((c.layer & mask) === 0) return;
      if (ignoreEntity !== null && c.entityId === ignoreEntity) return;
      const lo = toLocal(c, origin, _v1);
      const ld = dirToLocal(c, dir, _v2);
      const slab = raySlab(lo, ld, c.halfExtents);
      if (!slab) return;
      const t = slab.tMin >= 0 ? slab.tMin : slab.tMax >= 0 ? 0 : -1;
      if (t < 0 || t >= bestT) return;
      bestT = t;
      const point = new THREE.Vector3().copy(dir).multiplyScalar(t).add(origin);
      const localNormal = new THREE.Vector3(
        slab.axis === 0 ? slab.sign : 0,
        slab.axis === 1 ? slab.sign : 0,
        slab.axis === 2 ? slab.sign : 0,
      );
      const normal = localToWorldDir(c, localNormal, new THREE.Vector3()).normalize();
      if (normal.dot(dir) > 0) normal.negate();
      best = {
        distance: t,
        point,
        normal,
        surface: c.surface,
        layer: c.layer,
        entityId: c.entityId,
        region: c.region,
        thicknessM: Math.max(0.01, slab.tMax - Math.max(0, slab.tMin)),
        colliderId: c.id,
      };
    };

    this.staticGrid.traverseRay(origin, dir, maxDist, this.stamps, stamp, (index) => {
      consider(this.staticGrid.at(index));
    });
    for (const c of this.dynamic) consider(c);

    // Analytic ground: march the heightfield. Cheaper and more accurate than
    // colliding against the terrain mesh's 500k triangles.
    const groundT = this.raycastGround(origin, dir, maxDist < bestT ? maxDist : bestT);
    if (groundT !== null && groundT < bestT) {
      const point = new THREE.Vector3().copy(dir).multiplyScalar(groundT).add(origin);
      return {
        distance: groundT,
        point,
        normal: this.groundNormal(point.x, point.z, new THREE.Vector3()),
        surface: this.groundSurfaceFn(point.x, point.z),
        layer: LAYER.world,
        entityId: null,
        region: null,
        thicknessM: 4,
        colliderId: 0,
      };
    }
    return best;
  }

  /** Convenience: is there clear line of sight between two points? */
  hasLineOfSight(
    from: THREE.Vector3,
    to: THREE.Vector3,
    mask: number = MASK_SOLID,
    ignoreEntity: EntityId | null = null,
  ): boolean {
    _v4.copy(to).sub(from);
    const dist = _v4.length();
    if (dist < 1e-4) return true;
    _v4.multiplyScalar(1 / dist);
    return this.raycast(from, _v4, dist - 0.05, mask, ignoreEntity) === null;
  }

  /** Ray/heightfield march with a bisection refine. Returns distance or null. */
  private raycastGround(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
  ): number | null {
    if (dir.y > 0 && origin.y > this.groundHeight(origin.x, origin.z) + 400) return null;
    const step = Math.max(0.35, maxDist / 512);
    let prevT = 0;
    let prevGap = origin.y - this.groundHeight(origin.x, origin.z);
    if (prevGap < 0) return 0;
    for (let t = step; t <= maxDist; t += Math.min(step * 1.35, 2.5)) {
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      const gap = y - this.groundHeight(x, z);
      if (gap <= 0) {
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 12; i += 1) {
          const mid = (lo + hi) / 2;
          const g =
            origin.y +
            dir.y * mid -
            this.groundHeight(origin.x + dir.x * mid, origin.z + dir.z * mid);
          if (g <= 0) hi = mid;
          else lo = mid;
        }
        return hi;
      }
      prevT = t;
      prevGap = gap;
    }
    return null;
  }

  /** Central-difference normal of the analytic heightfield. */
  groundNormal(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 0.6;
    const hL = this.groundHeight(x - e, z);
    const hR = this.groundHeight(x + e, z);
    const hD = this.groundHeight(x, z - e);
    const hU = this.groundHeight(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  /* ---------------------------------------------------------------- */
  /* Queries                                                           */
  /* ---------------------------------------------------------------- */

  /** Collect colliders whose AABB overlaps the given box. */
  queryAABB(min: THREE.Vector3, max: THREE.Vector3, out: Collider[]): Collider[] {
    out.length = 0;
    this.stamp += 1;
    this.scratchIndices.length = 0;
    this.staticGrid.queryBox(min, max, this.stamps, this.stamp, this.scratchIndices);
    for (const index of this.scratchIndices) out.push(this.staticGrid.at(index));
    for (const c of this.dynamic) {
      if (
        c.max.x >= min.x &&
        c.min.x <= max.x &&
        c.max.y >= min.y &&
        c.min.y <= max.y &&
        c.max.z >= min.z &&
        c.min.z <= max.z
      ) {
        out.push(c);
      }
    }
    return out;
  }

  /** True when a standing capsule at this position would be free of geometry. */
  isPositionFree(
    position: THREE.Vector3,
    radius: number,
    height: number,
    mask: number = MASK_MOVEMENT,
  ): boolean {
    const min = _v1.set(position.x - radius, position.y, position.z - radius);
    const max = _v2.set(position.x + radius, position.y + height, position.z + radius);
    const candidates: Collider[] = [];
    this.queryAABB(min, max, candidates);
    const bottom = _v3.set(position.x, position.y + radius, position.z);
    const top = _v4.set(position.x, position.y + height - radius, position.z);
    const point = new THREE.Vector3();
    for (const c of candidates) {
      if ((c.layer & mask) === 0) continue;
      if (capsuleColliderDepth(c, bottom, top, radius, point) > 0) return false;
    }
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Capsule movement                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Move a capsule with collide-and-slide, step-up and ground snapping.
   *
   * `position` is the capsule's feet. The capsule is `height` tall with
   * hemispherical caps of `radius`. Velocity is integrated by the caller;
   * this returns the resolved position and the velocity with blocked
   * components removed.
   */
  moveCapsule(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    radius: number,
    height: number,
    dt: number,
    stepHeight: number,
    maxSlope: number,
    wasGrounded: boolean,
  ): SweepResult {
    const result: SweepResult = {
      position: position.clone(),
      velocity: velocity.clone(),
      grounded: false,
      groundNormal: new THREE.Vector3(0, 1, 0),
      groundSurface: this.groundSurfaceFn(position.x, position.z),
      hitWall: false,
      impactSpeed: 0,
    };

    const displacement = _v1.copy(velocity).multiplyScalar(dt);
    // Substep so fast movement can't tunnel through a hangar wall.
    const maxStep = radius * 0.6;
    const steps = Math.min(8, Math.max(1, Math.ceil(displacement.length() / maxStep)));
    const sub = 1 / steps;

    const candidates: Collider[] = [];
    const contactPoint = new THREE.Vector3();
    const pushDir = new THREE.Vector3();
    const bottom = new THREE.Vector3();
    const top = new THREE.Vector3();
    const queryMin = new THREE.Vector3();
    const queryMax = new THREE.Vector3();

    for (let s = 0; s < steps; s += 1) {
      result.position.addScaledVector(velocity, dt * sub);

      // Analytic ground first — it is the dominant contact almost everywhere.
      const groundY = this.groundHeight(result.position.x, result.position.z);
      if (result.position.y <= groundY + 1e-3) {
        if (result.velocity.y < 0) {
          result.impactSpeed = Math.max(result.impactSpeed, -result.velocity.y);
          result.velocity.y = 0;
        }
        result.position.y = groundY;
        result.grounded = true;
        this.groundNormal(result.position.x, result.position.z, result.groundNormal);
        result.groundSurface = this.groundSurfaceFn(result.position.x, result.position.z);
      }

      // Broadphase around the capsule for this substep.
      const pad = radius + 0.6;
      queryMin.set(
        result.position.x - pad,
        result.position.y - 0.4,
        result.position.z - pad,
      );
      queryMax.set(
        result.position.x + pad,
        result.position.y + height + 0.4,
        result.position.z + pad,
      );
      this.queryAABB(queryMin, queryMax, candidates);
      if (candidates.length === 0) continue;

      // Depenetrate against each nearby box, a few relaxation passes so
      // corners and wedges settle instead of jittering.
      for (let pass = 0; pass < 3; pass += 1) {
        let anyContact = false;
        for (const c of candidates) {
          if ((c.layer & MASK_MOVEMENT) === 0) continue;
          bottom.set(result.position.x, result.position.y + radius, result.position.z);
          top.set(
            result.position.x,
            result.position.y + height - radius,
            result.position.z,
          );
          const depth = capsuleColliderDepth(c, bottom, top, radius, contactPoint);
          if (depth <= 0) continue;
          anyContact = true;

          // Push direction: from the contact point toward the capsule axis.
          const segT = closestPointOnSegmentT(bottom, top, contactPoint);
          pushDir.set(
            bottom.x + (top.x - bottom.x) * segT - contactPoint.x,
            bottom.y + (top.y - bottom.y) * segT - contactPoint.y,
            bottom.z + (top.z - bottom.z) * segT - contactPoint.z,
          );
          const len = pushDir.length();
          if (len < 1e-6) {
            pushDir.set(0, 1, 0);
          } else {
            pushDir.multiplyScalar(1 / len);
          }

          const slope = Math.acos(Math.min(1, Math.max(-1, pushDir.y)));
          const walkable = slope <= maxSlope;

          // Step-up: a low obstruction we could walk onto becomes a floor.
          if (!walkable && (wasGrounded || result.grounded)) {
            const topY = c.max.y;
            const rise = topY - result.position.y;
            if (rise > 0 && rise <= stepHeight) {
              const probe = _v3.set(result.position.x, topY + 0.02, result.position.z);
              if (this.isPositionFree(probe, radius * 0.92, height)) {
                result.position.y = topY + 0.01;
                if (result.velocity.y < 0) result.velocity.y = 0;
                result.grounded = true;
                result.groundNormal.set(0, 1, 0);
                result.groundSurface = c.surface;
                continue;
              }
            }
          }

          result.position.addScaledVector(pushDir, depth + 1e-3);

          const vn = result.velocity.dot(pushDir);
          if (vn < 0) {
            if (walkable) {
              result.impactSpeed = Math.max(result.impactSpeed, -vn);
              result.grounded = true;
              result.groundNormal.copy(pushDir);
              result.groundSurface = c.surface;
            } else if (Math.abs(pushDir.y) < 0.6) {
              result.hitWall = true;
            }
            result.velocity.addScaledVector(pushDir, -vn);
          }
        }
        if (!anyContact) break;
      }
    }

    // Ground snapping: stick to slopes and stair tops when walking downhill
    // instead of hopping off every lip.
    if (!result.grounded && wasGrounded && result.velocity.y <= 0.5) {
      const snap = stepHeight + 0.12;
      const down = _v3.set(0, -1, 0);
      const origin = _v4.set(
        result.position.x,
        result.position.y + 0.08,
        result.position.z,
      );
      const hit = this.raycast(origin, down, snap, MASK_MOVEMENT);
      if (hit && hit.normal.y >= Math.cos(maxSlope)) {
        result.position.y = hit.point.y;
        result.velocity.y = 0;
        result.grounded = true;
        result.groundNormal.copy(hit.normal);
        result.groundSurface = hit.surface;
      }
    }

    return result;
  }
}

/* ------------------------------------------------------------------ */
/* Capsule/OBB intersection                                            */
/* ------------------------------------------------------------------ */

function closestPointOnSegmentT(
  a: THREE.Vector3,
  b: THREE.Vector3,
  p: THREE.Vector3,
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const lenSq = abx * abx + aby * aby + abz * abz;
  if (lenSq < 1e-12) return 0;
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lenSq;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

const _cpA = new THREE.Vector3();
const _cpB = new THREE.Vector3();
const _cpC = new THREE.Vector3();

/**
 * Penetration depth of a capsule into an OBB, and the deepest contact point
 * on the box. Returns 0 when they are separate.
 *
 * Iterates closest-point-on-box / closest-point-on-segment, which converges in
 * two or three rounds for the box-vs-capsule case and avoids a full GJK/EPA.
 */
export function capsuleColliderDepth(
  c: Collider,
  bottom: THREE.Vector3,
  top: THREE.Vector3,
  radius: number,
  outPoint: THREE.Vector3,
): number {
  // Cheap AABB reject.
  const minX = Math.min(bottom.x, top.x) - radius;
  const maxX = Math.max(bottom.x, top.x) + radius;
  const minY = Math.min(bottom.y, top.y) - radius;
  const maxY = Math.max(bottom.y, top.y) + radius;
  const minZ = Math.min(bottom.z, top.z) - radius;
  const maxZ = Math.max(bottom.z, top.z) + radius;
  if (
    c.max.x < minX ||
    c.min.x > maxX ||
    c.max.y < minY ||
    c.min.y > maxY ||
    c.max.z < minZ ||
    c.min.z > maxZ
  ) {
    return 0;
  }

  _cpA.copy(bottom).lerp(top, 0.5);
  for (let i = 0; i < 4; i += 1) {
    closestPointOnCollider(c, _cpA, _cpB);
    const t = closestPointOnSegmentT(bottom, top, _cpB);
    _cpC.copy(bottom).lerp(top, t);
    if (_cpC.distanceToSquared(_cpA) < 1e-8) {
      _cpA.copy(_cpC);
      break;
    }
    _cpA.copy(_cpC);
  }
  closestPointOnCollider(c, _cpA, _cpB);
  outPoint.copy(_cpB);
  const dist = _cpA.distanceTo(_cpB);
  if (dist >= radius) return 0;

  if (dist > 1e-5) return radius - dist;

  // Axis centre is inside the box: push out along the shallowest face.
  const l = toLocal(c, _cpA, _cpC);
  const h = c.halfExtents;
  const dx = h.x - Math.abs(l.x);
  const dy = h.y - Math.abs(l.y);
  const dz = h.z - Math.abs(l.z);
  if (dx <= dy && dx <= dz) {
    outPoint.copy(_cpA).addScaledVector(c.axisX, Math.sign(l.x) * dx);
    return radius + dx;
  }
  if (dy <= dz) {
    outPoint.copy(_cpA).addScaledVector(c.axisY, Math.sign(l.y) * dy);
    return radius + dy;
  }
  outPoint.copy(_cpA).addScaledVector(c.axisZ, Math.sign(l.z) * dz);
  return radius + dz;
}
