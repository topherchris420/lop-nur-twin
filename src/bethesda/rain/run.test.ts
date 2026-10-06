import { describe, expect, it, vi } from "vitest";
import proposal from "./fixtures/demo-proposal.json" with { type: "json" };
import { CitySimulation, REPLAY_SCHEMA } from "../simulation";
import { approve, begin, complete, openCase, type Origin } from "./cases";
import { evaluate } from "../../rain/experiments/evaluate";
import { cohortAt, observeWorld, verifyObservation } from "./observations";
import { regionOf, runToCompletion, type RunResult } from "./runner";
import { armTrace, verifyRecordSync } from "./replay";
import { seal, type ExperimentRecord } from "./record";
import { rainSubmission } from "./submission";

const origin: Origin = { rain: null, rainSource: "unavailable", model: null };
function authorized(p: unknown) {
  const c = openCase(p, { id: "case", now: new Date(), origin });
  if (!c.validated) throw new Error("must validate: " + JSON.stringify(c.checks));
  approve(c, {
    operator: "R.A.I.N.Operator",
    typedPrefix: c.validated.definitionSha256.slice(0, 8),
    reviewed: true,
    now: new Date(),
  });
  expect(begin(c, new Date())).toEqual([]);
  return c;
}
function run(p: unknown) {
  const c = authorized(p);
  const v = c.validated!;
  const started = new Date();
  const result = runToCompletion(
    v.definition,
    v.definitionSha256,
    v.experimentId,
    c.authorization,
  );
  return { c, result, record: complete(c, result, { started, finished: new Date() }) };
}
const quick = {
  ...structuredClone(proposal),
  seeds: [101, 202],
  warmup_ticks: 100,
  observation_window_ticks: 300,
};
const reseal = (r: ExperimentRecord, edit: (r: ExperimentRecord) => void) => {
  const copy = structuredClone(r);
  edit(copy);
  const { record_sha256: _stale, ...body } = copy;
  return seal(body);
};

describe("matched runs", () => {
  const first = run(quick);
  it("are deterministic: the same definition and seeds reproduce every hash and number", () => {
    const again = run(quick);
    const strip = (r: RunResult) =>
      r.arms.map((a) => [
        a.id,
        a.t0_hash,
        a.final_hash,
        a.decisions_hash,
        a.observations,
      ]);
    expect(strip(again.result)).toEqual(strip(first.result));
    expect(again.result.measurements).toEqual(first.result.measurements);
  });
  it("keep both arms identical until the intervention", () => {
    for (const s of first.result.per_seed) expect(s.t0_matched).toBe(true);
    expect(first.result.measurements.matched_t0_seeds).toBe(2);
    const control = first.result.arms.find((a) => a.arm === "control")!;
    const treatment = first.result.arms.find((a) => a.arm === "treatment")!;
    expect(control.commands.map((c) => c.type)).toEqual(["focus"]);
    expect(treatment.commands.map((c) => c.type)).toEqual(["focus", "scenario"]);
    expect(treatment.commands[1]!.tick).toBe(100);
  });
  it("produce metrics from authoritative simulator state", () => {
    // Re-execute an arm's recorded commands and recompute its last packet.
    const arm = first.result.arms[1]!;
    const steps = CitySimulation.execute(arm.config, arm.commands, arm.tick);
    let sim: CitySimulation;
    for (;;) {
      const n = steps.next();
      if (n.done) {
        sim = n.value;
        break;
      }
    }
    const last = arm.observations.at(-1)!;
    expect(last.tick).toBe(sim.tick);
    expect(verifyObservation(last, sim, arm.cohort)).toEqual([]);
  });
  it("record the R.A.I.N. contract's measurements and no status of their own in the submission", () => {
    const s = rainSubmission(
      {
        ...first.record,
        provenance: { ...first.record.provenance, lop_nur_twin_commit: "a".repeat(40) },
      },
      { experimentId: "V3D-EXP-0005", experimentVersion: 1 },
    );
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.value).not.toHaveProperty("status");
    expect(s.value).not.toHaveProperty("verdict");
    expect(s.value.evidence_class).toBe("simulated");
    expect(Object.keys(s.value.measurements as object)).toContain("primary_delta_mean");
  });
  it("refuse to invent the producing commit", () => {
    const s = rainSubmission(first.record, {
      experimentId: "V3D-EXP-0005",
      experimentVersion: 1,
    });
    expect(first.record.provenance.lop_nur_twin_commit).toBeNull();
    expect(s.ok).toBe(false);
  });
});

describe("the demo hypothesis meets the simulator", () => {
  it("is recorded as COMPLETED, NOT SUPPORTED: the simulator moves the cohort the other way", () => {
    const { record, result } = run(proposal);
    expect(record.outcome.state).toBe("COMPLETED");
    expect(record.outcome.verdict).toBe("not_supported");
    expect(result.measurements.primary_delta_mean).toBeLessThan(0);
    expect(result.evaluation.failure[0]).toMatchObject({ id: "F1", holds: true });
    expect(record.outcome.unresolved.join(" ")).toMatch(/real crowds/);
  }, 60_000);
});

