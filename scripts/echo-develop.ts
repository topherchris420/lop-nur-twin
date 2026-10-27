/**
 * Project ECHO development runs: the self-model on the development conditions
 * only (ECHO_DEVELOPMENT_CONDITIONS), in the development arena, on the
 * development seeds, SHA-256("echo-development/v1|" + counter). This is the
 * loop the self-model was built and tuned in. It is not evidence: nothing
 * here is preregistered, its seeds and conditions are never those of an
 * evaluation, and it writes nothing.
 *
 *   node scripts/run-ts.mjs scripts/echo-develop.ts [--seeds 8] [--schedule impairment|attribution|retention|busy]
 *     [--variants full,reactive,...] [--config '{"takeoffHz":0.5}'] [--verbose]
 *
 * `busy` is the impairment schedule on a fly that often takes off and grooms
 * (ECHO-04's block), scored by its own measures.
 */
import { sha256 } from "../src/rain/sha256.js";
import {
  attributionMetrics,
  busyMetrics,
  ECHO_DEVELOPMENT_CONDITIONS,
  echoTrialFor,
  impairmentMetrics,
  retentionMetrics,
  scoreChanges,
  type EchoApparatus,
  type EchoSchedule,
} from "../src/rain/scientific/flyEcho.js";
import { ECHO_VARIANTS, type EchoVariant } from "../src/bethesda/fly/echo/selfModel.js";

const args = process.argv.slice(2);
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
const seedCount = Number(value("--seeds") ?? 6);
type Run = EchoSchedule | "busy";
const schedules = (value("--schedule")?.split(",") ?? [
  "impairment",
  "attribution",
  "retention",
]) as Run[];
/** ECHO-04's urges (fly.ts BUSY), over the walking defaults. */
const BUSY = { takeoffHz: 0.5, groomHz: 0.5 };
const variants = (value("--variants")?.split(",") ?? [
  "full",
  "reactive",
]) as EchoVariant[];
for (const v of variants)
  if (!ECHO_VARIANTS.includes(v)) throw new Error(`no variant ${v}`);
const verbose = args.includes("--verbose");
// --config '{"takeoffHz":0.15}': behaviour rates over the walking defaults, to develop on a busier fly.
const config = JSON.parse(value("--config") ?? "{}") as Record<string, number>;

const seeds: number[] = [];
for (let counter = 0; seeds.length < seedCount; counter++) {
  const block = sha256(`echo-development/v1|${counter}`);
  for (let i = 0; i < 64 && seeds.length < seedCount; i += 8)
    seeds.push(Number.parseInt(block.slice(i, i + 8), 16));
}

const dev = ECHO_DEVELOPMENT_CONDITIONS;
const apparatus = (run: Run): EchoApparatus => ({
  schedule: run === "busy" ? "impairment" : run,
  conditions: "development",
  condition_set:
    run === "attribution"
      ? [dev.speed_gain, dev.turn_bias, dev.push, dev.spin, dev.sensor_noise]
      : [dev.speed_gain, dev.turn_gain, dev.turn_bias],
  onset_s: [30, 40],
  onsets_s: [20, 55, 90, 125],
  jitter_s: 3,
  episode_s: [15, 22],
  persistent_last: 0.5,
  phases_s: [25, 65, 90, 125, 150, 185, 210],
  window_s: 1,
  reexposure_s: 10,
});
const duration = {
  impairment: 120,
  attribution: 160,
  retention: 245,
  busy: 120,
} as const;
const block = (run: Run) => ({
  id: run,
  arena: { size: [4, 2.5, 4] as [number, number, number], ambient: 0.6, pillars: [] },
  fixed_config: {
    takeoffHz: 0,
    groomHz: 0,
    walkStartHz: 1,
    walkStopHz: 0.1,
    ...(run === "busy" ? BUSY : {}),
    ...config,
  },
  start_half_width_m: 0.5,
  duration_s: duration[run],
  echo: apparatus(run),
});

const fmt = (x: number | null | undefined, d = 3) =>
  typeof x === "number" ? x.toFixed(d) : "—";
for (const schedule of schedules) {
  console.log(
    `\n== ${schedule} (development conditions, ${seeds.length} development seeds)`,
  );
  const sums: Record<string, Record<string, number[]>> = {};
  for (const variant of variants) {
    sums[variant] = {};
    for (const seed of seeds) {
      const t0 = performance.now();
      const trial = echoTrialFor(
        block(schedule),
        {
          variant,
          reset_s: null,
          config: {},
        },
        seed,
        0x6563686f,
      );
      const ms = performance.now() - t0;
      const m =
        schedule === "busy"
          ? busyMetrics(trial, block(schedule).echo, duration[schedule])
          : schedule === "impairment"
            ? impairmentMetrics(trial, block(schedule).echo, duration[schedule])
            : schedule === "attribution"
              ? attributionMetrics(trial, block(schedule).echo)
              : retentionMetrics(trial, block(schedule).echo);
      for (const [k, v] of Object.entries(m))
        if (typeof v === "number") (sums[variant][k] ??= []).push(v);
      // What the workspace and the second look did (counts, per trial).
      const counts = trial.adapter.model?.state.counts;
      if (counts)
        for (const k of ["held", "shielded", "confirmed", "revised", "doubted"] as const)
          (sums[variant][`(${k})`] ??= []).push(counts[k]);
      if (verbose) {
        console.log(
          `  ${variant} seed ${seed}: ${trial.truth.map((t) => `${t.condition}@${t.from}${t.until !== null ? `-${t.until}` : ""} ${JSON.stringify(t.values)}`).join("; ")}`,
        );
        console.log(
          `    ${Object.entries(m)
            .map(([k, v]) => `${k}=${fmt(v as number | null)}`)
            .join(
              " ",
            )}  (${ms.toFixed(0)} ms, refusals ${trial.fly.state.counts.rejected})`,
        );
        if (trial.adapter.model) {
          console.log(
            `    events: ${trial.events.map((ev) => `${ev.t.toFixed(2)} ${ev.kind}${ev.explanation ? ` ${ev.candidate} p=${fmt(ev.probability, 2)}${ev.resolved === false ? " unresolved" : ""}` : ""}${ev.probe ? ` ${ev.probe}` : ""}`).join(", ")}`,
          );
          if (schedule === "attribution")
            console.log(
              `    scored: ${scoreChanges(trial.truth, trial.events)
                .map(
                  (s) =>
                    `${s.condition}/${s.edge}@${s.at}→${s.answered}${s.correct ? "✓" : "✗"}`,
                )
                .join(" ")}`,
            );
          const b = trial.finalBelief!;
          console.log(`    final beliefs: ${b.map((x) => x.toFixed(3)).join(" ")}`);
        }
      }
    }
  }
  const keys = [...new Set(Object.values(sums).flatMap((s) => Object.keys(s)))];
  for (const k of keys)
    console.log(
      `  ${k.padEnd(28)} ${variants.map((v) => `${v}: ${fmt(sums[v]![k] ? sums[v]![k].reduce((a, b) => a + b, 0) / sums[v]![k].length : null)} (n=${sums[v]![k]?.length ?? 0})`).join("   ")}`,
    );
}
