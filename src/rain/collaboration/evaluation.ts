/**
 * The preregistered three-arm evaluation (`protocols/collab-eval-v1.json`).
 *
 * Cases come from seeds the protocol fixes; held-out seeds are derived from
 * the protocol's own digest, so they could not be chosen before it was
 * frozen. Every arm runs real backend experiments through `experiment.ts`,
 * and every verdict comes from `rain-criteria/v1`. Nothing here reads a
 * clock: run timestamps come from the case index, so a rerun on the same
 * platform reproduces every record digest.
 */
import protocolJson from "./protocols/collab-eval-v1.json" with { type: "json" };
import { evaluate, VERDICT_FOR, type Criterion } from "../experiments/evaluate.js";
import { sha256, sha256Json } from "../sha256.js";
import { mulberry32 } from "../../lib/noise.js";
import { refuseOriginal } from "../../bethesda/firstContact/originals.js";
import {
  ExperimentRefused,
  TEMPLATE_WINDOW,
  measure,
  windowFor,
  type Measured,
  type Window,
} from "./experiment.js";
import { ClaimLedger, CollabJournal } from "./ledger.js";
import { holderOf, rosterSha256 } from "./roster.js";
import { steadyAmplitude, transientTime, type Oscillator } from "./physics.js";

export const PROTOCOL = protocolJson;
export const PROTOCOL_SHA256 = sha256Json(protocolJson);

export type Truth = "true" | "false" | "indeterminate";
export type Verdict = "supported" | "refuted" | "inconclusive";
export const ARMS = ["fixed_workflow", "single_agent", "multi_agent"] as const;
export type Arm = (typeof ARMS)[number];

export interface Case {
  case_id: string;
  split: "development" | "held_out";
  seed: number;
  subject_id: string;
  system: Oscillator;
  omega_a: number;
  omega_b: number;
  steady_ratio: number;
  truth: Truth;
}

const seedFrom = (text: string) => Number.parseInt(sha256(text).slice(0, 8), 16) >>> 0;

export function caseSeeds(split: Case["split"]): number[] {
  const n =
    split === "development" ? PROTOCOL.cases.development : PROTOCOL.cases.held_out;
  return Array.from({ length: n }, (_, i) =>
    split === "development"
      ? seedFrom(`rain-collab-eval-v1:development:${i}`)
      : seedFrom(`${PROTOCOL_SHA256}:held-out:${i}`),
  );
}

const range = (r: () => number, [lo, hi]: readonly number[]) => lo! + (hi! - lo!) * r();

export function generateCase(split: Case["split"], index: number, seed: number): Case {
  const g = PROTOCOL.cases.generator;
  const r = mulberry32(seed);
  const mass = range(r, g.mass_kg),
    w0 = range(r, g.omega0_rad_s),
    zeta = range(r, g.damping_ratio);
  const ua = range(r, g.drive_ratio);
  let ub = range(r, g.drive_ratio);
  for (
    let guard = 0;
    Math.abs(ua - ub) < g.minimum_drive_ratio_gap && guard < 100;
    guard++
  )
    ub = range(r, g.drive_ratio);
  const system: Oscillator = {
    mass,
    stiffness: w0 * w0 * mass,
    damping: 2 * zeta * w0 * mass,
    force: g.force_n,
  };
  // Rounded to 6 significant digits so the case reads cleanly; the truth is computed from the rounded values.
  const round = (x: number) => Number(x.toPrecision(6));
  const s: Oscillator = {
    mass: round(system.mass),
    stiffness: round(system.stiffness),
    damping: round(system.damping),
    force: system.force,
  };
  const omega_a = round(ua * w0),
    omega_b = round(ub * w0);
  const steady_ratio = steadyAmplitude(s, omega_a) / steadyAmplitude(s, omega_b);
  const truth: Truth =
    steady_ratio >= 1.005 ? "true" : steady_ratio <= 0.995 ? "false" : "indeterminate";
  const case_id = `${split === "development" ? "D" : "H"}-${String(index).padStart(2, "0")}`;
  const subject_id = `research-oscillator-${sha256(`${seed}`).slice(0, 12)}`;
  refuseOriginal(subject_id);
  return {
    case_id,
    split,
    seed,
    subject_id,
    system: s,
    omega_a,
    omega_b,
    steady_ratio,
    truth,
  };
}

