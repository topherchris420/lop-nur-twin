#!/usr/bin/env node
/**
 * Declared, matched experiments with the seat, and their evaluation.
 *
 *   node tools/experiment.mjs tools/experiments/cover-selection.json
 *   node tools/experiment.mjs tools/experiments/latency-sweep.json --preset dev
 *   node tools/experiment.mjs tools/experiments/x.json --dry-run
 *   JEV_LIVE_TEST=1 node tools/experiment.mjs tools/experiments/jev-calibration.json
 *   LLM_LIVE_TEST=1 node tools/experiment.mjs tools/experiments/llm-comparison.json
 *   node tools/experiment.mjs --evaluate shots/experiments/<run>      # re-score saved artifacts
 *   node tools/experiment.mjs --compare a/evaluation.json b/evaluation.json
 *   node tools/experiment.mjs --shadow docs/benchmarks/<date>/<run>   # same observations, other minds
 *
 * An experiment file (`blacksite-experiment/v1`, see
 * `src/game/eval/experimentSpec.ts`) states its question, hypothesis, primary
 * metric, decision type and outcome window, seeds, duration and arms *before*
 * anything runs. The runner refuses a definition that is malformed, misspelled
 * or names a metric this build cannot compute, and prints why.
 *
 * Arms that would call a paid model (Jev, Glide, a real LLM) run only with
 * their flag (`JEV_LIVE_TEST=1`, `FASTINO_LIVE_TEST=1`, `LLM_LIVE_TEST=1`). Without it they are recorded as
 * PENDING — in the evaluation, in the table, with the reason — and the other
 * arms run; `--require-live` makes a missing flag an error instead. Nothing is
 * ever filled in for a pending arm. An arm with `"fakeLlm": true` runs against
 * the offline test double (`tools/fake-llm.mjs`) on its own dev server and is
 * labelled TEST DOUBLE everywhere.
 *
 * Every arm is run by `tools/jev-benchmark.mjs`, one arm at a time by default
 * (two pages share one software GPU and pace badly), and writes its report,
 * each episode's decision records and each episode's trace. The evaluation is
 * then built from those files alone, by `src/game/eval/evaluation.ts`, into:
 *
 *   evaluation.json   blacksite-evaluation/v1: every episode, aggregates,
 *                     decision metrics, calibration, ledger, warnings, provenance
 *   evaluation.md     the same, as the text table
 *   episodes.csv      one row per episode, for plotting
 *   sweep.csv         latency → outcome points, when the experiment sweeps
 *   definition.json   the file as run, its hash, and any command-line overrides
 *   runs.json         which report each arm wrote, for `--evaluate`
 *
 * `--preset quick|dev|eval` replaces the seeds with 3, 10 or 30 consecutive
 * ones from the first declared seed; `--duration <s>` replaces the length.
 * Both are recorded as overrides in the provenance, because a seed count chosen
 * after seeing a result is a choice the reader deserves to know about.
 */

import { spawn, execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { cpus, platform } from "node:os";
import { basename, dirname, join, relative } from "node:path";

await import("../scripts/ts-hooks.mjs");
const spec = await import("../src/game/eval/experimentSpec.ts");
const evaluation = await import("../src/game/eval/evaluation.ts");
const report = await import("../src/game/eval/report.ts");
const pricingLib = await import("../src/game/eval/pricing.ts");
const { fnv1a64 } = await import("../src/game/pilot/hash.ts");
const contract = await import("../src/game/pilot/contract.ts");
const records = await import("../src/game/eval/records.ts");
const llm = await import("../src/game/pilot/llmDecision.ts");
const recorder = await import("../src/game/pilot/recorder.ts");
const shadowLib = await import("../src/game/eval/shadow.ts");

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

function gitBuild() {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const dirty =
      execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
        encoding: "utf8",
      }).trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: null };
  }
}

function loadPricing() {
  const file = option("pricing", "config/pricing.json");
  if (!existsSync(file))
    return { file, hash: null, config: null, errors: [`${file} not found`] };
  const text = readFileSync(file, "utf8");
  const parsed = pricingLib.parsePricing(JSON.parse(text));
  if (!parsed.ok) {
    console.error(
      `pricing configuration ${file} is invalid:\n  ${parsed.errors.join("\n  ")}`,
    );
    process.exit(2);
  }
  return { file, hash: fnv1a64(text), config: parsed.value, errors: [] };
}

