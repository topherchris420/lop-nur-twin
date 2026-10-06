import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Measurements, evaluate } from "./evaluate.js";
import { REDACTED, credentialFormatsIn, redact } from "./provenance.js";
import { type Json, Registry } from "./registry.js";
import { recordSubmission, recordedBy } from "./runner.js";
import { ExperimentError, definitionErrors, runRecordErrors } from "./schema.js";
import { percentChange, summarize } from "./stats.js";
import { verify } from "./verify.js";

/**
 * R.A.I.N. Experiments: registry, schema, evaluation, external submissions,
 * provenance and verification, ported from `tests/test_experiment_registry.py`
 * for the subset this runtime carries (no builtin runners: the Bethesda
 * simulator is the external runner, and every run reaches the registry as a
 * submission).
 */
const PLANTED_VALUE = "sk-" + "A1b2C3d4E5f6G7h8I9j0K1l2"; // assembled so the literal never appears in the repo
const ROOT = join(__dirname, "..", "..", "..");

function draft(overrides: Record<string, unknown> = {}): Json {
  return {
    title: "R.A.I.N._project accuracy probe",
    question: "Does the probe reach the target accuracy?",
    hypothesis: "Accuracy is at least 0.9 over at least 20 trials.",
    rationale: "Test fixture.",
    subsystem: { repository: "R.A.I.N._project", component: "probe", paths: [] },
    created_by: "R.A.I.N.Operator",
    evidence_class: "measured",
    runner: { kind: "builtin", name: "fake" },
    seed: 11,
    parameters: { accuracy: 0.95, trials: 30 },
    procedure: ["Run the fake probe."],
    variables: { independent: [], dependent: ["accuracy"], controls: [] },
    metrics: [
      { name: "accuracy", unit: "ratio", description: "fraction correct", deterministic: true },
      { name: "trials", unit: "", description: "trial count", deterministic: true },
      { name: "latency_ms", unit: "ms", description: "timing", deterministic: false },
    ],
    criteria: {
      guards: [{ id: "G1", metric: "trials", op: ">=", value: 20 }],
      success: [{ id: "S1", metric: "accuracy", op: ">=", value: 0.9 }],
      failure: [{ id: "F1", metric: "accuracy", op: "<", value: 0.7 }],
    },
    dependencies: ["pytest"],
    data_policy: { classification: "public", store_artifacts: true },
    limitations: ["Fixture data."],
    ...overrides,
  };
}

const scratch: string[] = [];
function registry(): Registry {
  const dir = mkdtempSync(join(tmpdir(), "rain-experiments-test-"));
  scratch.push(dir);
  return new Registry(join(dir, "experiments"));
}
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const create = (reg: Registry, overrides: Record<string, unknown> = {}) =>
  reg.create(draft(overrides));
const external = (reg: Registry) =>
  create(reg, {
    runner: { kind: "external", repository: "R.A.I.N._project/simulator", adapter: "report_run" },
    subsystem: { repository: "R.A.I.N._project/simulator", component: "agent", paths: [] },
  });
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Json;
const writeJson = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function submission(overrides: Record<string, unknown> = {}): Json {
  return {
    schema_version: "rain-experiment-submission/v1",
    experiment_id: "V3D-EXP-0001",
    experiment_version: 1,
    evidence_class: "measured",
    started_at: "2026-09-29T10:00:00Z",
    finished_at: "2026-09-29T10:05:00Z",
    seed: 3,
    parameters: { mode: "calibrated" },
    inputs: { level: "fixture" },
    measurements: { accuracy: 0.93, trials: 25, latency_ms: 310.0 },
    series: { latency_ms: [300.0, 320.0, 310.0] },
    observations: ["fixture"],
    limitations: [],
    artifacts: [
      {
        name: "replay.bin",
        sha256: "a".repeat(64),
        bytes: 10,
        kind: "replay",
        uri: "file:///never/opened",
      },
    ],
    models: [
      {
        role: "agent",
        name: "fixture-agent",
        provider: "fixture",
        calls: 3,
        latency_ms: [100.0, 110.0],
        validation: { passed: 3, failed: 0 },
      },
    ],
    provenance: {
      producer: "R.A.I.N._service",
      repository: "R.A.I.N._project/simulator",
      commit: "abcdef1234567",
      dirty: false,
    },
    ...overrides,
  };
}

