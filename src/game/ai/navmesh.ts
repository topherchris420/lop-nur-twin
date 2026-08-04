import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import { HUMAN_METRICS, MASK_MOVEMENT, MASK_SIGHT } from "../core/types";
import type { Collider, CollisionWorld } from "../physics/collisionWorld";

/**
 * Navigation grid for the combat area.
 *
 * A full navmesh (convex polygon decomposition) is the "right" answer for
 * arbitrary geometry, but this map is a compound of boxes standing on an
 * almost-flat lakebed: a uniform grid is a better fit, is trivially
 * deterministic, and gives us three fields that AI actually needs and a
 * polygon mesh does not carry for free:
 *
 *  - **an 8-bin directional cover mask** — for each cell, which of the eight
 *    compass directions has geometry within `coverRadius` that would stop a
 *    chest-height shot coming from there, where that geometry is also at least
 *    crouch height (so it is a wall or a crate, not a floating pipe);
 *  - **an exposure field** — how many of N sparsely scattered observer
 *    positions can see the cell. Low exposure means "you can move here without
 *    the whole map watching", which is exactly what a flank route wants;
 *  - **a per-cell link mask** — the 8 neighbours that are actually reachable
 *    (walkable, within `stepHeight`, no diagonal corner cutting), so A* never
 *    re-derives connectivity.
 *
 * Everything lives in flat typed arrays: 8 bytes per cell (1 flags, 4 height,
 * 1 cover, 1 exposure, 1 links). A 440 m square at 0.75 m is ~344 k cells,
 * about 2.8 MB, and builds in well under the frame-budget target.
 *
 * Determinism: the only randomness is the exposure observer scatter, which
 * runs through `mulberry32`.
 *
 * Known limitation (reported, not worked around): the grid is single-layer.
 * Floor height is the analytic terrain height, and geometry shorter than
 * `HUMAN_METRICS.stepHeight` is ignored rather than treated as a platform, so
 * rooftops and catwalks are not navigable. Multi-level navigation needs either
 * a layered grid or a real navmesh; neither is in scope here.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Neighbour offsets, ordered so `atan2(dz, dx) / (PI/4)` indexes them. */
export const NAV_DIR_X: readonly number[] = [1, 1, 0, -1, -1, -1, 0, 1];
export const NAV_DIR_Z: readonly number[] = [0, 1, 1, 1, 0, -1, -1, -1];

/** Bit meanings in `NavGrid.flags`. */
export const NAV_FLAG = {
  walkable: 1 << 0,
  /** Geometry stands somewhere in this cell's body column. */
  nearGeometry: 1 << 1,
  /** Ground slope exceeds `HUMAN_METRICS.maxSlope`. */
  steep: 1 << 2,
  /** At least one 8-neighbour is unwalkable — a wall edge or a drop. */
  edge: 1 << 3,
  /** Cover is available from at least one direction. */
  cover: 1 << 4,
} as const;

/** Vertical bands, in metres above the cell floor. */
const BAND = {
  /** Bottom of the movement test: anything lower is a step, not a wall. */
  moveLow: HUMAN_METRICS.stepHeight + 0.02,
  moveMid: 0.95,
  moveHigh: 1.4,
  moveTop: HUMAN_METRICS.colliderHeight.stand - 0.02,
  /** "Crouch height or taller" band used to qualify cover. */
  coverLow: 0.5,
  coverChest: 0.95,
  coverChestTop: 1.35,
} as const;

const BAND_BIT = {
  moveLow: 1 << 0,
  moveMid: 1 << 1,
  moveHigh: 1 << 2,
  sightLow: 1 << 3,
  sightChest: 1 << 4,
  occupied: 1 << 5,
} as const;

const BAND_MOVE_ANY = BAND_BIT.moveLow | BAND_BIT.moveMid | BAND_BIT.moveHigh;

const nowMs = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

export interface NavGridOptions {
  /** Centre of the combat area, world `[x, z]` metres. */
  center: readonly [number, number];
  /** Half-width of the square combat area, in metres. */
  halfExtent: number;
  /** Cell size in metres. Default 0.75. */
  cellSize?: number;
  /**
   * The analytic ground is sampled every `heightStride` cells and bilinearly
   * interpolated between samples. The terrain's finest feature is ~46 m, so
   * 1.5 m sampling is exact for anything the AI cares about and cuts the
   * dominant build cost by four.
   */
  heightStride?: number;
  /** Side of an exposure cell, in metres. Default 3. */
  exposureCellSize?: number;
  /** Observer positions used to build the exposure field. Default 64. */
  exposureSamples?: number;
  /** Deterministic seed for the observer scatter. */
  seed?: number;
  /** How far cover may stand from a cell to count, in metres. Default 1.2. */
  coverRadius?: number;
}

interface ResolvedOptions {
  center: readonly [number, number];
  halfExtent: number;
  cellSize: number;
  heightStride: number;
  exposureCellSize: number;
  exposureSamples: number;
  seed: number;
  coverRadius: number;
}

