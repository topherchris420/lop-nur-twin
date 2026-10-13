/**
 * R.A.I.N. Lab civilization experiments, end to end, with the operator in the loop.
 *
 *   --scripted                         run the scripted demonstration designs
 *   --design d.json --receipt r.json   check a model proposal (from `noeterra design`),
 *                                      compile and preregister it, print its digest, stop
 *   --execute-reviewed <digest>        authorize that exact reviewed plan and run it
 *   --verify                           re-simulate every archived record
 *
 * Every outcome is archived under docs/benchmarks/noeterra-civilization/, refusals
 * and non-passing results included: a negative result is a result. Every number
 * is a simulated observation of an illustrative model, never historical evidence.
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
import { Registry } from "../src/rain/experiments/registry.js";
import { gitState } from "../src/rain/experiments/provenance.js";
import { canonicalJson, sha256, sha256Bytes, sha256Json } from "../src/rain/sha256.js";
import {
  authorizeCivilization,
  civilizationReceiptErrors,
  compileCivilizationExperiment,
  describeTreatment,
  executeCivilization,
  exposedSeedErrors,
  verifyCivilizationRecord,
} from "../src/rain/scientific/civilization.js";
import {
  admitCivilizationRecord,
  preregisterCivilization,
  replayObservation,
} from "../src/rain/scientific/civilizationRegistry.js";
import { civilizationExample } from "../src/rain/scientific/civilizationExample.js";
import { loadNoeterraEngine } from "../src/rain/scientific/noeterraLoader.js";
import { CIVILIZATION_METRICS } from "../src/rain/scientific/contracts.js";
import type {
  CivilizationDesign,
  CivilizationPlan,
  CivilizationPreregistration,
  CivilizationRecord,
} from "../src/rain/scientific/contracts.js";

const args = process.argv.slice(2);
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
const root = process.cwd();
const loaded = loadNoeterraEngine(root);
if (!loaded.engine) throw new Error(loaded.reason);
const engine = loaded.engine;
// The engine string names a version; these bytes are the module that ran.
const engineWasmSha256 = sha256Bytes(new Uint8Array(readFileSync(loaded.path)));
const ARCHIVE = resolve(value("--archive") ?? "docs/benchmarks/noeterra-civilization");
const STATE = resolve(value("--state") ?? ".rain-research/civilization");
const registry = new Registry(join(STATE, "registry"));
const pending = join(STATE, "pending");
mkdirSync(pending, { recursive: true });
mkdirSync(ARCHIVE, { recursive: true });

interface Pending {
  design: CivilizationDesign;
  receipt: string | null;
  plan: CivilizationPlan;
  preregistration: CivilizationPreregistration;
}

const write = (dir: string, name: string, data: unknown) =>
  writeFileSync(
    join(dir, name),
    typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n",
  );

function fmt(x: number | null | undefined, d = 2): string {
  return typeof x === "number" ? x.toFixed(d) : "—";
}

/** Every plan the lab has run or reserved: the archive's and those awaiting review. */
function priorPlans(): CivilizationPlan[] {
  const plans: CivilizationPlan[] = [];
  const read = (path: string, pick: (x: unknown) => unknown) => {
    try {
      const p = pick(JSON.parse(readFileSync(path, "utf8"))) as CivilizationPlan;
      if (p?.noeterra_plan && Array.isArray(p.noeterra_plan.seeds)) plans.push(p);
    } catch {
      // Not a plan; nothing to compare against.
    }
  };
  for (const d of readdirSync(ARCHIVE, { withFileTypes: true }))
    if (d.isDirectory() && existsSync(join(ARCHIVE, d.name, "plan.json")))
      read(join(ARCHIVE, d.name, "plan.json"), (x) => x);
  for (const f of readdirSync(pending))
    if (f.endsWith(".json")) read(join(pending, f), (x) => (x as Pending).plan);
  return plans;
}

function refuse(
  design: CivilizationDesign,
  receipt: string | null,
  label: string,
  why: string[],
): null {
  const dir = join(ARCHIVE, `refused-${sha256(JSON.stringify(design)).slice(0, 16)}`);
  mkdirSync(dir, { recursive: true });
  write(dir, "design.json", design);
  if (receipt) write(dir, "receipt.json", receipt);
  write(dir, "summary.json", {
    label,
    outcome: "refused by the host compiler",
    generation: design.provenance.generation,
    question: design.question,
    errors: why,
  });
  console.log(`REFUSED (${label}):\n  - ${why.join("\n  - ")}\n  archived in ${dir}`);
  return null;
}