/** The benchmark's own flags carry brain, control and policy; the rest is query. */
function benchmarkQuery(arm, outcomeWindowS) {
  const rest = spec
    .armQuery(arm)
    .split("&")
    .filter((p) => !/^(brain|jevControl|policy)=/.test(p));
  rest.push(`outcomeWindow=${outcomeWindowS}`);
  return rest.join("&");
}

function runArm(arm, experiment, outFile, origin, runId) {
  const args = [
    "tools/jev-benchmark.mjs",
    "--brain",
    arm.brain,
    "--control",
    arm.control,
    "--seeds",
    experiment.seeds.join(","),
    "--seconds",
    String(experiment.duration),
    "--mode",
    experiment.mode,
    "--out",
    outFile,
    "--run-id",
    `${runId}-${arm.id}`,
    "--query",
    benchmarkQuery(arm, experiment.outcomeWindowS),
  ];
  if (arm.policy) args.push("--policy", arm.policy);
  if (arm.fakeLlm) args.push("--fake-llm");
  if (origin) args.push(origin);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (chunk) => {
      log += chunk;
      for (const line of String(chunk).split("\n")) {
        if (line.startsWith("episode ") || line.includes("warning"))
          console.log(`  [${arm.id}] ${line.trim()}`);
      }
    });
    child.stderr.on("data", (chunk) => (log += chunk));
    child.on("close", (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`arm ${arm.id} exited ${code}:\n${log.slice(-2000)}`)),
    );
  });
}

/**
 * An artifact named in a report, looked up by file name inside the run
 * directory — raw, or gzipped as `--archive` leaves it — so a run reads the
 * same wherever it has been moved. Returns the name found and its text.
 */
function readArtifact(dir, named) {
  if (!named) return null;
  const name = basename(named);
  if (existsSync(join(dir, name)))
    return { name, text: readFileSync(join(dir, name), "utf8") };
  if (existsSync(join(dir, `${name}.gz`))) {
    return {
      name: `${name}.gz`,
      text: gunzipSync(readFileSync(join(dir, `${name}.gz`))).toString("utf8"),
    };
  }
  return null;
}