function resolveOptions(options: NavGridOptions): ResolvedOptions {
  return {
    center: options.center,
    halfExtent: options.halfExtent,
    cellSize: options.cellSize ?? 0.75,
    heightStride: Math.max(1, Math.floor(options.heightStride ?? 2)),
    exposureCellSize: options.exposureCellSize ?? 3,
    exposureSamples: Math.max(1, Math.floor(options.exposureSamples ?? 64)),
    seed: options.seed ?? 0x5eed_1a7,
    coverRadius: options.coverRadius ?? 1.2,
  };
}

/* ------------------------------------------------------------------ */
/* The grid                                                            */
/* ------------------------------------------------------------------ */

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly invCellSize: number;
  /** World position of the centre of cell (0, 0). */
  readonly minX: number;
  readonly minZ: number;
  readonly flags: Uint8Array;
  readonly heights: Float32Array;
  /** Bit `d` set when direction `d` offers cover. */
  readonly cover: Uint8Array;
  /** Observers that can see the cell, 0..`exposureSamples`. */
  readonly exposure: Uint8Array;
  /** Bit `d` set when the neighbour in direction `d` is reachable. */
  readonly links: Uint8Array;
  readonly exposureSamples: number;
  /** `CollisionWorld.version` the grid was built against. */
  readonly worldVersion: number;
  /** Milliseconds the build took, for the perf report. */
  readonly buildMs: number;
  readonly walkableCells: number;

  constructor(init: {
    cols: number;
    rows: number;
    cellSize: number;
    minX: number;
    minZ: number;
    flags: Uint8Array;
    heights: Float32Array;
    cover: Uint8Array;
    exposure: Uint8Array;
    links: Uint8Array;
    exposureSamples: number;
    worldVersion: number;
    buildMs: number;
    walkableCells: number;
  }) {
    this.cols = init.cols;
    this.rows = init.rows;
    this.cellSize = init.cellSize;
    this.invCellSize = 1 / init.cellSize;
    this.minX = init.minX;
    this.minZ = init.minZ;
    this.flags = init.flags;
    this.heights = init.heights;
    this.cover = init.cover;
    this.exposure = init.exposure;
    this.links = init.links;
    this.exposureSamples = init.exposureSamples;
    this.worldVersion = init.worldVersion;
    this.buildMs = init.buildMs;
    this.walkableCells = init.walkableCells;
  }

  get cellCount(): number {
    return this.cols * this.rows;
  }

  /* ------------------------------------------------------ addressing */

  index(cx: number, cz: number): number {
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return -1;
    return cz * this.cols + cx;
  }

  cellX(index: number): number {
    return index % this.cols;
  }

  cellZ(index: number): number {
    return (index / this.cols) | 0;
  }

  /** Linear cell index for a world position, or -1 when outside the grid. */
  worldToCell(x: number, z: number): number {
    const cx = Math.round((x - this.minX) * this.invCellSize);
    const cz = Math.round((z - this.minZ) * this.invCellSize);
    return this.index(cx, cz);
  }

  /** Like `worldToCell` but clamps to the border instead of failing. */
  clampToCell(x: number, z: number): number {
    let cx = Math.round((x - this.minX) * this.invCellSize);
    let cz = Math.round((z - this.minZ) * this.invCellSize);
    cx = cx < 0 ? 0 : cx >= this.cols ? this.cols - 1 : cx;
    cz = cz < 0 ? 0 : cz >= this.rows ? this.rows - 1 : cz;
    return cz * this.cols + cx;
  }

  contains(x: number, z: number): boolean {
    return this.worldToCell(x, z) >= 0;
  }

  /** Cell centre in world space, `y` at the floor. */
  cellToWorld(index: number, out: THREE.Vector3): THREE.Vector3 {
    const cx = index % this.cols;
    const cz = (index / this.cols) | 0;
    return out.set(
      this.minX + cx * this.cellSize,
      this.heights[index] ?? 0,
      this.minZ + cz * this.cellSize,
    );
  }

  cellCenterX(index: number): number {
    return this.minX + (index % this.cols) * this.cellSize;
  }

  cellCenterZ(index: number): number {
    return this.minZ + ((index / this.cols) | 0) * this.cellSize;
  }

  /* --------------------------------------------------------- queries */

  isWalkable(index: number): boolean {
    if (index < 0 || index >= this.flags.length) return false;
    return (this.flags[index]! & NAV_FLAG.walkable) !== 0;
  }

  isWalkableAt(x: number, z: number): boolean {
    return this.isWalkable(this.worldToCell(x, z));
  }

  /** Floor height at a world position; falls back to 0 outside the grid. */
  heightAt(x: number, z: number): number {
    const index = this.clampToCell(x, z);
    return this.heights[index] ?? 0;
  }

  linkMask(index: number): number {
    return index >= 0 ? (this.links[index] ?? 0) : 0;
  }

  coverMask(index: number): number {
    return index >= 0 ? (this.cover[index] ?? 0) : 0;
  }

  /** Exposure normalised to 0..1. */
  exposureAt(index: number): number {
    if (index < 0) return 1;
    return (this.exposure[index] ?? 0) / 255;
  }

  /** Direction bin for a world-space direction. */
  static directionBin(dx: number, dz: number): number {
    const a = Math.atan2(dz, dx) / (Math.PI / 4);
    return ((Math.round(a) % 8) + 8) % 8;
  }

  /**
   * True when the cell has cover against fire arriving from `(dx, dz)`
   * (a vector pointing *from* the cell *toward* the threat).
   */
  hasCoverFrom(index: number, dx: number, dz: number): boolean {
    const mask = this.coverMask(index);
    if (mask === 0) return false;
    return (mask & (1 << NavGrid.directionBin(dx, dz))) !== 0;
  }

  /**
   * How well `index` is covered against a threat in direction `(dx, dz)`:
   * 1 for the exact bin, 0.55 for each adjacent bin, 0 otherwise. The blend
   * stops cover scoring from flickering as a target strafes across a bin edge.
   */
  coverQuality(index: number, dx: number, dz: number): number {
    const mask = this.coverMask(index);
    if (mask === 0) return 0;
    const bin = NavGrid.directionBin(dx, dz);
    let quality = (mask & (1 << bin)) !== 0 ? 1 : 0;
    const left = (mask & (1 << ((bin + 7) & 7))) !== 0 ? 0.55 : 0;
    const right = (mask & (1 << ((bin + 1) & 7))) !== 0 ? 0.55 : 0;
    quality = Math.max(quality, left, right);
    return quality;
  }

  /**
   * Nearest walkable cell to a world position, searched outward in square
   * rings. Returns -1 when nothing walkable is within `maxRadiusM`.
   */
  nearestWalkable(x: number, z: number, maxRadiusM = 14): number {
    const start = this.clampToCell(x, z);
    if (this.isWalkable(start) && this.contains(x, z)) return start;
    const cx0 = start % this.cols;
    const cz0 = (start / this.cols) | 0;
    const maxRing = Math.max(1, Math.ceil(maxRadiusM * this.invCellSize));
    let best = -1;
    let bestD2 = Infinity;
    for (let r = 1; r <= maxRing; r += 1) {
      for (let d = -r; d <= r; d += 1) {
        for (let side = 0; side < 4; side += 1) {
          const cx = side < 2 ? cx0 + d : cx0 + (side === 2 ? -r : r);
          const cz = side < 2 ? cz0 + (side === 0 ? -r : r) : cz0 + d;
          const index = this.index(cx, cz);
          if (index < 0 || (this.flags[index]! & NAV_FLAG.walkable) === 0) continue;
          const ddx = cx - cx0;
          const ddz = cz - cz0;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = index;
          }
        }
      }
      // The ring is square, so a hit at ring r can still be beaten by a
      // diagonal hit at ring r; one extra ring settles it.
      if (best >= 0 && bestD2 <= r * r) return best;
    }
    return best;
  }
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

