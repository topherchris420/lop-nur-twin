import { afterEach, describe, expect, it, vi } from "vitest";
import { CitySimulation, PROFILES, SIM_VERSION } from "../simulation";
import { DATA_VERSION, distance } from "../model";
import { LOCATION_IDS, type LocationId } from "./contracts";
import { compileFor } from "./experiments";
import { LAB_DOOR } from "./site";
import {
  REGION_RADIUS,
  SENSOR,
  TOOL_NAMES,
  TOOL_RESULT_SCHEMA,
  locationPoint,
  runTool,
  validateToolRequest,
  type ToolResult,
} from "./tools";
import {
  MAX_OUTINGS,
  PACE,
  observeIfArrived,
  planOuting,
  positionAt,
  type Outing,
} from "./presence";
import { evidenceItems } from "./session";
import { LabStore } from "./store";
import type { ExperimentRecord } from "./record";

const city = () => {
  const sim = new CitySimulation({
    ...PROFILES[0]!,
    pedestrians: 60,
    vehicles: 12,
    buses: 2,
  });
  for (let i = 0; i < 30; i++) sim.step();
  return sim;
};
/** Everything a read could disturb. */
const state = (sim: CitySimulation) => ({
  hash: sim.stateHash(),
  tick: sim.tick,
  commands: structuredClone(sim.commands),
  agents: sim.agents.length,
  events: sim.events.length,
  closed: [...sim.closedRoads],
  focus: { ...sim.focus },
  paused: sim.paused,
});
const planned = (o: ReturnType<typeof planOuting>): Outing => {
  if ("error" in o) throw new Error(o.error);
  return o;
};
/** An outing started long enough ago that its avatar is standing at the place now. */
const arrived = (sim: CitySimulation, location: LocationId = "bethesda_metro") => {
  const probe = planned(planOuting("Luca", location, 0, "probe"));
  return planned(
    planOuting("Luca", location, sim.tick - Math.ceil(probe.length / PACE) - 1, "o1"),
  );
};
/** A record holding nothing but the packets the record tools read. */
const recorded = (ticks: number[]) =>
  ({
    run_id: "BX-0123456789ab:run-1",
    run: {
      arms: [
        {
          id: "BX-0123456789ab:101:control",
          baseline: { tick: ticks[0], world_hash: "a".repeat(16) },
          observations: ticks
            .slice(1)
            .map((tick) => ({ tick, world_hash: "b".repeat(16) })),
        },
      ],
    },
  }) as unknown as ExperimentRecord;
const LIVE_REQUESTS = [
  { tool: "observe_nearby_actors", location: "bethesda_metro" },
  { tool: "observe_nearby_actors", location: "downtown", radius_m: SENSOR.max },
  { tool: "inspect_local_pedestrian_state", location: "bethesda_row" },
  {
    tool: "inspect_local_traffic_state",
    location: "woodmont_bethesda",
    radius_m: SENSOR.min,
  },
  { tool: "inspect_current_event", location: "bethesda_metro" },
] as const;