export function cases(split: Case["split"]): Case[] {
  return caseSeeds(split).map((seed, i) => generateCase(split, i, seed));
}

const CRITERIA = PROTOCOL.decision as {
  guards: Criterion[];
  success: Criterion[];
  failure: Criterion[];
};

export interface Comparison {
  label: string;
  window: Window;
  a: RunSummary;
  b: RunSummary;
  rms_ratio: number | null;
  verdict: Verdict;
  evaluation_summary: string;
}
export interface RunSummary {
  run_id: string;
  record_sha256: string;
  omega: number;
  rms_treatment_m: number | null;
  reference_max_error_m: number;
  steps: number;
  replay_verified: boolean;
}

const summary = (m: Measured): RunSummary => ({
  run_id: m.record.run_id,
  record_sha256: m.record.sha256,
  omega: m.w,
  rms_treatment_m: m.rms,
  reference_max_error_m: m.reference_error_m,
  steps: m.steps,
  replay_verified: m.replay_verified,
});

/** Runs the claim's two frequencies in `window` (per-frequency timesteps) and judges the pair. */
export function compare(
  c: Case,
  label: string,
  duration: number | "template",
  rateFraction: number,
  at: Date,
): Comparison | { refused: string } {
  const winA =
    duration === "template"
      ? TEMPLATE_WINDOW
      : windowFor(c.system, c.omega_a, duration, rateFraction);
  const winB =
    duration === "template"
      ? TEMPLATE_WINDOW
      : windowFor(c.system, c.omega_b, duration, rateFraction);
  if (!winA || !winB)
    return {
      refused: `a ${duration === "template" ? "template" : duration.toFixed(1) + " s"} window does not fit the compiler's ceilings`,
    };
  try {
    const a = measure(c.system, c.omega_a, winA, `${c.case_id} ${label} a`, at);
    const b = measure(c.system, c.omega_b, winB, `${c.case_id} ${label} b`, at);
    const ratio = a.rms !== null && b.rms !== null && b.rms > 0 ? a.rms / b.rms : null;
    const judged = evaluate(CRITERIA, {
      rms_ratio: ratio,
      reference_max_error_m: Math.max(a.reference_error_m, b.reference_error_m),
      runs_verified: Number(a.replay_verified) + Number(b.replay_verified),
    });
    const verdict = VERDICT_FOR[judged.status];
    return {
      label,
      window: winA,
      a: summary(a),
      b: summary(b),
      rms_ratio: ratio,
      verdict:
        verdict === "supported"
          ? "supported"
          : verdict === "not_supported"
            ? "refuted"
            : "inconclusive",
      evaluation_summary: judged.evaluation.summary,
    };
  } catch (e) {
    if (e instanceof ExperimentRefused) return { refused: e.message };
    throw e;
  }
}

export interface ArmResult {
  arm: Arm;
  verdict: Verdict;
  first_verdict: Verdict;
  comparisons: Comparison[];
  refusals: string[];
  challenges: Array<{
    by: string;
    text: string;
    resolution: "open" | "upheld" | "rejected";
  }>;
  messages: number;
  journal_head: string | null;
  steps: number;
  runs: number;
  runs_verified: number;
}

const periods20 = (c: Case) => (20 * 2 * Math.PI) / Math.min(c.omega_a, c.omega_b);

