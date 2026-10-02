import { describe, it, expect } from "vitest";
import { validateObservation } from "./contract";
import { buildings, distance } from "./model";
import { green, nextToward, position, roads, sidewalks } from "./network";
import {
  compileScenario,
  intersection,
  validScenario,
  EVENT_EFFECTS,
  type Scenario,
} from "./scenarios";
import { CitySimulation, DESTINATIONS, type Agent } from "./simulation";
import { busRoutes, monuments, construction } from "./streetscape";
import { groundAt } from "./terrain";

const config = {
  seed: 393977,
  pedestrians: 120,
  vehicles: 40,
  buses: 6,
  statisticalPopulation: 240,
};
const advance = (s: CitySimulation, n: number) => {
  for (let i = 0; i < n; i++) s.step();
};
const one = (text: string): Scenario => {
  const c = compileScenario(text);
  if (c.error || !c.events[0]) throw new Error(c.error ?? "no event");
  return c.events[0];
};

describe("scenario telemetry compiles to bounded events at real places", () => {
  it.each([
    ["Fire near Bethesda Row.", "fire", "Bethesda Row"],
    [
      "A thunderstorm suddenly rolls through downtown Bethesda.",
      "storm",
      "Downtown Bethesda",
    ],
    [
      "The Metro station closes unexpectedly.",
      "metro-closure",
      "Bethesda Metro (Red Line) entrance",
    ],
    ["A parade starts on Wisconsin Avenue.", "parade", "Wisconsin Avenue"],
    [
      "A strange unidentified object appears above Bethesda.",
      "object",
      "Downtown Bethesda",
    ],
    [
      "Car crash at Wisconsin and Old Georgetown",
      "crash",
      "Wisconsin Avenue & Old Georgetown Road",
    ],
    ["UFO hovering over the Madonna of the Trail", "object", "Madonna of the Trail"],
    [
      "Small fire at the Farm Women's Market",
      "fire",
      "Montgomery Farm Women’s Co-operative Market",
    ],
    ["Close Elm Street", "road-closure", "Elm Street"],
    ["A street festival at Veteran's Park", "festival", "Veteran's Park"],
  ])("%s", (text, kind, place) => {
    const e = one(text);
    expect(e.kind).toBe(kind);
    expect(e.place).toBe(place);
    expect(validScenario(e)).toBe(true);
  });
  it("resolves intersections at a node both mapped streets share", () => {
    const p = intersection("Woodmont Avenue", "Bethesda Avenue")!;
    const at = roads.edges.filter((e) => distance(roads.nodes.get(e.from)!, p) < 0.01);
    expect(new Set(at.map((e) => e.name))).toEqual(
      new Set(["Woodmont Avenue", "Bethesda Avenue"]),
    );
  });
  it("needs a preposition before a single-word storefront name", () => {
    expect(buildings.some((b) => b.name === "Giant")).toBe(true);
    expect(one("a giant fire").place).toBe("Bethesda Row");
    expect(one("a giant fire").intensity).toBe(3);
    expect(one("fire at Giant").place).toBe("Giant");
  });
  it("refuses places outside the extract rather than relocating them", () => {
    for (const text of ["Fire in Paris", "fire in paris", "A parade on Fifth Avenue"])
      expect(compileScenario(text).error).toMatch(/not a place/);
    expect(compileScenario("Something happens").error).toMatch(/No supported event/);
    expect(compileScenario("x".repeat(241)).error).toMatch(/240/);
  });
  it("compiles compound requests, durations and intensity", () => {
    const c = compileScenario(
      "A thunderstorm and a power outage hit Bethesda for 40 minutes",
    );
    expect(c.events.map((e) => e.kind).sort()).toEqual(["outage", "storm"]);
    expect(c.events.every((e) => e.durationTicks === 6000)).toBe(true);
    expect(c.notes.join(" ")).toMatch(/capped/);
    expect(one("A huge fire at Tastee Diner").radius).toBeGreaterThan(
      one("A small fire at Tastee Diner").radius,
    );
  });
  it("rejects anything the compiler could not have produced", () => {
    const e = one("Fire near Bethesda Row.");
    expect(validScenario({ ...e, extra: 1 })).toBe(false);
    expect(validScenario({ ...e, intensity: 4 })).toBe(false);
    expect(validScenario({ ...e, street: "Fifth Avenue" })).toBe(false);
    expect(validScenario({ ...e, route: ["not-a-node", "x"] })).toBe(false);
    expect(validScenario({ ...e, point: { x: 1e6, z: 0 } })).toBe(false);
  });
  it("reads every streetscape feature from the licensed layer", () => {
    expect(monuments.find((m) => m.name === "Madonna of the Trail")?.wikidata).toBe(
      "Q6728419",
    );
    expect(construction.some((c) => c.name === "Purple Line")).toBe(true);
    const circulator = busRoutes.find((r) => r.ref === "Circulator")!;
    expect(circulator.stopAt.size).toBeGreaterThan(5);
    for (const r of busRoutes)
      expect(r.waypoints.every((id) => roads.nodes.has(id))).toBe(true);
  });
});

