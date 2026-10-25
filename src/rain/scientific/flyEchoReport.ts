/**
 * Project ECHO's evaluation report: the frozen self-model and its ablations
 * on fixed, declared seeds, in every cell the evaluation needs, summarized
 * with bootstrap confidence intervals, paired comparisons against the full
 * self-model, the fly's confusion between causes, the reliability of its
 * stated confidence, the coverage of its predicted intervals, the cases where
 * it did worse than its baseline, and a check of checkpoint recovery.
 *
 * Seeds: SHA-256("echo-evaluation/v1|" + counter), eight 32-bit seeds per
 * digest: fixed and public like the pilots', and distinct from the
 * development seeds (SHA-256("echo-development/v1|" + counter), on which the
 * self-model was built) and from the pilot seeds. The cells:
 *
 * - `development`: the development conditions in the development arena, on
 *   the development seeds: the data the self-model was tuned on, shown so the
 *   gap to held-out data is visible, never as evidence;
 * - `strengths`: the held-out evaluation conditions in the development arena,
 *   on the evaluation seeds: generalization to unseen strengths and
 *   combinations alone;
 * - `held-out`: the held-out conditions in the held-out arena, the registered
 *   protocols' apparatus, on the evaluation seeds: the evaluation proper.
 *
 * It is a seeded characterization of a simulator, reproduced byte for byte by
 * `scripts/echo-evaluate.ts --check`. It is not preregistered evidence (the
 * R.A.I.N. records in docs/benchmarks/fly-behavior/ are), never evidence
 * about Drosophila, and never evidence of awareness.
 */
import { canonicalJson, sha256 } from "../sha256.js";
import { mulberry32 } from "../../lib/noise.js";
import { FLY_VERSION } from "../../bethesda/fly/fly.js";
import { ECHO_VERSION } from "../../bethesda/fly/echo/params.js";
import { VARIANT_LABELS, type EchoVariant } from "../../bethesda/fly/echo/selfModel.js";
import { serializeEchoCheckpoint } from "../../bethesda/fly/echo/checkpoint.js";
import { FLY_APPARATUS } from "./fly.js";
import { FLY_SOURCE } from "./flySource.js";
import {
  attributionMetrics,
  deriveEcho,
  drawEchoSchedule,
  ECHO_DEVELOPMENT_CONDITIONS as DEV,
  echoTrialFor,
  impairmentMetrics,
  retentionMetrics,
  runEchoTrial,
  scoreChanges,
  type EchoApparatus,
  type EchoTrial,
  type EchoTruth,
  type ScoredChange,
} from "./flyEcho.js";
import type { FlyBlockSpec } from "./contracts.js";

export const ECHO_EVALUATION = "fly-echo-evaluation/v1" as const;
export const ECHO_EVALUATION_STATUS =
  "SIMULATED CHARACTERIZATION: a seeded run of a reduced-order simulator's functional self-model; not preregistered evidence, not evidence about Drosophila, not evidence of awareness or subjective experience";
export const ECHO_EVALUATION_SEEDS = 24;
/** The salts each schedule's runs derive their streams from (the backend's own, so a cell is that protocol's apparatus). */
const SALTS = {
  impairment: 0x696d70,
  attribution: 0x617474,
  retention: 0x726574,
} as const;
type Schedule = keyof typeof SALTS;

/** `count` 32-bit seeds from SHA-256(`domain` + "|" + counter), eight per digest. */
export function seedDomain(domain: string, count: number): number[] {
  const seeds: number[] = [];
  for (let counter = 0; seeds.length < count; counter++) {
    const block = sha256(`${domain}|${counter}`);
    for (let i = 0; i < 64 && seeds.length < count; i += 8) {
      const s = Number.parseInt(block.slice(i, i + 8), 16);
      if (!seeds.includes(s)) seeds.push(s);
    }
  }
  return seeds;
}

/** The variants each schedule compares against the full self-model. */
export const ECHO_EVALUATION_ARMS: Record<
  Schedule,
  { id: string; variant: EchoVariant; reset: boolean }[]
