/**
 * Where the R.A.I.N. Lab is, and how it is found. Kept light: the city bundle
 * imports this file, and nothing else of the lab, until the door is opened.
 *
 * The lab is fictional. Its door is placed on the rear façade of an
 * **unnamed** OSM building — no name tag, no storefront within 70 m, its
 * height only inferred — beside an unnamed footway, so it makes no claim about
 * any named or real property. The door is derived from that footprint's own
 * geometry: the midpoint of its façade edge nearest the footway, set 0.9 m
 * outside the wall. It is not on the minimap, the landmark list or any
 * marked route; a faint light and a small waveform mark it within a short
 * walk. A second, textual entrance — the door's coordinates, or
 * `resolve r.a.i.n.`, typed into the city's telemetry console — exists for
 * anyone exploring without a mouse or without WebGL.
 */
import {
  buildingAt,
  buildings,
  distance,
  geographic,
  pathWays,
  type Point,
} from "../model";
import { groundAt } from "../terrain";

/** The host building's OSM id. A data reference, never a coordinate. */
export const LAB_BUILDING_ID = "117424685";
const host = buildings.find((b) => b.id === LAB_BUILDING_ID);

function toSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)),
  );
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
const toFootway = (p: Point) =>
  Math.min(
    ...pathWays.flatMap((w) =>
      w.points.slice(1).map((q, i) => toSegment(p, w.points[i]!, q)),
    ),
  );

function door(): { point: Point; facing: number; edge: [Point, Point] } | null {
  if (!host || host.name) return null;
  let best: { point: Point; facing: number; edge: [Point, Point]; d: number } | null =
    null;
  for (let i = 0; i < host.ring.length - 1; i++) {
    const a = host.ring[i]!,
      b = host.ring[i + 1]!;
    const len = distance(a, b);
    if (len < 20) continue;
    const nx = -(b.z - a.z) / len,
      nz = (b.x - a.x) / len;
    for (const s of [1, -1]) {
      const p = { x: (a.x + b.x) / 2 + s * nx * 0.9, z: (a.z + b.z) / 2 + s * nz * 0.9 };
      // The outward side: free ground here and two metres further out.
      if (buildingAt(p) || buildingAt({ x: p.x + s * nx * 2, z: p.z + s * nz * 2 }))
        continue;
      const d = toFootway(p);
      if (!best || d < best.d)
        best = { point: p, facing: Math.atan2(s * nx, s * nz), edge: [a, b], d };
    }
  }
  return best ? { point: best.point, facing: best.facing, edge: best.edge } : null;
}

const found = door();
/**
 * The door, 0.9 m outside the wall, facing outward; `ground` is the host's
 * floor level (buildings sit level at their footprint-centre elevation).
 * Null if the data no longer holds the building.
 */
export const LAB_DOOR: {
  point: Point;
  facing: number;
  edge: [Point, Point];
  ground: number;
} | null = found && host ? { ...found, ground: groundAt(host.center) } : null;
/** Within this distance the door's light and mark are visible. */
export const GLOW_RADIUS = 40;
/** Within this distance the door can be opened. */
export const OPEN_RADIUS = 3.2;

export function nearDoor(p: Point, radius = OPEN_RADIUS): boolean {
  return !!LAB_DOOR && distance(p, LAB_DOOR.point) <= radius;
}

/** The textual entrance: the door's coordinates (to 4 decimals) or the phrase. */
export function resolvesLab(text: string): boolean {
  if (!LAB_DOOR || text.length > 64) return false;
  const t = text.trim().toLowerCase();
  if (t === "resolve r.a.i.n." || t === "resolve rain lab") return true;
  const m = /^\s*([+-]?\d{1,3}\.\d{4,8})\s*,\s*([+-]?\d{1,3}\.\d{4,8})\s*$/.exec(text);
  if (!m) return false;
  const g = geographic(LAB_DOOR.point);
  return (
    Math.abs(Number(m[1]) - g.lat) < 0.00006 && Math.abs(Number(m[2]) - g.lon) < 0.00006
  );
}
