import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "../experiments/registry.js";
import { sha256Json } from "../sha256.js";
import { oscillatorExample } from "./example.js";
import {
  compileNumericalExperiment,
  verifyNumericalPlan,
  compileBethesdaExperiment,
} from "./compiler.js";
import {
  authorizeNumerical,
  executeNumerical,
  verifyNumericalRecord,
  oscillatorReference,
  NumericalRunRefused,
} from "./numerical.js";
import { admitNumericalRecord, preregisterNumerical } from "./registry.js";
import {
  DESIGN_SCHEMA,
  DEFAULT_ENVELOPE,
} from "../../bethesda/rain/discoveryProtocol.js";
import { BACKEND_CAPABILITIES, boundedData } from "./contracts.js";
import { schemaErrors } from "../experiments/jsonSchema.js";
import { executeBethesda } from "./bethesda.js";

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);
const plan = (design = oscillatorExample()) => {
  const p = compileNumericalExperiment(design);
  if (!p.ok) throw new Error(p.errors.join("; "));
  return p.value;
};
const approval = (p = plan(), now = new Date()) => {
  const a = authorizeNumerical(p, {
    operator: "R.A.I.N.TestOperator",
    typedPrefix: p.definition_sha256.slice(0, 8),
    reviewed: true,
    now,
  });
  if (!a.ok) throw new Error(a.errors.join("; "));
  return a.value;
};
const run = (p = plan()) => {
  const now = new Date();
  return executeNumerical(p, approval(p, now), now);
};
const reseal = <T extends { sha256: string }>(r: T): T => {
  const { sha256: _prior, ...body } = r;
  return { ...body, sha256: sha256Json(body) } as T;
};

describe("scientific compiler validation", () => {
  it("produces the same versioned IR/digest and declares all scientific fields", () => {
    const p = plan();
    expect(p).toEqual(plan());
    expect(verifyNumericalPlan(p)).toEqual([]);
    expect(p.steps).toBe(1000);
    expect(p.samples_per_arm).toBe(101);
    expect(p.ir.resource_budget).toEqual({
      execution_steps: 2000,
      replay_steps: 2000,
      max_samples: 202,
    });
    expect(p.ir.statistical_analysis.independent_replicates).toBe(1);
    expect(p.ir.hypothesis).not.toBe(p.design.hypothesis);
    expect(BACKEND_CAPABILITIES.every((b) => b.physical_devices === false)).toBe(true);
  });
  it("rejects missing physical units, unknown operations, nonfinite values, absent parameters and ambiguous hypotheses", () => {
    const base = oscillatorExample();
    for (const raw of [
      { ...base, code: "malicious" },
      { ...base, parameters: { ...base.parameters, mass: { value: 1 } } },
      { ...base, parameters: { ...base.parameters, mass: { value: 1, unit: "g" } } },
      {
        ...base,
        parameters: {
          ...base.parameters,
          force_amplitude: { value: Infinity, unit: "N" },
        },
      },
      { ...base, competing_hypothesis: base.hypothesis },
      { ...base, budget: { max_steps: 100, max_samples: 1001 } },
    ])
      expect(compileNumericalExperiment(raw).ok).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(compileNumericalExperiment(cyclic).ok).toBe(false);
    const getter = Object.defineProperty({}, "parameters", {
      get: () => {
        throw new Error("must not invoke");
      },
      enumerable: true,
    });
    expect(boundedData(getter)).not.toEqual([]);
  });
  it("rejects unstable integration, unresolvable samples, unsupported regimes and noninteger timesteps", () => {
    const d = oscillatorExample();
    d.parameters.timestep.value = 0.1;
    expect(compileNumericalExperiment(d).ok).toBe(false);
    d.parameters.timestep.value = 0.01;
    d.parameters.damping.value = 4;
    expect(compileNumericalExperiment(d).ok).toBe(false);
    d.parameters.damping.value = 0.4;
    d.parameters.duration.value = 10.003;
    expect(compileNumericalExperiment(d).ok).toBe(false);
    d.parameters.duration.value = 10;
    d.parameters.sample_every_steps = 100;
    expect(compileNumericalExperiment(d).ok).toBe(false);
  });
  it("requires actual evidence availability and an immutable model decision receipt", () => {
    const d = oscillatorExample();
    d.provenance.generation = "model";
    expect(compileNumericalExperiment(d).ok).toBe(false);
    d.provenance.decision_sha256 = "a".repeat(64);
    d.provenance.source_ids = ["PAPER-1"];
    expect(compileNumericalExperiment(d).ok).toBe(false);
    expect(compileNumericalExperiment(d, { evidenceIds: new Set(["PAPER-1"]) }).ok).toBe(
      true,
    );
    d.provenance.parent_record_sha256 = "b".repeat(64);
    expect(compileNumericalExperiment(d, { evidenceIds: new Set(["PAPER-1"]) }).ok).toBe(
      false,
    );
  });
});

