import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "../experiments/registry.js";
import { sha256, sha256Json } from "../sha256.js";
import { BACKEND_CAPABILITIES, CIVILIZATION_METRICS } from "./contracts.js";
import { civilizationExample } from "./civilizationExample.js";
import {
  authorizeCivilization,
  civilizationReceiptErrors,
  CivilizationRunRefused,
  compileCivilizationExperiment,
  executeCivilization,
  exposedSeedErrors,
  verifyCivilizationPlan,
  verifyCivilizationRecord,
} from "./civilization.js";
import {
  admitCivilizationRecord,
  preregisterCivilization,
  replayObservation,
} from "./civilizationRegistry.js";
import { civilizationBackend } from "./backends.js";
import { loadNoeterraEngine, NOETERRA_WASM } from "./noeterraLoader.js";
import { NoeterraEngineError } from "./noeterraEngine.js";
import type { CivilizationDesign, CivilizationRecord } from "./contracts.js";

// The engine is built from noeterra/ (npm run noeterra:wasm) and is not committed.
// CI builds it and checks the file exists before this suite runs; a checkout
// without Rust skips these tests and says so. (Nothing under src/rain reads the
// environment, so the requirement lives in CI, not here.)
const loaded = loadNoeterraEngine(process.cwd());
const engine = loaded.engine!;
const suite = loaded.engine ? describe : describe.skip;
if (!loaded.engine) console.warn(`[civilization] skipped: ${NOETERRA_WASM} is not built`);

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })),
);

