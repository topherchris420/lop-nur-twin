/**
 * R.A.I.N. Lab digital-fly experiments, end to end, with a person in the loop.
 *
 *   --design d.json [--receipt r.json]  check a design (a model's needs its
 *                                       rain-fly-design-receipt/v1), compile and
 *                                       preregister it, print its digest; nothing runs
 *   --execute-reviewed <digest>         at a terminal only: type the reviewed plan's
 *                                       first eight characters and your role label;
 *                                       the plan is authorized once, its seeds are
 *                                       drawn, and it runs
 *   --scripted                          the demonstration: the host's own designs,
 *                                       authorized by this script (Scripted.DemoOperator),
 *                                       never by a person
 *   --verify                            check every archived folder against its
 *                                       record and re-simulate what this code can
 *   --pilot [--protocol p] [--check | --readme]
 *                                       run the redesigned protocols' pilots on the
 *                                       public pilot seeds and write them, labelled
 *                                       not evidence, to docs/benchmarks/fly-pilots/;
 *                                       --check re-runs each kept pilot exactly from
 *                                       its recorded definition and compares; --readme
 *                                       only rewrites the pilots' index
 *   --archive <dir> --state <dir>       where records, and the registry and ledger, live
 *   --pilots <dir>                      where pilots live
 *
 * Every outcome is archived under docs/benchmarks/fly-behavior/, refusals and
 * non-passing results included: a negative result is a result. A record is
 * admitted to the registry only when it ran from committed code that the
 * recorded commit holds. Every number is a simulated observation of the
 * digital fly, a reduced-order controller that simulates no neurons, and is
 * never evidence about Drosophila.
 *
 * Exit status: 0 when everything held; 1 after a refusal, a failure or a run
 * that was not admitted (or from --pilot --check, a pilot this code no longer
 * reproduces); 3 from --verify when nothing failed but records made on another
 * JavaScript engine could not be re-simulated here.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Registry } from "../src/rain/experiments/registry.js";
import { environment, gitState } from "../src/rain/experiments/provenance.js";
import { canonicalJson, sha256 } from "../src/rain/sha256.js";
import {
  authorizeFly,
  compileFlyExperiment,
  describeFlyBaseline,
  describeFlyTreatment,
  executeFly,
  flyReceiptErrors,
  type FlyAuthorizationInput,
  type FlyContext,
} from "../src/rain/scientific/fly.js";
import {
  admitFlyRecord,
  FlyAuthorizationLedger,
  flyReplayObservation,
  preregisterFly,
  registryFlyHost,
} from "../src/rain/scientific/flyRegistry.js";
import {
  archivedFlyRuns,
  flyArchiveReadme,
  flyFolderFiles,
  flyJsonText,
  pinFlyRenderings,
  verifyFlyArchive,
  type FlyAdmission,
} from "../src/rain/scientific/flyArchive.js";
import {
  changedFlySources,
  computeFlySource,
  workingTreeReader,
} from "../src/rain/scientific/flySourceDigest.js";
import { FLY_SOURCE } from "../src/rain/scientific/flySource.js";
import { flyExample } from "../src/rain/scientific/flyExample.js";
import {
  checkFlyPilot,
  FLY_PILOT_SERIES,
  flyPilotReadme,
  runFlyPilot,
  type FlyPilot,
} from "../src/rain/scientific/flyPilot.js";
import {
  FLY_PROTOCOLS,
  FLY_SCRIPT_OPERATOR,
  type FlyDesign,
  type FlyProtocolId,
  type FlyPlan,
  type FlyPreregistration,
  type FlyRecord,
} from "../src/rain/scientific/contracts.js";

const args = process.argv.slice(2);
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
const root = process.cwd();
const ARCHIVE = resolve(value("--archive") ?? "docs/benchmarks/fly-behavior");
const STATE = resolve(value("--state") ?? ".rain-research/fly");
const PILOTS = resolve(value("--pilots") ?? "docs/benchmarks/fly-pilots");
const registry = new Registry(join(STATE, "registry"));
const ledger = new FlyAuthorizationLedger(join(STATE, "authorizations"));
const pending = join(STATE, "pending");
/** Only the modes that write make the archive and state folders; --verify and --pilot read them. */
const ensureFolders = () => {
  mkdirSync(pending, { recursive: true });
  mkdirSync(ARCHIVE, { recursive: true });
};
/** Evidence this host holds independently; it holds none, so designs citing sources or a parent are refused. */
const EVIDENCE: FlyContext = {};
const locations = [
  ...(value("--archive") ? ["--archive", value("--archive")!] : []),
  ...(value("--state") ? ["--state", value("--state")!] : []),
].join(" ");

