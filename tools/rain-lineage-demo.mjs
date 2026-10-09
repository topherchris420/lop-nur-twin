#!/usr/bin/env node
/** Fixed, bounded, offline validation experiment; no model, network or live city. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import "../scripts/ts-hooks.mjs";

const args = process.argv.slice(2);
if (!args.includes("--approve-demo") || args.indexOf("--out") < 0) {
  console.error(
    "usage: node tools/rain-lineage-demo.mjs --approve-demo --out NEW_DIRECTORY\nRuns three fixed matched-seed Bethesda designs and one injected execution failure; replays completed runs; demonstrates assumption invalidation. At most 60,000 direct simulation/replay ticks plus three assessments bounded to 60,000 replay ticks each, and 120 seconds overall. No model calls.",
  );
  process.exit(2);
}
const out = resolve(args[args.indexOf("--out") + 1]);
mkdirSync(out); // refuse an existing output directory; never overwrite a study
const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
globalThis.__LAB_REVISION__ = {
  commit: git(["rev-parse", "HEAD"]),
  dirty: !!git(["status", "--porcelain"]),
  source: "git",
};
const { Registry } = await import("../src/rain/experiments/registry.ts");
const { recordSubmission, recordedBy } =
  await import("../src/rain/experiments/runner.ts");
const { assessResearch, bindResearchRun } =
  await import("../src/rain/experiments/research.ts");
const { sha256Json } = await import("../src/rain/experiments/schema.ts");
const { verify } = await import("../src/rain/experiments/verify.ts");
const cases = await import("../src/bethesda/rain/cases.ts");
const { runExperiment } = await import("../src/bethesda/rain/runner.ts");
const { verifyRecord } = await import("../src/bethesda/rain/replay.ts");
const { runArtifactText, runArtifactSha256 } =
  await import("../src/bethesda/rain/record.ts");
const { rainDefinitionDraft, rainSubmission, runArtifactName } =
  await import("../src/bethesda/rain/submission.ts");
const demo = JSON.parse(
  readFileSync(
    new URL("../src/bethesda/rain/fixtures/demo-proposal.json", import.meta.url),
    "utf8",
  ),
);
const registry = new Registry(join(out, "registry"));
const operator = "R.A.I.N.Validation";
const origin = { rain: null, rainSource: "unavailable", model: null };
const watching = {
  ...demo,
  origin: "human",
  meeting_id: null,
  primary_metric: "watching",
  minimum_effect: 5,
  question:
    "Does a Metro closure increase watching or recording within 300 m under the simulator's rules?",
  hypothesis:
    "Closing the Metro increases the mean count of people watching or recording within 300 m by at least 5, with a positive change on every registered seed.",
};
const designs = [
  ["watching", { ...watching, proposal_id: "lineage-watching" }],
  [
    "replication",
    { ...watching, proposal_id: "lineage-replication", seeds: [404, 505, 606] },
  ],
  [
    "dispersion",
    { ...demo, origin: "human", meeting_id: null, proposal_id: "lineage-dispersion" },
  ],
  [
    "execution-failure",
    { ...watching, proposal_id: "lineage-execution-failure", seeds: [707] },
  ],
];
const prepared = designs.map(([name, proposal]) => {
  const c = cases.openCase(proposal, { id: name, now: new Date(), origin });
  if (!c.validated) throw new Error(`Invalid demo design: ${name}`);
  const v = c.validated;
  const draft = rainDefinitionDraft(
    v.definition,
    v.experimentId,
    v.definitionSha256,
    operator,
  );
  // Explicitly opt in before the run; default/browser policies stay hash-only.
  draft.data_policy.store_artifacts = true;
  const definition = registry.create(draft);
  c.preregistration = {
    schema: "rain-bethesda/v2",
    kind: "preregistration",
    request_id: sha256Json(definition).slice(0, 32),
    experiment_id: definition.experiment_id,
    experiment_version: definition.experiment_version,
    definition_sha256: sha256Json(definition),
    created_at: definition.created_at,
    registry: "configured",
  };
  return { name, c, v, definition };
});
const plan = {
  schema: "rain-research-lineage/v1",
  branch: "main",
  based_on: null,
  assumptions: [
    {
      id: "metric-scope",
      statement:
        "Watching/recording counts operationalize attention in this simulator; they do not measure coordination or real-world crowd behavior.",
      status: "accepted",
    },
  ],
  claims: prepared.map(({ name, definition }) => ({
    id: name,
    experiment: { id: definition.experiment_id, sha256: sha256Json(definition) },
    runs: [],
    assumptions: name === "watching" ? ["metric-scope"] : [],
    depends_on: name === "replication" ? ["watching"] : [],
  })),
};
const review = (p) => ({
  origin: "human",
  operator,
  reviewed: true,
  plan_sha256: sha256Json(p),
});
const registered = registry.saveResearch(plan, 0, review(plan));
assert(
  registered.assessment.claims.every((c) =>
    ["untested", "needs_reassessment"].includes(c.status),
  ),
);
const deadline = performance.now() + 120_000;
const drive = (steps) => {
  for (;;) {
    if (performance.now() > deadline)
      throw new Error("Validation exceeded its 120 second budget");
    const next = steps.next();
    if (next.done) return next.value;
  }
};
const results = [];
for (const { name, c, v, definition } of prepared) {
  cases.approve(c, {
    operator,
    reviewed: true,
    typedPrefix: v.definitionSha256.slice(0, 8),
    now: new Date(),
  });
  assert.deepEqual(cases.begin(c, new Date()), []);
  const started = new Date();
  const record =
    name === "execution-failure"
      ? cases.fail(
          c,
          new Error(
            "Injected worker interruption for validation; no measurements produced",
          ),
          new Date(),
        )
      : cases.complete(
          c,
          drive(
            runExperiment(
              v.definition,
              v.definitionSha256,
              v.experimentId,
              c.authorization,
            ),
          ),
          { started, finished: new Date() },
        );
  const replay = drive(verifyRecord(record));
  assert.equal(replay.ok, true, JSON.stringify(replay.checks.filter((x) => !x.ok)));
  const s = rainSubmission(record, {
    experimentId: definition.experiment_id,
    experimentVersion: 1,
  });
  if (!s.ok) throw new Error(s.errors.join("; "));
  const result = recordSubmission(registry, definition.experiment_id, s.value, {
    recordedBy: recordedBy(process.cwd(), registry),
    artifacts: { [runArtifactName(record)]: runArtifactText(record) },
  });
  plan.claims
    .find((c) => c.id === name)
    .runs.push(bindResearchRun(registry, result.run_id));
  results.push({
    name,
    experiment_id: result.experiment_id,
    run_id: result.run_id,
    seeds: v.definition.seeds,
    status: result.status,
    verdict: result.hypothesis_verdict,
    primary_metric: v.definition.primary_metric,
    measurements: result.measurements,
    per_seed: record.run?.per_seed ?? [],
    replay_verified: replay.ok,
    replay_checks: replay.checks.length,
    artifact_sha256: runArtifactSha256(record),
    injected_failure: name === "execution-failure",
  });
  console.log(
    `${name}: ${result.status}/${result.hypothesis_verdict}; primary_delta_mean=${result.measurements.primary_delta_mean ?? "not measured"}; replay=${replay.ok}`,
  );
}
assert.equal(results.find((r) => r.name === "watching").verdict, "supported");
assert.equal(results.find((r) => r.name === "dispersion").verdict, "not_supported");
assert.equal(
  results.find((r) => r.name === "execution-failure").verdict,
  "not_evaluated",
);
plan.based_on = 1;
const evaluated = registry.saveResearch(plan, 1, review(plan));
assert.equal(
  evaluated.assessment.claims.find((c) => c.id === "watching").status,
  "supported",
);
const originalBytes = readFileSync(
  join(registry.root, "research", "REV-000002.json"),
  "utf8",
);
const revised = structuredClone(plan);
revised.branch = "scope-review";
revised.based_on = 2;
// This is an injected integrity exercise, not a measured scientific contradiction.
revised.assumptions[0].status = "invalidated";
const reassessed = registry.saveResearch(revised, 2, review(revised));
for (const id of ["watching", "replication"])
  assert.equal(
    reassessed.assessment.claims.find((c) => c.id === id).status,
    "needs_reassessment",
  );
assert.equal(
  readFileSync(join(registry.root, "research", "REV-000002.json"), "utf8"),
  originalBytes,
);
const scratch = mkdtempSync(join(tmpdir(), "rain-missing-artifact-"));
let missingArtifactDetected = false;
try {
  cpSync(registry.root, join(scratch, "registry"), { recursive: true });
  const copy = new Registry(join(scratch, "registry"));
  const first = results[0];
  const { runDir, record } = copy.resolveRun(first.run_id);
  unlinkSync(join(runDir, "artifacts", record.artifacts[0].name));
  missingArtifactDetected =
    assessResearch(copy, plan).claims.find((c) => c.id === "watching").status ===
    "needs_reassessment";
  assert(missingArtifactDetected);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
const integrity = verify(registry);
assert.equal(integrity.valid, true, JSON.stringify(integrity));
assert(performance.now() <= deadline, "Validation exceeded its 120 second budget");
const report = {
  schema: "rain-lineage-demonstration/v1",
  created_at: new Date().toISOString(),
  source: globalThis.__LAB_REVISION__,
  environment: recordedBy(process.cwd(), registry).environment,
  results,
  integrity,
  before: registered.assessment,
  evaluated: evaluated.assessment,
  reassessed: reassessed.assessment,
  validation: {
    preregistered_before_execution: true,
    original_results_preserved: true,
    missing_artifact_detected: missingArtifactDetected,
    injected_assumption_invalidation: true,
    no_model_calls: true,
  },
  limitations: [
    "Simulation results describe this code, not real Bethesda.",
    "Three seeds per completed design are descriptive; no confidence probability is estimated.",
    "The assumption invalidation and execution interruption are deliberately injected validation cases.",
    "Replay of the same seeds establishes deterministic reproducibility, not independent replication.",
  ],
};
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
});
writeFileSync(join(out, "plan.json"), JSON.stringify(plan, null, 2) + "\n", {
  flag: "wx",
});
console.log(`Lineage validation passed. Report: ${join(out, "report.json")}`);
