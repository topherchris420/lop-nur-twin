import raw from "./data/osm.json" with { type: "json" };
import source from "./data/source.json" with { type: "json" };
import { mulberry32 } from "../lib/noise";
export interface Point {
  x: number;
  z: number;
}
interface Feature {
  geometry: { type: string; coordinates: number[] | number[][] | number[][][] };
  properties: { kind: string; osmId: string; nodeIds?: string[]; [key: string]: unknown };
}
export const SOURCE = source;
export const DATA_VERSION = source.snapshotSha256;
const features = raw.features as unknown as Feature[];
export const origin = { lat: 38.9847, lon: -77.0947 };
const r = (origin.lat * Math.PI) / 180;
const latScale = 111132.92 - 559.82 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r);
const lonScale = 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r);
export function local(c: number[]): Point {
  return { x: (c[0]! - origin.lon) * lonScale, z: (origin.lat - c[1]!) * latScale };
}
export function geographic(p: Point) {
  return { lat: origin.lat - p.z / latScale, lon: origin.lon + p.x / lonScale };
}
export const bounds = {
  min: local([raw.bbox[0]!, raw.bbox[3]!]),
  max: local([raw.bbox[2]!, raw.bbox[1]!]),
};
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});
export const inBounds = (p: Point) =>
  Number.isFinite(p.x) &&
  Number.isFinite(p.z) &&
  p.x >= bounds.min.x &&
  p.x <= bounds.max.x &&
  p.z >= bounds.min.z &&
  p.z <= bounds.max.z;
export function inside(p: Point, ring: Point[]): boolean {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!,
      b = ring[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x)
      yes = !yes;
  }
  return yes;
}
function center(ring: Point[]): Point {
  const a = ring.slice(0, -1);
  return {
    x: a.reduce((s, p) => s + p.x, 0) / a.length,
    z: a.reduce((s, p) => s + p.z, 0) / a.length,
  };
}
export interface Building {
  id: string;
  ring: Point[];
  holes: Point[][];
  center: Point;
  height: number;
  heightEvidence: "height tag" | "levels × assumed 3.3 m" | "inferred";
  type: string;
  name: string;
  osmType: "way" | "relation";
  version: number;
  editedAt: string;
  levels: number | null;
}
export const buildings: Building[] = features
  .filter((f) => f.properties.kind === "building")
  .map((f) => {
    const p = f.properties,
      ring = (f.geometry.coordinates as number[][][])[0]!.map(local),
      random = mulberry32(Number(p.osmId));
    const h =
      typeof p.height === "string"
        ? parseFloat(p.height) * (p.height.includes("ft") ? 0.3048 : 1)
        : NaN;
    const levels = Number(p["building:levels"]),
      type = String(p.building ?? "yes");
    const height =
      Number.isFinite(h) && h > 0
        ? h
        : levels > 0 && levels < 60
          ? levels * 3.3
          : ["house", "detached", "residential", "apartments"].includes(type)
            ? (type === "apartments" ? 13 : 7) + random() * 4
            : type === "retail"
              ? 8 + random() * 3
              : 9 + Math.floor(random() * 7) * 3.3;
    return {
      id: p.osmId,
      ring,
      holes: (f.geometry.coordinates as number[][][]).slice(1).map((r) => r.map(local)),
      center: center(ring),
      height: Math.min(150, Math.max(3, height)),
      heightEvidence:
        Number.isFinite(h) && h > 0
          ? "height tag"
          : levels > 0 && levels < 60
            ? "levels × assumed 3.3 m"
            : "inferred",
      type,
      name: String(p.name ?? ""),
      osmType: p.osmType === "relation" ? ("relation" as const) : ("way" as const),
      version: Number(p.version),
      editedAt: String(p.editedAt ?? ""),
      levels: levels > 0 && levels < 60 ? levels : null,
    };
  });
