import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Registry } from "./registry.js";
import { recordSubmission } from "./runner.js";
import { canonicalJson, sha256Bytes, sha256Json, type Json } from "./schema.js";
import { verify } from "./verify.js";
import {
  assessResearch,
  bindResearchRun,
  RESEARCH_SCHEMA,
  validateResearchPlan,
  type ResearchPlan,
  type ResearchReview,
} from "./research.js";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const now = "2026-10-09T10:00:00.000Z";
const by = {
  git: {
    commit: "a".repeat(40),
    branch: "fixture",
    dirty: false,
    changed_paths: 0,
    note: null,
  },
  environment: { runtime: "test" },
};
function setup(overrides: Json = {}) {
  const root = mkdtempSync(join(tmpdir(), "rain-lineage-"));
  dirs.push(root);
  const registry = new Registry(root, () => new Date(now));
  const definition = registry.create({
    title: "Synthetic contract test",
    question: "Does the recorded metric exceed the threshold?",
    hypothesis: "The metric is at least 5 under the registered conditions.",
    rationale: "Synthetic validation fixture, not a research result.",
    subsystem: { repository: "fixture", component: "counter", paths: [] },
    created_by: "R.A.I.N.Test",
    evidence_class: "simulated",
    runner: { kind: "external", repository: "fixture" },
    seed: 7,
    parameters: { control: true },
    procedure: ["Read the test fixture."],
    variables: {
      independent: ["condition"],
      dependent: ["metric"],
      controls: ["matched baseline"],
    },
    metrics: [
      {
        name: "metric",
        unit: "count",
        description: "fixture count",
        deterministic: true,
      },
    ],
    criteria: {
      guards: [],
      success: [{ id: "S1", metric: "metric", op: ">=", value: 5 }],
      failure: [{ id: "F1", metric: "metric", op: "<", value: 0 }],
    },
    dependencies: [],
    data_policy: { classification: "public", store_artifacts: true },
    limitations: ["Synthetic test data."],
    ...overrides,
  });
  const plan: ResearchPlan = {
    schema: RESEARCH_SCHEMA,
    branch: "main",
    based_on: null,
    assumptions: [
      {
        id: "sensor",
        statement: "The counter measures the intended quantity.",
        status: "accepted",
      },
    ],
    claims: [
      {
        id: "effect",
        experiment: {
          id: definition.experiment_id as string,
          sha256: sha256Json(definition),
        },
        runs: [],
        assumptions: ["sensor"],
        depends_on: [],
      },
    ],
  };
  return { registry, definition, plan };
}
function submission(definition: Json, value = 10, extra: Json = {}) {
  const measurements = { metric: value },
    series = { metric: [value] };
  const text = JSON.stringify({ measurements, series });
  const body = {
    schema_version: "rain-experiment-submission/v1",
    experiment_id: definition.experiment_id,
    experiment_version: 1,
    evidence_class: definition.evidence_class,
    started_at: now,
    finished_at: now,
    seed: definition.seed,
    parameters: definition.parameters,
    inputs: { fixture: true },
    measurements,
    series,
    observations: ["Synthetic test input."],
    limitations: ["Not an empirical finding."],
    artifacts: [
      {
        name: "measurements.json",
        sha256: sha256Bytes(text),
        bytes: Buffer.byteLength(text),
        kind: "measurements",
      },
    ],
    models: [],
    provenance: {
      producer: "fixture",
      repository: "fixture",
      commit: "b".repeat(40),
      dirty: false,
    },
    ...extra,
  };
  return { body, artifacts: { "measurements.json": text } };
}
function run(
  registry: Registry,
  definition: Json,
  value = 10,
  extra: Json = {},
  store = true,
) {
  const s = submission(definition, value, extra);
  return recordSubmission(registry, definition.experiment_id as string, s.body, {
    recordedBy: by,
    artifacts: store ? s.artifacts : undefined,
  });
}
function link(registry: Registry, plan: ResearchPlan, record: Json) {
  plan.claims[0]!.runs.push(bindResearchRun(registry, record.run_id as string));
}
const review = (plan: ResearchPlan): ResearchReview => ({
  origin: "human",
  operator: "R.A.I.N.Test",
  reviewed: true,
  plan_sha256: sha256Json(plan),
});
const save = (registry: Registry, plan: ResearchPlan, expected: number) =>
  registry.saveResearch(plan, expected, review(plan));

