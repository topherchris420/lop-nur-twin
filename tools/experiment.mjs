#!/usr/bin/env node
/**
 * Matched experiments: several configurations of the player's seat, the same
 * seeds, one table.
 *
 *   node tools/experiment.mjs tools/experiments/exposure.json
 *   node tools/experiment.mjs tools/experiments/exposure.json --parallel 2
 *   node tools/experiment.mjs --compare shots/experiments/a.json shots/experiments/b.json
 *
 * An experiment file names a question, the seeds, the episode length and the
 * arms to compare. Each arm is one seat configuration — a brain, a control
 * mode, a policy or profile — and, optionally, the origin of the build it runs
 * against, so "this build against the previous one" is two arms with two
 * origins (a `git worktree` of the old commit on another port):
 *
 *   {
 *     "name": "exposure",
 *     "hypothesis": "…what should change…",
 *     "metric": "kills per minute of the marksman arm",
 *     "seeds": [42, 43, 44], "seconds": 120, "mode": "tdm",
 *     "arms": [
 *       { "id": "marksman", "brain": "script", "policy": "marksman", "control": "precision" },
 *       { "id": "random",   "brain": "random", "control": "precision" }
 *     ]
 *   }
 *
 * Every arm is run by `tools/jev-benchmark.mjs`, unchanged, so an arm's JSON
 * is exactly the report that tool writes and every number in the table comes
 * from the simulation. The experiment adds nothing but the matching (same
 * seeds, same length, same mode) and the side-by-side. A Jev arm still needs
 * `JEV_LIVE_TEST=1` and spends credit; nothing here fakes a model's answer.
 *
 * `--compare a.json b.json` diffs two experiment results arm by arm: the way to
 * say what a game change did to every seat at once.
 */

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

const fmt = (value, digits = 2) =>
  value === null || value === undefined || Number.isNaN(value)
    ? "n/a"
    : Number(value).toFixed(digits);
const pct = (value) =>
  value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;

/**
 * The rows every experiment prints. Each reads one arm's aggregate; a value
 * the arm did not measure prints "n/a", never zero.
 */
const ROWS = [
  ["Kills / deaths", (a) => `${a.kills} / ${a.deaths}`],
  ["Kills per minute", (a, m) => fmt(m > 0 ? a.kills / m : null)],
  ["Deaths per minute", (a, m) => fmt(m > 0 ? a.deaths / m : null)],
  ["Accuracy", (a) => pct(a.accuracy)],
  ["Rounds per kill", (a) => fmt(a.shooting.shotsPerKill, 1)],
  ["Damage dealt / taken", (a) => `${fmt(a.damageDealt, 0)} / ${fmt(a.damageTaken, 0)}`],
  ["Mean survival per life", (a) => `${fmt(a.meanSurvivalS, 1)} s`],
  ["Distance moved", (a) => `${fmt(a.distanceM, 0)} m`],
  [
    "Engagement range at shot, mean",
    (a) => `${fmt(a.shooting.engagementRangeM.mean, 0)} m`,
  ],
  ["Headshots", (a) => String(a.shooting.headshots)],
  ["ADS time share", (a) => pct(a.shooting.adsFraction)],
  [
    "Time in an enemy's sight line",
    (a) => (a.debrief ? pct(a.debrief.exposedFraction) : "n/a"),
  ],
  [
    "Longest stretch in a sight line",
    (a) => (a.debrief ? `${fmt(a.debrief.longestExposedS, 1)} s` : "n/a"),
  ],
  [
    "Deaths: never seen / seen, not engaged / engaged",
    (a) =>
      a.debrief
        ? `${a.debrief.deaths.unseen} / ${a.debrief.deaths.seen_not_engaged} / ${a.debrief.deaths.engaged}`
        : "n/a",
  ],
  [
    "Deaths on open ground",
    (a) =>
      a.debrief ? `${a.debrief.deaths.onOpenGround} of ${a.debrief.deaths.total}` : "n/a",
  ],
  [
    "First sight to kill, mean",
    (a) => (a.debrief ? `${fmt(a.debrief.kills.meanSightToKillS, 2)} s` : "n/a"),
  ],
  ["Places chosen", (a) => (a.places ? String(a.places.chosen) : "n/a")],
  ["Decisions executed", (a) => String(a.decisions.accepted)],
  [
    "Timeouts / stale / invalid / errors",
    (a) =>
      `${a.decisions.timeouts} / ${a.decisions.stale} / ${a.decisions.invalid} / ${a.decisions.errors}`,
  ],
  [
    "Round trip p50 / p95",
    (a) => `${fmt(a.latency.p50Ms, 0)} / ${fmt(a.latency.p95Ms, 0)} ms`,
  ],
];

