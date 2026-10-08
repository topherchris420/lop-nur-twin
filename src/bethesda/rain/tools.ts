/**
 * Bounded, read-only observation tools over the Bethesda simulator.
 *
 * A tiny, closed set. Each takes ids from the lab's closed vocabulary and
 * small bounded numbers, reads authoritative state — the simulator's agents,
 * events, closures and signals, the map's geometry, or a recorded experiment —
 * and returns a typed result with its provenance. None can act: there is no
 * tool that moves, injects, closes, dispatches or steps anything, and the
 * authority test fails if a lab module calls a simulator's mutating methods.
 * Results report counts and kinds, never another agent's id or position.
 *
 * Observation and action stay separate: the only way the lab changes a world
 * is a validated, human-authorized experiment, on its own simulators.
 */
import { DATA_VERSION, distance, type Point } from "../model";
import { SIM_VERSION, type CitySimulation } from "../simulation";
import { EVENT_EFFECTS } from "../scenarios";
import { roads } from "../network";
import {
  LOCATION_IDS,
  LOCATION_LABELS,
  SCENARIO_IDS,
  SCENARIO_LOCATIONS,
  type LocationId,
  type Perspective,
} from "./contracts";
import { compileFor } from "./experiments";
import type { ExperimentRecord } from "./record";
import type { WorldObservation } from "./observations";

export const TOOL_RESULT_SCHEMA = "bethesda-tool-result/v1" as const;
export const TOOL_NAMES = [
  "observe_nearby_actors",
  "inspect_current_event",
  "measure_distance",
  "inspect_local_traffic_state",
  "inspect_local_pedestrian_state",
  "request_metric_snapshot",
  "request_replay_segment",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const SENSOR = { min: 10, max: 60, default: 40 } as const;
/**
 * An observer must stand within this distance of the place it reports on:
 * the default sensor radius, so an avatar reports only on a place it could
 * sense. Every place in the vocabulary has a mapped sidewalk inside it (the
 * Farm Women's Market's is 31 m from the market's centre); a test holds that.
 */
export const REGION_RADIUS = SENSOR.default;
const SEGMENT_PACKETS = 30;

export type ToolRequest =
  | { tool: "observe_nearby_actors"; location: LocationId; radius_m?: number }
  | { tool: "inspect_current_event"; location: LocationId }
  | { tool: "measure_distance"; from: LocationId; to: LocationId }
  | { tool: "inspect_local_traffic_state"; location: LocationId; radius_m?: number }
  | { tool: "inspect_local_pedestrian_state"; location: LocationId; radius_m?: number }
  | { tool: "request_metric_snapshot"; run_id: string; arm_id: string; tick: number }
  | {
      tool: "request_replay_segment";
      run_id: string;
      arm_id: string;
      from_tick: number;
      to_tick: number;
    };
export interface ToolProvenance {
  source: "bethesda-simulator" | "bethesda-map" | "bethesda-record";
  tick: number | null;
  world_hash: string | null;
  data_hash: string;
  sim_version: typeof SIM_VERSION;
  /** Who marked where to look, if anyone. Position is a request, not evidence. */
  observer: Perspective | null;
}
export type ToolResult =
  | {
      schema: typeof TOOL_RESULT_SCHEMA;
      ok: true;
      tool: ToolName;
      request: ToolRequest;
      result: Record<string, unknown>;
      provenance: ToolProvenance;
    }
  | { schema: typeof TOOL_RESULT_SCHEMA; ok: false; tool: string; error: string };

const KEYS: Record<ToolName, readonly string[]> = {
  observe_nearby_actors: ["tool", "location", "radius_m"],
  inspect_current_event: ["tool", "location"],
  measure_distance: ["tool", "from", "to"],
  inspect_local_traffic_state: ["tool", "location", "radius_m"],
  inspect_local_pedestrian_state: ["tool", "location", "radius_m"],
  request_metric_snapshot: ["tool", "run_id", "arm_id", "tick"],
  request_replay_segment: ["tool", "run_id", "arm_id", "from_tick", "to_tick"],
};
const OPTIONAL = new Set(["radius_m"]);

/** Where a location id is: the point its first supported scenario compiles to. */
export function locationPoint(id: LocationId): Point | null {
  const scenario = SCENARIO_IDS.find((s) => SCENARIO_LOCATIONS[s].includes(id));
  const c = scenario ? compileFor(scenario, id) : null;
  return c?.ok ? { x: c.event.point.x, z: c.event.point.z } : null;
}

export function validateToolRequest(
  raw: unknown,
): { ok: true; value: ToolRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, error: "a tool request is an object" };
  const r = raw as Record<string, unknown>;
  const tool = r.tool as ToolName;
  if (!TOOL_NAMES.includes(tool)) return { ok: false, error: "unknown tool" };
  const allowed = KEYS[tool];
  if (Object.keys(r).some((k) => !allowed.includes(k)))
    return { ok: false, error: "unexpected field" };
  if (allowed.some((k) => !OPTIONAL.has(k) && !(k in r)))
    return { ok: false, error: "missing field" };
  for (const k of ["location", "from", "to"])
    if (k in r && !LOCATION_IDS.includes(r[k] as LocationId))
      return { ok: false, error: "unknown place" };
  if (
    "radius_m" in r &&
    (typeof r.radius_m !== "number" ||
      !Number.isFinite(r.radius_m) ||
      r.radius_m < SENSOR.min ||
      r.radius_m > SENSOR.max)
  )
    return { ok: false, error: `radius must be ${SENSOR.min}–${SENSOR.max} m` };
  for (const k of ["tick", "from_tick", "to_tick"])
    if (
      k in r &&
      (!Number.isInteger(r[k]) || (r[k] as number) < 0 || (r[k] as number) > 18000)
    )
      return { ok: false, error: "invalid tick" };
  for (const k of ["run_id", "arm_id"])
    if (k in r && (typeof r[k] !== "string" || !/^[A-Za-z0-9:_-]{1,96}$/.test(r[k])))
      return { ok: false, error: "invalid id" };
  if (
    tool === "request_replay_segment" &&
    (r.to_tick as number) < (r.from_tick as number)
  )
    return { ok: false, error: "segment ends before it starts" };
  return { ok: true, value: r as unknown as ToolRequest };
}

