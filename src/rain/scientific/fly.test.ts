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
import { arenaWorld } from "../../bethesda/fly/arena.js";
import { DigitalFly, FLY_VERSION } from "../../bethesda/fly/fly.js";
import type { V3 } from "../../bethesda/fly/units.js";
import type { Mover } from "../../bethesda/fly/world.js";
import {
  BACKEND_CAPABILITIES,
  FLY_ALPHA,
  FLY_BACKEND,
  FLY_LEGACY_RECORD,
  FLY_METRICS,
  FLY_MIN_UNTIED_PAIRS,
  FLY_PILOT,
  FLY_PILOT_SEED_COUNT,
  FLY_PROTOCOLS,
  FLY_SCRIPT_OPERATOR,
  type FlyArm,
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
  flyIdentity,
  flyMeasurements,
  FLY_PILOT_SEEDS,
  flyPlanBody,
  flyPreregistrationSha256,
  flyReceiptErrors,
  FlyRunRefused,
  isDevelopmentCode,
  isFlyPilotSeed,
  runFlyArm,
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
import {
  checkFlyFolder,
  flyArchiveReadme,
  flyFolderFiles,
  flyJsonText,
  FLY_RENDERINGS,
  pinFlyRenderings,
  readFlyRenderings,
  verifyFlyArchive,
} from "./flyArchive.js";
import {
  checkFlyPilot,
  flyPilotDefinition,
  flyPilotFloors,
  flyPilotIntact,
  flyPilotReadme,
  FLY_PILOT_SEEDS_USED,
  FLY_PILOT_SERIES,
  FLY_PILOT_SIZED_METRICS,
  FLY_PILOT_STATUS,
  lowerBound,
  roundDown2,
  roundUp1,
  signTestPower,
  sizeFlyDesign,
  upperBound,
  type FlyPilot,
} from "./flyPilot.js";
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
/** Writes into `archive` the pins `from` holds for the given folders. */
function copyPins(from: string, archive: string, names: string[]) {
  const { folders } = readFlyRenderings(from);
  writeFileSync(
    join(archive, "renderings.json"),
    flyJsonText({
      schema: FLY_RENDERINGS,
      folders: Object.fromEntries(
        names.filter((n) => Object.hasOwn(folders, n)).map((n) => [n, folders[n]!]),
      ),
    }),
  );
}

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
  it("is registered append-only at its v3 contract, with no devices and no neural claim", () => {
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
      expect(p.experiment.seed_count).toBe(design.parameters.seed_count);
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

  it("says plainly what each redesigned protocol can and cannot show", () => {
    const caveat = (id: string) => FLY_PROTOCOLS.find((p) => p.id === id)!.caveat ?? "";
    // In clutter dense enough, and flown long enough, collisions happen.
    expect(caveat("obstacle_avoidance")).toBe("");
    expect(caveat("noisy_sensing")).toMatch(/collision metrics cannot discriminate/);
    expect(caveat("noisy_sensing")).toMatch(/escape timing discriminates/);
    expect(caveat("visual_threat")).toMatch(
      /Escape probability cannot carry the dose-response/,
    );
    expect(caveat("visual_threat")).toMatch(/escape_ttc_s/);
    expect(caveat("adaptation")).toMatch(/habituation that follows responses/);
    expect(caveat("adaptation")).toMatch(/skipped and counted .*never delayed/);
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
      // The dose series is l/v from 10 to 400 ms.
      {
        ...base,
        parameters: {
          ...base.parameters,
          treatment: {
            kind: "visual_threat",
            control_l_over_v_ms: 160,
            treatment_l_over_v_ms: 5,
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
    expect(refused(threat({ minimumEffect: 0.01 }))).toMatch(
      /below the host's minimum effect for escape_ttc_s \(0\.02 s\)/,
    );
    expect(compileFlyExperiment(threat({ minimumEffect: 0.02 })).ok).toBe(true);
    expect(
      refused(
        threat({
          treatment: {
            kind: "visual_threat",
            control_l_over_v_ms: 40,
            treatment_l_over_v_ms: 40,
          },
        }),
      ),
    ).toMatch(/the two arms must approach at different l\/v/);
    // A 90 s schedule of twelve presentations fits the budget at 13 seeds, not 16.
    expect(compileFlyExperiment(flyExample("adaptation", { seedCount: 13 })).ok).toBe(
      true,
    );
    expect(refused(flyExample("adaptation", { seedCount: 16 }))).toMatch(
      /exceeds the budget/,
    );
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
    const p = plan(
      threat({ metric: "escape_probability", direction: "increase", minimumEffect: 0.3 }),
    );
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
      /could not draw seeds that are neither pilot seeds nor already run/,
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
    // A looming dose series: the fly escapes from both approaches, so the
    // timing carries the comparison. A timing has no floor or ceiling to pin a
    // control at, and a continuous one leaves no seed tied.
    expect(m.control_escape_probability).toBeGreaterThan(0.9);
    expect(m.control_informative).toBe(1);
    expect(m.untied_pairs).toBe(8);
    expect(record.result.evaluation!.guards.every((g) => g.holds === true)).toBe(true);
    // At l/v = 40 ms the fly escapes with less time to collision than at 160 ms.
    expect(m.treatment_mean).toBeLessThan(m.control_mean!);
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
    pinFlyRenderings(archive, record.plan.experiment_id, files);
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
    const status = record.result.status;
    const other = status === "passed" ? "failed" : "passed";
    const report = edited("report.md", (t) =>
      t.replace(status.toUpperCase(), other.toUpperCase()),
    );
    expect(report).toMatch(/report\.md is not what record\.json implies/);
    expect(report).toMatch(
      /report\.md is not the file pinned when this folder was written/,
    );
    expect(edited("summary.json", (t) => t.replace(`"${status}`, `"${other}`))).toMatch(
      /summary\.json is not what record\.json implies/,
    );
    expect(
      edited("registry-run.json", (t) =>
        t.replace(`"status": "${status}"`, `"status": "${other}"`),
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

  it("are kept, and checked for what can still be checked: seal, files, and the report and summary against their pins", () => {
    expect(legacy.length).toBeGreaterThan(0);
    for (const d of legacy)
      expect(checkFlyFolder(join(ARCHIVE, d)), d).toMatchObject({
        kind: "legacy",
        errors: [],
      });
    // A report edit the record cannot show is caught by the folder's pin.
    const pinned = scratch();
    cpSync(join(ARCHIVE, legacy[0]!), join(pinned, legacy[0]!), { recursive: true });
    copyPins(ARCHIVE, pinned, [legacy[0]!]);
    expect(checkFlyFolder(join(pinned, legacy[0]!)).errors).toEqual([]);
    const reportPath = join(pinned, legacy[0]!, "report.md");
    writeFileSync(reportPath, readFileSync(reportPath, "utf8") + "\nAdded by hand.\n");
    expect(checkFlyFolder(join(pinned, legacy[0]!)).errors).toEqual([
      "report.md is not the file pinned when this folder was written",
    ]);
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

describe("the expansion gate (an implementation check, not an experiment)", () => {
  const RADIUS = 0.04;
  /** An arena with one sphere whose centre follows `path` (null: not showing). */
  function sphereWorld(path: (t: number) => V3 | null) {
    const inner = arenaWorld({ size: [4, 2.5, 4], ambient: 0.6 }, "expansion-gate");
    return new Proxy(inner, {
      get(target, prop) {
        if (prop === "movers")
          return (near: V3, r: number, out: Mover[], t: number) => {
            target.movers(near, r, out, t);
            const c = path(t);
            if (c)
              out.push({ id: "sphere", kind: "stimulus", center: c, radius: RADIUS });
          };
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  }
  /** Escapes by a standing, noiseless fly while a sphere moves from `from` to `to` m away. */
  function escapes(from: number, to: number, seconds: number, seed: number): number {
    let line: { p: V3; dir: V3 } | null = null;
    const onset = 1;
    const world = sphereWorld((t) => {
      if (!line || t < onset || t > onset + seconds) return null;
      const d = from + ((to - from) * (t - onset)) / seconds;
      return [
        line.p[0] + line.dir[0] * d,
        line.p[1] + line.dir[1] * d,
        line.p[2] + line.dir[2] * d,
      ];
    });
    const fly = new DigitalFly({
      seed,
      world,
      start: { p: [0, 0.5, 0], yaw: 0.3 * seed },
      config: { takeoffHz: 0, walkStartHz: 0, groomHz: 0 },
      noise: 0,
      logSize: 16,
    });
    const before = fly.state.counts.escapes;
    while (fly.state.t < onset + seconds + 0.5) {
      if (!line && fly.state.t >= onset - 0.01) {
        // Ahead of the fly, 20 degrees up: wherever it stands when the sphere appears.
        const a = fly.state.yaw,
          el = (20 * Math.PI) / 180;
        line = {
          p: [...fly.state.p] as V3,
          dir: [Math.cos(el) * Math.cos(a), Math.sin(el), -Math.cos(el) * Math.sin(a)],
        };
      }
      fly.advance(0.005);
    }
    return fly.state.counts.escapes - before;
  }
  const near = RADIUS / Math.sin(Math.PI / 4); // 90 degrees across

  it("never fires for a receding or a held sphere, and does for the same sphere approaching", () => {
    for (const seed of [1, 2, 3]) {
      // l/v = 40 ms: 1 m/s.
      expect(
        escapes(1, near, 1 - near, seed),
        `approaching, seed ${seed}`,
      ).toBeGreaterThan(0);
      expect(escapes(near, 1, 1 - near, seed), `receding, seed ${seed}`).toBe(0);
      // Held at the size the proxy's size term weights most (60 degrees).
      const held = RADIUS / Math.sin(Math.PI / 6);
      expect(escapes(held, held, 2, seed), `held, seed ${seed}`).toBe(0);
    }
  });
});

describe("the redesigned protocols' apparatus", { timeout: 120000 }, () => {
  const seeds = [101, 202];
  it("times the escape by the approach: more time to collision at a slower l/v", () => {
    const e = plan(threat()).experiment; // control 160 ms, treatment 40 ms
    const ttc = (arm: FlyArm) =>
      runFlyArm(e.blocks, arm, seeds).map((r) => r.metrics.escape_ttc_s);
    const slow = ttc(e.arms[0]!),
      fast = ttc(e.arms[1]!);
    slow.forEach((t, i) => {
      expect(t).not.toBeNull();
      expect(t!).toBeGreaterThan(fast[i]!);
    });
  });

  it("presents repeated stimuli on a fixed schedule that never waits for the fly", () => {
    const e = plan(flyExample("adaptation")).experiment;
    const block = e.blocks[0]!,
      stim = block.stimulus!;
    const approach =
      (stim.start_distance_m -
        stim.radius_m / Math.sin((stim.final_size_deg[1] * Math.PI) / 360)) /
      (stim.radius_m / (stim.l_over_v_ms / 1000));
    // Two pilot seeds (a test is not an archived run): at a 5 s interval the
    // pilot found the fly still in the air when some presentations fell due.
    const pilotSeeds = FLY_PILOT_SEEDS.slice(0, 2);
    for (const arm of [e.arms[1]!, { ...e.arms[1]!, isi_s: 5 }]) {
      const runs = runFlyArm(e.blocks, arm, pilotSeeds);
      if (arm.isi_s === 5)
        expect(runs.some((r) => r.metrics.airborne_presentations! > 0)).toBe(true);
      const length =
        stim.onset_s + (block.trials - 1) * arm.isi_s + approach + block.duration_s;
      for (const r of runs) {
        // Every presentation falls due: shown, or skipped while the fly is airborne.
        expect(r.metrics.presentations! + r.metrics.airborne_presentations!).toBe(
          block.trials,
        );
        expect(r.simulated_s).toBeCloseTo(length, 1);
      }
    }
  });
});

describe("pilots: exploratory sizing, never evidence", { timeout: 300000 }, () => {
  const PILOTS = join(ROOT, "docs/benchmarks/fly-pilots");
  const kept = (
    existsSync(PILOTS) ? readdirSync(PILOTS).filter((n) => n.endsWith(".json")) : []
  ).map((n) => JSON.parse(readFileSync(join(PILOTS, n), "utf8")) as FlyPilot);
  const pilotOf = (protocol: string) => kept.find((p) => p.protocol === protocol);

  it("draws on a fixed public seed domain that no archived run ever uses", () => {
    expect(FLY_PILOT_SEEDS).toHaveLength(FLY_PILOT_SEED_COUNT);
    expect(new Set(FLY_PILOT_SEEDS).size).toBe(FLY_PILOT_SEED_COUNT);
    expect(FLY_PILOT_SEEDS[0]).toBe(
      Number.parseInt(sha256(`${FLY_PILOT}|0`).slice(0, 8), 16),
    );
    expect(FLY_PILOT_SEEDS.every(isFlyPilotSeed)).toBe(true);
    expect(isFlyPilotSeed(FLY_PILOT_SEEDS[0]! + 1)).toBe(false);
    // A record whose seeds include a pilot seed is flagged, whatever else is wrong.
    const { record } = run();
    const onPilot = structuredClone(record);
    onPilot.seeds[0] = FLY_PILOT_SEEDS[0]!;
    expect(verifyFlyRecord(reseal(onPilot)).errors).toContain(
      "the seeds include a pilot seed, which never feeds an archived run",
    );
  });

  it("keeps one pilot per redesigned protocol, labelled not evidence, intact and on this fly", () => {
    expect(kept.map((p) => p.protocol).sort()).toEqual(
      Object.keys(FLY_PILOT_SERIES).sort(),
    );
    for (const p of kept) {
      expect(p.schema).toBe(FLY_PILOT);
      expect(p.status).toBe(FLY_PILOT_STATUS);
      expect(flyPilotIntact(p), p.protocol).toBe(true);
      expect(p.fly_version).toBe(FLY_VERSION);
      expect(p.definition.seeds).toEqual(FLY_PILOT_SEEDS.slice(0, FLY_PILOT_SEEDS_USED));
      expect(p.definition.null_seeds).toEqual(
        FLY_PILOT_SEEDS.slice(FLY_PILOT_SEEDS_USED, 2 * FLY_PILOT_SEEDS_USED),
      );
      // This code's pilot would run exactly what the kept one ran.
      expect(p.definition, p.protocol).toEqual(flyPilotDefinition(p.protocol));
    }
    const readme = readFileSync(join(PILOTS, "README.md"), "utf8");
    expect(readme).toMatch(/^# Digital fly pilots: not evidence/);
    // The index is the one the kept pilots imply (`--pilot --readme` writes it).
    expect(readme).toBe(flyPilotReadme(kept));
  });

  it("gives the demonstrations their seed counts and minimum effects", () => {
    for (const p of kept) {
      const design = flyExample(p.protocol);
      expect(design.parameters.treatment).toEqual(p.sized.treatment);
      expect(design.analysis.metric).toBe(p.sized.metric);
      expect(design.analysis.expected_direction).toBe(p.sized.direction);
      expect(design.parameters.seed_count, p.protocol).toBe(p.sized.seed_count);
      expect(design.analysis.minimum_effect, p.protocol).toBe(
        p.sized.design_minimum_effect,
      );
      expect(p.sized.pass_probability!).toBeGreaterThanOrEqual(0.9);
      expect(compileFlyExperiment(design).ok).toBe(true);
    }
  });

  it("gives the host its minimum effects for the metrics the redesign added", () => {
    const floors = flyPilotFloors(kept);
    for (const id of FLY_PILOT_SIZED_METRICS) {
      expect(floors[id], id).toBeGreaterThan(0);
      expect(FLY_METRICS.find((m) => m.id === id)!.minimum_effect, id).toBe(floors[id]);
    }
    // What each pilot recorded as in force (its README's "in force" and "host
    // minimum effect" columns) is what is in force now.
    const inForce = (id: string) => FLY_METRICS.find((m) => m.id === id)!.minimum_effect;
    for (const p of kept) {
      expect(p.sized.host_minimum_effect, p.protocol).toBe(inForce(p.sized.metric));
      for (const f of p.floors)
        expect(f.host_minimum_effect, `${p.protocol} ${f.metric}`).toBe(
          inForce(f.metric),
        );
    }
  });

  it("re-runs a pilot exactly from its recorded definition", () => {
    const c = checkFlyPilot(pilotOf("visual_threat")!, CLEAN);
    expect(c).toMatchObject({
      intact: true,
      same_runs: true,
      same_outputs: true,
      current_definition: true,
    });
    // An edit to the kept file is caught by its seal and output digest.
    const edited = structuredClone(pilotOf("visual_threat")!);
    edited.sized.seed_count = 8;
    expect(flyPilotIntact(edited)).toBe(false);
  });

  it("sizes conservatively: exact sign-test power, one-sided bounds, rounding", () => {
    expect(lowerBound(32, 32)).toBeCloseTo(0.05 ** (1 / 32), 6);
    expect(upperBound(0, 32)).toBeCloseTo(1 - 0.05 ** (1 / 32), 6);
    expect(lowerBound(0, 32)).toBe(0);
    // Six untied seeds, all in the expected direction: exactly what passes.
    expect(signTestPower(6, 1, 0)).toBeCloseTo(1, 12);
    expect(signTestPower(16, 0.5, 0.5)).toBeLessThan(0.1);
    expect(roundDown2(0.23573)).toBe(0.23);
    expect(roundDown2(0.0296)).toBe(0.029);
    expect(roundUp1(0.0144)).toBe(0.02);
    expect(roundUp1(0.0772)).toBe(0.08);
    const pilot = {
      control_mean: 0.4,
      treatment_mean: 0.1,
      mean_difference: -0.3,
      sd_difference: 0.01,
      increase: 0,
      decrease: 32,
      tie: 0,
      undefined: 0,
      control_at_floor: 0,
      control_at_ceiling: 0,
    };
    const d = Array.from({ length: 32 }, (_, i) => -0.3 + (i % 2 ? 0.01 : -0.01));
    const sized = sizeFlyDesign(
      "escape_ttc_s",
      "decrease",
      threat().parameters.treatment,
      pilot,
      d,
    );
    expect(sized.seed_count).toBe(9);
    expect(sized.minimum_effect).toBe(0.29);
    // A control pinned at a bound in every pilot seed can never pass G3.
    const pinned = sizeFlyDesign(
      "escape_probability",
      "decrease",
      threat().parameters.treatment,
      { ...pilot, control_at_ceiling: 32 },
      d,
    );
    expect(pinned.seed_count).toBeNull();
    expect(pinned.design_minimum_effect).toBeNull();
  });
});

describe(
  "verifying an archive of this code's records, other code's, legacy records and refusals",
  { timeout: 300000 },
  () => {
    const REAL = join(ROOT, "docs/benchmarks/fly-behavior");
    const here = flyIdentity().fly_sha256;
    /** Copies of the real archive's folders that this code does not re-simulate. */
    function archiveOfOthers() {
      const archive = scratch();
      const kinds = { other: 0, legacy: 0, refused: 0 };
      const copied: string[] = [];
      for (const d of readdirSync(REAL, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const recordPath = join(REAL, d.name, "record.json");
        if (existsSync(recordPath)) {
          const r = JSON.parse(readFileSync(recordPath, "utf8"));
          if (r.schema === FLY_LEGACY_RECORD) kinds.legacy++;
          else if (r.plan?.fly_sha256 !== here) kinds.other++;
          else continue;
        } else kinds.refused++;
        cpSync(join(REAL, d.name), join(archive, d.name), { recursive: true });
        copied.push(d.name);
      }
      copyPins(REAL, archive, copied);
      return { archive, kinds };
    }
    const index = (archive: string) =>
      writeFileSync(join(archive, "README.md"), flyArchiveReadme(archive));
    const folder = (
      archive: string,
      record: FlyRecord,
      admission: Parameters<typeof flyFolderFiles>[1],
    ) => {
      const dir = join(archive, record.plan.experiment_id);
      mkdirSync(dir);
      const files = flyFolderFiles(record, admission);
      for (const [name, text] of Object.entries(files))
        writeFileSync(join(dir, name), text);
      pinFlyRenderings(archive, record.plan.experiment_id, files);
      return dir;
    };

    it("holds every committed record's folder as it was written, its report and summary as pinned", () => {
      const records = readdirSync(REAL, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(REAL, d.name, "record.json")))
        .map((d) => d.name)
        .sort();
      expect(records.length).toBeGreaterThan(0);
      expect(Object.keys(readFlyRenderings(REAL).folders)).toEqual(records);
      for (const d of records)
        expect(checkFlyFolder(join(REAL, d)).errors, d).toEqual([]);
    });

    it("pins a folder's report and summary once, and never changes a pin", () => {
      const archive = scratch();
      const files = {
        "report.md": "# report\n",
        "summary.json": "{}\n",
        "plan.json": "{}\n",
      };
      pinFlyRenderings(archive, "FLY-b", files);
      pinFlyRenderings(archive, "FLY-a", files);
      pinFlyRenderings(archive, "FLY-a", files);
      const pins = { "report.md": sha256("# report\n"), "summary.json": sha256("{}\n") };
      expect(readFlyRenderings(archive)).toEqual({
        schema: FLY_RENDERINGS,
        folders: { "FLY-a": pins, "FLY-b": pins },
      });
      expect(Object.keys(readFlyRenderings(archive).folders)).toEqual(["FLY-a", "FLY-b"]);
      expect(() =>
        pinFlyRenderings(archive, "FLY-a", { ...files, "report.md": "# edited\n" }),
      ).toThrow(/a pin is never changed/);
      expect(() =>
        pinFlyRenderings(archive, "FLY-c", { "report.md": "# report\n" }),
      ).toThrow(/no summary\.json to pin/);
      for (const text of ["[]\n", "null\n", '{"schema": "rain-fly-renderings/v1"}\n']) {
        writeFileSync(join(archive, "renderings.json"), text);
        expect(() => readFlyRenderings(archive)).toThrow(/not rain-fly-renderings\/v1/);
      }
      expect(verifyFlyArchive(archive).lines[0]).toMatchObject({
        status: "failed",
        folder: "renderings.json",
      });
    });

    it("checks other code's records without re-simulating them, and fails an archive it can check none of", () => {
      const { archive, kinds } = archiveOfOthers();
      expect(kinds.other).toBeGreaterThan(0);
      expect(kinds.legacy).toBeGreaterThan(0);
      expect(kinds.refused).toBeGreaterThan(0);
      index(archive);
      const v = verifyFlyArchive(archive);
      expect(v.counts).toEqual({
        resimulated: 0,
        admitted: 0,
        other_code: kinds.other,
        other_engine: 0,
        legacy: kinds.legacy,
        refusals: kinds.refused,
        failed: 0,
      });
      for (const line of v.lines.filter((l) => l.status === "other"))
        expect(line.text).toMatch(
          /^other +FLY-[0-9a-f]+: made by .*; seal, files and registry run checked, the report and summary against their pins; not re-simulated \(.+\)$/,
        );
      // Nothing here re-simulates on this fly, so nothing here is checked by it.
      expect(v.summary.join(" ")).toMatch(
        /No admitted record re-simulates on digital-fly\//,
      );
      expect(v.exit_code).toBe(1);
    });

    it("catches by its pins an edit to a record of other code that the facts it states cannot show", () => {
      const { archive } = archiveOfOthers();
      const other = readdirSync(archive)
        .filter((d) => existsSync(join(archive, d, "record.json")))
        .find((d) => {
          const r = JSON.parse(readFileSync(join(archive, d, "record.json"), "utf8"));
          return r.schema !== FLY_LEGACY_RECORD && r.plan.fly_sha256 !== here;
        })!;
      const dir = join(archive, other);
      expect(checkFlyFolder(dir).errors).toEqual([]);
      // Each edit leaves the outcome, the digests and every stated fact as they were.
      const edits: [string, (t: string) => string][] = [
        ["report.md", (t) => t.replace(/^(\| \d+ \| )[^|]+\|/m, "$1 9.999 |")],
        [
          "report.md",
          (t) =>
            t.replace(/— (holds|does not hold)$/m, (_m, w: string) =>
              w === "holds" ? "— does not hold" : "— holds",
            ),
        ],
        [
          "report.md",
          (t) => t.replace(/^> Authorized by the demonstration script.*\n/m, ""),
        ],
        [
          "summary.json",
          (t) =>
            t.replace(
              /"authorized_by": "[^"]*"/,
              '"authorized_by": "a person at the terminal"',
            ),
        ],
      ];
      for (const [name, edit] of edits) {
        const path = join(dir, name);
        const before = readFileSync(path, "utf8");
        const after = edit(before);
        expect(after).not.toBe(before);
        writeFileSync(path, after);
        expect(checkFlyFolder(dir).errors).toEqual([
          `${name} is not the file pinned when this folder was written`,
        ]);
        writeFileSync(path, before);
      }

      // A folder whose pins are gone, and a pin whose folder is gone, fail the archive.
      index(archive);
      expect(verifyFlyArchive(archive).counts.failed).toBe(0);
      const pins = readFileSync(join(archive, "renderings.json"), "utf8");
      const { [other]: _gone, ...rest } = readFlyRenderings(archive).folders;
      writeFileSync(
        join(archive, "renderings.json"),
        flyJsonText({ schema: FLY_RENDERINGS, folders: rest }),
      );
      expect(
        verifyFlyArchive(archive).lines.find((x) => x.folder === other),
      ).toMatchObject({
        status: "failed",
        text: expect.stringMatching(
          /renderings\.json pins no report or summary for this folder/,
        ),
      });
      writeFileSync(join(archive, "renderings.json"), pins);
      const files = { "report.md": "# report\n", "summary.json": "{}\n" };
      pinFlyRenderings(archive, "FLY-000000000000000000000000", files);
      expect(verifyFlyArchive(archive).lines).toContainEqual(
        expect.objectContaining({
          status: "failed",
          folder: "renderings.json",
          text: expect.stringMatching(
            /pins FLY-000000000000000000000000, which the archive does not hold/,
          ),
        }),
      );
    });

    it("re-simulates this code's records beside them, and tells another engine and edits apart", () => {
      const { archive, kinds } = archiveOfOthers();
      const { record } = run();
      folder(archive, record, { registry_run: admit().registry_run, error: null });
      index(archive);
      const mixed = verifyFlyArchive(archive);
      expect(mixed.counts).toEqual({
        resimulated: 1,
        admitted: 1,
        other_code: kinds.other,
        other_engine: 0,
        legacy: kinds.legacy,
        refusals: kinds.refused,
        failed: 0,
      });
      expect(
        mixed.lines.find((l) => l.folder === record.plan.experiment_id),
      ).toMatchObject({
        status: "ok",
      });
      expect(mixed.exit_code).toBe(0);

      // A record made on another JavaScript engine: not re-simulated here, not failed.
      const l = lab({ into: shared });
      const p = plan(threat({ minimumEffect: 0.29 }));
      const receipt = preregisterFly(l.registry, p);
      const a = authorizeFly(p, receipt, scripted(p), l.host);
      if (!a.ok) throw new Error(a.errors.join("; "));
      const bun = reseal({
        ...executeFly(p, receipt, a.value, l.host),
        engine: { runtime: "bun", version: "1.2.0", js: "JavaScriptCore" },
      });
      folder(archive, bun, { registry_run: null, error: "not admitted: a test record" });
      index(archive);
      const elsewhere = verifyFlyArchive(archive);
      expect(elsewhere.counts).toMatchObject({ other_engine: 1, failed: 0 });
      expect(elsewhere.exit_code).toBe(3);

      // An edit to a record of other code is caught by the facts its files state, and its pins.
      const other = mixed.lines.find((x) => x.status === "other")!.folder;
      const summaryPath = join(archive, other, "summary.json");
      const summary = readFileSync(summaryPath, "utf8");
      const s = JSON.parse(summary);
      writeFileSync(
        summaryPath,
        JSON.stringify({ ...s, mean_paired_delta: 99 }, null, 2) + "\n",
      );
      const caught = verifyFlyArchive(archive);
      expect(caught.lines.find((x) => x.folder === other)).toMatchObject({
        status: "failed",
      });
      expect(caught.lines.find((x) => x.folder === other)!.text).toMatch(
        /summary\.json does not state the record's mean_paired_delta/,
      );
      expect(caught.exit_code).toBe(1);
      writeFileSync(summaryPath, summary);
      const reportPath = join(archive, other, "report.md");
      const report = readFileSync(reportPath, "utf8");
      writeFileSync(reportPath, report.replace(/^# (\S+): \w+/, "# $1: PASSED-BY-HAND"));
      expect(
        verifyFlyArchive(archive).lines.find((x) => x.folder === other)!.text,
      ).toMatch(/report\.md does not report the record's outcome and digests/);
      writeFileSync(reportPath, report);
      expect(verifyFlyArchive(archive).exit_code).toBe(3);

      // A stale index, or a stale source digest, fails the archive.
      writeFileSync(join(archive, "README.md"), "# hand-written\n");
      expect(verifyFlyArchive(archive).lines.map((x) => x.folder)).toContain("README.md");
      index(archive);
      const stale = verifyFlyArchive(archive, { stale: "flySource.ts is stale" });
      expect(stale.lines[0]).toMatchObject({ status: "failed", folder: "source digest" });
      expect(stale.exit_code).toBe(1);
    });
  },
);