function gitBuild() {
  try {
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const dirty =
      execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
        encoding: "utf8",
      }).trim().length > 0;
    return dirty ? `${commit}+dirty` : commit;
  } catch {
    return null;
  }
}

function runArm(arm, experiment, outFile) {
  const args = [
    "tools/jev-benchmark.mjs",
    "--brain",
    arm.brain,
    "--control",
    arm.control,
    "--episodes",
    String(experiment.seeds.length),
    "--seconds",
    String(experiment.seconds),
    "--seed",
    String(experiment.seeds[0]),
    "--mode",
    experiment.mode ?? "tdm",
    "--out",
    outFile,
  ];
  if (arm.policy) args.push("--policy", arm.policy);
  if (arm.query) args.push("--query", arm.query);
  const origin = arm.origin ?? option("origin", null);
  if (origin) args.push(origin);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (chunk) => {
      log += chunk;
      for (const line of String(chunk).split("\n")) {
        if (line.startsWith("episode ")) console.log(`  [${arm.id}] ${line}`);
      }
    });
    child.stderr.on("data", (chunk) => (log += chunk));
    child.on("close", (code) =>
      code === 0
        ? resolve(JSON.parse(readFileSync(outFile, "utf8")))
        : reject(new Error(`arm ${arm.id} exited ${code}:\n${log.slice(-2000)}`)),
    );
  });
}

