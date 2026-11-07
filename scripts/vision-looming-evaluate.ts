/**
 * The research compound eye's looming battery (docs/FLY_VISION.md).
 *
 *   node scripts/run-ts.mjs scripts/vision-looming-evaluate.ts dev --protocol looming-v2      # development split: select thresholds
 *   node scripts/run-ts.mjs scripts/vision-looming-evaluate.ts heldout --protocol looming-v2  # held-out split, once, at the dev selection
 *   node scripts/run-ts.mjs scripts/vision-looming-evaluate.ts report                         # README from every protocol's records
 *   ... --check     reproduce the committed file byte for byte (this platform, and code whose
 *                   battery digest is the record's: check a record out at the commit it names)
 *   ... --scratch   run from a working tree; writes to .fly-vision/, never a result
 *
 * Every subject is a new research fly built from a seed (`research-vision-…`).
 * Nothing here reads or writes Eva, ECHO, a store, a checkpoint, a backup or a
 * ledger, and it refuses a production host. A result is written only from a
 * clean commit and names it; the held-out split refuses to run unless the
 * development record was made by the same code and protocol.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { refuseProductionHost } from "../src/bethesda/firstContact/originals.js";
import { ECHO_VERSION } from "../src/bethesda/fly/echo/params.js";
import { FLY_VERSION } from "../src/bethesda/fly/fly.js";
import { PARAMS } from "../src/bethesda/fly/params.js";
import { ORGANISM_LIFE } from "../src/bethesda/life/organism.js";
import {
  generate,
  heldRun,
  liveRun,
  PROTOCOL_SCHEMA,
  trial,
  type HeldSeries,
  type Protocol,
  type Stimulus,
} from "../src/bethesda/vision/battery.js";
import { LATTICE, LOOMING_UNITS } from "../src/bethesda/vision/lattice.js";
import { VISION_PARAMS, VISION_VERSIONS } from "../src/bethesda/vision/params.js";
import {
  bootstrap,
  envelope,
  f1Of,
  firstCrossing,
  metrics,
  scoreTrial,
  select,
  type Envelope,
  type Metrics,
  type Scored,
  type TrialTruth,
} from "../src/bethesda/vision/score.js";
import { canonicalJson, sha256 } from "../src/rain/sha256.js";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
/** Every protocol, in the order they were frozen. */
export const PROTOCOLS = ["looming-v1", "looming-v2"] as const;
const OUT = "docs/benchmarks/fly-vision";
const SCRATCH = ".fly-vision";
const RESULT_SCHEMA = "vision-looming-result/v1";

const args = process.argv.slice(2);
const mode = args.find((a) => ["dev", "heldout", "report"].includes(a));
const check = args.includes("--check");
const scratch = args.includes("--scratch");
const pAt = args.indexOf("--protocol");
const protocolId = pAt >= 0 ? args[pAt + 1]! : "looming-v2";
if (!(PROTOCOLS as readonly string[]).includes(protocolId))
  throw new Error(`no protocol ${protocolId}: ${PROTOCOLS.join(", ")}`);
const PROTOCOL_PATH = `src/bethesda/vision/protocols/${protocolId}.json`;
if (!mode || !["dev", "heldout", "report"].includes(mode)) {
  console.error(
    "usage: vision-looming-evaluate.ts dev|heldout|report [--check] [--scratch]",
  );
  process.exit(2);
}

const git = (cmd: string) =>
  execSync(`git ${cmd}`, { cwd: root, encoding: "utf8" }).trim();
const outDir = scratch ? SCRATCH : OUT;
refuseProductionHost(resolve(root, outDir), existsSync);

const protocolText = readFileSync(join(root, PROTOCOL_PATH), "utf8");
const protocol = JSON.parse(protocolText) as Protocol & {
  selection: { min_recall: number; grid: number };
  bootstrap: { resamples: number; seed: number };
};
if (protocol.schema !== PROTOCOL_SCHEMA) throw new Error("not a looming protocol");
if (!(protocol.vision_version in VISION_VERSIONS))
  throw new Error(`the protocol names ${protocol.vision_version}, which no eye here is`);
