/**
 * The four perspectives outside the lab, bounded.
 *
 * An outing is presentation: an avatar walks the mapped sidewalks from the
 * lab's door to a place from the closed vocabulary, pauses, and walks back.
 * It is not a simulation agent — nothing in the city can see, bump into or
 * react to it — and its clock is the city's tick, so it stops when the city is
 * paused. Where it stands is a place to look, never a thing that was seen:
 *
 *   avatar enters the observation region
 *     → the host checks the region rule (within 40 m of the place)
 *     → the read-only tools and the world-observation packet are computed
 *       from simulator state at that tick
 *     → provenance names the tick, the state hash and the observer
 *     → the observation is recorded with the session
 *
 * At most two outings at a time, each at most 1.5 km long.
 */
import { distance, type Point } from "../model";
import { sidewalks, nearest } from "../network";
import type { CitySimulation } from "../simulation";
import { LOCATION_LABELS, type LocationId, type Perspective } from "./contracts";
import { LAB_DOOR } from "./site";
import { REGION_RADIUS, locationPoint, runTool, type ToolResult } from "./tools";
import { observeWorld, type WorldObservation } from "./observations";
import type { ExperimentRecord } from "./record";

export const AVATAR_OBSERVATION_SCHEMA = "bethesda-avatar-observation/v1" as const;
/** Presentation pace: metres per city tick (3 m/s). */
export const PACE = 0.3;
const DWELL_TICKS = 60;
export const MAX_OUTINGS = 2;
const MAX_PATH = 1500;

/** What a renderer needs to draw an avatar on an outing. */
export interface PresenceMark {
  who: Perspective;
  x: number;
  z: number;
  phase: "out" | "observing" | "back";
}
export interface Outing {
  id: string;
  who: Perspective;
  location: LocationId;
  path: Point[];
  cumulative: number[];
  length: number;
  startTick: number;
  observation: AvatarObservation | null;
  refused: string | null;
}
export interface AvatarObservation {
  schema: typeof AVATAR_OBSERVATION_SCHEMA;
  who: Perspective;
  location: LocationId;
  place: string;
  tick: number;
  /** The avatar's own position when it asked — recorded, never measured from. */
  observer_at: Point;
  packet: WorldObservation;
  tools: ToolResult[];
  note: string;
}

/**
 * Shortest sidewalk route by length (Dijkstra over the mapped footways),
 * computed here so the city's own route caches are never touched. It ends on
 * the mapped sidewalk node nearest the place, never inside a building.
 */
function route(from: Point, to: Point): Point[] | null {
  const a = nearest(sidewalks, from),
    b = nearest(sidewalks, to);
  const best = new Map<string, number>([[a.id, 0]]);
  const previous = new Map<string, string>();
  // A binary heap of [distance, node id].
  const heap: [number, string][] = [[0, a.id]];
  const push = (item: [number, string]) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (heap[parent]![0] <= heap[i]![0]) break;
      [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
      i = parent;
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
    const [d, id] = pop();
    if (id === b.id) break;
    if (d > (best.get(id) ?? Infinity) || d > MAX_PATH) continue;
    for (const edge of sidewalks.nodes.get(id)!.out) {
      const e = sidewalks.edges[edge]!;
      const next = d + e.length;
      if (next < (best.get(e.to) ?? Infinity)) {
        best.set(e.to, next);
        previous.set(e.to, id);
        push([next, e.to]);
      }
    }
  }
  if (!best.has(b.id)) return null;
  const ids = [b.id];
  while (ids.at(-1) !== a.id) ids.push(previous.get(ids.at(-1)!)!);
  ids.reverse();
  return [
    from,
    ...ids.map((id) => ({
      x: sidewalks.nodes.get(id)!.x,
      z: sidewalks.nodes.get(id)!.z,
    })),
  ];
}

export function planOuting(
  who: Perspective,
  location: LocationId,
  startTick: number,
  id: string,
): Outing | { error: string } {
  const target = locationPoint(location);
  if (!LAB_DOOR || !target) return { error: "that place is not on the map" };
  const path = route(LAB_DOOR.point, target);
  if (!path) return { error: "no sidewalk route reaches that place" };
  const cumulative = [0];
  for (let i = 1; i < path.length; i++)
    cumulative.push(cumulative[i - 1]! + distance(path[i - 1]!, path[i]!));
  const length = cumulative.at(-1)!;
  if (length > MAX_PATH)
    return { error: `that place is more than ${MAX_PATH} m away on foot` };
  return {
    id,
    who,
    location,
    path,
    cumulative,
    length,
    startTick,
    observation: null,
    refused: null,
  };
}

function along(o: Outing, s: number): Point {
  const d = Math.max(0, Math.min(o.length, s));
  let i = 1;
  while (i < o.cumulative.length - 1 && o.cumulative[i]! < d) i++;
  const a = o.path[i - 1]!,
    b = o.path[i]!,
    span = o.cumulative[i]! - o.cumulative[i - 1]! || 1;
  const t = (d - o.cumulative[i - 1]!) / span;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}
/** Where the avatar is drawn at a tick, and which way along its walk. */
export function positionAt(o: Outing, tick: number) {
  const elapsed = Math.max(0, tick - o.startTick) * PACE;
  const out = o.length,
    dwell = DWELL_TICKS * PACE;
  if (elapsed <= out) return { point: along(o, elapsed), phase: "out" as const };
  if (elapsed <= out + dwell)
    return { point: along(o, out), phase: "observing" as const };
  if (elapsed <= 2 * out + dwell)
    return { point: along(o, 2 * out + dwell - elapsed), phase: "back" as const };
  return { point: along(o, 0), phase: "done" as const };
}

/**
 * Once the avatar is in the region, the simulator observes — once — through
 * the region-gated tools and a world-observation packet. Reads only.
 */
export function observeIfArrived(
  o: Outing,
  sim: CitySimulation,
  records: readonly ExperimentRecord[],
): AvatarObservation | null {
  if (o.observation || o.refused) return null;
  const at = positionAt(o, sim.tick);
  if (at.phase !== "observing") return null;
  const center = locationPoint(o.location)!;
  const observer = { who: o.who, at: at.point };
  const tools = (
    [
      { tool: "observe_nearby_actors", location: o.location },
      { tool: "inspect_local_pedestrian_state", location: o.location },
      { tool: "inspect_local_traffic_state", location: o.location },
      { tool: "inspect_current_event", location: o.location },
    ] as const
  ).map((request) => runTool(request, { sim, records, observer }));
  if (tools.some((t) => !t.ok)) {
    o.refused = `the region rule refused the observation (${distance(at.point, center).toFixed(0)} m from ${LOCATION_LABELS[o.location]}; the limit is ${REGION_RADIUS} m)`;
    return null;
  }
  o.observation = {
    schema: AVATAR_OBSERVATION_SCHEMA,
    who: o.who,
    location: o.location,
    place: LOCATION_LABELS[o.location],
    tick: sim.tick,
    observer_at: {
      x: Math.round(at.point.x * 10) / 10,
      z: Math.round(at.point.z * 10) / 10,
    },
    packet: observeWorld(sim, {
      subject: `${o.who.toLowerCase()} at ${o.location}`,
      experimentId: null,
      arm: "live",
      region: {
        location: o.location,
        center,
        near_m: 40,
        region_m: 150,
        catchment_m: 150,
      },
      cohort: null,
      replayId: "live-city",
    }),
    tools,
    note: `${o.who}'s avatar marked where to look. Every value was computed by the simulator from its own state at tick ${sim.tick}; the avatar's position is not evidence.`,
  };
  return o.observation;
}