function table(arms) {
  const header = `| Measure (${arms[0]?.report.episodesRequested ?? "?"} × ${arms[0]?.report.secondsPerEpisode ?? "?"} s, matched seeds) | ${arms.map((a) => a.id).join(" | ")} |`;
  const rule = `| :-- | ${arms.map(() => ":--").join(" | ")} |`;
  const lines = [header, rule];
  for (const [label, read] of ROWS) {
    const cells = arms.map(({ report }) => {
      const a = report.aggregate;
      return read(a, a.simSeconds / 60);
    });
    if (cells.every((c) => c === "n/a")) continue;
    lines.push(`| ${label} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

function perSeed(arms) {
  const seeds = arms[0]?.report.episodes.map((e) => e.seed) ?? [];
  const lines = [
    `| Seed | ${arms.map((a) => a.id).join(" | ")} |`,
    `| :-- | ${arms.map(() => ":--").join(" | ")} |`,
  ];
  for (const seed of seeds) {
    const cells = arms.map(({ report }) => {
      const e = report.episodes.find((x) => x.seed === seed);
      if (!e) return "—";
      const m = e.metrics;
      return `${m.kills}/${m.deaths} K/D, ${m.hits}/${m.shotsFired} hits, ${Math.round(m.distanceM)} m`;
    });
    lines.push(`| ${seed} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

async function run(file) {
  const experiment = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(experiment.seeds) || experiment.seeds.length === 0) {
    throw new Error("an experiment needs a non-empty seeds list");
  }
  // Consecutive seeds only: the benchmark runs seed, seed+1, …
  experiment.seeds.forEach((seed, i) => {
    if (seed !== experiment.seeds[0] + i) {
      throw new Error("seeds must be consecutive integers (the benchmark steps by one)");
    }
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = option(
    "out",
    join("shots", "experiments", `${experiment.name}-${stamp}`),
  );
  mkdirSync(outDir, { recursive: true });
  const parallel = Math.max(1, Number(option("parallel", "1")) || 1);
  // The commit this checkout is at describes the build only when the arms run
  // against this checkout's own server. Against another origin (a worktree of
  // an older commit), say so, or pass --build to name it.
  const build =
    option("build", null) ??
    (option("origin", null)
      ? `unknown (served by ${option("origin", null)})`
      : gitBuild());
  console.log(
    `${experiment.name}: ${experiment.arms.length} arms × ${experiment.seeds.length} seeds × ${experiment.seconds} s · build ${build ?? "unknown"}`,
  );
  if (experiment.hypothesis) console.log(`  hypothesis: ${experiment.hypothesis}`);

  const results = new Array(experiment.arms.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= experiment.arms.length) return;
      const arm = experiment.arms[i];
      const report = await runArm(arm, experiment, join(outDir, `${arm.id}.json`));
      results[i] = { id: arm.id, arm, report };
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));

  const summary = {
    tool: "tools/experiment.mjs",
    name: experiment.name,
    hypothesis: experiment.hypothesis ?? null,
    metric: experiment.metric ?? null,
    build,
    finishedAt: new Date().toISOString(),
    seeds: experiment.seeds,
    seconds: experiment.seconds,
    mode: experiment.mode ?? "tdm",
    parallel,
    laggedEpisodes: results.flatMap(({ id, report }) =>
      report.episodes.filter((e) => e.pacing?.lagged).map((e) => `${id}:${e.seed}`),
    ),
    arms: results.map(({ id, arm, report }) => ({
      id,
      arm,
      aggregate: report.aggregate,
      blueBotBaseline: report.blueBotBaseline,
      episodes: report.episodes,
    })),
  };
  const markdown = [
    `### ${experiment.name}`,
    "",
    experiment.hypothesis ? `**Hypothesis.** ${experiment.hypothesis}` : "",
    experiment.metric ? `**Deciding metric.** ${experiment.metric}` : "",
    "",
    `Build \`${build ?? "unknown"}\`, mode ${summary.mode}, seeds ${experiment.seeds.join(", ")}, ${experiment.seconds} s each${parallel > 1 ? `, ${parallel} arms at a time` : ""}.`,
    "",
    table(results),
    "",
    perSeed(results),
    "",
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
  if (summary.laggedEpisodes.length > 0) {
    console.warn(
      `warning: ${summary.laggedEpisodes.length} episode(s) ran slower than real time (${summary.laggedEpisodes.join(", ")}); treat decision-rate-sensitive comparisons with care.`,
    );
  }
  writeFileSync(join(outDir, "experiment.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(outDir, "experiment.md"), `${markdown}\n`);
  console.log(`\n${markdown}`);
  console.log(`wrote ${join(outDir, "experiment.json")} and experiment.md`);
}

function compare(fileA, fileB) {
  const a = JSON.parse(readFileSync(fileA, "utf8"));
  const b = JSON.parse(readFileSync(fileB, "utf8"));
  const arms = a.arms.filter((x) => b.arms.some((y) => y.id === x.id));
  console.log(
    `${basename(dirname(fileA))} (${a.build}) → ${basename(dirname(fileB))} (${b.build})`,
  );
  const metrics = [
    ["kills/min", (x) => (x.kills / x.simSeconds) * 60],
    ["deaths/min", (x) => (x.deaths / x.simSeconds) * 60],
    ["accuracy", (x) => x.accuracy],
    ["survival s", (x) => x.meanSurvivalS],
    ["moved m", (x) => x.distanceM],
    ["range m", (x) => x.shooting.engagementRangeM.mean],
    ["exposed", (x) => x.debrief?.exposedFraction ?? null],
  ];
  for (const arm of arms) {
    const before = arm.aggregate;
    const after = b.arms.find((y) => y.id === arm.id).aggregate;
    const cells = metrics.map(([label, read]) => {
      const x = read(before);
      const y = read(after);
      return `${label} ${fmt(x)} → ${fmt(y)}`;
    });
    console.log(`  ${arm.id.padEnd(16)} ${cells.join(" · ")}`);
  }
}

const compareIndex = process.argv.indexOf("--compare");
if (compareIndex >= 0) {
  compare(process.argv[compareIndex + 1], process.argv[compareIndex + 2]);
} else {
  const file = process.argv.slice(2).find((arg) => arg.endsWith(".json"));
  if (!file) {
    console.error(
      "usage: node tools/experiment.mjs <experiment.json> [--parallel n] [--out dir]",
    );
    process.exit(2);
  }
  await run(file);
}