let recorder: ReturnType<typeof recordedBy> | null = null;
const by = (reg: Registry) => (recorder ??= recordedBy(ROOT, reg));
const submit = (reg: Registry, body: Json = submission(), id = "V3D-EXP-0001") =>
  recordSubmission(reg, id, body, { recordedBy: by(reg) });
const runPath = (reg: Registry, run = "RUN-0001") =>
  join(reg.experimentDir("V3D-EXP-0001"), "runs", run, "result.json");
function tamper(reg: Registry, change: (record: Json) => void) {
  const path = runPath(reg);
  const record = readJson(path);
  change(record);
  writeJson(path, record);
}

describe("ids and creation", () => {
  it("allocates sequential ids recorded in the ledger", () => {
    const reg = registry();
    const first = create(reg),
      second = create(reg);
    expect([first.experiment_id, second.experiment_id]).toEqual(["V3D-EXP-0001", "V3D-EXP-0002"]);
    expect(reg.ledger().allocated.map((e) => e.id)).toEqual(["V3D-EXP-0001", "V3D-EXP-0002"]);
    expect([first.experiment_version, first.schema_version]).toEqual([1, "rain-experiment/v1"]);
  });

  it("never reuses a deleted experiment's id", () => {
    const reg = registry();
    create(reg);
    const second = create(reg);
    rmSync(reg.experimentDir(second.experiment_id as string), { recursive: true });
    expect(create(reg).experiment_id).toBe("V3D-EXP-0003");
    const report = verify(reg);
    expect(report.warnings.some((w) => w.includes("V3D-EXP-0002") && w.includes("retired"))).toBe(
      true,
    );
  });

  it("refuses an invalid definition before consuming an id", () => {
    const reg = registry();
    const bad = draft({
      criteria: {
        guards: [],
        success: [{ id: "S1", metric: "accuracy", op: ">=", value: 1 }],
        failure: [],
      },
    });
    expect(() => reg.create(bad)).toThrow(ExperimentError);
    expect(() => reg.create(bad)).toThrow(/failure/);
    expect(reg.experimentIds()).toEqual([]);
    expect(create(reg).experiment_id).toBe("V3D-EXP-0001");
  });

  it("adopts a definition registered elsewhere once, under its ID, without allocating one", () => {
    const origin = registry();
    const definition = create(origin);
    const held = registry();
    expect(held.holds("V3D-EXP-0001")).toBe(false);
    held.adopt(definition);
    held.adopt(definition); // the same definition again is a no-op
    expect(held.holds("V3D-EXP-0001")).toBe(true);
    expect(held.loadDefinition("V3D-EXP-0001")).toEqual(definition);
    expect(held.ledger().allocated).toEqual([]);
    expect(() => held.adopt({ ...definition, hypothesis: "Something else." })).toThrow(
      /already held here with a different definition/,
    );
    expect(() => held.adopt({ ...definition, experiment_id: "EXP-1" })).toThrow(ExperimentError);
    // Adopting allocates nothing: the next ID this registry issues is still its first.
    expect(create(held).experiment_id).toBe("V3D-EXP-0002");
  });

  it("writes experiment.json once", () => {
    const reg = registry();
    const definition = create(reg);
    const path = join(reg.experimentDir(definition.experiment_id as string), "experiment.json");
    expect(() => writeFileSync(path, "x", { flag: "wx" })).toThrow(/EEXIST/);
  });

  it("rejects malformed definitions with a reason that names the field", () => {
    const cases: [(d: Json) => void, string][] = [
      [(d) => (d.experiment_id = "EXP-1"), "experiment_id"],
      [(d) => (d.surprise = true), "Additional properties"],
      [(d) => ((d.criteria as Json).success as Json[])[0]!.op === "" || (((d.criteria as Json).success as Json[])[0]!.op = "=="), "op"],
      [(d) => (((d.criteria as Json).success as Json[])[0]!.metric = "undeclared"), "not declared"],
      [(d) => (((d.criteria as Json).success as Json[])[0]!.id = "F9"), "must start with 'S'"],
      [(d) => (((d.criteria as Json).success as Json[])[0]!.value = NaN), "finite"],
      [(d) => (d.created_by = "Jane Doe <jane@example.com>"), "created_by"],
      [(d) => ((d.subsystem as Json).paths = ["../../etc/passwd"]), "paths"],
      [(d) => ((d.subsystem as Json).paths = ["/etc/passwd"]), "paths"],
      [(d) => (d.evidence_class = "anecdotal"), "evidence_class"],
      [(d) => (d.metrics as Json[]).push({ ...(d.metrics as Json[])[0]! }), "duplicate metric"],
      [(d) => (d.procedure = []), "procedure"],
      [(d) => (d.title = "   "), "title"],
      [(d) => (d.runner = { kind: "shell", command: "rm -rf /" }), "runner"],
      [(d) => (d.runner = { kind: "external", repository: "x" }), "external experiments cannot hash"],
    ];
    for (const [mutate, message] of cases) {
      const definition: Json = {
        schema_version: "rain-experiment/v1",
        experiment_id: "V3D-EXP-0001",
        experiment_version: 1,
        created_at: "2026-01-01T00:00:00.000Z",
        ...draft({ subsystem: { repository: "r", component: "c", paths: ["README.md"] } }),
      };
      expect(definitionErrors(structuredClone(definition))).toEqual([]);
      mutate(definition);
      const errors = definitionErrors(definition);
      expect(errors.length, message).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes(message)), `${message}: ${errors.join(" | ")}`).toBe(
        true,
      );
    }
  });

  it("refuses definitions that hold secrets", () => {
    const reg = registry();
    for (const parameters of [{ api_key: "anything" }, { note: `use ${PLANTED_VALUE}` }])
      expect(() => create(reg, { parameters })).toThrow(/credential/);
    expect(reg.experimentIds()).toEqual([]);
  });

  it("rejects a mismatched id, bad JSON and a malformed id on load", () => {
    const reg = registry();
    const definition = create(reg);
    const path = join(reg.experimentDir("V3D-EXP-0001"), "experiment.json");
    writeJson(path, { ...definition, experiment_id: "V3D-EXP-0009" });
    expect(() => reg.loadDefinition("V3D-EXP-0001")).toThrow(/declares/);
    writeFileSync(path, "{not json");
    expect(() => reg.loadDefinition("V3D-EXP-0001")).toThrow(/not valid JSON/);
    expect(() => reg.loadDefinition("../V3D-EXP-0001")).toThrow(/Not an experiment ID/);
  });

  it("reports a stale lock instead of ignoring it", () => {
    const reg = registry();
    create(reg);
    const lock = join(reg.root, ".registry.lock");
    writeFileSync(lock, "");
    expect(() => reg.withLedgerLock(() => 1, 50)).toThrow(/locked/);
    expect(reg.experimentIds()).toEqual(["V3D-EXP-0001"]);
    rmSync(lock);
    expect(reg.withLedgerLock(() => 2, 50)).toBe(2);
    expect(existsSync(lock)).toBe(false);
  });
});

