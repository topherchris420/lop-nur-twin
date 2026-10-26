/**
 * Study C, the digital fly's mushroom body (src/bethesda/life/mushroomBodyStudy.ts).
 *
 *   node scripts/run-ts.mjs scripts/mushroom-body-evaluate.ts          run it, write docs/benchmarks/fly-mushroom-body/
 *   node scripts/run-ts.mjs scripts/mushroom-body-evaluate.ts --check  exit 1 unless a fresh run reproduces it
 *
 * Seeded, so a run reproduces byte for byte. Run it from a clean commit and
 * commit what it writes; a report written from a working tree says so and is
 * not a result. Never edit the folder by hand.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import {
  mushroomBodyReport,
  renderMushroomBodyReadme,
} from "../src/bethesda/life/mushroomBodyStudy.js";

const root = process.cwd();
const dir = join(root, "docs/benchmarks/fly-mushroom-body");
const check = process.argv.includes("--check");
const log = (line: string) => console.log(`[mushroom-body] ${line}`);

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
      console.error(`[mushroom-body] ${name} does not reproduce`);
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

const t0 = performance.now();
const report = mushroomBodyReport(log);
// The commit the report says it ran from: the one --check compares against keeps its own.
const commit = check
  ? (/from (`[0-9a-f]{7,40}`|a working tree)/.exec(
      readFileSync(join(dir, "README.md"), "utf8"),
    )?.[1] ?? "")
  : execSync("git status --porcelain", { cwd: root, encoding: "utf8" }).trim()
    ? "a working tree"
    : `\`${execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim()}\``;
const ok =
  (await emit("report.json", JSON.stringify(report))) &&
  (await emit("README.md", renderMushroomBodyReadme(report, commit)));
log(`${((performance.now() - t0) / 1000).toFixed(0)} s`);
if (!ok) process.exit(1);
