import * as THREE from "three";
import { HUMAN_METRICS, MASK_MOVEMENT } from "../core/types";
import type { CollisionWorld } from "../physics/collisionWorld";
import { NAV_DIR_X, NAV_DIR_Z, type NavGrid } from "./navmesh";

/**
 * A*, string pulling, path following and a time-sliced request queue.
 *
 * Three rules shape the implementation:
 *
 *  1. **No allocation in a query.** Every scratch buffer is sized to the grid
 *     once. Visited marks use a stamp counter instead of clearing arrays, so a
 *     query costs nothing to start.
 *  2. **Searches are resumable.** `PathFinder.step(nodeBudget)` expands a
 *     bounded number of nodes and returns, so `PathQueue` can hold the whole
 *     AI's pathfinding inside ~1.5 ms per frame no matter how many bots ask at
 *     once, and a long cross-compound query simply finishes next frame.
 *  3. **Grid cells already know about the capsule.** `NavGrid` walkability was
 *     tested with `isPositionFree` at the human radius, so a straight line
 *     through walkable cells is a line a bot can actually walk. String pulling
 *     therefore checks both the cell line and `world.hasLineOfSight` at knee
 *     height — the grid catches "too narrow", the ray catches "there is a
 *     handrail in the way that the 0.75 m grid rounded off".
 */

const SQRT2 = Math.SQRT2;
/** Knee height used for string-pull sight tests, metres above the floor. */
export const STRING_PULL_HEIGHT = 0.55;

const nowMs = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/* ------------------------------------------------------------------ */
/* Path container                                                      */
/* ------------------------------------------------------------------ */

/** A pooled polyline. `points` is never shrunk, `count` is the live length. */
export class Path {
  readonly points: THREE.Vector3[] = [];
  count = 0;
  cost = 0;
  /** True when the goal was unreachable and this ends at the closest node. */
  partial = false;
  /** True when the search produced anything at all. */
  valid = false;

  clear(): void {
    this.count = 0;
    this.cost = 0;
    this.partial = false;
    this.valid = false;
  }

  push(x: number, y: number, z: number): void {
    let point = this.points[this.count];
    if (!point) {
      point = new THREE.Vector3();
      this.points.push(point);
    }
    point.set(x, y, z);
    this.count += 1;
  }

  at(index: number): THREE.Vector3 | null {
    if (index < 0 || index >= this.count) return null;
    return this.points[index] ?? null;
  }

  get last(): THREE.Vector3 | null {
    return this.at(this.count - 1);
  }

  copyFrom(other: Path): void {
    this.clear();
    for (let i = 0; i < other.count; i += 1) {
      const p = other.points[i]!;
      this.push(p.x, p.y, p.z);
    }
    this.cost = other.cost;
    this.partial = other.partial;
    this.valid = other.valid;
  }

  /** Total planar length, in metres. */
  length(): number {
    let total = 0;
    for (let i = 1; i < this.count; i += 1) {
      const a = this.points[i - 1]!;
      const b = this.points[i]!;
      total += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return total;
  }
}

/* ------------------------------------------------------------------ */
/* Binary heap                                                         */
/* ------------------------------------------------------------------ */

class BinaryHeap {
  private ids: Int32Array;
  private keys: Float32Array;
  private count = 0;

  constructor(capacity: number) {
    this.ids = new Int32Array(Math.max(64, capacity));
    this.keys = new Float32Array(Math.max(64, capacity));
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  push(id: number, key: number): void {
    if (this.count >= this.ids.length) this.grow();
    let i = this.count;
    this.count += 1;
    this.ids[i] = id;
    this.keys[i] = key;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= key) break;
      this.ids[i] = this.ids[parent]!;
      this.keys[i] = this.keys[parent]!;
      this.ids[parent] = id;
      this.keys[parent] = key;
      i = parent;
    }
  }

  /** Lowest-key id, or -1 when empty. */
  pop(): number {
    if (this.count === 0) return -1;
    const top = this.ids[0]!;
    this.count -= 1;
    if (this.count > 0) {
      const id = this.ids[this.count]!;
      const key = this.keys[this.count]!;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        if (left >= this.count) break;
        const right = left + 1;
        let child = left;
        if (right < this.count && this.keys[right]! < this.keys[left]!) child = right;
        if (this.keys[child]! >= key) break;
        this.ids[i] = this.ids[child]!;
        this.keys[i] = this.keys[child]!;
        i = child;
      }
      this.ids[i] = id;
      this.keys[i] = key;
    }
    return top;
  }

  private grow(): void {
    const ids = new Int32Array(this.ids.length * 2);
    const keys = new Float32Array(this.keys.length * 2);
    ids.set(this.ids);
    keys.set(this.keys);
    this.ids = ids;
    this.keys = keys;
  }
}