interface Pending {
  design: FlyDesign;
  receipt: string | null;
  plan: FlyPlan;
  preregistration: FlyPreregistration;
}

const fmt = (x: number | null | undefined, d = 3) =>
  typeof x === "number" ? x.toFixed(d) : "—";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The source tree this process runs from; the archive and the lab's state are its outputs, not its code. */
const sourceTree = () => {
  const git = gitState(root, [ARCHIVE, STATE]);
  return { commit: git.commit, dirty: git.dirty };
};

/** Why the fly's source digest does not name this checkout's code, or null when it does. */
function staleSource(): string | null {
  const here = computeFlySource(workingTreeReader(root));
  return here.sha256 === FLY_SOURCE.sha256
    ? null
    : `src/rain/scientific/flySource.ts is stale (${changedFlySources(FLY_SOURCE, here).join(", ")} changed); run node scripts/run-ts.mjs scripts/fly-source.ts`;
}

/** Whether this fly has already run a seed in an archived record (read from record.json). */
function archivedSeeds(): (fly: string, seed: number) => boolean {
  const seen = new Set(
    archivedFlyRuns(ARCHIVE).flatMap((r) => r.seeds.map((s) => `${r.fly_sha256}/${s}`)),
  );
  return (fly, seed) => seen.has(`${fly}/${seed}`);
}

const host = () =>
  registryFlyHost({
    registry,
    ledger,
    code: sourceTree,
    seen: archivedSeeds(),
    evidence: EVIDENCE,
  });

/** Writes each file once; an existing file is never replaced. */
function writeNew(dir: string, files: Record<string, string>) {
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(dir, name), text, { flag: "wx" });
}

function sameFolder(dir: string, files: Record<string, string>): boolean {
  const names = readdirSync(dir).sort();
  return (
    canonicalJson(names) === canonicalJson(Object.keys(files).sort()) &&
    names.every((n) => readFileSync(join(dir, n), "utf8") === files[n])
  );
}

/**
 * Archives a refusal. One already archived is never rewritten: the same
 * refusal is kept as it is, and a different one for the same design (the
 * rules changed) goes beside it.
 */
function refuse(
  design: unknown,
  receipt: string | null,
  label: string,
  why: string[],
  expected = false,
): null {
  const d = design as Partial<FlyDesign> | null;
  const files = {
    "design.json": flyJsonText(design),
    ...(receipt ? { "receipt.json": receipt } : {}),
    "summary.json": flyJsonText({
      label,
      outcome: "refused by the host compiler",
      protocol: d?.parameters?.treatment?.kind ?? null,
      generation: d?.provenance?.generation ?? null,
      question: d?.question ?? null,
      errors: why,
    }),
  };
  const base = `refused-${sha256(canonicalJson(design)).slice(0, 16)}`;
  let dir = "";
  for (let i = 1; !dir; i++) {
    const path = join(ARCHIVE, i === 1 ? base : `${base}-${i}`);
    if (!existsSync(path)) {
      mkdirSync(path);
      writeNew(path, files);
      dir = path;
    } else if (sameFolder(path, files)) dir = path;
  }
  console.log(`REFUSED (${label}):\n  - ${why.join("\n  - ")}\n  archived in ${dir}`);
  if (!expected) process.exitCode = 1;
  return null;
}

