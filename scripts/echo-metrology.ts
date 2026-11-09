/**
 * The ECHO Intelligence Metrology Bench from the command line
 * (docs/ECHO_INTELLIGENCE_METROLOGY.md). Research subjects only: it never opens
 * a store, a checkpoint, a VM or an original, and refuses a production host.
 *
 *   node scripts/run-ts.mjs scripts/echo-metrology.ts protocol --protocol ID
 *   node scripts/run-ts.mjs scripts/echo-metrology.ts run --protocol ID --split dev|heldout --shard I/N --out FILE
 *   node scripts/run-ts.mjs scripts/echo-metrology.ts collect --protocol ID --split S FILE...
 *   node scripts/run-ts.mjs scripts/echo-metrology.ts report --protocol ID --split S
 *   node scripts/run-ts.mjs scripts/echo-metrology.ts verify --protocol ID --split S [--replay K] [--write]
 *   node scripts/run-ts.mjs scripts/echo-metrology.ts compute --protocol ID [--reps R]
 *   node scripts/run-ts.mjs scripts/echo-metrology.ts reproduce --shard I/N --out FILE
 *   node scripts/run-ts.mjs scripts/echo-metrology.ts reproduce-report FILE...
 *   node scripts/run-ts.mjs scripts/echo-metrology.ts neural
 *
 * `run` appends one canonical record per unit to FILE and, on a second start,
 * runs only the units FILE lacks (a deterministic unit gives the same record;
 * nothing is ever rerun to change an outcome). `collect` checks the design is
 * complete and writes records.jsonl, machine.json and the frozen protocol;
 * `report` derives summary.json, README.md and manifest.json from them alone;
 * `verify` rebuilds everything and re-simulates a sample. Run held-out splits
 * from a clean commit and commit what each step writes.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";
import { canonicalJson, sha256 } from "../src/rain/sha256.js";
import { FLY_SOURCE } from "../src/rain/scientific/flySource.js";
import { refuseProductionHost } from "../src/bethesda/firstContact/originals.js";
import {
  conditionOf,
  parseProtocol,
  protocolDigest,
  seedsOf,
  unitKey,
  unitsOf,
  type Protocol,
  type Split,
} from "../src/bethesda/metrology/protocol.js";
import { CONTROLLERS, type ControllerId } from "../src/bethesda/metrology/controllers.js";
import { behaviouralPart, runUnit, subjectOf, type Clock, type RunRecord } from "../src/bethesda/metrology/runner.js";
import {
  buildArchive,
  manifestText,
  parseRecords,
  recordsText,
  machineText,
  manifestDigest,
  EVIDENCE_FILES,
  VERIFICATION_SCHEMA,
} from "../src/bethesda/metrology/archive.js";
import type { MachineRecord } from "../src/bethesda/metrology/report.js";
import { replaySample, statusOf, verifyStatic, type ReplayResult, type Verification } from "../src/bethesda/metrology/verify.js";
import { MetrologyLife } from "../src/bethesda/metrology/life.js";
import { computeReport, renderCompute, type ComputeRow } from "../src/bethesda/metrology/compute.js";
import { neuralReport, renderNeural, type NeuralReport } from "./echo-metrology-connectome.js";
import { reproductionSummary, studyKey, type ReproductionSummary } from "../src/bethesda/metrology/legacy.js";
import { renderReproduction } from "../src/bethesda/metrology/legacyReport.js";
import { execute as studyExecute, type RunRecord as StudyRecord } from "../src/bethesda/plasticity/study.js";
import type { Interval as StudyInterval } from "../src/bethesda/plasticity/analysis.js";

const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith("echo-metrology.ts")) + 1);
const mode = args[0];
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = () =>
  args.slice(1).filter((a, k, all) => !a.startsWith("--") && !(all[k - 1] ?? "").startsWith("--"));

const ROOT = join("docs", "benchmarks", "echo-metrology");
const clock: Clock = {
  wallMs: () => performance.now(),
  cpuMs: () => {
    const u = process.cpuUsage();
    return (u.user + u.system) / 1000;
  },
};

function write(path: string, text: string): void {
  refuseProductionHost(path, existsSync);
  writeFileSync(path, text);
}

function loadProtocol(): { protocol: Protocol; source: string } {
  const id = option("protocol");
  if (!id || !/^[a-z0-9-]+$/.test(id)) throw new Error("--protocol ID (a file in src/bethesda/metrology/protocols/)");
  const source = readFileSync(join("src", "bethesda", "metrology", "protocols", `${id}.json`), "utf8");
  const protocol = parseProtocol(JSON.parse(source));
  if (protocol.id !== id) throw new Error(`the file ${id}.json holds protocol ${protocol.id}`);
  return { protocol, source };
}

function splitArg(): Split {
  const s = option("split");
  if (s !== "dev" && s !== "heldout") throw new Error("--split dev|heldout");
  return s;
}

function shardArg(): [number, number] {
  const [i, n] = (option("shard") ?? "0/1").split("/").map(Number);
  if (!Number.isInteger(i) || !Number.isInteger(n) || i! < 0 || i! >= n!) throw new Error("--shard I/N");
  return [i!, n!];
}

function git(...a: string[]): string {
  return execFileSync("git", a, { encoding: "utf8" }).trim();
}

function machineRecord(shards: number): MachineRecord {
  const dirty = git("status", "--porcelain", "--", "src", "scripts");
  return {
    schema: "eimb-machine/v1",
    commit: git("rev-parse", "HEAD"),
    cleanSources: dirty === "",
    platform: platform(),
    arch: arch(),
    node: process.version,
    flySourceDigest: FLY_SOURCE.sha256,
    shards,
    collectedAt: new Date().toISOString(),
  };
}

const folderOf = (p: Protocol, split: Split) => join(ROOT, p.id, split);

function readArchive(folder: string): Record<string, string | undefined> {
  const files: Record<string, string | undefined> = {};
  for (const name of [...EVIDENCE_FILES, "manifest.json"]) {
    const path = join(folder, name);
    files[name] = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  }
  return files;
}

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

if (mode === "protocol") {
  const { protocol } = loadProtocol();
  const digest = protocolDigest(protocol);
  process.stdout.write(
    [
      `protocol ${protocol.id}`,
      `digest   ${digest}`,
      `dev      ${seedsOf(protocol, "dev").join(", ")} (${unitsOf(protocol, "dev").length} runs)`,
      `heldout  ${seedsOf(protocol, "heldout").join(", ")} (${unitsOf(protocol, "heldout").length} runs)`,
      "",
    ].join("\n"),
  );
} else if (mode === "run") {
  const { protocol } = loadProtocol();
  const split = splitArg();
  const [i, n] = shardArg();
  const out = option("out");
  if (!out) throw new Error("run needs --out FILE");
  refuseProductionHost(out, existsSync);
  const done = new Set(existsSync(out) ? readJsonl<RunRecord>(out).map(unitKey) : []);
  const units = unitsOf(protocol, split)
    .filter((_, k) => k % n === i)
    .filter((u) => !done.has(unitKey(u)));
  const started = Date.now();
  units.forEach((u, k) => {
    const r = runUnit(protocol, split, u, clock);
    appendFileSync(out, `${canonicalJson(r)}\n`);
    process.stderr.write(
      `[${Math.round((Date.now() - started) / 1000)} s] ${k + 1}/${units.length} ${u.condition} ${u.seed} ${u.controller}: ${r.status} fedJ ${r.behaviour.fedJ?.toFixed(3) ?? "-"} meals ${r.behaviour.meals ?? "-"}\n`,
    );
  });
  process.stderr.write(`shard ${i}/${n}: ${units.length} run(s) done\n`);
} else if (mode === "collect") {
  const { protocol, source } = loadProtocol();
  const split = splitArg();
  const files = positional();
  if (!files.length) throw new Error("collect needs the shard files");
  const records = files.flatMap((f) => readJsonl<RunRecord>(f));
  const want = new Set(unitsOf(protocol, split).map(unitKey));
  const got = new Map<string, RunRecord>();
  for (const r of records) {
    const k = unitKey(r);
    if (!want.has(k)) throw new Error(`a record outside the design: ${k}`);
    if (got.has(k)) throw new Error(`two records for ${k}`);
    got.set(k, r);
  }
  if (got.size !== want.size) throw new Error(`expected ${want.size} records, have ${got.size}`);
  const folder = folderOf(protocol, split);
  mkdirSync(folder, { recursive: true });
  write(join(folder, "protocol.json"), source);
  write(join(folder, "records.jsonl"), recordsText(records));
  write(join(folder, "machine.json"), machineText(machineRecord(files.length)));
  process.stdout.write(`${folder}: ${records.length} records\n`);
} else if (mode === "report") {
  const { protocol, source } = loadProtocol();
  const split = splitArg();
  const folder = folderOf(protocol, split);
  const records = parseRecords(readFileSync(join(folder, "records.jsonl"), "utf8"));
  const machine = JSON.parse(readFileSync(join(folder, "machine.json"), "utf8")) as MachineRecord;
  const archived = readFileSync(join(folder, "protocol.json"), "utf8");
  if (archived !== source) throw new Error("the archived protocol differs from the repository's: a protocol changed after its run");
  const { files, manifest, summary } = buildArchive(source, protocol, split, records, machine);
  for (const name of ["summary.json", "README.md"] as const) write(join(folder, name), files[name]);
  write(join(folder, "manifest.json"), manifestText(manifest));
  process.stdout.write(`${folder}: ${summary.verdict.overall}; manifest ${manifestDigest(manifest)}\n`);
} else if (mode === "verify") {
  const { protocol } = loadProtocol();
  const split = splitArg();
  const folder = folderOf(protocol, split);
  const files = readArchive(folder);
  const st = verifyStatic(protocol, split, files);
  const k = option("replay") === "all" ? Infinity : Number(option("replay") ?? 0);
  let replay: ReplayResult = { status: "skipped", detail: "no replay requested", units: [], mismatched: [] };
  if (k > 0 && st.records && st.manifestDigest && st.machine) {
    const m = st.machine;
    if (m.platform !== platform() || m.arch !== arch())
      replay = {
        status: "not-comparable",
        detail: `records made on ${m.platform} ${m.arch}; this is ${platform()} ${arch()}. Behaviour reproduces byte for byte only on the platform that made it (docs/research/echo-replay/README.md).`,
        units: [],
        mismatched: [],
      };
    else {
      const sample = replaySample(st.records, st.manifestDigest, Number.isFinite(k) ? k : st.records.length);
      const mismatched: string[] = [];
      for (const r of sample) {
        process.stderr.write(`replaying ${unitKey(r)}\n`);
        const again = runUnit(protocol, split, r, clock);
        if (canonicalJson(behaviouralPart(again)) !== canonicalJson(behaviouralPart(r))) mismatched.push(unitKey(r));
      }
      replay = {
        status: mismatched.length ? "mismatch" : "matched",
        detail: `${sample.length - mismatched.length} of ${sample.length} sampled runs re-simulated byte for byte (compute block excluded) on ${platform()} ${arch()}, Node ${process.version}${m.node === process.version ? "" : `; records were made on Node ${m.node}`}`,
        units: sample.map(unitKey),
        mismatched,
      };
    }
  }
  const status = statusOf(st.checks, replay);
  const result: Verification = {
    schema: VERIFICATION_SCHEMA,
    protocol: protocol.id,
    split,
    manifestDigest: st.manifestDigest,
    status,
    checks: st.checks,
    replay,
    verifier: { commit: git("rev-parse", "HEAD"), platform: `${platform()} ${arch()}`, node: process.version },
    verifiedAt: new Date().toISOString(),
  };
  for (const c of st.checks) process.stdout.write(`${c.passed ? "ok  " : "FAIL"} ${c.id}: ${c.detail}\n`);
  process.stdout.write(`replay ${replay.status}: ${replay.detail}\n${status}\n`);
  if (args.includes("--write")) write(join(folder, "verification.json"), JSON.stringify(result, null, 2) + "\n");
  if (status === "FAILED") process.exitCode = 1;
} else if (mode === "compute") {
  const { protocol } = loadProtocol();
  const reps = Number(option("reps") ?? 2);
  const condition = conditionOf(protocol, protocol.endpoints.confirmatory[0]!.condition);
  const controllers = [...new Set(unitsOf(protocol, "dev").filter((u) => u.condition === condition.id).map((u) => u.controller))];
  const seeds = protocol.splits.dev.seeds.slice(0, 3);
  const durationS = 1800;
  const rows: ComputeRow[] = [];
  for (let rep = 0; rep < reps; rep++)
    for (const seed of seeds)
      controllers.forEach((_, j) => {
        // Rotate the order every seed and rep, so drift in the machine's speed falls on every controller alike.
        const controller = controllers[(j + seed + rep) % controllers.length]! as ControllerId;
        const life = new MetrologyLife({
          seed,
          condition,
          controller,
          subject: subjectOf(protocol, "dev", { seed, condition: condition.id, controller }) + "-compute",
          durationS,
          blockS: protocol.blockS,
          sampleEveryTicks: protocol.sampleEveryTicks,
          lateFromS: Math.min(protocol.lateFromS, durationS / 2),
        });
        const a = life.organism;
        const decide = a.decide.bind(a);
        const latencies: number[] = [];
        a.decide = (input) => {
          const t0 = performance.now();
          const out = decide(input);
          latencies.push(performance.now() - t0);
          return out;
        };
        const heap0 = process.memoryUsage().heapUsed;
        const w0 = performance.now(),
          c0 = process.cpuUsage();
        life.step(Math.round(durationS / 0.1));
        const c = process.cpuUsage(c0);
        const wallS = (performance.now() - w0) / 1000;
        const plasticity = life.plasticity;
        rows.push({
          controller,
          seed,
          rep,
          simulatedS: durationS,
          wallS,
          cpuS: (c.user + c.system) / 1e6,
          decisions: latencies.length,
          decisionLatenciesMs: latencies,
          heapDeltaMb: (process.memoryUsage().heapUsed - heap0) / 1e6,
          controllerStateBytes: canonicalJson(a.state).length,
          plasticityStateBytes: plasticity ? canonicalJson(plasticity.state).length : 0,
          addedParameters: CONTROLLERS[controller].addedParameters,
        });
        process.stderr.write(`compute ${controller} ${seed} rep ${rep}: ${wallS.toFixed(2)} s\n`);
      });
  const folder = join(ROOT, protocol.id, "compute");
  mkdirSync(folder, { recursive: true });
  const report = computeReport(protocol, rows, { ...machineRecord(1), condition: condition.id });
  write(join(folder, "compute.json"), JSON.stringify(report, null, 2) + "\n");
  write(join(folder, "README.md"), renderCompute(report));
  process.stdout.write(`${folder}: ${rows.length} runs\n`);
} else if (mode === "reproduce") {
  const [i, n] = shardArg();
  const out = option("out");
  if (!out) throw new Error("reproduce needs --out FILE");
  refuseProductionHost(out, existsSync);
  const archived = readJsonl<StudyRecord>(join("docs", "benchmarks", "echo-plasticity", "heldout", "records.jsonl"));
  const done = new Set(existsSync(out) ? readJsonl<StudyRecord>(out).map(studyKey) : []);
  const runs = archived
    .filter((r) => r.condition === "weak-legs")
    .filter((_, k) => k % n === i)
    .filter((r) => !done.has(studyKey(r)));
  runs.forEach((r, k) => {
    const again = studyExecute("heldout", { seed: r.seed, arm: r.arm, condition: "weak-legs" });
    appendFileSync(out, `${canonicalJson(again)}\n`);
    process.stderr.write(`${k + 1}/${runs.length} ${r.seed} ${r.arm}: ${canonicalJson(again) === canonicalJson(r) ? "identical" : "DIFFERS"}\n`);
  });
} else if (mode === "reproduce-report") {
  const files = positional();
  const reproduced = files.flatMap((f) => readJsonl<StudyRecord>(f));
  const src = join("docs", "benchmarks", "echo-plasticity", "heldout");
  const archived = readJsonl<StudyRecord>(join(src, "records.jsonl"));
  const archivedSummary = JSON.parse(readFileSync(join(src, "summary.json"), "utf8")) as {
    primary: { contrast: { interval: StudyInterval } };
  };
  const sourceMachine = JSON.parse(readFileSync(join(src, "machine.json"), "utf8")) as { commit: string };
  const want = archived.filter((r) => r.condition === "weak-legs").length;
  if (reproduced.length !== want) throw new Error(`expected ${want} reproduced records, have ${reproduced.length}`);
  const { protocol } = loadProtocol();
  const summary: ReproductionSummary = reproductionSummary(archived, reproduced, archivedSummary.primary.contrast.interval, protocol, {
    source: src.split("\\").join("/"),
    sourceCommit: sourceMachine.commit,
    condition: "weak-legs",
  });
  const folder = join(ROOT, `reproduction-${sourceMachine.commit.slice(0, 7)}`);
  mkdirSync(folder, { recursive: true });
  const sorted = [...reproduced].sort((a, b) => (studyKey(a) < studyKey(b) ? -1 : 1));
  const recordsTextOut = sorted.map((r) => canonicalJson(r)).join("\n") + "\n";
  const machine = machineRecord(files.length);
  const filesOut: Record<string, string> = {
    "reproduced.jsonl": recordsTextOut,
    "summary.json": JSON.stringify(summary, null, 2) + "\n",
    "machine.json": machineText(machine),
  };
  filesOut["README.md"] = renderReproduction(summary, machine, protocol);
  for (const [name, text] of Object.entries(filesOut)) write(join(folder, name), text);
  write(
    join(folder, "manifest.json"),
    JSON.stringify(
      { schema: "eimb-reproduction-manifest/v1", files: Object.fromEntries(Object.entries(filesOut).map(([k, v]) => [k, sha256(v)])) },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(`${folder}: ${summary.identical} of ${summary.runs} identical; primary same: ${summary.primary.same}\n`);
} else if (mode === "neural") {
  const base = join("docs", "benchmarks", "fly-neural");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : name.endsWith(".json") ? [path] : [];
    });
  const files = walk(base).map((path) => ({ path: path.split("\\").join("/"), text: readFileSync(path, "utf8") }));
  const licences = [
    { dataset: "FAFB v783 (FlyWire)", file: `${base}/LICENSE.md`.split("\\").join("/") },
    { dataset: "BANC v888", file: `${base}/banc/LICENSE.md`.split("\\").join("/") },
  ].map((l) => ({ ...l, text: readFileSync(l.file, "utf8") }));
  const report: NeuralReport = neuralReport(files, licences);
  const folder = join(ROOT, "neural");
  mkdirSync(folder, { recursive: true });
  write(join(folder, "report.json"), JSON.stringify(report, null, 2) + "\n");
  write(join(folder, "README.md"), renderNeural(report));
  process.stdout.write(`${folder}: ${report.results.length} results, ${report.results.filter((r) => r.seal === "verified").length} seals verified, ${report.results.filter((r) => r.seal === "broken").length} broken\n`);
} else {
  throw new Error("mode is protocol, run, collect, report, verify, compute, reproduce, reproduce-report or neural");
}
