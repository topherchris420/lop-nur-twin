import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "../experiments/evaluate.js";
import { Registry } from "../experiments/registry.js";
import { sha256, sha256Json } from "../sha256.js";
import { resolveParams } from "../../bethesda/fly/params.js";
import {
  BACKEND_CAPABILITIES,
  FLY_ALPHA,
  FLY_BACKEND,
  FLY_LEGACY_RECORD,
  FLY_METRICS,
  FLY_MIN_UNTIED_PAIRS,
  FLY_PROTOCOLS,
  FLY_SCRIPT_OPERATOR,
  type FlyCodeState,
  type FlyDesign,
  type FlyPlan,
  type FlyPreregistration,
  type FlyRecord,
  type FlyRun,
} from "./contracts.js";
import { flyExample } from "./flyExample.js";
import {
  authorizeFly,
  compileFlyExperiment,
  currentFlyEngine,
  deriveFlySeeds,
  executeFly,
  flyMeasurements,
  flyPlanBody,
  flyPreregistrationSha256,
  flyReceiptErrors,
  FlyRunRefused,
  isDevelopmentCode,
  signTestTail,
  verifyFlyAuthorization,
  verifyFlyPlan,
  verifyFlyRecord,
  type FlyAuthorizationInput,
} from "./fly.js";
import {
  admitFlyRecord,
  FlyAuthorizationLedger,
  preregisterFly,
  registryFlyHost,
} from "./flyRegistry.js";
import { checkFlyFolder, flyArchiveReadme, flyFolderFiles } from "./flyArchive.js";
import {
  computeFlySource,
  flySourceAtCommitErrors,
  workingTreeReader,
} from "./flySourceDigest.js";
import { FLY_SOURCE } from "./flySource.js";
import { flyBackend } from "./backends.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })),
);
const scratch = (into = directories) => {
  const dir = mkdtempSync(join(tmpdir(), "rain-fly-"));
  into.push(dir);
  return dir;
};

const CLEAN: FlyCodeState = { commit: "a".repeat(40), dirty: false };
/** A lab in a scratch directory: a registry, an authorization ledger and a source tree. */
function lab(
  options: {
    code?: FlyCodeState;
    seen?: (fly: string, seed: number) => boolean;
    now?: () => Date;
    into?: string[];
  } = {},
) {
  const dir = scratch(options.into);
  const registry = new Registry(join(dir, "registry"), options.now);
  const ledger = new FlyAuthorizationLedger(join(dir, "authorizations"));
  const host = registryFlyHost({
    registry,
    ledger,
    code: () => options.code ?? CLEAN,
    seen: options.seen,
  });
  return { dir, registry, ledger, host };
}

// The cheapest protocol: single stimulus trials on a fly standing still.
const threat = (overrides: Parameters<typeof flyExample>[1] = {}) =>
  flyExample("visual_threat", { seedCount: 8, ...overrides });
const asHuman = (d: FlyDesign): FlyDesign => ({
  ...d,
  provenance: { ...d.provenance, generation: "human" },
});
const plan = (design: FlyDesign = threat()) => {
  const p = compileFlyExperiment(design);
  if (!p.ok) throw new Error(p.errors.join("; "));
  return p.value;
};
const scripted = (p: FlyPlan): FlyAuthorizationInput => ({
  channel: "script",
  operator: FLY_SCRIPT_OPERATOR,
  typedPrefix: p.definition_sha256.slice(0, 8),
  reviewed: true,
});
const terminal = (
  p: FlyPlan,
  extra: Partial<FlyAuthorizationInput> = {},
): FlyAuthorizationInput => ({
  channel: "terminal",
  operator: "R.A.I.N.TestOperator",
  typedPrefix: p.definition_sha256.slice(0, 8),
  reviewed: true,
  ...extra,
});
const reseal = <T extends { sha256: string }>(r: T): T => {
  const { sha256: _prior, ...body } = r;
  return { ...body, sha256: sha256Json(body) } as T;
};
const refused = (raw: unknown) => {
  const c = compileFlyExperiment(raw);
  expect(c.ok).toBe(false);
  return c.ok ? "" : c.errors.join("\n");
};
const errorsOf = (c: { ok: boolean; errors?: string[] }) =>
  c.ok ? "" : (c.errors ?? []).join("\n");

/**
 * Rebuilds a record's whole chain around an edited plan, the way another build
 * of the code would have sealed it: plan digest, receipt, authorization,
 * seeds, run identity and seal all agree.
 */
function rebuild(record: FlyRecord, edit: (plan: Record<string, unknown>) => void) {
  const body = structuredClone(flyPlanBody(record.plan)) as Record<string, unknown>;
  edit(body);
  const digest = sha256Json(body);
  const plan = {
    ...body,
    definition_sha256: digest,
    experiment_id: `FLY-${digest.slice(0, 24)}`,
  } as FlyPlan;
  const preregistration = { ...record.preregistration, plan_sha256: digest };
  const { authorization_sha256: _a, ...auth } = {
    ...record.authorization,
    definition_sha256: digest,
    experiment_id: plan.experiment_id,
    confirmed_prefix: digest.slice(0, 8),
    preregistration_sha256: flyPreregistrationSha256(preregistration),
  };
  const authorization = { ...auth, authorization_sha256: sha256Json(auth) };
  const seeds = deriveFlySeeds(
    authorization.preregistration_sha256,
    authorization.nonce,
    plan.experiment.seed_count,
  );
  const run_id = `FR-${sha256Json({
    plan: digest,
    authorization: authorization.authorization_sha256,
    started_at: record.started_at,
  }).slice(0, 24)}`;
  return reseal({ ...record, plan, preregistration, authorization, seeds, run_id });
}

