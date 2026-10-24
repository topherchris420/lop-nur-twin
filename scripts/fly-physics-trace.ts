/**
 * Writes the digital fly's walking plans for the FlyBody physics backend
 * (fly-physics/): one `fly-physics-trace/v1` file per scenario.
 *
 *   node scripts/run-ts.mjs scripts/fly-physics-trace.ts [--out <dir>] [--scenario <id>]
 *   node scripts/run-ts.mjs scripts/fly-physics-trace.ts --check [--out <dir>]
 *
 * `--out` defaults to `.fly-physics/traces` (ignored by git: the traces are
 * derived from committed code and can always be written again). `--check`
 * writes nothing: it rebuilds each trace and fails unless the file on disk
 * holds exactly those bytes. Traces made on another JavaScript engine name it
 * and may differ in the last digits; check them on the engine that made them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PHYSICS_SCENARIOS, planTrace, traceText } from "./fly-physics-plan.js";

const args = process.argv.slice(2);
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
const out = resolve(value("--out") ?? ".fly-physics/traces");
const only = value("--scenario");
const check = args.includes("--check");
const scenarios = only
  ? PHYSICS_SCENARIOS.filter((s) => s.id === only)
  : PHYSICS_SCENARIOS;
if (!scenarios.length) {
  console.error(
    `no scenario ${only}; the scenarios are ${PHYSICS_SCENARIOS.map((s) => s.id).join(", ")}`,
  );
  process.exit(2);
}
if (!check) mkdirSync(out, { recursive: true });
let failed = 0;
for (const scenario of scenarios) {
  const text = traceText(planTrace(scenario));
  const path = join(out, `${scenario.id}.json`);
  if (check) {
    const same = existsSync(path) && readFileSync(path, "utf8") === text;
    if (!same) failed++;
    console.log(`${same ? "same" : "DIFFERENT"}  ${path}`);
  } else {
    writeFileSync(path, text);
    console.log(`wrote ${path} (${(text.length / 1024).toFixed(0)} KB)`);
  }
}
if (failed) {
  console.error(`${failed} trace(s) differ from what this code writes`);
  process.exit(1);
}
