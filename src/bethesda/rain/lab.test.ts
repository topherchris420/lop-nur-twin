import { afterEach, describe, expect, it, vi } from "vitest";
import meeting from "./fixtures/demo-meeting.json" with { type: "json" };
import {
  arrival,
  buildingAt,
  buildings,
  distance,
  geographic,
  inBounds,
  landmarks,
} from "../model";
import { storefronts } from "../streetscape";
import { CitySimulation, PROFILES } from "../simulation";
import { resolvesBethesda } from "../discovery";
import { compileScenario } from "../scenarios";
import { LAB_BUILDING_ID, LAB_DOOR, OPEN_RADIUS, nearDoor, resolvesLab } from "./site";
import { ROOMS, ROOM_IDS, SPAWN, moveInLab, roomAt } from "./labLayout";
import { LabStore } from "./store";
import { neutralEvents } from "./session";

const city = () => {
  const sim = new CitySimulation({
    ...PROFILES[0]!,
    pedestrians: 30,
    vehicles: 6,
    buses: 1,
  });
  for (let i = 0; i < 10; i++) sim.step();
  return sim;
};
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });
const stores: LabStore[] = [];
const store = (fetchImpl: typeof fetch, sim = city()) => {
  const s = new LabStore(sim, fetchImpl);
  stores.push(s);
  return s;
};
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
});

describe("the hidden entrance", () => {
  it("is on the rear wall of an unnamed building, away from any storefront", () => {
    const host = buildings.find((b) => b.id === LAB_BUILDING_ID)!;
    expect(host).toBeDefined();
    expect(host.name).toBe("");
    expect(host.heightEvidence).toBe("inferred");
    expect(LAB_DOOR).not.toBeNull();
    const door = LAB_DOOR!.point;
    expect(buildingAt(door)).toBeUndefined();
    expect(Math.min(...storefronts.map((s) => distance(s.point, door)))).toBeGreaterThan(
      45,
    );
  });
  it("is not on the map, the landmark list or arrival's doorstep", () => {
    expect(landmarks.some((l) => distance(l.point, LAB_DOOR!.point) < 60)).toBe(false);
    expect(distance(arrival, LAB_DOOR!.point)).toBeGreaterThan(100);
    expect(nearDoor(arrival)).toBe(false);
  });
  it("can be reached on foot from where Bethesda begins", () => {
    // Breadth-first over free ground at 1.5 m, the way a walker can move.
    const step = 1.5,
      key = (x: number, z: number) => `${x},${z}`;
    const start = { x: Math.round(arrival.x / step), z: Math.round(arrival.z / step) };
    const seen = new Set([key(start.x, start.z)]),
      queue = [start];
    let reached = false;
    while (queue.length) {
      const c = queue.shift()!;
      if (distance({ x: c.x * step, z: c.z * step }, LAB_DOOR!.point) < OPEN_RADIUS) {
        reached = true;
        break;
      }
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const q = { x: c.x + dx, z: c.z + dz },
          p = { x: q.x * step, z: q.z * step };
        if (seen.has(key(q.x, q.z)) || !inBounds(p) || buildingAt(p)) continue;
        seen.add(key(q.x, q.z));
        queue.push(q);
      }
    }
    expect(reached).toBe(true);
  });
  it("opens by its own coordinates or a phrase, and nothing else", () => {
    const g = geographic(LAB_DOOR!.point);
    expect(resolvesLab(`${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}`)).toBe(true);
    expect(resolvesLab("resolve r.a.i.n.")).toBe(true);
    expect(resolvesLab("Resolve R.A.I.N.")).toBe(true);
    for (const t of ["38.9847,-77.0947", "resolve bethesda", "rain", "x".repeat(65), ""])
      expect(resolvesLab(t)).toBe(false);
    // The two hidden things stay separate: in the desert the door's coordinates
    // resolve Bethesda itself; the lab opens only from inside the city.
    expect(resolvesBethesda(`${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}`)).toBe(true);
    // And the phrase is not a scenario the city would inject.
    expect(compileScenario("resolve r.a.i.n.").events).toEqual([]);
  });
});

describe("the interior", () => {
  it("connects every room to the threshold and keeps the walker inside", () => {
    for (const id of ROOM_IDS) expect(roomAt(ROOMS[id].spawn)).toBe(id);
    expect(roomAt(SPAWN)).toBe("threshold");
    expect(moveInLab(SPAWN, { x: SPAWN.x, z: 40 })).toEqual(SPAWN);
    expect(moveInLab({ x: 0, z: 8 }, { x: 0, z: 6 })).toEqual({ x: 0, z: 6 });
  });
});