describe("the digital-fly backend's design vocabulary", () => {
  it("is registered append-only at its v2 contract, with no devices and no neural claim", () => {
    expect(BACKEND_CAPABILITIES[3]).toMatchObject({
      id: "digital-fly",
      authority_scope: "fly-behavior-simulation",
      physical_devices: false,
    });
    expect(BACKEND_CAPABILITIES[3]!.version).toBe(FLY_BACKEND);
    expect(BACKEND_CAPABILITIES[3]!.unsupported.join(" ")).toMatch(/neural simulation/);
    expect(flyBackend(lab().host).capability).toBe(BACKEND_CAPABILITIES[3]);
  });

  it("compiles every scripted protocol into a host-written plan bound to its source", () => {
    for (const protocol of FLY_PROTOCOLS) {
      const design = flyExample(protocol.id);
      const metric = FLY_METRICS.find((m) => m.id === design.analysis.metric)!;
      // The demonstration thresholds sit at or above the host's minimum effects.
      expect(design.analysis.minimum_effect).toBeGreaterThanOrEqual(
        metric.minimum_effect!,
      );
      const p = plan(design);
      expect(p.experiment_id).toMatch(/^FLY-[a-f0-9]{24}$/);
      expect(p.ir).toMatchObject({
        domain: "fly-behavior-simulation",
        backend: "digital-fly",
      });
      expect(p.ir.question).toMatch(/^In the digital fly simulator/);
      expect(p.ir.limitations.join(" ")).toMatch(/simulates no neurons/);
      expect(p.ir.limitations.join(" ")).toMatch(
        /never empirical evidence about Drosophila/,
      );
      if (protocol.caveat) expect(p.ir.limitations).toContain(protocol.caveat);
      // How many seeds, never which: the host draws them after preregistration.
      expect(p.experiment.seed_count).toBe(12);
      expect(Object.keys(p.experiment)).not.toContain("seeds");
      expect(p.fly_source_sha256).toBe(FLY_SOURCE.sha256);
      expect(p.experiment.blocks.map((b) => b.id)).toEqual([...protocol.blocks]);
      expect(p.experiment.arms.map((a) => a.id)).toEqual(["control", "treatment"]);
      const all = [...p.criteria.guards, ...p.criteria.success, ...p.criteria.failure];
      expect(all.map((c) => c.id)).toEqual([
        "G1",
        "G2",
        "G3",
        "G4",
        "G5",
        "S1",
        "S2",
        "F1",
      ]);
      expect(all.find((c) => c.id === "G4")!.value).toBe(FLY_MIN_UNTIED_PAIRS);
      expect(all.find((c) => c.id === "S2")!.value).toBe(FLY_ALPHA);
      expect(all.find((c) => c.id === "F1")).toMatchObject({
        metric: "sign_test_p_opposite",
        value: FLY_ALPHA,
      });
      expect(plan(flyExample(protocol.id)).definition_sha256).toBe(p.definition_sha256);
      expect(verifyFlyPlan(p)).toEqual([]);
    }
  });

  it("says plainly which protocols cannot discriminate as designed", () => {
    const caveat = (id: string) => FLY_PROTOCOLS.find((p) => p.id === id)!.caveat ?? "";
    expect(caveat("obstacle_avoidance")).toMatch(/cannot discriminate/);
    expect(caveat("noisy_sensing")).toMatch(/cannot discriminate/);
    expect(caveat("adaptation")).toMatch(/depends on the fly's response/);
    expect(caveat("visual_threat")).toMatch(/implementation check .* expansion gate/);
    expect(caveat("visual_threat")).toMatch(/G3/);
  });

  it("refuses anything outside the closed schema, chosen seeds included", () => {
    const base = threat();
    for (const raw of [
      { ...base, code: "process.exit()" },
      { ...base, parameters: { ...base.parameters, adapter: "rogue" } },
      // The design names how many seeds, never which.
      { ...base, parameters: { ...base.parameters, seeds: [1, 2, 3, 4, 5, 6, 7, 8] } },
      {
        ...base,
        parameters: {
          seeds: [1, 2, 3, 4, 5, 6, 7, 8],
          treatment: base.parameters.treatment,
        },
      },
      { ...base, parameters: { ...base.parameters, seed_count: 3 } },
      { ...base, parameters: { ...base.parameters, seed_count: 17 } },
      { ...base, parameters: { ...base.parameters, seed_count: 8.5 } },
      {
        ...base,
        parameters: { ...base.parameters, treatment: { kind: "swarm", flies: 100 } },
      },
      {
        ...base,
        parameters: {
          ...base.parameters,
          treatment: {
            kind: "visual_threat",
            approach_speed_m_s: 99,
            control: "receding",
          },
        },
      },
      // The decision rule is the host's: no other method, no seed-count rule.
      { ...base, analysis: { ...base.analysis, method: "matched_seed_paired_delta" } },
      { ...base, analysis: { ...base.analysis, minimum_consistent_seeds: 2 } },
      // A metric that exists only when the fly escaped cannot be the tested one.
      { ...base, analysis: { ...base.analysis, metric: "escape_latency_s" } },
      { ...base, provenance: { ...base.provenance, generation: "oracle" } },
    ])
      refused(raw);
    // The host owns the minimum effects; a design may raise one, never lower it.
    expect(refused(threat({ minimumEffect: 0.05 }))).toMatch(
      /below the host's minimum effect for escape_probability \(0\.1 fraction\)/,
    );
    expect(compileFlyExperiment(threat({ minimumEffect: 0.1 })).ok).toBe(true);
    expect(
      refused(flyExample("obstacle_avoidance", { metric: "escape_probability" })),
    ).toMatch(/not measured by the obstacle_avoidance protocol/);
    expect(refused(threat({ maxSimulatedSeconds: 10 }))).toMatch(/exceeds the budget/);
    expect(
      refused({
        ...base,
        provenance: { ...base.provenance, generation: "model", decision_sha256: null },
      }),
    ).toMatch(/decision receipt/);
    expect(
      refused({
        ...base,
        provenance: { ...base.provenance, decision_sha256: "0".repeat(64) },
      }),
    ).toMatch(/only a model proposal carries a decision receipt digest/);
  });

  it("lets a controller configuration change model parameters only, within their ranges", () => {
    const compare = (
      baseline: Record<string, number>,
      treatment: Record<string, number>,
    ) =>
      flyExample("controller_comparison", {
        treatment: { kind: "controller_comparison", baseline, treatment },
      });
    expect(refused(compare({}, { saccadeMs: 40 }))).toMatch(
      /configuration B: saccadeMs is a published value and cannot be overridden/,
    );
    expect(refused(compare({ wingbeatHz: 250 }, {}))).toMatch(
      /configuration A: wingbeatHz is a flybody value and cannot be overridden/,
    );
    expect(refused(compare({}, { physicsStepMs: 1 }))).toMatch(/integration setting/);
    expect(refused(compare({}, { takeoffHz: 1 }))).toMatch(
      /fixed by the protocol's apparatus/,
    );
    expect(refused(compare({}, { avoidTtcS: 0.45 }))).toMatch(/same parameter values/);
    // An unknown name never reaches the compiler: the schema names every parameter.
    expect(refused(compare({}, { gfThresholdd: 2 }))).toMatch(
      /parameters\/treatment: .* is not valid under any of the given schemas/,
    );
    expect(compileFlyExperiment(compare({}, { gfThreshold: 1.4 })).ok).toBe(true);
    // A value outside its range is a design error, never a run that breaks: the
    // compiler refuses exactly what the fly's own parameter check refuses.
    expect(refused(compare({}, { gfThreshold: 50 }))).toMatch(
      /configuration B: gfThreshold must be within \[0\.05, 20\]/,
    );
    const candidates: Record<string, number>[] = [
      { gfThreshold: 50 },
      { gfThreshold: 0.01 },
      { gfThreshold: 19 },
      { phototaxisGain: 7 },
      { phototaxisGain: 5 },
      { avoidTtcS: 3 },
      { avoidTtcS: 1.5 },
      { cruiseAltMinM: 0.9, cruiseAltMaxM: 0.2 },
    ];
    for (const config of candidates) {
      let valid = true;
      try {
        resolveParams(config);
      } catch {
        valid = false;
      }
      expect(compileFlyExperiment(compare({}, config)).ok, JSON.stringify(config)).toBe(
        valid,
      );
    }
  });

  it("holds a model's design to its receipt", () => {
    const answer = { ...threat(), provenance: undefined, schema: undefined };
    const text = JSON.stringify({
      schema: "rain-fly-design-receipt/v1",
      generation: "model",
      answer: JSON.stringify(answer),
    });
    const design: FlyDesign = {
      ...threat(),
      provenance: {
        generation: "model",
        decision_sha256: sha256(text),
        source_ids: [],
        parent_record_sha256: null,
      },
    };
    expect(flyReceiptErrors(design, text)).toEqual([]);
    expect(flyReceiptErrors(design, null)).toEqual(["a model design needs its receipt"]);
    const edited = { ...design, analysis: { ...design.analysis, minimum_effect: 0.5 } };
    expect(flyReceiptErrors(edited, text).join(" ")).toMatch(
      /not the design the receipt/,
    );
    expect(flyReceiptErrors(threat(), text)).toEqual([
      "a receipt accompanies a non-model design",
    ]);
  });

  it("refuses a plan whose apparatus, criteria or source were edited after compilation", () => {
    const p = plan();
    const moved = structuredClone(p);
    moved.experiment.blocks[0]!.stimulus!.radius_m = 0.2;
    expect(verifyFlyPlan(moved).join(" ")).toMatch(
      /does not match deterministic recompilation/,
    );
    const easier = structuredClone(p);
    easier.criteria.success[0]!.value = 0;
    expect(verifyFlyPlan(easier).join(" ")).toMatch(/does not match/);
    const elsewhere = structuredClone(p);
    elsewhere.fly_source_sha256 = "0".repeat(64);
    expect(verifyFlyPlan(elsewhere).join(" ")).toMatch(/does not match/);
  });
});

describe("the exact sign test and the frozen criteria", () => {
  it("computes exact one-sided binomial tails", () => {
    expect(signTestTail(8, 8)).toBe(1 / 256);
    expect(signTestTail(7, 8)).toBe(9 / 256);
    expect(signTestTail(6, 6)).toBe(1 / 64);
    expect(signTestTail(5, 6)).toBe(7 / 64);
    expect(signTestTail(0, 8)).toBe(1);
    expect(signTestTail(0, 0)).toBe(1);
    expect(signTestTail(1, 0)).toBe(0);
    // P(X >= k) + P(X >= m - k + 1) = 1 by the symmetry of Binomial(m, 1/2).
    for (let m = 1; m <= 16; m++)
      for (let k = 0; k <= m + 1; k++)
        expect(signTestTail(k, m) + signTestTail(m - k + 1, m)).toBeCloseTo(1, 12);
    // At the host's minimum of untied seeds only a unanimous result reaches
    // alpha, and one seed the other way does not.
    const m = FLY_MIN_UNTIED_PAIRS;
    expect(signTestTail(m, m)).toBeLessThanOrEqual(FLY_ALPHA);
    expect(signTestTail(m - 1, m)).toBeGreaterThan(FLY_ALPHA);
  });

  it("decides on matched seeds, and its guards hold back what cannot be compared", () => {
    const p = plan(); // escape_probability, increase, minimum effect 0.3
    const seeds = [11, 12, 13, 14, 15, 16, 17, 18];
    const runs = (
      control: (number | null)[],
      treatment: (number | null)[],
      refusals = 0,
    ): FlyRun[] =>
      seeds.flatMap((seed, i) =>
        (["control", "treatment"] as const).map((arm) => ({
          arm,
          seed,
          block: "escape" as const,
          final_hashes: [],
          simulated_s: 1,
          gate_refusals: arm === "treatment" ? refusals : 0,
          metrics: { escape_probability: (arm === "control" ? control : treatment)[i]! },
        })),
      );
    const decide = (c: (number | null)[], t: (number | null)[], refusals = 0) => {
      const m = flyMeasurements(p, seeds, runs(c, t, refusals), true);
      const e = evaluate(p.criteria, m);
      const unmet = e.evaluation.guards.filter((g) => g.holds !== true).map((g) => g.id);
      return { m, status: e.status, verdict: e.verdict, unmet };
    };
    const half = seeds.map(() => 0.5);
    const all = (v: number | null) => seeds.map(() => v);

    const supported = decide(half, all(1));
    expect(supported).toMatchObject({
      status: "passed",
      verdict: "supported",
      unmet: [],
    });
    expect(supported.m).toMatchObject({
      untied_pairs: 8,
      seeds_expected_direction: 8,
      sign_test_p_expected: 1 / 256,
      sign_test_p_opposite: 1,
      mean_paired_delta: 0.5,
      control_informative: 1,
      gate_refusals: 0,
    });
    expect(decide(half, all(0))).toMatchObject({
      status: "failed",
      verdict: "not_supported",
    });
    // Consistent but smaller than the minimum effect: no conclusion either way.
    expect(decide(half, all(0.6))).toMatchObject({ status: "inconclusive", unmet: [] });
    // G3: a control at the floor in every seed can only move up.
    expect(decide(all(0), all(1))).toMatchObject({
      status: "inconclusive",
      unmet: ["G3"],
    });
    expect(decide(all(1), all(0))).toMatchObject({
      status: "inconclusive",
      unmet: ["G3"],
    });
    // G4: five untied seeds are too few for the test at all.
    expect(decide(half, [1, 1, 1, 1, 1, 0.5, 0.5, 0.5])).toMatchObject({
      status: "inconclusive",
      unmet: ["G4"],
    });
    expect(decide(half, half).m).toMatchObject({ untied_pairs: 0, seeds_unchanged: 8 });
    // G5: one refused command anywhere voids the result.
    expect(decide(half, all(1), 1)).toMatchObject({
      status: "inconclusive",
      unmet: ["G5"],
    });
    // A seed whose metric is undefined in an arm drops out; the others still count.
    const gap = decide(half, [1, 1, 1, 1, 1, 1, 1, null]);
    expect(gap).toMatchObject({ status: "passed", verdict: "supported" });
    expect(gap.m).toMatchObject({
      seeds_undefined: 1,
      untied_pairs: 7,
      sign_test_p_expected: 1 / 128,
    });
    // Nothing ran: nothing was checked or counted, so nothing is concluded.
    const none = flyMeasurements(p, seeds, null, false);
    expect(none).toMatchObject({ determinism_check: null, gate_refusals: null });
    expect(evaluate(p.criteria, none).status).toBe("inconclusive");
  });
});

describe("seeds, authorization and the code a record names", () => {
  it("draws seeds from the receipt and a nonce, never from the design", () => {
    const receipt = "1".repeat(64),
      nonce = "2".repeat(64);
    const seeds = deriveFlySeeds(receipt, nonce, 16);
    expect(seeds).toHaveLength(16);
    expect(new Set(seeds).size).toBe(16);
    expect(seeds.every((s) => Number.isInteger(s) && s >= 0 && s < 2 ** 32)).toBe(true);
    expect(deriveFlySeeds(receipt, nonce, 16)).toEqual(seeds);
    expect(deriveFlySeeds(receipt, nonce, 8)).toEqual(seeds.slice(0, 8));
    expect(deriveFlySeeds(receipt, "3".repeat(64), 16)).not.toEqual(seeds);
    expect(deriveFlySeeds("4".repeat(64), nonce, 16)).not.toEqual(seeds);
    expect(seeds[0]).toBe(Number.parseInt(sha256(`${receipt}${nonce}0`).slice(0, 8), 16));
  });

  it("preregisters a plan once and authorizes it once, after its receipt, by the right channel", () => {
    const { registry, host } = lab();
    const p = plan();
    const receipt = preregisterFly(registry, p);
    expect(receipt.created_at).toBe(
      registry.loadDefinition(receipt.experiment_id).created_at,
    );
    expect(() => preregisterFly(registry, p)).toThrow(/already preregistered/);

    const wrong = authorizeFly(
      p,
      receipt,
      {
        channel: "terminal",
        operator: "someone@example.com",
        typedPrefix: "00000000",
        reviewed: false,
      },
      host,
    );
    expect(wrong.ok).toBe(false);
    expect(errorsOf(wrong)).toMatch(/operator must confirm protocol review/);
    expect(errorsOf(wrong)).toMatch(/operator must be a role label/);
    expect(errorsOf(wrong)).toMatch(/repeat the first eight characters/);
    // The host's own designs run only through the demonstration script, which
    // runs nothing else and never in a person's name.
    expect(errorsOf(authorizeFly(p, receipt, terminal(p), host))).toMatch(
      /runs only through the demonstration script/,
    );
    expect(
      errorsOf(
        authorizeFly(p, receipt, { ...scripted(p), operator: "R.A.I.N.Someone" }, host),
      ),
    ).toMatch(/authorizes as Scripted.DemoOperator only/);

    const a = authorizeFly(p, receipt, scripted(p), host);
    if (!a.ok) throw new Error(a.errors.join("; "));
    expect(a.value).toMatchObject({
      registry_experiment_id: receipt.experiment_id,
      preregistration_sha256: flyPreregistrationSha256(receipt),
      registered_at: receipt.created_at,
      channel: "script",
      attestation: "demonstration-script",
      identity_verified: false,
      human_design_attested: false,
    });
    expect(a.value.nonce).toMatch(/^[a-f0-9]{64}$/);
    expect(Date.parse(a.value.authorized_at)).toBeGreaterThanOrEqual(
      Date.parse(receipt.created_at),
    );
    expect(verifyFlyAuthorization(a.value, p, receipt, new Date())).toEqual([]);
    // Once: a second authorization would draw the seeds again.
    expect(errorsOf(authorizeFly(p, receipt, scripted(p), host))).toMatch(
      /already authorized/,
    );
    const later = new Date(Date.parse(a.value.authorized_at) + 2 * 3600000);
    expect(verifyFlyAuthorization(a.value, p, receipt, later).join(" ")).toMatch(
      /one-hour validity/,
    );
    const forged = { ...a.value, operator: "R.A.I.N.Someone" };
    expect(verifyFlyAuthorization(forged, p, receipt, new Date()).join(" ")).toMatch(
      /authorization digest mismatch/,
    );
    const other = { ...receipt, created_at: new Date(0).toISOString() };
    expect(verifyFlyAuthorization(a.value, p, other, new Date()).join(" ")).toMatch(
      /binds a different preregistration/,
    );
  });

  it("needs an operator's attestation for a design declared human", () => {
    const { registry, host } = lab();
    const p = plan(asHuman(threat()));
    const receipt = preregisterFly(registry, p);
    expect(errorsOf(authorizeFly(p, receipt, terminal(p), host))).toMatch(
      /attestation that a person wrote it/,
    );
    expect(errorsOf(authorizeFly(p, receipt, scripted(p), host))).toMatch(
      /only the host's scripted designs/,
    );
    const a = authorizeFly(p, receipt, terminal(p, { humanDesignAttested: true }), host);
    expect(a.ok).toBe(true);
    if (a.ok)
      expect(a.value).toMatchObject({
        channel: "terminal",
        attestation: "local-operator",
        human_design_attested: true,
      });
  });

  it("refuses a plan that is not preregistered, or an authorization before its receipt", () => {
    const { host } = lab();
    const p = plan();
    const invented: FlyPreregistration = {
      experiment_id: "V3D-EXP-0042",
      registry_definition_sha256: "0".repeat(64),
      plan_sha256: p.definition_sha256,
      created_at: new Date(Date.now() - 60000).toISOString(),
    };
    expect(errorsOf(authorizeFly(p, invented, scripted(p), host))).toMatch(
      /not preregistered here/,
    );
    // A registry whose clock reads an hour ahead: its receipt lies in the future.
    const ahead = lab({ now: () => new Date(Date.now() + 3600000) });
    const receipt = preregisterFly(ahead.registry, p);
    expect(errorsOf(authorizeFly(p, receipt, scripted(p), ahead.host))).toMatch(
      /cannot precede the plan's preregistration/,
    );
  });

  it("draws around seeds this fly has already run", () => {
    const p = plan();
    const never = lab({ seen: () => true });
    const r1 = preregisterFly(never.registry, p);
    expect(errorsOf(authorizeFly(p, r1, scripted(p), never.host))).toMatch(
      /could not draw seeds this fly has not already run/,
    );
    const some = lab({ seen: (_fly, seed) => seed % 7 === 0 });
    const r2 = preregisterFly(some.registry, p);
    const a = authorizeFly(p, r2, scripted(p), some.host);
    if (!a.ok) throw new Error(a.errors.join("; "));
    const seeds = deriveFlySeeds(a.value.preregistration_sha256, a.value.nonce, 8);
    expect(seeds.some((s) => s % 7 === 0)).toBe(false);
  });

  it("knows development code from committed code", () => {
    expect(isDevelopmentCode(CLEAN)).toBe(false);
    expect(isDevelopmentCode({ ...CLEAN, dirty: true })).toBe(true);
    expect(isDevelopmentCode({ ...CLEAN, dirty: null })).toBe(true);
    expect(isDevelopmentCode({ commit: null, dirty: false })).toBe(true);
    expect(isDevelopmentCode({ commit: "abcdef1", dirty: false })).toBe(true);
    expect(flySourceAtCommitErrors(ROOT, null, FLY_SOURCE.sha256)).toEqual([
      "no full producing commit is recorded",
    ]);
  });

  it("binds the current source digest (regenerate with scripts/fly-source.ts)", () => {
    const here = computeFlySource(workingTreeReader(ROOT));
    expect(
      here.sha256,
      "src/rain/scientific/flySource.ts is stale: run node scripts/run-ts.mjs scripts/fly-source.ts",
    ).toBe(FLY_SOURCE.sha256);
    expect(Object.keys(FLY_SOURCE.files)).toEqual(
      expect.arrayContaining([
        "src/bethesda/fly/fly.ts",
        "src/bethesda/fly/arena.ts",
        "src/bethesda/fly/params.ts",
        "src/rain/scientific/fly.ts",
        "src/bethesda/rain/scientificProtocol.ts#digital-fly",
      ]),
    );
    // Line endings do not change the code, so they do not change the digest.
    const crlf = computeFlySource((path) => {
      const text = workingTreeReader(ROOT)(path);
      return text === null ? null : text.replace(/\r?\n/g, "\r\n");
    });
    expect(crlf.sha256).toBe(here.sha256);
  });
});

// One executed experiment serves the tests below: each simulation of the
// protocol runs twice (the determinism guard) and once more per verification.
const shared: string[] = [];
afterAll(() =>
  shared.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })),
);
let executed: ReturnType<typeof execute> | null = null;
function execute() {
  const l = lab({ into: shared });
  const p = plan();
  const receipt = preregisterFly(l.registry, p);
  const a = authorizeFly(p, receipt, scripted(p), l.host);
  if (!a.ok) throw new Error(a.errors.join("; "));
  return {
    ...l,
    plan: p,
    receipt,
    authorization: a.value,
    record: executeFly(p, receipt, a.value, l.host),
  };
}
const run = () => (executed ??= execute());
let admitted: ReturnType<typeof admitFlyRecord> | null = null;
const admit = () =>
  (admitted ??= admitFlyRecord(run().registry, run().record, {
    root: ROOT,
    codeAtCommit: () => [],
  }));