describe("the world reacts through generic effects", () => {
  it("routes never use a closed edge", () => {
    const s = new CitySimulation(config);
    s.inject(one("Huge fire near Bethesda Row"));
    expect(s.closedRoads.size).toBeGreaterThan(0);
    const ids = [...roads.nodes.keys()].filter((id) => roads.nodes.get(id)!.out.length);
    for (let i = 0; i < 300; i++) {
      const from = ids[(i * 37) % ids.length]!,
        to = ids[(i * 101 + 7) % ids.length]!;
      const next = nextToward(roads, from, to, s.closedRoads, s.closureVersion);
      if (next !== undefined) expect(s.closedRoads.has(next)).toBe(false);
    }
  });
  it("dispatches the declared units and forms a perimeter at closure entries", () => {
    const s = new CitySimulation(config);
    const fire = one("Huge fire near Bethesda Row");
    s.inject(fire);
    const units = s.agents.filter((a) => a.assignment);
    const need = EVENT_EFFECTS.fire.dispatch(3);
    expect(units.filter((a) => a.role === "engine")).toHaveLength(need.engine);
    expect(units.filter((a) => a.role === "police")).toHaveLength(need.police);
    for (const p of units.filter((a) => a.role === "police"))
      expect(roads.nodes.get(p.goal)!.out.some((i) => s.closedRoads.has(i))).toBe(true);
    advance(s, 2400);
    expect(units.some((a) => a.action === "park")).toBe(true);
    expect(s.decisions.some((d) => /staged/.test(d.reason))).toBe(true);
  }, 30000);
  it("turns dark signals into an all-way stop instead of a red light", () => {
    const tick = 230;
    const e = roads.edges.find((e) => e.signal && !green(tick, e) && e.length > 12)!;
    const run = (outage: boolean) => {
      const s = new CitySimulation({ ...config, pedestrians: 1, vehicles: 1, buses: 0 });
      if (outage)
        s.inject({
          ...one("Power outage downtown"),
          point: { ...roads.nodes.get(e.to)! },
        });
      const a = s.agents.find((a) => a.kind === "vehicle")!;
      Object.assign(a, {
        edge: e.id,
        progress: e.length - 4,
        action: "drive",
        until: 99999,
        goal: "",
      });
      a.point = position(roads, e, a.progress, a.lane);
      s.tick = tick;
      advance(s, 18);
      return a.edge !== e.id || a.progress > e.length - 4 + 0.01;
    };
    expect(run(false)).toBe(false);
    expect(run(true)).toBe(true);
  });
  it("moves a procession along its real route and its closure with it", () => {
    const s = new CitySimulation(config);
    const parade = one("A parade starts on Wisconsin Avenue.");
    s.inject(parade);
    const event = s.events[0]!;
    const first = { ...event.at },
      closures = [...s.closedRoads].join();
    advance(s, 900);
    expect(distance(event.at, first)).toBeGreaterThan(40);
    expect([...s.closedRoads].join()).not.toBe(closures);
    // The avenue itself, plus cross-street stubs where they meet the procession.
    const names = [...s.closedRoads].map((id) => roads.edges[id]!.name);
    expect(names.filter((n) => n === "Wisconsin Avenue").length).toBeGreaterThan(
      names.length / 3,
    );
    for (const id of s.closedRoads) {
      const e = roads.edges[id]!;
      expect(s.eventDistance(position(roads, e, e.length / 2), event)).toBeLessThan(16);
    }
  }, 30000);
  it("floods only mapped edges below the water surface", () => {
    const s = new CitySimulation(config);
    const flood = one("Flash flood near Bethesda Row");
    s.inject(flood);
    expect(s.closedRoads.size + s.closedWalks.size).toBeGreaterThan(0);
    for (const id of s.closedRoads) {
      const e = roads.edges[id]!;
      expect(groundAt(position(roads, e, e.length / 2))).toBeLessThan(flood.level!);
    }
  });
  it("closes the Metro as a service, not as a place to avoid", () => {
    const s = new CitySimulation(config);
    const a = s.agents[0]!;
    const node = sidewalks.nodes.get(DESTINATIONS.metro[0]!)!;
    const into = sidewalks.edges.find((e) => e.to === node.id)!;
    Object.assign(a, { edge: into.id, progress: into.length - 1 });
    a.point = position(sidewalks, into, a.progress);
    s.step();
    expect(s.observe(0).candidates).toContain("enter");
    s.inject(one("The Metro station closes unexpectedly."));
    const o = s.observe(0);
    expect(o.metroOpen).toBe(false);
    expect(o.candidates).not.toContain("enter");
    expect(o.hazard).toBeNull();
  });
  it("detours traffic around a closed street", () => {
    const s = new CitySimulation({ ...config, vehicles: 90 });
    s.inject(one("Close Woodmont Avenue"));
    advance(s, 1500);
    expect(s.decisions.some((d) => d.reason === "closure: detour")).toBe(true);
  }, 30000);
  it("runs real bus routes that dwell at mapped stops", () => {
    const s = new CitySimulation({ ...config, buses: 8 });
    const buses = s.agents.filter((a) => a.kind === "bus");
    const start = buses.map((b) => ({ ...b.point }));
    advance(s, 3000);
    expect(
      buses.filter((b, i) => distance(b.point, start[i]!) > 50).length,
    ).toBeGreaterThan(4);
    expect(s.decisions.some((d) => d.reason.startsWith("bus stop"))).toBe(true);
  }, 30000);
});

