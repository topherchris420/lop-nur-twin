import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  ACTIONS,
  validateObservation,
  validateProposal,
  type Proposal,
} from "./contract";
import {
  buildings,
  buildingAt,
  arrival,
  local,
  geographic,
  DATA_VERSION,
  SOURCE,
  moveWithCollision,
  row,
  distance,
} from "./model";
import {
  CitySimulation,
  PROFILES,
  REPLAY_SCHEMA,
  SIM_VERSION,
  type Trace,
} from "./simulation";
import { CityDecisionBroker } from "./jev";
import { parseScenario } from "./scenarios";
import { resolvesBethesda } from "./discovery";
import { roads, green, position } from "./network";
const config = {
  seed: 393977,
  pedestrians: 30,
  vehicles: 10,
  buses: 2,
  statisticalPopulation: 120,
};
const requests = [
  "Fire near Bethesda Row.",
  "A thunderstorm suddenly rolls through downtown Bethesda.",
  "The Metro station closes unexpectedly.",
  "A parade starts on Wisconsin Avenue.",
  "A strange unidentified object appears above Bethesda.",
];
const advance = (s: CitySimulation, n: number) => {
  for (let i = 0; i < n; i++) s.step();
};
const proposal = (s: CitySimulation): Proposal => {
  const o = s.observe(0, 1);
  return {
    agentId: 0,
    sequence: 1,
    action: o.candidates[0]!,
    model: "jev-test",
    confidence: 1,
    probabilities: Object.fromEntries(o.candidates.map((a, i) => [a, i === 0 ? 1 : 0])),
  };
};
describe("Bethesda data and discovery", () => {
  it("ships the actual licensed source checksum and expected features", () => {
    expect(
      createHash("sha256")
        .update(readFileSync(new URL("./data/osm.json", import.meta.url)))
        .digest("hex"),
    ).toBe(DATA_VERSION);
    expect(buildings.length).toBe(1166);
    expect(SOURCE.counts.road).toBe(476);
    expect(SOURCE.license).toBe("ODbL-1.0");
    expect(row.id).toBe("2849739979");
  });
  it("uses local metres with reversible geographic coordinates", () => {
    const p = local([-77.0947, 38.9857]);
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeLessThan(-110);
    expect(p.z).toBeGreaterThan(-112);
    expect(geographic(p).lat).toBeCloseTo(38.9857, 7);
  });
  it("blocks walking into footprints", () => {
    const b = buildings.find((b) => b.ring.length === 5)!;
    const a = { x: b.ring[0]!.x - 5, z: b.ring[0]!.z - 5 };
    expect(moveWithCollision(a, b.center)).toEqual(a);
  });
  it("is hidden behind bounded coordinates or secret command", () => {
    expect(resolvesBethesda("38.9847,-77.0947")).toBe(true);
    expect(resolvesBethesda("resolve bethesda")).toBe(true);
    for (const x of ["39,-77", "NaN,-77", "0,0", "38.9847,-77.0947" + ".".repeat(80)])
      expect(resolvesBethesda(x)).toBe(false);
  });
});
describe("bounded events and decisions", () => {
  it.each(requests)("parses %s", (text) => {
    expect(parseScenario(text)).not.toBeNull();
  });
  it("rejects unsupported requests and caps simultaneous events", () => {
    expect(parseScenario("Fire in Paris")).toBeNull();
    expect(parseScenario("x".repeat(241))).toBeNull();
    const s = new CitySimulation(config);
    for (let i = 0; i < 8; i++) expect(s.inject(parseScenario(requests[0]!)!)).toBe(true);
    expect(s.inject(parseScenario(requests[0]!)!)).toBe(false);
  });
  it("permits closed role-appropriate actions only", () => {
    const s = new CitySimulation(config),
      o = s.observe(0, 1);
    expect(validateObservation(o)).toBe(true);
    expect(validateObservation({ ...o, kind: ["pedestrian"] })).toBe(false);
    expect(validateObservation({ ...o, candidates: ["respond"] })).toBe(false);
    expect(validateProposal(proposal(s), o)).toBe(true);
    expect(validateProposal({ ...proposal(s), action: "teleport" }, o)).toBe(false);
    expect(validateProposal({ ...proposal(s), confidence: NaN }, o)).toBe(false);
    expect(validateProposal({ ...proposal(s), probabilities: { wait: 0.4 } }, o)).toBe(
      false,
    );
  });
  it("falls back on stale, malformed and unavailable answers", () => {
    const s = new CitySimulation(config),
      o = s.observe(0, 1),
      p = proposal(s);
    advance(s, 16);
    s.accept(o, p);
    expect(s.decisions.at(-1)?.source).toBe("fallback");
    s.accept(s.observe(0, 2), null, "unavailable");
    expect(s.decisions.at(-1)?.reason).toMatch(/^unavailable → /);
  });
  it("lets nobody choose for an agent indoors: not a person, not a model", () => {
    const s = new CitySimulation(config);
    advance(s, 5);
    const o = s.observe(0, 1),
      p = proposal(s),
      a = s.agents[0]!;
    a.inside = true;
    a.until = s.tick + 300;
    const { action, until } = a,
      decisions = s.decisions.length;
    expect(s.humanAction(o.candidates[0]!)).toEqual({ kind: "indoors", until });
    expect(s.accept(o, p)).toEqual({ kind: "indoors", until });
    expect(s.accept(o, null, "timeout")).toEqual({ kind: "indoors", until });
    // Nothing applied: still inside, still dwelling, no decision recorded...
    expect(a).toMatchObject({ inside: true, until, action });
    expect(s.decisions).toHaveLength(decisions);
    // ...but every offer is a recorded command, so a replay meets the same gate.
    expect(s.export().commands.filter((c) => c.type !== "focus")).toHaveLength(3);
  });
  it("says what the gate did with a choice outdoors", () => {
    const s = new CitySimulation(config),
      o = s.observe(0, 1);
    expect(s.humanAction(o.candidates[0]!)).toEqual({
      kind: "applied",
      action: o.candidates[0],
    });
    expect(s.humanAction("respond")).toEqual({
      kind: "replaced",
      action: "wait",
      reason: "not permitted",
    });
    const later = s.observe(0, 2);
    advance(s, 16);
    expect(s.accept(later, { ...proposal(s), sequence: 2 })).toMatchObject({
      kind: "replaced",
      reason: "stale or invalid",
    });
  });
  it("bounds population, validates human choices and enforces red signals", () => {
    expect(() => new CitySimulation({ ...config, pedestrians: 641 })).toThrow();
    const s = new CitySimulation(config);
    s.humanAction("respond");
    expect(s.agents[0]!.action).toBe("wait");
    const e = roads.edges.find((e) => e.signal && !green(230, e))!;
    const a = s.agents.find((a) => a.kind === "vehicle")!;
    a.edge = e.id;
    a.progress = Math.max(0, e.length - 4);
    a.point = position(roads, e, a.progress, a.lane);
    a.until = 999;
    a.action = "drive";
    s.tick = 230;
    const before = a.progress;
    s.step();
    expect(a.progress).toBe(before);
    expect(PROFILES[2]!.pedestrians).toBe(640);
  });
  it("dispatches responders over real road edges toward the fire", () => {
    const s = new CitySimulation(config),
      fire = parseScenario(requests[0]!)!;
    s.inject(fire);
    advance(s, 2100);
    const responders = s.agents.filter((a) => a.kind === "emergency");
    expect(responders.some((a) => distance(a.point, fire.point) < 120)).toBe(true);
    expect(s.decisions.some((d) => d.action === "respond")).toBe(true);
  }, 20000);
});
describe("replay and outage", () => {
  it("reproduces events, human input, model proposals, fallbacks and outcomes", () => {
    const s = new CitySimulation(config);
    s.inject(parseScenario(requests[1]!)!);
    advance(s, 20);
    const o = s.observe(0, 1);
    s.accept(o, { ...proposal(s), sequence: 1 });
    s.humanAction("respond");
    s.movePlayer(0.1, 0.1);
    advance(s, 250);
    s.accept(s.observe(0, 2), null, "timeout");
    advance(s, 20);
    const trace = s.export(),
      copy = CitySimulation.replay(trace);
    expect(copy.stateHash()).toBe(s.stateHash());
    expect(copy.export().decisions).toEqual(trace.decisions);
    expect(trace.decisions.some((d) => d.outcomeTick > d.tick)).toBe(true);
  });
  it("rejects mismatched data, corrupt checkpoints and decision histories", () => {
    const s = new CitySimulation(config);
    advance(s, 110);
    const t = s.export();
    expect(() => CitySimulation.replay({ ...t, dataVersion: "wrong" })).toThrow();
    const broken = structuredClone(t);
    broken.checkpoints[0]!.hash = "bad";
    expect(() => CitySimulation.replay(broken)).toThrow();
    const changed = structuredClone(t);
    changed.decisions[0]!.action = "watch";
    expect(() => CitySimulation.replay(changed)).toThrow();
    expect(() => CitySimulation.replay({ ...t, tick: 18001 })).toThrow();
    expect(() =>
      CitySimulation.replay({
        ...t,
        commands: [{ tick: -1, type: "human", action: "wait" }],
      }),
    ).toThrow();
  });
  it("records a provider outage and continues rules without a model", async () => {
    const s = new CitySimulation(config);
    s.inject(parseScenario(requests[1]!)!);
    const fetcher = vi.fn(async () => new Response("{}", { status: 503 }));
    const b = new CityDecisionBroker(s, fetcher);
    b.enabled = true;
    await b.poll();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(b.fallbacks).toBe(1);
    expect(b.status).toBe("FALLBACK · UNAVAILABLE");
    expect(s.decisions.at(-1)?.source).toBe("fallback");
    advance(s, 30);
    expect(s.tick).toBe(30);
    b.dispose();
  });
  it("times out without accepting an unbounded provider result", async () => {
    vi.useFakeTimers();
    try {
      const s = new CitySimulation(config);
      s.inject(parseScenario(requests[1]!)!);
      const fetcher: typeof fetch = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      const b = new CityDecisionBroker(s, fetcher);
      b.enabled = true;
      const pending = b.poll();
      await vi.advanceTimersByTimeAsync(1201);
      await pending;
      expect(b.status).toBe("FALLBACK · TIMEOUT");
      expect(b.fallbacks).toBe(1);
      b.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps the vocabulary complete and finite", () =>
    expect(new Set(ACTIONS).size).toBe(16));
});

describe("public-path arrival", () => {
  it("keeps the real Bethesda Lane courtyard open and its perimeter solid", () => {
    const block = buildings.find((b) => b.id === "13979605")!;
    expect(block.holes).toHaveLength(1);
    expect(buildingAt(local([-77.09781, 38.9815]))).toBeUndefined();
    expect(buildingAt(local([-77.0981, 38.9815]))?.id).toBe(block.id);
    expect(
      moveWithCollision(local([-77.09781, 38.9815]), local([-77.0981, 38.9815])),
    ).toEqual(local([-77.09781, 38.9815]));
  });
  it("starts outside buildings on the mapped Row pedestrian lane", () => {
    expect(buildingAt(row.point)?.name).toBe("Bethesda Elm Street Garage");
    expect(buildingAt(arrival)).toBeUndefined();
    expect(distance(arrival, row.point)).toBeLessThan(190);
    const sim = new CitySimulation(config);
    expect(sim.player).toEqual(arrival);
    const before = { ...sim.player };
    sim.movePlayer(0.3, 0);
    expect(distance(sim.player, before)).toBeGreaterThan(0.29);
    expect(CitySimulation.replay(sim.export()).player).toEqual(sim.player);
  });
  it("refuses traces from other simulator revisions with an explanation", () => {
    const sim = new CitySimulation(config);
    advance(sim, 12);
    expect(REPLAY_SCHEMA).toBe("bethesda-replay/v4");
    for (const schema of [
      "bethesda-replay/v1",
      "bethesda-replay/v2",
      "bethesda-replay/v3",
    ])
      expect(() =>
        CitySimulation.replay({ ...sim.export(), schema } as unknown as Trace),
      ).toThrow(/another revision of the city simulator/);
    expect(SIM_VERSION).toBe("bethesda-city/4");
    expect(() =>
      CitySimulation.replay({
        ...sim.export(),
        simVersion: "bethesda-city/3",
      } as unknown as Trace),
    ).toThrow(/another revision of the city simulator/);
    expect(() =>
      CitySimulation.replay({ ...sim.export(), simVersion: "x" } as unknown as Trace),
    ).toThrow();
  });
});