type BuildPhase =
  | "collect"
  | "ground"
  | "raster"
  | "dilate"
  | "walkable"
  | "links"
  | "cover"
  | "exposure"
  | "done";

const PHASE_ORDER: readonly BuildPhase[] = [
  "collect",
  "ground",
  "raster",
  "dilate",
  "walkable",
  "links",
  "cover",
  "exposure",
  "done",
];

/** Exact XZ projection of an oriented box: a centrally symmetric hexagon. */
interface ProjectedBox {
  cx: number;
  cz: number;
  minY: number;
  maxY: number;
  /** Up to three separating axes with their support radii. */
  nx: Float64Array;
  nz: Float64Array;
  nr: Float64Array;
  axes: number;
  minXWorld: number;
  maxXWorld: number;
  minZWorld: number;
  maxZWorld: number;
  moves: boolean;
  blocksSight: boolean;
}

/**
 * Project an OBB onto the XZ plane exactly.
 *
 * The projection of a box is the Minkowski sum of its three (projected) axis
 * segments: a zonogon. A point is inside iff, for the normal of every
 * generator, its signed offset from the centre is within the summed support of
 * all three generators. That is three dot products per cell — cheap enough to
 * rasterise thousands of colliders — and, unlike an AABB footprint, it does not
 * over-block the corners of the compound's 44°-rotated buildings.
 */
function projectBox(c: Collider): ProjectedBox {
  const gx = [
    c.axisX.x * c.halfExtents.x,
    c.axisY.x * c.halfExtents.y,
    c.axisZ.x * c.halfExtents.z,
  ];
  const gz = [
    c.axisX.z * c.halfExtents.x,
    c.axisY.z * c.halfExtents.y,
    c.axisZ.z * c.halfExtents.z,
  ];
  const nx = new Float64Array(3);
  const nz = new Float64Array(3);
  const nr = new Float64Array(3);
  let axes = 0;
  for (let i = 0; i < 3; i += 1) {
    const len = Math.hypot(gx[i]!, gz[i]!);
    if (len < 1e-6) continue;
    // Normal of generator i.
    const ax = -gz[i]! / len;
    const az = gx[i]! / len;
    let support = 0;
    for (let j = 0; j < 3; j += 1) support += Math.abs(gx[j]! * ax + gz[j]! * az);
    nx[axes] = ax;
    nz[axes] = az;
    nr[axes] = support;
    axes += 1;
  }
  return {
    cx: c.center.x,
    cz: c.center.z,
    minY: c.min.y,
    maxY: c.max.y,
    nx,
    nz,
    nr,
    axes,
    minXWorld: c.min.x,
    maxXWorld: c.max.x,
    minZWorld: c.min.z,
    maxZWorld: c.max.z,
    moves: (c.layer & MASK_MOVEMENT) !== 0,
    blocksSight: (c.layer & MASK_SIGHT) !== 0,
  };
}

