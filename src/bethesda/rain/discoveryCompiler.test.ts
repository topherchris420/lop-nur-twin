import { describe, expect, it } from "vitest";
import { fixtureDesign } from "../../rain/autonomy/discoveryFixtures.js";
import { DEFAULT_ENVELOPE } from "./discoveryProtocol.js";
import {
  compileDesign,
  protocolFingerprint,
  type PriorDesign,
} from "./discoveryCompiler.js";
import {
  charterDesigns,
  buildDiscoveryCharter,
  authorizeCharter,
  charterSha256,
  admit,
  verifyStanding,
} from "./standing.js";
import { verifyDefinition } from "./experiments.js";
import { sha256Json } from "../../rain/sha256.js";
const decision = { decision_id: "test-decision", envelope_hash: "a".repeat(64) };
const ctx = () => ({
  envelope: structuredClone(DEFAULT_ENVELOPE),
  seeds: [901, 902, 903],
  decision,
  prior: [] as PriorDesign[],
  evidenceIds: new Set<string>(),
});
const good = () => {
  const c = compileDesign(fixtureDesign(), ctx());
  if (!c.ok) throw new Error(c.errors.join("; "));
  return c.value;
};
describe("native experiment discovery compiler", () => {
  it("retains all 44 legacy designs and compiles new parameters reproducibly", () => {
    expect(charterDesigns()).toHaveLength(44);
    const a = good();
    expect(good()).toEqual(a);
    expect(a.validated.definition.population.pedestrians).toBe(40);
    expect(a.validated.definition.scenario.event.intensity).toBe(1);
    expect(a.validated.definition.scenario.event.radius).toBe(22);
    expect(
      verifyDefinition(a.validated.definition, a.validated.definitionSha256),
    ).toEqual([]);
  });
  it.each([
    { scenario: "earthquake" },
    { location: "paris" },
    { code: "process.exit()" },
    { comparison: "unmatched" },
    { primary_metric: "happiness" },
    { warmup_ticks: 101 },
    { minimum_effect: NaN },
    { question: "\u200b" },
    { hypothesis: "same", competing_hypothesis: "same" },
    { evidence_ids: ["imaginary-run"] },
    { parent_design_id: "imaginary-parent" },
    { parameters: { ...fixtureDesign().parameters, pedestrians: 641 } },
    { parameters: { ...fixtureDesign().parameters, duration_ticks: 6010 } },
    { scenario: "metro_closure", location: "bethesda_row" },
  ])("rejects unsupported or malformed protocols %j", (patch) => {
    expect(compileDesign({ ...fixtureDesign(), ...patch }, ctx()).ok).toBe(false);
  });
  it("does not count intensity changes without a measured-population effect as novelty", () => {
    for (const scenario of ["storm", "metro_closure"] as const) {
      const design = {
        ...fixtureDesign(),
        scenario,
        location:
          scenario === "storm" ? ("downtown" as const) : ("bethesda_metro" as const),
      };
      const a = compileDesign(design, ctx());
      if (!a.ok) throw new Error(a.errors.join("; "));
      const context = ctx();
      context.prior.push({
        id: "prior",
        definition: a.value.validated.definition,
        run_id: "run1",
        replay_verified: true,
      });
      expect(
        compileDesign(
          { ...design, parameters: { ...design.parameters, intensity: 2 } },
          context,
        ).ok,
      ).toBe(false);
    }
  });
  it("checks resource cost and authorization envelope", () => {
    const context = ctx();
    context.envelope.max_actor_ticks = 100;
    expect(compileDesign(fixtureDesign(), context).ok).toBe(false);
    context.envelope.max_actor_ticks = 8_000_000;
    context.envelope.pedestrians = [80, 160];
    expect(compileDesign(fixtureDesign(), context).ok).toBe(false);
  });
  it("rejects renaming, metric-switching, reversed expectations and changed thresholds as novelty", () => {
    const first = good();
    const context = ctx();
    context.prior.push({
      id: "parent",
      definition: first.validated.definition,
      run_id: "run1",
      replay_verified: true,
    });
    for (const patch of [
      { question: "new name" },
      { primary_metric: "leaving" },
      { expected_direction: "decrease" },
      { minimum_effect: 0.5 },
    ])
      expect(compileDesign({ ...fixtureDesign(), ...patch }, context).ok).toBe(false);
  });
  it("freezes confirmatory criteria and requires disjoint withheld seeds and a cited parent", () => {
    const first = good();
    const context = ctx();
    context.prior.push({
      id: "parent",
      definition: first.validated.definition,
      run_id: "run1",
      replay_verified: true,
    });
    context.evidenceIds.add("run1");
    const d = {
      ...fixtureDesign(),
      purpose: "confirmatory",
      parent_design_id: "parent",
      evidence_ids: ["run1"],
    };
    expect(compileDesign(d, context).ok).toBe(false);
    context.seeds = [904, 905, 906];
    expect(compileDesign(d, context).ok).toBe(true);
    expect(compileDesign({ ...d, minimum_effect: 0.1 }, context).ok).toBe(false);
    expect(compileDesign({ ...d, primary_metric: "leaving" }, context).ok).toBe(false);
    expect(
      compileDesign(
        { ...d, parameters: { ...d.parameters, duration_ticks: 500 } },
        context,
      ).ok,
    ).toBe(false);
    expect(compileDesign({ ...d, evidence_ids: [] }, context).ok).toBe(false);
    expect(protocolFingerprint(first.validated.definition)).toHaveLength(64);
  });
  it("revalidates family authority and refuses a resealed criteria or parameter edit", () => {
    const v = good().validated;
    const charter = buildDiscoveryCharter({
      ceilings: {
        iterations: 2,
        experiments: 2,
        runtime_ms: 30000,
        failed_proposals: 2,
        model_calls: 8,
        model_tokens: null,
      },
      model: {
        provider: "lmstudio",
        model: "qwen-test",
        endpoint: "http://127.0.0.1:1234",
      },
      validHours: 1,
      envelope: DEFAULT_ENVELOPE,
    });
    const a = authorizeCharter({
      charter,
      operator: "Test.Operator",
      reviewed: true,
      typedPrefix: charterSha256(charter).slice(0, 8),
      now: new Date(),
    });
    if (!a.ok) throw new Error("auth");
    const admitted = admit({
      charter,
      authorization: a.value,
      sessionId: "test-session",
      iteration: 1,
      decision: {
        decision_id: decision.decision_id,
        decision_sha256: decision.envelope_hash,
      },
      designId: "novel",
      validated: v,
      measured: new Map(),
      experimentsThisSession: 0,
      budgets: charter.ceilings,
      runtimeLeftMs: 30000,
      now: new Date(),
    });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    expect(
      verifyStanding(admitted.standing, v.experimentId, v.definition, v.definitionSha256),
    ).toEqual([]);
    const edited = structuredClone(v.definition);
    edited.criteria.success[0]!.value = -999;
    expect(verifyDefinition(edited, sha256Json(edited))).toContain(
      "generated definition does not recompile identically",
    );
    admitted.standing.charter.family!.pedestrians = [80, 160];
    expect(
      verifyStanding(admitted.standing, v.experimentId, v.definition, v.definitionSha256)
        .length,
    ).toBeGreaterThan(0);
  });
});