function describePlan(entry: Pending): string {
  const { plan, design, preregistration } = entry;
  const t = design.parameters.treatment;
  const protocol = FLY_PROTOCOLS.find((p) => p.id === t.kind)!;
  return [
    `  protocol:   ${protocol.title}: ${describeFlyTreatment(t)}, against ${describeFlyBaseline(t)}`,
    ...(protocol.caveat ? [`  caveat:     ${protocol.caveat}`] : []),
    `  question:   ${plan.ir.question}`,
    `  hypothesis: ${plan.ir.hypothesis}`,
    `  design by:  ${design.provenance.generation}${design.provenance.decision_sha256 ? ` (receipt ${design.provenance.decision_sha256.slice(0, 12)}…)` : ""}`,
    `  seeds:      ${plan.experiment.seed_count}, drawn by the host when the plan is authorized; at most ${plan.simulated_seconds} simulated fly-seconds`,
    `  criteria:   ${[...plan.criteria.guards, ...plan.criteria.success, ...plan.criteria.failure].map((c) => `${c.id} ${c.metric} ${c.op} ${c.value}`).join("; ")}`,
    `  fly:        ${plan.fly}, source ${plan.fly_source_sha256.slice(0, 12)}`,
    `  registry:   ${preregistration.experiment_id}, preregistered ${preregistration.created_at}`,
    `  plan digest ${plan.definition_sha256}`,
  ].join("\n");
}

/** Compiles and preregisters; archives a refusal. Returns the pending entry or null. */
function review(
  design: FlyDesign,
  receipt: string | null,
  label: string,
): Pending | null {
  const compiled = compileFlyExperiment(design, EVIDENCE);
  if (!compiled.ok) return refuse(design, receipt, label, compiled.errors);
  const errors = flyReceiptErrors(design, receipt);
  if (errors.length) return refuse(design, receipt, label, errors);
  const plan = compiled.value;
  // A plan that already ran is never run again over its record. The fly's
  // version, parameters and source are in the digest, so changed code makes a
  // new plan rather than a second run of this one.
  const ran = archivedFlyRuns(ARCHIVE).find(
    (r) => r.plan_sha256 === plan.definition_sha256,
  );
  if (ran) {
    console.log(
      `ALREADY RUN (${label}) — ${plan.experiment_id} is archived in ${join(ARCHIVE, ran.dir)}; --verify re-simulates it`,
    );
    return null;
  }
  if (existsSync(join(ARCHIVE, plan.experiment_id)))
    throw new Error(
      `${join(ARCHIVE, plan.experiment_id)} exists without a record; look at it before running this plan`,
    );
  // Reviewing the same plan again keeps its one preregistration.
  const path = join(pending, `${plan.definition_sha256}.json`);
  const preregistration = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Pending).preregistration
    : preregisterFly(registry, plan);
  const entry: Pending = { design, receipt, plan, preregistration };
  writeFileSync(path, flyJsonText(entry));
  console.log(`COMPILED (${label}) — ${plan.experiment_id}\n${describePlan(entry)}`);
  return entry;
}