const fail = (tool: string, error: string): ToolResult => ({
  schema: TOOL_RESULT_SCHEMA,
  ok: false,
  tool,
  error,
});

export function runTool(
  raw: unknown,
  ctx: {
    sim: CitySimulation;
    records: readonly ExperimentRecord[];
    observer?: { who: Perspective; at: Point } | null;
  },
): ToolResult {
  const checked = validateToolRequest(raw);
  const name = String((raw as { tool?: unknown } | null)?.tool ?? "unknown").slice(0, 40);
  if (!checked.ok) return fail(name, checked.error);
  const req = checked.value;
  const sim = ctx.sim;
  const live = (observer: Perspective | null): ToolProvenance => ({
    source: "bethesda-simulator",
    tick: sim.tick,
    world_hash: sim.stateHash(),
    data_hash: DATA_VERSION,
    sim_version: SIM_VERSION,
    observer,
  });
  const ok = (
    result: Record<string, unknown>,
    provenance: ToolProvenance,
  ): ToolResult => ({
    schema: TOOL_RESULT_SCHEMA,
    ok: true,
    tool: req.tool,
    request: structuredClone(req),
    result,
    provenance,
  });
  if (req.tool === "measure_distance") {
    const a = locationPoint(req.from),
      b = locationPoint(req.to);
    if (!a || !b) return fail(req.tool, "place not on the map");
    return ok(
      {
        from: LOCATION_LABELS[req.from],
        to: LOCATION_LABELS[req.to],
        straight_line_m: Math.round(distance(a, b) * 10) / 10,
      },
      {
        source: "bethesda-map",
        tick: null,
        world_hash: null,
        data_hash: DATA_VERSION,
        sim_version: SIM_VERSION,
        observer: null,
      },
    );
  }
  if (req.tool === "request_metric_snapshot" || req.tool === "request_replay_segment") {
    const record = ctx.records.find((r) => r.run_id === req.run_id);
    const arm = record?.run?.arms.find((a) => a.id === req.arm_id);
    if (!arm) return fail(req.tool, "no such recorded arm");
    const packets: WorldObservation[] = [arm.baseline, ...arm.observations];
    const provenance: ToolProvenance = {
      source: "bethesda-record",
      tick: null,
      world_hash: null,
      data_hash: DATA_VERSION,
      sim_version: SIM_VERSION,
      observer: null,
    };
    if (req.tool === "request_metric_snapshot") {
      const packet = packets.find((p) => p.tick === req.tick);
      if (!packet) return fail(req.tool, "no packet was recorded at that tick");
      return ok(
        { packet },
        { ...provenance, tick: packet.tick, world_hash: packet.world_hash },
      );
    }
    const inRange = packets.filter(
      (p) => p.tick >= req.from_tick && p.tick <= req.to_tick,
    );
    // Truncated only when packets in the range were left out.
    const segment = inRange.slice(0, SEGMENT_PACKETS);
    return ok(
      { packets: segment, truncated: inRange.length > segment.length },
      provenance,
    );
  }
  const center = locationPoint(req.location);
  if (!center) return fail(req.tool, "place not on the map");
  // An observer reports only from inside the observation region; standing
  // somewhere is never itself an observation.
  if (ctx.observer) {
    if (distance(ctx.observer.at, center) > REGION_RADIUS)
      return fail(
        req.tool,
        `the observer is outside the ${REGION_RADIUS} m observation region`,
      );
  }
  const who = ctx.observer?.who ?? null;
  const radius = "radius_m" in req && req.radius_m ? req.radius_m : SENSOR.default;
  const near = sim.agents.filter((a) => !a.inside && distance(a.point, center) < radius);
  if (req.tool === "observe_nearby_actors")
    return ok(
      {
        place: LOCATION_LABELS[req.location],
        radius_m: radius,
        pedestrians_outdoors: near.filter((a) => a.kind === "pedestrian").length,
        cars: near.filter((a) => a.kind === "vehicle").length,
        buses: near.filter((a) => a.kind === "bus").length,
        responders: near.filter((a) => a.kind === "emergency").length,
      },
      live(who),
    );
  if (req.tool === "inspect_local_pedestrian_state") {
    const walkers = near.filter((a) => a.kind === "pedestrian");
    const count = (...actions: string[]) =>
      walkers.filter((a) => actions.includes(a.action)).length;
    return ok(
      {
        place: LOCATION_LABELS[req.location],
        radius_m: radius,
        moving: count("continue", "cross"),
        waiting: count("wait"),
        watching_or_recording: count("watch", "record"),
        leaving: count("leave"),
        sheltering: count("shelter"),
        gathering: count("gather"),
      },
      live(who),
    );
  }
  if (req.tool === "inspect_local_traffic_state") {
    const vehicles = near.filter((a) => a.kind === "vehicle" || a.kind === "bus");
    const closed = [...sim.closedRoads].filter((id) => {
      const e = roads.edges[id]!;
      return distance(roads.nodes.get(e.from)!, center) < radius + 40;
    }).length;
    return ok(
      {
        place: LOCATION_LABELS[req.location],
        radius_m: radius,
        vehicles_moving: vehicles.filter((a) =>
          ["drive", "respond", "pull_over"].includes(a.action),
        ).length,
        vehicles_stopped_or_detouring: vehicles.filter(
          (a) => a.action === "stop" || a.action === "detour",
        ).length,
        closed_road_edges_nearby: closed,
        signals_dark: sim.signalDark(center),
      },
      live(who),
    );
  }
  // inspect_current_event
  const events = sim.events
    .map((e) => ({ e, d: sim.eventDistance(center, e) }))
    .filter(({ e, d }) => d < e.radius + 120)
    .map(({ e, d }) => ({
      kind: e.kind,
      label: e.label,
      distance_m: Math.round(d),
      minutes_left: Math.max(
        0,
        Math.ceil((e.startTick + e.durationTicks - sim.tick) / 600),
      ),
      declared_effects: Object.entries(EVENT_EFFECTS[e.kind])
        .filter(([k, v]) => k !== "dispatch" && v && v !== 1)
        .map(([k]) => k),
    }));
  return ok({ place: LOCATION_LABELS[req.location], events }, live(who));
}