describe("deterministic evaluation", () => {
  const criteria = draft().criteria as Parameters<typeof evaluate>[0];
  it("decides by the pre-registered criteria alone", () => {
    const cases: [Measurements, string, string][] = [
      [{ accuracy: 0.95, trials: 30 }, "passed", "supported"],
      [{ accuracy: 0.5, trials: 30 }, "failed", "not_supported"],
      [{ accuracy: 0.8, trials: 30 }, "inconclusive", "insufficient_evidence"],
      [{ accuracy: 0.95, trials: 5 }, "inconclusive", "insufficient_evidence"],
      [{ accuracy: 0.2, trials: 5 }, "inconclusive", "insufficient_evidence"], // small sample decides nothing
      [{ trials: 30 }, "inconclusive", "insufficient_evidence"],
      [{ accuracy: null, trials: 30 }, "inconclusive", "insufficient_evidence"],
      [{ accuracy: true as unknown as number, trials: 30 }, "inconclusive", "insufficient_evidence"], // bools are not numbers
    ];
    for (const [measurements, status, verdict] of cases) {
      const result = evaluate(criteria, measurements);
      expect([result.status, result.verdict], JSON.stringify(measurements)).toEqual([status, verdict]);
    }
  });

  it("lets a failure criterion dominate success", () => {
    const result = evaluate(
      {
        guards: [],
        success: [{ id: "S1", metric: "accuracy", op: ">=", value: 0.9 }],
        failure: [{ id: "F1", metric: "trials", op: "<", value: 50 }],
      },
      { accuracy: 0.99, trials: 30 },
    );
    expect([result.status, result.verdict]).toEqual(["failed", "not_supported"]);
    expect(result.evaluation.summary).toContain("F1");
    expect(result.evaluation.rule).toBe("rain-criteria/v1");
  });
});

