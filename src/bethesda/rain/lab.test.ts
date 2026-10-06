import { afterEach, describe, expect, it, vi } from "vitest";
import meeting from "./fixtures/demo-meeting.json" with { type: "json" };
import proposal from "./fixtures/demo-proposal.json" with { type: "json" };
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
import { evidenceItems, neutralEvents } from "./session";
import { approve, begin, complete, openCase } from "./cases";
import { runToCompletion } from "./runner";
import { seal, type ExperimentRecord } from "./record";
import type { Verification } from "./replay";

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
            schema: "rain-bethesda/v2",
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
      schema: "rain-bethesda/v2",
      kind: "identity",
      runtime: { name: "lop-nur-twin-rain", version: "1" },
      rain: {
        repository: "topherchris420/lop-nur-twin",
        commit: "9".repeat(40),
        dirty: false,
      },
      corpus: { files: 17, sha256: "a".repeat(64) },
      meeting_engine: "rain.meeting.offline.buildOfflineMeeting",
      meeting_generation: "scripted",
      model: null,
      bounded_decision: "off",
      remote_decisions: false,
      registry: { available: true, scratch: true },
    };
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/status")
        ? respond(200, {
            schema: "rain-bethesda/v2",
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
            schema: "rain-bethesda/v2",
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

describe("authorship", () => {
  it("a proposal written by hand cannot claim to be R.A.I.N.'s or the DEMO's", () => {
    const s = store(vi.fn());
    const base = { ...structuredClone(proposal), origin: "human", rain_decision: null };
    for (const claim of [
      {
        origin: "rain",
        rain_decision: {
          decision_id: "f01bc094-730a-47b7",
          envelope_hash: "e".repeat(64),
        },
      },
      { origin: "fixture" },
      {
        rain_decision: {
          decision_id: "f01bc094-730a-47b7",
          envelope_hash: "e".repeat(64),
        },
      },
    ]) {
      s.proposeByHand({ ...base, ...claim });
      expect(s.cases).toHaveLength(0);
      expect(s.proposalNote).toMatch(/person's/);
    }
    s.proposeByHand(base);
    expect(s.cases).toHaveLength(1);
    expect(s.cases[0]!.validated?.proposal.origin).toBe("human");
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

describe("LIVE: a model meeting, and a choice R.A.I.N. hands back", () => {
  const modelIdentity = {
    schema: "rain-bethesda/v2",
    kind: "identity",
    runtime: { name: "lop-nur-twin-rain", version: "1" },
    rain: {
      repository: "topherchris420/lop-nur-twin",
      commit: "9".repeat(40),
      dirty: false,
    },
    corpus: { files: 17, sha256: "a".repeat(64) },
    meeting_engine: "rain.meeting.model.holdMeeting",
    meeting_generation: "model",
    model: "qwen2.5:7b",
    bounded_decision: "jev",
    remote_decisions: true,
    registry: { available: true, scratch: true },
  };
  const JOB = "9".repeat(32);
  const pending = (requestId: string, turns = 0) => ({
    schema: "rain-bethesda/v2",
    kind: "meeting-pending",
    request_id: requestId,
    job_id: JOB,
    question: meeting.question,
    model: "qwen2.5:7b",
    started_at: "2026-10-03T03:43:59.086Z",
    elapsed_s: turns * 9,
    turns_started: turns,
    turns_planned: 25,
  });
  const modelMeeting = (requestId: string) => {
    const m = structuredClone(meeting) as unknown as Record<string, unknown> & {
      turns: Record<string, unknown>[];
    };
    m.request_id = requestId;
    m.generation = "model";
    m.model = "qwen2.5:7b";
    m.engine = "rain.meeting.model.holdMeeting";
    m.grounding = m.matched_terms = m.missing_terms = m.verdict = null;
    m.turns.forEach((t) => (t.generation = "model"));
    m.source_artifact = {
      schema: "rain-session-artifact/v1",
      session_id: "3298be35",
      status: "completed",
      sha256: "d".repeat(64),
    };
    return m;
  };
  /** The site's route, faked: a LIVE status, then whatever the case serves. */
  const route = (serve: (path: string, body: Record<string, unknown>) => Response) =>
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/rain\//, "");
      if (path === "status")
        return respond(200, {
          schema: "rain-bethesda/v2",
          kind: "status",
          configured: true,
          reachable: true,
          identity: modelIdentity,
          failure: null,
        });
      return serve(path, JSON.parse(String(init?.body)) as Record<string, unknown>);
    });
  it("waits on R.A.I.N.'s model meeting, shows progress, and shows its words only when it ends", async () => {
    let checks = 0;
    const seen: { progress: boolean; meeting: boolean }[] = [];
    const fetchImpl = route((path, body) => {
      const id = body.request_id as string;
      if (path === "meeting") return respond(200, pending(id));
      if (path === "meeting-status")
        return respond(200, ++checks < 3 ? pending(id, checks) : modelMeeting(id));
      return respond(404, {});
    });
    const s = store(fetchImpl);
    s.pollMs = 1;
    await s.checkRuntime();
    expect(s.mode()).toBe("LIVE");
    s.subscribe(() => seen.push({ progress: !!s.meetingProgress, meeting: !!s.meeting }));
    await s.ask(meeting.question);
    expect(seen.some((x) => x.progress && !x.meeting)).toBe(true);
    expect(seen.every((x) => !(x.progress && x.meeting))).toBe(true);
    expect(s.meeting?.source).toBe("LIVE");
    expect(s.meeting?.record.generation).toBe("model");
    expect(s.note).toMatch(/generated by qwen2\.5:7b/);
    expect(s.meetingProgress).toBeNull();
  });
  it("stops a model meeting when asked, and shows nothing in its place", async () => {
    const calls: string[] = [];
    const fetchImpl = route((path, body) => {
      calls.push(path);
      const id = body.request_id as string;
      if (path === "meeting-cancel")
        return respond(200, {
          schema: "rain-bethesda/v2",
          kind: "meeting-failed",
          request_id: id,
          job_id: JOB,
          reason: "stopped at the lab's request",
        });
      return respond(200, pending(id, 1));
    });
    const s = store(fetchImpl);
    s.pollMs = 5;
    await s.checkRuntime();
    const asked = s.ask(meeting.question);
    await new Promise((r) => setTimeout(r, 40));
    s.stopAsking();
    await asked;
    expect(calls).toContain("meeting-cancel");
    expect(s.meeting).toBeNull();
    expect(s.note).toMatch(/CANCELLED/);
  });
  const handed = (body: Record<string, unknown>, attempts: unknown[]) =>
    respond(200, {
      schema: "rain-bethesda/v2",
      kind: "proposal-choice",
      request_id: body.request_id,
      decision: {
        schema_version: "rain-bounded-decision/v1",
        decision_id: "c78bbc57-51be-4443-b1b2-f191aa9988f0",
        destination: "rain",
        selected: null,
        reason: "INSUFFICIENT_CALIBRATION",
        envelope_hash: "f".repeat(64),
        attempts,
        latency_ms: 234.1,
      },
    });
  it("keeps the choice Jev made that R.A.I.N. did not act on, and lets a person make it their own", async () => {
    const jev = {
      engine: "typesafe",
      model: "jev-1.13.0",
      selected: "X1",
      probabilities: [
        ["X1", 0.63],
        ["ESCALATE_TO_HUMAN", 0.36],
        ["X7", 0.01],
      ],
      confidence: 0.59,
      reason: "INSUFFICIENT_CALIBRATION",
      error_code: null,
      latency_ms: 233.4,
    };
    const s = store(
      route((path, body) =>
        path === "proposal" ? handed(body, [jev]) : respond(404, {}),
      ),
    );
    await s.checkRuntime();
    await s.askRainForProposal(meeting.question);
    // R.A.I.N. proposed nothing: no case opens on an engine's word.
    expect(s.cases).toHaveLength(0);
    expect(s.handoffs[0]?.attempts[0]).toMatchObject({
      engine: "typesafe",
      selected: "X1",
    });
    expect(s.proposalNote).toMatch(
      /consulted Jev \(jev-1\.13\.0\), which chose X1 at 0\.63/,
    );
    expect(s.proposalNote).toMatch(
      /did not act on that answer \(INSUFFICIENT_CALIBRATION\)/,
    );
    s.adoptSuggestion(s.handoffs[0]!.decisionId);
    expect(s.cases).toHaveLength(1);
    const p = s.cases[0]!.validated!.proposal;
    expect(p.origin).toBe("human");
    expect(p.rain_decision).toBeNull();
    expect(p.scenario).toBe("metro_closure");
  });
  it("offers nothing to adopt when the remote engine was not asked", async () => {
    const notAsked = {
      engine: "typesafe",
      model: null,
      selected: null,
      probabilities: [],
      confidence: null,
      reason: "POLICY_REQUIRES_REVIEW",
      error_code: null,
      latency_ms: 0,
    };
    const s = store(
      route((path, body) =>
        path === "proposal" ? handed(body, [notAsked]) : respond(404, {}),
      ),
    );
    await s.checkRuntime();
    await s.askRainForProposal(meeting.question);
    expect(s.handoffs[0]?.attempts).toHaveLength(1);
    s.adoptSuggestion(s.handoffs[0]!.decisionId);
    expect(s.cases).toHaveLength(0);
    expect(s.proposalNote).toMatch(/A person may choose an experiment instead/);
  });
});

describe("an imported record is not evidence until replay passes", () => {
  // A real, small run of the DEMO proposal, and a copy edited and re-sealed:
  // its digest matches, because anyone can seal a record.
  const genuine = (() => {
    const c = openCase(
      {
        ...structuredClone(proposal),
        seeds: [101],
        warmup_ticks: 100,
        observation_window_ticks: 300,
      },
      {
        id: "case",
        now: new Date(),
        origin: { rain: null, rainSource: "unavailable", model: null },
      },
    );
    const v = c.validated!;
    approve(c, {
      operator: "R.A.I.N.Operator",
      typedPrefix: v.definitionSha256.slice(0, 8),
      reviewed: true,
      now: new Date(),
    });
    begin(c, new Date());
    const started = new Date();
    const result = runToCompletion(
      v.definition,
      v.definitionSha256,
      v.experimentId,
      c.authorization,
    );
    return complete(c, result, { started, finished: new Date() });
  })();
  const forged = (() => {
    const copy = structuredClone(genuine);
    copy.run!.arms[0]!.final_hash = "0".repeat(16);
    const { record_sha256: _stale, ...body } = copy;
    return seal(body);
  })();
  const settled = async (s: LabStore, runId: string) => {
    await vi.waitFor(
      () => {
        const v = s.verifications[runId];
        if (!v || v === "running") throw new Error("still verifying");
      },
      { timeout: 60_000, interval: 20 },
    );
    return s.verifications[runId] as Verification;
  };
  it("keeps a re-sealed edit quarantined: out of the registry, the evidence and storage", async () => {
    const s = store(vi.fn());
    s.importRecord(JSON.stringify(forged));
    expect(s.records).toEqual([]);
    expect(s.quarantine.map((r) => r.run_id)).toEqual([forged.run_id]);
    expect((await settled(s, forged.run_id)).ok).toBe(false);
    expect(s.records).toEqual([]);
    expect(s.quarantine).toHaveLength(1);
    expect(s.registryNote).toMatch(/failed verification by replay and stays quarantined/);
    expect(evidenceItems(null, s.records)).toEqual([]);
    s.discardImport(forged.run_id);
    expect(s.quarantine).toEqual([]);
  }, 90_000);
  it("admits a genuine record once replay re-simulates every arm", async () => {
    const s = store(vi.fn());
    s.importRecord(JSON.stringify(genuine));
    expect(s.records).toEqual([]);
    expect((await settled(s, genuine.run_id)).ok).toBe(true);
    expect(s.quarantine).toEqual([]);
    expect(s.records.map((r: ExperimentRecord) => r.run_id)).toEqual([genuine.run_id]);
    expect(
      evidenceItems(null, s.records).some((i) => i.category === "SIMULATION RESULT"),
    ).toBe(true);
    s.importRecord(JSON.stringify(genuine));
    expect(s.registryNote).toMatch(/already in the registry/);
    // A different record under a number the registry holds is not imported at all.
    s.importRecord(JSON.stringify(forged));
    expect(s.registryNote).toMatch(/already holds a different record/);
    expect(s.quarantine).toEqual([]);
    expect(s.records.map((r) => r.record_sha256)).toEqual([genuine.record_sha256]);
  }, 90_000);
});