/** Compiles and preregisters; archives a refusal. Returns the pending entry or null. */
function review(
  design: CivilizationDesign,
  receipt: string | null,
  label: string,
): Pending | null {
  const errors = civilizationReceiptErrors(design, receipt);
  if (errors.length) return refuse(design, receipt, label, errors);
  const compiled = compileCivilizationExperiment(design, { engine });
  if (!compiled.ok) return refuse(design, receipt, label, compiled.errors);
  const plan = compiled.value;
  // The archive keeps every run it has: a plan that already ran is not run again
  // over its record. Its engine version is in the digest, so a changed engine
  // makes a new plan rather than a second run of this one.
  const archived = join(ARCHIVE, plan.experiment_id);
  if (existsSync(join(archived, "record.json"))) {
    console.log(
      `ALREADY RUN (${label}) — ${plan.experiment_id} is archived in ${archived}; --verify re-simulates it`,
    );
    return null;
  }
  const exposed = exposedSeedErrors(plan, priorPlans());
  if (exposed.length) return refuse(design, receipt, label, exposed);
  // Reviewing the same plan again keeps its one preregistration; admission checks
  // the receipt against the registry, so a stale file cannot stand in for it.
  const pendingPath = join(pending, `${plan.definition_sha256}.json`);
  const preregistration = existsSync(pendingPath)
    ? (JSON.parse(readFileSync(pendingPath, "utf8")) as Pending).preregistration
    : preregisterCivilization(registry, plan, engine);
  const entry: Pending = { design, receipt, plan, preregistration };
  write(pending, `${plan.definition_sha256}.json`, entry);
  console.log(
    [
      `COMPILED (${label}) — ${plan.experiment_id}, registry ${preregistration.experiment_id}`,
      `  question:   ${plan.ir.question}`,
      `  hypothesis: ${plan.ir.hypothesis}`,
      `  design by:  ${design.provenance.generation}${design.provenance.decision_sha256 ? ` (receipt ${design.provenance.decision_sha256.slice(0, 12)}…)` : ""}`,
      `  seeds ${plan.noeterra_plan.seeds.join(",")}; ${plan.noeterra_plan.turns} seasons; ${plan.simulated_turns} simulated seasons in all`,
      `  criteria:   ${[...plan.criteria.guards, ...plan.criteria.success, ...plan.criteria.failure].map((c) => `${c.id} ${c.metric} ${c.op} ${c.value}`).join("; ")}`,
      `  plan digest ${plan.definition_sha256}`,
    ].join("\n"),
  );
  return entry;
}