describe("external submissions", () => {
  it("are evaluated by the host, never by the producer", () => {
    const reg = registry();
    external(reg);
    const record = submit(reg);
    expect([record.kind, record.status, record.hypothesis_verdict]).toEqual(["external", "passed", "supported"]);
    expect(record.run_id).toBe("V3D-EXP-0001-RUN-0001");
    expect(record.duration_ms).toBe(300000);
    const [artifact] = record.artifacts as Json[];
    expect(artifact!.stored).toBe(false);
    expect(artifact!.note).toContain("never fetched");
    expect(((record.provenance as Json).producer as Json).commit).toBe("abcdef1234567");
    expect((record.provenance as Json).source).toBe("external_submission");
    expect((record.statistics as Json).latency_ms).toMatchObject({ n: 3, mean: 310 });
    expect(((record.statistics as Json)["model.agent.latency_ms"] as Json).mean).toBe(105);
    expect(runRecordErrors(record)).toEqual([]);
    expect(readJson(runPath(reg))).toEqual(record);
    expect(verify(reg).valid).toBe(true);
  });

  it("refuses a producer that declares its own status", () => {
    const reg = registry();
    external(reg);
    for (const [field, value] of [
      ["status", "passed"],
      ["hypothesis_verdict", "supported"],
    ])
      expect(() => submit(reg, submission({ [field!]: value }))).toThrow(/Additional properties/);
    expect(reg.runs("V3D-EXP-0001")).toEqual([]);
  });

  it("rejects invalid submissions with the reason", () => {
    const reg = registry();
    external(reg);
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ experiment_version: 2 }, /Re-run against/],
      [{ experiment_id: "V3D-EXP-0002" }, /not V3D-EXP-0001/],
      [{ evidence_class: "simulated" }, /evidence class/],
      [{ finished_at: "2026-09-29T09:00:00Z" }, /precedes/],
      [{ started_at: "2026-09-29T10:00:00.000000" }, /timezone/],
      [{ measurements: { accuracy: "high" } }, /measurements/],
      [{ provenance: { producer: "x" } }, /provenance/],
    ];
    for (const [overrides, message] of cases)
      expect(() => submit(reg, submission(overrides)), JSON.stringify(overrides)).toThrow(message);
    expect(reg.runs("V3D-EXP-0001")).toEqual([]);
  });

  it("refuses a duplicate submission and a submission to a builtin experiment", () => {
    const reg = registry();
    external(reg);
    const first = submit(reg);
    expect(() => submit(reg)).toThrow(`already recorded as ${first.run_id}`);
    expect(reg.runs("V3D-EXP-0001")).toHaveLength(1);
    const builtin = create(reg);
    expect(() =>
      submit(reg, submission({ experiment_id: builtin.experiment_id }), builtin.experiment_id as string),
    ).toThrow(/builtin/);
  });

  it("keeps an execution error and a model's interpretation apart from the evaluation", () => {
    const reg = registry();
    external(reg);
    const failed = submit(
      reg,
      submission({
        measurements: { accuracy: 0.2, trials: 25 },
        model_interpretation: { model: "fixture-agent", text: "Clearly a success." },
      }),
    );
    expect(failed.status).toBe("failed"); // the model's opinion does not move the status
    expect(((failed.interpretation as Json).model as Json).origin).toBe("MODEL_INFERRED");
    const crashed = submit(
      reg,
      submission({
        error: { stage: "launch", type: "Timeout", message: `auth ${PLANTED_VALUE} failed` },
      }),
    );
    expect([crashed.status, crashed.hypothesis_verdict]).toEqual(["error", "not_evaluated"]);
    expect(crashed.evaluation).toBeNull();
    expect(JSON.stringify(crashed)).not.toContain(PLANTED_VALUE);
    expect((crashed.interpretation as Json).deterministic).toContain("not a failed hypothesis");
    expect(verify(reg).valid).toBe(true);
  });

  it("redacts secrets from records", () => {
    const reg = registry();
    external(reg);
    const record = submit(
      reg,
      submission({
        inputs: { note: "fixture", api_key: PLANTED_VALUE },
        models: [
          {
            role: "agent",
            name: "fixture-model",
            latency_ms: [10.0, 20.0],
            request_config: { max_tokens: 64, authorization: "Bearer abcdefghijklmnopqrstuv" },
          },
        ],
      }),
    );
    const text = JSON.stringify(record);
    expect(text).not.toContain(PLANTED_VALUE);
    expect(text).not.toContain("abcdefghijklmnopqrstuv");
    expect((record.inputs as Json).api_key).toBe(REDACTED);
    expect(((record.models as Json[])[0]!.request_config as Json)).toEqual({
      max_tokens: 64,
      authorization: REDACTED,
    });
  });

  it("never overwrites a final run record", () => {
    const reg = registry();
    external(reg);
    const record = submit(reg);
    const { runDir } = reg.resolveRun(record.run_id as string);
    expect(() => reg.writeRun(runDir, record)).toThrow(/never overwritten/);
    expect(() => reg.resolveRun("V3D-EXP-0001-RUN-0009")).toThrow(/not recorded/);
    expect(() => reg.resolveRun("nonsense")).toThrow(/Not a run ID/);
  });
});