describe("the bounded observation tools", () => {
  it("are a closed set of seven, none of which acts", () => {
    expect(TOOL_NAMES).toHaveLength(7);
    for (const name of TOOL_NAMES)
      expect(name).toMatch(/^(observe|inspect|measure|request)_/);
  });
  it.each<[string, unknown]>([
    ["an unknown tool", { tool: "move_actor", location: "bethesda_metro" }],
    ["a tool that would act", { tool: "inject_event", location: "bethesda_metro" }],
    [
      "an extra field",
      { tool: "observe_nearby_actors", location: "bethesda_metro", dx: 4 },
    ],
    [
      "a smuggled URL",
      {
        tool: "inspect_current_event",
        location: "bethesda_metro",
        url: "https://evil.example",
      },
    ],
    [
      "a prototype key",
      JSON.parse(
        '{"tool":"observe_nearby_actors","location":"downtown","__proto__":{"x":1}}',
      ),
    ],
    ["a missing place", { tool: "inspect_local_traffic_state" }],
    ["an unknown place", { tool: "observe_nearby_actors", location: "paris" }],
    [
      "coordinates for a place",
      { tool: "measure_distance", from: { x: 0, z: 0 }, to: "downtown" },
    ],
    [
      "a radius too large",
      { tool: "observe_nearby_actors", location: "downtown", radius_m: 61 },
    ],
    [
      "a radius too small",
      { tool: "observe_nearby_actors", location: "downtown", radius_m: 9 },
    ],
    [
      "a radius that is not a number",
      { tool: "observe_nearby_actors", location: "downtown", radius_m: "40" },
    ],
    [
      "a non-finite radius",
      { tool: "observe_nearby_actors", location: "downtown", radius_m: Number.NaN },
    ],
    [
      "a negative tick",
      { tool: "request_metric_snapshot", run_id: "r", arm_id: "a", tick: -1 },
    ],
    [
      "a fractional tick",
      { tool: "request_metric_snapshot", run_id: "r", arm_id: "a", tick: 1.5 },
    ],
    [
      "a tick past any run",
      { tool: "request_metric_snapshot", run_id: "r", arm_id: "a", tick: 18001 },
    ],
    [
      "a path for an id",
      {
        tool: "request_metric_snapshot",
        run_id: "../../etc/passwd",
        arm_id: "a",
        tick: 1,
      },
    ],
    [
      "an over-long id",
      { tool: "request_metric_snapshot", run_id: "r".repeat(97), arm_id: "a", tick: 1 },
    ],
    [
      "a segment that ends before it starts",
      {
        tool: "request_replay_segment",
        run_id: "r",
        arm_id: "a",
        from_tick: 300,
        to_tick: 100,
      },
    ],
    ["null", null],
    ["an array", [{ tool: "observe_nearby_actors", location: "downtown" }]],
    ["a bare name", "observe_nearby_actors"],
  ])("refuse %s, and the city is untouched", (_what, raw) => {
    const sim = city();
    const before = state(sim);
    expect(validateToolRequest(raw).ok).toBe(false);
    const result = runTool(raw, { sim, records: [] });
    expect(result).toMatchObject({ schema: TOOL_RESULT_SCHEMA, ok: false });
    expect(state(sim)).toEqual(before);
  });
  it("are read-only: no tool changes the city, its clock, its focus or its record", () => {
    const sim = city();
    sim.paused = true;
    const before = state(sim);
    const records = [recorded([0, 100, 200])];
    for (const request of [
      ...LIVE_REQUESTS,
      { tool: "measure_distance", from: "bethesda_metro", to: "veterans_park" },
      {
        tool: "request_metric_snapshot",
        run_id: records[0]!.run_id,
        arm_id: records[0]!.run!.arms[0]!.id,
        tick: 100,
      },
      {
        tool: "request_replay_segment",
        run_id: records[0]!.run_id,
        arm_id: records[0]!.run!.arms[0]!.id,
        from_tick: 0,
        to_tick: 200,
      },
    ])
      expect(runTool(request, { sim, records }).ok, request.tool).toBe(true);
    expect(state(sim)).toEqual(before);
  });
  it("report counts and kinds, never another agent's id or position", () => {
    const sim = city();
    const c = compileFor("metro_closure", "bethesda_metro");
    if (!c.ok) throw new Error(c.error);
    sim.inject(c.event);
    const keys = (v: unknown): string[] =>
      v && typeof v === "object"
        ? Object.entries(v).flatMap(([k, inner]) => [k, ...keys(inner)])
        : [];
    for (const request of LIVE_REQUESTS) {
      const r = runTool(request, { sim, records: [] });
      if (!r.ok) throw new Error(r.error);
      const found = keys(r.result);
      for (const leak of [
        "id",
        "ids",
        "x",
        "z",
        "point",
        "agents",
        "edge",
        "goal",
        "persona",
      ])
        expect(found, `${request.tool} reports ${leak}`).not.toContain(leak);
      for (const v of Object.values(r.result))
        expect(["number", "string", "boolean", "object"]).toContain(typeof v);
    }
  });
  it("name their provenance: the simulator's tick and state hash, the map, the build", () => {
    const sim = city();
    for (const request of LIVE_REQUESTS) {
      const r = runTool(request, { sim, records: [] });
      if (!r.ok) throw new Error(r.error);
      expect(r.provenance).toEqual({
        source: "bethesda-simulator",
        tick: sim.tick,
        world_hash: sim.stateHash(),
        data_hash: DATA_VERSION,
        sim_version: SIM_VERSION,
        observer: null,
      });
    }
    const m = runTool(
      { tool: "measure_distance", from: "downtown", to: "veterans_park" },
      { sim, records: [] },
    );
    if (!m.ok) throw new Error(m.error);
    expect(m.provenance).toMatchObject({
      source: "bethesda-map",
      tick: null,
      world_hash: null,
    });
    const a = locationPoint("downtown")!,
      b = locationPoint("veterans_park")!;
    expect(m.result.straight_line_m).toBeCloseTo(distance(a, b), 0);
  });
  it("count what the simulator holds, by its own rule", () => {
    const sim = city();
    const center = locationPoint("downtown")!;
    const r = runTool(
      { tool: "observe_nearby_actors", location: "downtown", radius_m: 60 },
      { sim, records: [] },
    );
    if (!r.ok) throw new Error(r.error);
    const near = sim.agents.filter((a) => !a.inside && distance(a.point, center) < 60);
    expect(r.result).toMatchObject({
      pedestrians_outdoors: near.filter((a) => a.kind === "pedestrian").length,
      cars: near.filter((a) => a.kind === "vehicle").length,
      buses: near.filter((a) => a.kind === "bus").length,
    });
  });
  it("see an event the simulator is running, at its place, with its declared effects", () => {
    const sim = city();
    const quiet = runTool(
      { tool: "inspect_current_event", location: "bethesda_metro" },
      { sim, records: [] },
    );
    expect(quiet.ok && quiet.result.events).toEqual([]);
    const c = compileFor("metro_closure", "bethesda_metro");
    if (!c.ok) throw new Error(c.error);
    sim.inject(c.event);
    const r = runTool(
      { tool: "inspect_current_event", location: "bethesda_metro" },
      { sim, records: [] },
    );
    if (!r.ok) throw new Error(r.error);
    const [event] = r.result.events as {
      kind: string;
      minutes_left: number;
      declared_effects: string[];
    }[];
    expect(event).toMatchObject({ kind: "metro-closure" });
    expect(event!.minutes_left).toBeGreaterThan(0);
    expect(event!.declared_effects).toContain("metroClosed");
  });
  it("enforce the region rule when an avatar asks, and name who asked", () => {
    const sim = city();
    const center = locationPoint("bethesda_metro")!;
    const request = { tool: "observe_nearby_actors", location: "bethesda_metro" };
    const inside = runTool(request, {
      sim,
      records: [],
      observer: { who: "Elena", at: { x: center.x + REGION_RADIUS - 1, z: center.z } },
    });
    expect(inside.ok && inside.provenance.observer).toBe("Elena");
    for (const at of [
      { x: center.x + REGION_RADIUS + 1, z: center.z },
      LAB_DOOR!.point,
    ]) {
      const outside = runTool(request, {
        sim,
        records: [],
        observer: { who: "Elena", at },
      });
      expect(outside.ok).toBe(false);
      expect(!outside.ok && outside.error).toMatch(/outside the 40 m observation region/);
    }
  });
  it("read a recorded run only where it recorded something", () => {
    const sim = city();
    const ticks = Array.from({ length: 40 }, (_, i) => i * 100);
    const records = [recorded(ticks)];
    const [record] = records;
    const arm = record!.run!.arms[0]!.id;
    const snap = runTool(
      { tool: "request_metric_snapshot", run_id: record!.run_id, arm_id: arm, tick: 300 },
      { sim, records },
    );
    expect(snap.ok && snap.provenance).toMatchObject({
      source: "bethesda-record",
      tick: 300,
      world_hash: "b".repeat(16),
    });
    const unrecorded = runTool(
      { tool: "request_metric_snapshot", run_id: record!.run_id, arm_id: arm, tick: 350 },
      { sim, records },
    );
    expect(!unrecorded.ok && unrecorded.error).toMatch(/no packet was recorded/);
    const nowhere = runTool(
      {
        tool: "request_metric_snapshot",
        run_id: "BX-ffffffffffff:run-9",
        arm_id: arm,
        tick: 300,
      },
      { sim, records },
    );
    expect(!nowhere.ok && nowhere.error).toMatch(/no such recorded arm/);
    const segment = runTool(
      {
        tool: "request_replay_segment",
        run_id: record!.run_id,
        arm_id: arm,
        from_tick: 0,
        to_tick: 18000,
      },
      { sim, records },
    );
    if (!segment.ok) throw new Error(segment.error);
    expect(segment.result.packets).toHaveLength(30);
    expect(segment.result.truncated).toBe(true);
  });
  it("say a replay segment is truncated only when packets in its range were left out", () => {
    const sim = city();
    // Exactly thirty packets: all of them fit, so nothing was dropped.
    const thirty = [recorded(Array.from({ length: 30 }, (_, i) => i * 100))];
    const arm = thirty[0]!.run!.arms[0]!.id;
    const segment = (records: ExperimentRecord[], to_tick: number) => {
      const r = runTool(
        {
          tool: "request_replay_segment",
          run_id: records[0]!.run_id,
          arm_id: arm,
          from_tick: 0,
          to_tick,
        },
        { sim, records },
      );
      if (!r.ok) throw new Error(r.error);
      return r.result as { packets: unknown[]; truncated: boolean };
    };
    expect(segment(thirty, 18000)).toMatchObject({ truncated: false });
    expect(segment(thirty, 18000).packets).toHaveLength(30);
    // Thirty-one in range: one is left out.
    const more = [recorded(Array.from({ length: 31 }, (_, i) => i * 100))];
    expect(segment(more, 18000)).toMatchObject({ truncated: true });
    expect(segment(more, 18000).packets).toHaveLength(30);
    // Thirty-one recorded, thirty in range: nothing in range was left out.
    expect(segment(more, 2900)).toMatchObject({ truncated: false });
  });
});

