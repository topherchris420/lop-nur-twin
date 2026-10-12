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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Registry } from "../src/rain/experiments/registry.js";
import { gitState } from "../src/rain/experiments/provenance.js";
import { sha256 } from "../src/rain/sha256.js";
import {
  authorizeCivilization,
  compileCivilizationExperiment,
  describeTreatment,
  executeCivilization,
  verifyCivilizationRecord,
} from "../src/rain/scientific/civilization.js";
import {
  admitCivilizationRecord,
  preregisterCivilization,
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

function checkReceipt(design: CivilizationDesign, text: string | null): string[] {
  if (design.provenance.generation !== "model")
    return text ? ["a receipt accompanies a non-model design"] : [];
  if (!text) return ["a model design needs its receipt"];
  const errors: string[] = [];
  if (sha256(text) !== design.provenance.decision_sha256)
    errors.push("the receipt's SHA-256 does not match the design's decision_sha256");
  try {
    const r = JSON.parse(text) as {
      schema?: string;
      generation?: string;
      answer?: string;
    };
    if (r.schema !== "noeterra-design-receipt/v1" || r.generation !== "model")
      errors.push("not a noeterra-design-receipt/v1 from a model");
    if (typeof r.answer !== "string" || !r.answer.includes(design.question.slice(0, 40)))
      errors.push("the design's words do not come from the receipt's answer");
  } catch {
    errors.push("the receipt is not JSON");
  }
  return errors;
}

/** Compiles and preregisters; archives a refusal. Returns the pending entry or null. */
function review(
  design: CivilizationDesign,
  receipt: string | null,
  label: string,
): Pending | null {
  const errors = checkReceipt(design, receipt);
  const compiled = errors.length
    ? null
    : compileCivilizationExperiment(design, { engine });
  if (!compiled || !compiled.ok) {
    const why = compiled && !compiled.ok ? compiled.errors : errors;
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
  const plan = compiled.value;
  const preregistration = preregisterCivilization(registry, plan, engine);
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

function execute(entry: Pending, operator: string, label: string) {
  const plan = entry.plan;
  const now = new Date();
  const auth = authorizeCivilization(plan, engine, {
    operator,
    typedPrefix: plan.definition_sha256.slice(0, 8),
    reviewed: true,
    now,
  });
  if (!auth.ok) throw new Error(auth.errors.join("; "));
  const record = executeCivilization(plan, auth.value, engine, now);
  const git = gitState(root, ["docs/benchmarks/noeterra-civilization", ".rain-research"]);
  const commit = git.commit ?? "";
  const admitted = admitCivilizationRecord(
    registry,
    entry.preregistration,
    record,
    engine,
    { commit: git.commit },
  );
  const dir = join(ARCHIVE, plan.experiment_id);
  mkdirSync(dir, { recursive: true });
  write(dir, "design.json", entry.design);
  if (entry.receipt) write(dir, "receipt.json", entry.receipt);
  write(dir, "plan.json", plan);
  write(dir, "preregistration.json", entry.preregistration);
  write(dir, "record.json", record);
  write(dir, "registry-run.json", admitted.registry_run);
  write(
    dir,
    "report.md",
    report(entry, record, admitted.registry_run, commit, git.dirty),
  );
  write(dir, "summary.json", {
    label,
    outcome: `${record.result.status} (${record.result.verdict})`,
    generation: entry.design.provenance.generation,
    question: plan.ir.question,
    mean_paired_delta: record.result.measurements.mean_paired_delta,
    metric: plan.design.analysis.metric,
    replay_sha256: admitted.replay.replay_sha256,
    commit,
    dirty: git.dirty,
  });
  console.log(
    `${record.result.status.toUpperCase()} (${record.result.verdict}) — ${plan.design.analysis.metric}: mean paired difference ${fmt(record.result.measurements.mean_paired_delta, 3)}; re-simulation reproduced every state hash. Archived in ${dir}`,
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
\`npm run rain:civilization\`. Nothing here is edited by hand, and nothing is left
out: refusals, failures and inconclusive results stay beside the successes.

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

const operator =
  value("--operator") ??
  (args.includes("--scripted") ? "Scripted.DemoOperator" : "R.A.I.N.Operator");
if (args.includes("--scripted")) {
  const designs: [string, CivilizationDesign][] = [
    ["scripted: memory and war", civilizationExample()],
    [
      "scripted: an implausible threshold, to show a non-passing result is kept",
      civilizationExample({ minimumEffect: 50 }),
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
  execute(JSON.parse(readFileSync(path, "utf8")) as Pending, operator, "reviewed plan");
} else if (args.includes("--verify")) {
  let bad = 0;
  for (const d of readdirSync(ARCHIVE)) {
    const path = join(ARCHIVE, d, "record.json");
    if (!existsSync(path)) continue;
    const v = verifyCivilizationRecord(JSON.parse(readFileSync(path, "utf8")), engine);
    console.log(
      `${v.ok ? "ok      " : "FAILED  "} ${d}${v.ok ? "" : ": " + v.errors.join("; ")}`,
    );
    if (!v.ok) bad++;
  }
  if (bad) process.exitCode = 1;
} else {
  throw new Error(
    "Use --scripted, --design <file> --receipt <file>, --execute-reviewed <digest>, or --verify.",
  );
}
if (!args.includes("--verify")) index();