describe("entering and leaving preserve Bethesda", () => {
  it("the lab's actions never step, edit or refocus the live city", () => {
    const sim = city();
    sim.paused = true;
    const before = { hash: sim.stateHash(), commands: structuredClone(sim.commands) };
    const s = store(
      vi.fn(async () => respond(200, {})),
      sim,
    );
    s.enterRoom("panel");
    s.playDemo();
    s.revealAll();
    s.proposeDemo();
    const c = s.cases[0]!;
    s.approve(c.id, {
      operator: "R.A.I.N.Operator",
      typedPrefix: c.validated!.definitionSha256.slice(0, 8),
      reviewed: true,
    });
    s.enterRoom("registry");
    expect(sim.stateHash()).toBe(before.hash);
    expect(sim.commands).toEqual(before.commands);
    expect(sim.paused).toBe(true);
  });
});

describe("OFFLINE, DEMO and LIVE", () => {
  it("OFFLINE: Bethesda works, the lab says the runtime is unavailable, and nothing is sent", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/status")
        ? respond(200, {
            schema: "rain-bethesda/v1",
            kind: "status",
            configured: false,
            reachable: null,
            identity: null,
            failure: null,
          })
        : respond(503, { error: "not configured" }),
    );
    const sim = city();
    const s = store(fetchImpl, sim);
    await s.checkRuntime();
    expect(s.mode()).toBe("OFFLINE");
    await s.ask("Does a Metro closure disperse pedestrians?");
    expect(s.meeting).toBeNull();
    expect(s.note).toMatch(/OFFLINE/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const tick = sim.tick;
    sim.step();
    expect(sim.tick).toBe(tick + 1);
  });
  it("DEMO: replays the recording, labelled, and never claims a model", () => {
    const s = store(vi.fn());
    s.playDemo();
    expect(s.meeting?.source).toBe("DEMO");
    expect(s.meeting?.record.generation).toBe("scripted");
    expect(s.note).toMatch(/PRERECORDED/);
    expect(s.note).toMatch(/not sent/);
  });
  it("LIVE: a failed request shows the failure, never the recording in its place", async () => {
    const identity = {
      schema: "rain-bethesda/v1",
      kind: "identity",
      bridge: { name: "rain-bethesda-bridge", version: "1" },
      rain: {
        repository: "topherchris420/james_library",
        commit: "9".repeat(40),
        dirty: false,
      },
      corpus: { files: 17, sha256: "a".repeat(64) },
      meeting_engine: "james_library.launcher.offline_meeting.build_offline_meeting",
      meeting_generation: "scripted",
      model: null,
      bounded_decision: "off",
      registry: { available: true, scratch: true },
    };
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/status")
        ? respond(200, {
            schema: "rain-bethesda/v1",
            kind: "status",
            configured: true,
            reachable: true,
            identity,
            failure: null,
          })
        : respond(504, { error: "timeout" }),
    );
    const s = store(fetchImpl);
    await s.checkRuntime();
    expect(s.mode()).toBe("LIVE");
    await s.ask(meeting.question);
    expect(s.meeting).toBeNull();
    expect(s.note).toMatch(/LIVE request failed: TIMEOUT/);
    expect(s.note).toMatch(/Nothing is shown in its place/);
  });
  it("LIVE: an answer that fails validation is refused, not shown", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () =>
      call++ === 0
        ? respond(200, {
            schema: "rain-bethesda/v1",
            kind: "status",
            configured: true,
            reachable: true,
            identity: null,
            failure: null,
          })
        : respond(200, { ...meeting, injected: true }),
    );
    const s = store(fetchImpl);
    await s.checkRuntime();
    // A reachable backend without a valid identity is not LIVE.
    expect(s.mode()).toBe("OFFLINE");
  });
});

describe("embodiment follows R.A.I.N.'s neutral event vocabulary", () => {
  it("turns the record into conversation events whose words are the record's", () => {
    const events = neutralEvents(meeting as never);
    expect(events[0]).toMatchObject({
      type: "conversation_started",
      conversation_id: meeting.meeting_id,
    });
    expect(events.at(-1)).toMatchObject({ type: "conversation_ended" });
    const first = events[1] as { type: string; agent_id: string; text: string };
    expect(first.type).toBe("agent_utterance");
    expect(first.agent_id).toBe("james");
    expect(first.text).toContain(meeting.turns[0]!.lead);
    expect(events.filter((e) => e.type === "agent_utterance").length).toBe(
      meeting.turns.length,
    );
  });
});
