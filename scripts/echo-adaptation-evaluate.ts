/**
 * The adaptation-and-continuity benchmarks (src/bethesda/adaptation/).
 *
 *   run --split dev --release baseline [--from 0 --to 23] --out FILE
 *       live research individuals and append one record per line to FILE.
 *       Refuses a dirty working tree unless --dirty (whose records say so).
 *   collect --split dev --release baseline PART...
 *       merge part files into docs/benchmarks/echo-adaptation/records/, checked complete.
 *   originals --responses FILE... --ledger-ref REF
 *       snapshot the originals' recorded responses (first-contact recorder
 *       format, or its fixture file) and the ledger branch's two files at REF.
 *   report [--check]
 *       write README.md and summary.json from the records and snapshots;
 *       --check exits 1 unless they reproduce byte for byte.
 *
 * Research flies are seeded; their records reproduce on the platform that
 * made them (each record says which). The report is arithmetic on records and
 * reproduces anywhere. Never edit docs/benchmarks/echo-adaptation/ by hand.
 */
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { checkRecords } from "../src/bethesda/adaptation/analysis.js";
import { INDIVIDUALS, SPLITS } from "../src/bethesda/adaptation/benchmarks.js";
import type { RecordedResponse } from "../src/bethesda/adaptation/originals.js";
import {
  buildReport,
  publishedCommit,
  readJsonl,
  RESULTS_DIR,
  type MadeRecord,
} from "../src/bethesda/adaptation/publish.js";
import { RELEASES } from "../src/bethesda/adaptation/releases.js";
import { renderReadme } from "../src/bethesda/adaptation/report.js";
import { runIndividual } from "../src/bethesda/adaptation/study.js";

const root = process.cwd();
const DIR = join(root, RESULTS_DIR);
const RECORDS = join(DIR, "records");
const ORIGINALS = join(DIR, "originals");
// After this script's own path: `node scripts/run-ts.mjs <this> …` and `bun <this> …` alike.
const args = process.argv.slice(
  process.argv.findIndex((a) => a.endsWith("echo-adaptation-evaluate.ts")) + 1,
);
const command = args[0];
const flag = (name: string) => args.includes(name);
const value = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
/** Arguments that are neither a flag nor a flag's value. */
const WITH_VALUE = new Set([
  "--split",
  "--release",
  "--out",
  "--from",
  "--to",
  "--ledger-ref",
]);
function positional(): string[] {
  const out: string[] = [];
  for (let i = 1; i < args.length; i++) {
    if (WITH_VALUE.has(args[i]!)) i++;
    else if (!args[i]!.startsWith("--")) out.push(args[i]!);
  }
  return out;
}
const log = (line: string) => console.log(`[echo-adaptation] ${line}`);
const git = (...a: string[]) =>
  execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();

function run(): void {
  const split = SPLITS[value("--split") as keyof typeof SPLITS];
  const reg = RELEASES[value("--release") ?? ""];
  const out = value("--out");
  if (!split || !reg || !out)
    throw new Error("run needs --split dev|heldout, --release NAME and --out FILE");
  const from = Number(value("--from") ?? 0),
    to = Number(value("--to") ?? INDIVIDUALS - 1);
  const dirty = git("status", "--porcelain") !== "";
  if (dirty && !flag("--dirty"))
    throw new Error("the working tree is dirty: commit first, or pass --dirty");
  const commit = dirty ? "a working tree" : git("rev-parse", "HEAD");
  for (let k = from; k <= to; k++) {
    const t0 = performance.now();
    const record = runIndividual({
      split,
      k,
      release: reg.release,
      kind: reg.kind,
      continueFrom: reg.updates?.continueFrom,
    });
    const made: MadeRecord = {
      ...record,
      made: { commit, node: process.version, platform: platform(), arch: arch() },
    };
    appendFileSync(out, JSON.stringify(made) + "\n");
    log(
      `${split.name} ${reg.release.name} #${k}: ${((performance.now() - t0) / 1000).toFixed(0)} s`,
    );
  }
}