function insideProjection(box: ProjectedBox, x: number, z: number): boolean {
  const dx = x - box.cx;
  const dz = z - box.cz;
  for (let i = 0; i < box.axes; i += 1) {
    const d = dx * box.nx[i]! + dz * box.nz[i]!;
    if (d > box.nr[i]! || d < -box.nr[i]!) return false;
  }
  return true;
}

/**
 * Time-sliceable nav grid build.
 *
 * `step(budgetMs)` advances phases until the budget runs out and returns true
 * once every phase is finished. Both the blocking and the generator entry
 * points drive this same object, so there is exactly one implementation.
 */
export class NavGridBuilder {
  private readonly world: CollisionWorld;
  private readonly options: ResolvedOptions;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellSize: number;
  private readonly minX: number;
  private readonly minZ: number;

  private readonly flags: Uint8Array;
  private readonly heights: Float32Array;
  private readonly cover: Uint8Array;
  private readonly exposure: Uint8Array;
  private readonly links: Uint8Array;
  private bands: Uint8Array;

  /** Coarse exposure lattice. */
  private readonly exCols: number;
  private readonly exRows: number;
  private readonly exBlock: Uint8Array;
  private readonly exVisible: Uint8Array;
  private readonly exCount: Uint16Array;
  private readonly exStride: number;
  private readonly samples: Int32Array;
  private sampleCount = 0;

  private boxes: ProjectedBox[] = [];
  private phaseIndex = 0;
  private cursor = 0;
  private walkableCells = 0;
  private startedAt = 0;
  private elapsedMs = 0;
  private result: NavGrid | null = null;

  constructor(world: CollisionWorld, options: NavGridOptions) {
    this.world = world;
    this.options = resolveOptions(options);
    const o = this.options;
    this.cellSize = o.cellSize;
    const span = Math.max(4, o.halfExtent * 2);
    this.cols = Math.max(2, Math.round(span / o.cellSize) + 1);
    this.rows = this.cols;
    this.minX = o.center[0] - o.halfExtent;
    this.minZ = o.center[1] - o.halfExtent;

    const count = this.cols * this.rows;
    this.flags = new Uint8Array(count);
    this.heights = new Float32Array(count);
    this.cover = new Uint8Array(count);
    this.exposure = new Uint8Array(count);
    this.links = new Uint8Array(count);
    this.bands = new Uint8Array(count);

    this.exStride = Math.max(1, Math.round(o.exposureCellSize / o.cellSize));
    this.exCols = Math.ceil(this.cols / this.exStride);
    this.exRows = Math.ceil(this.rows / this.exStride);
    this.exBlock = new Uint8Array(this.exCols * this.exRows);
    this.exVisible = new Uint8Array(this.exCols * this.exRows);
    this.exCount = new Uint16Array(this.exCols * this.exRows);
    this.samples = new Int32Array(o.exposureSamples);
  }

  get phase(): BuildPhase {
    return PHASE_ORDER[this.phaseIndex] ?? "done";
  }

  /** 0..1 across the whole build, for a loading bar. */
  get progress(): number {
    const per = 1 / (PHASE_ORDER.length - 1);
    const total = this.phaseTotal();
    const within = total > 0 ? Math.min(1, this.cursor / total) : 1;
    return Math.min(1, this.phaseIndex * per + within * per);
  }

  private phaseTotal(): number {
    switch (this.phase) {
      case "collect":
        return 1;
      case "ground":
      case "walkable":
      case "links":
      case "cover":
        return this.rows;
      case "raster":
        return this.boxes.length;
      case "dilate":
        return this.rows;
      case "exposure":
        return this.options.exposureSamples;
      default:
        return 1;
    }
  }

  /** Advance the build. Returns true when finished. */
  step(budgetMs: number): boolean {
    if (this.phaseIndex >= PHASE_ORDER.length - 1) return true;
    if (this.startedAt === 0) this.startedAt = nowMs();
    const deadline = nowMs() + budgetMs;
    do {
      switch (this.phase) {
        case "collect":
          this.doCollect();
          break;
        case "ground":
          this.doGround(deadline);
          break;
        case "raster":
          this.doRaster(deadline);
          break;
        case "dilate":
          this.doDilate(deadline);
          break;
        case "walkable":
          this.doWalkable(deadline);
          break;
        case "links":
          this.doLinks(deadline);
          break;
        case "cover":
          this.doCover(deadline);
          break;
        case "exposure":
          this.doExposure(deadline);
          break;
        default:
          break;
      }
      if (this.cursor >= this.phaseTotal()) {
        this.phaseIndex += 1;
        this.cursor = 0;
        if (this.phaseIndex >= PHASE_ORDER.length - 1) {
          this.elapsedMs = nowMs() - this.startedAt;
          return true;
        }
      }
    } while (nowMs() < deadline);
    return false;
  }