describe("observation packets", () => {
  const sim = new CitySimulation({
    seed: 7,
    pedestrians: 60,
    vehicles: 10,
    buses: 2,
    statisticalPopulation: 100,
  });
  for (let i = 0; i < 50; i++) sim.step();
  const definition = run(quick).c.validated!.definition;
  const region = regionOf(definition);
  const cohort = cohortAt(sim, region.center, region.catchment_m);
  const packet = observeWorld(sim, {
    subject: "test",
    experimentId: null,
    arm: "live",
    region,
    cohort,
    replayId: "live",
  });
  it("match the simulator state they name", () => {
    expect(verifyObservation(packet, sim, cohort)).toEqual([]);
    expect(packet.world_hash).toBe(sim.stateHash());
  });
  it("cannot be created from rendered or invented state", () => {
    // What a renderer would know: positions it drew. Neither the hash nor the
    // counts can be made to agree with the simulator by guessing.
    const rendered = {
      ...packet,
      metrics: {
        ...packet.metrics,
        pedestrians_near: (packet.metrics.pedestrians_near ?? 0) + 3,
      },
    };
    expect(verifyObservation(rendered, sim, cohort).join()).toMatch(/metrics/);
    const invented = { ...packet, world_hash: "0".repeat(16) };
    expect(verifyObservation(invented, sim, cohort).join()).toMatch(/world hash/);
    sim.step();
    expect(verifyObservation(packet, sim, cohort).join()).toMatch(/tick/);
    expect(
      verifyObservation({ ...packet, source: "renderer" }, sim, cohort).length,
    ).toBeGreaterThan(0);
  });
});

describe("rain-criteria/v1, as R.A.I.N. applies it", () => {
  const criteria = {
    guards: [{ id: "G1", metric: "n", op: ">=" as const, value: 3, note: "" }],
    success: [{ id: "S1", metric: "d", op: ">=" as const, value: 10, note: "" }],
    failure: [{ id: "F1", metric: "d", op: "<=" as const, value: 0, note: "" }],
  };
  it.each([
    [{ n: 2, d: 50 }, "inconclusive"],
    [{ n: 3, d: -5 }, "failed"],
    [{ n: 3, d: 12 }, "passed"],
    [{ n: 3, d: 5 }, "inconclusive"],
    [{ n: 3, d: null }, "inconclusive"],
    [{ n: null, d: 50 }, "inconclusive"],
  ] as const)("%j → %s", (m, status) => {
    expect(evaluate(criteria, m).status).toBe(status);
  });
  it("lets failure dominate success", () => {
    const both = {
      ...criteria,
      failure: [{ id: "F1", metric: "d", op: ">=" as const, value: 10, note: "" }],
    };
    expect(evaluate(both, { n: 3, d: 12 }).status).toBe("failed");
  });
});

describe("replay", () => {
  const { record } = run(quick);
  it("reproduces the R.A.I.N.-initiated experiment's deterministic state without any model", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const v = verifyRecordSync(structuredClone(record));
    expect(v.checks.filter((c) => !c.ok)).toEqual([]);
    expect(v.ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("exports each arm as a standard city replay that the city's verifier accepts", () => {
    const trace = armTrace(record.run!.arms[1]!);
    expect(trace.schema).toBe(REPLAY_SCHEMA);
    expect(() => CitySimulation.replay(trace)).not.toThrow();
  });
  it.each<[string, (r: ExperimentRecord) => void]>([
    ["a final state", (r) => (r.run!.arms[0]!.final_hash = "0".repeat(16))],
    ["a checkpoint", (r) => (r.run!.arms[1]!.checkpoints[0]!.hash = "0".repeat(16))],
    ["an observation", (r) => (r.run!.arms[1]!.observations[0]!.metrics.watching = 99)],
    ["a decision history", (r) => (r.run!.arms[0]!.decisions_hash = "0".repeat(16))],
    [
      "a smuggled world command",
      (r) => r.run!.arms[0]!.commands.push({ type: "move", tick: 50, dx: 1, dz: 0 }),
    ],
    [
      "an unknown command",
      (r) => (r.run!.arms[0]!.commands as unknown[]).push({ type: "teleport", tick: 1 }),
    ],
    ["a measurement", (r) => (r.run!.measurements.primary_delta_mean = 999)],
    ["the outcome", (r) => (r.outcome.state = "INCONCLUSIVE")],
    ["a seed", (r) => (r.definition!.seeds = [101, 203])],
    ["the authorization", (r) => (r.authorization!.operator = "Someone.Else")],
    ["an arm's population", (r) => (r.run!.arms[0]!.config.pedestrians = 141)],
  ])("fails on a re-sealed change to %s", (_what, edit) => {
    expect(verifyRecordSync(reseal(record, edit)).ok).toBe(false);
  });
  it("fails on any edit the digest catches, before re-simulating", () => {
    const edited = structuredClone(record);
    edited.outcome.summary = "It worked.";
    const v = verifyRecordSync(edited);
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.id === "digest")?.ok).toBe(false);
  });
  it("refuses something that is not a record", () => {
    expect(verifyRecordSync({ schema: REPLAY_SCHEMA }).ok).toBe(false);
    expect(verifyRecordSync(null).ok).toBe(false);
  });
});