describe("provenance helpers", () => {
  it("redacts secret-like fields and credential formats", () => {
    const value = {
      token: "abc",
      max_tokens: 5,
      nested: [{ password: "p" }, `use ${PLANTED_VALUE} now`],
      Authorization: "Bearer abcdefghijklmnopqrstuvwxyz",
    };
    expect(redact(value)).toEqual({
      token: REDACTED,
      max_tokens: 5,
      nested: [{ password: REDACTED }, `use ${REDACTED} now`],
      Authorization: REDACTED,
    });
    expect(credentialFormatsIn("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(credentialFormatsIn("ordinary text about tokens")).toBe(false);
  });

  it("summarises series with fixed precision and flags small samples", () => {
    const s = summarize([2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]);
    expect([s.n, s.mean, s.median, s.min, s.max]).toEqual([8, 5.0, 4.5, 2.0, 9.0]);
    expect(s.variance).toBeCloseTo(32 / 7, 9);
    expect(s.stdev).toBeCloseTo(Math.sqrt(32 / 7), 9);
    expect(s.note).toContain("too small for inference");
    expect(summarize([3.0]).stdev).toBeNull();
    expect(summarize([3.0]).note).toContain("undefined");
    expect([summarize([]).n, summarize([]).mean]).toEqual([0, null]);
    expect(summarize(Array.from({ length: 20 }, (_, i) => i)).note).toBeNull();
    expect([percentChange(50.0, 75.0), percentChange(-4.0, -2.0)]).toEqual([50.0, 50.0]);
    expect([percentChange(0.0, 1.0), percentChange(null, 1.0)]).toEqual([null, null]);
  });
});

describe("verification", () => {
  function verified(): Registry {
    const reg = registry();
    external(reg);
    submit(reg);
    expect(verify(reg).valid).toBe(true);
    return reg;
  }

  it("detects tampered records", () => {
    const cases: [(r: Json) => void, string][] = [
      [(r) => ((r.measurements as Json).accuracy = 0.5), "evaluate to failed"],
      [(r) => Object.assign(r, { status: "failed", hypothesis_verdict: "not_supported" }), "evaluate to passed"],
      [(r) => ((r.series as Record<string, number[]>).latency_ms!.push(99.0)), "statistics"],
      [(r) => ((((r.definition as Json).criteria as Json).success as Json[])[0]!.value = 0.1), "definition snapshot"],
      [(r) => (r.run_id = "V3D-EXP-0002-RUN-0001"), "run_id"],
      [(r) => (r.status = "error"), "error"],
      [(r) => (r.observations as string[]).push(PLANTED_VALUE), "credential"],
    ];
    for (const [change, message] of cases) {
      const reg = verified();
      tamper(reg, change);
      const report = verify(reg);
      expect(report.valid, message).toBe(false);
      expect(report.problems.some((p) => p.includes(message)), `${message}: ${report.problems.join(" | ")}`).toBe(true);
    }
  });

  it("detects artifact tampering and untracked files", () => {
    const reg = verified();
    const artifacts = join(runPath(reg), "..", "artifacts");
    mkdirSync(artifacts);
    writeFileSync(join(artifacts, "extra.bin"), "x");
    expect(verify(reg).problems.some((p) => p.includes("untracked file"))).toBe(true);
    tamper(reg, (r) => ((r.artifacts as Json[])[0]!.stored = true));
    expect(verify(reg).problems.some((p) => p.includes("is missing"))).toBe(true);
    writeFileSync(join(artifacts, "replay.bin"), "changed");
    expect(
      verify(reg).problems.some((p) => p.includes("does not match its recorded SHA-256")),
    ).toBe(true);
  });

  it("requires a version bump when a definition changes after a run", () => {
    const reg = verified();
    const path = join(reg.experimentDir("V3D-EXP-0001"), "experiment.json");
    const definition = readJson(path);
    definition.hypothesis = "A quietly different claim.";
    writeJson(path, definition);
    expect(verify(reg).problems.some((p) => p.includes("without bumping"))).toBe(true);
    definition.experiment_version = 2;
    writeJson(path, definition);
    expect(verify(reg).valid).toBe(true);
  });

  it("reports an unledgered experiment and runs still marked running", () => {
    const reg = verified();
    const ledger = readJson(reg.ledgerPath);
    ledger.allocated = [];
    writeJson(reg.ledgerPath, ledger);
    expect(verify(reg).problems.some((p) => p.includes("not in registry.json"))).toBe(true);
    tamper(reg, (r) => (r.status = "running"));
    expect(verify(reg).warnings.some((w) => w.includes("still marked running"))).toBe(true);
  });

  it("stores a submission's hash so a replayed submission is recognised", () => {
    const reg = verified();
    const record = readJson(runPath(reg));
    expect((record.provenance as Json).submission_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sha(readFileSync(runPath(reg), "utf8"))).toMatch(/^[0-9a-f]{64}$/);
  });
});
