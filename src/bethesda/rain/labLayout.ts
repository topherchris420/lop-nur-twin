/**
 * The R.A.I.N. Lab interior: the single source of truth for its geometry.
 *
 * The interior is fictional — it is not part of the city map, it does not
 * reconstruct the building above it, and moving inside it is not a city
 * command. Metres in a local frame, +x east, +z south, the threshold door at
 * the south wall. The scene, room detection, the room hints and collision all
 * read this file; nothing hard-codes a position elsewhere.
 *
 *      x: -18          -6            6           18
 *  z -17 ┌────────────┬─────────────┬────────────┐
 *        │  EVIDENCE  │ OBSERVATION │ EXPERIMENT │
 *        │  LIBRARY   │    ROOM     │    BAY     │
 *  z  -5 ├────    ────┼─────  ──────┼────    ────┤
 *        │ REGISTRY / │  RESEARCH   │  SYSTEMS   │
 *        │  ARCHIVE      PANEL         ROOM     │
 *  z   7 └────────────┼─────  ──────┼────────────┘
 *                     │  THRESHOLD  │
 *  z  15              └─────[ ]─────┘
 */
import type { Perspective } from "./contracts";

export interface Vec {
  x: number;
  z: number;
}
export const ROOM_IDS = [
  "threshold",
  "panel",
  "library",
  "bay",
  "observation",
  "registry",
  "systems",
] as const;
export type RoomId = (typeof ROOM_IDS)[number];
export interface Room {
  id: RoomId;
  label: string;
  /** What the room offers, surfaced once on entering it. */
  hint: string;
  min: Vec;
  max: Vec;
  /** Where the room navigator places you. */
  spawn: Vec;
}
export const ROOMS: Record<RoomId, Room> = {
  threshold: {
    id: "threshold",
    label: "Threshold",
    hint: "The lab's rules are written here. The door behind you returns to Bethesda.",
    min: { x: -6, z: 7 },
    max: { x: 6, z: 15 },
    spawn: { x: 0, z: 12.5 },
  },
  panel: {
    id: "panel",
    label: "Research Panel",
    hint: "Ask the four perspectives to investigate a question.",
    min: { x: -6, z: -5 },
    max: { x: 6, z: 7 },
    // Inside the door, R.A.I.N.'s instrument ahead and the table beyond it.
    spawn: { x: 0, z: 6.3 },
  },
  library: {
    id: "library",
    label: "Evidence Library",
    hint: "Inspect the sources used in the current meeting.",
    min: { x: -18, z: -17 },
    max: { x: -6, z: -5 },
    spawn: { x: -12, z: -7 },
  },
  bay: {
    id: "bay",
    label: "Experiment Bay",
    hint: "Turn a supported hypothesis into a Bethesda experiment.",
    min: { x: 6, z: -17 },
    max: { x: 18, z: -5 },
    spawn: { x: 12, z: -7 },
  },
  observation: {
    id: "observation",
    label: "Observation Room",
    hint: "Watch the simulator run: arms, ticks, cohorts and what was refused.",
    min: { x: -6, z: -17 },
    max: { x: 6, z: -5 },
    spawn: { x: 0, z: -7 },
  },
  registry: {
    id: "registry",
    label: "Registry / Archive",
    hint: "Replay, reproduce, or inspect prior results — failures included.",
    min: { x: -18, z: -5 },
    max: { x: -6, z: 7 },
    spawn: { x: -8, z: 1 },
  },
  systems: {
    id: "systems",
    label: "Systems Room",
    hint: "See what the lab is connected to, and what it is not.",
    min: { x: 6, z: -5 },
    max: { x: 18, z: 7 },
    spawn: { x: 8, z: 1 },
  },
};