  /** The finished grid. Throws when the build has not completed. */
  finish(): NavGrid {
    if (this.result) return this.result;
    if (this.phaseIndex < PHASE_ORDER.length - 1) {
      throw new Error("nav grid build is not finished");
    }
    // Normalise exposure to 0..255 and release the scratch bands.
    const samples = Math.max(1, this.sampleCount);
    for (let i = 0; i < this.exposure.length; i += 1) {
      this.exposure[i] = Math.min(255, Math.round((this.exposure[i]! / samples) * 255));
    }
    this.bands = new Uint8Array(0);
    this.boxes = [];
    this.result = new NavGrid({
      cols: this.cols,
      rows: this.rows,
      cellSize: this.cellSize,
      minX: this.minX,
      minZ: this.minZ,
      flags: this.flags,
      heights: this.heights,
      cover: this.cover,
      exposure: this.exposure,
      links: this.links,
      exposureSamples: samples,
      worldVersion: this.world.version,
      buildMs: this.elapsedMs,
      walkableCells: this.walkableCells,
    });
    return this.result;
  }

  /* ------------------------------------------------------- phase 0 */

  private doCollect(): void {
    const pad = 4;
    const min = new THREE.Vector3(this.minX - pad, -500, this.minZ - pad);
    const max = new THREE.Vector3(
      this.minX + (this.cols - 1) * this.cellSize + pad,
      2000,
      this.minZ + (this.rows - 1) * this.cellSize + pad,
    );
    const colliders: Collider[] = [];
    this.world.queryAABB(min, max, colliders);
    const boxes: ProjectedBox[] = [];
    for (const c of colliders) {
      if ((c.layer & (MASK_MOVEMENT | MASK_SIGHT)) === 0) continue;
      // Character hitboxes and other dynamic bodies are not terrain.
      if (c.entityId !== null) continue;
      boxes.push(projectBox(c));
    }
    this.boxes = boxes;
    this.cursor = 1;
  }

  /* ------------------------------------------------------- phase 1 */

  /**
   * Sample the analytic ground on a coarse lattice and bilinearly interpolate.
   * `terrainHeight` is the single most expensive call in the build (four
   * simplex octaves plus a flatten query per sample), and the terrain's finest
   * feature is ~46 m across, so striding is free accuracy-wise.
   */
  private doGround(deadline: number): void {
    const stride = this.options.heightStride;
    const world = this.world;
    while (this.cursor < this.rows) {
      const cz = this.cursor;
      const z = this.minZ + cz * this.cellSize;
      const rowBase = cz * this.cols;
      if (stride === 1) {
        for (let cx = 0; cx < this.cols; cx += 1) {
          this.heights[rowBase + cx] = world.groundAt(this.minX + cx * this.cellSize, z);
        }
      } else {
        // Sample the row on the lattice, then fill between the anchors.
        let prevX = 0;
        let prevH = world.groundAt(this.minX, z);
        this.heights[rowBase] = prevH;
        for (let cx = stride; ; cx += stride) {
          const clamped = Math.min(cx, this.cols - 1);
          const h = world.groundAt(this.minX + clamped * this.cellSize, z);
          const span = clamped - prevX;
          for (let k = 1; k <= span; k += 1) {
            this.heights[rowBase + prevX + k] = prevH + ((h - prevH) * k) / span;
          }
          prevX = clamped;
          prevH = h;
          if (clamped >= this.cols - 1) break;
        }
      }
      this.cursor += 1;
      if ((cz & 15) === 0 && nowMs() >= deadline) return;
    }
  }

  /* ------------------------------------------------------- phase 2 */