describe("running, verifying and admitting a fly experiment", { timeout: 300000 }, () => {
  it("runs once on the real clock and seals what fixed it: receipt, seeds, engine and code", () => {
    const { record, receipt, authorization, plan: p, host } = run();
    expect(record.schema).toBe("rain-fly-record/v2");
    expect(record.preregistration).toEqual(receipt);
    expect(record.authorization).toEqual(authorization);
    expect(record.seeds).toEqual(
      deriveFlySeeds(flyPreregistrationSha256(receipt), authorization.nonce, 8),
    );
    expect(record.engine).toEqual(currentFlyEngine());
    expect(record.code).toEqual(CLEAN);
    expect(record.development).toBe(false);
    expect(Date.parse(record.started_at)).toBeGreaterThanOrEqual(
      Date.parse(receipt.created_at),
    );
    const { sha256: sealed, ...body } = record;
    expect(sealed).toBe(sha256Json(body));
    const m = record.result.measurements;
    expect(record.result.completed).toBe(true);
    expect(m.runs_completed).toBe(16);
    expect(m.determinism_check).toBe(1);
    expect(typeof m.gate_refusals).toBe("number");
    expect(record.result.runs.every((r) => r.final_hashes.length === 6)).toBe(true);
    // The escape proxy is gated on expansion, so the receding control never
    // escapes; G3 holds a control pinned at zero inconclusive, by design.
    expect(m.control_escape_probability).toBe(0);
    expect(m.control_informative).toBe(0);
    expect(record.result.status).toBe("inconclusive");
    expect(record.result.evaluation!.guards.find((g) => g.id === "G3")!.holds).toBe(
      false,
    );
    // An authorization runs once.
    expect(() => executeFly(p, receipt, authorization, host)).toThrow(/already used/);
  });

  it("refuses to run without the exact registered plan and an issued authorization", () => {
    const { registry, host } = lab();
    const p = plan();
    expect(() =>
      executeFly(p, { experiment_id: "V3D-EXP-0001" } as FlyPreregistration, null, host),
    ).toThrow(FlyRunRefused);
    const receipt = preregisterFly(registry, p);
    expect(() => executeFly(p, receipt, null, host)).toThrow(FlyRunRefused);
    // Authorized against another registry's receipt (its clock a second behind).
    const elsewhere = lab({ now: () => new Date(Date.now() - 1000) });
    const r2 = preregisterFly(elsewhere.registry, p);
    const foreign = authorizeFly(p, r2, scripted(p), elsewhere.host);
    if (!foreign.ok) throw new Error(foreign.errors.join("; "));
    expect(() => executeFly(p, receipt, foreign.value, host)).toThrow(
      /binds a different preregistration/,
    );
    // Seeds this fly has run since the authorization are refused, before the
    // authorization is spent.
    const a = authorizeFly(p, receipt, scripted(p), host);
    if (!a.ok) throw new Error(a.errors.join("; "));
    const first = deriveFlySeeds(a.value.preregistration_sha256, a.value.nonce, 8)[0]!;
    const seenHost = { ...host, seen: (_fly: string, seed: number) => seed === first };
    expect(() => executeFly(p, receipt, a.value, seenHost)).toThrow(
      new RegExp(`already run seeds ${first}`),
    );
    // A host whose ledger never issued the authorization refuses to spend it.
    const neverIssued = lab();
    expect(() =>
      executeFly(p, receipt, a.value, {
        ...neverIssued.host,
        preregistrationErrors: () => [],
      }),
    ).toThrow(/never issued by this host/);
  });

  it("re-simulates a record exactly and tells tampering from another engine or code", () => {
    const { record } = run();
    const verified = verifyFlyRecord(record);
    expect(verified).toMatchObject({ ok: true, status: "ok", errors: [], note: null });
    expect(verified.replay_sha256).toMatch(/^[a-f0-9]{64}$/);

    const unsealed = structuredClone(record);
    // Values no run can produce (escape fractions are sixths), so the edit is never a no-op.
    unsealed.result.measurements.mean_paired_delta = -7;
    expect(verifyFlyRecord(unsealed).errors).toContain("fly record digest mismatch");

    const tampered = structuredClone(record);
    tampered.result.runs[0]!.metrics.escape_probability = 0.55;
    const caught = verifyFlyRecord(reseal(tampered));
    expect(caught).toMatchObject({ ok: false, status: "failed" });
    expect(caught.errors.join(" ")).toMatch(/differ on re-simulation/);

    const reseeded = structuredClone(record);
    reseeded.seeds = reseeded.seeds.map((s) => s + 1);
    expect(verifyFlyRecord(reseal(reseeded)).errors.join(" ")).toMatch(
      /seeds are not the ones the receipt and nonce fix/,
    );
    const flagged = structuredClone(record);
    flagged.development = true;
    expect(verifyFlyRecord(reseal(flagged)).errors.join(" ")).toMatch(/development flag/);
    expect(
      verifyFlyRecord(reseal({ ...record, evidence_class: "measured" as "simulated" }))
        .ok,
    ).toBe(false);
    const early = structuredClone(record);
    early.started_at = new Date(
      Date.parse(record.preregistration.created_at) - 60000,
    ).toISOString();
    expect(verifyFlyRecord(reseal(early)).ok).toBe(false);

    // Another engine: not checked, and not failed.
    const bun = reseal({
      ...structuredClone(record),
      engine: { runtime: "bun", version: "1.2.0", js: "JavaScriptCore" },
    });
    expect(verifyFlyRecord(bun)).toMatchObject({
      ok: false,
      status: "not_resimulable",
      errors: [],
    });
    // Another version of the same engine: re-simulated, and a difference there
    // is reported as not re-simulable rather than as tampering.
    const engine = { ...record.engine, version: "0.0.1" };
    const older = reseal({ ...structuredClone(record), engine });
    const replay = verifyFlyRecord(older);
    expect(replay).toMatchObject({ ok: true, status: "ok" });
    expect(replay.note).toMatch(/re-simulated exactly/);
    expect(verifyFlyRecord(reseal({ ...tampered, engine }))).toMatchObject({
      ok: false,
      status: "not_resimulable",
    });

    // Sealed by other code: sound, but this code cannot re-simulate it.
    expect(rebuild(record, () => {}).sha256).toBe(record.sha256);
    const foreign = rebuild(record, (plan) => {
      plan.fly_sha256 = "f".repeat(64);
    });
    expect(verifyFlyRecord(foreign)).toMatchObject({
      ok: false,
      status: "other_code",
      errors: [],
    });
    expect(verifyFlyRecord(foreign).note).toMatch(/^made by /);
  });

  it("is admitted only from committed code that holds it, through the registry's own evaluation", () => {
    const { registry, record } = run();
    const development = reseal({
      ...structuredClone(record),
      code: { commit: null, dirty: null },
      development: true,
    });
    expect(() =>
      admitFlyRecord(registry, development, { root: ROOT, codeAtCommit: () => [] }),
    ).toThrow(/development record/);
    expect(() =>
      admitFlyRecord(registry, record, {
        root: ROOT,
        codeAtCommit: () => ["commit aaaaaaaaaaaa holds different fly code"],
      }),
    ).toThrow(/holds different fly code/);
    const early = structuredClone(record);
    early.started_at = new Date(
      Date.parse(record.preregistration.created_at) - 60000,
    ).toISOString();
    expect(() =>
      admitFlyRecord(registry, reseal(early), { root: ROOT, codeAtCommit: () => [] }),
    ).toThrow(/admission refused/);
    // Nothing above reached the registry.
    expect(registry.runs(record.preregistration.experiment_id)).toHaveLength(0);
    const { registry_run } = admit();
    expect(registry_run.status).toBe(record.result.status);
    expect(registry_run.hypothesis_verdict).toBe(record.result.verdict);
    expect(registry.runs(record.preregistration.experiment_id)).toHaveLength(1);
    expect(() =>
      admitFlyRecord(registry, record, { root: ROOT, codeAtCommit: () => [] }),
    ).toThrow(/already recorded/);
  });

  it("derives every file of a record's folder from record.json and catches any edit", () => {
    const { record } = run();
    const admission = { registry_run: admit().registry_run, error: null };
    const archive = scratch();
    const dir = join(archive, record.plan.experiment_id);
    const write = (files: Record<string, string>) => {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir);
      for (const [name, text] of Object.entries(files))
        writeFileSync(join(dir, name), text);
    };
    const files = flyFolderFiles(record, admission);
    expect(Object.keys(files).sort()).toEqual([
      "design.json",
      "plan.json",
      "preregistration.json",
      "record.json",
      "registry-run.json",
      "report.md",
      "summary.json",
    ]);
    expect(files["report.md"]).toMatch(/Authorized by the demonstration script/);
    expect(files["report.md"]).toMatch(/Exact one-sided sign test: p = /);
    expect(files["report.md"]).toContain(
      FLY_PROTOCOLS.find((p) => p.id === "visual_threat")!.caveat,
    );
    write(files);
    expect(checkFlyFolder(dir)).toMatchObject({ kind: "record", errors: [] });
    const renamed = join(archive, "FLY-000000000000000000000000");
    cpSync(dir, renamed, { recursive: true });
    expect(checkFlyFolder(renamed).errors).toContain(
      "the folder is not named by its plan's experiment id",
    );
    const edited = (name: string, edit: (text: string) => string) => {
      write({ ...files, [name]: edit(files[name]!) });
      return checkFlyFolder(dir).errors.join("\n");
    };
    expect(edited("report.md", (t) => t.replace("INCONCLUSIVE", "PASSED"))).toMatch(
      /report\.md is not what record\.json implies/,
    );
    expect(edited("summary.json", (t) => t.replace('"inconclusive', '"passed'))).toMatch(
      /summary\.json is not what record\.json implies/,
    );
    expect(
      edited("registry-run.json", (t) =>
        t.replace('"status": "inconclusive"', '"status": "passed"'),
      ),
    ).toMatch(/registry-run\.json/);
    write({ ...files, "notes.md": "hand-written\n" });
    expect(checkFlyFolder(dir).errors).toContain("unexpected file notes.md");
    write({ ...files, "receipt.json": "{}" });
    expect(checkFlyFolder(dir).errors).toContain("unexpected file receipt.json");
    const { "registry-run.json": _run, ...unadmitted } = files;
    write(unadmitted);
    expect(checkFlyFolder(dir).errors.join(" ")).toMatch(/not what record\.json implies/);
  });
});

