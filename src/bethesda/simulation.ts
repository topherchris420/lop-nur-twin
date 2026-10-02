/**
 * The authoritative Bethesda city simulation. No renderer imports.
 *
 * Fixed 0.1 s ticks, one seeded generator, every external input recorded as a
 * tick-stamped command. Decisions — whoever proposed them — pass the same
 * legal-action gate and are recorded with their observation, source, reason,
 * before/after state and outcome tick, so a trace replays to identical hashes.
 *
 * Three levels of detail, all inside this deterministic loop:
 *   full        every tick (near the recorded focus, near any event, all
 *               responders and buses);
 *   coarse      every fourth tick with a 4× step (far from focus);
 *   statistical district cohorts updated as stocks at 1 Hz.
 * The focus that selects full/coarse is itself a recorded command, which is
 * what keeps a hardware- or camera-driven budget out of the experiment's
 * nondeterminism. Individuals never convert into cohort members or back.
 */
import { mulberry32 } from "../lib/noise";
import { canonicalHash } from "../game/pilot/hash";
import {
  DATA_VERSION,
  arrival,
  buildingAt,
  buildings,
  bounds,
  distance,
  inBounds,
  lerp,
  metro,
  moveWithCollision,
  places,
  rescue,
  row,
  type Point,
} from "./model";
import {
  roads,
  sidewalks,
  green,
  nearest,
  nextToward,
  position,
  type Edge,
  type Network,
} from "./network";
import {
  ACTIONS,
  CITY_SCHEMA,
  legalActions,
  validateObservation,
  validateProposal,
  type Action,
  type AgentKind,
  type Observation,
  type Persona,
  type Role,
} from "./contract";
import {
  EVENT_EFFECTS,
  PROCESSION,
  validScenario,
  type Scenario,
  type CityEvent,
} from "./scenarios";
import {
  busRoutes,
  stopNodes,
  storefronts,
  monuments,
  TRANSIT_VERSION,
} from "./streetscape";
import { TERRAIN_VERSION, groundAt } from "./terrain";

export const DT = 0.1;
export const SIM_VERSION = "bethesda-city/3";
export const REPLAY_SCHEMA = "bethesda-replay/v3";
export interface Config {
  seed: number;
  pedestrians: number;
  vehicles: number;
  buses: number;
  statisticalPopulation: number;
}
export const PROFILES: Config[] = [
  { seed: 393977, pedestrians: 140, vehicles: 32, buses: 6, statisticalPopulation: 900 },
  {
    seed: 393977,
    pedestrians: 360,
    vehicles: 70,
    buses: 14,
    statisticalPopulation: 1800,
  },
  {
    seed: 393977,
    pedestrians: 640,
    vehicles: 110,
    buses: 20,
    statisticalPopulation: 2800,
  },
];
/** Focus radius for full-rate simulation, per hardware profile. */
export const FOCUS_RADII = [280, 420, 650];
export type SimKind = AgentKind | "bus";
export type GoalKind =
  | "metro"
  | "bus"
  | "shop"
  | "work"
  | "home"
  | "sight"
  | "wander"
  | "away"
  | "shelter"
  | "post"
  | "base"
  | "route";
export interface Agent {
  id: number;
  kind: SimKind;
  role: Role;
  persona: Persona;
  edge: number;
  progress: number;
  point: Point;
  lane: number;
  speed: number;
  action: Action;
  until: number;
  inside: boolean;
  goal: string;
  goalKind: GoalKind;
  trait: number;
  curiosity: number;
  caution: number;
  color: number;
  lastVisit: number;
  /** Event ID a responder is assigned to (0 = available). */
  assignment: number;
  /** Responder home node; bus route index; −1 when not applicable. */
  base: string;
  route: number;
  waypoint: number;
  /** Ticks held at a stop line or behind a closure. */
  hold: number;
  /** 0 on foot, 1 riding the Metro, 2 riding a bus. */
  riding: number;
}
interface Snapshot {
  point: Point;
  action: Action;
  inside: boolean;
}
export interface Decision {
  tick: number;
  observation: Observation;
  proposed: unknown;
  action: Action;
  source: "rules" | "jev" | "fallback" | "human";
  reason: string;
  before: Snapshot;
  after: Snapshot;
  outcomeTick: number;
}
type Command = (
  | { type: "scenario"; scenario: Scenario }
  | {
      type: "decision";
      observation: Observation;
      proposal: unknown;
      failure: string | null;
    }
  | { type: "human"; action: Action }
  | { type: "move"; dx: number; dz: number }
  | { type: "focus"; x: number; z: number; radius: number }
) & { tick: number };
export interface Trace {
  schema: typeof REPLAY_SCHEMA;
  simVersion: typeof SIM_VERSION;
  dataVersion: string;
  terrainVersion: string;
  transitVersion: string;
  config: Config;
  tick: number;
  commands: Command[];
  decisions: Decision[];
  checkpoints: { tick: number; hash: string }[];
  finalHash: string;
}
export interface District {
  point: Point;
  occupants: number;
  outdoors: number;
  sheltering: number;
  watching: number;
  evacuated: number;
}
function configOK(c: Config) {
  return (
    !!c &&
    Number.isInteger(c.seed) &&
    c.seed >= 0 &&
    c.seed <= 0xffffffff &&
    Number.isInteger(c.pedestrians) &&
    c.pedestrians >= 1 &&
    c.pedestrians <= 640 &&
    Number.isInteger(c.vehicles) &&
    c.vehicles >= 0 &&
    c.vehicles <= 110 &&
    Number.isInteger(c.buses) &&
    c.buses >= 0 &&
    c.buses <= 24 &&
    Number.isInteger(c.statisticalPopulation) &&
    c.statisticalPopulation >= 0 &&
    c.statisticalPopulation <= 2800
  );
}
const snapshot = (a: Agent): Snapshot => ({
  point: { ...a.point },
  action: a.action,
  inside: a.inside,
});
const MOVING: ReadonlySet<Action> = new Set([
  "continue",
  "leave",
  "shelter",
  "cross",
  "drive",
  "detour",
  "pull_over",
  "respond",
]);
const STILL: ReadonlySet<Action> = new Set(["wait", "watch", "record", "gather"]);

// --- Destinations, derived once from the real map --------------------------
const walkNodes = [...sidewalks.nodes.values()].filter((n) => n.out.length);
const near = (p: Point, max = 30) => {
  const n = nearest(sidewalks, p);
  return distance(n, p) <= max ? n.id : null;
};
const unique = (ids: (string | null)[]) =>
  [...new Set(ids.filter((v): v is string => !!v))].sort();
const portalNear = (types: string[]) =>
  unique(
    buildings
      .filter((b) => types.includes(b.type))
      .flatMap((b) => {
        const n = nearest(sidewalks, b.center, (n) => n.portal);
        return distance(n, b.center) < 80 ? [n.id] : [];
      }),
  );
export const DESTINATIONS: Record<
  "metro" | "bus" | "shop" | "work" | "home" | "sight",
  string[]
