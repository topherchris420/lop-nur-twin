/**
 * The streetscape/transit layer: a second, separately hashed OSM derivative.
 *
 * Everything here is read from `data/streetscape.json`; nothing is placed by
 * hand. Bus routes are OSM route relations whose ordered way members were cut
 * to the bounding box by the importer. Where a route has a gap (a member way
 * outside the box, or a node the road graph does not contain) the bus paths
 * across it on the road graph, and that link is counted as inferred.
 */
import data from "./data/streetscape.json" with { type: "json" };
import source from "./data/streetscape-source.json" with { type: "json" };
import {
  buildingAt,
  buildings,
  distance,
  local,
  type Building,
  type Point,
} from "./model";
import { roads, sidewalks, nearest } from "./network";

export const STREETSCAPE_SOURCE = source;
export const TRANSIT_VERSION = source.snapshotSha256;

interface Located {
  osmId: string;
  point: Point;
}
const at = (c: number[]) => local(c);

export interface Storefront extends Located {
  name: string;
  category: string;
  street: string;
}
export const storefronts: Storefront[] = data.storefronts.map((s) => ({
  osmId: s.osmId,
  name: s.name,
  category: s.category,
  street: (s as { "addr:street"?: string })["addr:street"] ?? "",
  point: at(s.point),
}));

export type MonumentKind = "artwork" | "monument" | "memorial" | "fountain";
export interface Monument extends Located {
  kind: MonumentKind;
  name: string;
  artist: string;
  material: string;
  wikidata: string;
}
export const monuments: Monument[] = data.monuments.map((m) => {
  const v = m as Record<string, unknown>;
  return {
    osmId: m.osmId,
    kind: m.kind as MonumentKind,
    name: String(v.name ?? ""),
    artist: String(v.artist_name ?? ""),
    material: String(v.material ?? ""),
    wikidata: String(v.wikidata ?? ""),
    point: at(m.point),
  };
});

export const mappedTrees: Located[] = data.trees.map((t) => ({
  osmId: t.osmId,
  point: at(t.point),
}));
export const mappedLamps: Located[] = data.lamps.map((t) => ({
  osmId: t.osmId,
  point: at(t.point),
}));
export const mappedBenches: (Located & { kind: string })[] = data.benches.map((t) => ({
  osmId: t.osmId,
  kind: t.kind,
  point: at(t.point),
}));
export const bikeshare: Located[] = data.bikeshare.map((t) => ({
  osmId: t.osmId,
  point: at(t.point),
}));
export interface BusStop extends Located {
  name: string;
  shelter: boolean;
}
export const busStops: BusStop[] = data.busStops.map((s) => {
  const v = s as Record<string, unknown>;
  return {
    osmId: s.osmId,
    name: String(v.name ?? ""),
    shelter: v.shelter === "yes",
    point: at(s.point),
  };
});

export interface ConstructionWork {
  osmId: string;
  kind: "rail" | "site";
  name: string;
  tunnel: boolean;
  points: Point[];
}
export const construction: ConstructionWork[] = data.construction.map((c) => {
  const v = c as Record<string, unknown>;
  return {
    osmId: c.osmId,
    kind: c.kind as "rail" | "site",
    name: String(v.name ?? ""),
    tunnel: v.tunnel === "yes",
    points: c.coordinates.map(at),
  };
});

/** Colour/material tags joined by OSM ID and matching version only. */
export const buildingAttributes = new Map(
  data.buildingAttributes.map((a) => {
    const v = a as Record<string, unknown>;
    return [
      a.osmId,
      {
        colour: typeof v["building:colour"] === "string" ? v["building:colour"] : null,
        roofColour: typeof v["roof:colour"] === "string" ? v["roof:colour"] : null,
        material:
          typeof v["building:material"] === "string" ? v["building:material"] : null,
        roofShape: typeof v["roof:shape"] === "string" ? v["roof:shape"] : null,
      },
    ] as const;
  }),
);

/** The nearest footprint to a storefront point, for façade signage placement. */
export function storefrontBuilding(s: Storefront): Building | undefined {
  const containing = buildingAt(s.point);
  if (containing) return containing;
  let best: Building | undefined,
    d = 18;
  for (const b of buildings) {
    if (Math.abs(b.center.x - s.point.x) > 80 || Math.abs(b.center.z - s.point.z) > 80)
      continue;
    for (const v of b.ring) {
      const q = distance(v, s.point);
      if (q < d) {
        d = q;
        best = b;
      }
    }
  }
  return best;
}

export interface BusRoute {
  osmId: string;
  name: string;
  ref: string;
  operator: string;
  /** Road-graph node IDs in travel order. Consecutive pairs need not be adjacent. */
  waypoints: string[];
  /** Waypoint indices where a mapped stop lies within 30 m of the route. */
  stopAt: Set<number>;
  stopNames: string[];
  loop: boolean;
  /** Waypoint links that are not a single mapped road edge. */
  inferredLinks: number;
}
function edgeBetween(a: string, b: string) {
  return roads.nodes.get(a)?.out.some((i) => roads.edges[i]!.to === b) ?? false;
}
export const busRoutes: BusRoute[] = data.busRoutes
  .map((r) => {
    const v = r as Record<string, unknown>;
    // Keep only nodes the road graph actually contains, in relation order.
    const waypoints: string[] = [];
    for (const chain of r.chains)
      for (const id of chain)
        if (roads.nodes.get(id)?.out.length && waypoints.at(-1) !== id)
          waypoints.push(id);
    let inferredLinks = 0;
    for (let i = 1; i < waypoints.length; i++)
      if (!edgeBetween(waypoints[i - 1]!, waypoints[i]!)) inferredLinks++;
    const stopAt = new Set<number>(),
      stopNames: string[] = [];
    for (const s of r.stops) {
      const p = at(s.point);
      let best = -1,
        d = 30;
      waypoints.forEach((id, i) => {
        const q = distance(roads.nodes.get(id)!, p);
        if (q < d) {
          d = q;
          best = i;
        }
      });
      if (best >= 0 && !stopAt.has(best)) {
        stopAt.add(best);
        stopNames.push(s.name);
      }
    }
    const first = waypoints[0],
      last = waypoints.at(-1);
    return {
      osmId: r.osmId,
      name: String(v.name ?? ""),
      ref: String(v.ref ?? ""),
      operator: String(v.operator ?? ""),
      waypoints,
      stopAt,
      stopNames,
      loop:
        !!first &&
        !!last &&
        distance(roads.nodes.get(first)!, roads.nodes.get(last)!) < 40,
      inferredLinks,
    };
  })
  .filter((r) => r.waypoints.length >= 8);

/** Sidewalk nodes beside mapped bus stops, where commuters wait. */
export const stopNodes = busStops.map((s) => nearest(sidewalks, s.point).id);
