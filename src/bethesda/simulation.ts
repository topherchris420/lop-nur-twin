import { mulberry32 } from "../lib/noise";
import { canonicalHash } from "../game/pilot/hash";
import {
  DATA_VERSION,
  arrival,
  buildingAt,
  bounds,
  distance,
  moveWithCollision,
  rescue,
  row,
  metro,
  type Point,
} from "./model";
import { roads, sidewalks, green, nearest, nextToward, position } from "./network";
import {
  ACTIONS,
  CITY_SCHEMA,
  legalActions,
  validateObservation,
  validateProposal,
  type Action,
  type AgentKind,
  type Observation,
} from "./contract";
import { validScenario, type Scenario, type CityEvent } from "./scenarios";
import { TERRAIN_VERSION } from "./terrain";
export const DT = 0.1;
export interface Config {
  seed: number;
  pedestrians: number;
  vehicles: number;
  statisticalPopulation: number;
}
export const PROFILES: Config[] = [
  { seed: 393977, pedestrians: 120, vehicles: 28, statisticalPopulation: 900 },
  { seed: 393977, pedestrians: 320, vehicles: 65, statisticalPopulation: 1800 },
  { seed: 393977, pedestrians: 640, vehicles: 110, statisticalPopulation: 2800 },
];
export interface Agent {
  id: number;
  kind: AgentKind;
  edge: number;
  progress: number;
  point: Point;
  lane: number;
  speed: number;
  action: Action;
  until: number;
  inside: boolean;
  goal: string;
  trait: number;
  color: number;
  lastVisit: number;
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
) & { tick: number };
export interface Trace {
  schema: "bethesda-replay/v1" | "bethesda-replay/v2";
  dataVersion: string;
  // Elevation changes only presentation; omission identifies an older trace.
  terrainVersion?: string;
  config: Config;
  tick: number;
  commands: Command[];
  decisions: Decision[];
  checkpoints: { tick: number; hash: string }[];
  finalHash: string;
}
function configOK(c: Config) {
  return (
    c &&
    Number.isInteger(c.seed) &&
    c.seed >= 0 &&
    c.seed <= 0xffffffff &&
    Number.isInteger(c.pedestrians) &&
    c.pedestrians >= 1 &&
    c.pedestrians <= 640 &&
    Number.isInteger(c.vehicles) &&
    c.vehicles >= 0 &&
    c.vehicles <= 110 &&
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
export class CitySimulation {
  readonly agents: Agent[] = [];
  readonly events: CityEvent[] = [];
  readonly commands: Command[] = [];
  readonly decisions: Decision[] = [];
  readonly checkpoints: { tick: number; hash: string }[] = [];
  readonly districts: {
    point: Point;
    occupants: number;
    sheltering: number;
    watching: number;
  }[] = [];
  readonly config: Config;
  tick = 0;
  paused = false;
  player: Point = { ...arrival };
  recordingComplete = true;
  private rng: () => number;
  private replaySchema: Trace["schema"] = "bethesda-replay/v2";
  private terrainVersion: string | undefined = TERRAIN_VERSION;
  private eventId = 0;
  private activeDecision = new Map<number, number>();
  constructor(config: Config = PROFILES[1]!) {
    if (!configOK(config)) throw new Error("Invalid city configuration");
    this.config = { ...config };
    this.rng = mulberry32(config.seed);
    const pedestrianEdges = sidewalks.edges.filter(
      (e) => !buildingAt(position(sidewalks, e, e.length / 2)),
    );
    // Illustrative daytime concentration around the two real public anchors.
    // This is a sampling policy, not a claim about measured pedestrian demand.
    const coreEdges = pedestrianEdges.filter((e) => {
      const p = position(sidewalks, e, e.length / 2);
      return distance(p, row.point) < 160 || distance(p, metro.point) < 120;
    });
    const vehicleEdges = roads.edges.filter(
      (e) => !buildingAt(position(roads, e, e.length / 2)),
    );
    for (let i = 0; i < config.pedestrians + config.vehicles + 3; i++) {
      const kind: AgentKind =
        i < config.pedestrians
          ? "pedestrian"
          : i < config.pedestrians + config.vehicles
            ? "vehicle"
            : "emergency";
      const net = kind === "pedestrian" ? sidewalks : roads;
      const candidates =
        kind === "pedestrian"
          ? i % 2 === 0 && coreEdges.length
            ? coreEdges
            : pedestrianEdges
          : vehicleEdges;
      const e =
        kind === "emergency"
          ? net.edges[nearest(net, rescue.point).out[0]!]!
          : candidates[Math.floor(this.rng() * candidates.length)]!;
      const progress =
        kind === "emergency"
          ? Math.max(0, e.length - 5 * (i - config.pedestrians - config.vehicles))
          : this.rng() * e.length;
      const lane = kind === "pedestrian" ? 0 : Math.min(3, e.width / 4);
      this.agents.push({
        id: i,
        kind,
        edge: e.id,
        progress,
        point: position(net, e, progress, lane),
        lane,
        speed:
          kind === "pedestrian"
            ? 1.05 + this.rng() * 0.65
            : kind === "emergency"
              ? 12
              : 5 + this.rng() * 4,
        action:
          kind === "pedestrian" ? "continue" : kind === "emergency" ? "park" : "drive",
        until: kind === "emergency" ? 100000 : Math.floor(this.rng() * 20),
        inside: false,
        goal: "",
        trait: this.rng(),
        color: Math.floor(this.rng() * 8),
        lastVisit: -1000,
      });
    }
    for (let i = 0; i < 12; i++)
      this.districts.push({
        point: {
          x: bounds.min.x + (((i % 3) + 0.5) * (bounds.max.x - bounds.min.x)) / 3,
          z:
            bounds.min.z +
            ((Math.floor(i / 3) + 0.5) * (bounds.max.z - bounds.min.z)) / 4,
        },
        occupants:
          Math.floor(config.statisticalPopulation / 12) +
          (i < config.statisticalPopulation % 12 ? 1 : 0),
        sheltering: 0,
        watching: 0,
      });
  }
  private append(c: Command) {
    if (this.commands.length >= 30000) {
      this.recordingComplete = false;
      return;
    }
    this.commands.push(structuredClone(c));
  }
  inject(s: Scenario): boolean {
    if (!validScenario(s) || this.events.length >= 8) return false;
    this.append({ type: "scenario", tick: this.tick, scenario: s });
    this.events.push({ ...structuredClone(s), id: ++this.eventId, startTick: this.tick });
    for (const a of this.agents)
      if (a.kind === "emergency" && s.kind === "fire") a.until = this.tick;
    return true;
  }
  hazard(p: Point): CityEvent | undefined {
    return (
      this.events.find(
        (e) => e.kind !== "storm" && distance(p, e.point) < Math.max(e.radius * 3, 120),
      ) ?? this.events.find((e) => e.kind === "storm")
    );
  }
  observe(id: number, sequence = 0): Observation {
    const a = this.agents[id];
    if (!a) throw new Error("Unknown agent");
    const net = a.kind === "pedestrian" ? sidewalks : roads,
      e = net.edges[a.edge]!,
      node = net.nodes.get(e.to)!;
    const hazard =
      a.kind === "emergency"
        ? (this.events.find((e) => e.kind === "fire") ?? this.hazard(a.point))
        : this.hazard(a.point);
    const nearby = this.agents.some(
      (b) =>
        b.kind !== "pedestrian" &&
        b.id !== id &&
        distance(a.point, b.point) < 14 &&
        ["drive", "respond"].includes(b.action),
    );
    const crossing = a.kind === "pedestrian" && e.crossing,
      signals = roads.edges.filter(
        (r) => r.signal && distance(roads.nodes.get(r.to)!, a.point) < 18,
      );
    const safe =
      !nearby && (!signals.length || signals.every((s) => !green(this.tick, s)));
    const partial: Omit<Observation, "candidates"> = {
      schema: CITY_SCHEMA,
      sequence,
      tick: this.tick,
      agentId: id,
      kind: a.kind,
      hazard: hazard?.kind ?? null,
      hazardDistance: hazard ? Math.min(3000, distance(a.point, hazard.point)) : null,
      trafficNearby: nearby,
      crossing,
      safeToCross: safe,
      blocked:
        a.kind !== "pedestrian" &&
        this.events.some(
          (h) =>
            ["fire", "parade"].includes(h.kind) &&
            distance(position(net, e, a.progress + 6, a.lane), h.point) < h.radius,
        ) &&
        a.kind !== "emergency",
      atPortal: node.portal && e.length - a.progress < 3,
      atGathering: node.gathering && e.length - a.progress < 5,
    };
    return { ...partial, candidates: legalActions(partial) };
  }
  private rule(a: Agent, o: Observation): Action {
    if (a.kind === "emergency")
      return o.hazard === "fire" ? (o.hazardDistance! < 75 ? "park" : "respond") : "park";
    if (a.kind === "vehicle") {
      if (
        this.agents.some(
          (b) =>
            b.kind === "emergency" &&
            b.action === "respond" &&
            distance(b.point, a.point) < 55,
        )
      )
        return "pull_over";
      if (o.blocked) return "stop";
      if (this.tick > 100 && this.tick % 601 < a.id % 13 && a.trait < 0.2) return "park";
      return "drive";
    }
    if (o.crossing && !o.safeToCross) return "wait";
    if (o.hazard === "storm") return o.atPortal ? "enter" : "shelter";
    if (o.hazard === "metro-closure") return "leave";
    if (o.hazard === "fire" && o.hazardDistance! < 55) return "leave";
    if (o.hazard === "fire" || o.hazard === "object")
      return a.trait < 0.25
        ? "leave"
        : a.trait < 0.52
          ? "watch"
          : a.trait < 0.72
            ? "record"
            : "continue";
    if (o.hazard === "parade" && a.trait < 0.7)
      return o.hazardDistance! < 75 ? "gather" : "continue";
    if (o.atPortal && this.tick - a.lastVisit > 600 && a.trait < 0.55) return "enter";
    if (o.atGathering && this.tick % 350 < 60) return "gather";
    return o.crossing ? "cross" : "continue";
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
    this.finish(a);
    const before = snapshot(a);
    a.action = action;
    a.until =
      this.tick +
      (action === "enter"
        ? 120 + Math.floor(a.trait * 180)
        : action === "park"
          ? 80
          : action === "gather"
            ? 60
            : 20);
    a.inside = action === "enter";
    if (a.inside) a.lastVisit = this.tick;
    const net = a.kind === "pedestrian" ? sidewalks : roads,
      h = this.hazard(a.point);
    if (action === "shelter") {
      a.goal = nearest(net, a.point, (n) => n.portal).id;
    } else if (action === "leave" && h) {
      let best = "",
        score = -Infinity;
      for (const n of net.nodes.values()) {
        const travel = distance(n, a.point);
        if (travel < 30 || travel > 180) continue;
        const value = distance(n, h.point) - travel * 0.2;
        if (value > score) {
          score = value;
          best = n.id;
        }
      }
      a.goal = best;
    } else if (action === "respond") {
      const fire = this.events.find((e) => e.kind === "fire");
      if (fire) a.goal = nearest(net, fire.point).id;
    } else if (!a.goal || net.edges[a.edge]!.to === a.goal) {
      const choices = [...net.nodes.values()].filter((n) => n.out.length);
      a.goal = choices[Math.floor(this.rng() * choices.length)]!.id;
    }
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
      reason,
      before,
      after: snapshot(a),
      outcomeTick: this.tick,
    });
  }
  accept(observation: Observation, proposal: unknown, failure: string | null = null) {
    if (!validateObservation(observation) || !this.agents[observation.agentId]) return;
    this.append({ type: "decision", tick: this.tick, observation, proposal, failure });
    const a = this.agents[observation.agentId]!,
      now = this.observe(a.id, observation.sequence);
    const valid =
      !failure &&
      observation.tick <= this.tick &&
      this.tick - observation.tick <= 15 &&
      validateProposal(proposal, observation) &&
      now.candidates.includes(proposal.action);
    const choice = valid ? proposal.action : this.rule(a, now);
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
      valid ? "validated" : (failure ?? "stale or invalid"),
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
    const p = { x: this.player.x + dx, z: this.player.z + dz };
    this.player = moveWithCollision(this.player, p);
  }
  step() {
    if (this.paused) return;
    this.tick++;
    for (let i = this.events.length - 1; i >= 0; i--)
      if (this.tick >= this.events[i]!.startTick + this.events[i]!.durationTicks)
        this.events.splice(i, 1);
    for (const a of this.agents) {
      const net = a.kind === "pedestrian" ? sidewalks : roads;
      if (this.tick >= a.until) {
        a.inside = false;
        const o = this.observe(a.id),
          candidate = this.rule(a, o);
        this.apply(
          a,
          o,
          o.candidates.includes(candidate)
            ? candidate
            : a.kind === "pedestrian"
              ? "wait"
              : "stop",
          "rules",
          null,
          "routine",
        );
      }
      const e = net.edges[a.edge]!;
      if (a.action === "park" && a.kind !== "pedestrian") {
        a.lane = Math.min(e.width / 2 - 0.6, a.lane + DT);
        a.point = position(net, e, a.progress, a.lane);
      }
      if (
        a.inside ||
        ["wait", "watch", "record", "gather", "stop", "park"].includes(a.action)
      )
        continue;
      let speed = a.speed;
      const beforeEnd = e.length - a.progress;
      if (a.kind === "pedestrian") {
        if (e.crossing && !this.observe(a.id).safeToCross) continue;
      } else {
        if (beforeEnd < 8 && !green(this.tick, e) && a.kind !== "emergency") continue;
        if (
          a.kind !== "emergency" &&
          this.events.some(
            (h) =>
              ["fire", "parade"].includes(h.kind) &&
              distance(position(net, e, a.progress + 4, a.lane), h.point) < h.radius,
          )
        )
          continue;
        if (
          this.agents.some(
            (b) =>
              b.id !== a.id &&
              b.kind !== "pedestrian" &&
              b.edge === a.edge &&
              b.progress > a.progress &&
              b.progress - a.progress < 8 &&
              Math.abs(b.lane - a.lane) < 1.5,
          )
        )
          continue;
        if (
          this.agents.some(
            (b) =>
              b.kind === "pedestrian" &&
              !b.inside &&
              sidewalks.edges[b.edge]!.crossing &&
              b.progress > 1 &&
              distance(b.point, position(net, e, a.progress + 3, a.lane)) < 7,
          )
        )
          continue;
        if (
          a.kind !== "emergency" &&
          beforeEnd < 6 &&
          this.agents.some(
            (b) =>
              b.kind !== "pedestrian" &&
              b.id < a.id &&
              ["drive", "respond"].includes(b.action) &&
              distance(b.point, net.nodes.get(e.to)!) < 6,
          )
        )
          continue;
        if (a.action === "pull_over") {
          a.lane = Math.min(e.width / 2 - 0.6, a.lane + DT * 1.2);
          speed *= 0.1;
        } else a.lane = Math.min(3, e.width / 4);
        if (this.events.some((h) => h.kind === "storm")) speed *= 0.65;
      }
      const previous = { ...a.point };
      a.progress += speed * DT;
      if (a.progress >= e.length) {
        a.progress -= e.length;
        const n = net.nodes.get(e.to)!;
        if (a.kind === "pedestrian" && n.portal && a.action === "shelter") {
          a.progress = e.length;
          const o = this.observe(a.id);
          if (o.candidates.includes("enter"))
            this.apply(a, o, "enter", "rules", null, "shelter reached");
          continue;
        }
        let next = a.goal ? nextToward(net, n.id, a.goal) : undefined;
        if (next === undefined) {
          const options = n.out.filter((i) => net.edges[i]!.to !== e.from);
          next = (options.length ? options : n.out)[
            Math.floor(this.rng() * (options.length || n.out.length))
          ];
        }
        if (next === undefined) {
          a.progress = e.length;
          a.until = this.tick;
          continue;
        }
        a.edge = next;
        a.progress = Math.min(a.progress, net.edges[next]!.length);
      }
      const newPoint = position(net, net.edges[a.edge]!, a.progress, a.lane);
      if (a.kind === "pedestrian" && buildingAt(newPoint)) {
        a.point = previous;
        a.progress = Math.max(0, a.progress - speed * DT);
        a.until = this.tick;
      } else a.point = newPoint;
    }
    if (this.tick % 10 === 0)
      for (const d of this.districts) {
        const h = this.hazard(d.point);
        d.sheltering = Math.round(
          d.occupants * (h?.kind === "storm" ? 0.7 : h?.kind === "fire" ? 0.25 : 0.05),
        );
        d.watching = Math.round(d.occupants * (h && h.kind !== "storm" ? 0.2 : 0.02));
      }
    if (this.tick % 100 === 0 && this.checkpoints.length < 180)
      this.checkpoints.push({ tick: this.tick, hash: this.stateHash() });
  }
  stateHash() {
    return canonicalHash({
      data: DATA_VERSION,
      tick: this.tick,
      agents: this.agents,
      events: this.events,
      player: this.player,
      districts: this.districts,
    });
  }
  export(): Trace {
    if (!this.recordingComplete || this.tick > 18000)
      throw new Error("Recording limit reached. Reset to start a complete experiment.");
    for (const a of this.agents) this.finish(a);
    return {
      schema: this.replaySchema,
      dataVersion: DATA_VERSION,
      ...(this.terrainVersion ? { terrainVersion: this.terrainVersion } : {}),
      config: { ...this.config },
      tick: this.tick,
      commands: structuredClone(this.commands),
      decisions: structuredClone(this.decisions),
      checkpoints: structuredClone(this.checkpoints),
      finalHash: this.stateHash(),
    };
  }
  static *replaySteps(v: Trace): Generator<number, CitySimulation> {
    if (
      !v ||
      (v.schema !== "bethesda-replay/v1" && v.schema !== "bethesda-replay/v2") ||
      v.dataVersion !== DATA_VERSION ||
      (v.terrainVersion !== undefined && v.terrainVersion !== TERRAIN_VERSION) ||
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
      throw new Error("Unsupported or oversized replay");
    const sim = new CitySimulation(v.config);
    // v1 started at the geographic label, even when inside a footprint.
    sim.replaySchema = v.schema;
    sim.terrainVersion = v.terrainVersion;
    if (v.schema === "bethesda-replay/v1") sim.player = { ...row.point };
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
