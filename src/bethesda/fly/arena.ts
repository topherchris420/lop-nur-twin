/**
 * The experiment arena: a closed room built from a plain-data specification,
 * so an experiment's world is part of its design and its hash.
 *
 * Floor, four walls and a ceiling; optional pillars, platforms to land on,
 * glass panels (solid but unseen), point lights over a uniform ambient level,
 * and looming stimuli: spheres that approach a point at constant speed,
 * repeated on a schedule. Metres, world frame. Nothing here moves on its own
 * except the stimuli, and their positions are a function of time alone.
 */
import type { V3 } from "./units.js";
import {
  PrimitiveWorld,
  type Box,
  type Cylinder,
  type Mover,
  type PointLight,
  type WorldInputs,
} from "./world.js";

export interface LoomSpec {
  /** First appearance (s after the fly is placed). */
  start: number;
  /** Seconds between repeats; 0 for a single presentation. */
  period: number;
  count: number;
  from: V3;
  to: V3;
  speedMS: number;
  radiusM: number;
}
export interface ArenaSpec {
  /** Inner size: x, height, z (m). */
  size: V3;
  ambient: number;
  pillars?: { x: number; z: number; r: number }[];
  platforms?: { center: V3; half: V3 }[];
  glass?: { a: [number, number]; b: [number, number] }[];
  lights?: { at: V3; intensity: number }[];
  looms?: LoomSpec[];
}

const WALL = 0.1;

export const ARENA_INPUTS: WorldInputs = {
  supported: [
    "walls, floor and ceiling",
    "pillars and platforms",
    "glass (solid, not seen)",
    "looming stimuli",
    "point lights",
  ],
  proxies: ["light level: relative units (point lights over ambient), not lux"],
  unsupported: ["odour", "temperature", "humidity", "airflow", "food"],
};

/** Where a looming stimulus is at time `t`, or null when none is showing. */
export function loomAt(l: LoomSpec, t: number): V3 | null {
  const span = Math.hypot(l.to[0] - l.from[0], l.to[1] - l.from[1], l.to[2] - l.from[2]);
  const dur = span / l.speedMS;
  for (let k = 0; k < Math.max(1, l.count); k++) {
    const t0 = l.start + k * l.period;
    if (t >= t0 && t <= t0 + dur) {
      const u = (t - t0) / dur;
      return [
        l.from[0] + (l.to[0] - l.from[0]) * u,
        l.from[1] + (l.to[1] - l.from[1]) * u,
        l.from[2] + (l.to[2] - l.from[2]) * u,
      ];
    }
    if (l.period <= 0) break;
  }
  return null;
}

export function arenaWorld(spec: ArenaSpec, id = "arena"): PrimitiveWorld {
  const [sx, sy, sz] = spec.size;
  if (![sx, sy, sz].every((v) => Number.isFinite(v) && v > 0.2 && v <= 50))
    throw new Error("arena size out of range");
  const hx = sx / 2,
    hz = sz / 2;
  const boxes: Box[] = [
    {
      kind: "wall",
      id: "wall-n",
      center: [0, sy / 2, -hz - WALL / 2],
      half: [hx + WALL, sy / 2, WALL / 2],
      angle: 0,
    },
    {
      kind: "wall",
      id: "wall-s",
      center: [0, sy / 2, hz + WALL / 2],
      half: [hx + WALL, sy / 2, WALL / 2],
      angle: 0,
    },
    {
      kind: "wall",
      id: "wall-w",
      center: [-hx - WALL / 2, sy / 2, 0],
      half: [WALL / 2, sy / 2, hz + WALL],
      angle: 0,
    },
    {
      kind: "wall",
      id: "wall-e",
      center: [hx + WALL / 2, sy / 2, 0],
      half: [WALL / 2, sy / 2, hz + WALL],
      angle: 0,
    },
  ];
  (spec.platforms ?? []).forEach((pl, i) =>
    boxes.push({
      kind: "table",
      id: `platform-${i}`,
      center: pl.center,
      half: pl.half,
      angle: 0,
    }),
  );
  (spec.glass ?? []).forEach((g, i) => {
    const dx = g.b[0] - g.a[0],
      dz = g.b[1] - g.a[1];
    const len = Math.hypot(dx, dz);
    boxes.push({
      kind: "glass",
      id: `glass-${i}`,
      center: [(g.a[0] + g.b[0]) / 2, sy / 2, (g.a[1] + g.b[1]) / 2],
      half: [len / 2, sy / 2, 0.005],
      // rotateY(θ) maps local +x to (cos θ, 0, −sin θ).
      angle: Math.atan2(-dz, dx),
    });
  });
  const cylinders: Cylinder[] = (spec.pillars ?? []).map((p, i) => ({
    kind: "pole",
    id: `pillar-${i}`,
    x: p.x,
    z: p.z,
    r: p.r,
    y0: 0,
    y1: sy,
  }));
  const lights: PointLight[] = (spec.lights ?? []).map((l) => ({
    at: l.at,
    intensity: l.intensity,
  }));
  const looms = spec.looms ?? [];
  return new PrimitiveWorld({
    id,
    home: { center: [0, 0, 0], radius: Math.min(hx, hz), ceiling: sy },
    inputs: ARENA_INPUTS,
    ground: () => 0,
    groundMax: 0,
    groundKind: "floor",
    boxes,
    cylinders,
    ceiling: sy,
    lights,
    ambient: spec.ambient,
    movers: (near, radius, out: Mover[], t) => {
      looms.forEach((l, i) => {
        const c = loomAt(l, t);
        if (!c) return;
        if (
          Math.hypot(c[0] - near[0], c[1] - near[1], c[2] - near[2]) >
          radius + l.radiusM
        )
          return;
        out.push({ id: `loom-${i}`, kind: "stimulus", center: c, radius: l.radiusM });
      });
    },
  });
}