export const WALL_HEIGHT = 4.2;
export const DOOR_WIDTH = 2.4;
export interface Wall {
  a: Vec;
  b: Vec;
  glass: boolean;
}
/** Doorway centres along each internal wall; walls are split around them. */
const raw: { a: Vec; b: Vec; doors: number[]; glass?: boolean }[] = [
  // Outer shell.
  { a: { x: -18, z: -17 }, b: { x: 18, z: -17 }, doors: [] },
  { a: { x: -18, z: -17 }, b: { x: -18, z: 7 }, doors: [] },
  { a: { x: 18, z: -17 }, b: { x: 18, z: 7 }, doors: [] },
  { a: { x: -18, z: 7 }, b: { x: -6, z: 7 }, doors: [] },
  { a: { x: 6, z: 7 }, b: { x: 18, z: 7 }, doors: [] },
  { a: { x: -6, z: 7 }, b: { x: -6, z: 15 }, doors: [] },
  { a: { x: 6, z: 7 }, b: { x: 6, z: 15 }, doors: [] },
  // The way out is a door in this wall, opened from the HUD or by walking to it.
  { a: { x: -6, z: 15 }, b: { x: 6, z: 15 }, doors: [] },
  // Threshold to the panel.
  { a: { x: -6, z: 7 }, b: { x: 6, z: 7 }, doors: [0] },
  // The panel's side walls are glass: the room can see what it discusses.
  { a: { x: -6, z: -5 }, b: { x: -6, z: 7 }, doors: [1.2], glass: true },
  { a: { x: 6, z: -5 }, b: { x: 6, z: 7 }, doors: [1.2], glass: true },
  { a: { x: -6, z: -5 }, b: { x: 6, z: -5 }, doors: [0], glass: true },
  // The north range.
  { a: { x: -18, z: -5 }, b: { x: -6, z: -5 }, doors: [-12] },
  { a: { x: 6, z: -5 }, b: { x: 18, z: -5 }, doors: [12] },
  { a: { x: -6, z: -17 }, b: { x: -6, z: -5 }, doors: [-11] },
  { a: { x: 6, z: -17 }, b: { x: 6, z: -5 }, doors: [-11] },
];
export const WALLS: Wall[] = raw.flatMap(({ a, b, doors, glass }) => {
  const horizontal = a.z === b.z;
  const from = horizontal ? a.x : a.z,
    to = horizontal ? b.x : b.z;
  const cuts = doors
    .flatMap((d) => [d - DOOR_WIDTH / 2, d + DOOR_WIDTH / 2])
    .sort((p, q) => p - q);
  const stops = [from, ...cuts, to];
  const out: Wall[] = [];
  for (let i = 0; i < stops.length - 1; i += 2) {
    const s = stops[i]!,
      e = stops[i + 1]!;
    if (e - s < 0.05) continue;
    out.push({
      a: horizontal ? { x: s, z: a.z } : { x: a.x, z: s },
      b: horizontal ? { x: e, z: a.z } : { x: a.x, z: e },
      glass: !!glass,
    });
  }
  return out;
});
/** The way back to Bethesda: walk through it, or use the HUD. */
export const EXIT_DOOR: Vec = { x: 0, z: 15 };
export const SPAWN: Vec = { x: 0, z: 13 };

/** Each perspective's station, where the embodiment idles between meetings. */
export const STATIONS: Record<Perspective, { at: Vec; facing: number; room: RoomId }> = {
  // Near the central evidence table, among the sources.
  James: { at: { x: -2.2, z: -1.6 }, facing: 0.6, room: "panel" },
  // Among the instruments in the Experiment Bay.
  Jasmine: { at: { x: 12.5, z: -12.5 }, facing: Math.PI, room: "bay" },
  // At the spatial display of the city in the Observation Room.
  Luca: { at: { x: -1.5, z: -13.5 }, facing: Math.PI, room: "observation" },
  // Across the table, where conclusions are put to her.
  Elena: { at: { x: 3.4, z: 3.2 }, facing: -2.4, room: "panel" },
};
/**
 * Seats around the evidence table during a meeting: the north and side edges,
 * so someone arriving from the threshold sees every face, not a back.
 */