describe("native research graph", () => {
  it("inspects research through the operator CLI in a fresh Node process", () => {
    const { registry, definition, plan } = setup();
    link(registry, plan, run(registry, definition));
    save(registry, plan, 0);
    const result = spawnSync(
      process.execPath,
      ["tools/rain-research.mjs", "inspect", "--registry", registry.root],
      {
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).current_assessment.claims[0].status).toBe(
      "supported",
    );
  });
  it("binds the registered hypothesis to verified raw values without promoting model prose", () => {
    const { registry, definition, plan } = setup();
    const before = save(registry, plan, 0);
    expect(before.assessment.claims[0]!.status).toBe("untested");
    const record = run(registry, definition, 10, {
      model_interpretation: { model: "fixture", text: "This proves everything." },
    });
    link(registry, plan, record);
    plan.based_on = 1;
    const view = save(registry, plan, 1).assessment;
    expect(view.claims[0]).toMatchObject({
      status: "supported",
      statement: definition.hypothesis,
      confidence: null,
      supporting_runs: [record.run_id],
    });
    expect(view.edges).toContainEqual({
      from: `run:${record.run_id}`,
      to: "effect",
      relation: "supports",
    });
    expect(view.claims[0]!.evidence[0]!.measurements).toEqual({ metric: 10 });
    expect(view.claims[0]!.uncertainty.join()).toMatch(/not established/);
    expect(verify(registry).problems).toEqual([]);
    expect((record.interpretation as Json).model).toMatchObject({
      origin: "MODEL_INFERRED",
    });
  });
  it("rejects cycles, dangling dependencies, duplicate identities and model-written statuses", () => {
    const { plan } = setup();
    for (const mutate of [
      (p: ResearchPlan) => p.claims[0]!.depends_on.push("effect"),
      (p: ResearchPlan) => p.claims[0]!.depends_on.push("absent"),
      (p: ResearchPlan) => p.claims[0]!.assumptions.push("absent"),
      (p: ResearchPlan) => p.assumptions.push(p.assumptions[0]!),
      (p: ResearchPlan) => Object.assign(p.claims[0]!, { status: "supported" }),
      (p: ResearchPlan) =>
        Object.assign(p.claims[0]!, { statement: "Unrelated conclusion" }),
    ]) {
      const bad = structuredClone(plan);
      mutate(bad);
      expect(() => validateResearchPlan(bad)).toThrow();
    }
  });
  it("rejects cross-experiment evidence and oversized plans", () => {
    const { plan } = setup();
    plan.claims[0]!.runs = [{ id: "V3D-EXP-0002-RUN-0001", sha256: "a".repeat(64) }];
    expect(() => validateResearchPlan(plan)).toThrow(/foreign/);
    plan.claims[0]!.runs = [];
    plan.claims = Array.from({ length: 129 }, () => plan.claims[0]!);
    expect(() => validateResearchPlan(plan)).toThrow(/128/);
  });
  it("detects a new contradictory result even when a claim omits it", () => {
    const { registry, definition, plan } = setup();
    const positive = run(registry, definition);
    link(registry, plan, positive);
    expect(assessResearch(registry, plan).claims[0]!.status).toBe("supported");
    const negative = run(registry, definition, -1);
    const claim = assessResearch(registry, plan).claims[0]!;
    expect(claim.status).toBe("contested");
    expect(claim.contrary_runs).toEqual([negative.run_id]);
    expect(claim.supporting_runs).toEqual([positive.run_id]);
    expect(claim.reasons.join()).toMatch(/new result requires review/);
    expect(registry.resolveRun(positive.run_id as string).record).toEqual(positive);
  });
  it("propagates invalidation through a diamond while preserving unrelated claims and old branches", () => {
    const { registry, definition, plan } = setup();
    const record = run(registry, definition);
    link(registry, plan, record);
    const base = plan.claims[0]!;
    plan.claims.push(
      ...[
        { ...base, id: "left", depends_on: ["effect"], assumptions: [] },
        { ...base, id: "right", depends_on: ["effect"], assumptions: [] },
        { ...base, id: "conclusion", depends_on: ["left", "right"], assumptions: [] },
        { ...base, id: "unrelated", depends_on: [], assumptions: [] },
      ],
    );
    const original = save(registry, plan, 0);
    plan.branch = "assumption-review";
    plan.based_on = 1;
    plan.assumptions[0]!.status = "invalidated";
    const revised = save(registry, plan, 1);
    expect(
      revised.assessment.claims
        .filter((c) => c.id !== "unrelated")
        .every((c) => c.status === "needs_reassessment"),
    ).toBe(true);
    expect(revised.assessment.claims.find((c) => c.id === "unrelated")!.status).toBe(
      "supported",
    );
    const history = new Registry(registry.root).researchHistory();
    expect(history[0]).toEqual(original);
    expect(history[0]!.assessment.claims.every((c) => c.status === "supported")).toBe(
      true,
    );
    expect(history[1]!.plan.based_on).toBe(1);
  });
  it.each([
    "definition",
    "run",
    "artifact",
    "missing-artifact",
    "missing-run",
    "missing-definition",
  ])("reassesses %s changes without silently retaining support", (kind) => {
    const { registry, definition, plan } = setup();
    const record = run(registry, definition);
    link(registry, plan, record);
    const saved = save(registry, plan, 0);
    const exp = registry.experimentDir(definition.experiment_id as string);
    const dir = registry.resolveRun(record.run_id as string).runDir;
    const path = kind.endsWith("definition")
      ? join(exp, "experiment.json")
      : kind.endsWith("run")
        ? join(dir, "result.json")
        : join(dir, "artifacts", "measurements.json");
    if (kind.startsWith("missing")) unlinkSync(path);
    else if (kind === "definition")
      writeFileSync(path, canonicalJson({ ...definition, hypothesis: "Changed claim" }));
    else if (kind === "run")
      writeFileSync(path, canonicalJson({ ...record, measurements: { metric: 999 } }));
    else writeFileSync(path, "corrupted");
    expect(assessResearch(registry, plan).claims[0]!.status).toBe("needs_reassessment");
    expect(registry.researchHistory()[0]).toEqual(saved);
  });
  it("retains failed executions separately from negative and inconclusive findings", () => {
    for (const [value, extra, status] of [
      [-1, {}, "not_supported"],
      [2, {}, "inconclusive"],
      [
        0,
        {
          error: { stage: "execute", type: "Timeout", message: "Injected test timeout" },
        },
        "not_evaluated",
      ],
    ] as const) {
      const { registry, definition, plan } = setup();
      const result = run(registry, definition, value, extra);
      link(registry, plan, result);
      expect(assessResearch(registry, plan).claims[0]!.status).toBe(status);
      expect(result.error === null).toBe(status !== "not_evaluated");
    }
  });
  it("does not combine different producing code revisions as one supported conclusion", () => {
    const { registry, definition, plan } = setup();
    const a = run(registry, definition);
    link(registry, plan, a);
    const b = run(registry, definition, 11, {
      provenance: { producer: "fixture", repository: "fixture", commit: "c".repeat(40) },
    });
    link(registry, plan, b);
    expect(assessResearch(registry, plan).claims[0]).toMatchObject({
      status: "needs_reassessment",
    });
  });
});

