/**
 * Long lives in the ecology (docs/RAIN_GENESIS.md, Stages D and E).
 *
 *   node scripts/run-ts.mjs scripts/ecology-lifetimes.ts run --study learning --split dev --shard 1/4
 *   node scripts/run-ts.mjs scripts/ecology-lifetimes.ts collect --study learning --split dev
 *   ... --study individuality
 *   ... --check     collect: reproduce the record byte for byte from the shards
 *   ... --scratch   a development run from a working tree: never a record
 *
 * `learning` (Stage D): each fly of each yard lives `days` days intact and
 * again with its place memory lesioned, from the same start in the same yard.
 * `individuality` (Stage E): the flies of a yard live `days` days intact, all
 * from the same place and heading, each in its own copy of the yard.
 * Every subject is `research-…`, built from a seed, in the deployed body
 * (artificial maintenance on: none can die). Nothing reads or writes a store,
 * checkpoint, backup or individual, and the script refuses a production host.
 */
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { arch, cpus, platform } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { refuseProductionHost } from "../src/bethesda/firstContact/originals.js";
import { FLY_VERSION } from "../src/bethesda/fly/fly.js";
import { ECOLOGY_VERSION } from "../src/bethesda/ecology/params.js";
import { spinUp } from "../src/bethesda/ecology/life.js";
import {
  GRID,
  LIFETIME_SCHEMA,
  runLifetime,
  type DaySummary,
  type LifetimeArm,
  type LifetimeCheckpoint,
} from "../src/bethesda/ecology/lifetime.js";
import {
  normalized,
  permutationTest,
  repeatability,
  signature,
  toVector,
} from "../src/bethesda/ecology/individuality.js";
import {
  environments,
  type StudyProtocol,
  type StudySplit,
} from "../src/bethesda/ecology/study.js";
import { mulberry32 } from "../src/lib/noise.js";
import { canonicalJson, sha256 } from "../src/rain/sha256.js";

interface LifetimesProtocol extends StudyProtocol {
  learning: {
    days: number;
    dev_days?: number;
    skip_days: number;
    splits: Record<string, StudySplit>;
  };
  individuality: {
    days: number;
    dev_days?: number;
    skip_days: number;
    splits: Record<string, StudySplit>;
  };
  bootstrap: { resamples: number; seed: number };
  permutation: { shuffles: number; seed: number };
  alpha: number;
  criteria: { id: string; study: string; primary?: boolean; rule: string }[];
}

