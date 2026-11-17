/**
 * Demonstration B: a hypothesis, a discriminating experiment, an independent
 * challenge, a correction and a preregistered held-out test of it
 * (`protocols/assumption-v1.json`), recorded as one collaboration journal
 * with a claim ledger. Every seat here is a rule-based policy (`scripted`);
 * every experiment is a real run of the existing numerical backend; every
 * outcome comes from `rain-criteria/v1`.
 */
import assumptionJson from "./protocols/assumption-v1.json" with { type: "json" };
import { evaluate, type Criterion } from "../experiments/evaluate.js";

type Judged = ReturnType<typeof evaluate>;
import { sha256, sha256Json } from "../sha256.js";
import { mulberry32 } from "../../lib/noise.js";
import { refuseOriginal } from "../../bethesda/firstContact/originals.js";
import { TEMPLATE_WINDOW, measure, windowFor, type Measured } from "./experiment.js";
import { ClaimLedger, CollabJournal } from "./ledger.js";
import { holderOf, rosterSha256 } from "./roster.js";
import {
  dampingRatio,
  displacementPeak,
  gamma,
  omega0,
  transientTime,
  type Oscillator,
} from "./physics.js";

export const ASSUMPTION_PROTOCOL = assumptionJson;
export const ASSUMPTION_PROTOCOL_SHA256 = sha256Json(assumptionJson);
export const EPISODE_ID = "E-assumption-v1";

export interface EpisodeRun {
  run_id: string;
  purpose: string;
  record_sha256: string;
  status: "passed" | "failed" | "inconclusive" | "error";
  verdict: "supported" | "not_supported" | "insufficient_evidence" | "not_evaluated";
  measurements: Record<string, number | null>;
  replay_verified: boolean;
}

const runOf = (m: Measured, purpose: string): EpisodeRun => ({
  run_id: m.record.run_id,
  purpose,
  record_sha256: m.record.sha256,
  status: m.record.result.status,
  verdict: m.record.result.verdict,
  measurements: {
    omega_rad_s: m.w,
    rms_treatment_m: m.rms,
    reference_max_error_m: m.reference_error_m,
    execution_steps: m.steps,
    duration_s: m.plan.design.parameters.duration.value,
  },
  replay_verified: m.replay_verified,
});

const seat = (r: Parameters<typeof holderOf>[0]) => holderOf(r).agent_id;
const grid = Array.from({ length: 13 }, (_, i) => Number((0.8 + 0.02 * i).toFixed(2)));

export interface HeldOutSystem {
  system_id: string;
  oscillator: Oscillator;
  zeta: number;
  u_long: number;
  u_template: number;
  u_corrected: number;
  run_digests: string[];
  verified: number;
  runs: number;
}

export function heldOutSystems(): Array<{ id: string; oscillator: Oscillator }> {
  const g = ASSUMPTION_PROTOCOL.held_out_test.generator;
  return Array.from({ length: ASSUMPTION_PROTOCOL.held_out_test.systems }, (_, i) => {
    const seed =
      Number.parseInt(
        sha256(`${ASSUMPTION_PROTOCOL_SHA256}:held-out:${i}`).slice(0, 8),
        16,
      ) >>> 0;
    const r = mulberry32(seed);
    const span = (x: readonly number[]) => x[0]! + (x[1]! - x[0]!) * r();
    const mass = span(g.mass_kg),
      w0 = span(g.omega0_rad_s),
      zeta = span(g.damping_ratio);
    const round = (x: number) => Number(x.toPrecision(6));
    const id = `research-oscillator-${sha256(`assumption:${seed}`).slice(0, 12)}`;
    refuseOriginal(id);
    return {
      id,
      oscillator: {
        mass: round(mass),
        stiffness: round(w0 * w0 * mass),
        damping: round(2 * zeta * w0 * mass),
        force: g.force_n,
      },
    };
  });
}