describe("artifact and human review boundaries", () => {
  it("does not accept a replay-shaped artifact just because its raw numbers match", () => {
    const { registry, definition, plan } = setup();
    const s = submission(definition);
    const text = JSON.stringify({
      schema: "bethesda-rain-experiment-record/v3",
      run: { measurements: s.body.measurements, series: s.body.series },
    });
    // Even labeling a Bethesda body as generic measurements cannot bypass replay.
    s.body.artifacts[0] = {
      ...s.body.artifacts[0]!,
      sha256: sha256Bytes(text),
      bytes: Buffer.byteLength(text),
    };
    s.artifacts["measurements.json"] = text;
    const record = recordSubmission(
      registry,
      definition.experiment_id as string,
      s.body,
      { recordedBy: by, artifacts: s.artifacts },
    );
    link(registry, plan, record);
    const assessed = assessResearch(registry, plan).claims[0]!;
    expect(assessed.status).toBe("needs_reassessment");
    expect(assessed.reasons.join(" ")).toContain("did not pass deterministic replay");
    expect(assessed.supporting_runs).toEqual([]);
  });
  it("refuses bad artifact bytes, disallowed policies and duplicate names before allocating a run", () => {
    const { registry, definition } = setup();
    const s = submission(definition);
    expect(() =>
      recordSubmission(registry, definition.experiment_id as string, s.body, {
        recordedBy: by,
        artifacts: { "measurements.json": "changed" },
      }),
    ).toThrow(/differs/);
    expect(() =>
      recordSubmission(
        registry,
        definition.experiment_id as string,
        { ...s.body, artifacts: [...s.body.artifacts, ...s.body.artifacts] },
        { recordedBy: by },
      ),
    ).toThrow(/Duplicate/);
    expect(registry.runDirs(definition.experiment_id as string)).toEqual([]);
    for (const policy of [
      { classification: "sensitive", store_artifacts: true },
      { classification: "public", store_artifacts: false },
    ]) {
      const local = setup({ data_policy: policy });
      expect(() => run(local.registry, local.definition)).toThrow(/forbids/);
    }
  });
  it("never promotes hash-only records, unrelated raw numbers or model inference", () => {
    for (const mode of ["hash-only", "wrong-numbers", "model"] as const) {
      const { registry, definition, plan } = setup(
        mode === "model" ? { evidence_class: "model_inferred" } : {},
      );
      let record: Json;
      if (mode === "wrong-numbers") {
        const s = submission(definition);
        s.body.measurements.metric = 50;
        record = recordSubmission(registry, definition.experiment_id as string, s.body, {
          recordedBy: by,
          artifacts: s.artifacts,
        });
      } else record = run(registry, definition, 10, {}, mode !== "hash-only");
      link(registry, plan, record);
      expect(assessResearch(registry, plan).claims[0]!.status).toBe("needs_reassessment");
    }
  });
  it("requires exact human review, rejects stale writers, and validates parent history", () => {
    const { registry, plan } = setup();
    expect(() =>
      registry.saveResearch(plan, 0, {
        ...review(plan),
        origin: "model",
      } as unknown as ResearchReview),
    ).toThrow(/human review/);
    expect(() =>
      registry.saveResearch(plan, 0, { ...review(plan), plan_sha256: "f".repeat(64) }),
    ).toThrow(/human review/);
    expect(registry.researchHistory()).toEqual([]);
    save(registry, plan, 0);
    expect(() => save(registry, plan, 0)).toThrow(/revision conflict/);
    expect(() => save(registry, plan, 1)).toThrow(/latest revision/);
    plan.based_on = 99;
    expect(() => save(registry, plan, 1)).toThrow(/parent/);
    const path = join(registry.root, "research", "REV-000001.json");
    const history = JSON.parse(readFileSync(path, "utf8"));
    history.assessment.claims[0].status = "supported";
    writeFileSync(path, JSON.stringify(history));
    expect(() => registry.researchHistory()).toThrow(/changed/);
  });
  it("refuses symlinks in artifact ancestors and path escapes", () => {
    const { registry, definition, plan } = setup();
    const record = run(registry, definition);
    link(registry, plan, record);
    const { runDir } = registry.resolveRun(record.run_id as string);
    const path = join(runDir, "artifacts");
    const outside = mkdtempSync(join(tmpdir(), "rain-outside-"));
    dirs.push(outside);
    writeFileSync(
      join(outside, "measurements.json"),
      submission(definition).artifacts["measurements.json"],
    );
    rmSync(path, { recursive: true });
    // Junctions exercise the same ancestor-link rejection without requiring
    // Windows developer mode or administrator symlink privileges.
    symlinkSync(outside, path, process.platform === "win32" ? "junction" : "dir");
    expect(assessResearch(registry, plan).claims[0]!.status).toBe("needs_reassessment");
    expect(() =>
      registry.readArtifact(record.run_id as string, "../result.json"),
    ).toThrow(/Invalid/);
    expect(() => registry.safePath(join(registry.root, "..", "escape"))).toThrow(
      /leaves/,
    );
  });
  it("bounds follow-up proposals and exposes rationale, conditions, costs and approval", () => {
    const { registry, plan } = setup();
    plan.assumptions[0]!.status = "untested";
    plan.claims = Array.from({ length: 12 }, (_, i) => ({
      ...plan.claims[0]!,
      id: `claim-${i}`,
    }));
    const next = assessResearch(registry, plan).follow_ups;
    expect(next).toHaveLength(8);
    expect(next[0]).toMatchObject({
      kind: "test_assumption",
      estimated_cost: { wall_time_ms: null, model_calls: 0 },
      required_approval: expect.stringContaining("human authorization"),
    });
    expect(next[0]!.expected_observations).toEqual([
      { id: "S1", metric: "metric", op: ">=", value: 5 },
    ]);
    expect(next[0]!.falsification_conditions).toEqual([
      { id: "F1", metric: "metric", op: "<", value: 0 },
    ]);
  });
  it("identifies a missing control and proposes adding one before claiming support", () => {
    const { registry, definition, plan } = setup({
      variables: { independent: ["condition"], dependent: ["metric"], controls: [] },
    });
    link(registry, plan, run(registry, definition));
    const assessment = assessResearch(registry, plan);
    expect(assessment.claims[0]!.status).toBe("needs_reassessment");
    expect(assessment.follow_ups[0]!.kind).toBe("add_control");
    expect(assessment.follow_ups[0]!.rationale).toContain("No control is registered");
  });
});