/* ------------------------------------------------------------------ */
/* A*                                                                  */
/* ------------------------------------------------------------------ */

export interface PathOptions {
  /**
   * Extra metres of cost per unit of exposure (0..1). Raising it makes bots
   * take the covered route; `findFlankRoute` leans on this.
   */
  exposureWeight?: number;
  /** Metres of cost removed per step when the cell offers cover. */
  coverBonus?: number;
  /**
   * Greediness. 1 is optimal A*; 1.05 typically halves the expanded node count
   * for a path a metre or two longer, which no player will ever notice.
   */
  heuristicWeight?: number;
  /** Hard cap on expanded nodes before the search gives up. */
  maxNodes?: number;
  /** Optional per-cell extra cost, same length as the grid. */
  danger?: Float32Array | null;
  /** Metres of cost per unit of `danger`. */
  dangerWeight?: number;
}

const DEFAULT_OPTIONS: Required<Omit<PathOptions, "danger">> & { danger: Float32Array | null } = {
  exposureWeight: 0,
  coverBonus: 0,
  heuristicWeight: 1.05,
  maxNodes: 24000,
  danger: null,
  dangerWeight: 0,
};

export type SearchState = "idle" | "searching" | "found" | "failed";

export class PathFinder {
  readonly grid: NavGrid;
  private readonly world: CollisionWorld;

  private readonly gScore: Float32Array;
  private readonly cameFrom: Int32Array;
  /** `stamp * 2` marks an open cell, `stamp * 2 + 1` a closed one. */
  private readonly stamps: Int32Array;
  private readonly heap: BinaryHeap;
  private readonly trail: Int32Array;
  private stamp = 0;

  private start = -1;
  private goal = -1;
  private best = -1;
  private bestHeuristic = Infinity;
  private expanded = 0;
  private state: SearchState = "idle";
  private options = { ...DEFAULT_OPTIONS };

  /** Nodes expanded by the most recent completed search. */
  lastExpanded = 0;

  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  constructor(grid: NavGrid, world: CollisionWorld) {
    this.grid = grid;
    this.world = world;
    const count = grid.cellCount;
    this.gScore = new Float32Array(count);
    this.cameFrom = new Int32Array(count);
    this.stamps = new Int32Array(count);
    this.closed = new Uint8Array(count);
    this.heap = new BinaryHeap(Math.min(count, 8192));
    this.trail = new Int32Array(Math.max(64, Math.ceil(Math.sqrt(count)) * 8));
  }

  get searchState(): SearchState {
    return this.state;
  }

  /** Octile distance in metres. */
  private heuristic(cell: number): number {
    const grid = this.grid;
    const dx = Math.abs((cell % grid.cols) - (this.goal % grid.cols));
    const dz = Math.abs(((cell / grid.cols) | 0) - ((this.goal / grid.cols) | 0));
    const lo = dx < dz ? dx : dz;
    return grid.cellSize * (dx + dz + (SQRT2 - 2) * lo);
  }

  /** Prepare a search. Cells must already be walkable. */
  begin(startCell: number, goalCell: number, options?: PathOptions): void {
    this.options.exposureWeight = options?.exposureWeight ?? DEFAULT_OPTIONS.exposureWeight;
    this.options.coverBonus = options?.coverBonus ?? DEFAULT_OPTIONS.coverBonus;
    this.options.heuristicWeight = options?.heuristicWeight ?? DEFAULT_OPTIONS.heuristicWeight;
    this.options.maxNodes = options?.maxNodes ?? DEFAULT_OPTIONS.maxNodes;
    this.options.danger = options?.danger ?? null;
    this.options.dangerWeight = options?.dangerWeight ?? DEFAULT_OPTIONS.dangerWeight;

    this.stamp += 1;
    this.heap.clear();
    this.start = startCell;
    this.goal = goalCell;
    this.expanded = 0;
    this.best = startCell;

    if (startCell < 0 || goalCell < 0) {
      this.state = "failed";
      return;
    }
    this.bestHeuristic = this.heuristic(startCell);
    this.stamps[startCell] = this.stamp;
    this.gScore[startCell] = 0;
    this.cameFrom[startCell] = -1;
    this.closed[startCell] = 0;
    this.heap.push(startCell, this.bestHeuristic * this.options.heuristicWeight);
    this.state = startCell === goalCell ? "found" : "searching";
  }