> = {
  metro: unique(places.filter((p) => p.kind === "metro").map((p) => near(p.point, 40))),
  bus: unique(stopNodes),
  shop: unique(storefronts.map((s) => near(s.point, 25))),
  work: portalNear(["office", "commercial", "hotel", "civic", "transportation"]),
  home: portalNear(["house", "detached", "residential", "apartments", "terrace"]),
  sight: unique([
    ...monuments.map((m) => near(m.point, 30)),
    ...walkNodes.filter((n) => n.gathering).map((n) => n.id),
  ]),
};
const METRO_NODES = new Set(DESTINATIONS.metro),
  STOP_NODES = new Set(DESTINATIONS.bus);
/** Police have no mapped station inside the extract; they stage at its edges. */
function boundaryNode(street: string, pick: (a: Point, b: Point) => boolean) {
  let best: string | undefined;
  for (const e of roads.edges)
    if (e.name === street) {
      const n = roads.nodes.get(e.from)!;
      if (n.out.length && (!best || pick(n, roads.nodes.get(best)!))) best = n.id;
    }
  return best ?? nearest(roads, row.point).id;
}
const POLICE_BASES = [
  boundaryNode("Wisconsin Avenue", (a, b) => a.z < b.z),
  boundaryNode("Wisconsin Avenue", (a, b) => a.z > b.z),
  boundaryNode("Old Georgetown Road", (a, b) => a.x < b.x),
];
const RESCUE_BASE = nearest(roads, rescue.point).id;
const RESPONDERS: Role[] = [
  "engine",
  "engine",
  "engine",
  "ambulance",
  "ambulance",
  "police",
  "police",
  "police",
];
const roadMid = roads.edges.map((e) => position(roads, e, e.length / 2));
const walkMid = sidewalks.edges.map((e) => position(sidewalks, e, e.length / 2));
let roadGround: number[] | null = null,
  walkGround: number[] | null = null;
/** Signal-controlled road edges ending near each sidewalk crossing edge. */
const crossingSignals = new Map<number, number[]>();
function signalsFor(e: Edge): number[] {
  let list = crossingSignals.get(e.id);
  if (!list) {
    const end = sidewalks.nodes.get(e.to)!;
    list = roads.edges
      .filter((r) => r.signal && distance(roads.nodes.get(r.to)!, end) < 18)
      .map((r) => r.id);
    crossingSignals.set(e.id, list);
  }
  return list;
}

/** Uniform 16 m grid over agents, rebuilt each tick in agent-ID order. */
class Grid {
  private cells = new Map<number, Agent[]>();
  private key(x: number, z: number) {
    return (Math.floor(x / 16) + 4096) * 8192 + (Math.floor(z / 16) + 4096);
  }
  rebuild(agents: Agent[]) {
    this.cells.clear();
    for (const a of agents) {
      if (a.inside) continue;
      const k = this.key(a.point.x, a.point.z);
      const list = this.cells.get(k);
      if (list) list.push(a);
      else this.cells.set(k, [a]);
    }
  }
  /** Visits agents within r of p until `fn` returns true. */
  some(p: Point, r: number, fn: (a: Agent) => boolean): boolean {
    const x0 = Math.floor((p.x - r) / 16),
      x1 = Math.floor((p.x + r) / 16),
      z0 = Math.floor((p.z - r) / 16),
      z1 = Math.floor((p.z + r) / 16);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const list = this.cells.get((x + 4096) * 8192 + (z + 4096));
        if (list)
          for (const a of list) if (distance(a.point, p) < r && fn(a)) return true;
      }
    return false;
  }
  count(p: Point, r: number, fn: (a: Agent) => boolean, cap = 99): number {
    let n = 0;
    this.some(p, r, (a) => fn(a) && ++n >= cap);
    return n;
  }
}

interface ProcessionGeometry {
  points: Point[];
  cum: number[];
  total: number;
}
export interface ProcessionState extends ProcessionGeometry {
  head: number;
  tail: number;
}
const pointAlong = (g: ProcessionGeometry, s: number): Point => {
  const d = Math.max(0, Math.min(g.total, s));
  let i = 1;
  while (i < g.cum.length - 1 && g.cum[i]! < d) i++;
  const span = g.cum[i]! - g.cum[i - 1]!;
  return lerp(g.points[i - 1]!, g.points[i]!, span > 0 ? (d - g.cum[i - 1]!) / span : 0);
};
function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    l = dx * dx + dz * dz;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}