  private doRaster(deadline: number): void {
    const cell = this.cellSize;
    const inv = 1 / cell;
    while (this.cursor < this.boxes.length) {
      const box = this.boxes[this.cursor]!;
      this.cursor += 1;
      const x0 = Math.max(0, Math.floor((box.minXWorld - this.minX) * inv));
      const x1 = Math.min(this.cols - 1, Math.ceil((box.maxXWorld - this.minX) * inv));
      const z0 = Math.max(0, Math.floor((box.minZWorld - this.minZ) * inv));
      const z1 = Math.min(this.rows - 1, Math.ceil((box.maxZWorld - this.minZ) * inv));
      if (x1 < x0 || z1 < z0) continue;
      for (let cz = z0; cz <= z1; cz += 1) {
        const z = this.minZ + cz * cell;
        const rowBase = cz * this.cols;
        for (let cx = x0; cx <= x1; cx += 1) {
          const x = this.minX + cx * cell;
          if (!insideProjection(box, x, z)) continue;
          const index = rowBase + cx;
          const floor = this.heights[index]!;
          const lo = box.minY;
          const hi = box.maxY;
          if (hi <= floor + 0.05 || lo >= floor + 2.4) continue;
          let bits = BAND_BIT.occupied;
          if (box.moves) {
            if (hi > floor + BAND.moveLow && lo < floor + BAND.moveMid) bits |= BAND_BIT.moveLow;
            if (hi > floor + BAND.moveMid && lo < floor + BAND.moveHigh) bits |= BAND_BIT.moveMid;
            if (hi > floor + BAND.moveHigh && lo < floor + BAND.moveTop) bits |= BAND_BIT.moveHigh;
          }
          if (box.blocksSight) {
            if (hi > floor + BAND.coverLow && lo < floor + BAND.coverChest) {
              bits |= BAND_BIT.sightLow;
            }
            if (hi > floor + BAND.coverChest && lo < floor + BAND.coverChestTop) {
              bits |= BAND_BIT.sightChest;
            }
          }
          this.bands[index] = this.bands[index]! | bits;
        }
      }
      if ((this.cursor & 63) === 0 && nowMs() >= deadline) return;
    }
  }

  /* ------------------------------------------------------- phase 3 */

  /**
   * Mark every cell whose capsule could touch geometry. Only those cells pay
   * for a `world.isPositionFree` confirmation in the next phase; open desert
   * is provably free and is skipped.
   */
  private doDilate(deadline: number): void {
    const reach = Math.ceil((HUMAN_METRICS.radius + 0.12) / this.cellSize);
    while (this.cursor < this.rows) {
      const cz = this.cursor;
      this.cursor += 1;
      const rowBase = cz * this.cols;
      for (let cx = 0; cx < this.cols; cx += 1) {
        const index = rowBase + cx;
        if ((this.bands[index]! & BAND_BIT.occupied) === 0) continue;
        for (let dz = -reach; dz <= reach; dz += 1) {
          const nz = cz + dz;
          if (nz < 0 || nz >= this.rows) continue;
          const nBase = nz * this.cols;
          for (let dx = -reach; dx <= reach; dx += 1) {
            const nx = cx + dx;
            if (nx < 0 || nx >= this.cols) continue;
            this.flags[nBase + nx] = this.flags[nBase + nx]! | NAV_FLAG.nearGeometry;
          }
        }
      }
      if ((cz & 15) === 0 && nowMs() >= deadline) return;
    }
  }

  /* ------------------------------------------------------- phase 4 */

  private doWalkable(deadline: number): void {
    const maxSlopeCos = Math.cos(HUMAN_METRICS.maxSlope);
    const radius = HUMAN_METRICS.radius;
    const standHeight = HUMAN_METRICS.colliderHeight.stand;
    const probe = new THREE.Vector3();
    const cell = this.cellSize;
    while (this.cursor < this.rows) {
      const cz = this.cursor;
      this.cursor += 1;
      const rowBase = cz * this.cols;
      for (let cx = 0; cx < this.cols; cx += 1) {
        const index = rowBase + cx;
        const bands = this.bands[index]!;
        if ((bands & BAND_MOVE_ANY) !== 0) continue;

        // Slope from the height field's central differences. `2 * cell` is the
        // baseline, and the normal is (hL - hR, 2 * cell, hD - hU) normalised.
        const xm = cx > 0 ? this.heights[index - 1]! : this.heights[index]!;
        const xp = cx < this.cols - 1 ? this.heights[index + 1]! : this.heights[index]!;
        const zm = cz > 0 ? this.heights[index - this.cols]! : this.heights[index]!;
        const zp = cz < this.rows - 1 ? this.heights[index + this.cols]! : this.heights[index]!;
        const dx = xm - xp;
        const dz = zm - zp;
        const denom = Math.hypot(dx, 2 * cell, dz);
        const normalY = denom > 0 ? (2 * cell) / denom : 1;
        if (normalY < maxSlopeCos) {
          this.flags[index] = this.flags[index]! | NAV_FLAG.steep;
          continue;
        }

        if ((this.flags[index]! & NAV_FLAG.nearGeometry) !== 0) {
          probe.set(
            this.minX + cx * cell,
            this.heights[index]! + 0.02,
            this.minZ + cz * cell,
          );
          if (!this.world.isPositionFree(probe, radius, standHeight)) continue;
        }

        this.flags[index] = this.flags[index]! | NAV_FLAG.walkable;
        this.walkableCells += 1;
      }
      if ((cz & 15) === 0 && nowMs() >= deadline) return;
    }
  }

  /* ------------------------------------------------------- phase 5 */