/** Authorizes, runs, archives and tries admission. */
function execute(entry: Pending, input: FlyAuthorizationInput, label: string) {
  const plan = entry.plan;
  const h = host();
  const auth = authorizeFly(plan, entry.preregistration, input, h);
  if (!auth.ok) throw new Error(`authorization refused: ${auth.errors.join("; ")}`);
  const t0 = performance.now();
  const record: FlyRecord = executeFly(plan, entry.preregistration, auth.value, h);
  const wall = (performance.now() - t0) / 1000;
  // The record is archived before admission is tried: a run the registry
  // refuses is the anomaly most worth keeping.
  const dir = join(ARCHIVE, plan.experiment_id);
  mkdirSync(dir);
  writeNew(dir, { "record.json": flyJsonText(record) });
  rmSync(join(pending, `${plan.definition_sha256}.json`), { force: true });
  let admission: FlyAdmission;
  let replay: string | null = null;
  try {
    const admitted = admitFlyRecord(registry, record, {
      root,
      recordedBy: { git: gitState(root, [ARCHIVE, STATE]), environment: environment() },
      evidence: EVIDENCE,
    });
    admission = { registry_run: admitted.registry_run, error: null };
    replay = admitted.replay.replay_sha256;
  } catch (e) {
    admission = { registry_run: null, error: message(e) };
  }
  const { "record.json": _record, ...rest } = flyFolderFiles(record, admission);
  writeNew(dir, { ...rest, ...(entry.receipt ? { "receipt.json": entry.receipt } : {}) });
  // Pinned by the code that rendered them: later code renders them otherwise.
  pinFlyRenderings(ARCHIVE, plan.experiment_id, rest);
  const m = record.result.measurements;
  const outcome = `${record.result.status.toUpperCase()} (${record.result.verdict}) — ${plan.design.analysis.metric}: mean paired difference ${fmt(m.mean_paired_delta)} over ${m.untied_pairs ?? "—"} untied seeds, sign test p = ${fmt(m.sign_test_p_expected, 4)}; gate refusals ${m.gate_refusals ?? "—"}; ${wall.toFixed(1)} s wall, determinism replay included`;
  if (!admission.registry_run) {
    console.error(
      `NOT ADMITTED (${label}): ${admission.error}\n  ${outcome}\n  archived in ${dir}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`${outcome}. ${flyReplayObservation(record, replay)}. Archived in ${dir}`);
}

function index() {
  writeFileSync(join(ARCHIVE, "README.md"), flyArchiveReadme(ARCHIVE));
}

/** What a person types: the plan's first eight characters and a role label. */
async function ask(entry: Pending): Promise<FlyAuthorizationInput> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(
      `Authorize and run this preregistered plan? It is authorized once; its seeds are drawn now and it cannot be run again.\n${describePlan(entry)}`,
    );
    const typedPrefix = await rl.question(
      "Type the first eight characters of the plan digest you reviewed: ",
    );
    const operator = await rl.question(
      "Your role label (letters, digits, . _ -; not a name or an email): ",
    );
    const human = entry.design.provenance.generation === "human";
    const attested = human
      ? (
          await rl.question(
            "The design is declared written by a person. Type yes to attest that: ",
          )
        )
          .trim()
          .toLowerCase() === "yes"
      : false;
    const reviewed =
      (
        await rl.question(
          "Have you reviewed the protocol, its caveat, the criteria and the limitations? Type yes: ",
        )
      )
        .trim()
        .toLowerCase() === "yes";
    return {
      channel: "terminal",
      operator: operator.trim(),
      typedPrefix,
      reviewed,
      humanDesignAttested: attested,
    };
  } finally {
    rl.close();
  }
}

async function main() {
  if (value("--operator"))
    throw new Error(
      "--operator is gone: --execute-reviewed asks the person at the terminal, and --scripted authorizes as Scripted.DemoOperator",
    );
  if (args.includes("--verify")) return verify();
  const stale = staleSource();
  if (stale) throw new Error(stale);
  if (args.includes("--pilot")) return pilot();
  ensureFolders();
  if (args.includes("--scripted")) {
    // The host's own designs, authorized by this script and labelled so: a
    // demonstration of the pipeline, never a person's review. The last two
    // must be refused, and are archived as refusals.
    const designs: [string, FlyDesign, boolean][] = [
      ["scripted: obstacle avoidance", flyExample("obstacle_avoidance"), false],
      ["scripted: light preference", flyExample("light_preference"), false],
      ["scripted: visual threat", flyExample("visual_threat"), false],
      ["scripted: noisy sensing", flyExample("noisy_sensing"), false],
      ["scripted: adaptation to repeated looms", flyExample("adaptation"), false],
      ["scripted: controller comparison", flyExample("controller_comparison"), false],
      [
        "scripted: a minimum effect below the host's minimum for its metric, which the host must refuse",
        flyExample("visual_threat", { minimumEffect: 0.01 }),
        true,
      ],
      [
        "scripted: a controller configuration that overrides a published value, which the host must refuse",
        flyExample("controller_comparison", {
          treatment: {
            kind: "controller_comparison",
            baseline: {},
            treatment: { saccadeMs: 40 },
          },
        }),
        true,
      ],
    ];
    for (const [label, design, mustRefuse] of designs)
      try {
        if (mustRefuse) {
          const compiled = compileFlyExperiment(design, EVIDENCE);
          if (compiled.ok) {
            console.error(
              `NOT REFUSED (${label}): the host compiled a design it must refuse`,
            );
            process.exitCode = 1;
          } else refuse(design, null, label, compiled.errors, true);
          continue;
        }
        const entry = review(design, null, label);
        if (entry)
          execute(
            entry,
            {
              channel: "script",
              operator: FLY_SCRIPT_OPERATOR,
              typedPrefix: entry.plan.definition_sha256.slice(0, 8),
              reviewed: true,
            },
            label,
          );
      } catch (e) {
        console.error(`ERROR (${label}): ${message(e)}`);
        process.exitCode = 1;
      }
  } else if (value("--design")) {
    const design = JSON.parse(readFileSync(value("--design")!, "utf8")) as FlyDesign;
    const receiptPath = value("--receipt");
    const receipt = receiptPath ? readFileSync(receiptPath, "utf8") : null;
    const label = receipt ? "model proposal" : "submitted design";
    // The scripted generation is the host's demonstration, run by --scripted only.
    const entry =
      design?.provenance?.generation === "scripted"
        ? refuse(design, receipt, label, [
            "a scripted design is the host's demonstration and runs only with --scripted",
          ])
        : review(design, receipt, label);
    if (entry)
      console.log(
        `\nNothing has run. After reviewing the plan above, a person at a terminal authorizes and runs it, once, with:\n  npm run rain:fly -- --execute-reviewed ${entry.plan.definition_sha256}${locations ? ` ${locations}` : ""}`,
      );
  } else if (value("--execute-reviewed")) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error(
        "--execute-reviewed asks a person at a terminal and reads no answers from a pipe or a script; the host's demonstration runs with --scripted",
      );
    const digest = value("--execute-reviewed")!;
    if (!/^[a-f0-9]{64}$/.test(digest))
      throw new Error("give the full 64-character digest of the reviewed plan");
    const path = join(pending, `${digest}.json`);
    if (!existsSync(path))
      throw new Error("no preregistered plan with that digest is awaiting review");
    const entry = JSON.parse(readFileSync(path, "utf8")) as Pending;
    // Run exactly what was reviewed: the plan in the file must be the digest
    // given, built from the design archived beside it.
    const mismatch = [
      ...(entry.plan.definition_sha256 === digest
        ? []
        : ["the pending plan is not the plan with that digest"]),
      ...(canonicalJson(entry.design) === canonicalJson(entry.plan.design)
        ? []
        : ["the pending design is not the design the plan was compiled from"]),
      ...flyReceiptErrors(entry.design, entry.receipt),
    ];
    if (mismatch.length) throw new Error(mismatch.join("; "));
    if (archivedFlyRuns(ARCHIVE).some((r) => r.plan_sha256 === digest))
      throw new Error(`${entry.plan.experiment_id} has already run and is archived`);
    execute(entry, await ask(entry), "reviewed plan");
  } else
    throw new Error(
      "Use --design <file> [--receipt <file>], --execute-reviewed <digest>, --scripted or --verify.",
    );
}

/**
 * Runs the pilots of the redesigned protocols on the public pilot seeds and
 * writes them, with their README, to PILOTS (one protocol with --protocol).
 * They are exploratory and never evidence: nothing is preregistered,
 * authorized or admitted, and their seeds are excluded from every archived
 * run. With --check, re-runs each kept pilot exactly from its recorded
 * definition, writes nothing, and fails unless its runs and outputs are
 * identical and this code would still run the same definition.
 */
function pilot() {
  const only = value("--protocol");
  const protocols = (Object.keys(FLY_PILOT_SERIES) as FlyProtocolId[]).filter(
    (p) => !only || p === only,
  );
  if (!protocols.length) throw new Error(`no pilot for ${only}`);
  const kept = () =>
    readdirSync(PILOTS)
      .filter((n) => n.endsWith(".json"))
      .sort()
      .map((n) => JSON.parse(readFileSync(join(PILOTS, n), "utf8")) as FlyPilot);
  const readme = join(PILOTS, "README.md");
  // The index alone, from the kept pilots: nothing runs.
  if (args.includes("--readme")) {
    writeFileSync(readme, flyPilotReadme(kept()));
    return;
  }
  const check = args.includes("--check");
  const code = sourceTree();
  const short = (h: string | undefined) => (h ? h.slice(0, 12) : "none");
  let failed = 0;
  for (const protocol of protocols) {
    const t0 = performance.now();
    const path = join(PILOTS, `${protocol}.json`);
    const wall = () => `${((performance.now() - t0) / 1000).toFixed(1)} s`;
    if (check) {
      if (!existsSync(path)) {
        console.log(`MISSING  ${protocol}: no pilot in ${PILOTS}`);
        failed++;
        continue;
      }
      const kept = JSON.parse(readFileSync(path, "utf8")) as FlyPilot;
      const c = checkFlyPilot(kept, code);
      const ok = c.intact && c.same_runs && c.same_outputs && c.current_definition;
      const why = [
        ...(c.intact ? [] : ["the file is not what the pilot tool wrote"]),
        ...(c.same_runs
          ? []
          : [`runs ${short(kept.runs_sha256)} became ${short(c.rerun.runs_sha256)}`]),
        ...(c.same_outputs
          ? []
          : [
              `outputs ${short(kept.outputs_sha256)} became ${short(c.rerun.outputs_sha256)}`,
            ]),
        ...(c.current_definition
          ? []
          : [
              "this code's pilot would run another definition (apparatus, arms or seeds)",
            ]),
      ];
      console.log(
        `${ok ? "same    " : "CHANGED "} ${protocol}: ${ok ? `runs ${short(kept.runs_sha256)} and outputs ${short(kept.outputs_sha256)} reproduced exactly` : why.join("; ")}; ran on ${kept.fly_version} source ${short(kept.fly_source_sha256)}, re-run on ${c.rerun.fly_version} source ${short(c.rerun.fly_source_sha256)}; ${wall()}`,
      );
      if (!ok) failed++;
      continue;
    }
    const p = runFlyPilot(protocol, code);
    mkdirSync(PILOTS, { recursive: true });
    writeFileSync(path, flyJsonText(p));
    const s = p.sized;
    console.log(
      `PILOT    ${protocol} (not evidence) on ${p.fly_version} source ${short(p.fly_source_sha256)}: ${s.metric} ${s.direction}, pilot seeds ${s.outcomes.expected} expected / ${s.outcomes.opposite} opposite / ${s.outcomes.uninformative} uninformative -> seed count ${s.seed_count ?? "none"} (pass ${fmt(s.pass_probability, 4)}), minimum effect ${s.minimum_effect ?? "—"} (host ${s.host_minimum_effect}, design ${s.design_minimum_effect ?? "—"}); floors ${p.floors.map((f) => `${f.metric} ${f.floor}`).join(", ") || "none"}; runs ${short(p.runs_sha256)}, outputs ${short(p.outputs_sha256)}; ${wall()}; ${path}`,
    );
  }
  if (check) {
    if (
      existsSync(PILOTS) &&
      (!existsSync(readme) || readFileSync(readme, "utf8") !== flyPilotReadme(kept()))
    ) {
      console.log(
        "CHANGED  README.md: not the index the kept pilots imply; npm run rain:fly -- --pilot --readme writes it",
      );
      failed++;
    }
    process.exitCode = failed ? 1 : 0;
    return;
  }
  writeFileSync(readme, flyPilotReadme(kept()));
}

/** Checks every folder against its record and re-simulates what this code and engine can. */
function verify() {
  // A stale digest gives this code the wrong identity, so every comparison would mislead.
  const v = verifyFlyArchive(ARCHIVE, { stale: staleSource(), context: EVIDENCE });
  for (const line of v.lines) console.log(line.text);
  for (const line of v.summary) console.log(line);
  process.exitCode = v.exit_code;
}

try {
  await main();
} catch (e) {
  console.error(`rain-fly: ${message(e)}`);
  process.exitCode = 1;
} finally {
  // The index always lists what the archive holds, even after an error.
  if (!args.includes("--verify") && !args.includes("--pilot") && existsSync(ARCHIVE))
    index();
}
