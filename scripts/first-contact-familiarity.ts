/**
 * Runs and reports the commons familiarity study (`first-contact-familiarity-v1`).
 *
 *   node scripts/run-ts.mjs scripts/first-contact-familiarity.ts --phase development
 *   node scripts/run-ts.mjs scripts/first-contact-familiarity.ts --phase held-out
 *   node scripts/run-ts.mjs scripts/first-contact-familiarity.ts --phase development --smoke 2
 *   node scripts/run-ts.mjs scripts/first-contact-familiarity.ts --phase held-out --check
 *
 * Research subjects only: no original is read, copied or reached. The held-out
 * seeds run once, from a clean commit; a result that ran from a working tree
 * is labelled so and is not a result. `--smoke N` runs N replicates of each
 * group and writes nothing. `--check` reruns a phase and fails unless it
 * reproduces the committed files byte for byte (on the platform they ran on);
 * it writes nothing.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, arch, platform } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { format, resolveConfig } from "prettier";
import { sha256, sha256Json } from "../src/rain/sha256.js";
import { refuseProductionHost } from "../src/bethesda/firstContact/originals.js";
import {
  evaluate,
  FAMILIARITY_SCHEMA,
  plan,
  type FamiliarityProtocol,
  type FamiliarityResult,
  type Phase,
  type ReplicateRecord,
} from "../src/bethesda/firstContact/commons/familiarity.js";

const root = process.cwd();
const out = join(root, "docs/benchmarks/first-contact");
const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const phase = value("--phase") as Phase | undefined;
if (phase !== "development" && phase !== "held-out")
  throw new Error("usage: --phase development|held-out [--workers N] [--smoke N]");
const smoke = value("--smoke") ? Number(value("--smoke")) : null;
const check = args.includes("--check");
const workers = Number(
  value("--workers") ?? Math.max(1, Math.min(4, availableParallelism() - 1)),
);
const log = (line: string) => console.log(`[familiarity] ${line}`);

refuseProductionHost(out, existsSync);

const text = readFileSync(
  join(root, "src/bethesda/firstContact/protocols/familiarity-v1.json"),
  "utf8",
).replace(/\r\n?/g, "\n");
const protocol = JSON.parse(text) as FamiliarityProtocol;
const protocolSha = sha256(text);
if (protocol.schema !== FAMILIARITY_SCHEMA)
  throw new Error("familiarity protocol schema");

const dirty = execSync("git status --porcelain", { cwd: root, encoding: "utf8" }).trim();
const name = `familiarity-${phase}`;
// --check reproduces the committed files, so it keeps their stamp.
const committedStamp =
  check && existsSync(join(out, `${name}.json`))
    ? (JSON.parse(readFileSync(join(out, `${name}.json`), "utf8")) as {
        ranFrom: string;
        platform: string;
      })
    : null;
const ranFrom =
  committedStamp?.ranFrom ??
  (dirty
    ? "a working tree"
    : `\`${execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim()}\``);
if (args.includes("--render")) {
  // Rebuild the markdown from the result already written; runs nothing.
  const saved = JSON.parse(
    readFileSync(join(out, `${name}.json`), "utf8"),
  ) as FamiliarityResult & {
    ranFrom: string;
    platform: string;
    recordsSha256: string;
    revisions: string[];
  };
  await emit(
    `${name}.md`,
    render(saved, saved.ranFrom, saved.platform, saved.recordsSha256),
  );
  process.exit(0);
}
if (phase === "held-out" && smoke === null && !check) {
  if (dirty)
    throw new Error("held-out seeds run once, from a clean commit: commit first");
  const prior = join(out, `${name}.json`);
  if (existsSync(prior))
    throw new Error(`held-out seeds run once: ${name}.json already holds a result`);
}

let jobs = plan(protocol, phase);
if (smoke !== null) jobs = jobs.filter((j) => j.replicate < smoke);
log(
  `protocol ${protocol.id} sha256 ${protocolSha}; ${phase}; ${jobs.length} runs on ${workers} workers; from ${ranFrom}`,
);

const t0 = performance.now();
const records: ReplicateRecord[] = [];
await Promise.all(
  Array.from({ length: workers }, (_, w) => {
    const mine = jobs.filter((_, i) => i % workers === w);
    if (!mine.length) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const worker = new Worker(
        new URL("./first-contact-familiarity-worker.mjs", import.meta.url),
        {
          workerData: { protocol, phase, jobs: mine },
        },
      );
      worker.on("message", (m: { record?: ReplicateRecord; done?: boolean }) => {
        if (m.record) {
          records.push(m.record);
          if (records.length % 10 === 0 || records.length === jobs.length)
            log(
              `${records.length}/${jobs.length} runs (${((performance.now() - t0) / 60000).toFixed(1)} min)`,
            );
        }
        if (m.done) resolve();
      });
      worker.on("error", reject);
      worker.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`worker exit ${code}`)),
      );
    });
  }),
);
if (records.length !== jobs.length)
  throw new Error(`only ${records.length} of ${jobs.length} runs returned`);
const order = (x: ReplicateRecord) =>
  `${Object.keys(protocol.arms).indexOf(x.arm)}/${x.condition}/${String(x.replicate).padStart(4, "0")}`;
records.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));

const result = {
  ...evaluate(protocol, protocolSha, phase, records),
  revisions: protocol.revisions ?? [],
};
const host =
  committedStamp?.platform ?? `Node ${process.versions.node}, ${platform()} ${arch()}`;
const digest = sha256Json(records);
for (const [h, v] of Object.entries(result.hypotheses))
  log(
    `${h}: ${v.verdict} ${v.estimate ? `${v.estimate.estimate} [${v.estimate.low}, ${v.estimate.high}]` : "—"} (n ${v.n})`,
  );
log(
  `manipulation check: ${result.manipulation.passed ? "passed" : "FAILED"} ${result.manipulation.notes.join("; ")}`,
);
log(
  `lesions: ${Object.entries(result.lesions)
    .map(([k, v]) => `${k} ${v}`)
    .join("; ")}`,
);
log(`${((performance.now() - t0) / 60000).toFixed(1)} min`);
if (smoke !== null) {
  log("smoke run: nothing written");
  process.exit(0);
}

const mismatched: string[] = [];
async function emit(file: string, body: string) {
  const path = join(out, file);
  const formatted = await format(body, {
    ...((await resolveConfig(path)) ?? {}),
    filepath: path,
  });
  if (check) {
    const committed = existsSync(path) ? readFileSync(path, "utf8") : null;
    const same = committed === formatted;
    if (!same) mismatched.push(file);
    log(`${file}: ${same ? "reproduced" : committed === null ? "MISSING" : "DIFFERS"}`);
    return;
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(path, formatted);
  log(`wrote ${file}`);
}
await emit(
  `${name}.json`,
  JSON.stringify({ ranFrom, platform: host, recordsSha256: digest, ...result }, null, 2),
);
await emit(
  `${name}.records.jsonl`.replace(".jsonl", ".json"),
  JSON.stringify(records, null, 1),
);
await emit(`${name}.md`, render(result, ranFrom, host, digest));
if (check) {
  if (mismatched.length)
    throw new Error(`--check: ${mismatched.join(", ")} not reproduced`);
  log("--check: every file reproduced byte for byte");
}

function render(
  res: FamiliarityResult & { revisions: string[] },
  from: string,
  on: string,
  recordsSha: string,
): string {
  const L: string[] = [];
  L.push(`# First contact in the commons: familiarity (${res.phase})`, "");
  L.push(
    'Generated by `node scripts/run-ts.mjs scripts/first-contact-familiarity.ts`; never edit by hand. Methods and limits: [docs/FIRST_CONTACT.md](../../FIRST_CONTACT.md), "The commons". Every subject is a research subject built from a seed; none is Eva or ECHO or a copy of either. A result that ran from a working tree is not a result.',
    "",
  );
  L.push(
    `Protocol \`${res.protocol.id}\` SHA-256 \`${res.protocol.sha256}\`; ran from ${from} on ${on}. Records digest \`${recordsSha}\`.`,
    "",
  );
  L.push(
    "| Group | Replicates | Skipped | With a test contact | Familiarization contacts (mean) | First test response (mean, n) | Alerted at first eligible onset | Walked away at first stationary onset | Escapes at onset (mean) | Grooming or feeding (share) |",
  );
  L.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const [k, g] of Object.entries(res.groups))
    L.push(
      `| ${k} | ${g.replicates} | ${g.skipped} | ${g.withTestContact} | ${g.meanFamiliarizationContacts ?? "—"} | ${g.meanFirstResponse ?? "—"} (${g.firstResponses}) | ${g.alerted.successes}/${g.alerted.n} | ${g.walked.successes}/${g.walked.n} | ${g.meanEscapesAtOnset ?? "—"} | ${g.meanGroomFeedShare ?? "—"} |`,
    );
  if (res.revisions.length)
    L.push(
      "",
      "Protocol revisions before the held-out run:",
      "",
      ...res.revisions.map((x) => `- ${x}`),
      "",
    );
  L.push(
    "",
    "| Hypothesis | Rule | Estimate [interval] | n | Verdict |",
    "| --- | --- | --- | ---: | --- |",
  );
  for (const [h, v] of Object.entries(res.hypotheses))
    L.push(
      `| ${h} | ${v.rule.replaceAll("|", "\\|")} | ${v.estimate ? `${v.estimate.estimate} [${v.estimate.low}, ${v.estimate.high}]` : "—"} | ${v.n} | ${v.verdict} |`,
    );
  L.push(
    "",
    `Manipulation check: ${res.manipulation.passed ? "passed" : "failed"}${res.manipulation.notes.length ? ` (${res.manipulation.notes.join("; ")})` : ""}.`,
  );
  L.push(
    "",
    `Lesion checks: ${Object.entries(res.lesions)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ")}.`,
    "",
  );
  return L.join("\n");
}
