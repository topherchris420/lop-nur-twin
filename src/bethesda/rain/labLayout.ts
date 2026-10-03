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
    spawn: { x: 0, z: 5 },
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
/** Fixed furniture the player cannot walk through. */
export const OBSTACLES: { min: Vec; max: Vec }[] = [
  {
    min: { x: TABLE.center.x - TABLE.width / 2, z: TABLE.center.z - TABLE.depth / 2 },
    max: { x: TABLE.center.x + TABLE.width / 2, z: TABLE.center.z + TABLE.depth / 2 },
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