describe("perspectives in the city", () => {
  it("can reach every place in the vocabulary on foot, within the bound, and observe from where the walk ends", () => {
    for (const location of LOCATION_IDS) {
      const o = planned(planOuting("James", location, 0, location));
      expect(o.path[0]).toEqual(LAB_DOOR!.point);
      expect(o.length).toBeLessThanOrEqual(1500);
      expect(
        distance(o.path.at(-1)!, locationPoint(location)!),
        location,
      ).toBeLessThanOrEqual(REGION_RADIUS);
    }
  });
  it("walk out at a bounded pace, pause to observe, walk back and are done", () => {
    const o = planned(planOuting("Jasmine", "bethesda_row", 1000, "o"));
    const out = Math.ceil(o.length / PACE);
    expect(positionAt(o, 1000)).toMatchObject({ phase: "out", point: LAB_DOOR!.point });
    expect(positionAt(o, 1000 + out + 1).phase).toBe("observing");
    expect(positionAt(o, 1000 + out + 200).phase).toBe("back");
    const done = positionAt(o, 1000 + 2 * out + 400);
    expect(done.phase).toBe("done");
    expect(distance(done.point, LAB_DOOR!.point)).toBeLessThan(0.01);
    for (let t = 1000; t < 1000 + 2 * out + 100; t++)
      expect(
        distance(positionAt(o, t).point, positionAt(o, t + 1).point),
      ).toBeLessThanOrEqual(PACE + 1e-9);
  });
  it("observe once, inside the region, from the simulator's own state, and change nothing", () => {
    const sim = city();
    const o = arrived(sim);
    expect(positionAt(o, sim.tick).phase).toBe("observing");
    const before = state(sim);
    const seen = observeIfArrived(o, sim, []);
    expect(seen).not.toBeNull();
    expect(state(sim)).toEqual(before);
    expect(seen!.tick).toBe(sim.tick);
    expect(seen!.packet.world_hash).toBe(sim.stateHash());
    expect(seen!.packet.source).toBe("bethesda-simulator");
    expect(
      seen!.tools.every((t: ToolResult) => t.ok && t.provenance.observer === "Luca"),
    ).toBe(true);
    expect(seen!.note).toMatch(/position is not evidence/);
    // It is not a simulation agent: the city gained no one and recorded nothing.
    expect(sim.agents).toHaveLength(before.agents);
    expect(observeIfArrived(o, sim, [])).toBeNull();
  });
  it("observe nothing while still walking", () => {
    const sim = city();
    const o = planned(planOuting("Luca", "downtown", sim.tick, "o"));
    expect(observeIfArrived(o, sim, [])).toBeNull();
    expect(o.observation).toBeNull();
    expect(o.refused).toBeNull();
  });
  it("are refused by the region rule where the avatar is not at the place it names", () => {
    const sim = city();
    // A walk that ends at Veterans Park, claiming to report on the Metro.
    const o = { ...arrived(sim, "veterans_park"), location: "bethesda_metro" as const };
    expect(observeIfArrived(o, sim, [])).toBeNull();
    expect(o.refused).toMatch(/region rule/);
  });
  it("enter the Evidence Library as observations whose provenance says where the numbers came from", () => {
    const sim = city();
    const seen = observeIfArrived(arrived(sim), sim, [])!;
    const [item] = evidenceItems(null, [], [seen]);
    expect(item).toMatchObject({ category: "OBSERVATION" });
    expect(item!.provenance).toMatch(/position is not evidence/);
    expect(item!.provenance).toContain(seen.packet.world_hash);
  });
});

