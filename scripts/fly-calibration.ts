/**
 * The digital fly's calibration against published recordings of real flies
 * (src/bethesda/fly/calibration/).
 *
 *   node scripts/run-ts.mjs scripts/fly-calibration.ts                run every paradigm, write the report
 *   node scripts/run-ts.mjs scripts/fly-calibration.ts --check        exit 1 unless a fresh run reproduces it
 *   node scripts/run-ts.mjs scripts/fly-calibration.ts --fit          refit the circuit models' fitted values
 *   node scripts/run-ts.mjs scripts/fly-calibration.ts --fit --check  exit 1 unless a refit reproduces fit.json
 *
 * Everything is seeded, so a run reproduces byte for byte. The report is
 * docs/benchmarks/fly-calibration/report.json and its README.md; the fit is
 * fit.json beside them, and the fitted values in
 * src/bethesda/fly/circuits/params.ts must be its (a test holds them to it).
 * Rerun both after any change to the fly, its controllers or the paradigms,
 * from a clean commit, and commit what they write; never edit them by hand.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { FLY_VERSION } from "../src/bethesda/fly/fly.js";
import { CIRCUIT_DESCRIPTOR } from "../src/bethesda/fly/circuits/controller.js";
import {
  fitGiantFiber,
  fitGroomDrive,
  GF_FIT_TRIALS,
} from "../src/bethesda/fly/calibration/fit.js";
import {
  calibrationReport,
  renderReadme,
} from "../src/bethesda/fly/calibration/report.js";

const root = process.cwd();
const dir = join(root, "docs/benchmarks/fly-calibration");
const check = process.argv.includes("--check");
const log = (line: string) => console.log(`[fly-calibration] ${line}`);

async function emit(name: string, text: string): Promise<boolean> {
  const path = join(dir, name);
  const formatted = await format(text, {
    ...((await resolveConfig(path)) ?? {}),
    filepath: path,
  });
  let before: string | null = null;
  try {
    before = readFileSync(path, "utf8");
  } catch {
    before = null;
  }
  if (check) {
    if (before !== formatted) {
      console.error(`[fly-calibration] ${name} does not reproduce`);
      return false;
    }
    log(`${name} reproduces`);
    return true;
  }
  mkdirSync(dir, { recursive: true });
  if (before !== formatted) writeFileSync(path, formatted);
  log(`${before === formatted ? "unchanged" : "wrote"} ${name}`);
  return true;
}

if (process.argv.includes("--fit")) {
  const giantFiber = fitGiantFiber(GF_FIT_TRIALS, log);
  const grooming = fitGroomDrive(log);
  const fit = {
    schema: "fly-calibration-fit/v1",
    flyVersion: FLY_VERSION,
    controller: CIRCUIT_DESCRIPTOR.id,
    giantFiber,
    grooming,
  };
  if (!(await emit("fit.json", JSON.stringify(fit)))) process.exit(1);
} else {
  const fit = JSON.parse(readFileSync(join(dir, "fit.json"), "utf8")) as unknown;
  const report = calibrationReport(log);
  const json = JSON.stringify(report);
  // The commit the report says it ran from: the one --check compares against keeps its own.
  const commit = check
    ? (/from ([0-9a-f]{7,40}|a working tree)/.exec(
        readFileSync(join(dir, "README.md"), "utf8"),
      )?.[1] ?? "")
    : execSync("git status --porcelain", { cwd: root, encoding: "utf8" }).trim()
      ? "a working tree"
      : execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim();
  const ok =
    (await emit("report.json", json)) &&
    (await emit("README.md", renderReadme(report, fit, commit)));
  if (!ok) process.exit(1);
}