const plan = (
  design: CivilizationDesign = civilizationExample({ turns: 24, seeds: [1, 2, 3, 4] }),
) => {
  const p = compileCivilizationExperiment(design, { engine });
  if (!p.ok) throw new Error(p.errors.join("; "));
  return p.value;
};
const approval = (p = plan(), now = new Date()) => {
  const a = authorizeCivilization(p, engine, {
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
  return executeCivilization(p, approval(p, now), engine, now);
};
const reseal = <T extends { sha256: string }>(r: T): T => {
  const { sha256: _prior, ...body } = r;
  return { ...body, sha256: sha256Json(body) } as T;
};

suite("the Noeterra engine in process", () => {
  it("imports nothing and agrees with the host on every metric", () => {
    expect(engine.version().engine).toMatch(/^noeterra \S+ sim\/\d+$/);
    expect(engine.metrics()).toEqual(CIVILIZATION_METRICS.map((m) => ({ ...m })));
    expect(BACKEND_CAPABILITIES[2]).toMatchObject({
      id: "civilization",
      physical_devices: false,
    });
  });
  it("answers a malformed request with a refusal, not a crash", () => {
    expect(() => engine.call({ op: "launch_missiles" })).toThrow(/not valid/);
    expect(engine.version().engine).toBeTruthy();
  });
});

suite("civilization compiler", () => {
  it("is deterministic, host-written and bound to the engine", () => {
    const p = plan();
    expect(p).toEqual(plan());
    expect(verifyCivilizationPlan(p, engine)).toEqual([]);
    expect(p.experiment_id).toMatch(/^CV-[a-f0-9]{24}$/);
    expect(p.ir.domain).toBe("civilization-simulation");
    expect(p.ir.hypothesis).not.toBe(p.design.hypothesis);
    expect(p.ir.hypothesis).toContain("wars_declared");
    expect(p.engine).toBe(engine.version().engine);
    expect(p.noeterra_plan.arms[1]!.policy).toBe("amnesic");
    expect(p.simulated_turns).toBe(2 * 4 * 24);
    expect(p.ir.limitations.join(" ")).toMatch(/never empirical evidence/);
  });

  it("refuses designs outside the vocabulary or the budget", () => {
    const refused = (mutate: (d: CivilizationDesign) => void) => {
      const d = civilizationExample({ turns: 24, seeds: [1, 2, 3, 4] });
      mutate(d);
      const r = compileCivilizationExperiment(d, { engine });
      expect(r.ok).toBe(false);
      return r.ok ? [] : r.errors;
    };
    expect(
      refused(
        (d) =>
          (d.parameters.treatment = {
            kind: "set_trait",
            civ: "atlantis",
            trait: "honor",
            value: 0.5,
          }),
      ).join(" "),
    ).toMatch(/unknown civilization/);
    expect(refused((d) => (d.parameters.seeds = [1, 1, 2, 3])).join(" ")).toMatch(
      /repeat/,
    );
    expect(refused((d) => (d.budget.max_simulated_turns = 10)).join(" ")).toMatch(
      /budget/,
    );
    expect(refused((d) => (d.analysis.minimum_consistent_seeds = 1)).join(" ")).toMatch(
      /half/,
    );
    expect(refused((d) => (d.competing_hypothesis = d.hypothesis)).join(" ")).toMatch(
      /differ/,
    );
    expect(refused((d) => (d.provenance.generation = "model")).join(" ")).toMatch(
      /receipt/,
    );
    refused((d) => Object.assign(d.parameters, { agents: "gpt" }));
    refused((d) => (d.parameters.turns = 5000));
    refused((d) => ((d.analysis as { metric: string }).metric = "happiness"));
  });

  it("refuses seeds an equivalent protocol already ran, whatever the metric or threshold", () => {
    const first = plan();
    const retest = plan(
      civilizationExample({
        turns: 24,
        seeds: [3, 4, 5, 6],
        metric: "battles",
        minimumEffect: 2,
      }),
    );
    expect(exposedSeedErrors(retest, [first]).join(" ")).toMatch(
      /seeds 3, 4 were already exposed/,
    );
    // Fresh seeds are a replication, another treatment is another question, and
    // reviewing the same plan again is not a second test.
    expect(
      exposedSeedErrors(plan(civilizationExample({ turns: 24, seeds: [5, 6, 7] })), [
        first,
      ]),
    ).toEqual([]);
    const otherTreatment = civilizationExample({
      turns: 24,
      seeds: [1, 2, 3, 4],
      treatment: { kind: "scale_treasury", civ: "rome", factor: 2 },
    });
    expect(exposedSeedErrors(plan(otherTreatment), [first])).toEqual([]);
    expect(exposedSeedErrors(first, [first])).toEqual([]);
  });
});

describe("a model design and its receipt", () => {
  // The shape noeterra/src/design.rs `propose` writes: the model's prose stays in
  // the receipt, and the design is derived field by field from the answer.
  const answer = {
    question: "Does memory drive war?",
    hypothesis: "Without memory, fewer wars.",
    competing_hypothesis: "Memory changes nothing.",
    rationale: "Earlier runs suggest it.",
    parameters: {
      seeds: [1, 2, 3, 4],
      turns: 30,
      treatment: { kind: "withhold_memory" },
    },
    analysis: {
      metric: "wars_declared",
      expected_direction: "decrease",
      minimum_effect: 1,
      minimum_consistent_seeds: 3,
    },
  };
  const receipt = JSON.stringify(
    {
      schema: "noeterra-design-receipt/v1",
      generation: "model",
      answer: `Here is the design.\n${JSON.stringify(answer)}\nGood luck.`,
    },
    null,
    2,
  );
  const design = (): CivilizationDesign => ({
    schema: "rain-civilization-design/v1",
    question: "Does memory drive war?",
    hypothesis: "Without memory, fewer wars.",
    competing_hypothesis: "Memory changes nothing.",
    parameters: {
      scenario: "mediterranean-264bc",
      seeds: [1, 2, 3, 4],
      turns: 30,
      treatment: { kind: "withhold_memory" },
    },
    analysis: {
      method: "matched_seed_paired_delta",
      metric: "wars_declared",
      expected_direction: "decrease",
      minimum_effect: 1,
      minimum_consistent_seeds: 3,
    },
    budget: { max_simulated_turns: 240 },
    provenance: {
      generation: "model",
      decision_sha256: sha256(receipt),
      source_ids: [],
      parent_record_sha256: null,
    },
  });

  it("accepts exactly the design the receipt's answer produces", () => {
    expect(civilizationReceiptErrors(design(), receipt)).toEqual([]);
  });

  it("refuses a design edited after the model proposed it", () => {
    const edits: ((d: CivilizationDesign) => void)[] = [
      (d) => (d.parameters.seeds = [1, 2, 3, 5]),
      (d) => (d.parameters.turns = 40),
      (d) => (d.analysis.minimum_effect = 0.5),
      (d) => (d.analysis.minimum_consistent_seeds = 2),
      (d) => (d.hypothesis = "Without memory, far fewer wars."),
    ];
    for (const edit of edits) {
      const d = design();
      edit(d);
      expect(civilizationReceiptErrors(d, receipt).join(" ")).toMatch(
        /not the design the receipt's answer produces/,
      );
    }
    expect(
      civilizationReceiptErrors(design(), receipt.replace("Good luck", "Bye")),
    ).not.toEqual([]);
    expect(civilizationReceiptErrors(design(), null)).toEqual([
      "a model design needs its receipt",
    ]);
  });
});

// Each check below re-simulates whole experiments, some several times over.
const SLOW = 120000;

suite("civilization execution", () => {
  it("needs a fresh authorization bound to the digest", () => {
    const p = plan();
    expect(
      authorizeCivilization(p, engine, {
        operator: "R.A.I.N.TestOperator",
        typedPrefix: "00000000",
        reviewed: true,
        now: new Date(),
      }).ok,
    ).toBe(false);
    const old = new Date(Date.now() - 2 * 3600000);
    expect(() => executeCivilization(p, approval(p, old), engine, new Date())).toThrow(
      CivilizationRunRefused,
    );
  });

  it(
    "records simulated measurements that independent re-simulation reproduces",
    () => {
      const r = run();
      expect(r.evidence_class).toBe("simulated");
      expect(r.result.completed).toBe(true);
      expect(r.result.measurements.determinism_check).toBe(1);
      expect(r.result.measurements.arms_completed).toBe(8);
      expect(
        r.result.experiment!.runs.every((x) => /^[a-f0-9]{64}$/.test(x.final_hash)),
      ).toBe(true);
      expect(["passed", "failed", "inconclusive"]).toContain(r.result.status);
      const v = verifyCivilizationRecord(r, engine);
      expect(v.errors).toEqual([]);
      expect(v.ok).toBe(true);
    },
    SLOW,
  );

  it(
    "catches resealed tampering with measurements, hashes or the verdict",
    () => {
      const r = run();
      const forged: CivilizationRecord[] = [
        structuredClone(r),
        structuredClone(r),
        structuredClone(r),
      ];
      forged[0]!.result.measurements.mean_paired_delta = -99;
      forged[1]!.result.experiment!.runs[0]!.final_hash = "0".repeat(64);
      forged[2]!.result.status =
        forged[2]!.result.status === "passed" ? "failed" : "passed";
      for (const f of forged)
        expect(verifyCivilizationRecord(reseal(f), engine).ok).toBe(false);
      const unsealed = structuredClone(r);
      unsealed.evidence_class = "measured" as "simulated";
      expect(verifyCivilizationRecord(unsealed, engine).ok).toBe(false);
    },
    SLOW,
  );
});

suite("civilization registry admission", () => {
  it(
    "admits every result through the registry's own evaluation, including non-passing ones",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "rain-civ-"));
      directories.push(dir);
      const registry = new Registry(dir);
      const designs = [
        civilizationExample({ turns: 24, seeds: [1, 2, 3, 4] }),
        // A deliberately implausible threshold: the honest outcome is "not supported" or "insufficient".
        civilizationExample({ turns: 24, seeds: [1, 2, 3, 4], minimumEffect: 500 }),
      ];
      const statuses: string[] = [];
      for (const d of designs) {
        const p = plan(d);
        const receipt = preregisterCivilization(registry, p, engine);
        const record = run(p);
        const admitted = admitCivilizationRecord(registry, receipt, record, engine, {
          commit: "abcdef1",
        });
        expect(admitted.replay.ok).toBe(true);
        expect(admitted.registry_run.status).toBe(record.result.status);
        statuses.push(record.result.status);
      }
      expect(statuses[1]).not.toBe("passed");
      const p = plan(designs[0]);
      const receipt = preregisterCivilization(registry, p, engine);
      expect(() =>
        admitCivilizationRecord(registry, receipt, run(p), engine, { commit: null }),
      ).toThrow(/commit/);
    },
    SLOW,
  );

  it(
    "admits an engine failure without inventing measurements for it",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "rain-civ-"));
      directories.push(dir);
      const registry = new Registry(dir);
      // The same module, except that the experiment traps, as an out-of-memory run would.
      const failing = Object.create(engine) as typeof engine;
      failing.experiment = () => {
        throw new NoeterraEngineError("the Noeterra engine trapped: unreachable");
      };
      const p = plan(civilizationExample({ turns: 16, seeds: [1, 2, 3] }));
      const receipt = preregisterCivilization(registry, p, failing);
      const now = new Date();
      const record = executeCivilization(p, approval(p, now), failing, now);
      expect(record.result.completed).toBe(false);
      // Nothing was checked or simulated, so nothing is recorded as zero.
      expect(record.result.measurements.determinism_check).toBeNull();
      expect(record.result.measurements.simulated_turns).toBeNull();
      expect(replayObservation(record, "x")).toMatch(/no state hash to reproduce/);
      const { registry_run } = admitCivilizationRecord(
        registry,
        receipt,
        record,
        failing,
        {
          commit: "abcdef1",
        },
      );
      expect(registry_run.series).toEqual({});
    },
    SLOW,
  );

  it(
    "is reachable through the typed backend seam",
    () => {
      const backend = civilizationBackend(engine);
      expect(backend.capability.id).toBe("civilization");
      const compiled = backend.compile(
        civilizationExample({ turns: 16, seeds: [7, 8, 9] }),
        {},
      );
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      const record = backend.execute(compiled.value, approval(compiled.value));
      expect(backend.verifyRecord(record).ok).toBe(true);
    },
    SLOW,
  );
});
