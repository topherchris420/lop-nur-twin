/**
 * The ECHO embodied-plasticity study on research flies (src/bethesda/plasticity/).
 * Never touches a store, a VM or an original.
 *
 *   node scripts/run-ts.mjs scripts/echo-plasticity-evaluate.ts run --split dev|heldout --shard I/N --out FILE
 *   node scripts/run-ts.mjs scripts/echo-plasticity-evaluate.ts collect --split dev|heldout FILE...
 *   node scripts/run-ts.mjs scripts/echo-plasticity-evaluate.ts report --split dev|heldout
 *
 * `collect` writes docs/benchmarks/echo-plasticity/<split>/records.jsonl (sorted) and
 * machine.json; `report` writes README.md and summary.json beside them from the
 * records alone. Run from a clean commit; commit the records, then the report.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../src/rain/sha256.js";
import {
  execute,
  runsOf,
  PLAN,
  type RunRecord,
} from "../src/bethesda/plasticity/study.js";
import { render, summarize } from "../src/bethesda/plasticity/analysis.js";

const args = process.argv.slice(
  process.argv.findIndex((a) => a.endsWith("echo-plasticity-evaluate.ts")) + 1,
);
const mode = args[0];
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const split = option("split");
if (split !== "dev" && split !== "heldout") throw new Error("--split dev|heldout");
const folder = join("docs", "benchmarks", "echo-plasticity", split);
const sortKey = (r: RunRecord) =>
  `${r.condition}|${String(r.seed).padStart(8, "0")}|${r.arm}`;

if (mode === "run") {
  const [i, n] = (option("shard") ?? "0/1").split("/").map(Number);
  const out = option("out");
  if (!out || !Number.isInteger(i) || !Number.isInteger(n) || i! < 0 || i! >= n!)
    throw new Error("run needs --shard I/N and --out FILE");
  const runs = runsOf(split).filter((_, k) => k % n! === i);
  const started = Date.now();
  runs.forEach((run, k) => {
    const r = execute(split, run);
    appendFileSync(out, `${canonicalJson(r)}\n`);
    process.stderr.write(
      `[${Math.round((Date.now() - started) / 1000)} s] ${k + 1}/${runs.length} ${run.condition} ${run.seed} ${run.arm}: meals ${r.meals}\n`,
    );
  });
} else if (mode === "collect") {
  const files = args
    .slice(1)
    .filter((a, k, all) => !a.startsWith("--") && all[k - 1] !== "--split");
  const records = files.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as RunRecord),
  );
  const expected = runsOf(split).length;
  if (records.length !== expected)
    throw new Error(`expected ${expected} records for ${split}, have ${records.length}`);
  records.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "records.jsonl"),
    records.map((r) => canonicalJson(r)).join("\n") + "\n",
  );
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "scripts"], {
    encoding: "utf8",
  }).trim();
  writeFileSync(
    join(folder, "machine.json"),
    JSON.stringify(
      {
        commit,
        cleanSources: dirty === "",
        platform: platform(),
        arch: arch(),
        node: process.version,
        plan: PLAN,
      },
      null,
      2,
    ) + "\n",
  );
} else if (mode === "report") {
  const records = readFileSync(join(folder, "records.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RunRecord);
  const machine = JSON.parse(readFileSync(join(folder, "machine.json"), "utf8")) as {
    commit: string;
    platform: string;
    arch: string;
    node: string;
    cleanSources: boolean;
  };
  const summary = summarize(records, split);
  writeFileSync(join(folder, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(
    join(folder, "README.md"),
    render(summary, {
      commit: `${machine.commit}${machine.cleanSources ? "" : " (sources not clean)"}`,
      platform: `${machine.platform} ${machine.arch}, Node ${machine.node}`,
    }),
  );
} else {
  throw new Error("mode is run, collect or report");
}
