import { afterEach, describe, expect, it, vi } from "vitest";
import proposal from "./fixtures/demo-proposal.json" with { type: "json" };
import { CitySimulation, PROFILES } from "../simulation";
import { LabStore } from "./store";
import { approve, begin, complete, openCase } from "./cases";
import { runToCompletion } from "./runner";
import { modeOf, partnerOf, signature } from "./chladni";
import type { Perspective } from "./contracts";
import {
  PERSPECTIVE_MODES,
  RESONANCE_LABELS,
  RESONANCE_STATES,
  resonanceView,
  snapshotOf,
  type ResonanceSnapshot,
} from "./resonance";

const city = () =>
  new CitySimulation({ ...PROFILES[0]!, pedestrians: 30, vehicles: 6, buses: 1 });
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });
const stores: LabStore[] = [];
const store = (fetchImpl: typeof fetch = vi.fn(), sim = city()) => {
  const s = new LabStore(sim, fetchImpl);
  stores.push(s);
  return s;
};
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
});

const rest: ResonanceSnapshot = {
  live: false,
  asking: false,
  progress: null,
  meeting: null,
  run: null,
  awaiting: null,
  result: null,
};
const meeting = (over: Partial<NonNullable<ResonanceSnapshot["meeting"]>> = {}) => ({
  question: "Does a Metro closure disperse pedestrians?",
  generation: "scripted" as const,
  grounding: "strong" as const,
  missing: 0,
  unverified: 0,
  speakers: ["James", "Jasmine", "Luca", "Elena", "Jasmine", "James"] as Perspective[],
  moves: [
    "frame",
    "reality check",
    "connection",
    "counter-argument",
    "pushback",
    "next move",
  ],
  revealed: 6,
  stagedAt: "2026-10-07T10:00:00.000Z",
  ...over,
});
const snap = (over: Partial<ResonanceSnapshot>): ResonanceSnapshot => ({
  ...rest,
  ...over,
});
const DEF = "d".repeat(64);
const result = (
  state: "COMPLETED" | "INCONCLUSIVE" | "FAILED",
  verdict: "supported" | "not_supported" | "insufficient_evidence" | "not_evaluated",
  at = "2026-10-07T11:00:00.000Z",
) => ({ experimentId: "BX-dddddddddddd", definition: DEF, state, verdict, at });