describe("the archive's records from before the integrity rules", () => {
  const ARCHIVE = join(ROOT, "docs/benchmarks/fly-behavior");
  const legacy = existsSync(ARCHIVE)
    ? readdirSync(ARCHIVE).filter((d) => {
        try {
          return (
            JSON.parse(readFileSync(join(ARCHIVE, d, "record.json"), "utf8")).schema ===
            FLY_LEGACY_RECORD
          );
        } catch {
          return false;
        }
      })
    : [];

  it("are kept, and checked for what can still be checked: seal, summary and files", () => {
    expect(legacy.length).toBeGreaterThan(0);
    for (const d of legacy)
      expect(checkFlyFolder(join(ARCHIVE, d)), d).toMatchObject({
        kind: "legacy",
        errors: [],
      });
    const copy = join(scratch(), legacy[0]!);
    cpSync(join(ARCHIVE, legacy[0]!), copy, { recursive: true });
    const summary = JSON.parse(readFileSync(join(copy, "summary.json"), "utf8"));
    writeFileSync(
      join(copy, "summary.json"),
      JSON.stringify({ ...summary, mean_paired_delta: 99 }, null, 2) + "\n",
    );
    expect(checkFlyFolder(copy).errors).toContain("summary.json is not the record's");
    writeFileSync(join(copy, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    const record = JSON.parse(readFileSync(join(copy, "record.json"), "utf8"));
    record.result.measurements.mean_paired_delta = 99;
    writeFileSync(join(copy, "record.json"), JSON.stringify(record, null, 2) + "\n");
    expect(checkFlyFolder(copy).errors).toContain("record digest mismatch");
  });

  it("are listed as exploratory only, never as evidence", () => {
    const archive = scratch();
    cpSync(join(ARCHIVE, legacy[0]!), join(archive, legacy[0]!), { recursive: true });
    mkdirSync(join(archive, "refused-0000000000000000"));
    writeFileSync(
      join(archive, "refused-0000000000000000", "summary.json"),
      JSON.stringify({ outcome: "refused by the host compiler", errors: ["x"] }),
    );
    const readme = flyArchiveReadme(archive);
    expect(readme).toMatch(
      new RegExp(`\\[${legacy[0]}\\].*\\| legacy: exploratory only \\|`),
    );
    expect(readme).toMatch(/refused before preregistration/);
    expect(readme).toMatch(/exploratory only, not evidence/);
  });
});