export class CitySimulation {
  readonly agents: Agent[] = [];
  readonly events: CityEvent[] = [];
  readonly commands: Command[] = [];
  readonly decisions: Decision[] = [];
  readonly checkpoints: { tick: number; hash: string }[] = [];
  readonly districts: District[] = [];
  readonly config: Config;
  tick = 0;
  paused = false;
  player: Point = { ...arrival };
  focus: Point = { ...arrival };
  focusRadius = FOCUS_RADII[1]!;
  recordingComplete = true;
  /** Rules decisions folded into an open record (counted, not stored). */
  reaffirmed = 0;
  /** Derived each refresh; never hashed directly (the events that cause them are). */
  closedRoads: ReadonlySet<number> = new Set();
  closedWalks: ReadonlySet<number> = new Set();
  closureVersion = 0;
  private closureKey = "";
  private rng: () => number;
  private eventId = 0;
  private activeDecision = new Map<number, number>();
  private grid = new Grid();
  private roadOccupancy = new Map<number, Agent[]>();
  private geometry = new Map<number, ProcessionGeometry>();
  constructor(config: Config = PROFILES[1]!) {
    if (!configOK(config)) throw new Error("Invalid city configuration");
    this.config = { ...config };
    this.rng = mulberry32(config.seed);
    const pedestrianEdges = sidewalks.edges.filter((e) => !buildingAt(walkMid[e.id]!));
    // Illustrative daytime concentration around the two real public anchors.
    // This is a sampling policy, not a claim about measured pedestrian demand.
    const coreEdges = pedestrianEdges.filter((e) => {
      const p = walkMid[e.id]!;
      return distance(p, row.point) < 160 || distance(p, metro.point) < 120;
    });
    const vehicleEdges = roads.edges.filter((e) => !buildingAt(roadMid[e.id]!));
    const personas: Persona[] = ["commuter", "shopper", "resident", "worker", "visitor"];
    const weights = [0.25, 0.5, 0.7, 0.9, 1];
    for (let i = 0; i < config.pedestrians; i++) {
      const pool = i % 2 === 0 && coreEdges.length ? coreEdges : pedestrianEdges;
      const e = pool[Math.floor(this.rng() * pool.length)]!;
      const progress = this.rng() * e.length,
        r = this.rng();
      this.agents.push(
        this.agent(
          i,
          "pedestrian",
          "walker",
          personas[weights.findIndex((w) => r < w)]!,
          sidewalks,
          e,
          progress,
          1.05 + this.rng() * 0.65,
        ),
      );
    }
    for (let i = 0; i < config.vehicles; i++) {
      const e = vehicleEdges[Math.floor(this.rng() * vehicleEdges.length)]!;
      this.agents.push(
        this.agent(
          this.agents.length,
          "vehicle",
          "car",
          "none",
          roads,
          e,
          this.rng() * e.length,
          5 + this.rng() * 4,
        ),
      );
    }
    // Buses: the Circulator first, then each mapped route in relation order.
    const order = [...busRoutes.keys()].sort(
      (a, b) =>
        Number(busRoutes[b]!.ref === "Circulator") -
          Number(busRoutes[a]!.ref === "Circulator") || a - b,
    );
    for (let i = 0; i < config.buses && order.length; i++) {
      const routeIndex = order[i % order.length]!,
        route = busRoutes[routeIndex]!;
      const lap = Math.floor(i / order.length) + 1;
      const wp = Math.floor(
        (route.waypoints.length * (lap % 2 ? 0.1 : 0.55)) % route.waypoints.length,
      );
      const from = route.waypoints[wp]!;
      const out = roads.nodes.get(from)!.out;
      const e =
        roads.edges[
          nextToward(roads, from, route.waypoints[(wp + 1) % route.waypoints.length]!) ??
            out[0]!
        ]!;
      const bus = this.agent(this.agents.length, "bus", "bus", "none", roads, e, 0, 7);
      bus.route = routeIndex;
      bus.waypoint = (wp + 1) % route.waypoints.length;
      bus.goal = route.waypoints[bus.waypoint]!;
      bus.goalKind = "route";
      this.agents.push(bus);
    }
    RESPONDERS.forEach((role, k) => {
      const base =
        role === "police" ? POLICE_BASES[k % POLICE_BASES.length]! : RESCUE_BASE;
      const node = roads.nodes.get(base)!;
      const e = roads.edges[node.out[0]!]!;
      const a = this.agent(
        this.agents.length,
        "emergency",
        role,
        "none",
        roads,
        e,
        role === "police" ? 2 : Math.min(e.length, 2 + 6 * k),
        role === "police" ? 13 : 12,
      );
      a.base = base;
      a.action = "park";
      a.until = 100000;
      a.goalKind = "base";
      this.agents.push(a);
    });
    for (let i = 0; i < 12; i++) {
      const occupants =
        Math.floor(config.statisticalPopulation / 12) +
        (i < config.statisticalPopulation % 12 ? 1 : 0);
      this.districts.push({
        point: {
          x: bounds.min.x + (((i % 3) + 0.5) * (bounds.max.x - bounds.min.x)) / 3,
          z:
            bounds.min.z +
            ((Math.floor(i / 3) + 0.5) * (bounds.max.z - bounds.min.z)) / 4,
        },
        occupants,
        outdoors: Math.round(occupants * 0.12),
        sheltering: 0,
        watching: 0,
        evacuated: 0,
      });
    }
  }
  private agent(
    id: number,
    kind: SimKind,
    role: Role,
    persona: Persona,
    net: Network,
    e: Edge,
    progress: number,
    speed: number,
  ): Agent {
    const lane = kind === "pedestrian" ? 0 : Math.min(3, e.width / 4);
    return {
      id,
      kind,
      role,
      persona,
      edge: e.id,
      progress,
      point: position(net, e, progress, lane),
      lane,
      speed,
      action: kind === "pedestrian" ? "continue" : "drive",
      until: Math.floor(this.rng() * 20),
      inside: false,
      goal: "",
      goalKind: "wander",
      trait: this.rng(),
      curiosity: this.rng(),
      caution: this.rng(),
      color: Math.floor(this.rng() * 8),
      lastVisit: -1000,
      assignment: 0,
      base: "",
      route: -1,
      waypoint: 0,
      hold: 0,
      riding: 0,
    };
  }
  private net(a: Agent) {
    return a.kind === "pedestrian" ? sidewalks : roads;
  }
  private append(c: Command) {
    if (this.commands.length >= 30000) {
      this.recordingComplete = false;
      return;
    }
    this.commands.push(structuredClone(c));
  }