export const TABLE = { center: { x: 0, z: 1 }, width: 4.4, depth: 2.2 };
export const SEATS: Record<Perspective, Vec> = {
  Luca: { x: -1.3, z: -0.85 },
  James: { x: 1.3, z: -0.85 },
  Jasmine: { x: -3, z: 1.4 },
  Elena: { x: 3, z: 1.4 },
};
/** Computational partnership staging, not a reconstruction of real people. */
export const INCEPTION_STATIONS = {
  "Christopher-Sim": { x: -4.2, z: 4.7 },
  "Research-Collaborator": { x: 4.2, z: 4.7 },
};
export const INCEPTION_SEATS = {
  "Christopher-Sim": { x: -1.3, z: 2.8 },
  "Research-Collaborator": { x: 1.3, z: 2.8 },
};
export const INCEPTION_OBSERVATORY = { at: { x: -10, z: 3.5 }, width: 3.2, height: 2.1 };
/**
 * R.A.I.N.'s resonance instrument (`ResonanceFace.tsx`): a plinth carrying
 * one large Chladni plate and four small ones, between the threshold door and
 * the evidence table. It faces the door, so it is the first thing seen on
 * entering the Research Panel, with the perspectives' seats behind it.
 */
export const RESONANCE = {
  at: { x: 0, z: 3.75 },
  width: 1.95,
  depth: 1.05,
  /** How far down someone arriving in the Research Panel looks, so the plates are in view on any screen. */
  look: -0.14,
};
/** Fixed furniture the player cannot walk through. */
export const OBSTACLES: { min: Vec; max: Vec }[] = [
  {
    min: { x: TABLE.center.x - TABLE.width / 2, z: TABLE.center.z - TABLE.depth / 2 },
    max: { x: TABLE.center.x + TABLE.width / 2, z: TABLE.center.z + TABLE.depth / 2 },
  },
  {
    min: {
      x: RESONANCE.at.x - RESONANCE.width / 2,
      z: RESONANCE.at.z - RESONANCE.depth / 2,
    },
    max: {
      x: RESONANCE.at.x + RESONANCE.width / 2,
      z: RESONANCE.at.z + RESONANCE.depth / 2,
    },
  },
];

export function roomAt(p: Vec): RoomId | null {
  for (const id of ROOM_IDS) {
    const r = ROOMS[id];
    if (p.x >= r.min.x && p.x <= r.max.x && p.z >= r.min.z && p.z <= r.max.z) return id;
  }
  return null;
}

const RADIUS = 0.35;
function blocked(p: Vec): boolean {
  if (!roomAt(p)) return true;
  for (const w of WALLS) {
    const dx = w.b.x - w.a.x,
      dz = w.b.z - w.a.z;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - w.a.x) * dx + (p.z - w.a.z) * dz) / (dx * dx + dz * dz)),
    );
    if (Math.hypot(p.x - w.a.x - t * dx, p.z - w.a.z - t * dz) < RADIUS + 0.1)
      return true;
  }
  return OBSTACLES.some(
    (o) =>
      p.x > o.min.x - RADIUS &&
      p.x < o.max.x + RADIUS &&
      p.z > o.min.z - RADIUS &&
      p.z < o.max.z + RADIUS,
  );
}
/** Collide and slide: try the full step, then each axis alone. */
export function moveInLab(from: Vec, to: Vec): Vec {
  if (!blocked(to)) return to;
  const xOnly = { x: to.x, z: from.z };
  if (!blocked(xOnly)) return xOnly;
  const zOnly = { x: from.x, z: to.z };
  if (!blocked(zOnly)) return zOnly;
  return from;
}

/* ------------------------------------------------------------------ */
/* Walking routes for the perspectives                                 */
/* ------------------------------------------------------------------ */

