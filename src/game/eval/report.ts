import type { Evaluation } from "./evaluation.js";
import type { SampleSummary } from "./stats.js";

/**
 * The evaluation as text: the table a person reads first, and the markdown an
 * archive keeps beside the JSON. Everything printed is read from the
 * evaluation object; nothing is computed here that is not in the file.
 *
 * Unknown values print as "n/a", always with n nearby. A pending arm prints
 * as PENDING across the row, never as a row of dashes that could be read as
 * zeros.
 */

export function fmt(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || Number.isNaN(value)
    ? "n/a"
    : value.toFixed(digits);
}

export function pct(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined
    ? "n/a"
    : `${(value * 100).toFixed(digits)}%`;
}

export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  if (value === 0) return "$0";
  return value < 0.01 ? `$${value.toFixed(5)}` : `$${value.toFixed(3)}`;
}

function summaryCell(s: SampleSummary | undefined, digits = 2): string {
  if (!s || s.n === 0) return "n/a";
  const ci = s.ci95 ? ` [${fmt(s.ci95.lo, digits)}, ${fmt(s.ci95.hi, digits)}]` : "";
  return `${fmt(s.mean, digits)}${ci} (n=${s.n})`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? `${text} ` : text + " ".repeat(width - text.length);
}

export function renderText(evaluation: Evaluation): string {
  const e = evaluation.experiment;
  const lines: string[] = [];
  lines.push("BLACKSITE EVALUATION", "");
  lines.push("Environment");
  lines.push(
    `  commit:      ${String(evaluation.environment["gitCommit"] ?? "unknown")}${evaluation.environment["gitDirty"] ? " (+uncommitted changes)" : ""}`,
  );
  lines.push(`  experiment:  ${e.id}  (definition ${e.definitionHash})`);
  lines.push(`  status:      ${evaluation.status.toUpperCase()}`);
  lines.push(`  question:    ${e.question}`);
  lines.push(`  primary:     ${e.primaryMetric.id} — ${e.primaryMetric.description}`);
  if (e.decisionType)
    lines.push(`  decisions:   ${e.decisionType.id} — ${e.decisionType.rule}`);
  lines.push(
    `  episodes:    ${e.seeds.length} seeds × ${e.durationS} s per arm, mode ${e.mode}, outcome window ${e.outcomeWindowS} s`,
  );
  lines.push("");

  const header = [
    pad("Arm", 22),
    pad(`${e.primaryMetric.label}`, 30),
    pad("Success", 18),
    pad("Exposure", 10),
    pad("Latency p50", 12),
    pad("Cost", 10),
    "Decisions",
  ].join("");
  lines.push(header);
  for (const arm of evaluation.arms) {
    if (arm.status !== "complete") {
      lines.push(
        `${pad(arm.id, 22)}${arm.status.toUpperCase()} — ${arm.pendingReason ?? "no episodes"}`,
      );
      continue;
    }
    const dm = arm.decisionMetrics;
    const decisions = arm.episodes.reduce((a, ep) => a + ep.decisions, 0);
    const label = arm.brain.testDouble ? `${arm.id} (TEST DOUBLE)` : arm.id;
    lines.push(
      [
        pad(label, 22),
        pad(summaryCell(arm.aggregate[e.primaryMetric.id]), 30),
        pad(dm ? `${pct(dm.successRate)} (n=${dm.scored})` : "n/a", 18),
        pad(pct(arm.aggregate["exposure_fraction"]?.mean), 10),
        pad(
          arm.ledger.wallLatencyMs.median === null
            ? "n/a"
            : `${fmt(arm.ledger.wallLatencyMs.median, 0)} ms`,
          12,
        ),
        pad(usd(arm.ledger.cost.totalUsd), 10),
        String(decisions),
      ].join(""),
    );
  }
  lines.push("");

  for (const arm of evaluation.arms) {
    if (arm.status !== "complete") continue;
    if (!arm.calibration.available) {
      lines.push(`${arm.id} calibration: not available — ${arm.calibration.reason}`);
      continue;
    }
    const c = arm.calibration;
    lines.push(
      `${arm.id} calibration — ${c.source}, ${c.field} on the ${c.axis} axis, against ${e.decisionType?.id ?? "?"} success (adequacy: ${c.adequacy})`,
    );
    lines.push("  confidence    n      mean p   empirical success   95% interval");
    for (const bin of c.bins) {
      lines.push(
        `  ${pad(bin.label, 13)} ${pad(String(bin.n), 6)} ${pad(fmt(bin.meanPredicted), 8)} ${pad(pct(bin.empirical), 19)} ${bin.interval ? `[${pct(bin.interval.lo)}, ${pct(bin.interval.hi)}]` : "n/a"}${bin.n > 0 && !bin.sufficient ? "  (n < 30)" : ""}`,
      );
    }
    lines.push(
      `  Brier ${fmt(c.brier, 4)} (base-rate predictor ${fmt(c.climatologyBrier, 4)}) · ECE ${fmt(c.ece, 4)} · n=${c.n}`,
    );
  }
  lines.push("");

  const cmp = evaluation.comparisons.filter((c) => c.metric === e.primaryMetric.id);
  if (cmp.length > 0) {
    lines.push(`Paired differences on ${e.primaryMetric.id} (arm − reference, by seed)`);
    for (const c of cmp) {
      const d = c.difference;
      lines.push(
        `  ${pad(`${c.arm} − ${c.reference}`, 44)} ${fmt(d.meanDifference, 3)}${d.ci95 ? ` [${fmt(d.ci95.lo, 3)}, ${fmt(d.ci95.hi, 3)}]` : " (no interval)"} over ${d.n} seeds`,
      );
    }
    lines.push(`  ${cmp[0]!.difference.caveat}`, "");
  }

  for (const sweep of evaluation.sweeps) {
    lines.push(`Sweep of ${sweep.param} (${sweep.base})`);
    for (const p of sweep.points) {
      lines.push(
        `  ${pad(String(p.value), 6)} ${summaryCell(p.primary, 3)}  success ${pct(p.successRate)}`,
      );
    }
    lines.push(`  ${sweep.reading}`, "");
  }

  if (evaluation.contribution) {
    lines.push("Contribution (matched ablations; descriptive, not a decomposition)");
    for (const c of evaluation.contribution.contrasts) {
      lines.push(
        `  ${c.factor}: ${c.from.level} → ${c.to.level}  ${fmt(c.difference.meanDifference, 3)}${c.difference.ci95 ? ` [${fmt(c.difference.ci95.lo, 3)}, ${fmt(c.difference.ci95.hi, 3)}]` : ""} (n=${c.difference.n}; ${c.from.arm} → ${c.to.arm})`,
      );
    }
    for (const i of evaluation.contribution.interactions) {
      lines.push(
        `  interaction ${i.factors.join(" × ")}: ${fmt(i.differenceOfDifferences, 3)} (n=${i.seeds})`,
      );
    }
    lines.push(`  ${evaluation.contribution.statement}`, "");
  }

  lines.push("Warnings");
  if (evaluation.warnings.length === 0) lines.push("  none raised");
  for (const w of evaluation.warnings) {
    lines.push(`  - [${w.severity}] ${w.id}: ${w.message}`);
    if (w.possibleCauses.length > 0)
      lines.push(`      possible causes: ${w.possibleCauses.join("; ")}`);
    if (w.suggestedRun) lines.push(`      run: ${w.suggestedRun}`);
  }
  lines.push("");
  lines.push("Artifacts");
  lines.push(`  experiment definition: ${evaluation.artifacts.definition}`);
  for (const [arm, files] of Object.entries(evaluation.artifacts.arms)) {
    lines.push(
      `  ${arm}: ${files.length} files (${files.slice(0, 2).join(", ")}${files.length > 2 ? ", …" : ""})`,
    );
  }
  lines.push("");
  for (const note of evaluation.notes) lines.push(`Note: ${note}`);
  return lines.join("\n");
}

/** One row per episode, for plotting or a spreadsheet. */
export function episodesCsv(evaluation: Evaluation): string {
  const metricIds = [
    ...new Set(
      evaluation.arms.flatMap((a) => a.episodes.flatMap((e) => Object.keys(e.metrics))),
    ),
  ].sort();
  const header = [
    "arm",
    "brain",
    "control",
    "navigation",
    "latencyMs",
    "seed",
    "runId",
    "simSeconds",
    "decisions",
    ...metricIds,
  ];
  const rows = [header.join(",")];
  for (const arm of evaluation.arms) {
    for (const e of arm.episodes) {
      rows.push(
        [
          arm.id,
          arm.config.brain,
          arm.config.control,
          arm.config.navigation ?? "",
          arm.config.latencyMs ?? "",
          e.seed,
          e.runId,
          e.simSeconds.toFixed(2),
          e.decisions,
          ...metricIds.map((id) => {
            const v = e.metrics[id];
            return v === null || v === undefined ? "" : String(v);
          }),
        ].join(","),
      );
    }
  }
  return `${rows.join("\n")}\n`;
}