  // --- Events and their effects -------------------------------------------
  inject(s: Scenario): boolean {
    if (!validScenario(s) || this.events.length >= 8) return false;
    this.append({ type: "scenario", tick: this.tick, scenario: s });
    const event: CityEvent = {
      ...structuredClone(s),
      id: ++this.eventId,
      startTick: this.tick,
      at: { ...s.point },
    };
    this.events.push(event);
    this.refreshEffects(true);
    this.dispatch(event);
    // People notice: anyone the event touches reconsiders within a second.
    for (const a of this.agents)
      if (!a.inside && !a.assignment && this.involved(a.point))
        a.until = Math.min(a.until, this.tick + 1 + (a.id % 10));
    return true;
  }
  /** Procession geometry is derived from the recorded route, never stored twice. */
  procession(e: CityEvent): ProcessionState | null {
    if (!e.route) return null;
    let g = this.geometry.get(e.id);
    if (!g) {
      const points = e.route.map((id) => ({ ...roads.nodes.get(id)! }));
      const cum = [0];
      for (let i = 1; i < points.length; i++)
        cum.push(cum[i - 1]! + distance(points[i - 1]!, points[i]!));
      g = { points, cum, total: cum.at(-1)! };
      this.geometry.set(e.id, g);
    }
    const head = Math.min(g.total, PROCESSION.speed * (this.tick - e.startTick) * DT);
    const tail = Math.max(
      0,
      PROCESSION.speed * (this.tick - e.startTick) * DT -
        PROCESSION.body[e.intensity - 1]!,
    );
    return { ...g, head, tail };
  }
  /** Distance to an event's footprint: its centre, or a procession's occupied section. */
  eventDistance(p: Point, e: CityEvent): number {
    const s = this.procession(e);
    if (!s) return distance(p, e.at);
    let d = Infinity;
    const a = s.tail,
      b = Math.max(s.head, s.tail + 0.1);
    let prev = pointAlong(s, a);
    for (let i = 1; i < s.cum.length; i++) {
      if (s.cum[i]! <= a) continue;
      const next = pointAlong(s, Math.min(b, s.cum[i]!));
      d = Math.min(d, segmentDistance(p, prev, next));
      prev = next;
      if (s.cum[i]! >= b) break;
    }
    return Number.isFinite(d) ? d : distance(p, pointAlong(s, a));
  }
  /** Moves processions every tick; recomputes closures on change or every 2 s. */
  private refreshEffects(force = false) {
    for (const e of this.events) {
      const s = this.procession(e);
      if (s) e.at = pointAlong(s, (s.head + s.tail) / 2);
    }
    if (!force && (this.tick % 20 !== 0 || !this.events.some((e) => e.route))) return;
    const closedRoads = new Set<number>(),
      closedWalks = new Set<number>();
    for (const e of this.events) {
      const fx = EVENT_EFFECTS[e.kind];
      if (fx.closesRoads === "radius") {
        const r = e.radius * (e.kind === "rally" || e.kind === "festival" ? 0.8 : 1);
        roadMid.forEach((m, i) => distance(m, e.at) < r && closedRoads.add(i));
      } else if (fx.closesRoads === "street") {
        roads.edges.forEach((edge, i) => {
          if (edge.name === e.street && distance(roadMid[i]!, e.at) < e.radius)
            closedRoads.add(i);
        });
      } else if (fx.closesRoads === "flood" && e.level !== undefined) {
        roadGround ??= roadMid.map(groundAt);
        walkGround ??= walkMid.map(groundAt);
        roadMid.forEach(
          (m, i) =>
            roadGround![i]! < e.level! &&
            distance(m, e.at) < e.radius &&
            closedRoads.add(i),
        );
        walkMid.forEach(
          (m, i) =>
            walkGround![i]! < e.level! &&
            distance(m, e.at) < e.radius &&
            closedWalks.add(i),
        );
      } else if (fx.closesRoads === "procession") {
        roadMid.forEach((m, i) => this.eventDistance(m, e) < 16 && closedRoads.add(i));
        sidewalks.edges.forEach(
          (w, i) =>
            w.crossing && this.eventDistance(walkMid[i]!, e) < 12 && closedWalks.add(i),
        );
      }
      if (fx.closesWalks > 0 && fx.closesRoads !== "flood") {
        const r = e.radius * fx.closesWalks;
        walkMid.forEach((m, i) => distance(m, e.at) < r && closedWalks.add(i));
      }
    }
    const key =
      [...closedRoads].sort((a, b) => a - b).join(",") +
      "|" +
      [...closedWalks].sort((a, b) => a - b).join(",");
    if (key !== this.closureKey) {
      this.closureKey = key;
      this.closedRoads = closedRoads;
      this.closedWalks = closedWalks;
      this.closureVersion++;
    }
  }
  /** Road nodes where an open road enters the closure: where a perimeter forms. */
  perimeterPosts(e: CityEvent, n: number): string[] {
    const posts: string[] = [];
    const closed = this.closedRoads;
    const entries = [
      ...new Set(
        roads.edges
          .filter((edge) => closed.has(edge.id))
          .map((edge) => edge.from)
          .filter((id) => (roads.incoming.get(id) ?? []).some((i) => !closed.has(i))),
      ),
    ].sort(
      (a, b) =>
        this.eventDistance(roads.nodes.get(a)!, e) -
          this.eventDistance(roads.nodes.get(b)!, e) || (a < b ? -1 : 1),
    );
    for (const id of entries)
      if (
        posts.length < n &&
        posts.every((p) => distance(roads.nodes.get(p)!, roads.nodes.get(id)!) > 30)
      )
        posts.push(id);
    while (posts.length < n)
      posts.push(nearest(roads, e.at, (node) => !posts.includes(node.id)).id);
    return posts;
  }
  private dispatch(e: CityEvent) {
    const need = EVENT_EFFECTS[e.kind].dispatch(e.intensity);
    const posts = this.perimeterPosts(e, need.police);
    for (const role of ["engine", "ambulance", "police"] as const) {
      const units = this.agents
        .filter((a) => a.role === role && !a.assignment)
        .sort((a, b) => distance(a.point, e.at) - distance(b.point, e.at) || a.id - b.id)
        .slice(0, need[role]);
      units.forEach((a, i) => {
        a.assignment = e.id;
        a.goal = role === "police" ? posts[i]! : nearest(roads, e.at).id;
        a.goalKind = "post";
        a.until = this.tick;
      });
    }
  }
  private hazardOf(p: Point) {
    let best: { e: CityEvent; d: number } | null = null;
    for (const e of this.events) {
      const fx = EVENT_EFFECTS[e.kind];
      if (!fx.avoid) continue;
      const d = this.eventDistance(p, e);
      if (d < e.radius * fx.avoid + 60 && (!best || d < best.d)) best = { e, d };
    }
    return best;
  }
  private attractionOf(p: Point) {
    let best: { e: CityEvent; d: number } | null = null;
    for (const e of this.events) {
      const fx = EVENT_EFFECTS[e.kind];
      if (!fx.attract) continue;
      const d = this.eventDistance(p, e);
      if (d < e.radius + fx.attract && (!best || d < best.d)) best = { e, d };
    }
    return best;
  }
  /** Whether any event touches this point (hazard, attraction or areal effect). */
  involved(p: Point): boolean {
    return (
      !!this.hazardOf(p) ||
      !!this.attractionOf(p) ||
      this.events.some(
        (e) =>
          (EVENT_EFFECTS[e.kind].shelter || EVENT_EFFECTS[e.kind].signalsDark) &&
          distance(p, e.at) < e.radius,
      )
    );
  }
  private dark(p: Point) {
    return this.events.some(
      (e) => EVENT_EFFECTS[e.kind].signalsDark && distance(p, e.at) < e.radius,
    );
  }
  /** Whether a signal head at this point is lit. Presentation reads this too. */
  signalDark(p: Point) {
    return this.dark(p);
  }
  metroOpen() {
    return !this.events.some((e) => EVENT_EFFECTS[e.kind].metroClosed);
  }
  private slowdown(p: Point) {
    let f = 1;
    for (const e of this.events) {
      const s = EVENT_EFFECTS[e.kind].slowdown;
      if (s < 1 && distance(p, e.at) < e.radius + 100) f = Math.min(f, s);
    }
    return f;
  }