> = {
  impairment: [
    { id: "full", variant: "full", reset: false },
    { id: "reactive", variant: "reactive", reset: false },
    { id: "no_learning", variant: "no_learning", reset: false },
    { id: "no_uncertainty", variant: "no_uncertainty", reset: false },
    { id: "no_memory", variant: "no_memory", reset: false },
  ],
  attribution: [
    { id: "full", variant: "full", reset: false },
    { id: "naive_self", variant: "naive_self", reset: false },
    { id: "motion_gated", variant: "motion_gated", reset: false },
    { id: "no_uncertainty", variant: "no_uncertainty", reset: false },
    { id: "no_memory", variant: "no_memory", reset: false },
    { id: "no_learning", variant: "no_learning", reset: false },
  ],
  retention: [
    { id: "full", variant: "full", reset: false },
    { id: "memory_reset", variant: "full", reset: true },
    { id: "no_memory", variant: "no_memory", reset: false },
    { id: "no_learning", variant: "no_learning", reset: false },
    { id: "reactive", variant: "reactive", reset: false },
  ],
};

const DEV_ARENA: FlyBlockSpec["arena"] = { size: [4, 2.5, 4], ambient: 0.6, pillars: [] };
type Cell = "development" | "strengths" | "held-out";
export const ECHO_CELLS: readonly Cell[] = ["development", "strengths", "held-out"];

/** The block a cell runs: the registered apparatus, with the development arena or conditions where the cell says. */
export function cellBlock(schedule: Schedule, cell: Cell): FlyBlockSpec {
  const block = structuredClone(FLY_APPARATUS[schedule]);
  if (cell !== "held-out") block.arena = structuredClone(DEV_ARENA);
  if (cell === "development")
    block.echo = {
      ...block.echo!,
      conditions: "development",
      condition_set:
        schedule === "attribution"
          ? [DEV.speed_gain, DEV.turn_bias, DEV.push, DEV.spin, DEV.sensor_noise]
          : [DEV.speed_gain, DEV.turn_gain, DEV.turn_bias],
    };
  return block;
}

// --------------------------------------------------------------- statistics

const mean = (xs: readonly number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const r4 = (x: number | null) => (x === null ? null : Number(x.toPrecision(4)));

/**
 * A 95% percentile-bootstrap interval for the mean (2000 resamples from a
 * fixed stream): exact to reproduce, approximate as an interval, and over
 * seeds of one simulator, never a population of flies.
 */
export function bootstrap(xs: readonly number[], salt: number): [number, number] | null {
  if (xs.length < 2) return null;
  const r = mulberry32(deriveEcho(0x626f6f74, salt, xs.length));
  const means: number[] = [];
  for (let b = 0; b < 2000; b++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(r() * xs.length)]!;
    means.push(s / xs.length);
  }
  means.sort((a, b) => a - b);
  return [r4(means[49]!)!, r4(means[1949]!)!];
}

let saltCounter = 0;
export interface Summary {
  n: number;
  mean: number | null;
  ci95: [number, number] | null;
}
const summary = (xs: readonly number[]): Summary => ({
  n: xs.length,
  mean: r4(mean(xs)),
  ci95: bootstrap(xs, ++saltCounter),
});

// -------------------------------------------------------------------- runs

export interface SeedResult {
  seed: number;
  /** What was done to the fly, as the experimenter knows it. */
  truth: { condition: string; cause: string; from: number; until: number | null }[];
  metrics: Record<string, number | null>;
  hash: string;
}
export interface CellResult {
  schedule: Schedule;
  cell: Cell;
  arm: string;
  label: string;
  per_seed: SeedResult[];
  summary: Record<string, Summary>;
  /** Of the self-motion components the fly observed, how many fell in its predicted central 50% and 90%. */
  coverage: { n: number; in50: number | null; in90: number | null };
}

function metricsOf(trial: EchoTrial, block: FlyBlockSpec): Record<string, number | null> {
  const a = block.echo!;
  switch (a.schedule) {
    case "impairment":
      return { ...impairmentMetrics(trial, a, block.duration_s) };
    case "attribution":
      return { ...attributionMetrics(trial, a) };
    case "retention":
      return { ...retentionMetrics(trial, a) };
  }
}