function finish(
  arm: Arm,
  comparisons: Comparison[],
  refusals: string[],
  verdict: Verdict,
  extra: Partial<ArmResult> = {},
): ArmResult {
  const runs = comparisons.flatMap((x) => [x.a, x.b]);
  return {
    arm,
    verdict,
    first_verdict: comparisons[0]?.verdict ?? "inconclusive",
    comparisons,
    refusals,
    challenges: [],
    messages: 0,
    journal_head: null,
    steps: runs.reduce((n, r) => n + r.steps, 0),
    runs: runs.length,
    runs_verified: runs.filter((r) => r.replay_verified).length,
    ...extra,
  };
}

const isComparison = (x: Comparison | { refused: string }): x is Comparison =>
  "verdict" in x;

export function fixedWorkflow(c: Case, at: Date): ArmResult {
  const x = compare(c, "template", "template", 0.02, at);
  return isComparison(x)
    ? finish("fixed_workflow", [x], [], x.verdict)
    : finish("fixed_workflow", [], [x.refused], "inconclusive");
}

export function singleAgent(c: Case, at: Date): ArmResult {
  const first = compare(c, "20 periods", periods20(c), 0.02, at);
  if (!isComparison(first))
    return finish("single_agent", [], [first.refused], "inconclusive");
  const check = compare(c, "20 periods, half timestep", periods20(c), 0.01, at);
  if (!isComparison(check))
    return finish("single_agent", [first], [check.refused], "inconclusive");
  return finish(
    "single_agent",
    [first, check],
    [],
    first.verdict === check.verdict ? first.verdict : "inconclusive",
  );
}