  /**
   * Connectivity. A link exists when the neighbour is walkable and the floor
   * step is inside `HUMAN_METRICS.stepHeight`; diagonals additionally need both
   * shared cardinals so nobody squeezes through a corner. A walkable cell with
   * no links at all is an island and stops being walkable.
   */
  private doLinks(deadline: number): void {
    const step = HUMAN_METRICS.stepHeight;
    while (this.cursor < this.rows) {
      const cz = this.cursor;
      this.cursor += 1;
      const rowBase = cz * this.cols;
      for (let cx = 0; cx < this.cols; cx += 1) {
        const index = rowBase + cx;
        if ((this.flags[index]! & NAV_FLAG.walkable) === 0) continue;
        const h = this.heights[index]!;
        let mask = 0;
        let open = 0;
        for (let d = 0; d < 8; d += 1) {
          const nx = cx + NAV_DIR_X[d]!;
          const nz = cz + NAV_DIR_Z[d]!;
          if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
          const n = nz * this.cols + nx;
          if ((this.flags[n]! & NAV_FLAG.walkable) === 0) continue;
          if (Math.abs(this.heights[n]! - h) > step) continue;
          if ((d & 1) === 1) {
            const a = this.index(cx + NAV_DIR_X[d]!, cz);
            const b = this.index(cx, cz + NAV_DIR_Z[d]!);
            if (a < 0 || b < 0) continue;
            if ((this.flags[a]! & NAV_FLAG.walkable) === 0) continue;
            if ((this.flags[b]! & NAV_FLAG.walkable) === 0) continue;
          }
          mask |= 1 << d;
          open += 1;
        }
        this.links[index] = mask;
        if (open === 0) {
          this.flags[index] = this.flags[index]! & ~NAV_FLAG.walkable;
          this.walkableCells -= 1;
        } else if (open < 8) {
          this.flags[index] = this.flags[index]! | NAV_FLAG.edge;
        }
      }
      if ((cz & 15) === 0 && nowMs() >= deadline) return;
    }
  }

  /* ------------------------------------------------------- phase 6 */