/** Read an arm's saved report and per-episode decision records into ArmRun form. */
function loadArm(dir, entry) {
  if (entry.pending || !entry.report) {
    return {
      arm: entry.arm,
      query: entry.query,
      origin: entry.origin,
      build: entry.build,
      episodes: [],
      pending: entry.pending ?? "not run",
    };
  }
  const reportPath = join(dir, entry.report);
  const armReport = JSON.parse(readFileSync(reportPath, "utf8"));
  const episodes = armReport.episodes.map((e) => {
    const decisionsFile = readArtifact(dir, e.artifacts?.decisions ?? null);
    const saved = decisionsFile ? JSON.parse(decisionsFile.text) : null;
    // Archives written before the schema id carry none; any other id is refused.
    if (
      saved?.schema !== undefined &&
      saved.schema !== records.EPISODE_DECISIONS_SCHEMA
    ) {
      throw new Error(
        `${e.artifacts.decisions}: unsupported decision-records schema ${saved.schema}`,
      );
    }
    const traceName = e.artifacts?.trace
      ? ([basename(e.artifacts.trace), `${basename(e.artifacts.trace)}.gz`].find((n) =>
          existsSync(join(dir, n)),
        ) ?? null)
      : null;
    return {
      runId: e.runId ?? `${entry.arm.id}-s${e.seed}`,
      seed: e.seed,
      simSeconds: e.simSeconds,
      wallSeconds: e.wallSeconds,
      lagged: e.pacing?.lagged === true,
      metrics: e.metrics,
      decisions: saved?.decisions ?? [],
      failures: saved?.failures ?? [],
      brain: {
        id: saved?.brain?.id ?? e.brainDescriptor?.id ?? entry.arm.brain,
        kind: entry.arm.brain,
        provider:
          saved?.brain?.provider ??
          (entry.arm.brain === "jev"
            ? "typesafe"
            : entry.arm.brain === "glide"
              ? "fastino"
              : "local"),
        testDouble: e.testDouble === true || armReport.testDouble === true,
      },
      interface: Object.fromEntries(
        Object.entries(e.interface ?? {}).filter(
          ([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v),
        ),
      ),
      artifacts: {
        report: relative(dir, reportPath),
        decisions: decisionsFile?.name ?? null,
        trace: traceName,
      },
    };
  });
  return {
    arm: entry.arm,
    query: entry.query,
    origin: entry.origin,
    build: entry.build,
    service: armReport.service ?? null,
    episodes,
    pending: null,
  };
}

function evaluate(dir) {
  const runs = JSON.parse(readFileSync(join(dir, "runs.json"), "utf8"));
  const definition = JSON.parse(readFileSync(join(dir, "definition.json"), "utf8"));
  const pricing = loadPricing();
  const arms = runs.arms.map((entry) => loadArm(dir, entry));
  const git = gitBuild();
  const result = evaluation.buildEvaluation({
    spec: definition.spec,
    specHash: definition.hash,
    definitionPath: "definition.json",
    arms,
    pricing: pricing.config,
    environment: {
      gitCommit: runs.git?.commit ?? git.commit,
      gitDirty: runs.git?.dirty ?? git.dirty,
      servedBuilds: [...new Set(runs.arms.map((a) => a.build ?? "unknown"))].join(", "),
      node: runs.node ?? process.version,
      platform: runs.platform ?? platform(),
      cpus: runs.cpus ?? cpus().length,
      rendering: "stubbed (matrices only; see tools/jev-harness.mjs)",
      actionContract: contract.ACTION_CONTRACT_VERSION,
      observationSchema: contract.OBSERVATION_SCHEMA_VERSION,
      decisionSchema: contract.DECISION_SCHEMA_VERSION,
      llmDecisionSchema: llm.LLM_DECISION_SCHEMA,
      decisionRecordSchema: records.DECISION_RECORD_VERSION,
      traceSchema: recorder.TRACE_VERSION,
      experimentSchema: spec.EXPERIMENT_SCHEMA,
      evaluationSchema: evaluation.EVALUATION_SCHEMA,
    },
    provenance: {
      runId: runs.runId,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      definitionFile: definition.file,
      definitionFileHash: definition.fileHash,
      overrides: definition.overrides.length > 0 ? definition.overrides : ["none"],
      liveFlagsSet: runs.liveFlagsSet,
      pricingFile: pricing.file,
      pricingHash: pricing.hash,
      evaluatedAt: new Date().toISOString(),
      evaluatedAtCommit: git.commit,
    },
    generatedAt: new Date().toISOString(),
  });
  const checked = evaluation.validateEvaluation(JSON.parse(JSON.stringify(result)));
  if (!checked.ok)
    throw new Error(`the evaluation failed its own schema check: ${checked.error}`);
  writeFileSync(join(dir, "evaluation.json"), `${JSON.stringify(result, null, 2)}\n`);
  const text = report.renderText(result);
  writeFileSync(
    join(dir, "evaluation.md"),
    `# ${result.experiment.id}\n\n\`\`\`text\n${text}\n\`\`\`\n`,
  );
  writeFileSync(join(dir, "episodes.csv"), report.episodesCsv(result));
  if (result.sweeps.length > 0) {
    const rows = ["base,param,value,arm,n,mean,ci_lo,ci_hi,success_rate,decisions"];
    for (const sweep of result.sweeps) {
      for (const p of sweep.points) {
        rows.push(
          [
            sweep.base,
            sweep.param,
            p.value,
            p.arm,
            p.primary.n,
            p.primary.mean ?? "",
            p.primary.ci95?.lo ?? "",
            p.primary.ci95?.hi ?? "",
            p.successRate ?? "",
            p.decisions,
          ].join(","),
        );
      }
    }
    writeFileSync(join(dir, "sweep.csv"), `${rows.join("\n")}\n`);
  }
  console.log(`\n${text}`);
  console.log(
    `\nwrote ${join(dir, "evaluation.json")}, evaluation.md, episodes.csv${result.sweeps.length ? ", sweep.csv" : ""}`,
  );
  return result;
}

async function run(file) {
  const fileText = readFileSync(file, "utf8");
  const parsed = spec.parseExperiment(JSON.parse(fileText));
  if (!parsed.ok) {
    console.error(
      `${file} is not a valid experiment; nothing was run:\n  ${parsed.errors.join("\n  ")}`,
    );
    process.exit(2);
  }
  const experiment = parsed.spec;
  const overrides = [];
  const preset = option("preset", null);
  if (preset) {
    const count = spec.SEED_PRESETS[preset];
    if (!count) {
      console.error(
        `--preset must be one of ${Object.keys(spec.SEED_PRESETS).join(", ")}`,
      );
      process.exit(2);
    }
    const base = experiment.seeds[0];
    experiment.seeds = Array.from({ length: count }, (_, i) => base + i);
    experiment.seedPreset = preset;
    overrides.push(
      `seeds: preset ${preset} (${count} seeds from ${base}) replaced the declared list`,
    );
  }
  const duration = option("duration", null);
  if (duration) {
    const d = Number(duration);
    if (!(d >= 10 && d <= 1800)) {
      console.error("--duration: seconds in [10, 1800]");
      process.exit(2);
    }
    overrides.push(`duration: ${d} s replaced the declared ${experiment.duration} s`);
    experiment.duration = d;
  }
  const only = option("arms", null);
  if (only) {
    const wanted = new Set(only.split(","));
    experiment.arms = experiment.arms.filter((a) => wanted.has(a.id));
    overrides.push(`arms: only ${[...wanted].join(", ")}`);
  }
  const hash = spec.experimentHash(experiment);

  const pending = new Map();
  for (const message of spec.liveGate(experiment.arms, process.env)) {
    const id = /^arm (\S+)/.exec(message)?.[1];
    if (id) pending.set(id, message);
  }
  if (pending.size > 0 && flag("require-live")) {
    console.error(`live arms cannot run:\n  ${[...pending.values()].join("\n  ")}`);
    process.exit(2);
  }

  console.log(`${experiment.id} (definition ${hash})`);
  console.log(`  question:   ${experiment.question}`);
  console.log(`  hypothesis: ${experiment.hypothesis}`);
  console.log(
    `  primary:    ${experiment.primaryMetric}${experiment.decisionType ? ` under ${experiment.decisionType}` : ""}, window ${experiment.outcomeWindowS} s`,
  );
  console.log(
    `  ${experiment.arms.length} arms × ${experiment.seeds.length} seeds (${experiment.seeds.join(", ")}) × ${experiment.duration} s, mode ${experiment.mode}`,
  );
  for (const arm of experiment.arms) {
    console.log(
      `    ${arm.id.padEnd(28)} ${spec.armQuery(arm)}${arm.fakeLlm ? " [TEST DOUBLE]" : ""}${pending.has(arm.id) ? "  PENDING" : ""}`,
    );
  }
  for (const o of overrides) console.log(`  override: ${o}`);
  for (const [id, why] of pending) console.log(`  pending: ${id} — ${why}`);
  if (flag("dry-run")) return;

  const git = gitBuild();
  const runId = `${experiment.id}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outDir = option("out", join("shots", "experiments", runId));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "definition.json"),
    `${JSON.stringify({ file, fileHash: fnv1a64(fileText), hash, overrides, raw: JSON.parse(fileText), spec: experiment }, null, 2)}\n`,
  );

  const needsFake = experiment.arms.some((a) => a.fakeLlm && !pending.has(a.id));
  let fake = null;
  let fakeDev = null;
  if (needsFake) {
    const { startFakeLlm, startDevServer, FAKE_KEY, FAKE_MODEL } =
      await import("./fake-llm.mjs");
    fake = await startFakeLlm({ seed: experiment.seeds[0], latencyMs: [400, 1500] });
    fakeDev = await startDevServer(Number(option("fake-port", "5175")), {
      LLM_PROVIDER: "openai-compatible",
      LLM_BASE_URL: fake.baseUrl,
      LLM_API_KEY: FAKE_KEY,
      LLM_MODEL: FAKE_MODEL,
    });
    console.log(`  test double on ${fakeDev.origin} (no model is called)`);
  }

  const startedAt = new Date().toISOString();
  const entries = [];
  /** Arms that were meant to run and crashed, as opposed to unflagged live arms. */
  const failed = [];
  const defaultOrigin = option("origin", null);
  try {
    for (const arm of experiment.arms) {
      const origin = arm.fakeLlm ? fakeDev?.origin : (arm.origin ?? defaultOrigin);
      const build =
        arm.origin || (defaultOrigin && !arm.fakeLlm)
          ? `unknown (served by ${origin})`
          : git.commit;
      const entry = {
        arm,
        query: spec.armQuery(arm),
        origin: origin ?? "http://localhost:5173",
        build,
        report: null,
        pending: pending.get(arm.id) ?? null,
      };
      entries.push(entry);
      if (entry.pending) continue;
      const outFile = join(outDir, `${arm.id.replace(/[^a-z0-9._-]/gi, "_")}.json`);
      try {
        await runArm(arm, experiment, outFile, origin, runId);
        entry.report = basename(outFile);
      } catch (error) {
        entry.pending = `failed: ${String(error.message).split("\n")[0]}`;
        failed.push(arm.id);
        console.error(`  [${arm.id}] ${error.message}`);
      }
    }
  } finally {
    fakeDev?.close();
    await fake?.close();
  }
  const liveFlagsSet = Object.values(spec.LIVE_FLAGS).filter(
    (f) => process.env[f] === "1",
  );
  writeFileSync(
    join(outDir, "runs.json"),
    `${JSON.stringify({ runId, startedAt, finishedAt: new Date().toISOString(), git, node: process.version, platform: platform(), cpus: cpus().length, liveFlagsSet, arms: entries }, null, 2)}\n`,
  );
  evaluate(outDir);
  // The evaluation above records a crashed arm as pending, which is honest
  // about the numbers; the run itself still did not do what it was asked.
  if (failed.length > 0) {
    console.error(
      `\n[experiment] ${failed.length} of ${entries.length} arm(s) failed: ${failed.join(", ")}` +
        ` (evaluation written to ${outDir})`,
    );
    process.exitCode = 1;
  }
}

function compare(fileA, fileB) {
  const a = JSON.parse(readFileSync(fileA, "utf8"));
  const b = JSON.parse(readFileSync(fileB, "utf8"));
  if (
    a.schema === evaluation.EVALUATION_SCHEMA &&
    b.schema === evaluation.EVALUATION_SCHEMA
  ) {
    console.log(
      `${a.experiment.id} ${a.environment.gitCommit?.slice(0, 7)} → ${b.experiment.id} ${b.environment.gitCommit?.slice(0, 7)}`,
    );
    if (a.experiment.definitionHash !== b.experiment.definitionHash) {
      console.log("  note: the two runs answered different definitions (hashes differ)");
    }
    const metric = a.experiment.primaryMetric.id;
    for (const armA of a.arms) {
      const armB = b.arms.find((x) => x.id === armA.id);
      if (!armB) continue;
      const cell = (arm) => {
        const s = arm.aggregate[metric];
        return s && s.n > 0
          ? `${report.fmt(s.mean, 3)}${s.ci95 ? ` [${report.fmt(s.ci95.lo, 3)}, ${report.fmt(s.ci95.hi, 3)}]` : ""} n=${s.n}`
          : arm.status.toUpperCase();
      };
      console.log(`  ${armA.id.padEnd(28)} ${metric}: ${cell(armA)} → ${cell(armB)}`);
    }
    return;
  }
  // Summaries written before blacksite-evaluation/v1.
  const arms = a.arms.filter((x) => b.arms.some((y) => y.id === x.id));
  console.log(
    `${basename(dirname(fileA))} (${a.build}) → ${basename(dirname(fileB))} (${b.build})`,
  );
  for (const arm of arms) {
    const before = arm.aggregate;
    const after = b.arms.find((y) => y.id === arm.id).aggregate;
    const m = (x) => (x.kills / x.simSeconds) * 60;
    console.log(
      `  ${arm.id.padEnd(16)} kills/min ${report.fmt(m(before))} → ${report.fmt(m(after))}`,
    );
  }
}

/**
 * Copy a run into an archive directory with its decision records and traces
 * gzipped (they compress about eighteen-fold), then re-evaluate it there so the
 * evaluation's artifact paths name the archived files.
 */
function archive(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(source)) {
    const from = join(source, name);
    if (/\.(eval\.json|trace\.jsonl)$/.test(name)) {
      writeFileSync(
        join(destination, `${name}.gz`),
        gzipSync(readFileSync(from), { level: 9 }),
      );
    } else {
      copyFileSync(from, join(destination, name));
    }
  }
  evaluate(destination);
}

/**
 * Same observations, other minds: show every arm's recorded observations, in
 * order, to the scripted reference policies, and report per-axis agreement
 * with what the arm chose against the exact agreement of a uniform chooser.
 * Reads the run's own decision records; runs nothing and calls nothing. Writes
 * shadow.json (blacksite-shadow/v1) and shadow.md beside the evaluation.
 */
/**
 * Markdown as the repository's formatter would write it, so a regenerated
 * archive never fails `format:check`. Prettier is a development dependency;
 * without it the text is written as generated.
 */
async function formatMarkdown(text, file) {
  try {
    const prettier = await import("prettier");
    const options = (await prettier.resolveConfig(file)) ?? {};
    return await prettier.format(text, { ...options, filepath: file });
  } catch {
    return text;
  }
}

async function shadow(dir) {
  const runs = JSON.parse(readFileSync(join(dir, "runs.json"), "utf8"));
  const arms = runs.arms
    .map((entry) => loadArm(dir, entry))
    .filter((arm) => arm.episodes.length > 0);
  const pct = (value) => (value === null ? "—" : `${(value * 100).toFixed(0)}%`);
  const axes = contract.AXES;
  const lines = [
    `# Same observations, other minds — ${basename(dir)}`,
    "",
    `Each arm's recorded observations, shown in order to the scripted reference policies. Cells are agreement with the arm's choice, with the exact agreement of a uniform chooser over the same offered options in parentheses; an axis that offered one option is not a choice and is left out. Means over episodes, the unit.`,
    "",
    `> ${shadowLib.SHADOW_CAVEAT}`,
    "",
    `| Arm | Reference | Decisions | ${axes.join(" | ")} |`,
    `| :-- | :-- | --: | ${axes.map(() => "--:").join(" | ")} |`,
  ];
  const result = {
    schema: shadowLib.SHADOW_SCHEMA,
    run: basename(dir),
    runId: runs.runId ?? null,
    gitCommit: runs.git?.commit ?? null,
    caveat: shadowLib.SHADOW_CAVEAT,
    arms: [],
  };
  console.log(`same observations, other minds · ${basename(dir)}`);
  console.log(`  ${shadowLib.SHADOW_CAVEAT}`);
  for (const arm of arms) {
    const references = shadowLib.SHADOW_REFERENCES.map((reference) =>
      shadowLib.summarizeShadow(
        reference,
        arm.episodes.map((episode) =>
          shadowLib.shadowEpisode(
            {
              episodeId: episode.runId,
              seed: episode.seed,
              decisions: episode.decisions,
            },
            reference,
          ),
        ),
      ),
    );
    result.arms.push({ id: arm.arm.id, brain: arm.arm.brain, references });
    for (const summary of references) {
      const cells = axes.map((axis) => {
        const row = summary.axes.find((candidate) => candidate.axis === axis);
        return row && row.episodes > 0
          ? `${pct(row.agreement)} (${pct(row.chance)})`
          : "—";
      });
      lines.push(
        `| ${arm.arm.id} | ${summary.reference} | ${summary.compared} | ${cells.join(" | ")} |`,
      );
      console.log(
        `  ${arm.arm.id.padEnd(20)} vs ${summary.reference.padEnd(10)} n=${String(summary.compared).padStart(5)}  ${axes
          .map((axis, index) => `${axis} ${cells[index]}`)
          .join("  ")}`,
      );
    }
  }
  writeFileSync(join(dir, "shadow.json"), `${JSON.stringify(result, null, 2)}\n`);
  const markdown = join(dir, "shadow.md");
  writeFileSync(markdown, await formatMarkdown(`${lines.join("\n")}\n`, markdown));
  console.log(`  wrote ${join(dir, "shadow.json")} and shadow.md`);
}

const compareIndex = process.argv.indexOf("--compare");
const shadowDir = option("shadow", null);
const archiveIndex = process.argv.indexOf("--archive");
const evaluateDir = option("evaluate", null);
if (compareIndex >= 0) {
  compare(process.argv[compareIndex + 1], process.argv[compareIndex + 2]);
} else if (archiveIndex >= 0) {
  archive(process.argv[archiveIndex + 1], process.argv[archiveIndex + 2]);
} else if (evaluateDir) {
  evaluate(evaluateDir);
} else if (shadowDir) {
  await shadow(shadowDir);
} else {
  const file = process.argv.slice(2).find((arg) => arg.endsWith(".json"));
  if (!file) {
    console.error(
      "usage: node tools/experiment.mjs <experiment.json> [--preset quick|dev|eval] [--duration s] [--arms a,b] [--dry-run] [--out dir] [--origin url] [--pricing file] [--require-live]\n" +
        "       node tools/experiment.mjs --evaluate <run dir>\n" +
        "       node tools/experiment.mjs --compare a/evaluation.json b/evaluation.json\n" +
        "       node tools/experiment.mjs --shadow <run dir>",
    );
    process.exit(2);
  }
  await run(file);
}