/** A case taken through a real, short run to its record. */
function finishedCase() {
  const c = openCase(
    {
      ...structuredClone(proposal),
      seeds: [101],
      warmup_ticks: 100,
      observation_window_ticks: 300,
    },
    {
      id: "finished",
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
  complete(
    c,
    runToCompletion(v.definition, v.definitionSha256, v.experimentId, c.authorization),
    {
      started,
      finished: new Date(),
    },
  );
  return c;
}

describe("R.A.I.N.'s resonance is derived from the runtime's state", () => {
  it("names every state, once", () => {
    expect(new Set(RESONANCE_STATES).size).toBe(10);
    for (const s of RESONANCE_STATES) expect(RESONANCE_LABELS[s]).toBeTruthy();
  });
  it("rests when nothing is happening: a still plate offline, its resting figure when connected", () => {
    const offline = resonanceView(snapshotOf(store()));
    expect(offline.state).toBe("idle");
    expect(offline.plate.drive).toEqual([]);
    expect(offline.plate.settle).toBe(0);
    expect(offline.plate.motion).toBe(0);
    expect(offline.because).toMatch(/offline/);
    const live = resonanceView(snap({ live: true }));
    expect(live.state).toBe("idle");
    expect(live.plate.drive).toHaveLength(1);
    expect(live.plate.drive[0]!.f).toBe(modeOf(8, 4).f);
    expect(live.boundary).toBe(false);
  });
  it("stays at rest, not unresolved, when the model services are unavailable", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/status")
        ? respond(200, {
            schema: "rain-bethesda/v2",
            kind: "status",
            configured: true,
            reachable: false,
            identity: null,
            failure: null,
          })
        : respond(503, { error: "unavailable" }),
    );
    const s = store(fetchImpl);
    await s.checkRuntime();
    await s.ask("Does a Metro closure disperse pedestrians?");
    const v = resonanceView(snapshotOf(s));
    expect(s.mode()).toBe("OFFLINE");
    expect(v.state).toBe("idle");
    expect(v.plate.drive).toEqual([]);
    // Deriving the view sent nothing: only the status check went out.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("listens while a question is in flight, and follows a model meeting's real progress", () => {
    const waiting = resonanceView(snap({ live: true, asking: true }));
    expect(waiting.state).toBe("listening");
    const half = resonanceView(
      snap({ live: true, asking: true, progress: { started: 3, planned: 6 } }),
    );
    expect(half.state).toBe("listening");
    expect(half.because).toMatch(/3 of 6 turns started/);
    expect(half.plate.level).toBeGreaterThan(waiting.plate.level);
    // Listening outranks the meeting that is still on the table from before.
    expect(resonanceView(snap({ asking: true, meeting: meeting() })).state).toBe(
      "listening",
    );
  });
  it("deliberates while a meeting is staged: each perspective that has spoken drives the plate, the speaker leads", () => {
    const s = store();
    s.playDemo();
    const first = resonanceView(snapshotOf(s));
    expect(first.state).toBe("deliberating");
    expect(first.sources.James).toEqual({ level: 1, speaking: true });
    expect(first.plate.drive).toEqual([
      expect.objectContaining({ f: PERSPECTIVE_MODES.James.f, a: 1 }),
    ]);
    const third = resonanceView(snap({ meeting: meeting({ revealed: 3 }) }));
    expect(third.state).toBe("deliberating");
    expect(third.plate.drive.map((d) => d.f).sort()).toEqual(
      [
        PERSPECTIVE_MODES.James.f,
        PERSPECTIVE_MODES.Jasmine.f,
        PERSPECTIVE_MODES.Luca.f,
      ].sort(),
    );
    expect(third.plate.drive.find((d) => d.a === 1)!.f).toBe(PERSPECTIVE_MODES.Luca.f);
    expect(third.sources.Elena.level).toBeLessThan(third.sources.James.level);
    expect(third.key).not.toBe(first.key);
  });
  it("converges only on a grounded meeting, into the one figure its question hashes to", () => {
    const v = resonanceView(snap({ meeting: meeting() }));
    expect(v.state).toBe("converging");
    const s = signature("Does a Metro closure disperse pedestrians?")!;
    expect(v.plate.drive).toEqual([{ f: s.mode.f, a: 1, at: s.exciter }]);
    expect(v.because).toMatch(/not validation/);
  });
  it("stays unresolved, honestly, when the grounding is partial, a quote failed or the meeting is a model's", () => {
    const s = store();
    s.playDemo();
    s.revealAll();
    const demo = resonanceView(snapshotOf(s));
    expect(s.meeting!.record.grounding).toBe("partial");
    expect(demo.state).toBe("uncertain");
    expect(demo.because).toMatch(/grounding was partial/);
    expect(demo.plate.drive.length).toBeGreaterThan(1);
    expect(resonanceView(snap({ meeting: meeting({ unverified: 2 }) })).because).toMatch(
      /2 quoted spans could not be verified/,
    );
    const model = resonanceView(
      snap({ meeting: meeting({ generation: "model", grounding: null }) }),
    );
    expect(model.state).toBe("uncertain");
    expect(model.because).toMatch(/not graded/);
  });
  it("stops at the boundary when a case waits for a person, and leaves it once a person decides", () => {
    const s = store();
    s.proposeDemo();
    const c = s.cases[0]!;
    const v = resonanceView(snapshotOf(s));
    expect(c.lifecycle.state).toBe("AWAITING_HUMAN_APPROVAL");
    expect(v.state).toBe("awaiting-human");
    expect(v.boundary).toBe(true);
    expect(v.plate.motion).toBe(0);
    expect(v.because).toMatch(/only a person can authorize it/);
    // A finished meeting does not hide the boundary; a meeting being staged does, until it ends.
    expect(resonanceView({ ...snapshotOf(s), meeting: meeting() }).state).toBe(
      "awaiting-human",
    );
    expect(
      resonanceView({ ...snapshotOf(s), meeting: meeting({ revealed: 2 }) }).state,
    ).toBe("deliberating");
    s.approve(c.id, {
      operator: "R.A.I.N.Operator",
      typedPrefix: c.validated!.definitionSha256.slice(0, 8),
      reviewed: true,
    });
    expect(c.lifecycle.state).toBe("AUTHORIZED");
    expect(resonanceView(snapshotOf(s)).boundary).toBe(false);
  });
  it("runs the experiment's figure while it runs, its sand gathering with the run's progress", () => {
    const run = (done: number) =>
      resonanceView(
        snap({
          run: {
            experimentId: "BX-dddddddddddd",
            definition: DEF,
            arm: 0,
            arms: 2,
            done,
          },
          asking: true,
          awaiting: { experimentId: "BX-eeeeeeeeeeee", definition: "e".repeat(64) },
        }),
      );
    expect(run(0).state).toBe("experiment");
    expect(run(0.9).plate.settle).toBeGreaterThan(run(0.1).plate.settle);
    expect(run(0.5).because).toMatch(/simulator, not R\.A\.I\.N\., decides/);
    const fig = signature(DEF, true)!;
    expect(run(0.5).plate.drive).toEqual([{ f: fig.mode.f, a: 1, at: fig.exciter }]);
    expect(Object.values(run(0.5).sources).every((p) => p.level < 0.1)).toBe(true);
  });
  it("answers supported, contradicted and unresolved results distinctly, and quietly", () => {
    const fig = signature(DEF, true)!;
    const supported = resonanceView(snap({ result: result("COMPLETED", "supported") }));
    expect(supported.state).toBe("result-supported");
    expect(supported.plate.drive).toEqual([{ f: fig.mode.f, a: 1, at: fig.exciter }]);
    const contradicted = resonanceView(
      snap({ result: result("COMPLETED", "not_supported") }),
    );
    expect(contradicted.state).toBe("result-contradicted");
    expect(contradicted.label).toBe("Result: not supported");
    expect(contradicted.plate.drive[0]!.f).toBe(partnerOf(fig.mode)!.f);
    const inconclusive = resonanceView(
      snap({ result: result("INCONCLUSIVE", "insufficient_evidence") }),
    );
    const failed = resonanceView(snap({ result: result("FAILED", "not_evaluated") }));
    for (const v of [inconclusive, failed]) {
      expect(v.state).toBe("result-unresolved");
      expect(v.plate.drive).toHaveLength(2);
    }
    expect(failed.because).toMatch(/nothing was evaluated/);
    for (const v of [supported, contradicted, inconclusive, failed]) {
      expect(v.because).toMatch(/not evidence for it/);
      expect(v.plate.motion).toBeLessThanOrEqual(0.1);
      expect(v.boundary).toBe(false);
    }
    expect(
      new Set([supported.plate.pigment, contradicted.plate.pigment, failed.plate.pigment])
        .size,
    ).toBe(3);
  });
  it("shows the newer of a finished meeting and a finished run", () => {
    const later = "2026-10-07T12:00:00.000Z";
    expect(
      resonanceView(
        snap({ meeting: meeting(), result: result("COMPLETED", "supported") }),
      ).state,
    ).toBe("result-supported");
    expect(
      resonanceView(
        snap({
          meeting: meeting({ stagedAt: later }),
          result: result("COMPLETED", "supported"),
        }),
      ).state,
    ).toBe("converging");
  });
  it("is deterministic: the same facts always give the same view", () => {
    for (const s of [
      rest,
      snap({ live: true }),
      snap({ meeting: meeting({ revealed: 4 }) }),
      snap({ meeting: meeting({ grounding: "none", missing: 3 }) }),
      snap({ result: result("COMPLETED", "not_supported") }),
    ]) {
      const a = resonanceView(s),
        b = resonanceView(structuredClone(s));
      expect(b).toEqual(a);
      expect(b.key).toBe(a.key);
    }
    const one = store(),
      two = store();
    for (const s of [one, two]) {
      s.playDemo();
      s.revealAll();
    }
    const a = snapshotOf(one),
      b = snapshotOf(two);
    expect({ ...b, meeting: { ...b.meeting!, stagedAt: "" } }).toEqual({
      ...a,
      meeting: { ...a.meeting!, stagedAt: "" },
    });
    expect(resonanceView(b).key).toBe(resonanceView(a).key);
  });
});