const roundMetrics = (m: Record<string, number | null>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v === null ? null : r4(v)]));

interface Raw {
  cell: CellResult;
  scored: ScoredChange[][];
}

function runCell(
  schedule: Schedule,
  cell: Cell,
  armId: string,
  seeds: readonly number[],
  log: (s: string) => void,
): Raw {
  const arm = ECHO_EVALUATION_ARMS[schedule].find((a) => a.id === armId)!;
  const block = cellBlock(schedule, cell);
  const reset = arm.reset ? block.echo!.phases_s[4]! - 5 : null;
  const per: SeedResult[] = [];
  const scored: ScoredChange[][] = [];
  let n = 0,
    in50 = 0,
    in90 = 0;
  for (const seed of seeds) {
    const trial = echoTrialFor(
      { ...block, echo: block.echo! },
      { variant: arm.variant, reset_s: reset, config: {} },
      seed,
      SALTS[schedule],
    );
    per.push({
      seed,
      truth: trial.truth.map((t) => ({
        condition: t.condition,
        cause: t.cause,
        from: t.from,
        until: t.until,
      })),
      metrics: roundMetrics(metricsOf(trial, block)),
      hash: trial.fly.stateHash(),
    });
    if (schedule === "attribution") scored.push(scoreChanges(trial.truth, trial.events));
    const c = trial.adapter.model?.state.calibration;
    if (c) {
      n += 3 * c.n;
      in50 += c.in50.reduce((a, b) => a + b, 0);
      in90 += c.in90.reduce((a, b) => a + b, 0);
    }
  }
  const keys = [...new Set(per.flatMap((p) => Object.keys(p.metrics)))].sort();
  log(`${schedule} ${cell} ${armId}: ${seeds.length} seeds`);
  return {
    cell: {
      schedule,
      cell,
      arm: armId,
      label: arm.reset
        ? "the full self-model reset to an innate one 5 s before the remembered change returns"
        : VARIANT_LABELS[arm.variant],
      per_seed: per,
      summary: Object.fromEntries(
        keys.map((k) => [
          k,
          summary(
            per.flatMap((p) => (typeof p.metrics[k] === "number" ? [p.metrics[k]] : [])),
          ),
        ]),
      ),
      coverage: { n, in50: n ? r4(in50 / n) : null, in90: n ? r4(in90 / n) : null },
    },
    scored,
  };
}

export interface Comparison {
  schedule: Schedule;
  cell: Cell;
  metric: string;
  treatment: string;
  /** Treatment minus the full self-model, over the seeds where both are defined. */
  n: number;
  mean_difference: number | null;
  ci95: [number, number] | null;
  increase: number;
  decrease: number;
  tie: number;
}

function compare(control: CellResult, treatment: CellResult, metric: string): Comparison {
  const d: number[] = [];
  control.per_seed.forEach((c, i) => {
    const a = c.metrics[metric],
      b = treatment.per_seed[i]!.metrics[metric];
    if (typeof a === "number" && typeof b === "number") d.push(b - a);
  });
  return {
    schedule: control.schedule,
    cell: control.cell,
    metric,
    treatment: treatment.arm,
    n: d.length,
    mean_difference: r4(mean(d)),
    ci95: bootstrap(d, ++saltCounter),
    increase: d.filter((x) => x > 0).length,
    decrease: d.filter((x) => x < 0).length,
    tie: d.filter((x) => x === 0).length,
  };
}

/** What each cause was answered with, over every scored change. */
function confusion(scored: ScoredChange[][]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const s of scored.flat()) {
    const row = s.condition === "misleading_sense" ? "misleading sense" : s.cause;
    out[row] ??= {};
    out[row][s.answered] = (out[row][s.answered] ?? 0) + 1;
  }
  return out;
}

