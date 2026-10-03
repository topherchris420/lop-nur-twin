#!/usr/bin/env node
/**
 * Cross-repository conformance for the R.A.I.N. Lab.
 *
 * Runs real lab experiments in-process — one that the simulator supports, one
 * it contradicts, one whose result falls between the thresholds, and one
 * whose execution fails — exports each record with its admission bundle, and
 * hands both to `tools/rain-bridge/conformance.py`, which runs james_library's
 * own schema validators, evaluator and registry over them.
 *
 *   RAIN_LIBRARY_PATH=../james_library node tools/rain-conformance.mjs
 *
 * Without a james_library checkout there is nothing to conform to: the tool
 * says SKIPPED and exits 0. It never fetches anything and calls no model.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import "../scripts/ts-hooks.mjs";

const library = process.env.RAIN_LIBRARY_PATH;
if (!library) {
  console.log(
    "rain-conformance: SKIPPED — set RAIN_LIBRARY_PATH to a james_library checkout",
  );
  process.exit(0);
}
// A submission names the producing commit; read the checkout's real one.
const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
globalThis.__LAB_REVISION__ = {
  commit: git(["rev-parse", "HEAD"]),
  dirty: git(["status", "--porcelain", "--untracked-files=no"]).length > 0,
  source: "git",
};
const { readFileSync } = await import("node:fs");
const cases = await import("../src/bethesda/rain/cases.ts");
const { runToCompletion } = await import("../src/bethesda/rain/runner.ts");
const { admissionBundle } = await import("../src/bethesda/rain/submission.ts");
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
const out = "shots/rain-conformance";
mkdirSync(out, { recursive: true });
const origin = { rain: null, rainSource: "unavailable", model: null };
let failed = false;
const conform = (name, record) => {
  const bundle = admissionBundle(record, "R.A.I.N.Operator");
  if (!bundle.ok) {
    console.log(`FAIL ${name}: no admission bundle — ${bundle.errors.join("; ")}`);
    failed = true;
    return;
  }
  const recordPath = join(out, `${name}.record.json`),
    bundlePath = join(out, `${name}.bundle.json`);
  writeFileSync(recordPath, JSON.stringify(record));
  writeFileSync(bundlePath, JSON.stringify(bundle.value));
  console.log(`— ${name}: lab says ${record.outcome.state} · ${record.outcome.verdict}`);
  const result = spawnSync(
    "python3",
    [
      "tools/rain-bridge/conformance.py",
      "--library",
      library,
      "--record",
      recordPath,
      "--bundle",
      bundlePath,
      "--admit",
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) failed = true;
};
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
  conform(name, cases.complete(c, result, { started, finished: new Date() }));
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
console.log(failed ? "rain-conformance: FAILED" : "rain-conformance: ok");
process.exit(failed ? 1 : 0);