function collect(): void {
  const split = value("--split"),
    release = value("--release");
  const parts = positional();
  const records = parts
    .flatMap((p) => readJsonl<MadeRecord>(p))
    .sort((a, b) => a.k - b.k);
  const errors = checkRecords(records, INDIVIDUALS);
  if (records.some((r) => r.split !== split || r.release !== release))
    errors.push("a part holds another split or release");
  if (new Set(records.map((r) => r.made.commit)).size !== 1)
    errors.push("records from more than one commit");
  if (errors.length) throw new Error(errors.join("; "));
  mkdirSync(RECORDS, { recursive: true });
  const path = join(RECORDS, `${split}-${release}.jsonl`);
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  log(`wrote ${path}: ${records.length} individuals`);
}

function originals(): void {
  const ref = value("--ledger-ref");
  const files = positional();
  if (!ref || !files.length)
    throw new Error("originals needs --ledger-ref REF and at least one responses file");
  const responses: RecordedResponse[] = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    // The first-contact fixture is one JSON document; the recorder writes JSON lines.
    let rows: Record<string, unknown>[];
    try {
      rows = (JSON.parse(text) as { responses: Record<string, unknown>[] }).responses;
    } catch {
      rows = readJsonl<Record<string, unknown>>(f);
    }
    for (const r of rows)
      responses.push({
        receivedUtc: String(r.receivedUtc),
        stream: r.stream as RecordedResponse["stream"],
        status: Number(r.status),
        body: String(r.body ?? r.text ?? ""),
      });
  }
  responses.sort((a, b) => Date.parse(a.receivedUtc) - Date.parse(b.receivedUtc));
  const sha = git("rev-parse", ref);
  mkdirSync(ORIGINALS, { recursive: true });
  writeFileSync(
    join(ORIGINALS, "responses.jsonl"),
    responses.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  writeFileSync(
    join(ORIGINALS, "ledger.jsonl"),
    git("show", `${sha}:ledger.jsonl`) + "\n",
  );
  writeFileSync(
    join(ORIGINALS, "replays.jsonl"),
    git("show", `${sha}:replays.jsonl`) + "\n",
  );
  const sessions = [...new Set(responses.map((r) => r.receivedUtc.slice(0, 10)))];
  writeFileSync(
    join(ORIGINALS, "provenance.json"),
    JSON.stringify(
      {
        responses: `${responses.length} responses recorded read-only by scripts/first-contact-observe.ts (GET only) on ${sessions.join(" and ")}`,
        ledger: `ledger.jsonl and replays.jsonl from the live-fly-ledger branch at ${sha}`,
      },
      null,
      2,
    ) + "\n",
  );
  log(`snapshotted ${responses.length} responses and the ledger at ${sha.slice(0, 12)}`);
}

async function emit(name: string, text: string, check: boolean): Promise<boolean> {
  const path = join(DIR, name);
  const formatted = await format(text, {
    ...((await resolveConfig(path)) ?? {}),
    filepath: path,
  });
  const before = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (check) {
    if (before !== formatted) {
      console.error(`[echo-adaptation] ${name} does not reproduce`);
      return false;
    }
    log(`${name} reproduces`);
    return true;
  }
  if (before !== formatted) writeFileSync(path, formatted);
  log(`${before === formatted ? "unchanged" : "wrote"} ${name}`);
  return true;
}

async function report(): Promise<void> {
  const check = flag("--check");
  const r = buildReport(DIR);
  const commit = check
    ? publishedCommit(DIR)
    : git("status", "--porcelain")
      ? "a working tree"
      : `\`${git("rev-parse", "--short", "HEAD")}\``;
  mkdirSync(DIR, { recursive: true });
  const ok =
    (await emit("summary.json", JSON.stringify(r), check)) &&
    (await emit("README.md", renderReadme(r, commit), check));
  if (!ok) process.exit(1);
}

switch (command) {
  case "run":
    run();
    break;
  case "collect":
    collect();
    break;
  case "originals":
    originals();
    break;
  case "report":
    await report();
    break;
  default:
    console.error(
      "usage: echo-adaptation-evaluate.ts run|collect|originals|report (see the header)",
    );
    process.exit(2);
}