describe("the resonance only looks", () => {
  it("never changes the store, a case, a record, the registry or the city", () => {
    const sim = city();
    sim.paused = true;
    const hash = sim.stateHash();
    const s = store(vi.fn(), sim);
    s.playDemo();
    s.revealAll();
    s.proposeDemo();
    s.cases = [finishedCase(), ...s.cases];
    s.records = [s.cases[0]!.record!, ...s.records];
    const before = JSON.stringify({
      cases: s.cases.map((c) => ({ ...c, lifecycle: c.lifecycle.history })),
      records: s.records,
      meeting: s.meeting,
      quarantine: s.quarantine,
      verifications: s.verifications,
      notes: [s.note, s.proposalNote, s.registryNote],
    });
    const version = s.version;
    const listener = vi.fn();
    s.subscribe(listener);
    for (let i = 0; i < 5; i++) resonanceView(snapshotOf(s));
    expect(
      JSON.stringify({
        cases: s.cases.map((c) => ({ ...c, lifecycle: c.lifecycle.history })),
        records: s.records,
        meeting: s.meeting,
        quarantine: s.quarantine,
        verifications: s.verifications,
        notes: [s.note, s.proposalNote, s.registryNote],
      }),
    ).toBe(before);
    expect(s.version).toBe(version);
    expect(listener).not.toHaveBeenCalled();
    expect(sim.stateHash()).toBe(hash);
    expect(sim.paused).toBe(true);
  });
  it("derives from a frozen snapshot without touching it", () => {
    const deepFreeze = <T>(o: T): T => {
      if (o && typeof o === "object") {
        for (const v of Object.values(o)) deepFreeze(v);
        Object.freeze(o);
      }
      return o;
    };
    for (const s of [
      snap({ meeting: meeting({ revealed: 2 }) }),
      snap({ awaiting: { experimentId: "BX-dddddddddddd", definition: DEF } }),
      snap({ result: result("INCONCLUSIVE", "insufficient_evidence") }),
    ])
      expect(() => resonanceView(deepFreeze(s))).not.toThrow();
  });
  it("reads a finished run's record as the registry wrote it", () => {
    const s = store();
    const c = finishedCase();
    s.cases = [c];
    const v = resonanceView(snapshotOf(s));
    const outcome = c.record!.outcome;
    expect(v.because).toContain(`${c.validated!.experimentId} as ${outcome.state}`);
    expect(v.state).toBe(
      outcome.state === "COMPLETED"
        ? outcome.verdict === "supported"
          ? "result-supported"
          : "result-contradicted"
        : "result-unresolved",
    );
  });
});