function report(
  p: Pending,
  record: CivilizationRecord,
  run: Record<string, unknown>,
  commit: string,
  dirty: boolean | null,
): string {
  const m = record.result.measurements,
    plan = record.plan,
    metric = plan.design.analysis.metric;
  const unit = CIVILIZATION_METRICS.find((x) => x.id === metric)!.unit;
  const runs = record.result.experiment?.runs ?? [];
  const rows = plan.noeterra_plan.seeds.map((s) => {
    const c = runs.find((r) => r.arm === "control" && r.seed === s),
      t = runs.find((r) => r.arm === "treatment" && r.seed === s);
    const cv = c?.metrics[metric] ?? null,
      tv = t?.metrics[metric] ?? null;
    return `| ${s} | ${fmt(cv)} | ${fmt(tv)} | ${cv !== null && tv !== null ? fmt(tv - cv) : "—"} | \`${t?.final_hash.slice(0, 12) ?? ""}\` |`;
  });
  const ev = record.result.evaluation;
  const crit = ev
    ? [...ev.guards, ...ev.success, ...ev.failure].map(
        (c) =>
          `- **${c.id}** ${c.metric} ${c.op} ${c.value}: observed ${fmt(c.observed, 3)} — ${c.holds === null ? "not evaluable" : c.holds ? "holds" : "does not hold"}`,
      )
    : ["- not evaluated"];
  const others = CIVILIZATION_METRICS.filter((x) => x.id !== metric)
    .map(
      (x) => `| ${x.id} | ${fmt(m[`delta_${x.id}`] as number | null, 3)} | ${x.unit} |`,
    )
    .join("\n");
  return `# ${plan.experiment_id}: ${record.result.status.toUpperCase()} (${record.result.verdict.replaceAll("_", " ")})

> Simulated observations of an illustrative model (Noeterra, ${plan.engine}). Not evidence about the historical world.

**Question (host-written).** ${plan.ir.question}

**Hypothesis (host-written).** ${plan.ir.hypothesis}

**Design words (${p.design.provenance.generation}).** ${p.design.hypothesis} — competing: ${p.design.competing_hypothesis}

**Treatment.** ${describeTreatment(plan.design.parameters.treatment)}, on ${plan.design.parameters.scenario}, ${plan.noeterra_plan.turns} seasons, seeds ${plan.noeterra_plan.seeds.join(", ")}.

## Primary metric: ${metric} (${unit})

| seed | control | treatment | difference | treatment final state |
| ---: | ---: | ---: | ---: | :--- |
${rows.join("\n")}

Mean control ${fmt(m.control_mean)}, mean treatment ${fmt(m.treatment_mean)}, mean paired difference **${fmt(m.mean_paired_delta, 3)}**; ${m.seeds_expected_direction} of ${m.seeds} seeds in the expected direction, ${m.seeds_opposite} opposite, ${m.seeds_unchanged} unchanged.

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

${crit.join("\n")}

Registry run \`${String(run.run_id ?? "")}\`: status **${String(run.status)}**, verdict **${String(run.hypothesis_verdict)}**.

## Secondary observations (mean paired change; not preregistered as tests)

| metric | change | unit |
| :--- | ---: | :--- |
${others}

## Provenance

- Plan digest \`${plan.definition_sha256}\`, engine plan \`${plan.noeterra_plan_sha256}\`, scenario \`${plan.scenario_sha256}\`
- Record \`${record.sha256}\`, run \`${record.run_id}\`; authorized by ${record.authorization.operator} (local operator attestation; identity not verified)
- Producing commit \`${commit}\`${dirty ? " with uncommitted changes" : ""}
${p.design.provenance.decision_sha256 ? `- Model receipt \`${p.design.provenance.decision_sha256}\` (receipt.json)` : "- Design written by a script (no model involved)"}

## Limitations

${plan.ir.limitations.map((l) => `- ${l}`).join("\n")}
`;
}

function execute(
  entry: Pending,
  operator: string,
  label: string,
  reviewedDigest = entry.plan.definition_sha256,
) {
  const plan = entry.plan;
  const now = new Date();
  const auth = authorizeCivilization(plan, engine, {
    operator,
    typedPrefix: reviewedDigest.slice(0, 8),
    reviewed: true,
    now,
  });
  if (!auth.ok) throw new Error(auth.errors.join("; "));
  const record = executeCivilization(plan, auth.value, engine, now);
  const git = gitState(root, ["docs/benchmarks/noeterra-civilization", ".rain-research"]);
  const commit = git.commit ?? "";
  // The record is archived before admission is tried: a run the registry refuses
  // (one that does not reproduce, say) is the anomaly most worth keeping.
  const dir = join(ARCHIVE, plan.experiment_id);
  mkdirSync(dir, { recursive: true });
  write(dir, "design.json", entry.design);
  if (entry.receipt) write(dir, "receipt.json", entry.receipt);
  write(dir, "plan.json", plan);
  write(dir, "preregistration.json", entry.preregistration);
  write(dir, "record.json", record);
  rmSync(join(pending, `${plan.definition_sha256}.json`), { force: true });
  let admitted: ReturnType<typeof admitCivilizationRecord> | null = null,
    refusal = "";
  try {
    admitted = admitCivilizationRecord(registry, entry.preregistration, record, engine, {
      commit: git.commit,
    });
  } catch (e) {
    refusal = e instanceof Error ? e.message : String(e);
  }
  if (admitted) {
    write(dir, "registry-run.json", admitted.registry_run);
    write(
      dir,
      "report.md",
      report(entry, record, admitted.registry_run, commit, git.dirty),
    );
  }
  write(dir, "summary.json", {
    label,
    outcome: admitted
      ? `${record.result.status} (${record.result.verdict})`
      : "not admitted by the registry",
    generation: entry.design.provenance.generation,
    question: plan.ir.question,
    mean_paired_delta: record.result.measurements.mean_paired_delta,
    metric: plan.design.analysis.metric,
    replay_sha256: admitted?.replay.replay_sha256 ?? null,
    ...(admitted ? {} : { errors: [refusal] }),
    engine_wasm_sha256: engineWasmSha256,
    commit,
    dirty: git.dirty,
  });
  if (!admitted) {
    console.error(`NOT ADMITTED (${label}): ${refusal}\n  archived in ${dir}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `${record.result.status.toUpperCase()} (${record.result.verdict}) — ${plan.design.analysis.metric}: mean paired difference ${fmt(record.result.measurements.mean_paired_delta, 3)}. ${replayObservation(record, admitted.replay.replay_sha256)}. Archived in ${dir}`,
  );
}