describe("outings from the lab", () => {
  const stores: LabStore[] = [];
  afterEach(() => {
    for (const s of stores.splice(0)) s.dispose();
  });
  const store = (sim = city()) => {
    const s = new LabStore(sim, vi.fn());
    stores.push(s);
    return s;
  };
  it("are bounded: one per perspective, two at a time, and the city is untouched", () => {
    const sim = city();
    sim.paused = true;
    const before = state(sim);
    const s = store(sim);
    s.sendOuting("Luca", "bethesda_metro");
    s.sendOuting("Luca", "downtown");
    expect(s.presenceNote).toMatch(/already out/);
    s.sendOuting("James", "downtown");
    s.sendOuting("Elena", "veterans_park");
    expect(s.presenceNote).toMatch(new RegExp(`At most ${MAX_OUTINGS}`));
    expect(s.outings.map((o) => o.who).sort()).toEqual(["James", "Luca"]);
    expect(s.presenceSnapshot()).toHaveLength(2);
    expect(state(sim)).toEqual(before);
  });
  it("end when the city is replaced, and draw nothing in the new one", () => {
    const s = store();
    s.sendOuting("Jasmine", "bethesda_row");
    expect(s.presenceSnapshot()).toHaveLength(1);
    s.attach(city());
    expect(s.outings).toEqual([]);
    expect(s.presenceSnapshot()).toEqual([]);
    expect(s.presenceNote).toMatch(/replaced/);
  });
  it("send nothing to R.A.I.N. or anywhere else", () => {
    const fetchImpl = vi.fn();
    const s = new LabStore(city(), fetchImpl);
    stores.push(s);
    s.sendOuting("Elena", "woodmont_bethesda");
    s.inspect({ tool: "observe_nearby_actors", location: "woodmont_bethesda" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