describe("levels of detail, records and the provider boundary", () => {
  it("runs distant agents coarsely and replays a recorded focus exactly", () => {
    const s = new CitySimulation(config);
    expect(s.setFocus({ x: 1e6, z: 0 })).toBe(false);
    expect(s.setFocus({ x: -150, z: 300 }, 200)).toBe(true);
    expect(s.agents.filter((a) => s.coarse(a)).length).toBeGreaterThan(10);
    advance(s, 150);
    s.setFocus({ x: 0, z: -300 }, 300);
    s.inject(one("Fire near Bethesda Row."));
    advance(s, 200);
    const trace = s.export();
    expect(trace.commands.filter((c) => c.type === "focus")).toHaveLength(2);
    expect(CitySimulation.replay(trace).stateHash()).toBe(s.stateHash());
    const other = structuredClone(trace);
    other.commands = other.commands.filter((c) => c.type !== "focus");
    expect(() => CitySimulation.replay(other)).toThrow();
  }, 30000);
  it("folds re-affirmed routine decisions into the open record", () => {
    const s = new CitySimulation(config);
    advance(s, 600);
    expect(s.reaffirmed).toBeGreaterThan(s.decisions.length);
    for (const d of s.decisions) expect(d.outcomeTick).toBeGreaterThanOrEqual(d.tick);
  });
  it("offers every agent kind a valid, closed observation", () => {
    const s = new CitySimulation(config);
    s.inject(one("Huge fire near Bethesda Row"));
    s.inject(one("A thunderstorm rolls through downtown Bethesda"));
    advance(s, 60);
    const kinds = new Set<Agent["kind"]>();
    for (const a of s.agents) {
      const o = s.observe(a.id, 1);
      expect(validateObservation(o)).toBe(true);
      expect(JSON.stringify(o)).not.toMatch(/"x"|"z"|goal|seed/);
      kinds.add(a.kind);
    }
    expect([...kinds].sort()).toEqual(["bus", "emergency", "pedestrian", "vehicle"]);
  });
  it("is deterministic for the same seed and commands", () => {
    const run = () => {
      const s = new CitySimulation(config);
      advance(s, 40);
      s.inject(one("A parade starts on Wisconsin Avenue."));
      s.inject(one("Gas leak near the library"));
      advance(s, 400);
      return s.stateHash();
    };
    expect(run()).toBe(run());
  }, 30000);
});