function index() {
  const entries = readdirSync(ARCHIVE, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(ARCHIVE, d.name, "summary.json")))
    .map((d) => {
      const s = JSON.parse(
        readFileSync(join(ARCHIVE, d.name, "summary.json"), "utf8"),
      ) as Record<string, unknown>;
      return {
        dir: d.name,
        outcome: s.outcome,
        generation: s.generation,
        question: s.question,
      };
    })
    .sort((a, b) => a.dir.localeCompare(b.dir));
  const lines = entries.map(
    (e) =>
      `| [${e.dir}](${e.dir}/${existsSync(join(ARCHIVE, e.dir, "report.md")) ? "report.md" : "summary.json"}) | ${String(e.outcome)} | ${String(e.generation)} | ${String(e.question).replaceAll("|", "/")} |`,
  );
  write(
    ARCHIVE,
    "README.md",
    `# Noeterra civilization experiments

Every civilization experiment the R.A.I.N. Lab compiled, ran or refused, written by
\`npm run rain:civilization\`. Nothing here is edited by hand: refusals, failures,
inconclusive results and runs the registry would not admit stay beside the
successes. Two earlier runs (registry V3D-EXP-0001 and 0002) were overwritten by
re-runs before commit 5e174c4 stopped that, and are lost; every run since is kept.

All results are **simulated observations of an illustrative model** — the Noeterra
engine's rule-based agents in an invented economy — and are not evidence about
the historical Mediterranean or any real society. \`npm run rain:civilization -- --verify\`
re-simulates every archived record.

| experiment | outcome | design by | question |
| :--- | :--- | :--- | :--- |
${lines.join("\n")}
`,
  );
}

// Scripted mode authorizes its own plans with no person reviewing them, so its
// records name the script, never someone who could be mistaken for a reviewer.
if (args.includes("--scripted") && value("--operator"))
  throw new Error(
    "--scripted runs are authorized by Scripted.DemoOperator; drop --operator",
  );
const operator =
  value("--operator") ??
  (args.includes("--scripted") ? "Scripted.DemoOperator" : "R.A.I.N.Operator");