  /**
   * Directional cover. For each walkable cell and each of the eight compass
   * directions, walk outward up to `coverRadius` and look for a cell whose
   * geometry both stops a chest-height shot and reaches at least crouch height.
   */
  private doCover(deadline: number): void {
    const reach = Math.max(1, Math.floor(this.options.coverRadius / this.cellSize + 1e-6));
    const need = BAND_BIT.sightLow | BAND_BIT.sightChest;
    while (this.cursor < this.rows) {
      const cz = this.cursor;
      this.cursor += 1;
      const rowBase = cz * this.cols;
      for (let cx = 0; cx < this.cols; cx += 1) {
        const index = rowBase + cx;
        if ((this.flags[index]! & NAV_FLAG.walkable) === 0) continue;
        let mask = 0;
        for (let d = 0; d < 8; d += 1) {
          const stepX = NAV_DIR_X[d]!;
          const stepZ = NAV_DIR_Z[d]!;
          // Diagonal cells are `cellSize * sqrt(2)` apart, so they reach the
          // probe radius one step sooner.
          const limit = (d & 1) === 1
            ? Math.max(1, Math.floor(this.options.coverRadius / (this.cellSize * Math.SQRT2) + 1e-6))
            : reach;
          for (let s = 1; s <= limit; s += 1) {
            const nx = cx + stepX * s;
            const nz = cz + stepZ * s;
            if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) break;
            const n = nz * this.cols + nx;
            if ((this.bands[n]! & need) === need) {
              mask |= 1 << d;
              break;
            }
            // A clear walkable cell means the sightline is open past it.
            if ((this.bands[n]! & BAND_BIT.occupied) !== 0) break;
          }
        }
        this.cover[index] = mask;
        if (mask !== 0) this.flags[index] = this.flags[index]! | NAV_FLAG.cover;
      }
      if ((cz & 7) === 0 && nowMs() >= deadline) return;
    }
  }

  /* ------------------------------------------------------- phase 7 */

  /**
   * Exposure field.
   *
   * Raycasting every cell against every observer would be tens of millions of
   * rays. Instead the chest-height blocking mask is downsampled onto a coarse
   * lattice and each observer runs a single-pass shadow propagation over it:
   * cells are visited in order of increasing Chebyshev distance and a cell is
   * visible when the cell one step back along the line to the observer is both
   * visible and not blocking. The parent is always exactly one Chebyshev ring
   * closer, so a plain ring walk is a valid topological order — no sort, no
   * queue, O(cells) per observer.
   */
  private doExposure(deadline: number): void {
    if (this.cursor === 0) this.prepareExposure();
    while (this.cursor < this.sampleCount) {
      const cellIndex = this.samples[this.cursor]!;
      this.cursor += 1;
      this.castExposure(cellIndex);
      if (nowMs() >= deadline) break;
    }
    if (this.cursor >= this.sampleCount) {
      this.scatterExposure();
      this.cursor = this.options.exposureSamples;
    }
  }

  private prepareExposure(): void {
    // Downsample the chest-height sight blockers onto the coarse lattice.
    for (let cz = 0; cz < this.rows; cz += 1) {
      const ez = (cz / this.exStride) | 0;
      const rowBase = cz * this.cols;
      const eBase = ez * this.exCols;
      for (let cx = 0; cx < this.cols; cx += 1) {
        if ((this.bands[rowBase + cx]! & BAND_BIT.sightChest) === 0) continue;
        this.exBlock[eBase + ((cx / this.exStride) | 0)] = 1;
      }
    }

    // Scatter observers over the walkable area with a seeded jitter, then snap
    // each to the nearest walkable cell.
    const rand = mulberry32(this.options.seed >>> 0);
    const wanted = this.options.exposureSamples;
    const side = Math.max(1, Math.round(Math.sqrt(wanted)));
    let written = 0;
    for (let gy = 0; gy < side && written < wanted; gy += 1) {
      for (let gx = 0; gx < side && written < wanted; gx += 1) {
        const u = (gx + 0.15 + rand() * 0.7) / side;
        const v = (gy + 0.15 + rand() * 0.7) / side;
        const cx = Math.min(this.cols - 1, Math.floor(u * this.cols));
        const cz = Math.min(this.rows - 1, Math.floor(v * this.rows));
        const index = this.nearestWalkableCell(cx, cz, 24);
        if (index < 0) continue;
        this.samples[written] = index;
        written += 1;
      }
    }
    this.sampleCount = written;
    if (written === 0) {
      // Nothing walkable: leave exposure at zero rather than dividing by zero.
      this.sampleCount = 0;
    }
  }

  private nearestWalkableCell(cx0: number, cz0: number, maxRing: number): number {
    const start = this.index(cx0, cz0);
    if (start >= 0 && (this.flags[start]! & NAV_FLAG.walkable) !== 0) return start;
    for (let r = 1; r <= maxRing; r += 1) {
      for (let d = -r; d <= r; d += 1) {
        for (let side = 0; side < 4; side += 1) {
          const cx = side < 2 ? cx0 + d : cx0 + (side === 2 ? -r : r);
          const cz = side < 2 ? cz0 + (side === 0 ? -r : r) : cz0 + d;
          const index = this.index(cx, cz);
          if (index < 0) continue;
          if ((this.flags[index]! & NAV_FLAG.walkable) !== 0) return index;
        }
      }
    }
    return -1;
  }

  private castExposure(navCell: number): void {
    const sx = ((navCell % this.cols) / this.exStride) | 0;
    const sz = (((navCell / this.cols) | 0) / this.exStride) | 0;
    const vis = this.exVisible;
    vis.fill(0);
    const source = sz * this.exCols + sx;
    vis[source] = 1;
    this.exCount[source] = (this.exCount[source]! + 1) & 0xffff;

    const maxRing = Math.max(this.exCols, this.exRows);
    for (let r = 1; r <= maxRing; r += 1) {
      let touched = false;
      for (let d = -r; d <= r; d += 1) {
        for (let side = 0; side < 4; side += 1) {
          const dx = side < 2 ? d : side === 2 ? -r : r;
          const dz = side < 2 ? (side === 0 ? -r : r) : d;
          const ex = sx + dx;
          const ez = sz + dz;
          if (ex < 0 || ez < 0 || ex >= this.exCols || ez >= this.exRows) continue;
          touched = true;
          // Parent: one step back along the straight line to the observer.
          const m = r;
          const t = (m - 1) / m;
          const px = sx + Math.round(dx * t);
          const pz = sz + Math.round(dz * t);
          const parent = pz * this.exCols + px;
          if (vis[parent] === 0 || this.exBlock[parent] === 1) continue;
          const index = ez * this.exCols + ex;
          vis[index] = 1;
          this.exCount[index] = (this.exCount[index]! + 1) & 0xffff;
        }
      }
      if (!touched) break;
    }
  }

  /** Push the coarse observer counts back onto the nav cells. */
  private scatterExposure(): void {
    for (let cz = 0; cz < this.rows; cz += 1) {
      const ez = (cz / this.exStride) | 0;
      const rowBase = cz * this.cols;
      const eBase = ez * this.exCols;
      for (let cx = 0; cx < this.cols; cx += 1) {
        const value = this.exCount[eBase + ((cx / this.exStride) | 0)]!;
        this.exposure[rowBase + cx] = Math.min(255, value);
      }
    }
  }

  private index(cx: number, cz: number): number {
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return -1;
    return cz * this.cols + cx;
  }
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

/** Build the whole grid in one call. */
export function buildNavGrid(world: CollisionWorld, options: NavGridOptions): NavGrid {
  const builder = new NavGridBuilder(world, options);
  let guard = 0;
  while (!builder.step(Number.POSITIVE_INFINITY)) {
    if (guard++ > 1_000_000) throw new Error("nav grid build did not converge");
  }
  return builder.finish();
}

/**
 * Build the grid across several frames.
 *
 * ```ts
 * const job = buildNavGridIncremental(world, options, 4);
 * // in useFrame:
 * const next = job.next();
 * if (next.done) grid = next.value;
 * ```
 */
export function* buildNavGridIncremental(
  world: CollisionWorld,
  options: NavGridOptions,
  budgetMs = 4,
): Generator<number, NavGrid, void> {
  const builder = new NavGridBuilder(world, options);
  while (!builder.step(budgetMs)) {
    yield builder.progress;
  }
  return builder.finish();
}