describe("interrupted-run recovery", () => {
  it("keeps the interrupted record and requires a fresh execution after explicit recovery", () => {
    const { registry, definition, plan } = setup();
    const spy = vi.spyOn(registry, "writeArtifacts").mockImplementation(() => {
      throw new Error("Injected write interruption");
    });
    expect(() => run(registry, definition)).toThrow(/interruption/);
    spy.mockRestore();
    const id = "V3D-EXP-0001-RUN-0001";
    const { record, runDir } = registry.resolveRun(id);
    expect(record.status).toBe("running");
    expect(() =>
      registry.recoverInterruptedRun(id, {
        operator: "R.A.I.N.Test",
        reviewed: true,
        record_sha256: "f".repeat(64),
      }),
    ).toThrow(/review/);
    const recovered = registry.recoverInterruptedRun(id, {
      operator: "R.A.I.N.Test",
      reviewed: true,
      record_sha256: sha256Json(record),
    });
    expect(recovered).toMatchObject({
      status: "error",
      hypothesis_verdict: "not_evaluated",
      evaluation: null,
    });
    expect(JSON.parse(readFileSync(join(runDir, "interrupted.json"), "utf8"))).toEqual(
      record,
    );
    expect(() =>
      registry.recoverInterruptedRun(id, {
        operator: "R.A.I.N.Test",
        reviewed: true,
        record_sha256: sha256Json(recovered),
      }),
    ).toThrow(/Only a running/);
    // A new execution, not an invented resumed result; old allocation remains.
    const next = run(registry, definition, 11);
    expect(next.run_id).toBe("V3D-EXP-0001-RUN-0002");
    link(registry, plan, recovered);
    link(registry, plan, next);
    expect(assessResearch(registry, plan).claims[0]!.supporting_runs).toEqual([
      next.run_id,
    ]);
  });
  it("ignores an unpublished temporary research revision and preserves the committed branch", () => {
    const { registry, plan } = setup();
    save(registry, plan, 0);
    const dir = join(registry.root, "research");
    writeFileSync(join(dir, "REV-000002.json.123.tmp"), "{partial");
    expect(new Registry(registry.root).researchHistory()).toHaveLength(1);
    plan.based_on = 1;
    save(registry, plan, 1);
    expect(registry.researchHistory()).toHaveLength(2);
    expect(readdirSync(dir).filter((p) => p.endsWith(".json"))).toHaveLength(2);
    mkdirSync(join(dir, "unrelated"));
  });
});
