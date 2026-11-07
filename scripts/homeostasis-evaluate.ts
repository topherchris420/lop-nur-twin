/**
 * The homeostasis study (docs/RAIN_GENESIS.md, Stage B).
 *
 *   node scripts/run-ts.mjs scripts/homeostasis-evaluate.ts run --split dev --shard 1/4   # one shard of the trials
 *   node scripts/run-ts.mjs scripts/homeostasis-evaluate.ts collect --split dev           # merge, score, write the record
 *   node scripts/run-ts.mjs scripts/homeostasis-evaluate.ts report                        # README from the records
 *   ... --protocol homeostasis-v1   (the default)
 *   ... --scratch   a development run from a working tree: never a record
 *
 * Shards run environments split across processes (`--shard k/n` takes every
 * n-th environment from the k-th) and write to .fly-homeostasis/. `collect`
 * refuses shards from different commits or code, or a dirty tree unless
 * --scratch. Every subject is `research-…`, built from a seed; nothing reads or
 * writes a store, checkpoint, backup or individual, and it refuses a
 * production host.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { arch, cpus, platform } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { refuseProductionHost } from "../src/bethesda/firstContact/originals.js";
import { FLY_VERSION } from "../src/bethesda/fly/fly.js";
import {
  HOMEOSTASIS_PARAMS,
  HOMEOSTASIS_VERSION,
} from "../src/bethesda/ecology/homeostasis.js";
import { ECOLOGY_VERSION } from "../src/bethesda/ecology/params.js";
import {
  CRITICAL_WATER,
  GIVE_UP_S,
  HUNGRY,
  HOT_C,
  HUMIDITY_STEP,
  SATED,
  THIRSTY,
} from "../src/bethesda/ecology/policy.js";
import {
  ARMS,
  environments,
  meanOf,
  pairedBootstrap,
  runEnvironments,
  STUDY_SCHEMA,
  survival,
  type Arm,
  type StudyProtocol,
  type TrialResult,
} from "../src/bethesda/ecology/study.js";
import { canonicalJson, sha256 } from "../src/rain/sha256.js";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const mode = args.find((a) => ["run", "collect", "report"].includes(a));
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const scratch = args.includes("--scratch");
const check = args.includes("--check");
const protocolId = opt("--protocol") ?? "homeostasis-v1";
const SHARDS = ".fly-homeostasis";
const OUT = scratch ? ".fly-homeostasis/records" : "docs/benchmarks/homeostasis";
if (!mode) {
  console.error(
    "usage: homeostasis-evaluate.ts run|collect|report [--split S] [--shard k/n] [--scratch]",
  );
  process.exit(2);
}
refuseProductionHost(resolve(root, OUT), existsSync);
refuseProductionHost(resolve(root, SHARDS), existsSync);
const git = (c: string) => execSync(`git ${c}`, { cwd: root, encoding: "utf8" }).trim();
const protocolPath = `src/bethesda/ecology/protocols/${protocolId}.json`;
const protocolText = readFileSync(join(root, protocolPath), "utf8").replace(
  /\r\n?/g,
  "\n",
);
const protocol = JSON.parse(protocolText) as StudyProtocol & {
  bootstrap: { resamples: number; seed: number };
  criteria: { id: string; rule: string }[];
};
if (protocol.schema !== STUDY_SCHEMA || protocol.id !== protocolId)
  throw new Error(`${protocolPath} is not the protocol ${protocolId}`);
const protocolSha = sha256(protocolText);

/** The study's code: every file reached by relative imports from this script. */
function sourceDigest(): string {
  const IMPORT = /\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g;
  const files: Record<string, string> = {};
  const queue = ["scripts/homeostasis-evaluate.ts"];
  while (queue.length) {
    const path = queue.shift()!;
    if (files[path]) continue;
    const text = readFileSync(join(root, path), "utf8").replace(/\r\n?/g, "\n");
    files[path] = sha256(text);
    for (const m of text.matchAll(IMPORT)) {
      const t = posix.normalize(posix.join(posix.dirname(path), m[1]!));
      const base = t.endsWith(".js") ? t.slice(0, -3) : t;
      const found = [`${base}.ts`, t].find((c) => existsSync(join(root, c)));
      if (!found) throw new Error(`${path} imports ${m[1]}, which does not exist`);
      queue.push(found);
    }
  }
  return sha256(canonicalJson(Object.fromEntries(Object.entries(files).sort())));
}