/** The multi-seat protocol, with every exchange in a hash-chained journal. */
export function multiAgent(c: Case, at: Date): ArmResult {
  const journal = new CollabJournal(`${c.case_id}-collab`, () => at.toISOString());
  const ledger = new ClaimLedger();
  const seat = (r: Parameters<typeof holderOf>[0]) => holderOf(r).agent_id;
  journal.append("host", "episode.opened", "host", {
    case_id: c.case_id,
    subject_id: c.subject_id,
    roster_sha256: rosterSha256(),
    protocol_sha256: PROTOCOL_SHA256,
  });
  const claim = ledger.propose({
    claim_id: "C-1",
    statement: `RMS displacement at ${c.omega_a} rad/s exceeds that at ${c.omega_b} rad/s.`,
    author: seat("hypothesis"),
    generation: "scripted",
  });
  journal.append(seat("hypothesis"), "message.hypothesis", "scripted", {
    claim_id: claim.claim_id,
    statement: claim.statement,
  });
  const proposed = periods20(c);
  journal.append(seat("design"), "message.design", "scripted", {
    window_s: proposed,
    rule: "20 drive periods of the slower frequency",
  });
  const comparisons: Comparison[] = [];
  const refusals: string[] = [];
  const first = compare(c, "20 periods", proposed, 0.02, at);
  if (!isComparison(first)) {
    refusals.push(first.refused);
    journal.append("host", "episode.closed", "host", {
      verdict: "inconclusive",
      reason: first.refused,
    });
    return finish("multi_agent", [], refusals, "inconclusive", {
      messages: journal.events.length,
      journal_head: journal.head(),
    });
  }
  comparisons.push(first);
  journal.append("host", "run.recorded", "host", {
    runs: [first.a.record_sha256, first.b.record_sha256],
    verdict: first.verdict,
  });
  const needed = transientTime(c.system, 8);
  let window = proposed;
  if (proposed < needed) {
    const ch = ledger.challenge({
      challenge_id: "X-1",
      by: seat("criticism"),
      target_claim_id: "C-1",
      generation: "scripted",
      text: `The ${proposed.toFixed(1)} s window is shorter than 8/gamma = ${needed.toFixed(1)} s; the start-up transient is still in the RMS.`,
    });
    journal.append(seat("criticism"), "message.challenge", "scripted", {
      challenge_id: ch.challenge_id,
      text: ch.text,
    });
    window = needed;
    journal.append(seat("falsification"), "message.falsification", "scripted", {
      window_s: window,
    });
  }
  const test =
    window === proposed ? first : compare(c, "falsification window", window, 0.02, at);
  if (!isComparison(test)) {
    refusals.push(test.refused);
    journal.append("host", "episode.closed", "host", {
      verdict: "inconclusive",
      reason: `abstained: ${test.refused}`,
    });
    return finish("multi_agent", comparisons, refusals, "inconclusive", {
      challenges: [...ledger.challenges.values()].map((x) => ({
        by: x.by,
        text: x.text,
        resolution: x.resolution,
      })),
      messages: journal.events.length,
      journal_head: journal.head(),
    });
  }
  if (test !== first) {
    comparisons.push(test);
    journal.append("host", "run.recorded", "host", {
      runs: [test.a.record_sha256, test.b.record_sha256],
      verdict: test.verdict,
    });
  }
  let replication = compare(
    c,
    "replication: half timestep, 1.5x window",
    window * 1.5,
    0.01,
    at,
  );
  if (!isComparison(replication)) {
    refusals.push(replication.refused);
    replication = compare(c, "replication: half timestep", window, 0.01, at);
  }
  if (!isComparison(replication)) {
    refusals.push(replication.refused);
    journal.append("host", "episode.closed", "host", {
      verdict: "inconclusive",
      reason: "no replication fits",
    });
    return finish("multi_agent", comparisons, refusals, "inconclusive", {
      messages: journal.events.length,
      journal_head: journal.head(),
    });
  }
  comparisons.push(replication);
  journal.append(holderOf("replication").agent_id, "message.replication", "host", {
    runs: [replication.a.record_sha256, replication.b.record_sha256],
    verdict: replication.verdict,
  });
  const verified = [test, replication].every(
    (x) => x.a.replay_verified && x.b.replay_verified,
  );
  journal.append(seat("verification"), "message.verification", "scripted", {
    records_verified: verified,
  });
  const agree = test.verdict === replication.verdict;
  const verdict: Verdict = verified && agree ? test.verdict : "inconclusive";
  for (const ch of ledger.challenges.values())
    if (window !== proposed) ledger.resolve(ch.challenge_id, "upheld", test.a.run_id);
  ledger.cite(
    "C-1",
    test.a.run_id,
    verdict === "supported"
      ? "supports"
      : verdict === "refuted"
        ? "refutes"
        : "insufficient",
  );
  journal.append("host", "claim.standing", "host", {
    claim_id: "C-1",
    standing: ledger.standing("C-1"),
  });
  journal.append("host", "episode.closed", "host", { verdict });
  const errors = journal.verify();
  if (errors.length)
    throw new Error(`collaboration journal broken: ${errors.join("; ")}`);
  return finish("multi_agent", comparisons, refusals, verdict, {
    challenges: [...ledger.challenges.values()].map((x) => ({
      by: x.by,
      text: x.text,
      resolution: x.resolution,
    })),
    messages: journal.events.length,
    journal_head: journal.head(),
  });
}

export const correct = (v: Verdict, t: Truth) =>
  (v === "supported" && t === "true") ||
  (v === "refuted" && t === "false") ||
  (v === "inconclusive" && t === "indeterminate");
export const confidentError = (v: Verdict, t: Truth) =>
  v !== "inconclusive" && !correct(v, t);

/** One-sided exact McNemar: P(X >= b) for X ~ Binomial(b + c, 1/2). */
export function mcnemarOneSided(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  let p = 0;
  let coef = 1; // C(n, 0)
  for (let k = 0; k <= n; k++) {
    if (k >= b) p += coef;
    coef = (coef * (n - k)) / (k + 1);
  }
  return p / 2 ** n;
}