interface Life {
  environment: number;
  seed: number;
  arm: LifetimeArm;
  start: [number, number];
  yaw: number;
  days: DaySummary[];
  fly_hash: string;
  replay_hash: string;
}

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const mode = args.find((a) => ["run", "collect"].includes(a));
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const scratch = args.includes("--scratch");
const check = args.includes("--check");
const study = opt("--study") as "learning" | "individuality" | undefined;
const protocolId = opt("--protocol") ?? "lifetimes-v1";
const SHARDS = ".fly-lifetimes";
const OUT = scratch ? ".fly-lifetimes/records" : "docs/benchmarks/lifetimes";
if (!mode || (study !== "learning" && study !== "individuality")) {
  console.error(
    "usage: ecology-lifetimes.ts run|collect --study learning|individuality [--split S] [--shard k/n] [--scratch] [--check]",
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
const protocol = JSON.parse(protocolText) as LifetimesProtocol;
if (protocol.schema !== LIFETIME_SCHEMA || protocol.id !== protocolId)
  throw new Error(`${protocolPath} is not the protocol ${protocolId}`);
const protocolSha = sha256(protocolText);
const design = protocol[study];
/** Days per life: development splits may run shorter lives (`dev_days`). */
const daysFor = (split: string) =>
  split === "dev" && design.dev_days ? design.dev_days : design.days;

function sourceDigest(): string {
  const IMPORT = /\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g;
  const files: Record<string, string> = {};
  const queue = ["scripts/ecology-lifetimes.ts"];
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

/** Where a life's day-end checkpoint is kept (outside Git). */
const checkpointPath = (split: string, env: number, seed: number, arm: string) =>
  join(
    root,
    SHARDS,
    "checkpoints",
    `${protocolId}-${study}-${split}-${env}-${seed}-${arm}.json`,
  );

/** A checkpoint made by this exact code and protocol, or null (one from anything else is refused). */
function loadCheckpoint(path: string): LifetimeCheckpoint | null {
  if (!existsSync(path)) return null;
  const c = JSON.parse(readFileSync(path, "utf8")) as {
    source: string;
    protocol_sha256: string;
    checkpoint: LifetimeCheckpoint;
  };
  if (c.source !== sourceDigest() || c.protocol_sha256 !== protocolSha)
    throw new Error(
      `${path} was made by other code or another protocol: remove it to start over`,
    );
  process.stderr.write(`  resuming after day ${c.checkpoint.days.length}\n`);
  return c.checkpoint;
}

function saveCheckpoint(path: string, c: LifetimeCheckpoint): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(
    tmp,
    JSON.stringify({
      source: sourceDigest(),
      protocol_sha256: protocolSha,
      checkpoint: c,
    }),
  );
  renameSync(tmp, path);
}

if (mode === "run") {
  const split = opt("--split") ?? "dev";
  const [k, n] = (opt("--shard") ?? "1/1").split("/").map(Number) as [number, number];
  if (!(k >= 1 && k <= n)) throw new Error("--shard k/n with 1 ≤ k ≤ n");
  const prov = provenance();
  const envs = environments(protocol, design.splits[split]!);
  // One unit of work: a yard, a fly, an arm.
  const arms: LifetimeArm[] =
    study === "learning" ? ["intact", "no-place-memory"] : ["intact"];
  const units = envs.flatMap((env) =>
    env.starts.flatMap((start) => arms.map((arm) => ({ env, start, arm }))),
  );
  const mine = units.filter((_, i) => i % n === k - 1);
  const t0 = performance.now();
  const lives: Life[] = [];
  const cost: { environment: number; seed: number; arm: string; wall_s: number }[] = [];
  const worlds = new Map<number, ReturnType<typeof spinUp>>();
  for (const { env, start, arm } of mine) {
    if (!worlds.has(env.index))
      worlds.set(env.index, spinUp(env.spec, protocol.spin_up_s));
    // Individuality: every fly from the yard's first start, so only the fly differs.
    const from = study === "individuality" ? env.starts[0]! : start;
    process.stderr.write(
      `${study} ${split} env ${env.index} seed ${start.seed} ${arm}\n`,
    );
    const a0 = performance.now();
    const { days, life } = runLifetime(
      env.spec,
      worlds.get(env.index)!,
      {
        subject: `research-${study}-${split}-${env.index}-${start.seed}-${arm}`,
        seed: start.seed,
        start: from.at,
        yaw: from.yaw,
        startReserve: 1,
      },
      arm,
      daysFor(split),
      {
        onDay: (d) =>
          process.stderr.write(`  day ${d.day}: fed ${d.fed_j} J, places ${d.places}\n`),
        // A life is checkpointed after every day, under the code and protocol
        // that run it, so a stopped run resumes where it stopped.
        resume: loadCheckpoint(checkpointPath(split, env.index, start.seed, arm)),
        save: (c) => saveCheckpoint(checkpointPath(split, env.index, start.seed, arm), c),
      },
    );
    lives.push({
      environment: env.index,
      seed: start.seed,
      arm,
      start: from.at,
      yaw: from.yaw,
      days,
      fly_hash: life.fly!.stateHash(),
      replay_hash: life.eco.stateHash(),
    });
    cost.push({
      environment: env.index,
      seed: start.seed,
      arm,
      wall_s: r6((performance.now() - a0) / 1000),
    });
  }
  const path = join(
    root,
    SHARDS,
    `${protocolId}-${study}-${split}-shard-${k}-of-${n}.json`,
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        protocol: protocolId,
        protocol_sha256: protocolSha,
        study,
        source: sourceDigest(),
        provenance: prov,
        split,
        shard: [k, n],
        wall_s: r6((performance.now() - t0) / 1000),
        cpu: cpus()[0]?.model ?? "unknown",
        cost,
        lives,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${posix.relative(root, path)}`);
} else {
  const split = opt("--split") ?? "dev";
  const files = readdirSync(join(root, SHARDS)).filter((f) =>
    f.startsWith(`${protocolId}-${study}-${split}-shard-`),
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
  const lives: Life[] = shards
    .flatMap((s) => s.lives as Life[])
    .sort(
      (a, b) =>
        a.environment - b.environment || a.seed - b.seed || (a.arm < b.arm ? -1 : 1),
    );
  const skip = design.skip_days;
  const used = (l: Life) => l.days.slice(skip);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  let analysis: Record<string, unknown>;
  let criteria: Record<string, { pass: boolean; value: unknown }> | null = null;
  if (study === "learning") {
    // Per yard: the mean over its flies of the mean daily value over the used days.
    const envs = [...new Set(lives.map((l) => l.environment))].sort((a, b) => a - b);
    const perEnv = (arm: LifetimeArm, f: (d: DaySummary) => number) =>
      envs.map((e) =>
        mean(
          lives
            .filter((l) => l.environment === e && l.arm === arm)
            .map((l) => mean(used(l).map(f))),
        ),
      );
    const boot = (f: (d: DaySummary) => number) => {
      const a = perEnv("intact", f);
      const b = perEnv("no-place-memory", f);
      const diffs = a.map((x, i) => x - b[i]!);
      const est = mean(diffs);
      const rng = mulberry32(protocol.bootstrap.seed >>> 0);
      const vals: number[] = [];
      for (let s = 0; s < protocol.bootstrap.resamples; s++)
        vals.push(mean(diffs.map(() => diffs[Math.floor(rng() * diffs.length)]!)));
      vals.sort((x, y) => x - y);
      const q = (u: number) =>
        vals[Math.min(vals.length - 1, Math.floor(u * vals.length))]!;
      return {
        estimate: r6(est),
        lo: r6(q(0.025)),
        hi: r6(q(0.975)),
        intact: r6(mean(a)),
        lesioned: r6(mean(b)),
      };
    };
    const fed = boot((d) => d.fed_j);
    const maint = boot((d) => d.maintenance_j);
    const flight = boot((d) => d.flight_s);
    analysis = {
      fed_j: fed,
      maintenance_j: maint,
      flight_s: flight,
      places: boot((d) => d.places),
    };
    criteria =
      split === "heldout"
        ? {
            D1: { pass: fed.lo > 0, value: fed },
            D2: { pass: maint.hi < 0, value: maint },
          }
        : null;
  } else {
    const P = protocol.permutation;
    const flies = lives.filter((l) => l.arm === "intact");
    const days = flies.map(used);
    const scalar = (f: (d: DaySummary) => number) =>
      permutationTest(
        days.map((ds) => ds.map(f)),
        repeatability,
        P.shuffles,
        P.seed,
      );
    const sites = [
      ...new Set(days.flat().flatMap((d) => Object.keys(d.feed_by_site))),
    ].sort();
    const profile = (f: (d: DaySummary) => number[]) =>
      permutationTest(
        days.map((ds) => ds.map(f)),
        signature,
        P.shuffles,
        P.seed,
      );
    const occupancy = profile((d) => d.occupancy);
    const feeding = profile((d) => normalized(toVector(d.feed_by_site, sites)));
    const hours = profile((d) => normalized(d.active_by_hour));
    analysis = {
      grid: GRID,
      sites,
      occupancy_signature: occupancy,
      feeding_site_signature: feeding,
      active_hours_signature: hours,
      fed_j_repeatability: scalar((d) => d.fed_j),
      flight_s_repeatability: scalar((d) => d.flight_s),
      distance_repeatability: scalar((d) => d.distance_m),
    };
    criteria =
      split === "heldout"
        ? {
            E1: { pass: occupancy.p < protocol.alpha, value: occupancy },
            E2: { pass: feeding.p < protocol.alpha, value: feeding },
            E3: {
              pass: (analysis.flight_s_repeatability as { p: number }).p < protocol.alpha,
              value: analysis.flight_s_repeatability,
            },
          }
        : null;
  }
  const record = {
    schema: "ecology-lifetimes-result/v1",
    protocol: protocolId,
    protocol_sha256: protocolSha,
    study,
    split,
    versions: { ecology: ECOLOGY_VERSION, fly: FLY_VERSION },
    provenance: shards[0].provenance,
    source: shards[0].source,
    lives: lives.length,
    days: daysFor(split),
    skip_days: skip,
    analysis,
    criteria,
    passed: criteria ? Object.values(criteria).filter((c) => c.pass).length : null,
    of: criteria ? Object.keys(criteria).length : null,
    results: lives,
  };
  const name = `${protocolId}-${study}-${split}.json`;
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
      join(root, OUT, `${protocolId}-${study}-${split}-cost.json`),
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