describe("numerical execution authority", () => {
  it("refuses no review, wrong prefix, Bethesda authority, expired authority and modified plans", () => {
    const p = plan(),
      now = new Date(),
      a = approval(p, now);
    expect(
      authorizeNumerical(p, {
        operator: "R.A.I.N.TestOperator",
        typedPrefix: "00000000",
        reviewed: true,
        now,
      }).ok,
    ).toBe(false);
    expect(
      authorizeNumerical(p, {
        operator: "R.A.I.N.TestOperator",
        typedPrefix: p.definition_sha256.slice(0, 8),
        reviewed: false,
        now,
      }).ok,
    ).toBe(false);
    expect(() => executeNumerical(p, null, now)).toThrow(NumericalRunRefused);
    expect(() =>
      executeNumerical(p, { ...a, scope: "bethesda-simulation" }, now),
    ).toThrow(NumericalRunRefused);
    expect(() => executeNumerical(p, a, new Date(now.getTime() + 3600001))).toThrow(
      NumericalRunRefused,
    );
    const changed = structuredClone(p);
    changed.design.analysis.minimum_effect_m *= 2;
    expect(() => executeNumerical(changed, a, now)).toThrow(NumericalRunRefused);
    expect(() => executeNumerical(p, { ...a, operator: "Someone" }, now)).toThrow(
      NumericalRunRefused,
    );
  });
  it("snapshots a plan before cooperative callbacks can mutate it", () => {
    const p = plan(),
      now = new Date();
    const r = executeNumerical(p, approval(p, now), now, () => {
      p.criteria.success[0]!.value = 1000;
      return false;
    });
    expect(r.result.status).toBe("passed");
    expect(verifyNumericalRecord(r).ok).toBe(true);
  });
});

describe("independent numerical verification", () => {
  it("verifies actual oscillator outputs and exact replay", () => {
    const r = run();
    expect(r.result.status).toBe("passed");
    expect(r.result.measurements.rms_displacement_delta_m).toBeGreaterThan(0.01);
    expect(r.result.measurements.reference_max_error_m).toBeLessThan(0.000001);
    expect(r.result.measurements.reference_max_velocity_error_m_per_s).toBeLessThan(
      0.000001,
    );
    expect(verifyNumericalRecord(r).ok).toBe(true);
    const second = run(r.plan);
    expect(r.result).toEqual(second.result);
  });
  it("checks analytic initial conditions and forced resonance with nonzero initial conditions", () => {
    const d = oscillatorExample();
    d.parameters.angular_frequency.value = 2;
    d.parameters.initial_displacement.value = 0.7;
    d.parameters.initial_velocity.value = -0.2;
    const initial = oscillatorReference(d.parameters, 1, 0);
    expect(initial.x).toBeCloseTo(0.7, 14);
    expect(initial.v).toBeCloseTo(-0.2, 14);
    const r = run(plan(d));
    expect(verifyNumericalRecord(r).ok).toBe(true);
    expect(r.result.measurements.reference_max_error_m).toBeLessThan(0.000001);
  });
  it("shows fourth-order convergence against the analytic reference", () => {
    const d = oscillatorExample();
    d.parameters.initial_displacement.value = 1;
    const coarse = run(plan(d)).result.measurements.reference_max_error_m!;
    d.parameters.timestep.value = 0.005;
    d.parameters.sample_every_steps = 20;
    const fine = run(plan(d)).result.measurements.reference_max_error_m!;
    expect(coarse / fine).toBeGreaterThan(12);
    expect(coarse / fine).toBeLessThan(20);
  });
  it("retains valid negative outcomes separately from procedural failure", () => {
    const d = oscillatorExample();
    d.parameters.force_amplitude.value = 0;
    const r = run(plan(d));
    expect(r.result.status).toBe("failed");
    expect(r.result.verdict).toBe("not_supported");
    expect(r.result.completed).toBe(true);
    expect(r.result.error).toBeNull();
    expect(verifyNumericalRecord(r).ok).toBe(true);
  });
  it("retains reproducible incomplete samples on operator interruption", () => {
    const p = plan(),
      now = new Date();
    let checkpoints = 0;
    const r = executeNumerical(p, approval(p, now), now, () => ++checkpoints === 143);
    expect(r.result.completed).toBe(false);
    expect(r.result.status).toBe("error");
    expect(r.result.verdict).toBe("not_evaluated");
    expect(r.result.stop_checkpoint).toEqual({ arm: "control", step: 142 });
    expect(r.result.arms[0]!.samples.at(-1)!.step).toBe(142);
    expect(verifyNumericalRecord(r).ok).toBe(true);
  });
  it("rejects samples, criteria, units, provenance or backend version changes even when resealed", () => {
    const original = run();
    const edits = [
      (r: typeof original) => {
        r.result.arms[1]!.samples[1]!.displacement_m += 1;
      },
      (r: typeof original) => {
        r.result.measurements.rms_displacement_delta_m = 999;
      },
      (r: typeof original) => {
        r.plan.criteria.success[0]!.value = 0;
      },
      (r: typeof original) => {
        r.plan.ir.backend_version = "future-unverified/v2";
      },
      (r: typeof original) => {
        r.plan.design.provenance.generation = "model";
      },
      (r: typeof original) => {
        r.authorization.identity_verified = true as never;
      },
    ];
    for (const edit of edits) {
      const r = structuredClone(original);
      edit(r);
      expect(verifyNumericalRecord(reseal(r)).ok).toBe(false);
    }
  });
});