const CELL = 0.25;
const GRID = {
  x0: -18,
  z0: -17,
  nx: Math.round(36 / CELL),
  nz: Math.round(32 / CELL),
};
let walkable: Uint8Array | null = null;
function grid() {
  if (walkable) return walkable;
  walkable = new Uint8Array(GRID.nx * GRID.nz);
  for (let j = 0; j < GRID.nz; j++)
    for (let i = 0; i < GRID.nx; i++)
      walkable[j * GRID.nx + i] = blocked(cellCentre(i, j)) ? 0 : 1;
  return walkable;
}
function cellCentre(i: number, j: number): Vec {
  return { x: GRID.x0 + (i + 0.5) * CELL, z: GRID.z0 + (j + 0.5) * CELL };
}
function cellOf(p: Vec): [number, number] {
  return [
    Math.max(0, Math.min(GRID.nx - 1, Math.floor((p.x - GRID.x0) / CELL))),
    Math.max(0, Math.min(GRID.nz - 1, Math.floor((p.z - GRID.z0) / CELL))),
  ];
}
/** The walkable cell nearest a point, searching outward ring by ring. */
function nearestOpen(p: Vec): number {
  const g = grid();
  const [ci, cj] = cellOf(p);
  for (let r = 0; r < 24; r++) {
    let best = -1,
      bestD = Infinity;
    for (let j = cj - r; j <= cj + r; j++)
      for (let i = ci - r; i <= ci + r; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        if (i < 0 || j < 0 || i >= GRID.nx || j >= GRID.nz || !g[j * GRID.nx + i])
          continue;
        const c = cellCentre(i, j);
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < bestD) {
          bestD = d;
          best = j * GRID.nx + i;
        }
      }
    if (best >= 0) return best;
  }
  return -1;
}
/** A straight walk is clear if every 10 cm along it is walkable. */
export function clearWalk(a: Vec, b: Vec): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (blocked({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
  }
  return true;
}

/**
 * A route a perspective walks between two points of the lab: through the
 * doorways and round the furniture, never through a wall. A* over a 25 cm
 * grid of the same `blocked` the visitor collides with, then pulled taut so
 * a walk is a few straight legs rather than a staircase. Presentation only —
 * deterministic, and computed once when a figure's destination changes.
 */
export function routeInLab(from: Vec, to: Vec): Vec[] {
  // The same walks recur every meeting (station to seat and back); a walk
  // begun from mid-route is new, so the memory is small and bounded.
  const key = `${from.x.toFixed(3)},${from.z.toFixed(3)}>${to.x.toFixed(3)},${to.z.toFixed(3)}`;
  const known = routes.get(key);
  if (known) return [...known];
  const route = planRoute(from, to);
  if (routes.size >= 64) routes.clear();
  routes.set(key, route);
  return [...route];
}
const routes = new Map<string, Vec[]>();

function planRoute(from: Vec, to: Vec): Vec[] {
  if (clearWalk(from, to)) return [from, to];
  const g = grid();
  const start = nearestOpen(from),
    goal = nearestOpen(to);
  if (start < 0 || goal < 0) return [from, to];
  const n = GRID.nx * GRID.nz;
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gi = goal % GRID.nx,
    gj = Math.floor(goal / GRID.nx);
  const h = (c: number) => {
    const dx = Math.abs((c % GRID.nx) - gi),
      dz = Math.abs(Math.floor(c / GRID.nx) - gj);
    return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * CELL;
  };
  const heap: [number, number][] = [[h(start), start]];
  cost[start] = 0;
  const push = (item: [number, number]) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0]!,
      last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [, c] = pop();
    if (closed[c]) continue;
    closed[c] = 1;
    if (c === goal) break;
    const ci = c % GRID.nx,
      cj = Math.floor(c / GRID.nx);
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ci + di,
          j = cj + dj;
        if (i < 0 || j < 0 || i >= GRID.nx || j >= GRID.nz) continue;
        const next = j * GRID.nx + i;
        if (!g[next] || closed[next]) continue;
        // No cutting a corner past a blocked cell.
        if (di && dj && (!g[cj * GRID.nx + i] || !g[j * GRID.nx + ci])) continue;
        const step = (di && dj ? Math.SQRT2 : 1) * CELL;
        if (cost[c]! + step < cost[next]!) {
          cost[next] = cost[c]! + step;
          prev[next] = c;
          push([cost[next] + h(next), next]);
        }
      }
  }
  if (prev[goal]! < 0 && goal !== start) return [from, to];
  const cells: Vec[] = [];
  for (let c = goal; c >= 0; c = prev[c]!) {
    const ci = c % GRID.nx,
      cj = Math.floor(c / GRID.nx);
    cells.push(cellCentre(ci, cj));
    if (c === start) break;
  }
  cells.reverse();
  // Pull the path taut: from each corner, walk on along the cells while they
  // stay in clear view, and turn at the last one that does.
  const path: Vec[] = [from];
  let at = from,
    k = -1;
  const points = [...cells, to];
  while (k < points.length - 1) {
    let far = k + 1;
    while (far + 1 < points.length && clearWalk(at, points[far + 1]!)) far++;
    at = points[far]!;
    path.push(at);
    k = far;
  }
  return path;
}
