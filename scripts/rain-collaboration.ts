/**
 * R.A.I.N. collaboration: the preregistered three-arm evaluation and
 * Demonstration B (the assumption-correction episode).
 *
 *   node scripts/run-ts.mjs scripts/rain-collaboration.ts --dev        # development cases only, prints
 *   node scripts/run-ts.mjs scripts/rain-collaboration.ts --evaluate   # held-out + development, writes
 *   node scripts/run-ts.mjs scripts/rain-collaboration.ts --demo       # Demonstration B, writes
 *   node scripts/run-ts.mjs scripts/rain-collaboration.ts --check      # re-runs both, compares bytes
 *
 * `--evaluate` and `--demo` refuse a dirty working tree: a result names the
 * commit it ran from, and a run from uncommitted code is not a result.
 * `--check` reproduces byte for byte only on the platform recorded in the
 * files (floating-point `Math` differs between platforms).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arch, platform } from "node:os";
import {
  ARMS,
  PROTOCOL,
  PROTOCOL_SHA256,
  cases,
  runCase,
  summarise,
  type CaseResult,
} from "../src/rain/collaboration/evaluation.ts";
import {
  ASSUMPTION_PROTOCOL_SHA256,
  runAssumptionEpisode,
} from "../src/rain/collaboration/episode.ts";
import { episodeEvidence } from "../src/rain/collaboration/evidence.ts";
import { ROSTER, rosterSha256 } from "../src/rain/collaboration/roster.ts";

const OUT = join(import.meta.dirname, "..", "docs", "benchmarks", "rain-collaboration");
const mode = process.argv[2] ?? "--dev";
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

function provenance(recorded?: { commit: string; platform: string; node: string }) {
  if (recorded) return recorded;
  if (git("status", "--porcelain")) {
    console.error(
      "refusing: the working tree has uncommitted changes. Commit first; a result names its commit.",
    );
    process.exit(2);
  }
  return {
    commit: git("rev-parse", "HEAD"),
    platform: `${platform()}-${arch()}`,
    node: process.version,
  };
}

const text = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

function evaluationFile(
  results: CaseResult[],
  dev: CaseResult[],
  prov: ReturnType<typeof provenance>,
) {
  const brief = (r: CaseResult) => ({
    case_id: r.case.case_id,
    subject_id: r.case.subject_id,
    seed: r.case.seed,
    system: r.case.system,
    omega_a: r.case.omega_a,
    omega_b: r.case.omega_b,
    steady_ratio: r.case.steady_ratio,
    truth: r.case.truth,
    arms: Object.fromEntries(
      ARMS.map((arm) => {
        const a = r.arms[arm];
        return [
          arm,
          {
            verdict: a.verdict,
            first_verdict: a.first_verdict,
            comparisons: a.comparisons.map((c) => ({
              label: c.label,
              duration_s: c.window.duration_s,
              rms_ratio: c.rms_ratio,
              verdict: c.verdict,
              runs: [c.a, c.b].map((x) => ({
                run_id: x.run_id,
                record_sha256: x.record_sha256,
                rms_treatment_m: x.rms_treatment_m,
                steps: x.steps,
                replay_verified: x.replay_verified,
              })),
            })),
            refusals: a.refusals,
            challenges: a.challenges,
            messages: a.messages,
            journal_head: a.journal_head,
            steps: a.steps,
          },
        ];
      }),
    ),
  });
  return {
    schema: "rain-collab-evaluation-result/v1",
    protocol_sha256: PROTOCOL_SHA256,
    roster_sha256: rosterSha256(),
    provenance: prov,
    seats: "rule-based (scripted); no language model took part",
    held_out: { summary: summarise(results), cases: results.map(brief) },
    development: {
      note: "Development cases under the frozen generator. Not evidence for the hypotheses.",
      summary: summarise(dev),
      cases: dev.map(brief),
    },
  };
}

function pct(x: unknown) {
  return typeof x === "number" ? `${(100 * x).toFixed(1)}%` : "n/a";
}
function interval(x: unknown) {
  return Array.isArray(x) ? `${pct(x[0])}–${pct(x[1])}` : "n/a";
}

function readme(
  evaluation: ReturnType<typeof evaluationFile>,
  episode: {
    outcome: string;
    c3: string;
    a2: string;
    measurements: Record<string, number>;
  } | null,
) {
  const s = evaluation.held_out.summary;
  const rows = ARMS.map((arm) => {
    const a = s.per_arm[arm] as Record<string, unknown>;
    return `| ${arm} | ${a.correct}/${a.cases} (${interval(a.accuracy_95)}) | ${a.decided}/${a.cases} | ${a.confident_errors} (${interval(a.confident_error_rate_95)}) | ${a.errors_caught}/${a.first_design_wrong} | ${a.runs_verified}/${a.runs} | ${Math.round(Number(a.steps_per_case)).toLocaleString("en-US")} |`;
  });
  const hyp = s.hypotheses.map(
    (h) =>
      `- **${h.id}** (${"comparison" in h ? h.comparison : "multi_agent vs single_agent accuracy"}): **${h.outcome}**${"discordant" in h ? `, one-sided exact McNemar p = ${(h.discordant as { p_one_sided: number }).p_one_sided.toFixed(4)} (baseline wrong only: ${(h.discordant as { baseline_errs_only: number }).baseline_errs_only}; multi wrong only: ${(h.discordant as { multi_errs_only: number }).multi_errs_only})` : ""}.`,
  );
  return [
    "# R.A.I.N. collaboration benchmark",
    "",
    "Generated by `node scripts/run-ts.mjs scripts/rain-collaboration.ts --evaluate` and `--demo`; reproduced by `--check`. Never edit by hand.",
    "",
    `Protocol \`src/rain/collaboration/protocols/collab-eval-v1.json\` (sha256 \`${evaluation.protocol_sha256.slice(0, 16)}…\`), committed before any held-out case existed. Run from commit \`${evaluation.provenance.commit.slice(0, 12)}\` on ${evaluation.provenance.platform}, Node ${evaluation.provenance.node}. Seats are rule-based policies; no language model took part.`,
    "",
    `## Held-out evaluation (${s.truth_counts.true} true, ${s.truth_counts.false} false, ${s.truth_counts.indeterminate} indeterminate claims)`,
    "",
    "| Arm | Correct (95% Wilson) | Decided | Confident errors (rate 95%) | First-design errors caught | Records re-verified | Integration steps per case |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    ...hyp,
    "",
    "Reading this honestly: the arms differ in the window they measure and in the checks they run, and these seats were written by the same team that wrote the benchmark. The table measures those protocols on this deterministic substrate. It does not show that collaboration between language-model agents helps.",
    "",
    ...(episode
      ? [
          "## Demonstration B: the natural-frequency assumption",
          "",
          `Outcome of the corrected claim C-3 under its preregistered criteria (\`assumption-v1.json\`): **${episode.outcome}** (${episode.c3}). Template-window test (A2): ${episode.a2}.`,
          "",
          `Held-out measurements: corrected prediction within one grid step on ${episode.measurements.corrected_within_step}/12 systems, closer than the naive w0 on ${episode.measurements.corrected_better}/12; the 10 s template window misplaced the peak on ${episode.measurements.template_misplaces_peak}/12; records re-verified: ${pct(episode.measurements.runs_verified_share)}.`,
          "",
          "The correction is textbook physics. What the episode shows is the lab's protocol proposing the simplification, challenging it, testing a discriminating design, recording the contradiction and revising both the claim and its own template method, with each step in a hash-chained journal (`episode-assumption-v1.json`) and the sealed interop evidence (`evidence-E-assumption-v1.json`).",
        ]
      : []),
    "",
  ].join("\n");
}

interface Judged {
  status: string;
  evaluation: {
    summary: string;
    guards: Array<{ metric: string; observed: number | null }>;
    success: Array<{ metric: string; observed: number | null }>;
    failure: Array<{ metric: string; observed: number | null }>;
  };
}
function demoSummary(episode: { outcome: string; c3: Judged; a2: Judged }) {
  const observed = (j: Judged) =>
    [...j.evaluation.guards, ...j.evaluation.success, ...j.evaluation.failure].map(
      (c) => [c.metric, Number(c.observed)] as const,
    );
  const measurements = Object.fromEntries([
    ...observed(episode.c3),
    ...observed(episode.a2),
  ]) as Record<string, number>;
  return {
    outcome: episode.outcome,
    c3: `${episode.c3.status}: ${episode.c3.evaluation.summary}`,
    a2: `${episode.a2.status}: ${episode.a2.evaluation.summary}`,
    measurements,
  };
}

function runEvaluation(prov: ReturnType<typeof provenance>) {
  const held = cases("held_out").map((c, i) => runCase(c, i));
  const dev = cases("development").map((c, i) => runCase(c, 1000 + i));
  return evaluationFile(held, dev, prov);
}

function runDemo(prov: ReturnType<typeof provenance>) {
  const result = runAssumptionEpisode();
  const evidence = episodeEvidence(result, prov.commit);
  const episode = {
    schema: "rain-collab-episode/v1",
    protocol_sha256: ASSUMPTION_PROTOCOL_SHA256,
    roster: ROSTER,
    roster_sha256: rosterSha256(),
    provenance: prov,
    outcome: result.outcome,
    c3: result.c3,
    a2: result.a2,
    held_out: result.held_out,
    journal: result.journal.events,
    evidence_sha256: evidence.sha256,
  };
  return { episode, evidence, summary: demoSummary(episode) };
}

if (mode === "--dev") {
  const dev = cases("development").map((c, i) => runCase(c, 1000 + i));
  console.log(JSON.stringify(summarise(dev), null, 2));
} else if (mode === "--evaluate" || mode === "--demo" || mode === "--check") {
  mkdirSync(OUT, { recursive: true });
  const recorded = (name: string) => {
    try {
      return JSON.parse(readFileSync(join(OUT, name), "utf8")).provenance as ReturnType<
        typeof provenance
      >;
    } catch {
      return undefined;
    }
  };
  const check = mode === "--check";
  const files: Record<string, string> = {};
  let evaluation: ReturnType<typeof evaluationFile> | null = null;
  let demo: ReturnType<typeof runDemo> | null = null;
  if (mode !== "--demo") {
    evaluation = runEvaluation(
      provenance(check ? recorded("evaluation.json") : undefined),
    );
    files["evaluation.json"] = text(evaluation);
  } else {
    evaluation = JSON.parse(readFileSync(join(OUT, "evaluation.json"), "utf8"));
  }
  if (mode !== "--evaluate" || check) {
    const prov = provenance(check ? recorded("episode-assumption-v1.json") : undefined);
    demo = runDemo(prov);
    files["episode-assumption-v1.json"] = text(demo.episode);
    files["evidence-E-assumption-v1.json"] = text(demo.evidence);
  } else {
    try {
      const ep = JSON.parse(
        readFileSync(join(OUT, "episode-assumption-v1.json"), "utf8"),
      );
      demo = { episode: ep, evidence: null as never, summary: demoSummary(ep) };
    } catch {
      demo = null;
    }
  }
  if (evaluation) files["README.md"] = readme(evaluation, demo?.summary ?? null);
  if (check) {
    const bad = Object.entries(files).filter(([name, body]) => {
      try {
        return readFileSync(join(OUT, name), "utf8") !== body;
      } catch {
        return true;
      }
    });
    if (bad.length) {
      console.error(`does not reproduce: ${bad.map(([n]) => n).join(", ")}`);
      process.exit(1);
    }
    console.log(`reproduced ${Object.keys(files).length} files byte for byte`);
  } else {
    for (const [name, body] of Object.entries(files))
      writeFileSync(join(OUT, name), body);
    console.log(
      `wrote ${Object.keys(files).join(", ")} to docs/benchmarks/rain-collaboration/`,
    );
    if (evaluation) console.log(JSON.stringify(evaluation.held_out.summary.hypotheses));
    if (demo) console.log(JSON.stringify(demo.summary));
  }
} else {
  console.error("usage: rain-collaboration.ts --dev | --evaluate | --demo | --check");
  process.exit(2);
}
void PROTOCOL;