if (protocol.id !== protocolId) throw new Error(`${PROTOCOL_PATH} is ${protocol.id}`);
const protocolSha = sha256(protocolText.replace(/\r\n?/g, "\n"));

/** The battery's code: every file reached by relative imports from this script, LF-normalized. */
function sourceDigest(): { sha256: string; files: Record<string, string> } {
  const IMPORT = /\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g;
  const files: Record<string, string> = {};
  const queue = ["scripts/vision-looming-evaluate.ts"];
  while (queue.length) {
    const path = queue.shift()!;
    if (files[path]) continue;
    const text = readFileSync(join(root, path), "utf8").replace(/\r\n?/g, "\n");
    files[path] = sha256(text);
    if (!/\.tsx?$/.test(path)) continue;
    for (const m of text.matchAll(IMPORT)) {
      const target = posix.normalize(posix.join(posix.dirname(path), m[1]!));
      const base = target.endsWith(".js") ? target.slice(0, -3) : target;
      const found = [`${base}.ts`, `${base}.tsx`, target].find((c) =>
        existsSync(join(root, c)),
      );
      if (!found) throw new Error(`${path} imports ${m[1]}, which does not exist`);
      queue.push(found);
    }
  }
  const sorted = Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  return { sha256: sha256(canonicalJson(sorted)), files: sorted };
}

function provenance() {
  const dirty = git("status --porcelain");
  if (dirty && !scratch && !check)
    throw new Error(
      "a result is made only from a clean commit; commit first, or pass --scratch for a development run",
    );
  return {
    commit: git("rev-parse HEAD"),
    clean: !dirty,
    platform: `${platform()} ${arch()}`,
    node: process.version,
  };
}

const ARMS = [
  "deployed",
  "geometric-tuned",
  "eye-lplc2",
  "eye-expansion",
  "eye-shuffled",
  "size-heuristic",
  "tau-heuristic",
] as const;
type Arm = (typeof ARMS)[number];
const TUNED = ARMS.filter((a) => a !== "deployed");

interface TrialRecord {
  stimulus: number;
  seed: number;
  kind: string;
  contrast: number;
  ambient: number;
  threat: boolean;
  tOn: number;
  tCollision: number | null;
  minSurfaceM: number;
  /** The deployed controller's first escape command in the held run. */
  deployedEscape: number | null;
  envelopes: Record<Exclude<Arm, "deployed">, Envelope>;
}

function seriesOf(h: HeldSeries, arm: Exclude<Arm, "deployed">): number[] {
  switch (arm) {
    case "geometric-tuned":
      return h.geometricDrive;
    case "eye-lplc2":
      return h.lplc2;
    case "eye-expansion":
      return h.expansion;
    case "eye-shuffled":
      return h.shuffled;
    case "size-heuristic":
      return h.sizeDeg;
    case "tau-heuristic":
      return h.inverseTau;
  }
}

const truthOf = (r: TrialRecord): TrialTruth => ({
  stimulus: r.stimulus,
  kind: r.kind,
  threat: r.threat,
  tOn: r.tOn,
  tCollision: r.tCollision,
});

function decision(r: TrialRecord, arm: Arm, threshold: number | null): number | null {
  if (arm === "deployed") return r.deployedEscape;
  return firstCrossing(r.envelopes[arm], threshold!);
}

interface Cost {
  heldWallS: number;
  liveWallS: number;
  simS: number;
}

function runHeld(
  split: string,
  stimuli: Stimulus[],
  seeds: number[],
  cost: Cost,
): TrialRecord[] {
  const out: TrialRecord[] = [];
  const total = stimuli.length * seeds.length;
  for (const s of stimuli) {
    const tr = trial(protocol, s);
    for (const seed of seeds) {
      const h = heldRun(protocol, split, tr, seed, () => performance.now() / 1000);
      cost.heldWallS += h.wallS;
      cost.simS += h.simS;
      const env = Object.fromEntries(
        TUNED.map((a) => [a, envelope(h.t, seriesOf(h, a))]),
      ) as TrialRecord["envelopes"];
      out.push({
        stimulus: s.index,
        seed,
        kind: s.kind,
        contrast: s.contrast,
        ambient: s.ambient,
        threat: tr.truth.threat,
        tOn: tr.truth.tOn,
        tCollision: tr.truth.tCollision,
        minSurfaceM: Number(tr.truth.minSurfaceM.toPrecision(6)),
        deployedEscape: h.deployedEscape,
        envelopes: env,
      });
      if (out.length % 25 === 0 || out.length === total)
        process.stderr.write(`${split} held ${out.length}/${total}\n`);
    }
  }
  return out;
}