if (args.includes("--scripted")) {
  const designs: [string, CivilizationDesign][] = [
    ["scripted: memory and war", civilizationExample()],
    [
      "scripted: an implausible threshold on fresh seeds, to show a non-passing result is kept",
      civilizationExample({ minimumEffect: 50, seeds: [7, 8, 9, 10, 11, 12] }),
    ],
    [
      "scripted: a new threshold on seeds the first design already ran, which the host must refuse",
      civilizationExample({ minimumEffect: 2 }),
    ],
    [
      "scripted: a design the host must refuse",
      civilizationExample({
        treatment: { kind: "set_trait", civ: "atlantis", trait: "honor", value: 0.5 },
      }),
    ],
  ];
  for (const [label, d] of designs) {
    const entry = review(d, null, label);
    if (entry) execute(entry, operator, label);
  }
} else if (value("--design")) {
  const design = JSON.parse(
    readFileSync(value("--design")!, "utf8"),
  ) as CivilizationDesign;
  const receiptPath = value("--receipt");
  const receipt = receiptPath ? readFileSync(receiptPath, "utf8") : null;
  const entry = review(design, receipt, "model proposal");
  if (entry)
    console.log(
      `\nNothing has run. After reviewing the plan above, authorize it with:\n  npm run rain:civilization -- --execute-reviewed ${entry.plan.definition_sha256}`,
    );
} else if (value("--execute-reviewed")) {
  const digest = value("--execute-reviewed")!;
  if (!/^[a-f0-9]{64}$/.test(digest))
    throw new Error("repeat the full 64-character reviewed plan digest");
  const path = join(pending, `${digest}.json`);
  if (!existsSync(path))
    throw new Error("no compiled plan with that digest is awaiting review");
  const entry = JSON.parse(readFileSync(path, "utf8")) as Pending;
  // Run exactly what was reviewed: the plan in the file must be the digest the
  // operator typed, built from the design archived beside it.
  const mismatch = [
    ...(entry.plan.definition_sha256 === digest
      ? []
      : ["the pending plan is not the plan with that digest"]),
    ...(canonicalJson(entry.design) === canonicalJson(entry.plan.design)
      ? []
      : ["the pending design is not the design the plan was compiled from"]),
    ...civilizationReceiptErrors(entry.design, entry.receipt),
  ];
  if (mismatch.length) throw new Error(mismatch.join("; "));
  if (existsSync(join(ARCHIVE, entry.plan.experiment_id, "record.json")))
    throw new Error(`${entry.plan.experiment_id} has already run and is archived`);
  execute(entry, operator, "reviewed plan", digest);
} else if (args.includes("--verify")) {
  let bad = 0,
    resimulated = 0,
    skipped = 0;
  const fail = (d: string, why: string[]) => {
    console.log(`FAILED   ${d}: ${why.join("; ")}`);
    bad++;
  };
  const current = engine.version().engine;
  for (const d of readdirSync(ARCHIVE, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const path = join(ARCHIVE, d.name, "record.json");
    if (!existsSync(path)) {
      // Only a refusal has no record; anything else claims a result it cannot show.
      if (!d.name.startsWith("refused-")) fail(d.name, ["no record.json"]);
      continue;
    }
    const record = JSON.parse(readFileSync(path, "utf8")) as CivilizationRecord;
    // The index lists what summary.json says, so it must say what the record does.
    const summary = existsSync(join(ARCHIVE, d.name, "summary.json"))
      ? (JSON.parse(
          readFileSync(join(ARCHIVE, d.name, "summary.json"), "utf8"),
        ) as Record<string, unknown>)
      : null;
    const { sha256: sealed, ...body } = record;
    const shown = [
      ...(sha256Json(body) === sealed ? [] : ["record digest mismatch"]),
      ...(summary === null
        ? ["no summary.json"]
        : [
            ...(summary.outcome ===
              `${record.result.status} (${record.result.verdict})` ||
            (summary.outcome === "not admitted by the registry" &&
              !existsSync(join(ARCHIVE, d.name, "registry-run.json")))
              ? []
              : ["summary outcome is not the record's"]),
            ...(summary.metric === record.plan.design.analysis.metric &&
            summary.question === record.plan.ir.question &&
            summary.mean_paired_delta === record.result.measurements.mean_paired_delta
              ? []
              : ["summary metric, question or effect is not the record's"]),
          ]),
    ];
    if (shown.length) {
      fail(d.name, shown);
      continue;
    }
    // A record made by another engine version cannot re-simulate on this one, and
    // the archive is never rewritten; say so rather than fail forever. A record
    // from this very engine that does not reproduce is a failure.
    const recordedUnder = record.plan?.engine;
    if (
      typeof recordedUnder === "string" &&
      /^noeterra \S+ sim\/\d+$/.test(recordedUnder) &&
      recordedUnder !== current
    ) {
      console.log(
        `skipped  ${d.name}: recorded under ${recordedUnder}; this engine is ${current}`,
      );
      skipped++;
      continue;
    }
    const v = verifyCivilizationRecord(record, engine);
    if (!v.ok) fail(d.name, v.errors);
    else {
      console.log(`ok       ${d.name}`);
      resimulated++;
    }
  }
  console.log(`${resimulated} re-simulated, ${skipped} skipped, ${bad} failed`);
  // An archive this engine can re-simulate none of is checked by nothing.
  if (skipped && !resimulated) {
    console.log(
      `No archived record re-simulates on ${current}. Archive a run made by this engine (npm run rain:civilization:demo) so the cited results stay checkable.`,
    );
    bad++;
  }
  if (bad) process.exitCode = 1;
} else {
  throw new Error(
    "Use --scripted, --design <file> --receipt <file>, --execute-reviewed <digest>, or --verify.",
  );
}
if (!args.includes("--verify")) index();