/** Stated confidence against accuracy, in bins of the fly's posterior. */
function reliability(scored: ScoredChange[][]) {
  const bins: [number, number][] = [
    [0, 0.7],
    [0.7, 0.9],
    [0.9, 0.97],
    [0.97, 1.0001],
  ];
  const all = scored
    .flat()
    .filter((s) => s.probability !== null && s.condition !== "misleading_sense");
  const rows = bins.map(([lo, hi]) => {
    const inBin = all.filter((s) => s.probability! >= lo && s.probability! < hi);
    return {
      bin: [lo, Math.min(1, hi)],
      n: inBin.length,
      stated: r4(mean(inBin.map((s) => s.probability!))),
      accuracy: r4(mean(inBin.map((s) => (s.correct ? 1 : 0)))),
    };
  });
  const ece = all.length
    ? rows.reduce(
        (a, r) => a + (r.n / all.length) * Math.abs((r.stated ?? 0) - (r.accuracy ?? 0)),
        0,
      )
    : null;
  return { rows, expected_calibration_error: r4(ece) };
}

/**
 * Checkpoint recovery: the self-model checkpointed mid-run, serialized, parsed
 * and restored into the same running fly, against the same fly left alone.
 */
function checkpointCheck(seeds: readonly number[]) {
  const block = cellBlock("retention", "held-out");
  return seeds.map((seed) => {
    const make = (restoreAt: number | null) => {
      const r = mulberry32(deriveEcho(seed, SALTS.retention, 2));
      const truth: EchoTruth[] = drawEchoSchedule(
        block.echo as EchoApparatus,
        block.duration_s,
        r,
      );
      return runEchoTrial({
        arena: {
          size: [...block.arena.size],
          ambient: block.arena.ambient,
          pillars: block.arena.pillars,
        },
        arenaId: "fly-retention",
        startHalfWidth: block.start_half_width_m,
        config: { ...block.fixed_config },
        durationS: block.duration_s,
        truth,
        arm: { variant: "full", reset_s: null },
        seed: deriveEcho(seed, SALTS.retention, 1),
        geometry: mulberry32(deriveEcho(seed, SALTS.retention, 0)),
        ...(restoreAt !== null ? { checkpointAt: restoreAt } : {}),
      });
    };
    const plain = make(null),
      restored = make(147.5);
    return {
      seed,
      restored_at_s: 147.5,
      same_body: canonicalJson(plain.fly.state) === canonicalJson(restored.fly.state),
      same_self_model:
        canonicalJson(plain.adapter.model!.state) ===
        canonicalJson(restored.adapter.model!.state),
      checkpoint_bytes: serializeEchoCheckpoint(restored.adapter.checkpoint()!).length,
      replacements: restored.adapter.state.replaced.length,
    };
  });
}

export function echoEvaluationReport(log: (s: string) => void = () => {}) {
  saltCounter = 0;
  const evaluation = seedDomain("echo-evaluation/v1", ECHO_EVALUATION_SEEDS);
  const development = seedDomain("echo-development/v1", ECHO_EVALUATION_SEEDS);
  const cells: CellResult[] = [];
  const comparisons: Comparison[] = [];
  const attribution: Record<
    string,
    {
      confusion: ReturnType<typeof confusion>;
      reliability: ReturnType<typeof reliability>;
    }
  > = {};
  for (const schedule of Object.keys(SALTS) as Schedule[])
    for (const cell of ECHO_CELLS) {
      const seeds = cell === "development" ? development : evaluation;
      // The strengths cell isolates conditions from the arena: the full model and its main baseline suffice.
      const arms = ECHO_EVALUATION_ARMS[schedule].filter(
        (_, i) => cell !== "strengths" || i <= 1,
      );
      const raws = arms.map((a) => runCell(schedule, cell, a.id, seeds, log));
      cells.push(...raws.map((r) => r.cell));
      const full = raws[0]!.cell;
      for (const r of raws.slice(1))
        for (const metric of Object.keys(full.summary))
          comparisons.push(compare(full, r.cell, metric));
      if (schedule === "attribution")
        for (const r of raws)
          attribution[`${cell}/${r.cell.arm}`] = {
            confusion: confusion(r.scored),
            reliability: reliability(r.scored),
          };
    }
  const checkpoints = checkpointCheck(evaluation.slice(0, 4));
  return {
    schema: ECHO_EVALUATION,
    status: ECHO_EVALUATION_STATUS,
    fly: FLY_VERSION,
    echo: ECHO_VERSION,
    fly_source_sha256: FLY_SOURCE.sha256,
    seeds: {
      evaluation: { domain: "echo-evaluation/v1", values: evaluation },
      development: { domain: "echo-development/v1", values: development },
    },
    cells,
    comparisons,
    attribution,
    checkpoints,
  };
}
export type EchoEvaluationReport = ReturnType<typeof echoEvaluationReport>;

