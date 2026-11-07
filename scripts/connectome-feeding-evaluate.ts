/**
 * The connectome-hybrid study (docs/RAIN_GENESIS.md, Stage C).
 *
 *   node scripts/run-ts.mjs scripts/connectome-feeding-evaluate.ts calibrate              # where the circuit's readout crosses its threshold
 *   node scripts/run-ts.mjs scripts/connectome-feeding-evaluate.ts run --split dev --shard 1/4
 *   node scripts/run-ts.mjs scripts/connectome-feeding-evaluate.ts collect --split dev
 *   ... --check     collect: reproduce the record byte for byte from the shards
 *   ... --scratch   a development run from a working tree: never a record
 *
 * The circuit is read from $FLY_NEURAL_DATA/reduced/<id>.json (default
 * ~/.cache/fly-neural), made by `python -m fly_neural reduce cut` from the
 * pinned FlyWire release; it is a connectivity table derived from FlyWire data
 * and stays outside the repository. Its SHA-256 must equal the protocol's.
 * Every subject is `research-…`, built from a seed; nothing reads or writes a
 * store, checkpoint, backup or individual, and the script refuses a production
 * host.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { arch, cpus, homedir, platform } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { refuseProductionHost } from "../src/bethesda/firstContact/originals.js";
import { FLY_VERSION } from "../src/bethesda/fly/fly.js";
import { mulberry32 } from "../src/lib/noise.js";
import { HOMEOSTASIS_VERSION } from "../src/bethesda/ecology/homeostasis.js";
import { ECOLOGY_VERSION } from "../src/bethesda/ecology/params.js";
import { spinUp } from "../src/bethesda/ecology/life.js";
import { environments } from "../src/bethesda/ecology/study.js";
import { FEEDING_HYBRID_VERSION } from "../src/bethesda/ecology/connectome/feeding.js";
import {
  ReducedCircuit,
  type CircuitFile,
} from "../src/bethesda/ecology/connectome/lif.js";
import {
  armBout,
  armMean,
  armSurvival,
  bootstrap,
  FEEDING_ARMS,
  FEEDING_STUDY_SCHEMA,
  runFeedingArm,
  type FeedingProtocol,
  type FeedingResult,
} from "../src/bethesda/ecology/connectome/study.js";
import { canonicalJson, sha256 } from "../src/rain/sha256.js";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const mode = args.find((a) => ["calibrate", "run", "collect"].includes(a));
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const scratch = args.includes("--scratch");
const check = args.includes("--check");
const protocolId = opt("--protocol") ?? "connectome-feeding-v1";
const SHARDS = ".fly-feeding";
const OUT = scratch ? ".fly-feeding/records" : "docs/benchmarks/connectome-feeding";
if (!mode) {
  console.error(
    "usage: connectome-feeding-evaluate.ts calibrate|run|collect [--split S] [--shard k/n] [--scratch] [--check]",
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
const protocol = JSON.parse(protocolText) as FeedingProtocol;
if (protocol.schema !== FEEDING_STUDY_SCHEMA || protocol.id !== protocolId)
  throw new Error(`${protocolPath} is not the protocol ${protocolId}`);
const protocolSha = sha256(protocolText);

const dataDir = process.env.FLY_NEURAL_DATA ?? join(homedir(), ".cache", "fly-neural");
const circuitPath = join(dataDir, "reduced", `${protocol.circuit.id}.json`);
if (!existsSync(circuitPath))
  throw new Error(
    `${circuitPath} is missing: make it with \`python -m fly_neural reduce cut\` (fly-neural/)`,
  );
const circuitText = readFileSync(circuitPath, "utf8");
const circuitSha = createHash("sha256").update(circuitText).digest("hex");
const circuit = JSON.parse(circuitText) as CircuitFile;
if (mode !== "calibrate" && circuitSha !== protocol.circuit.sha256)
  throw new Error(
    `${circuitPath} is not the protocol's circuit (sha256 ${circuitSha.slice(0, 12)}, the protocol pins ${protocol.circuit.sha256.slice(0, 12)})`,
  );

/** The study's code: every file reached by relative imports from this script. */
function sourceDigest(): string {
  const IMPORT = /\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g;
  const files: Record<string, string> = {};
  const queue = ["scripts/connectome-feeding-evaluate.ts"];
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

if (mode === "calibrate") {
  // The intact circuit's steady readout against its input rate: where it crosses the threshold.
  const f = protocol.feeding;
  const rows: { rate_hz: number; readout_hz: number }[] = [];
  for (let rate = 10; rate <= f.max_rate_hz; rate += 2) {
    let sum = 0;
    const trials = 40;
    for (let k = 0; k < trials; k++) {
      const c = new ReducedCircuit(circuit);
      const rng = mulberry32((7_000_003 + rate * 1000 + k) >>> 0);
      c.run(1000, rate, rng);
      sum += c.readoutRateHz(f.window_ms);
    }
    rows.push({ rate_hz: rate, readout_hz: r6(sum / trials) });
  }
  const cross = rows.find((r) => r.readout_hz >= f.threshold_hz);
  console.log(JSON.stringify({ circuit: circuitSha, rows }, null, 0));
  console.log(
    cross
      ? `readout first reaches ${f.threshold_hz} Hz at ${cross.rate_hz} Hz input: hunger ${r6(cross.rate_hz / f.max_rate_hz)}`
      : "the readout never reaches its threshold",
  );
} else if (mode === "run") {
  const split = opt("--split") ?? "dev";
  const [k, n] = (opt("--shard") ?? "1/1").split("/").map(Number) as [number, number];
  if (!(k >= 1 && k <= n)) throw new Error("--shard k/n with 1 ≤ k ≤ n");
  const prov = provenance();
  const envs = environments(protocol, protocol.splits[split]!);
  const which = envs.filter((e) => e.index % n === k - 1);
  const t0 = performance.now();
  const results: FeedingResult[] = [];
  const cost: {
    environment: number;
    seed: number;
    arm: string;
    wall_s: number;
    circuit_s: number;
  }[] = [];
  for (const env of which) {
    const world = spinUp(env.spec, protocol.spin_up_s);
    for (const start of env.starts)
      for (const arm of FEEDING_ARMS) {
        process.stderr.write(`${split} env ${env.index} seed ${start.seed} ${arm}\n`);
        const a0 = performance.now();
        const { result, circuitWallMs } = runFeedingArm(
          protocol,
          env,
          start,
          arm,
          world,
          split,
          circuit,
        );
        results.push(result);
        cost.push({
          environment: env.index,
          seed: start.seed,
          arm,
          wall_s: r6((performance.now() - a0) / 1000),
          circuit_s: r6(circuitWallMs / 1000),
        });
      }
  }
  const path = join(root, SHARDS, `${protocolId}-${split}-shard-${k}-of-${n}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        protocol: protocolId,
        protocol_sha256: protocolSha,
        circuit_sha256: circuitSha,
        source: sourceDigest(),
        provenance: prov,
        split,
        shard: [k, n],
        environments: which.map((e) => e.index),
        wall_s: r6((performance.now() - t0) / 1000),
        cpu: cpus()[0]?.model ?? "unknown",
        cost,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${posix.relative(root, path)}`);
} else {
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
    if (s.circuit_sha256 !== circuitSha) throw new Error("a shard ran another circuit");
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
  const results: FeedingResult[] = shards
    .flatMap((s) => s.results as FeedingResult[])
    .sort(
      (a, b) =>
        a.environment - b.environment ||
        a.seed - b.seed ||
        FEEDING_ARMS.indexOf(a.arm) - FEEDING_ARMS.indexOf(b.arm),
    );
  const B = protocol.bootstrap;
  const m = protocol.noninferiority_margin;
  const fed = (arm: (typeof FEEDING_ARMS)[number]) => armMean(arm, "fed_j");
  const reserve = (arm: (typeof FEEDING_ARMS)[number]) => armMean(arm, "mean_reserve");
  const c1 = bootstrap(
    results,
    (rs) => reserve("connectome")(rs) - (1 - m) * reserve("controller")(rs),
    B.resamples,
    B.seed,
  );
  const c2 = bootstrap(
    results,
    (rs) => reserve("connectome")(rs) - reserve("shuffled")(rs),
    B.resamples,
    B.seed,
  );
  const runs = shards
    .flatMap(
      (s) =>
        s.cost as {
          environment: number;
          seed: number;
          arm: string;
          wall_s: number;
          circuit_s: number;
        }[],
    )
    .filter((c) => c.arm === "connectome");
  const drivenS = results
    .filter((r) => r.arm === "connectome")
    .reduce((a, r) => a + (r.hybrid?.driven_s ?? 0), 0);
  const circuitPerDriven =
    runs.reduce((a, c) => a + c.circuit_s, 0) / Math.max(1e-9, drivenS);
  const circuitShare =
    runs.reduce((a, c) => a + c.circuit_s, 0) /
    Math.max(
      1e-9,
      runs.reduce((a, c) => a + c.wall_s, 0),
    );
  const starved = (arm: string) =>
    results.filter((r) => r.arm === arm && r.cause === "starvation").length;
  const boutRatio =
    armBout("controller")(results) > 0
      ? armBout("connectome")(results) / armBout("controller")(results)
      : 0;
  const differences = {
    fed_connectome_vs_controller: bootstrap(
      results,
      (rs) => fed("connectome")(rs) - fed("controller")(rs),
      B.resamples,
      B.seed,
    ),
    fed_connectome_vs_threshold: bootstrap(
      results,
      (rs) => fed("connectome")(rs) - fed("threshold")(rs),
      B.resamples,
      B.seed,
    ),
    survival_connectome_vs_controller: bootstrap(
      results,
      (rs) => armSurvival("connectome")(rs) - armSurvival("controller")(rs),
      B.resamples,
      B.seed,
    ),
    fed_connectome_vs_shuffled: bootstrap(
      results,
      (rs) => fed("connectome")(rs) - fed("shuffled")(rs),
      B.resamples,
      B.seed,
    ),
    reserve_connectome_vs_threshold: bootstrap(
      results,
      (rs) => reserve("connectome")(rs) - reserve("threshold")(rs),
      B.resamples,
      B.seed,
    ),
    reserve_connectome_vs_controller: bootstrap(
      results,
      (rs) =>
        armMean("connectome", "mean_reserve")(rs) -
        armMean("controller", "mean_reserve")(rs),
      B.resamples,
      B.seed,
    ),
  };
  const criteria =
    split === "heldout"
      ? {
          C1: { pass: c1.lo > 0, value: c1 },
          C2: { pass: c2.lo > 0, value: c2 },
          C3: {
            pass: starved("connectome") <= starved("controller"),
            value: {
              connectome: starved("connectome"),
              controller: starved("controller"),
            },
          },
          C4: {
            pass: circuitPerDriven <= protocol.max_circuit_s_per_driven_s,
            value: r6(circuitPerDriven),
          },
        }
      : null;
  const per = (
    f: (arm: (typeof FEEDING_ARMS)[number]) => (rs: FeedingResult[]) => number,
  ) => Object.fromEntries(FEEDING_ARMS.map((a) => [a, r6(f(a)(results))]));
  const record = {
    schema: "connectome-feeding-result/v1",
    protocol: protocolId,
    protocol_sha256: protocolSha,
    circuit: {
      id: circuit.id,
      sha256: circuitSha,
      neurons: circuit.neurons,
      pairs: circuit.indices.length,
    },
    split,
    versions: {
      ecology: ECOLOGY_VERSION,
      homeostasis: HOMEOSTASIS_VERSION,
      fly: FLY_VERSION,
      hybrid: FEEDING_HYBRID_VERSION,
    },
    provenance: shards[0].provenance,
    source: shards[0].source,
    trials: results.length,
    survival: per(armSurvival),
    mean_fed_j: per((a) => armMean(a, "fed_j")),
    mean_feed_s: per((a) => armMean(a, "feed_s")),
    mean_reserve: per((a) => armMean(a, "mean_reserve")),
    mean_bout_s: per(armBout),
    bout_ratio_connectome_to_controller: r6(boutRatio),
    circuit_share_of_wall_time: r6(circuitShare),
    circuit_s_per_driven_s: r6(circuitPerDriven),
    starved: Object.fromEntries(FEEDING_ARMS.map((a) => [a, starved(a)])),
    differences,
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
        {
          shards: shards.map((s) => ({
            shard: s.shard,
            wall_s: s.wall_s,
            cpu: s.cpu,
            runs: s.cost,
          })),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`wrote ${posix.join(OUT, name)}`);
  }
}