describe("native experiment registry integration", () => {
  it("preregisters and admits independently replayed outputs; registry evaluates its own frozen criteria", () => {
    const directory = mkdtempSync(join(tmpdir(), "rain-scientific-"));
    directories.push(directory);
    const registry = new Registry(directory),
      p = plan();
    const receipt = preregisterNumerical(registry, p),
      r = run(p);
    const admitted = admitNumericalRecord(registry, receipt, r, {
      commit: "a".repeat(40),
    });
    expect(admitted.registry_run.status).toBe("passed");
    expect(admitted.registry_run.hypothesis_verdict).toBe("supported");
    expect(registry.runs(receipt.experiment_id)).toHaveLength(1);
    expect(() =>
      admitNumericalRecord(
        registry,
        { ...receipt, registry_definition_sha256: "0".repeat(64) },
        r,
        { commit: "a".repeat(40) },
      ),
    ).toThrow();
    expect(() => admitNumericalRecord(registry, receipt, r, { commit: null })).toThrow(
      "actual producing commit",
    );
  });
  it("records interrupted execution as an error without a scientific verdict", () => {
    const directory = mkdtempSync(join(tmpdir(), "rain-scientific-"));
    directories.push(directory);
    const registry = new Registry(directory),
      p = plan(),
      receipt = preregisterNumerical(registry, p),
      now = new Date();
    const r = executeNumerical(p, approval(p, now), now, () => true);
    const admitted = admitNumericalRecord(registry, receipt, r, {
      commit: "a".repeat(40),
    });
    expect(admitted.registry_run.status).toBe("error");
    expect(admitted.registry_run.hypothesis_verdict).toBe("not_evaluated");
  });
});

describe("Bethesda adapter preserves native gates", () => {
  it("delegates closed vocabulary, compilation and execution authority", () => {
    const design = {
      schema: "rain-discovery-design/v1",
      question: "How does a closure change movement?",
      hypothesis: "Movement declines",
      competing_hypothesis: "Movement increases",
      rationale: "Matched-seed test",
      evidence_ids: [],
      parent_design_id: null,
      purpose: "exploratory",
      scenario: "metro_closure",
      location: "bethesda_metro",
      primary_metric: "cohort_mean_distance_m",
      expected_direction: "decrease",
      minimum_effect: 0.01,
      warmup_ticks: 100,
      observation_window_ticks: 300,
      parameters: {
        pedestrians: 40,
        vehicles: 0,
        buses: 0,
        intensity: 1,
        duration_ticks: 300,
      },
      uncertainties: ["Small simulated cohort"],
      replication_plan: "Use held-out seeds",
      information_value: 0.5,
    };
    expect(schemaErrors(design, DESIGN_SCHEMA)).toEqual([]);
    const compiled = compileBethesdaExperiment(
      design,
      {
        envelope: { ...DEFAULT_ENVELOPE, seeds_per_design: 3 },
        seeds: [101, 102, 103],
        decision: { decision_id: "DECISION-1", envelope_hash: "a".repeat(64) },
        prior: [],
        evidenceIds: new Set(),
      },
      {
        generation: "scripted",
        decision_sha256: null,
        source_ids: [],
        parent_record_sha256: null,
      },
    );
    if (!compiled.ok) throw new Error(compiled.errors.join("; "));
    expect(compiled.ok).toBe(true);
    expect(compiled.value.ir.backend).toBe("bethesda");
    expect(() => executeBethesda(compiled.value, null).next()).toThrow("authorization");
  });
});