  /**
   * Expand at most `nodeBudget` nodes. Returns the search state so the caller
   * can spread one query over several frames.
   */
  step(nodeBudget: number): SearchState {
    if (this.state !== "searching") return this.state;
    const grid = this.grid;
    const cols = grid.cols;
    const cellSize = grid.cellSize;
    const diagonal = cellSize * SQRT2;
    const exposureWeight = this.options.exposureWeight;
    const coverBonus = this.options.coverBonus;
    const heuristicWeight = this.options.heuristicWeight;
    const danger = this.options.danger;
    const dangerWeight = this.options.dangerWeight;

    for (let n = 0; n < nodeBudget; n += 1) {
      const current = this.heap.pop();
      if (current < 0) {
        this.state = "failed";
        this.lastExpanded = this.expanded;
        return this.state;
      }
      if (this.closed[current] === this.stamp % 251 + 1) {
        // Stale heap entry (we push duplicates rather than decrease-key).
        n -= 1;
        continue;
      }
      this.closed[current] = (this.stamp % 251) + 1;

      if (current === this.goal) {
        this.state = "found";
        this.best = current;
        this.lastExpanded = this.expanded;
        return this.state;
      }

      this.expanded += 1;
      if (this.expanded > this.options.maxNodes) {
        this.state = "failed";
        this.lastExpanded = this.expanded;
        return this.state;
      }

      const links = grid.links[current]!;
      if (links === 0) continue;
      const gCurrent = this.gScore[current]!;
      const cx = current % cols;
      const cz = (current / cols) | 0;

      for (let d = 0; d < 8; d += 1) {
        if ((links & (1 << d)) === 0) continue;
        const next = (cz + NAV_DIR_Z[d]!) * cols + (cx + NAV_DIR_X[d]!);
        if (this.closed[next] === (this.stamp % 251) + 1) continue;

        let stepCost = (d & 1) === 1 ? diagonal : cellSize;
        if (exposureWeight > 0) {
          stepCost += (grid.exposure[next]! / 255) * exposureWeight;
        }
        if (coverBonus > 0 && grid.cover[next]! !== 0) {
          stepCost = Math.max(cellSize * 0.25, stepCost - coverBonus);
        }
        if (danger !== null && dangerWeight > 0) {
          stepCost += (danger[next] ?? 0) * dangerWeight;
        }

        const tentative = gCurrent + stepCost;
        if (this.stamps[next] === this.stamp && tentative >= this.gScore[next]!) continue;
        this.stamps[next] = this.stamp;
        this.gScore[next] = tentative;
        this.cameFrom[next] = current;
        const h = this.heuristic(next);
        if (h < this.bestHeuristic) {
          this.bestHeuristic = h;
          this.best = next;
        }
        this.heap.push(next, tentative + h * heuristicWeight);
      }
    }
    return this.state;
  }

  /** Run to completion. Convenience for tests and one-off queries. */
  run(): SearchState {
    let guard = 0;
    while (this.state === "searching") {
      this.step(4096);
      if (guard++ > 4096) break;
    }
    return this.state;
  }