function provenance() {
  const dirty = git("status --porcelain");
  if (dirty && !scratch)
    throw new Error(
      "a record is made only from a clean commit; commit first, or pass --scratch",
    );
  return {
    commit: git("rev-parse HEAD"),
    clean: !dirty,
    platform: `${platform()} ${arch()}`,
    node: process.version,
  };
}

const r6 = (x: number) => Number(x.toPrecision(6));

if (mode === "run") {
  const split = opt("--split") ?? "dev";
  const [k, n] = (opt("--shard") ?? "1/1").split("/").map(Number) as [number, number];
  if (!(k >= 1 && k <= n)) throw new Error("--shard k/n with 1 ≤ k ≤ n");
  const prov = provenance();
  const envs = environments(protocol, protocol.splits[split]!);
  const which = envs.map((e) => e.index).filter((i) => i % n === k - 1);
  const t0 = performance.now();
  const results = runEnvironments(protocol, split, which, (m) =>
    process.stderr.write(`${m}\n`),
  );
  const path = join(root, SHARDS, `${protocolId}-${split}-shard-${k}-of-${n}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        protocol: protocolId,
        protocol_sha256: protocolSha,
        source: sourceDigest(),
        provenance: prov,
        split,
        shard: [k, n],
        environments: which,
        wall_s: r6((performance.now() - t0) / 1000),
        cpu: cpus()[0]?.model ?? "unknown",
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${posix.relative(root, path)}`);
} else if (mode === "collect") {
  const split = opt("--split") ?? "dev";
  const files = readdirSync(join(root, SHARDS)).filter((f) =>
    f.startsWith(`${protocolId}-${split}-shard-`),
  );
  const shards = files.map((f) =>
    JSON.parse(readFileSync(join(root, SHARDS, f), "utf8")),
  );
  if (!shards.length) throw new Error("no shards");
  const n = shards[0].shard[1];
  if (shards.length !== n || shards.some((s) => s.shard[1] !== n))
    throw new Error("the shards are not one complete set");
  for (const s of shards) {
    if (s.protocol_sha256 !== protocolSha)
      throw new Error("a shard ran another protocol");
    if (
      s.source !== shards[0].source ||
      s.provenance.commit !== shards[0].provenance.commit
    )
      throw new Error("the shards ran different code");
    if (!s.provenance.clean && !scratch)
      throw new Error("a shard ran from a dirty tree: not a record");
  }
  if (!scratch && shards[0].source !== sourceDigest())
    throw new Error("the shards ran other code than this commit's");
  const results: TrialResult[] = shards
    .flatMap((s) => s.results as TrialResult[])
    .sort(
      (a, b) =>
        a.environment - b.environment ||
        a.seed - b.seed ||
        ARMS.indexOf(a.arm) - ARMS.indexOf(b.arm),
    );
  const by = (arm: Arm) => results.filter((r) => r.arm === arm);
  const B = protocol.bootstrap;
  const diff = (a: Arm, b: Arm, stat: (rs: TrialResult[]) => number) =>
    pairedBootstrap(results, a, b, stat, B.resamples, B.seed);
  const surv = Object.fromEntries(ARMS.map((a) => [a, r6(survival(by(a)))]));
  const d1 = diff("full", "no-feedback", survival);
  const d2 = diff("full", "no-thirst", meanOf("hydrated_share"));
  const d3 = diff("full", "shuffled-humidity", meanOf("hydrated_share"));
  const d4 = diff("full", "no-heat", meanOf("hot_h"));
  const fullHydrated = by("full")
    .map((r) => r.hydrated_share ?? 0)
    .sort((a, b) => a - b);
  const median = fullHydrated.length
    ? fullHydrated[Math.floor((fullHydrated.length - 1) / 2)]!
    : 0;
  const criteria =
    split === "heldout"
      ? {
          H1: { pass: d1.estimate >= 0.25 && d1.lo > 0, difference: d1 },
          H2: { pass: d2.lo > 0, difference: d2 },
          H3: { pass: d3.lo > 0, difference: d3 },
          H4: { pass: d4.hi < 0, difference: d4 },
          H5: { pass: median >= 0.8, median_hydrated_share_full: r6(median) },
        }
      : null;
  const causes = Object.fromEntries(
    ARMS.map((a) => [
      a,
      by(a).reduce<Record<string, number>>(
        (m, r) => ((m[r.cause ?? "alive"] = (m[r.cause ?? "alive"] ?? 0) + 1), m),
        {},
      ),
    ]),
  );
  const record = {
    schema: "homeostasis-result/v1",
    protocol: protocolId,
    protocol_sha256: protocolSha,
    split,
    versions: {
      ecology: ECOLOGY_VERSION,
      homeostasis: HOMEOSTASIS_VERSION,
      fly: FLY_VERSION,
    },
    policy_constants: {
      HOT_C,
      THIRSTY,
      SATED,
      GIVE_UP_S,
      HUMIDITY_STEP,
      HUNGRY,
      CRITICAL_WATER,
    },
    homeostasis_params: Object.fromEntries(
      Object.entries(HOMEOSTASIS_PARAMS).map(([k, v]) => [k, v.value]),
    ),
    provenance: shards[0].provenance,
    source: shards[0].source,
    trials: results.length,
    survival: surv,
    mean_survived_h: Object.fromEntries(
      ARMS.map((a) => [a, r6(meanOf("survived_h")(by(a)))]),
    ),
    mean_hydrated_share: Object.fromEntries(
      ARMS.map((a) => [a, r6(meanOf("hydrated_share")(by(a)))]),
    ),
    mean_hot_h: Object.fromEntries(ARMS.map((a) => [a, r6(meanOf("hot_h")(by(a)))])),
    causes,
    differences: {
      survival_full_vs_no_feedback: d1,
      hydrated_full_vs_no_thirst: d2,
      hydrated_full_vs_shuffled: d3,
      hot_h_full_vs_no_heat: d4,
    },
    criteria,
    passed: criteria ? Object.values(criteria).filter((c) => c.pass).length : null,
    of: criteria ? Object.keys(criteria).length : null,
    results,
  };
  const name = `${protocolId}-${split}.json`;
  const path = join(root, OUT, name);
  const text = JSON.stringify(record, null, 2) + "\n";
  if (check) {
    const same = existsSync(path) && readFileSync(path, "utf8") === text;
    console.log(`${posix.join(OUT, name)} ${same ? "reproduces" : "does NOT reproduce"}`);
    if (!same) process.exitCode = 1;
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    writeFileSync(
      join(root, OUT, `${protocolId}-${split}-cost.json`),
      JSON.stringify(
        { shards: shards.map((s) => ({ shard: s.shard, wall_s: s.wall_s, cpu: s.cpu })) },
        null,
        2,
      ) + "\n",
    );
    console.log(`wrote ${posix.join(OUT, name)}`);
  }
} else {
  const { report } = await import("./homeostasis-report.js");
  const text = report(root, OUT, protocolId);
  const path = join(root, OUT, "README.md");
  if (check) {
    const same = existsSync(path) && readFileSync(path, "utf8") === text;
    console.log(
      `${OUT}/README.md ${same ? "follows from the records" : "does NOT follow from the records"}`,
    );
    if (!same) process.exitCode = 1;
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    console.log(`wrote ${OUT}/README.md`);
  }
}