  // --- Observation and rules ------------------------------------------------
  observe(id: number, sequence = 0): Observation {
    const a = this.agents[id];
    if (!a) throw new Error("Unknown agent");
    const net = this.net(a),
      e = net.edges[a.edge]!,
      node = net.nodes.get(e.to)!,
      beforeEnd = e.length - a.progress;
    const pedestrian = a.kind === "pedestrian",
      emergency = a.kind === "emergency";
    const hz = this.hazardOf(a.point),
      at = this.attractionOf(a.point);
    const trafficNearby = this.grid.some(
      a.point,
      14,
      (b) =>
        b.kind !== "pedestrian" &&
        b.id !== id &&
        (b.action === "drive" || b.action === "respond" || b.action === "detour"),
    );
    const crossing = pedestrian && e.crossing;
    const dark = this.dark(node);
    const signals = crossing ? signalsFor(e) : [];
    // Someone already in the crosswalk is committed: finishing is the safe move.
    const committed = crossing && a.progress > 1;
    const safe =
      committed ||
      (!trafficNearby &&
        (dark ||
          !signals.length ||
          signals.every((s) => !green(this.tick, roads.edges[s]!))));
    const blocked = !pedestrian && !emergency && this.closedRoads.has(e.id);
    const opens = node.out.filter(
      (i) => !this.closedRoads.has(i) && net.edges[i]!.to !== e.from,
    );
    const routeClosed =
      !pedestrian && !emergency && beforeEnd < 15 && node.out.length > 0 && !opens.length;
    const atStop = pedestrian && STOP_NODES.has(e.to) && beforeEnd < 4;
    const atMetro = pedestrian && METRO_NODES.has(e.to) && beforeEnd < 4;
    const crowdCount = pedestrian
      ? this.grid.count(
          a.point,
          15,
          (b) => b.kind === "pedestrian" && b.id !== id && STILL.has(b.action),
          12,
        )
      : 0;
    const partial: Omit<Observation, "candidates"> = {
      schema: CITY_SCHEMA,
      sequence,
      tick: this.tick,
      agentId: id,
      kind: a.kind === "bus" ? "vehicle" : a.kind,
      role: a.role,
      persona: a.persona,
      hazard: hz?.e.kind ?? null,
      hazardDistance: hz ? Math.min(3000, Math.round(hz.d * 10) / 10) : null,
      insidePerimeter: !!hz && hz.d < hz.e.radius * EVENT_EFFECTS[hz.e.kind].avoid,
      attraction: at?.e.kind ?? null,
      attractionDistance: at ? Math.min(3000, Math.round(at.d * 10) / 10) : null,
      sheltering: this.events.some(
        (x) => EVENT_EFFECTS[x.kind].shelter && distance(a.point, x.at) < x.radius,
      ),
      trafficNearby,
      emergencyApproaching:
        !emergency &&
        this.grid.some(
          a.point,
          55,
          (b) => b.kind === "emergency" && b.action === "respond",
        ),
      crossing,
      safeToCross: safe,
      signalDark: dark,
      blocked,
      routeClosed,
      atPortal: pedestrian && node.portal && beforeEnd < 3,
      atGathering: pedestrian && node.gathering && beforeEnd < 5,
      atBusStop: atStop,
      busBoarding:
        atStop &&
        this.grid.some(node, 18, (b) => b.kind === "bus" && b.action === "park"),
      atMetro,
      metroOpen: this.metroOpen(),
      assigned: emergency && a.assignment > 0,
      crowd: crowdCount === 0 ? 0 : crowdCount < 4 ? 1 : crowdCount < 12 ? 2 : 3,
    };
    return { ...partial, candidates: legalActions(partial) };
  }
  /** A priority selector: the first rule that applies wins, and names itself. */
  private rule(a: Agent, o: Observation): [Action, string] {
    if (a.kind === "emergency") {
      if (a.assignment) {
        const e = this.events.find((x) => x.id === a.assignment);
        const post = roads.nodes.get(a.goal);
        if (post && e && (distance(a.point, post) < 9 || distance(a.point, e.at) < 12))
          return [
            "park",
            a.role === "police" ? "staged at perimeter post" : "staged at incident",
          ];
        return ["respond", "dispatched"];
      }
      const base = roads.nodes.get(a.base)!;
      return distance(a.point, base) < 14
        ? ["park", "at base"]
        : ["drive", "returning to base"];
    }
    if (a.kind !== "pedestrian") {
      if (o.emergencyApproaching) return ["pull_over", "yield: emergency vehicle"];
      if (o.blocked || o.routeClosed)
        return a.hold > 25 ? ["detour", "closure: detour"] : ["stop", "closure ahead"];
      if (
        a.kind === "vehicle" &&
        this.tick > 100 &&
        this.tick % 601 < a.id % 13 &&
        a.trait < 0.2
      )
        return ["park", "routine: curb stop"];
      return ["drive", "routine"];
    }
    if (o.crossing && !o.safeToCross) return ["wait", "crossing: wait for gap"];
    if (o.crossing) return ["cross", "crossing: crosses before reacting"];
    if (o.insidePerimeter) return ["leave", `${o.hazard}: inside perimeter`];
    if (o.sheltering) {
      if (a.curiosity > 0.9 && !o.atPortal) return ["continue", "storm: carries on"];
      return o.atPortal
        ? ["enter", "storm: enters portal"]
        : ["shelter", "storm: seeks shelter"];
    }
    if (o.hazard && a.caution > 0.62 && o.hazardDistance! < 150)
      return ["leave", `${o.hazard}: cautious`];
    if (o.attraction) {
      const draw = a.curiosity - o.attractionDistance! / 450;
      const social =
        o.attraction === "parade" ||
        o.attraction === "festival" ||
        o.attraction === "rally";
      if (social && draw > 0.25)
        return o.atGathering || o.atBusStop
          ? ["gather", `${o.attraction}: joins crowd`]
          : ["watch", `${o.attraction}: spectator`];
      if (!social && draw > 0.55) return ["record", `${o.attraction}: records`];
      if (!social && draw > 0.3) return ["watch", `${o.attraction}: watches`];
      if (!social && o.crowd >= 2 && a.curiosity > 0.45)
        return ["watch", `${o.attraction}: drawn by crowd`];
    }
    if (o.atMetro && !o.metroOpen && a.goalKind === "metro")
      return a.caution > 0.45
        ? ["leave", "metro closed: re-routes"]
        : ["wait", "metro closed: waits"];
    if (o.busBoarding && a.goalKind === "bus") return ["board", "routine: boards bus"];
    if (o.atBusStop && a.goalKind === "bus" && this.tick - a.lastVisit < 1800)
      return ["gather", "routine: waits for bus"];
    if (o.atMetro && o.metroOpen && a.goalKind === "metro")
      return ["enter", "routine: takes Metro"];
    const arrived = this.net(a).edges[a.edge]!.to === a.goal;
    if (o.atPortal && arrived && ["shop", "work", "home"].includes(a.goalKind))
      return ["enter", `routine: ${a.goalKind}`];
    if (o.atPortal && this.tick - a.lastVisit > 600 && a.trait < 0.3)
      return ["enter", "routine: errand"];
    if (o.atGathering && this.tick % 350 < 60 && a.trait > 0.6)
      return ["gather", "routine: lingers"];
    return o.crossing ? ["cross", "routine: crosses"] : ["continue", "routine"];
  }
  private pickGoal(a: Agent) {
    const r = this.rng();
    const pick = (list: string[]) => list[Math.floor(this.rng() * list.length)];
    let kind: GoalKind = "wander";
    if (a.kind === "pedestrian") {
      const table: Record<Persona, [GoalKind, number][]> = {
        commuter: [
          ["metro", 0.5],
          ["bus", 0.8],
          ["work", 1],
        ],
        shopper: [
          ["shop", 0.7],
          ["sight", 0.9],
          ["wander", 1],
        ],
        resident: [
          ["home", 0.4],
          ["shop", 0.7],
          ["sight", 1],
        ],
        worker: [
          ["work", 0.5],
          ["shop", 0.9],
          ["metro", 1],
        ],
        visitor: [
          ["sight", 0.5],
          ["shop", 0.8],
          ["wander", 1],
        ],
        none: [["wander", 1]],
      };
      kind = table[a.persona].find(([, w]) => r < w)![0];
      const list =
        kind === "wander" ? undefined : DESTINATIONS[kind as keyof typeof DESTINATIONS];
      const id = list?.length ? pick(list) : undefined;
      if (id) {
        a.goal = id;
        a.goalKind = kind;
        if (kind === "bus") a.lastVisit = this.tick;
        return;
      }
      a.goal = walkNodes[Math.floor(this.rng() * walkNodes.length)]!.id;
      a.goalKind = "wander";
      return;
    }
    const nodes = [...roads.nodes.values()].filter((n) => n.out.length);
    a.goal = nodes[Math.floor(this.rng() * nodes.length)]!.id;
    a.goalKind = "wander";
  }
  private finish(a: Agent) {
    const i = this.activeDecision.get(a.id);
    if (i !== undefined) {
      const d = this.decisions[i];
      if (d) {
        d.after = snapshot(a);
        d.outcomeTick = this.tick;
      }
    }
  }
  private apply(
    a: Agent,
    o: Observation,
    action: Action,
    source: Decision["source"],
    proposed: unknown,
    reason: string,
  ) {
    // A rules decision that re-affirms the open one extends its outcome window
    // instead of adding a record: the log holds transitions, not heartbeats.
    const open = this.activeDecision.get(a.id);
    const previous = open === undefined ? undefined : this.decisions[open];
    const reaffirm =
      source === "rules" &&
      !!previous &&
      previous.source === "rules" &&
      previous.action === action &&
      previous.reason === reason.slice(0, 100) &&
      a.action === action;
    if (!reaffirm) this.finish(a);
    else this.reaffirmed++;
    const before = snapshot(a);
    const net = this.net(a);
    a.action = action;
    a.until =
      this.tick +
      (action === "enter"
        ? o.atMetro
          ? 900 + Math.floor(a.trait * 1500)
          : 120 + Math.floor(a.trait * 180)
        : action === "board"
          ? 1200 + Math.floor(a.trait * 1800)
          : action === "park"
            ? a.kind === "bus"
              ? 150
              : a.kind === "emergency"
                ? 100
                : 80
            : action === "gather"
              ? 60
              : action === "watch" || action === "record"
                ? 30
                : reason.startsWith("routine") && !this.involved(a.point)
                  ? 50
                  : 20);
    a.inside = action === "enter" || action === "board";
    if (a.inside) {
      a.lastVisit = this.tick;
      a.riding = action === "board" ? 2 : o.atMetro ? 1 : 0;
    }
    const h = this.hazardOf(a.point)?.e ?? this.attractionOf(a.point)?.e;
    if (action === "shelter") {
      a.goal = nearest(net, a.point, (n) => n.portal).id;
      a.goalKind = "shelter";
    } else if (action === "leave") {
      if (o.atMetro && !o.metroOpen && DESTINATIONS.bus.length) {
        a.goal = DESTINATIONS.bus[Math.floor(this.rng() * DESTINATIONS.bus.length)]!;
        a.goalKind = "bus";
        a.lastVisit = this.tick;
      } else if (h) {
        let best = "",
          score = -Infinity;
        for (const n of net.nodes.values()) {
          const travel = distance(n, a.point);
          if (travel < 30 || travel > 180) continue;
          const value = this.eventDistance(n, h) - travel * 0.2;
          if (value > score) {
            score = value;
            best = n.id;
          }
        }
        if (best) {
          a.goal = best;
          a.goalKind = "away";
        }
      }
    } else if (action === "detour") {
      // U-turn onto the opposing edge when the road is two-way; on a one-way
      // road the vehicle is waved slowly on through the closure instead.
      const e = net.edges[a.edge]!;
      const reverse = net.nodes.get(e.to)!.out.find((i) => net.edges[i]!.to === e.from);
      const turn = reverse === undefined ? undefined : net.edges[reverse]!;
      if (turn && !this.closedRoads.has(turn.id)) {
        a.edge = turn.id;
        a.progress = Math.max(0, turn.length - a.progress);
        a.point = position(net, turn, a.progress, a.lane);
      }
      a.hold = 0;
      if (a.kind === "bus") this.advanceWaypoint(a, 3);
      else this.pickGoal(a);
    } else if (action === "respond") {
      // The post was chosen at dispatch; responding keeps it.
    } else if (a.kind === "emergency" && action === "drive" && !a.assignment) {
      a.goal = a.base;
      a.goalKind = "base";
    } else if (
      a.kind !== "bus" &&
      (!a.goal ||
        net.edges[a.edge]!.to === a.goal ||
        a.goalKind === "away" ||
        a.goalKind === "shelter")
    ) {
      if (MOVING.has(action)) this.pickGoal(a);
    }
    if (reaffirm) return;
    if (this.decisions.length >= 60000) {
      this.recordingComplete = false;
      return;
    }
    this.activeDecision.set(a.id, this.decisions.length);
    this.decisions.push({
      tick: this.tick,
      observation: structuredClone(o),
      proposed: structuredClone(proposed),
      action,
      source,
      reason: reason.slice(0, 100),
      before,
      after: snapshot(a),
      outcomeTick: this.tick,
    });
  }
  /** Returns true when the trip ended and the next one entered at the route start. */
  private advanceWaypoint(a: Agent, steps = 1): boolean {
    const route = busRoutes[a.route]!;
    let entered = false;
    a.waypoint += steps;
    if (a.waypoint >= route.waypoints.length) {
      if (route.loop) a.waypoint %= route.waypoints.length;
      else {
        // The trip leaves the extract; the next trip enters at the route start.
        const from = route.waypoints[0]!;
        const e =
          roads.edges[
            nextToward(roads, from, route.waypoints[1]!) ?? roads.nodes.get(from)!.out[0]!
          ]!;
        a.edge = e.id;
        a.progress = 0;
        a.point = position(roads, e, 0, a.lane);
        a.waypoint = 1;
        a.hold = 0;
        entered = true;
      }
    }
    a.goal = route.waypoints[a.waypoint]!;
    return entered;
  }
  private decide(a: Agent, o: Observation): Action {
    const [candidate, reason] = this.rule(a, o);
    const action = o.candidates.includes(candidate)
      ? candidate
      : a.kind === "pedestrian"
        ? "wait"
        : "stop";
    this.apply(
      a,
      o,
      action,
      "rules",
      null,
      o.candidates.includes(candidate) ? reason : `${reason} (not permitted)`,
    );
    return action;
  }
  accept(observation: Observation, proposal: unknown, failure: string | null = null) {
    if (!validateObservation(observation) || !this.agents[observation.agentId]) return;
    this.append({ type: "decision", tick: this.tick, observation, proposal, failure });
    const a = this.agents[observation.agentId]!,
      now = this.observe(a.id, observation.sequence);
    const valid =
      !failure &&
      !a.inside &&
      observation.tick <= this.tick &&
      this.tick - observation.tick <= 15 &&
      validateProposal(proposal, observation) &&
      now.candidates.includes(proposal.action);
    const [fallback, why] = this.rule(a, now);
    const choice = valid ? proposal.action : fallback;
    this.apply(
      a,
      now,
      now.candidates.includes(choice)
        ? choice
        : a.kind === "pedestrian"
          ? "wait"
          : "stop",
      valid ? "jev" : "fallback",
      proposal,
      valid
        ? "validated"
        : `${failure ?? (a.inside ? "agent indoors" : "stale or invalid")} → ${why}`,
    );
  }
  humanAction(action: Action) {
    this.append({ type: "human", tick: this.tick, action });
    const a = this.agents[0]!,
      o = this.observe(0);
    this.apply(
      a,
      o,
      o.candidates.includes(action) ? action : "wait",
      "human",
      action,
      o.candidates.includes(action) ? "validated" : "not permitted",
    );
  }
  movePlayer(dx: number, dz: number) {
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) > 1.2) return;
    this.append({ type: "move", tick: this.tick, dx, dz });
    this.player = moveWithCollision(this.player, {
      x: this.player.x + dx,
      z: this.player.z + dz,
    });
  }
  /** Moves the full-rate simulation focus. Recorded: it changes outcomes. */
  setFocus(p: Point, radius = this.focusRadius) {
    if (!inBounds(p) || !Number.isFinite(radius) || radius < 100 || radius > 1200)
      return false;
    const x = Math.round(p.x),
      z = Math.round(p.z),
      r = Math.round(radius);
    if (
      x === Math.round(this.focus.x) &&
      z === Math.round(this.focus.z) &&
      r === this.focusRadius
    )
      return false;
    this.append({ type: "focus", tick: this.tick, x, z, radius: r });
    this.focus = { x, z };
    this.focusRadius = r;
    return true;
  }
  /** Full rate near the focus, near events, and for every responder and bus. */
  coarse(a: Agent) {
    if (a.kind === "emergency" || a.kind === "bus" || a.id === 0) return false;
    if (distance(a.point, this.focus) < this.focusRadius) return false;
    return !this.events.some((e) => this.eventDistance(a.point, e) < e.radius + 220);
  }

  // --- The tick -------------------------------------------------------------
  step() {
    if (this.paused) return;
    this.tick++;
    let changed = false;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i]!,
        s = this.procession(e);
      if (this.tick >= e.startTick + e.durationTicks || (s && s.tail >= s.total)) {
        this.events.splice(i, 1);
        this.geometry.delete(e.id);
        for (const a of this.agents)
          if (a.assignment === e.id) {
            a.assignment = 0;
            a.until = this.tick;
          }
        changed = true;
      }
    }
    this.refreshEffects(changed);
    this.grid.rebuild(this.agents);
    this.roadOccupancy.clear();
    for (const a of this.agents)
      if (a.kind !== "pedestrian" && !a.inside) {
        const list = this.roadOccupancy.get(a.edge);
        if (list) list.push(a);
        else this.roadOccupancy.set(a.edge, [a]);
      }
    for (const a of this.agents) {
      const coarse = this.coarse(a);
      if (coarse && (this.tick + a.id) % 4 !== 0) continue;
      const scale = coarse ? 4 : 1;
      if (this.tick >= a.until) {
        if (a.inside) {
          a.inside = false;
          if (a.riding === 2 && DESTINATIONS.bus.length) {
            // Alighting: the ride itself is not modelled, only where it ends.
            const id =
              DESTINATIONS.bus[Math.floor(this.rng() * DESTINATIONS.bus.length)]!;
            const node = sidewalks.nodes.get(id)!;
            const e = sidewalks.edges[node.out[0]!]!;
            a.edge = e.id;
            a.progress = 0;
            a.point = position(sidewalks, e, 0);
          }
          a.riding = 0;
          if (a.kind === "pedestrian") this.pickGoal(a);
        }
        this.decide(a, this.observe(a.id));
      }
      this.move(a, scale);
    }
    if (this.tick % 10 === 0) this.updateDistricts();
    if (this.tick % 100 === 0 && this.checkpoints.length < 180)
      this.checkpoints.push({ tick: this.tick, hash: this.stateHash() });
  }
  private move(a: Agent, scale: number) {
    const net = this.net(a),
      e = net.edges[a.edge]!;
    if (a.action === "park" && a.kind !== "pedestrian") {
      a.lane = Math.min(e.width / 2 - 0.6, a.lane + DT * scale);
      a.point = position(net, e, a.progress, a.lane);
    }
    if (a.action === "stop" && a.kind !== "pedestrian") a.hold += scale;
    if (a.inside || !MOVING.has(a.action)) return;
    let speed = a.speed;
    const beforeEnd = e.length - a.progress;
    if (a.kind === "emergency" && a.goal === e.to && beforeEnd < 2) {
      a.until = Math.min(a.until, this.tick + 1);
      return;
    }
    if (a.kind === "pedestrian") {
      if (e.crossing && !this.observeCrossing(a, e)) return;
    } else {
      const emergency = a.kind === "emergency";
      if (!emergency && this.closedRoads.has(e.id)) {
        if (a.action !== "detour") {
          a.hold += scale;
          return;
        }
        speed *= 0.3;
      }
      if (!emergency && beforeEnd < 8) {
        if (this.dark(net.nodes.get(e.to)!)) {
          // Dark signals become an all-way stop: halt, then take a turn.
          if (a.hold < 15) {
            a.hold += scale;
            return;
          }
        } else if (!green(this.tick, e)) return;
      }
      // Parked vehicles are at the curb. Responders pass stopped civilian
      // traffic (using the opposing lane is not modelled), never a responder.
      const ahead = this.roadOccupancy.get(e.id);
      if (
        ahead?.some(
          (b) =>
            b.id !== a.id &&
            b.action !== "park" &&
            (!emergency || b.kind === "emergency") &&
            b.progress > a.progress &&
            b.progress - a.progress < 8 &&
            Math.abs(b.lane - a.lane) < 1.5,
        )
      )
        return;
      const front = position(net, e, a.progress + 3, a.lane);
      if (
        this.grid.some(
          front,
          7,
          (b) =>
            b.kind === "pedestrian" &&
            sidewalks.edges[b.edge]!.crossing &&
            b.progress > 1,
        )
      )
        return;
      if (
        !emergency &&
        beforeEnd < 6 &&
        this.grid.some(
          net.nodes.get(e.to)!,
          6,
          (b) =>
            b.kind !== "pedestrian" &&
            b.id < a.id &&
            (b.action === "drive" || b.action === "respond" || b.action === "detour"),
        )
      )
        return;
      if (a.action === "pull_over") {
        a.lane = Math.min(e.width / 2 - 0.6, a.lane + DT * 1.2 * scale);
        speed *= 0.1;
      } else a.lane = Math.min(3, e.width / 4);
      speed *= this.slowdown(a.point);
    }
    const previous = { ...a.point };
    a.progress += speed * DT * scale;
    if (a.progress >= e.length) {
      a.progress -= e.length;
      const n = net.nodes.get(e.to)!;
      if (a.kind === "pedestrian" && n.portal && a.action === "shelter") {
        a.progress = e.length;
        const o = this.observe(a.id);
        if (o.candidates.includes("enter"))
          this.apply(a, o, "enter", "rules", null, "storm: shelter reached");
        return;
      }
      if (a.kind === "bus" && n.id === a.goal) {
        const route = busRoutes[a.route]!,
          stop = route.stopAt.has(a.waypoint);
        // A new trip has entered at the route start: nothing more this tick.
        if (this.advanceWaypoint(a)) return;
        if (stop) {
          a.progress = e.length;
          const o = this.observe(a.id);
          if (o.candidates.includes("park"))
            this.apply(a, o, "park", "rules", null, `bus stop: ${route.ref}`);
          return;
        }
      }
      const closed =
        a.kind === "pedestrian"
          ? this.closedWalks
          : a.kind === "emergency"
            ? undefined
            : this.closedRoads;
      let next = a.goal
        ? nextToward(net, n.id, a.goal, closed, this.closureVersion)
        : undefined;
      if (next === undefined && a.kind === "bus") {
        for (let k = 0; k < 6 && next === undefined; k++) {
          if (this.advanceWaypoint(a)) return;
          next = nextToward(net, n.id, a.goal, closed, this.closureVersion);
        }
      }
      if (next === undefined) {
        const open = n.out.filter((i) => !closed?.has(i));
        const forward = open.filter((i) => net.edges[i]!.to !== e.from);
        const options = forward.length ? forward : open;
        next = options.length
          ? options[Math.floor(this.rng() * options.length)]
          : undefined;
      }
      if (next === undefined) {
        a.progress = e.length;
        a.hold += scale;
        return;
      }
      a.hold = 0;
      a.edge = next;
      a.progress = Math.min(a.progress, net.edges[next]!.length);
    }
    const newPoint = position(net, net.edges[a.edge]!, a.progress, a.lane);
    if (a.kind === "pedestrian" && buildingAt(newPoint)) {
      a.point = previous;
      a.progress = Math.max(0, a.progress - speed * DT * scale);
      a.until = this.tick;
    } else a.point = newPoint;
  }
  private observeCrossing(a: Agent, e: Edge) {
    if (a.progress > 1) return true;
    const node = sidewalks.nodes.get(e.to)!;
    const traffic = this.grid.some(
      a.point,
      14,
      (b) =>
        b.kind !== "pedestrian" &&
        (b.action === "drive" || b.action === "respond" || b.action === "detour"),
    );
    if (traffic) return false;
    if (this.dark(node)) return true;
    const signals = signalsFor(e);
    return !signals.length || signals.every((s) => !green(this.tick, roads.edges[s]!));
  }
  /** Illustrative stock-flow cohorts. Not census figures or individual people. */
  private updateDistricts() {
    const storm = this.events.find((e) => EVENT_EFFECTS[e.kind].shelter);
    for (const d of this.districts) {
      const hazard = this.events.filter(
        (e) => EVENT_EFFECTS[e.kind].avoid && this.eventDistance(d.point, e) < 260,
      );
      const draw = this.events.filter(
        (e) => EVENT_EFFECTS[e.kind].attract && this.eventDistance(d.point, e) < 300,
      );
      const shelterT = storm
        ? Math.round(d.occupants * (0.45 + 0.15 * storm.intensity))
        : 0;
      const evacuatedT = hazard.length ? Math.round(d.occupants * 0.35) : 0;
      const watchingT = draw.length
        ? Math.round(
            d.occupants * (0.06 + 0.04 * Math.max(...draw.map((e) => e.intensity))),
          )
        : 0;
      const outdoorsT = Math.max(
        0,
        Math.round(d.occupants * 0.12) - Math.round(shelterT * 0.12),
      );
      const toward = (v: number, t: number) =>
        v +
        Math.sign(t - v) *
          Math.max(Math.abs(t - v) > 0 ? 1 : 0, Math.round(Math.abs(t - v) * 0.15));
      d.sheltering = toward(d.sheltering, shelterT);
      d.evacuated = toward(d.evacuated, evacuatedT);
      d.watching = toward(d.watching, watchingT);
      d.outdoors = toward(d.outdoors, outdoorsT);
    }
  }
  stateHash() {
    return canonicalHash({
      sim: SIM_VERSION,
      data: DATA_VERSION,
      transit: TRANSIT_VERSION,
      tick: this.tick,
      agents: this.agents,
      events: this.events,
      player: this.player,
      focus: this.focus,
      focusRadius: this.focusRadius,
      districts: this.districts,
    });
  }
  export(): Trace {
    if (!this.recordingComplete || this.tick > 18000)
      throw new Error("Recording limit reached. Reset to start a complete experiment.");
    for (const a of this.agents) this.finish(a);
    return {
      schema: REPLAY_SCHEMA,
      simVersion: SIM_VERSION,
      dataVersion: DATA_VERSION,
      terrainVersion: TERRAIN_VERSION,
      transitVersion: TRANSIT_VERSION,
      config: { ...this.config },
      tick: this.tick,
      commands: structuredClone(this.commands),
      decisions: structuredClone(this.decisions),
      checkpoints: structuredClone(this.checkpoints),
      finalHash: this.stateHash(),
    };
  }
  static *replaySteps(v: Trace): Generator<number, CitySimulation> {
    const schema = (v as { schema?: unknown } | null)?.schema;
    if (schema === "bethesda-replay/v1" || schema === "bethesda-replay/v2")
      throw new Error(
        `This trace (${schema}) was recorded by an earlier city simulator. Replay it with the project revision that recorded it.`,
      );
    if (
      !v ||
      v.schema !== REPLAY_SCHEMA ||
      v.simVersion !== SIM_VERSION ||
      v.dataVersion !== DATA_VERSION ||
      v.terrainVersion !== TERRAIN_VERSION ||
      v.transitVersion !== TRANSIT_VERSION ||
      !configOK(v.config) ||
      !Number.isInteger(v.tick) ||
      v.tick < 0 ||
      v.tick > 18000 ||
      !Array.isArray(v.commands) ||
      v.commands.length > 30000 ||
      !Array.isArray(v.decisions) ||
      v.decisions.length > 60000 ||
      !Array.isArray(v.checkpoints) ||
      v.checkpoints.length > 180
    )
      throw new Error("Unsupported, mismatched or oversized replay");
    const sim = new CitySimulation(v.config);
    let i = 0,
      last = -1;
    for (const c of v.commands) {
      if (
        !c ||
        !Number.isInteger(c.tick) ||
        c.tick < last ||
        c.tick > v.tick ||
        c.tick < 0
      )
        throw new Error("Invalid command order");
      last = c.tick;
    }
    for (let tick = 0; tick <= v.tick; tick++) {
      while (i < v.commands.length && v.commands[i]!.tick === tick) {
        const c = v.commands[i++]!;
        switch (c.type) {
          case "scenario":
            if (!sim.inject(c.scenario)) throw new Error("Invalid scenario");
            break;
          case "decision":
            if (
              !validateObservation(c.observation) ||
              c.observation.tick > tick ||
              !sim.agents[c.observation.agentId] ||
              (c.failure !== null &&
                (typeof c.failure !== "string" || c.failure.length > 100))
            )
              throw new Error("Invalid decision");
            sim.accept(c.observation, c.proposal, c.failure);
            break;
          case "human":
            if (!ACTIONS.includes(c.action)) throw new Error("Invalid human choice");
            sim.humanAction(c.action);
            break;
          case "move":
            if (
              !Number.isFinite(c.dx) ||
              !Number.isFinite(c.dz) ||
              Math.hypot(c.dx, c.dz) > 1.2
            )
              throw new Error("Invalid movement");
            sim.movePlayer(c.dx, c.dz);
            break;
          case "focus":
            if (!sim.setFocus({ x: c.x, z: c.z }, c.radius))
              throw new Error("Invalid focus");
            break;
          default:
            throw new Error("Unknown command");
        }
      }
      if (tick === v.tick) break;
      sim.step();
      if (sim.tick % 100 === 0) yield sim.tick;
    }
    const actual = sim.export();
    if (
      actual.finalHash !== v.finalHash ||
      canonicalHash(actual.checkpoints) !== canonicalHash(v.checkpoints) ||
      canonicalHash(actual.decisions) !== canonicalHash(v.decisions)
    )
      throw new Error("Replay state or decision history differs");
    return sim;
  }
  static replay(v: Trace) {
    const steps = this.replaySteps(v);
    for (;;) {
      const next = steps.next();
      if (next.done) return next.value;
    }
  }
  static async replayAsync(v: Trace) {
    const steps = this.replaySteps(v);
    for (;;) {
      const next = steps.next();
      if (next.done) return next.value;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}