export function wilson(successes: number, n: number): [number, number] | null {
  if (n === 0) return null;
  const z = 1.959963984540054,
    p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export interface CaseResult {
  case: Case;
  arms: Record<Arm, ArmResult>;
}

export function runCase(c: Case, index: number): CaseResult {
  const at = new Date(Date.UTC(2026, 10, 16, 12, 0, 0) + index * 60_000);
  return {
    case: c,
    arms: {
      fixed_workflow: fixedWorkflow(c, at),
      single_agent: singleAgent(c, at),
      multi_agent: multiAgent(c, at),
    },
  };
}

export function summarise(results: CaseResult[]) {
  const per = Object.fromEntries(
    ARMS.map((arm) => {
      const rs = results.map((r) => ({
        v: r.arms[arm].verdict,
        f: r.arms[arm].first_verdict,
        t: r.case.truth,
        a: r.arms[arm],
      }));
      const decided = rs.filter((r) => r.v !== "inconclusive");
      const correctN = rs.filter((r) => correct(r.v, r.t)).length;
      const errors = rs.filter((r) => confidentError(r.v, r.t)).length;
      const flawed = rs.filter((r) => confidentError(r.f, r.t));
      const detected = flawed.filter((r) => r.v !== r.f).length;
      const runs = rs.reduce((n, r) => n + r.a.runs, 0),
        verified = rs.reduce((n, r) => n + r.a.runs_verified, 0);
      return [
        arm,
        {
          cases: rs.length,
          correct: correctN,
          accuracy: correctN / rs.length,
          accuracy_95: wilson(correctN, rs.length),
          decided: decided.length,
          coverage: decided.length / rs.length,
          confident_errors: errors,
          confident_error_rate: decided.length ? errors / decided.length : null,
          confident_error_rate_95: wilson(errors, decided.length),
          first_design_wrong: flawed.length,
          errors_caught: detected,
          error_detection: flawed.length ? detected / flawed.length : null,
          runs,
          runs_verified: verified,
          reproducibility: runs ? verified / runs : null,
          steps: rs.reduce((n, r) => n + r.a.steps, 0),
          steps_per_case: rs.reduce((n, r) => n + r.a.steps, 0) / rs.length,
        },
      ];
    }),
  ) as unknown as Record<
    Arm,
    Record<string, unknown> & { correct: number; confident_errors: number }
  >;
  const paired = (x: Arm, y: Arm) => {
    let b = 0,
      c = 0;
    for (const r of results) {
      const ex = confidentError(r.arms[x].verdict, r.case.truth),
        ey = confidentError(r.arms[y].verdict, r.case.truth);
      if (ex && !ey) b++;
      if (ey && !ex) c++;
    }
    return {
      baseline_errs_only: b,
      multi_errs_only: c,
      p_one_sided: mcnemarOneSided(b, c),
    };
  };
  const h = (id: string, other: Arm) => {
    const t = paired(other, "multi_agent");
    const multi = per.multi_agent.confident_errors,
      base = per[other].confident_errors;
    const outcome =
      multi >= base ? "refuted" : t.p_one_sided < 0.05 ? "supported" : "inconclusive";
    return {
      id,
      comparison: `multi_agent vs ${other}`,
      discordant: t,
      multi_agent_errors: multi,
      [`${other}_errors`]: base,
      outcome,
    };
  };
  const h3 =
    per.multi_agent.correct >= per.single_agent.correct ? "supported" : "refuted";
  return {
    per_arm: per,
    hypotheses: [
      h("H1", "fixed_workflow"),
      h("H2", "single_agent"),
      {
        id: "H3",
        multi_agent_correct: per.multi_agent.correct,
        single_agent_correct: per.single_agent.correct,
        outcome: h3,
      },
    ],
    truth_counts: {
      true: results.filter((r) => r.case.truth === "true").length,
      false: results.filter((r) => r.case.truth === "false").length,
      indeterminate: results.filter((r) => r.case.truth === "indeterminate").length,
    },
  };
}