function peakOf(
  s: Oscillator,
  window: "long" | "template",
  at: Date,
): { u: number; runs: Measured[] } {
  const w0 = omega0(s);
  const long = Math.max(transientTime(s, 8), (20 * 2 * Math.PI) / (grid[0]! * w0));
  const runs = grid.map((u) => {
    const w = u * w0;
    const win = window === "template" ? TEMPLATE_WINDOW : windowFor(s, w, long);
    if (!win) throw new Error(`a ${long.toFixed(1)} s window does not fit for ${u}`);
    return measure(s, w, win, `held-out ${window} u=${u}`, at);
  });
  let best = 0;
  runs.forEach((m, i) => {
    if ((m.rms ?? -1) > (runs[best]!.rms ?? -1)) best = i;
  });
  return { u: grid[best]!, runs };
}

export interface EpisodeResult {
  journal: CollabJournal;
  ledger: ClaimLedger;
  runs: EpisodeRun[];
  held_out: HeldOutSystem[];
  c3: Judged;
  a2: Judged;
  outcome: "supported" | "refuted" | "inconclusive" | "contested";
}

export function runAssumptionEpisode(): EpisodeResult {
  const at = new Date(Date.UTC(2026, 10, 16, 15, 0, 0));
  const journal = new CollabJournal(EPISODE_ID, () => at.toISOString());
  const ledger = new ClaimLedger();
  const runs: EpisodeRun[] = [];
  const s = ASSUMPTION_PROTOCOL.exploratory_episode.oscillator;
  const subject = `research-oscillator-${sha256Json(s).slice(0, 12)}`;
  refuseOriginal(subject);
  const w0 = omega0(s),
    wr = displacementPeak(s);
  journal.append("host", "episode.opened", "host", {
    subject_id: subject,
    protocol_sha256: ASSUMPTION_PROTOCOL_SHA256,
    roster_sha256: rosterSha256(),
    oscillator: s,
  });

  // 1. Hypothesis: the common simplification.
  ledger.propose({
    claim_id: "C-1",
    statement: ASSUMPTION_PROTOCOL.assumptions[0]!.statement,
    author: seat("hypothesis"),
    generation: "scripted",
  });
  journal.append(seat("hypothesis"), "message.hypothesis", "scripted", {
    claim_id: "C-1",
    statement: ASSUMPTION_PROTOCOL.assumptions[0]!.statement,
  });
  ledger.propose({
    claim_id: "M-1",
    statement: ASSUMPTION_PROTOCOL.assumptions[1]!.statement,
    author: "host",
    generation: "host",
  });

  // 2. Design in the lab's template: w0 against 0.9 w0.
  const lower = Number((0.9 * w0).toFixed(6));
  journal.append(seat("design"), "message.design", "scripted", {
    compare: [w0, lower],
    window: "template (10 s)",
  });
  const t0 = measure(s, w0, TEMPLATE_WINDOW, "template at w0", at),
    t1 = measure(s, lower, TEMPLATE_WINDOW, "template at 0.9 w0", at);
  runs.push(
    runOf(t0, "template window, drive at w0"),
    runOf(t1, "template window, drive at 0.9 w0"),
  );
  journal.append("host", "run.recorded", "host", {
    runs: [t0.record.sha256, t1.record.sha256],
    rms: [t0.rms, t1.rms],
  });
  const templateSays = (t0.rms ?? 0) > (t1.rms ?? 0) ? "supports" : "refutes";
  ledger.cite("C-1", t0.record.run_id, templateSays);

  // 3. Independent challenges: the physics, and the window.
  const needed = transientTime(s, 8);
  ledger.challenge({
    challenge_id: "X-1",
    by: seat("criticism"),
    target_claim_id: "C-1",
    generation: "scripted",
    text: `Steady displacement amplitude peaks at sqrt(w0^2 - 2 gamma^2) = ${wr.toFixed(4)} rad/s, below w0 = ${w0} rad/s; compare those two frequencies.`,
  });
  ledger.challenge({
    challenge_id: "X-2",
    by: seat("criticism"),
    target_claim_id: "M-1",
    generation: "scripted",
    text: `The 10 s window is shorter than 8/gamma = ${needed.toFixed(1)} s, so the RMS is dominated by the start-up transient.`,
  });
  journal.append(seat("criticism"), "message.challenge", "scripted", {
    challenges: ["X-1", "X-2"],
  });
  ledger.propose({
    claim_id: "C-2",
    statement: `RMS displacement is larger at ${wr.toFixed(4)} rad/s than at w0 = ${w0} rad/s when the transient has decayed.`,
    author: seat("criticism"),
    generation: "scripted",
  });

  // 4. Falsification: the discriminating pair in a long window, then host replication.
  journal.append(seat("falsification"), "message.falsification", "scripted", {
    compare: [w0, wr],
    window_s: needed,
  });
  const winA = windowFor(s, w0, needed)!,
    winB = windowFor(s, wr, needed)!;
  const f0 = measure(s, w0, winA, "falsification at w0", at),
    f1 = measure(s, wr, winB, "falsification at w_r", at);
  runs.push(
    runOf(f0, "8/gamma window, drive at w0"),
    runOf(f1, "8/gamma window, drive at w_r"),
  );
  journal.append("host", "run.recorded", "host", {
    runs: [f0.record.sha256, f1.record.sha256],
    rms: [f0.rms, f1.rms],
  });
  const r0 = measure(
      s,
      w0,
      windowFor(s, w0, needed * 1.5, 0.01)!,
      "replication at w0",
      at,
    ),
    r1 = measure(s, wr, windowFor(s, wr, needed * 1.5, 0.01)!, "replication at w_r", at);
  runs.push(
    runOf(r0, "replication: 1.5x window, half timestep, w0"),
    runOf(r1, "replication: 1.5x window, half timestep, w_r"),
  );
  journal.append(holderOf("replication").agent_id, "message.replication", "host", {
    runs: [r0.record.sha256, r1.record.sha256],
    rms: [r0.rms, r1.rms],
  });
  const allVerified = [t0, t1, f0, f1, r0, r1].every((m) => m.replay_verified);
  journal.append(seat("verification"), "message.verification", "scripted", {
    records_verified: allVerified,
    max_reference_error_m: Math.max(
      ...[t0, t1, f0, f1, r0, r1].map((m) => m.reference_error_m),
    ),
  });
  const longSays =
    (f1.rms ?? 0) > (f0.rms ?? 0) && (r1.rms ?? 0) > (r0.rms ?? 0)
      ? "refutes"
      : "supports";
  ledger.cite("C-1", f0.record.run_id, allVerified ? longSays : "insufficient");
  ledger.cite(
    "C-2",
    f1.record.run_id,
    allVerified ? (longSays === "refutes" ? "supports" : "refutes") : "insufficient",
  );
  if (allVerified) {
    ledger.resolve(
      "X-1",
      longSays === "refutes" ? "upheld" : "rejected",
      f1.record.run_id,
    );
    const windowMatters = templateSays !== longSays;
    ledger.cite("M-1", t0.record.run_id, windowMatters ? "refutes" : "insufficient");
    ledger.resolve("X-2", windowMatters ? "upheld" : "rejected", f0.record.run_id);
  }
  journal.append(
    "host",
    "claim.standing",
    "host",
    Object.fromEntries(["C-1", "C-2", "M-1"].map((id) => [id, ledger.standing(id)])),
  );

  // 5. Revision: a corrected claim and method, each superseding its parent's form.
  ledger.propose({
    claim_id: "C-3",
    statement: ASSUMPTION_PROTOCOL.correction.statement,
    author: seat("criticism"),
    generation: "scripted",
    supersedes: "C-2",
  });
  ledger.propose({
    claim_id: "M-2",
    statement:
      "Response comparisons use a window of at least 8/gamma; the 10 s template is not used to locate a response peak.",
    author: "host",
    generation: "host",
    supersedes: "M-1",
  });
  journal.append(holderOf("memory_revision").agent_id, "message.revision", "host", {
    revised: [
      ["C-2", "C-3"],
      ["M-1", "M-2"],
    ],
  });

  // 6. The preregistered held-out test.
  const held_out: HeldOutSystem[] = heldOutSystems().map(({ id, oscillator }, i) => {
    const when = new Date(at.getTime() + (i + 1) * 60_000);
    const long = peakOf(oscillator, "long", when),
      template = peakOf(oscillator, "template", when);
    const all = [...long.runs, ...template.runs];
    const zeta = dampingRatio(oscillator);
    return {
      system_id: id,
      oscillator,
      zeta,
      u_long: long.u,
      u_template: template.u,
      u_corrected: Math.sqrt(1 - 2 * zeta * zeta),
      run_digests: all.map((m) => m.record.sha256),
      verified: all.filter((m) => m.replay_verified).length,
      runs: all.length,
    };
  });
  const totalRuns = held_out.reduce((n, h) => n + h.runs, 0),
    verified = held_out.reduce((n, h) => n + h.verified, 0);
  const measurements = {
    corrected_within_step: held_out.filter(
      (h) => Math.abs(h.u_corrected - h.u_long) <= 0.0201,
    ).length,
    corrected_better: held_out.filter(
      (h) => Math.abs(h.u_corrected - h.u_long) < Math.abs(1 - h.u_long),
    ).length,
    template_misplaces_peak: held_out.filter(
      (h) => Math.abs(h.u_template - h.u_long) > 0.0201,
    ).length,
    runs_verified_share: totalRuns ? verified / totalRuns : 0,
  };
  const t = ASSUMPTION_PROTOCOL.held_out_test;
  const c3 = evaluate(
    t.criteria_C3 as { guards: Criterion[]; success: Criterion[]; failure: Criterion[] },
    measurements,
  );
  const a2 = evaluate(
    t.criteria_A2_misleads as {
      guards: Criterion[];
      success: Criterion[];
      failure: Criterion[];
    },
    measurements,
  );
  const testDigest = sha256Json(held_out.map((h) => h.run_digests));
  const heldOutRun = (id: string, purpose: string, e: Judged): EpisodeRun => ({
    run_id: id,
    purpose,
    record_sha256: testDigest,
    status: e.status,
    verdict: e.verdict,
    measurements,
    replay_verified: verified === totalRuns,
  });
  runs.push(
    heldOutRun(
      `HT-C3-${testDigest.slice(0, 12)}`,
      `held-out test of C-3 (${totalRuns} backend runs; record_sha256 is the digest of their record digests)`,
      c3,
    ),
    heldOutRun(
      `HT-A2-${testDigest.slice(0, 12)}`,
      `held-out test of the template window, A2 (same ${totalRuns} runs)`,
      a2,
    ),
  );
  journal.append("host", "run.recorded", "host", {
    held_out_test_sha256: testDigest,
    runs: totalRuns,
    measurements,
    c3: c3.status,
    a2_misleads: a2.status,
  });
  const bear = (e: Judged, flip = false) =>
    e.status === "passed"
      ? flip
        ? "refutes"
        : "supports"
      : e.status === "failed"
        ? flip
          ? "supports"
          : "refutes"
        : "insufficient";
  ledger.cite("C-3", runs.at(-2)!.run_id, bear(c3));
  ledger.cite("M-2", runs.at(-1)!.run_id, bear(a2));
  const standing = Object.fromEntries(
    [...ledger.claims.keys()].map((id) => [id, ledger.standing(id)]),
  );
  journal.append("host", "claim.standing", "host", standing);
  const outcome =
    c3.status === "passed"
      ? "supported"
      : c3.status === "failed"
        ? "refuted"
        : "inconclusive";
  journal.append("host", "episode.closed", "host", {
    outcome,
    c3: c3.evaluation.summary,
    a2: a2.evaluation.summary,
  });
  const errors = journal.verify();
  if (errors.length) throw new Error(`episode journal broken: ${errors.join("; ")}`);
  void gamma;
  return { journal, ledger, runs, held_out, c3, a2, outcome };
}