// Spatial buckets keep collision queries bounded as the map grows.
const buildingGrid = new Map<string, Building[]>();
for (const b of buildings) {
  const xs = b.ring.map((p) => p.x),
    zs = b.ring.map((p) => p.z);
  for (
    let x = Math.floor(Math.min(...xs) / 40);
    x <= Math.floor(Math.max(...xs) / 40);
    x++
  )
    for (
      let z = Math.floor(Math.min(...zs) / 40);
      z <= Math.floor(Math.max(...zs) / 40);
      z++
    ) {
      const k = `${x},${z}`;
      buildingGrid.set(k, [...(buildingGrid.get(k) ?? []), b]);
    }
}
export function buildingAt(p: Point) {
  return buildingGrid
    .get(`${Math.floor(p.x / 40)},${Math.floor(p.z / 40)}`)
    ?.find((b) => inside(p, b.ring) && !b.holes.some((hole) => inside(p, hole)));
}
export function moveWithCollision(a: Point, b: Point): Point {
  if (!inBounds(b)) return a;
  const steps = Math.ceil(distance(a, b) / 0.3);
  for (let i = 1; i <= steps; i++) if (buildingAt(lerp(a, b, i / steps))) return a;
  return b;
}
export interface Way {
  id: string;
  name: string;
  points: Point[];
  nodeIds: string[];
  width: number;
  widthEvidence: "width tag" | "lanes × assumed 3.3 m" | "class default";
  crossing: boolean;
  oneWay: number;
  highway: string;
}
function ways(kind: string): Way[] {
  return features
    .filter((f) => f.properties.kind === kind)
    .map((f) => {
      const p = f.properties,
        highway = String(p.highway);
      const supplied = Number(p.width),
        lanes = Number(p.lanes),
        oneWay = p.oneway === "yes" || p.oneway === "-1";
      return {
        id: p.osmId + ":" + String(p.part ?? 0),
        name: String(p.name ?? ""),
        points: (f.geometry.coordinates as number[][]).map(local),
        nodeIds: p.nodeIds!,
        // Mapped width, else mapped lane count at an assumed 3.3 m per lane
        // plus gutters, else a class default. Divided avenues are mapped as two
        // one-way carriageways, so a one-way primary default is one carriageway.
        width:
          supplied > 1 && supplied < 40
            ? supplied
            : kind === "path"
              ? 2.4
              : Number.isInteger(lanes) && lanes > 0 && lanes < 9
                ? lanes * 3.3 + 1.2
                : highway === "primary"
                  ? oneWay
                    ? 11
                    : 18
                  : highway === "secondary"
                    ? 13
                    : highway === "service"
                      ? 5
                      : 8,
        widthEvidence:
          supplied > 1 && supplied < 40
            ? ("width tag" as const)
            : kind !== "path" && Number.isInteger(lanes) && lanes > 0 && lanes < 9
              ? ("lanes × assumed 3.3 m" as const)
              : ("class default" as const),
        crossing: p.footway === "crossing",
        oneWay: p.oneway === "yes" ? 1 : p.oneway === "-1" ? -1 : 0,
        highway,
      };
    });
}
export const roadWays = ways("road"),
  pathWays = ways("path");
export const parks = features
  .filter((f) => f.properties.kind === "park")
  .map((f) => ({
    id: f.properties.osmId,
    name: String(f.properties.name ?? "Mapped green space"),
    ring: (f.geometry.coordinates as number[][][])[0]!.map(local),
  }));
export const places = features
  .filter((f) => f.geometry.type === "Point")
  .map((f) => ({
    id: f.properties.osmId,
    kind: f.properties.kind,
    name: String(f.properties.name ?? ""),
    point: local(f.geometry.coordinates as number[]),
  }));
export const signalPoints = places.filter((p) => p.kind === "signal"),
  crossings = places.filter((p) => p.kind === "crossing");
export const row = places.find((p) => p.name === "Bethesda Row")!;
export const metro = places.find((p) => p.kind === "metro")!;
export const rescue = places.find((p) => p.kind === "rescue")!;
// A POI label can lie inside a building (Row's label is inside the garage).
// The Lane courtyard has unmodeled ground-floor passages: arrive on the
// connected public pavement outside its outer footprint, not inside that court.
const laneEntry = pathWays.find((w) => w.name === "Bethesda Lane")!.points[0]!;
const laneBlock = buildings.find((b) => b.id === "13979605")!;
const arrivalCandidates = pathWays
  .filter((w) => !w.crossing)
  .flatMap((w) => w.points)
  .filter(
    (p) =>
      distance(p, laneEntry) < 65 &&
      !inside(p, laneBlock.ring) &&
      !buildingAt(p) &&
      [-1, 1].every(
        (s) => !buildingAt({ x: p.x + s, z: p.z }) && !buildingAt({ x: p.x, z: p.z + s }),
      ),
  );
export const arrival = arrivalCandidates.sort(
  (a, b) => distance(a, laneEntry) - distance(b, laneEntry),
)[0]!;

const wisconsin = roadWays.find((w) => w.name === "Wisconsin Avenue")!;
export const landmarks = [
  { name: "Bethesda Row", point: row.point },
  { name: "Bethesda Metro", point: metro.point },
  {
    name: "Wisconsin Avenue",
    point: wisconsin.points[Math.floor(wisconsin.points.length / 2)]!,
  },
  ...parks
    .filter((p) => /Freeland|Veteran/.test(p.name))
    .map((p) => ({ name: p.name, point: center(p.ring) })),
];
