/**
 * What the plasticity study's records say: paired per-seed differences against
 * the original organism, a seeded percentile bootstrap of their mean, sign
 * counts, and the shadow identity check. Pure: the same records give the same
 * report on any machine.
 */
import { mulberry32 } from "../../lib/noise.js";
import { ARMS, CONDITIONS, PLAN, type Arm, type RunRecord } from "./study.js";

export const METRICS = [
  "meals",
  "fedJ",
  "spentJ",
  "maintenanceJ",
  "endReserve",
  "collisions",
  "walkingBlocks",
  "walkedM",
  "flownM",
  "walkingShare",
  "modeChangesPerHour",
  "meanLatencyS",
  "placementsMissed",
] as const;
export type Metric = (typeof METRICS)[number];

export interface Interval {
  n: number;
  mean: number;
  low: number;
  high: number;
  better: number;
  worse: number;
  tied: number;
}

/** Higher is better for these; lower for the rest. */
const HIGHER_BETTER = new Set<Metric>(["meals", "fedJ", "endReserve", "walkedM"]);
const NEUTRAL = new Set<Metric>([
  "flownM",
  "walkingShare",
  "modeChangesPerHour",
  "spentJ",
]);

export function bootstrap(diffs: readonly number[], metric: Metric): Interval {
  const n = diffs.length;
  const mean = n ? diffs.reduce((a, b) => a + b, 0) / n : NaN;
  const rng = mulberry32(PLAN.bootstrap.seed);
  const means: number[] = [];
  for (let r = 0; r < PLAN.bootstrap.resamples && n; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += diffs[Math.floor(rng() * n)]!;
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  const q = (p: number) =>
    means[Math.min(means.length - 1, Math.floor(p * means.length))]!;
  const sign = HIGHER_BETTER.has(metric) ? 1 : NEUTRAL.has(metric) ? 0 : -1;
  const eps = 1e-12;
  return {
    n,
    mean,
    low: n ? q(0.025) : NaN,
    high: n ? q(0.975) : NaN,
    better: sign ? diffs.filter((d) => d * sign > eps).length : 0,
    worse: sign ? diffs.filter((d) => d * sign < -eps).length : 0,
    tied: diffs.filter((d) => Math.abs(d) <= eps).length,
  };
}

export interface Contrast {
  condition: string;
  arm: Arm;
  metric: Metric;
  interval: Interval;
  /** Seeds where either value was missing (e.g. no placement reached). */
  missing: number;
}

export interface ShadowCheck {
  runs: number;
  identical: number;
  differing: { seed: number; condition: string }[];
}

export interface StudySummary {
  study: string;
  split: string;
  runs: number;
  seeds: number;
  shadow: ShadowCheck;
  restart: { runs: number; identical: number; learningKept: number };
  primary: {
    contrast: Contrast;
    verdict: "benefit" | "harm" | "no difference established";
  };
  contrasts: Contrast[];
  means: Record<string, Record<string, Record<string, number | null>>>;
  plasticity: Record<
    string,
    {
      samples: number;
      adaptations: number;
      shadowWouldAdapt: number;
      failureNormal: number;
    }
  >;
}

const key = (r: { seed: number; condition: string }) => `${r.condition}|${r.seed}`;

export function summarize(records: readonly RunRecord[], split: string): StudySummary {
  const by = new Map<string, Map<Arm, RunRecord>>();
  for (const r of records) {
    const k = key(r);
    if (!by.has(k)) by.set(k, new Map());
    if (by.get(k)!.has(r.arm)) throw new Error(`two records for ${k} ${r.arm}`);
    by.get(k)!.set(r.arm, r);
  }
  const conditions = [...CONDITIONS, "restart"];
  const contrasts: Contrast[] = [];
  for (const condition of conditions)
    for (const arm of ARMS.filter((a) => a !== "original"))
      for (const metric of METRICS) {
        const diffs: number[] = [];
        let missing = 0;
        for (const [k, arms] of by) {
          if (!k.startsWith(`${condition}|`)) continue;
          const a = arms.get(arm)?.[metric],
            o = arms.get("original")?.[metric];
          if (typeof a !== "number" || typeof o !== "number") missing++;
          else diffs.push(a - o);
        }
        contrasts.push({
          condition,
          arm,
          metric,
          interval: bootstrap(diffs, metric),
          missing,
        });
      }
  const shadow: ShadowCheck = { runs: 0, identical: 0, differing: [] };
  for (const arms of by.values()) {
    const s = arms.get("shadow"),
      o = arms.get("original");
    if (!s || !o) continue;
    shadow.runs++;
    const same = s.bodyHash === o.bodyHash && METRICS.every((m) => s[m] === o[m]);
    if (same) shadow.identical++;
    else shadow.differing.push({ seed: s.seed, condition: s.condition });
  }
  const restarts = records.filter((r) => r.condition === "restart");
  const p = PLAN.primary;
  const primary = contrasts.find(
    (c) =>
      c.condition === p.condition && c.arm === p.contrast[0] && c.metric === p.metric,
  )!;
  const verdict =
    primary.interval.low > 0
      ? "benefit"
      : primary.interval.high < 0
        ? "harm"
        : "no difference established";
  const means: StudySummary["means"] = {};
  for (const condition of conditions) {
    means[condition] = {};
    for (const arm of ARMS) {
      const rows = records.filter((r) => r.condition === condition && r.arm === arm);
      means[condition][arm] = Object.fromEntries(
        METRICS.map((m) => {
          const v = rows
            .map((r) => r[m])
            .filter((x): x is number => typeof x === "number");
          return [m, v.length ? v.reduce((a, b) => a + b, 0) / v.length : null];
        }),
      );
    }
  }
  const plasticity: StudySummary["plasticity"] = {};
  for (const condition of conditions)
    for (const arm of ["shadow", "active"] as const) {
      const rows = records.filter(
        (r) => r.condition === condition && r.arm === arm && r.plasticity,
      );
      const avg = (f: (r: RunRecord) => number) =>
        rows.length ? rows.reduce((a, r) => a + f(r), 0) / rows.length : 0;
      plasticity[`${condition}|${arm}`] = {
        samples: avg((r) => r.plasticity!.samples),
        adaptations: avg((r) => r.plasticity!.adaptations),
        shadowWouldAdapt: avg((r) => r.plasticity!.shadowWouldAdapt),
        failureNormal: avg((r) => r.plasticity!.contexts.normal.failure),
      };
    }
  return {
    study: PLAN.study,
    split,
    runs: records.length,
    seeds: new Set(records.map((r) => r.seed)).size,
    shadow,
    restart: {
      runs: restarts.length,
      identical: restarts.filter((r) => r.restartIdentical).length,
      learningKept: restarts.filter((r) => r.restartLearningKept).length,
    },
    primary: { contrast: primary, verdict },
    contrasts,
    means,
    plasticity,
  };
}

const f = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toFixed(d);

/** The report, as Markdown. */
export function render(
  s: StudySummary,
  context: { commit: string; platform: string },
): string {
  const lines: string[] = [];
  const P = s.primary.contrast.interval;
  lines.push(
    `# ECHO embodied plasticity: ${s.split} results`,
    "",
    `Generated by \`scripts/echo-plasticity-evaluate.ts report\` from the records in this folder. Do not edit by hand.`,
    "",
    `- Study \`${s.study}\`, brain \`${PLAN.brain}\`, ${s.runs} runs, ${s.seeds} seeds, ${PLAN.hours} simulated hours each.`,
    `- Code: \`${context.commit}\`; machine: ${context.platform}.`,
    `- Research flies only, in the individuality yard; never the deployed individual.`,
    "",
    "## Primary question (fixed before the held-out run)",
    "",
    `> ${PLAN.primary.question}`,
    "",
    `Active minus original, meals, weak-legs: mean ${f(P.mean)} (95% CI ${f(P.low)} to ${f(P.high)}), n = ${P.n}; active better on ${P.better}, worse on ${P.worse}, tied on ${P.tied}.`,
    "",
    `**Verdict: ${s.primary.verdict}.** ${PLAN.primary.rule}`,
    "",
    ((fed) =>
      `Read it with the energy actually taken in, since meals counts feeding bouts begun (more, shorter bouts can mean less food): fedJ, active minus original, weak-legs: mean ${f(fed.mean, 3)} J (95% CI ${f(fed.low, 3)} to ${f(fed.high, 3)}); active better on ${fed.better}, worse on ${fed.worse}. Secondary, no claim.`)(
      s.contrasts.find(
        (c) =>
          c.condition === PLAN.primary.condition &&
          c.arm === "active" &&
          c.metric === "fedJ",
      )!.interval,
    ),
    "",
    "`maintenanceJ` is the energy life support supplied in protective recovery, apart from food; it stays 0 when no fly's reserve fell that low.",
    "",
    "## Hard checks",
    "",
    `- Shadow mode identical to the original organism (every metric and the final body and controller hash): **${s.shadow.identical} of ${s.shadow.runs}** paired runs.${s.shadow.differing.length ? ` Differing: ${s.shadow.differing.map((d) => `${d.condition} ${d.seed}`).join(", ")}.` : ""}`,
    `- Restart at minute ${PLAN.restartAtS / 60}, restored from its checkpoint alone, ended exactly as the uninterrupted run: **${s.restart.identical} of ${s.restart.runs}**; learned plasticity kept through the restart: **${s.restart.learningKept} of ${s.restart.runs}**.`,
    "",
    "## Every contrast against the original (secondary, no claims)",
    "",
    "Mean paired difference (arm minus original) with its 95% bootstrap interval, and how many seeds were better / worse / tied. `—` where a metric was missing for some seed (missing count shown).",
    "",
  );
  for (const condition of [...CONDITIONS, "restart"]) {
    lines.push(
      `### ${condition}`,
      "",
      "| metric | arm | mean diff | 95% CI | better / worse / tied | missing |",
      "| --- | --- | ---: | --- | --- | ---: |",
    );
    for (const c of s.contrasts.filter(
      (x) => x.condition === condition && x.arm !== "shadow",
    )) {
      const i = c.interval;
      lines.push(
        `| ${c.metric} | ${c.arm} | ${f(i.mean, 3)} | ${f(i.low, 3)} to ${f(i.high, 3)} | ${i.better} / ${i.worse} / ${i.tied} | ${c.missing} |`,
      );
    }
    lines.push("");
  }
  lines.push(
    "## Means per arm",
    "",
    "| condition | arm | meals | spent J | maintenance J | collisions | walking blocks | walked m | latency s | missed |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const condition of Object.keys(s.means))
    for (const arm of ARMS) {
      const m = s.means[condition]![arm]!;
      lines.push(
        `| ${condition} | ${arm} | ${f(m.meals)} | ${f(m.spentJ)} | ${f(m.maintenanceJ)} | ${f(m.collisions)} | ${f(m.walkingBlocks)} | ${f(m.walkedM)} | ${f(m.meanLatencyS, 1)} | ${f(m.placementsMissed)} |`,
      );
    }
  lines.push(
    "",
    "## What the plasticity learned (means per run)",
    "",
    "| condition | arm | evidence periods | adaptations | would have adapted (shadow) | failure rate, fed |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
  );
  for (const [k, v] of Object.entries(s.plasticity)) {
    const [condition, arm] = k.split("|");
    lines.push(
      `| ${condition} | ${arm} | ${f(v.samples, 0)} | ${f(v.adaptations, 0)} | ${f(v.shadowWouldAdapt, 0)} | ${f(v.failureNormal, 3)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