  /**
   * Reconstruct and string-pull into `out`.
   *
   * `endX/endZ` let the caller finish at the exact requested point rather than
   * the centre of the goal cell.
   */
  buildPath(out: Path, endX: number, endZ: number): boolean {
    out.clear();
    if (this.state !== "found" && this.state !== "failed") return false;
    const terminal = this.state === "found" ? this.goal : this.best;
    if (terminal < 0) return false;

    // Walk back to the start, storing the cells in reverse.
    let cell = terminal;
    let n = 0;
    const trail = this.trail;
    while (cell >= 0 && n < trail.length) {
      trail[n] = cell;
      n += 1;
      if (cell === this.start) break;
      const parent = this.cameFrom[cell]!;
      if (parent === cell) break;
      cell = parent;
    }
    if (n === 0) return false;

    const grid = this.grid;
    out.partial = this.state !== "found";
    out.valid = true;
    out.cost = this.gScore[terminal] ?? 0;

    // trail is goal -> start; string pull walking forward from the start.
    const first = trail[n - 1]!;
    out.push(grid.cellCenterX(first), grid.heights[first]!, grid.cellCenterZ(first));

    let anchor = n - 1;
    for (let i = n - 2; i >= 1; i -= 1) {
      const candidate = trail[i - 1]!;
      if (this.clearBetween(trail[anchor]!, candidate)) continue;
      const keep = trail[i]!;
      out.push(grid.cellCenterX(keep), grid.heights[keep]!, grid.cellCenterZ(keep));
      anchor = i;
    }

    if (out.partial) {
      out.push(grid.cellCenterX(terminal), grid.heights[terminal]!, grid.cellCenterZ(terminal));
    } else {
      out.push(endX, grid.heightAt(endX, endZ), endZ);
    }

    // Drop a duplicated first waypoint (start cell centre == first corner).
    if (out.count > 2) {
      const p0 = out.points[0]!;
      const p1 = out.points[1]!;
      if (Math.hypot(p1.x - p0.x, p1.z - p0.z) < grid.cellSize * 0.6) {
        for (let i = 1; i < out.count; i += 1) {
          out.points[i - 1]!.copy(out.points[i]!);
        }
        out.count -= 1;
      }
    }
    return true;
  }

  /**
   * Is the straight segment between two cells walkable?
   *
   * The grid walk proves the capsule fits (walkability was baked with
   * `isPositionFree`); the knee-height ray catches thin geometry the 0.75 m
   * grid rounded away.
   */
  private clearBetween(fromCell: number, toCell: number): boolean {
    const grid = this.grid;
    if (!lineWalkable(grid, fromCell, toCell)) return false;
    grid.cellToWorld(fromCell, this.a);
    grid.cellToWorld(toCell, this.b);
    this.a.y += STRING_PULL_HEIGHT;
    this.b.y += STRING_PULL_HEIGHT;
    return this.world.hasLineOfSight(this.a, this.b, MASK_MOVEMENT, null);
  }
}

/**
 * Integer DDA between two cells: true when every cell the segment crosses is
 * walkable. Visits shared edges properly, so a diagonal cannot clip a corner.
 */