function armMetrics(records: TrialRecord[], arm: Arm, threshold: number | null): Metrics {
  return metrics(
    records.map(truthOf),
    records.map((r) => scoreTrial(truthOf(r), decision(r, arm, threshold))),
  );
}

/** Metrics by a grouping of trials (kind, contrast sign, illumination). */
function breakdown(
  records: TrialRecord[],
  arm: Arm,
  threshold: number | null,
  key: (r: TrialRecord) => string,
): Record<string, { trials: number; escapes: number; hits?: number; threats?: number }> {
  const out: Record<
    string,
    { trials: number; escapes: number; hits?: number; threats?: number }
  > = {};
  for (const r of records) {
    const k = key(r);
    const b = (out[k] ??= { trials: 0, escapes: 0 });
    const s = scoreTrial(truthOf(r), decision(r, arm, threshold));
    b.trials++;
    if (s.outcome !== "correct-rejection" && s.outcome !== "miss") b.escapes++;
    if (r.threat) {
      b.threats = (b.threats ?? 0) + 1;
      if (s.outcome === "hit") b.hits = (b.hits ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function header(split: string) {
  return {
    schema: RESULT_SCHEMA,
    protocol: protocol.id,
    protocol_sha256: protocolSha,
    split,
    vision_version: protocol.vision_version,
    versions: {
      fly: FLY_VERSION,
      echo: ECHO_VERSION,
      organism: ORGANISM_LIFE.versions,
    },
    eye: {
      ommatidia: LATTICE.n,
      looming_units: LOOMING_UNITS.n,
      unit_memberships: LOOMING_UNITS.member.length,
      params: Object.fromEntries(
        Object.entries(VISION_PARAMS).map(([k, v]) => [
          k,
          { value: v.value, unit: v.unit, kind: v.kind },
        ]),
      ),
      deployed_gf_threshold: PARAMS.gfThreshold.value,
    },
    subjects:
      "New research flies built from seeds (research-vision-<split>-<stimulus>-<seed>); none is Eva or ECHO, a copy or a continuation.",
  };
}

function write(name: string, value: unknown): void {
  const text = JSON.stringify(value, null, 2) + "\n";
  const path = join(root, outDir, name);
  if (check) {
    const old = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (old !== text) {
      console.error(`${posix.join(outDir, name)} does not reproduce`);
      process.exitCode = 1;
    } else console.log(`${posix.join(outDir, name)} reproduces byte for byte`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`wrote ${posix.join(outDir, name)}`);
}

/** In --check mode, the provenance and timings the committed file recorded. */
function recorded(
  name: string,
): { provenance?: unknown; source?: { sha256: string } } | null {
  const path = join(root, outDir, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

const r6 = (x: number) => Number(x.toPrecision(6));

function devMode(): void {
  const split = protocol.splits.dev!;
  const source = sourceDigest();
  const prov = provenance();
  const stimuli = generate(split);
  const cost: Cost = { heldWallS: 0, liveWallS: 0, simS: 0 };
  const records = runHeld("dev", stimuli, split.fly_seeds, cost);
  const truths = records.map(truthOf);
  const selections: Record<string, unknown> = {};
  const thresholds: Partial<Record<Arm, number>> = {};
  for (const arm of TUNED) {
    const sel = select(
      truths,
      records.map((r) => r.envelopes[arm]),
      protocol.selection.min_recall,
      protocol.selection.grid,
    );
    thresholds[arm] = sel.threshold;
    selections[arm] = sel;
  }
  selections["deployed"] = {
    threshold: PARAMS.gfThreshold.value,
    metrics: armMetrics(records, "deployed", null),
    rule: "deployed threshold, untuned",
  };
  const name = `${protocol.id}-dev.json`;
  const old = check ? recorded(name) : null;
  write(name, {
    ...header("dev"),
    provenance: check && old ? old.provenance : prov,
    source,
    stimuli,
    selection: selections,
    eye_gain: PARAMS.gfThreshold.value / thresholds["eye-lplc2"]!,
    by_kind: Object.fromEntries(
      ARMS.map((a) => [a, breakdown(records, a, thresholds[a] ?? null, (r) => r.kind)]),
    ),
    trials: records,
  });
  if (!check)
    writeFileSync(
      join(root, outDir, `${protocol.id}-dev-cost.json`),
      JSON.stringify({ ...cost, machine: machine() }, null, 2) + "\n",
    );
}

function machine() {
  return {
    platform: `${platform()} ${arch()}`,
    node: process.version,
    cpus: cpus().length,
    cpu: cpus()[0]?.model ?? "unknown",
    memory_gb: Math.round(totalmem() / 1e9),
  };
}

function heldoutMode(): void {
  const devPath = join(root, outDir, `${protocol.id}-dev.json`);
  if (!existsSync(devPath)) throw new Error("the development split has not run");
  const dev = JSON.parse(readFileSync(devPath, "utf8"));
  const source = sourceDigest();
  if (dev.protocol_sha256 !== protocolSha)
    throw new Error("the development record was made under another protocol");
  if (dev.source.sha256 !== source.sha256)
    throw new Error("the development record was made by other code: run dev again");
  const prov = provenance();
  const split = protocol.splits.heldout!;
  const stimuli = generate(split);
  const cost: Cost = { heldWallS: 0, liveWallS: 0, simS: 0 };
  const records = runHeld("heldout", stimuli, split.fly_seeds, cost);
  const thresholds: Partial<Record<Arm, number>> = {};
  for (const arm of TUNED) thresholds[arm] = dev.selection[arm].threshold;
  const gain = dev.eye_gain as number;
  // Live runs: the deployed configuration, and it seeing through the eye at the dev gain.
  const live: {
    stimulus: number;
    seed: number;
    deployed: number | null;
    eye: number | null;
  }[] = [];
  let n = 0;
  for (const s of stimuli) {
    const tr = trial(protocol, s);
    for (const seed of split.fly_seeds) {
      const now = () => performance.now() / 1000;
      const d = liveRun(protocol, "heldout", tr, seed, null, now);
      const e = liveRun(protocol, "heldout", tr, seed, gain, now);
      cost.liveWallS += d.wallS + e.wallS;
      cost.simS += d.simS + e.simS;
      live.push({ stimulus: s.index, seed, deployed: d.firstEscape, eye: e.firstEscape });
      if (++n % 25 === 0 || n === records.length)
        process.stderr.write(`heldout live ${n}/${records.length}\n`);
    }
  }
  const truths = records.map(truthOf);
  const scoredBy = (arm: Arm): Scored[] =>
    records.map((r) => scoreTrial(truthOf(r), decision(r, arm, thresholds[arm] ?? null)));
  const liveScored = {
    deployed: live.map((l, k) => scoreTrial(truths[k]!, l.deployed)),
    "eye-lplc2": live.map((l, k) => scoreTrial(truths[k]!, l.eye)),
  };
  const offline = Object.fromEntries(ARMS.map((a) => [a, scoredBy(a)])) as Record<
    Arm,
    Scored[]
  >;
  const B = protocol.bootstrap;
  const diff = (a: Scored[], b: Scored[]) =>
    bootstrap(
      truths,
      (idx) => f1Of(truths, a, idx) - f1Of(truths, b, idx),
      B.resamples,
      B.seed,
    );
  const translating = new Set(["near_miss", "lateral", "zigzag"]);
  const trIdx = records.flatMap((r, k) => (translating.has(r.kind) ? [k] : []));
  const eyeLive = liveScored["eye-lplc2"];
  const translatingFa =
    trIdx.filter((k) => eyeLive[k]!.outcome !== "correct-rejection").length /
    trIdx.length;
  const mEyeLive = metrics(truths, eyeLive);
  const mDepLive = metrics(truths, liveScored.deployed);
  // V7: each live run's first escape is the one the held run predicts.
  const predictedEye = (r: TrialRecord) =>
    firstCrossing(r.envelopes["eye-lplc2"], thresholds["eye-lplc2"]!);
  const same = (a: number | null, b: number | null) =>
    a === null || b === null ? a === b : Math.abs(a - b) < 1e-6;
  const agreeDeployed = live.filter((l, k) =>
    same(l.deployed, records[k]!.deployedEscape),
  ).length;
  const agreeEye = live.filter((l, k) => same(l.eye, predictedEye(records[k]!))).length;
  const d1 = diff(eyeLive, liveScored.deployed);
  const d2 = diff(offline["eye-lplc2"], offline["geometric-tuned"]);
  const d4 = diff(offline["eye-lplc2"], offline["eye-expansion"]);
  const d5 = diff(offline["eye-lplc2"], offline["eye-shuffled"]);
  const criteria = {
    V1: { pass: d1.estimate >= 0.1 && d1.lo > 0, difference: d1 },
    V2: { pass: d2.lo > 0, difference: d2 },
    V3: {
      pass: translatingFa <= 0.25 && mEyeLive.recall >= 0.75,
      translating_false_alarm_rate: r6(translatingFa),
      recall: mEyeLive.recall,
    },
    V4: { pass: d4.lo > 0, difference: d4 },
    V5: { pass: d5.estimate >= 0.2 && d5.lo > 0, difference: d5 },
    V6: {
      pass: (mEyeLive.medianLeadS ?? 0) >= 0.05,
      median_lead_s: mEyeLive.medianLeadS,
    },
    V7: {
      pass: agreeDeployed / live.length >= 0.99 && agreeEye / live.length >= 0.99,
      deployed_agree: `${agreeDeployed}/${live.length}`,
      eye_agree: `${agreeEye}/${live.length}`,
    },
  };
  const name = `${protocol.id}-heldout.json`;
  const old = check ? recorded(name) : null;
  write(name, {
    ...header("heldout"),
    provenance: check && old ? old.provenance : prov,
    source,
    development_record: {
      commit: dev.provenance.commit,
      thresholds,
      eye_gain: gain,
    },
    stimuli,
    criteria,
    passed: Object.values(criteria).filter((c) => c.pass).length,
    of: Object.keys(criteria).length,
    live: { deployed: mDepLive, "eye-lplc2": mEyeLive },
    offline: Object.fromEntries(
      ARMS.map((a) => [a, armMetrics(records, a, thresholds[a] ?? null)]),
    ),
    by_kind: Object.fromEntries(
      ARMS.map((a) => [a, breakdown(records, a, thresholds[a] ?? null, (r) => r.kind)]),
    ),
    by_contrast: Object.fromEntries(
      ARMS.map((a) => [
        a,
        breakdown(records, a, thresholds[a] ?? null, (r) =>
          r.contrast > 0 ? "bright" : "dark",
        ),
      ]),
    ),
    by_illumination: Object.fromEntries(
      ARMS.map((a) => [
        a,
        breakdown(records, a, thresholds[a] ?? null, (r) => `ambient ${r.ambient}`),
      ]),
    ),
    live_trials: live,
    trials: records,
  });
  if (!check)
    writeFileSync(
      join(root, outDir, `${protocol.id}-heldout-cost.json`),
      JSON.stringify({ ...cost, machine: machine() }, null, 2) + "\n",
    );
}

if (mode === "dev") devMode();
else if (mode === "heldout") heldoutMode();
else {
  // The report is written by scripts/vision-looming-report.ts's logic, kept here to stay one script.
  const { report } = await import("./vision-looming-report.js");
  const text = report(root, outDir, PROTOCOLS);
  const path = join(root, outDir, "README.md");
  if (check) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) {
      console.error(`${outDir}/README.md does not follow from the records`);
      process.exitCode = 1;
    } else console.log(`${outDir}/README.md follows from the records`);
  } else {
    writeFileSync(path, text);
    console.log(`wrote ${outDir}/README.md`);
  }
}
