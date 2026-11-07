/**
 * A research fly's causal trace in the ecology, and a page to read it
 * (docs/RAIN_GENESIS.md, Stage F).
 *
 *   node scripts/run-ts.mjs scripts/ecology-trace.ts            # write docs/benchmarks/ecology-trace/
 *   node scripts/run-ts.mjs scripts/ecology-trace.ts --check    # reproduce it byte for byte
 *   ... --scratch   from a working tree, into .fly-ecology/trace/
 *
 * One mortal research fly with homeostatic feedback in the homeostasis study's
 * first development yard (homeostasis-v1, dev environment 0, fly seed 301),
 * for 8 simulated hours after the yard's two-day spin-up, sampled every 30 s
 * by the read-only `Tracer`. Writes the trace (JSON) and a self-contained page
 * (index.html) that draws it. Every subject is `research-…`; nothing reads or
 * writes Eva, ECHO or any store, and the script refuses a production host.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { refuseProductionHost } from "../src/bethesda/firstContact/originals.js";
import { ECOLOGY_VERSION } from "../src/bethesda/ecology/params.js";
import { HOMEOSTASIS_VERSION } from "../src/bethesda/ecology/homeostasis.js";
import { cloneEcosystem, EcologicalLife, spinUp } from "../src/bethesda/ecology/life.js";
import { environments, type StudyProtocol } from "../src/bethesda/ecology/study.js";
import { PROVENANCE, TRACE_SCHEMA, Tracer } from "../src/bethesda/ecology/trace.js";
import { page } from "./ecology-trace-page.js";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const scratch = args.includes("--scratch");
const outDir = scratch ? ".fly-ecology/trace" : "docs/benchmarks/ecology-trace";
refuseProductionHost(resolve(root, outDir), existsSync);
const git = (c: string) => execSync(`git ${c}`, { cwd: root, encoding: "utf8" }).trim();
if (!scratch && !check && git("status --porcelain"))
  throw new Error(
    "a record is made only from a clean commit; commit first, or pass --scratch",
  );

const protocol = JSON.parse(
  readFileSync(join(root, "src/bethesda/ecology/protocols/homeostasis-v1.json"), "utf8"),
) as StudyProtocol;
const env = environments(protocol, protocol.splits.dev!)[0]!;
const start = env.starts[0]!;
const world = spinUp(env.spec, protocol.spin_up_s);
const life = new EcologicalLife(
  env.spec,
  {
    subject: "research-trace-dev-0-301",
    seed: start.seed,
    start: start.at,
    yaw: start.yaw,
    startReserve: 1,
  },
  { kind: "mortal", thirst: true, thermal: true },
  cloneEcosystem(world),
);
const tracer = new Tracer(life);
const every = 300; // ticks: 30 s
const total = Math.round(protocol.horizon_s / 0.1);
tracer.sample();
for (let k = 0; k < total && life.alive; k += every) {
  life.step(every);
  tracer.sample();
}
const trace = {
  schema: TRACE_SCHEMA,
  versions: { ecology: ECOLOGY_VERSION, homeostasis: HOMEOSTASIS_VERSION },
  subject: "research-trace-dev-0-301",
  source:
    "homeostasis-v1, development environment 0, fly seed 301, mortal body with thirst and heat feedback",
  commit: check ? null : git("rev-parse HEAD"),
  provenance: PROVENANCE,
  yard: {
    half: env.spec.half,
    trees: env.spec.trees,
    springs: env.spec.springs,
    rocks: env.spec.rocks,
    flowers: env.spec.flowers,
  },
  alive_at_end: life.alive,
  cause: life.homeostasis?.state.cause ?? null,
  samples: tracer.samples,
};
const files: [string, string][] = [
  ["trace.json", JSON.stringify(trace) + "\n"],
  ["index.html", page(trace)],
];
for (const [name, text] of files) {
  const path = join(root, outDir, name);
  if (check) {
    const old = existsSync(path) ? readFileSync(path, "utf8") : null;
    const normalize = (t: string | null) =>
      t?.replace(/"commit":"[0-9a-f]+"/, '"commit":null') ?? null;
    const same = normalize(old) === normalize(text);
    console.log(`${outDir}/${name} ${same ? "reproduces" : "does NOT reproduce"}`);
    if (!same) process.exitCode = 1;
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    console.log(`wrote ${outDir}/${name}`);
  }
}
