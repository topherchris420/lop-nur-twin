import {
  buildings,
  buildingAt,
  crossings,
  distance,
  lerp,
  parks,
  pathWays,
  roadWays,
  signalPoints,
  type Point,
  type Way,
} from "./model";
export interface Node extends Point {
  id: string;
  out: number[];
  portal: boolean;
  gathering: boolean;
}
export interface Edge {
  id: number;
  from: string;
  to: string;
  length: number;
  heading: number;
  width: number;
  crossing: boolean;
  signal: boolean;
  inferred: boolean;
  /** The OSM way name this edge was built from ("" when unnamed or inferred). */
  name: string;
}
export interface Network {
  nodes: Map<string, Node>;
  edges: Edge[];
  routeCache: Map<string, Map<string, number>>;
  incoming: Map<string, number[]>;
}
function make(ways: Way[], walking: boolean): Network {
  const net: Network = {
    nodes: new Map(),
    edges: [],
    routeCache: new Map(),
    incoming: new Map(),
  };
  const edge = (a: Node, b: Node, w: Way, inferred = false) => {
    const length = distance(a, b);
    if (length < 0.1) return;
    const e: Edge = {
      id: net.edges.length,
      from: a.id,
      to: b.id,
      length,
      heading: Math.atan2(b.x - a.x, b.z - a.z),
      width: w.width,
      crossing:
        w.crossing ||
        (walking && crossings.some((p) => distance(p.point, lerp(a, b, 0.5)) < 3)),
      signal: signalPoints.some((p) => distance(p.point, b) < 13),
      inferred,
      name: inferred ? "" : w.name,
    };
    net.edges.push(e);
    a.out.push(e.id);
  };
  for (const w of ways) {
    w.points.forEach((p, i) => {
      const id = w.nodeIds[i]!;
      if (!net.nodes.has(id))
        net.nodes.set(id, { ...p, id, out: [], portal: false, gathering: false });
    });
    for (let i = 1; i < w.points.length; i++) {
      const a = net.nodes.get(w.nodeIds[i - 1]!)!,
        b = net.nodes.get(w.nodeIds[i]!)!;
      if (walking || w.oneWay >= 0) edge(a, b, w);
      if (walking || w.oneWay <= 0) edge(b, a, w);
    }
  }
  if (walking) {
    const ends = [...net.nodes.values()].filter((n) => n.out.length === 1);
    for (const a of ends) {
      let best: Node | undefined,
        d = 6;
      for (const b of net.nodes.values()) {
        const q = distance(a, b);
        if (
          q > 0.3 &&
          q < d &&
          !a.out.some((i) => net.edges[i]!.to === b.id) &&
          !buildingAt(lerp(a, b, 0.5))
        ) {
          best = b;
          d = q;
        }
      }
      if (best) {
        const w: Way = {
          id: "inferred",
          name: "Short sidewalk connector",
          points: [],
          nodeIds: [],
          width: 2.4,
          widthEvidence: "class default",
          crossing: false,
          oneWay: 0,
          highway: "footway",
        };
        edge(a, best, w, true);
        edge(best, a, w, true);
      }
    }
    for (const n of net.nodes.values()) {
      n.gathering = parks.some((p) => p.ring.some((v) => distance(n, v) < 15));
      n.portal =
        buildings.some((b) => b.ring.some((v) => distance(n, v) < 7)) &&
        !n.out.some((i) => net.edges[i]!.crossing);
    }
  }
  for (const e of net.edges)
    net.incoming.set(e.to, [...(net.incoming.get(e.to) ?? []), e.id]);
  return net;
}
export const roads = make(roadWays, false),
  sidewalks = make(pathWays, true);
export function nearest(
  net: Network,
  p: Point,
  filter: (n: Node) => boolean = () => true,
): Node {
  let best: Node | undefined,
    d = Infinity;
  for (const n of net.nodes.values()) {
    if (!n.out.length || !filter(n)) continue;
    const q = distance(p, n);
    if (q < d) {
      best = n;
      d = q;
    }
  }
  if (!best) throw new Error("No reachable network node");
  return best;
}
export function position(net: Network, e: Edge, progress: number, lane = 0): Point {
  const p = lerp(
    net.nodes.get(e.from)!,
    net.nodes.get(e.to)!,
    Math.min(1, progress / e.length),
  );
  return { x: p.x + Math.cos(e.heading) * lane, z: p.z - Math.sin(e.heading) * lane };
}
/**
 * A short, process-wide name for a closure set's contents (its sorted edge
 * ids), memoised per set object: simulations replace, never mutate, their
 * closure sets. Cached route trees are keyed by it, so they are keyed by what
 * is actually closed. A per-simulation counter would let simulations sharing
 * these module-level networks (the live city, Reset, Verify replay, lab arms)
 * reuse each other's trees. Equal contents share a name; a name is never
 * reused for different contents, even after the interning table is dropped.
 */
const closureNames = new WeakMap<ReadonlySet<number>, number>();
let closureContents = new Map<string, number>(),
  nextClosureName = 0;
function closureName(closed: ReadonlySet<number>): number {
  let name = closureNames.get(closed);
  if (name === undefined) {
    const contents = [...closed].sort((a, b) => a - b).join(",");
    name = closureContents.get(contents);
    if (name === undefined) {
      if (closureContents.size >= 4096) closureContents = new Map();
      name = ++nextClosureName;
      closureContents.set(contents, name);
    }
    closureNames.set(closed, name);
  }
  return name;
}
/**
 * The first edge of a shortest-hop route from `from` to `target`, avoiding
 * `closed` edges. Cached trees are keyed by the closure set's contents, so the
 * answer depends only on `(net, from, target, closed)`, never on what another
 * simulation routed before.
 */
export function nextToward(
  net: Network,
  from: string,
  target: string,
  closed?: ReadonlySet<number>,
): number | undefined {
  const key = closed?.size ? `${closureName(closed)}:${target}` : target;
  let map = net.routeCache.get(key);
  if (!map) {
    map = new Map();
    const queue = [target],
      seen = new Set(queue);
    for (let i = 0; i < queue.length; i++)
      for (const id of net.incoming.get(queue[i]!) ?? []) {
        const e = net.edges[id]!;
        if (seen.has(e.from) || closed?.has(id)) continue;
        seen.add(e.from);
        queue.push(e.from);
        map.set(e.from, e.id);
      }
    if (net.routeCache.size >= 256)
      net.routeCache.delete(net.routeCache.keys().next().value!);
    net.routeCache.set(key, map);
  }
  return map.get(from);
}
/** Illustrative 50 s cycle, shared by cars, walkers and the rendered lamps. */
export function green(tick: number, e: Edge): boolean {
  if (!e.signal) return true;
  const phase = tick % 500;
  return Math.abs(Math.cos(e.heading)) > 0.7 ? phase < 210 : phase >= 250 && phase < 460;
}