// ------------------------------------------------------------------- README

const KEY_METRICS: Record<Schedule, string[]> = {
  impairment: [
    "impaired_path_error",
    "late_path_error",
    "baseline_path_error",
    "detection_latency_s",
    "attribution_latency_s",
    "identification_error",
    "false_alarms_per_min",
    "impaired_walked_m",
  ],
  attribution: [
    "attribution_accuracy",
    "false_self_attribution",
    "attribution_brier",
    "attribution_path_error",
    "missed_changes",
    "misleading_sense_blamed_self",
  ],
  retention: [
    "reexposure_path_error",
    "reexposure_latency_s",
    "first_exposure_path_error",
    "first_exposure_latency_s",
    "unfamiliar_path_error",
    "recalls",
    "false_recalls",
  ],
};
const TITLES: Record<Schedule, string> = {
  impairment: "ECHO-01 · recognizing a bodily impairment",
  attribution: "ECHO-02 · self versus external causation",
  retention: "ECHO-03 · learning retained through time",
};
const CELL_TEXT: Record<Cell, string> = {
  development:
    "development conditions, development arena, development seeds (tuned on: not evidence)",
  strengths: "held-out conditions, development arena, evaluation seeds",
  "held-out":
    "held-out conditions, held-out arena, evaluation seeds (the evaluation proper)",
};

const num = (x: number | null | undefined) => (typeof x === "number" ? String(x) : "—");
const ci = (c: [number, number] | null) => (c ? `[${c[0]}, ${c[1]}]` : "—");