export function lineWalkable(grid: NavGrid, fromCell: number, toCell: number): boolean {
  const cols = grid.cols;
  let cx = fromCell % cols;
  let cz = (fromCell / cols) | 0;
  const tx = toCell % cols;
  const tz = (toCell / cols) | 0;
  if (!grid.isWalkable(fromCell) || !grid.isWalkable(toCell)) return false;

  const dx = tx - cx;
  const dz = tz - cz;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const absX = Math.abs(dx);
  const absZ = Math.abs(dz);
  // Parametric crossings, in units where the whole segment is length 1.
  let tMaxX = absX === 0 ? Infinity : 0.5 / absX;
  let tMaxZ = absZ === 0 ? Infinity : 0.5 / absZ;
  const tDeltaX = absX === 0 ? Infinity : 1 / absX;
  const tDeltaZ = absZ === 0 ? Infinity : 1 / absZ;

  let guard = 0;
  while ((cx !== tx || cz !== tz) && guard++ < 8192) {
    if (tMaxX < tMaxZ) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else if (tMaxZ < tMaxX) {
      cz += stepZ;
      tMaxZ += tDeltaZ;
    } else {
      // Exact diagonal crossing: both orthogonal neighbours must be open.
      if (!grid.isWalkable(grid.index(cx + stepX, cz))) return false;
      if (!grid.isWalkable(grid.index(cx, cz + stepZ))) return false;
      cx += stepX;
      cz += stepZ;
      tMaxX += tDeltaX;
      tMaxZ += tDeltaZ;
    }
    if (!grid.isWalkable(grid.index(cx, cz))) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Path following                                                      */
/* ------------------------------------------------------------------ */

export interface AvoidNeighbour {
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
}

export interface SteerOutput {
  /** Unit desired heading in the XZ plane; zero when there is nothing to do. */
  dirX: number;
  dirZ: number;
  /** 0..1 multiplier on the bot's chosen speed (arrival + crowding). */
  speedScale: number;
  arrived: boolean;
  /** Metres left along the path. */
  distanceRemaining: number;
  targetX: number;
  targetZ: number;
}

export function createSteerOutput(): SteerOutput {
  return {
    dirX: 0,
    dirZ: 0,
    speedScale: 0,
    arrived: true,
    distanceRemaining: 0,
    targetX: 0,
    targetZ: 0,
  };
}

/**
 * Follows a `Path` with look-ahead, arrival slowdown and local avoidance.
 *
 * The look-ahead point is the furthest point on the path within `lookAhead`
 * metres, which turns the polyline into a smooth curve without smoothing the
 * data. Avoidance is a separation force plus a deterministic side bias so two
 * bots meeting head-on always pick opposite shoulders instead of dancing.
 */
export class PathFollower {
  readonly path = new Path();
  /** Index of the segment currently being traversed. */
  index = 0;
  lookAhead = 2.2;
  arriveRadius = 0.9;
  /** +1 or -1; decided by the owner so two bots never pick the same shoulder. */
  sideBias = 1;
  /** Metres of separation force applied per crowding unit. */
  avoidStrength = 1.35;

  private replanTimer = 0;

  get hasPath(): boolean {
    return this.path.valid && this.path.count > 0;
  }

  get goalX(): number {
    return this.path.last?.x ?? 0;
  }

  get goalZ(): number {
    return this.path.last?.z ?? 0;
  }

  get partial(): boolean {
    return this.path.partial;
  }

  setPath(path: Path): void {
    this.path.copyFrom(path);
    this.index = 0;
    this.replanTimer = 0;
  }

  clear(): void {
    this.path.clear();
    this.index = 0;
  }

  /** Seconds since the path was set, for replan heuristics. */
  get age(): number {
    return this.replanTimer;
  }

  update(
    dt: number,
    x: number,
    z: number,
    radius: number,
    neighbours: readonly AvoidNeighbour[],
    out: SteerOutput,
  ): void {
    this.replanTimer += dt;
    out.dirX = 0;
    out.dirZ = 0;
    out.speedScale = 0;
    out.arrived = true;
    out.distanceRemaining = 0;
    out.targetX = x;
    out.targetZ = z;
    if (!this.hasPath) return;

    // Advance past waypoints we are already level with.
    while (this.index < this.path.count - 1) {
      const p = this.path.points[this.index]!;
      if (Math.hypot(p.x - x, p.z - z) > this.arriveRadius) break;
      this.index += 1;
    }

    const goal = this.path.points[this.path.count - 1]!;
    let remaining = Math.hypot(goal.x - x, goal.z - z);
    for (let i = this.index; i < this.path.count - 1; i += 1) {
      const a = this.path.points[i]!;
      const b = this.path.points[i + 1]!;
      remaining += Math.hypot(b.x - a.x, b.z - a.z);
    }
    out.distanceRemaining = remaining;

    if (this.index >= this.path.count - 1 && Math.hypot(goal.x - x, goal.z - z) <= this.arriveRadius) {
      out.arrived = true;
      return;
    }
    out.arrived = false;

    /* --------------------------------------------------- look-ahead */
    let targetX = goal.x;
    let targetZ = goal.z;
    let travelled = 0;
    let px = x;
    let pz = z;
    for (let i = this.index; i < this.path.count; i += 1) {
      const p = this.path.points[i]!;
      const segment = Math.hypot(p.x - px, p.z - pz);
      if (travelled + segment >= this.lookAhead) {
        const t = segment > 1e-5 ? (this.lookAhead - travelled) / segment : 1;
        targetX = px + (p.x - px) * t;
        targetZ = pz + (p.z - pz) * t;
        break;
      }
      travelled += segment;
      px = p.x;
      pz = p.z;
      targetX = p.x;
      targetZ = p.z;
    }
    out.targetX = targetX;
    out.targetZ = targetZ;

    let dirX = targetX - x;
    let dirZ = targetZ - z;
    let len = Math.hypot(dirX, dirZ);
    if (len < 1e-5) {
      dirX = goal.x - x;
      dirZ = goal.z - z;
      len = Math.hypot(dirX, dirZ);
      if (len < 1e-5) {
        out.arrived = true;
        return;
      }
    }
    dirX /= len;
    dirZ /= len;

    /* ---------------------------------------------- local avoidance */
    let crowding = 0;
    let pushX = 0;
    let pushZ = 0;
    for (const other of neighbours) {
      const ox = other.x - x;
      const oz = other.z - z;
      const distance = Math.hypot(ox, oz);
      const range = radius + other.radius + 0.85;
      if (distance > range || distance < 1e-4) continue;
      const strength = 1 - distance / range;
      crowding = Math.max(crowding, strength);
      // Straight separation.
      pushX -= (ox / distance) * strength;
      pushZ -= (oz / distance) * strength;
      // Head-on or crossing: slide to a consistent shoulder rather than
      // pushing straight back, which is what makes squads shuffle in place.
      const closing = (other.vx - 0) * -ox + (other.vz - 0) * -oz;
      const facing = (ox / distance) * dirX + (oz / distance) * dirZ;
      if (facing > 0.2 && closing > -0.5) {
        pushX += -dirZ * this.sideBias * strength * 1.4;
        pushZ += dirX * this.sideBias * strength * 1.4;
      }
    }
    if (crowding > 0) {
      dirX += pushX * this.avoidStrength;
      dirZ += pushZ * this.avoidStrength;
      const l = Math.hypot(dirX, dirZ);
      if (l > 1e-5) {
        dirX /= l;
        dirZ /= l;
      }
    }

    out.dirX = dirX;
    out.dirZ = dirZ;

    /* ------------------------------------------------------ arrival */
    const slowRadius = Math.max(this.arriveRadius * 2.5, 2.4);
    const arrival = Math.min(1, remaining / slowRadius);
    out.speedScale = Math.max(0.12, arrival * (1 - crowding * 0.55));
  }
}

/* ------------------------------------------------------------------ */
/* Request queue                                                       */
/* ------------------------------------------------------------------ */

export type PathCallback = (path: Path, ok: boolean) => void;

interface QueuedRequest {
  key: number;
  active: boolean;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  priority: number;
  callback: PathCallback | null;
  options: PathOptions;
  submitted: number;
}

export interface PathQueueStats {
  /** Queries completed since the counter was last read. */
  completed: number;
  failed: number;
  nodesExpanded: number;
  msLastFrame: number;
  pending: number;
}

/**
 * Time-sliced path requests.
 *
 * One `PathFinder` is shared by every bot and processes requests strictly in
 * order, so a query that runs out of budget simply resumes on the next frame.
 * A second request with the same key (normally the actor id) replaces the first
 * — a bot only ever wants its most recent destination.
 */
export class PathQueue {
  readonly grid: NavGrid;
  private readonly finder: PathFinder;
  private readonly requests: QueuedRequest[] = [];
  private readonly scratch = new Path();
  private active: QueuedRequest | null = null;
  private activeGoalX = 0;
  private activeGoalZ = 0;
  private readonly stats: PathQueueStats = {
    completed: 0,
    failed: 0,
    nodesExpanded: 0,
    msLastFrame: 0,
    pending: 0,
  };

  /** Nodes expanded between deadline checks. Small enough to stay responsive. */
  chunkSize = 640;
  /** Cells searched before a query is abandoned. */
  maxNodes = 20000;

  constructor(grid: NavGrid, world: CollisionWorld) {
    this.grid = grid;
    this.finder = new PathFinder(grid, world);
  }

  get pending(): number {
    let count = this.active ? 1 : 0;
    for (const r of this.requests) if (r.active) count += 1;
    return count;
  }

  /** Snapshot of the counters; `completed`/`failed`/`nodes` reset on read. */
  readStats(): PathQueueStats {
    const snapshot: PathQueueStats = { ...this.stats, pending: this.pending };
    this.stats.completed = 0;
    this.stats.failed = 0;
    this.stats.nodesExpanded = 0;
    return snapshot;
  }

  request(
    key: number,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    priority: number,
    callback: PathCallback,
    options?: PathOptions,
  ): void {
    if (this.active && this.active.key === key) {
      // Restart in place: the destination moved while we were solving.
      this.active.active = false;
      this.active = null;
    }
    let slot = this.requests.find((r) => r.active && r.key === key);
    if (!slot) slot = this.requests.find((r) => !r.active);
    if (!slot) {
      slot = {
        key,
        active: false,
        fromX: 0,
        fromZ: 0,
        toX: 0,
        toZ: 0,
        priority: 0,
        callback: null,
        options: {},
        submitted: 0,
      };
      this.requests.push(slot);
    }
    slot.key = key;
    slot.active = true;
    slot.fromX = fromX;
    slot.fromZ = fromZ;
    slot.toX = toX;
    slot.toZ = toZ;
    slot.priority = priority;
    slot.callback = callback;
    slot.options = options ?? {};
    slot.submitted = nowMs();
  }

  cancel(key: number): void {
    for (const r of this.requests) if (r.key === key) r.active = false;
    if (this.active && this.active.key === key) this.active = null;
  }

  clear(): void {
    for (const r of this.requests) r.active = false;
    this.active = null;
  }

  /** Spend at most `budgetMs` on pathfinding this frame. */
  update(budgetMs = 1.5): void {
    const started = nowMs();
    const deadline = started + budgetMs;
    let guard = 0;
    while (nowMs() < deadline && guard++ < 64) {
      if (!this.active && !this.beginNext()) break;
      const request = this.active;
      if (!request) break;
      const state = this.finder.step(this.chunkSize);
      if (state === "searching") continue;
      this.complete(request, state === "found");
    }
    this.stats.msLastFrame = nowMs() - started;
  }

  private beginNext(): boolean {
    let best: QueuedRequest | null = null;
    for (const r of this.requests) {
      if (!r.active) continue;
      if (!best || r.priority > best.priority || (r.priority === best.priority && r.submitted < best.submitted)) {
        best = r;
      }
    }
    if (!best) return false;

    const grid = this.grid;
    const startCell = grid.isWalkableAt(best.fromX, best.fromZ)
      ? grid.worldToCell(best.fromX, best.fromZ)
      : grid.nearestWalkable(best.fromX, best.fromZ, 8);
    const goalCell = grid.isWalkableAt(best.toX, best.toZ)
      ? grid.worldToCell(best.toX, best.toZ)
      : grid.nearestWalkable(best.toX, best.toZ, 10);

    if (startCell < 0 || goalCell < 0) {
      best.active = false;
      this.scratch.clear();
      this.stats.failed += 1;
      best.callback?.(this.scratch, false);
      return true;
    }

    this.activeGoalX = goalCell === grid.worldToCell(best.toX, best.toZ)
      ? best.toX
      : grid.cellCenterX(goalCell);
    this.activeGoalZ = goalCell === grid.worldToCell(best.toX, best.toZ)
      ? best.toZ
      : grid.cellCenterZ(goalCell);

    const options = best.options;
    this.finder.begin(startCell, goalCell, {
      exposureWeight: options.exposureWeight,
      coverBonus: options.coverBonus,
      heuristicWeight: options.heuristicWeight,
      maxNodes: options.maxNodes ?? this.maxNodes,
      danger: options.danger ?? null,
      dangerWeight: options.dangerWeight,
    });
    best.active = false;
    this.active = best;
    if (this.finder.searchState !== "searching") {
      this.complete(best, this.finder.searchState === "found");
    }
    return true;
  }

  private complete(request: QueuedRequest, ok: boolean): void {
    this.active = null;
    this.stats.nodesExpanded += this.finder.lastExpanded;
    const built = this.finder.buildPath(this.scratch, this.activeGoalX, this.activeGoalZ);
    const success = ok && built;
    if (success) this.stats.completed += 1;
    else this.stats.failed += 1;
    request.callback?.(this.scratch, success);
  }
}

/* ------------------------------------------------------------------ */
/* Direct helper                                                       */
/* ------------------------------------------------------------------ */

/**
 * Blocking single query, used by tools and the self test. Game code should go
 * through `PathQueue` so the frame budget stays bounded.
 */
export function findPathImmediate(
  finder: PathFinder,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  out: Path,
  options?: PathOptions,
): boolean {
  const grid = finder.grid;
  const start = grid.isWalkableAt(fromX, fromZ)
    ? grid.worldToCell(fromX, fromZ)
    : grid.nearestWalkable(fromX, fromZ, 8);
  const goal = grid.isWalkableAt(toX, toZ)
    ? grid.worldToCell(toX, toZ)
    : grid.nearestWalkable(toX, toZ, 10);
  if (start < 0 || goal < 0) {
    out.clear();
    return false;
  }
  finder.begin(start, goal, options);
  const state = finder.run();
  const built = finder.buildPath(out, toX, toZ);
  return state === "found" && built;
}

/** Standing capsule radius, exported so callers can size avoidance. */
export const AGENT_RADIUS = HUMAN_METRICS.radius;
