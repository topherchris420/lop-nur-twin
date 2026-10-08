#!/usr/bin/env node
/**
 * Conformance between the lab and the research runtime's registry.
 *
 * Runs real lab experiments in-process — one that the simulator supports, one
 * it contradicts, one whose result falls between the thresholds, and one
 * whose execution fails — exports each record with its admission bundle, and
 * puts both through the runtime's own schema validators, evaluator and
 * registry (`src/rain/experiments/`), the code the LIVE route runs:
 *
 * - `definitionErrors` on the pre-registration draft, completed with the
 *   fields the registry assigns;
 * - `submissionErrors` on the submission;
 * - `evaluate` on the submission's measurements, compared field by field with
 *   the lab's own `rain-criteria/v1` evaluation — the two must reach the same
 *   status, verdict and criterion results;
 * - the run artifact digest, recomputed from the record the way the registry
 *   hashes JSON, against the digest the submission reports;
 * - a real `Registry.create` + `recordSubmission` in a temporary registry,
 *   whose run status must match the lab's.
 *
 * One more experiment cites mathematics: the DEMO's proposal with a
 * mathematical basis built from the runtime's own substrate (an inspected
 * `openai/math` family, cited by a person with stated assumptions). Its draft
 * must carry the basis into the registry's definition, the runtime must
 * pre-register it and refuse the same basis read at another commit, and its
 * result must be the DEMO's exactly: mathematics informs a hypothesis and
 * decides nothing.
 *
 *   node tools/rain-conformance.mjs      (bun run rain:conformance)
 *
 * Exit status is 1 on any disagreement. It never fetches anything and calls
 * no model.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../scripts/ts-hooks.mjs";

// A submission names the producing commit; read the checkout's real one.
const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
globalThis.__LAB_REVISION__ = {
  commit: git(["rev-parse", "HEAD"]),
  dirty: git(["status", "--porcelain", "--untracked-files=no"]).length > 0,
  source: "git",
};
const cases = await import("../src/bethesda/rain/cases.ts");
const { runToCompletion } = await import("../src/bethesda/rain/runner.ts");
const { admissionBundle } = await import("../src/bethesda/rain/submission.ts");
const { definitionErrors, submissionErrors } =
  await import("../src/rain/experiments/schema.ts");
const { evaluate } = await import("../src/rain/experiments/evaluate.ts");
const { Registry } = await import("../src/rain/experiments/registry.ts");
const { recordSubmission, recordedBy } =
  await import("../src/rain/experiments/runner.ts");
const { sha256Json } = await import("../src/rain/sha256.ts");
const { bundledIndex } = await import("../src/rain/mathematics/bundled.ts");
const { MathematicalSubstrate } = await import("../src/rain/mathematics/substrate.ts");
const { validateMathRecord } = await import("../src/bethesda/rain/mathValidation.ts");
const { basisEntryFrom } = await import("../src/bethesda/rain/mathematics.ts");
const { rainDefinitionDraft } = await import("../src/bethesda/rain/submission.ts");
const { configureRuntime } = await import("../src/rain/runtime.ts");

const demo = JSON.parse(
  readFileSync(
    new URL("../src/bethesda/rain/fixtures/demo-proposal.json", import.meta.url),
  ),
);
const variants = [
  ["not-supported", demo],
  [
    "supported",
    {
      ...demo,
      proposal_id: "conformance-watching",
      hypothesis: "Closing the Metro draws onlookers: watching rises by at least 5.",
      primary_metric: "watching",
      minimum_effect: 5,
    },
  ],
  [
    "inconclusive",
    {
      ...demo,
      proposal_id: "conformance-threshold",
      hypothesis: "Closing the Metro draws at least 60 more onlookers.",
      primary_metric: "watching",
      minimum_effect: 60,
    },
  ],
];
// The basis is built the way the lab builds it: from an inspected family, as
// the runtime's substrate answers, validated, then cited by a person.
const substrate = MathematicalSubstrate.load(bundledIndex());
const REQ = "c".repeat(32);
const inspected = validateMathRecord(
  JSON.parse(JSON.stringify(substrate.inspectMathematicalResult({ family: "237" }, REQ))),
  { requestId: REQ, family: "237" },
);
if (!inspected.ok) throw new Error(inspected.errors.join("; "));
const cited = basisEntryFrom(inspected.value, {
  manuscriptPath: null,
  reasoningSummary: false,
  relation: "suggests_hypothesis",
  assumptions: [
    "A pedestrian leaving the entrance takes one sidewalk segment per step, as a walk on the street graph.",
  ],
  rationale:
    "Walk exponents suggest how far a dispersing cohort travels in a window; the simulator's rules decide whether it does.",
  assessedBy: "person",
});
if (!cited.ok) throw new Error(cited.errors.join("; "));
variants.push([
  "mathematical-basis",
  { ...demo, proposal_id: "conformance-mathematics", mathematical_basis: [cited.value] },
]);
const out = "shots/rain-conformance";
mkdirSync(out, { recursive: true });
const origin = { rain: null, rainSource: "unavailable", model: null };
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures.push(name);
};
const sorted = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );

const conform = (name, record) => {
  const bundle = admissionBundle(record, "R.A.I.N.Operator");
  if (!bundle.ok) {
    check(`${name}: admission bundle`, false, bundle.errors.join("; "));
    return;
  }
  writeFileSync(join(out, `${name}.record.json`), JSON.stringify(record));
  writeFileSync(join(out, `${name}.bundle.json`), JSON.stringify(bundle.value));
  console.log(`— ${name}: lab says ${record.outcome.state} · ${record.outcome.verdict}`);
  const { draft, submission: reported } = bundle.value;
  const definition = {
    schema_version: "rain-experiment/v1",
    experiment_id: "V3D-EXP-9999",
    experiment_version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    ...draft,
  };
  let errors = definitionErrors(definition);
  check(
    `${name}: draft is a valid rain-experiment/v1 definition`,
    !errors.length,
    errors.slice(0, 5).join("; "),
  );
  const submission = { ...reported, experiment_id: "V3D-EXP-9999" };
  errors = submissionErrors(submission);
  check(
    `${name}: submission is a valid rain-experiment-submission/v1`,
    !errors.length,
    errors.slice(0, 5).join("; "),
  );
  check(
    `${name}: submission carries no status or verdict`,
    !["status", "verdict", "hypothesis_verdict"].some((k) => k in submission),
  );
  const run = record.run ?? null;
  const expectedStatus = record.error ? "error" : run?.status;
  if (record.error) {
    check(
      `${name}: a failed execution is reported as an error, not a result`,
      "error" in submission && !run,
      "the hypothesis is not evaluated",
    );
  } else {
    const result = evaluate(definition.criteria, submission.measurements);
    check(
      `${name}: the registry's evaluate() reaches the lab's status`,
      result.status === run.status,
      `registry ${result.status}, lab ${run.status}`,
    );
    check(
      `${name}: the registry's evaluate() reaches the lab's verdict`,
      result.verdict === run.verdict,
      `registry ${result.verdict}, lab ${run.verdict}`,
    );
    check(
      `${name}: criterion-by-criterion evaluation is identical`,
      sorted(result.evaluation) === sorted(run.evaluation),
    );
  }
  const body = Object.fromEntries(
    Object.entries(record).filter(
      ([k]) => k !== "rain_admission" && k !== "record_sha256",
    ),
  );
  const digest = sha256Json(body);
  const declared = submission.artifacts?.[0]?.sha256 ?? null;
  check(
    `${name}: run artifact digest recomputes from the record`,
    digest === declared,
    `recomputed ${digest.slice(0, 16)}…, submission ${String(declared).slice(0, 16)}…`,
  );
  const scratch = mkdtempSync(join(tmpdir(), "rain-conformance-"));
  try {
    const registry = new Registry(scratch);
    const created = registry.create(draft);
    const admitted = recordSubmission(
      registry,
      created.experiment_id,
      { ...reported, experiment_id: created.experiment_id },
      { recordedBy: recordedBy(process.cwd(), registry) },
    );
    check(
      `${name}: the registry admits the run with the lab's status`,
      admitted.status === expectedStatus,
      `${admitted.run_id}: ${admitted.status} — ${admitted.interpretation.deterministic.slice(0, 120)}`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

const recorded = new Map();
for (const [name, proposal] of variants) {
  const c = cases.openCase(proposal, { id: name, now: new Date(), origin });
  const v = c.validated;
  cases.approve(c, {
    operator: "R.A.I.N.Operator",
    typedPrefix: v.definitionSha256.slice(0, 8),
    reviewed: true,
    now: new Date(),
  });
  const refused = cases.begin(c, new Date());
  if (refused.length) throw new Error(refused.join("; "));
  const started = new Date();
  const result = runToCompletion(
    v.definition,
    v.definitionSha256,
    v.experimentId,
    c.authorization,
  );
  const record = cases.complete(c, result, { started, finished: new Date() });
  recorded.set(name, record);
  conform(name, record);
}
{
  const record = recorded.get("mathematical-basis");
  const plain = recorded.get("not-supported");
  const basis = record.definition.mathematical_basis;
  check(
    "mathematical-basis: the sealed definition carries the basis as cited",
    sorted(basis) === sorted([cited.value]),
  );
  check(
    "mathematical-basis: the result is the DEMO's exactly; mathematics decides nothing",
    sorted(record.run.measurements) === sorted(plain.run.measurements) &&
      sorted(record.run.evaluation) === sorted(plain.run.evaluation) &&
      record.outcome.verdict === plain.outcome.verdict,
  );
  const draft = rainDefinitionDraft(
    record.definition,
    record.experiment_id,
    record.definition_sha256,
    "R.A.I.N.Operator",
  );
  const scratch = mkdtempSync(join(tmpdir(), "rain-conformance-math-"));
  try {
    const registered = new Registry(scratch).create(draft);
    check(
      "mathematical-basis: the registry's pre-registered definition holds the basis",
      sorted(registered.parameters.mathematical_basis) === sorted(basis),
    );
    const configured = await configureRuntime({
      env: {},
      cwd: process.cwd(),
      scratchDir: () => mkdtempSync(join(scratch, "runtime-")),
    });
    const runtime = configured.runtime;
    const answer = runtime.preregister(draft, REQ);
    check(
      "mathematical-basis: the runtime pre-registers it against its own substrate",
      /^V3D-EXP-/.test(answer.experiment_id),
      answer.experiment_id,
    );
    const moved = structuredClone(draft);
    moved.parameters.mathematical_basis[0].commit = "f".repeat(40);
    let refusal = "";
    try {
      runtime.preregister(moved, REQ);
    } catch (e) {
      refusal = e instanceof Error ? e.message : String(e);
    }
    check(
      "mathematical-basis: the runtime refuses the basis read at another commit",
      /does not match the substrate/.test(refusal),
      refusal.slice(0, 160),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
{
  const c = cases.openCase(demo, { id: "error", now: new Date(), origin });
  cases.approve(c, {
    operator: "R.A.I.N.Operator",
    typedPrefix: c.validated.definitionSha256.slice(0, 8),
    reviewed: true,
    now: new Date(),
  });
  cases.begin(c, new Date());
  conform(
    "execution-error",
    cases.fail(c, new Error("simulated worker loss"), new Date()),
  );
}
console.log(
  failures.length
    ? `rain-conformance: FAILED (${failures.length})`
    : "rain-conformance: ok",
);
process.exit(failures.length ? 1 : 0);