export function renderEchoReadme(r: EchoEvaluationReport, commit: string): string {
  const out: string[] = [];
  out.push(`# Project ECHO evaluation: simulated characterization

> **${r.status}.** Written by \`node scripts/run-ts.mjs scripts/echo-evaluate.ts\`
> from ${commit}; \`--check\` reproduces it byte for byte. Never edit it by hand.
> What the numbers mean, and what they do not, is in
> [docs/PROJECT_ECHO.md](../../PROJECT_ECHO.md).

Fly ${r.fly}, self-model ${r.echo}, fly source \`${r.fly_source_sha256.slice(0, 12)}\`.
${r.seeds.evaluation.values.length} evaluation seeds (SHA-256("${r.seeds.evaluation.domain}|" + counter))
and ${r.seeds.development.values.length} development seeds (SHA-256("${r.seeds.development.domain}|" + counter)),
each drawing its own hidden schedule; both arms of a comparison share seeds,
schedules and placements. Intervals are 95% percentile-bootstrap intervals
over seeds (2000 resamples from a fixed stream): they describe this
simulator's seeds, not a population of flies.

Cells: ${ECHO_CELLS.map((c) => `**${c}**: ${CELL_TEXT[c]}`).join("; ")}.
`);
  for (const schedule of Object.keys(TITLES) as Schedule[]) {
    out.push(`## ${TITLES[schedule]}\n`);
    for (const cell of ECHO_CELLS) {
      const cs = r.cells.filter((c) => c.schedule === schedule && c.cell === cell);
      const metrics = KEY_METRICS[schedule].filter((m) => cs.some((c) => c.summary[m]));
      out.push(`### ${cell}: ${CELL_TEXT[cell]}\n`);
      out.push(
        `| arm | ${metrics.join(" | ")} | 90% interval coverage |\n| :--- | ${metrics.map(() => "---:").join(" | ")} | ---: |`,
      );
      for (const c of cs)
        out.push(
          `| ${c.arm} | ${metrics.map((m) => (c.summary[m] && c.summary[m].n ? `${num(c.summary[m].mean)} ${ci(c.summary[m].ci95)} (n ${c.summary[m].n})` : "—")).join(" | ")} | ${num(c.coverage.in90)} |`,
        );
      const comp = r.comparisons.filter(
        (x) => x.schedule === schedule && x.cell === cell && metrics.includes(x.metric),
      );
      if (comp.length) {
        out.push(
          `\nPaired differences, arm minus full (mean [95% interval], seeds up / down / tied):\n\n| arm | ${metrics.join(" | ")} |\n| :--- | ${metrics.map(() => "---:").join(" | ")} |`,
        );
        for (const arm of [...new Set(comp.map((x) => x.treatment))])
          out.push(
            `| ${arm} | ${metrics
              .map((m) => {
                const x = comp.find((y) => y.treatment === arm && y.metric === m);
                return x && x.n
                  ? `${num(x.mean_difference)} ${ci(x.ci95)} ${x.increase}/${x.decrease}/${x.tie}`
                  : "—";
              })
              .join(" | ")} |`,
          );
      }
      if (schedule === "attribution") {
        const full = r.attribution[`${cell}/full`];
        if (full) {
          const answers = [
            ...new Set(Object.values(full.confusion).flatMap((row) => Object.keys(row))),
          ].sort();
          out.push(
            `\nThe full self-model's answers, by what was done (counts over every scored change):\n\n| done \\ answered | ${answers.join(" | ")} |\n| :--- | ${answers.map(() => "---:").join(" | ")} |`,
          );
          for (const [row, cols] of Object.entries(full.confusion).sort())
            out.push(`| ${row} | ${answers.map((a) => cols[a] ?? 0).join(" | ")} |`);
          out.push(
            `\nIts stated confidence against its accuracy (expected calibration error ${num(full.reliability.expected_calibration_error)}):\n\n| stated posterior | conclusions | mean stated | accuracy |\n| :--- | ---: | ---: | ---: |`,
          );
          for (const b of full.reliability.rows)
            out.push(
              `| ${b.bin[0]}–${b.bin[1]} | ${b.n} | ${num(b.stated)} | ${num(b.accuracy)} |`,
            );
        }
      }
      out.push("");
    }
    // Where the self-model did worse than its main baseline, held out.
    const held = r.cells.filter((c) => c.schedule === schedule && c.cell === "held-out");
    const full = held.find((c) => c.arm === "full")!;
    const metric = KEY_METRICS[schedule][0]!;
    const baseline = held[1]!;
    const worse = full.per_seed.filter((p, i) => {
      const a = p.metrics[metric],
        b = baseline.per_seed[i]!.metrics[metric];
      if (typeof a !== "number" || typeof b !== "number") return false;
      return schedule === "attribution" ? a < b : a > b;
    });
    out.push(
      `**Failures, held out**: seeds where the full self-model did worse than ${baseline.arm} on ${metric}: ${worse.length} of ${full.per_seed.length}${worse.length ? ` (${worse.map((w) => `${w.seed}: ${w.truth.map((t) => t.condition).join(", ")}`).join("; ")})` : ""}.\n`,
    );
  }
  out.push(`## Checkpoint recovery

The self-model's checkpoint taken at ${r.checkpoints[0]?.restored_at_s ?? "—"} s of ECHO-03's held-out schedule,
serialized, parsed and restored into the same running fly, against the same
fly left alone (the checkpoint holds the self-model only, so this tests that
it holds all of it):

| seed | same body at the end | same self-model at the end | checkpoint bytes | replacements on record |
| :--- | :--- | :--- | ---: | ---: |
${r.checkpoints.map((c) => `| ${c.seed} | ${c.same_body ? "yes" : "NO"} | ${c.same_self_model ? "yes" : "NO"} | ${c.checkpoint_bytes} | ${c.replacements} |`).join("\n")}
`);
  return out.join("\n");
}
