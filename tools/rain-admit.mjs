#!/usr/bin/env node
/**
 * Admit a Bethesda lab run into a R.A.I.N. experiment registry, offline.
 *
 * When the lab ran OFFLINE it exports an admission bundle
 * (`rain-bethesda-admission-bundle/v1`): a `create --from` draft and a
 * submission whose `experiment_id` the registry has not assigned yet. This
 * does, in-process, what the LIVE route does at run time:
 *
 * 1. `Registry.create(draft)` — the registry validates and pre-registers the
 *    experiment and assigns `V3D-EXP-NNNN`;
 * 2. sets that id in the submission;
 * 3. `recordSubmission` — the submission is validated against the schema and
 *    the pre-registered criteria are evaluated by the registry, never by the
 *    producer.
 *
 * Registration here happens *after* the run, and the submission already says
 * so in its limitations. Nothing the bundle references is opened or fetched.
 *
 *   node tools/rain-admit.mjs bundle.json --registry /path/to/registry [--json]
 */
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../scripts/ts-hooks.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const bundlePath = args.find(
  (a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--registry",
);
const registryDir = flag("--registry");
if (!bundlePath || !registryDir) {
  console.error("usage: node tools/rain-admit.mjs bundle.json --registry DIR [--json]");
  process.exit(2);
}
// One descriptor: the file measured is the file read.
const fd = openSync(bundlePath, "r");
let raw;
try {
  if (fstatSync(fd).size > 4 * 1024 * 1024) {
    console.error("bundle exceeds 4 MB");
    process.exit(2);
  }
  raw = readFileSync(fd, "utf8");
} finally {
  closeSync(fd);
}
const bundle = JSON.parse(raw);
if (
  !bundle ||
  typeof bundle !== "object" ||
  bundle.schema !== "rain-bethesda-admission-bundle/v1" ||
  !bundle.draft ||
  !bundle.submission
) {
  console.error("not a rain-bethesda-admission-bundle/v1 file");
  process.exit(2);
}
const { Registry } = await import("../src/rain/experiments/registry.ts");
const { recordSubmission, recordedBy } =
  await import("../src/rain/experiments/runner.ts");
const registry = new Registry(resolve(registryDir));
const definition = registry.create(bundle.draft);
const submission = { ...bundle.submission, experiment_id: definition.experiment_id };
const record = recordSubmission(registry, definition.experiment_id, submission, {
  recordedBy: recordedBy(process.cwd(), registry),
});
if (args.includes("--json")) console.log(JSON.stringify(record, null, 2));
else {
  console.log(`${record.run_id}: ${record.status} (${record.hypothesis_verdict})`);
  console.log(record.interpretation.deterministic);
}
