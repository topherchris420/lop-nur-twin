/**
 * What the model seats are told: who they are, and the structured state they
 * reason over. Host-written text only; a deterministic function of the view,
 * so the same state always yields the same prompt.
 *
 * The researcher is never asked "what should I do next?" in the open. It is
 * shown the budget, its own current question, every hypothesis the Lab has
 * operationalized with the status the registry's criteria gave it, every
 * result, the open questions, what was refused this session, every design by
 * id with whether its seeds are still fresh, what each costs, the known
 * limitations, and the few actions it has — and asked for one JSON object.
 */
import {
  STATUS_WORDS,
  optionLines,
  type AnalysisEntry,
  type ExperimentEntry,
  type HypothesisEntry,
} from "./state.js";
import { RESEARCH_KEYS, ANALYSIS_KEYS } from "./actions.js";
import { SEED_PANELS } from "../../bethesda/rain/standing.js";

export const RESEARCHER_SYSTEM = `You are the research agent of the R.A.I.N. Lab, working inside the Bethesda city simulator. Your purpose is not to sound intelligent. Your purpose is to produce reproducible, bounded research.

Keep these apart, always: a hypothesis is a claim put up for testing; an observation is what the simulator computed from its own state; a simulation result is matched-run measurements, and it describes the simulator's rules, not real Bethesda; an interpretation is your words, which are never evidence; uncertainty is what the results do not settle.

The Lab's rules: Inference is not evidence. Evidence is not permission. Confidence is not authority.

You may ask for actions; the Lab decides which are permitted. You choose among the designs the Lab lists, by id, and nothing else. The Lab writes the experiment, a charter a person authorized decides what may run, the simulator produces the consequences, and the registry's pre-registered criteria decide each verdict.

Prefer an experiment whose result would distinguish competing hypotheses or reduce uncertainty. Do not ask for seeds that have been measured: the simulator is deterministic, so the same design repeats the same result, and a hypothesis revised after seeing a result must be tested on the replication panel, whose seeds it has not seen. Do not treat your own earlier conclusions as evidence: the RESULTS list is the only record of what happened. When a result is inconclusive, say so. When a hypothesis is contradicted, keep that result in view. When no listed design would tell you something new, stop.

Answer with one JSON object and nothing else.`;

export const ANALYST_SYSTEM = `You are the analyst of the R.A.I.N. Lab, reading one result of the Bethesda city simulator. Your purpose is an honest reading, not a persuasive one.

The verdict belongs to the registry's pre-registered criteria, not to you. Your reading says whether the result supports the hypothesis as it was pre-registered, contradicts it, or leaves it inconclusive, and it must agree with the verdict; where you would read it differently, say so in the interpretation and keep the verdict's reading. A simulation result describes the simulator's rules, not real Bethesda. Your interpretation is words, never evidence. Name what remains uncertain, and the questions a next experiment could answer.

Answer with one JSON object and nothing else.`;

export type DesignStatus =
  | "NOT RUN"
  | "RUN"
  | "SEEDS MEASURED"
  | "PLANNED IN THIS DRY RUN"
  | "REFUSED THIS SESSION";
export interface DesignLine {
  id: string;
  status: DesignStatus;
  /** The design or result that explains the status. */
  by: string | null;
}
export interface ResearcherView {
  sessionId: string;
  iteration: number;
  iterations: number;
  experimentsRun: number;
  experimentsBudget: number;
  modelCalls: number;
  modelCallsBudget: number;
  secondsLeft: number;
  toolsLeft: number;
  dryRun: boolean;
  currentQuestion: string | null;
  hypotheses: readonly HypothesisEntry[];
  results: readonly ExperimentEntry[];
  analyses: readonly AnalysisEntry[];
  questions: readonly string[];
  refusals: readonly string[];
  designs: readonly DesignLine[];
  limitations: readonly string[];
  toolResults: readonly { tool: string; input: string; output: string }[];
  previousRefusal: string | null;
}

const n = (v: number | null, unit: string) =>
  v === null ? "not computable" : `${v} ${unit}`;

/** One result in one line, as the researcher and the console read it. */
export function resultLine(x: ExperimentEntry): string {
  const deltas = x.per_seed
    .map((s) => (s.delta === null ? "n/a" : String(s.delta)))
    .join(", ");
  return [
    `${x.experiment_id} · ${x.design_id} · ${x.state} · ${x.verdict.replaceAll("_", " ")}`,
    `mean treatment-control difference ${n(x.delta_mean, x.unit)} (per seed ${deltas || "none"})`,
    x.seeds_expected === null
      ? null
      : `${x.seeds_expected} of ${x.per_seed.length} seeds in the predicted direction`,
    x.replay_verified === true
      ? "replay verified"
      : x.replay_verified === false
        ? "REPLAY FAILED"
        : null,
    x.registry_run_id ? `registry ${x.registry_run_id}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function researcherPrompt(v: ResearcherView): string {
  const out: string[] = [];
  const open = v.designs.filter((d) => d.status === "NOT RUN").length;
  out.push(
    `R.A.I.N. AUTONOMOUS RESEARCH · researcher · session ${v.sessionId} · iteration ${v.iteration} of ${v.iterations}${v.dryRun ? " · DRY RUN (nothing executes)" : ""}`,
    `YOUR TASK: choose the next experiment. Answer "propose_experiment" with one design marked NOT RUN, or "stop" if no NOT RUN design would tell you something new. ${open} of ${v.designs.length} designs are NOT RUN; ${v.results.length ? `${v.results.length} result${v.results.length === 1 ? " is" : "s are"} recorded below` : "no experiment has run yet, so no design has a result"}.`,
    `Budget: ${v.experimentsRun} of ${v.experimentsBudget} experiments this session · ${v.modelCalls} of ${v.modelCallsBudget} model calls · ${v.secondsLeft} s left · ${v.toolsLeft} read-only tool call${v.toolsLeft === 1 ? "" : "s"} left this iteration.`,
    "",
    "YOUR CURRENT QUESTION (your words from an earlier iteration; not evidence):",
    v.currentQuestion ?? "(none yet)",
    "",
    "HYPOTHESES (the Lab's wording; status from the registry's pre-registered criteria, never from your words):",
  );
  if (!v.hypotheses.length) out.push("(none tested yet)");
  for (const h of v.hypotheses) {
    const runs = h.runs
      .map((r) => `${r.panel} seeds: ${r.verdict.replaceAll("_", " ")}`)
      .join("; ");
    out.push(
      `H ${h.id}: ${h.statement} — ${STATUS_WORDS[h.status]}${runs ? ` (${runs})` : ""}; competes with H ${h.competitor}`,
    );
  }
  out.push(
    "",
    "RESULTS (simulation output; they describe the simulator's rules, not Bethesda):",
  );
  if (!v.results.length) out.push("(no experiment has run yet)");
  for (const x of v.results) out.push(resultLine(x));
  const disagreements = v.analyses.filter((a) => !a.agrees);
  if (disagreements.length)
    out.push(
      ...disagreements.map(
        (a) =>
          `NOTE: an earlier model reading of ${a.design_id} (${a.reading}) disagreed with the criteria (${a.criteria_reading}); the criteria stand.`,
      ),
    );
  out.push("", "OPEN QUESTIONS (raised by the model; unresolved; not findings):");
  out.push(...(v.questions.length ? v.questions.map((q) => `- ${q}`) : ["(none)"]));
  out.push("", "REFUSED THIS SESSION:");
  out.push(...(v.refusals.length ? v.refusals.map((r) => `- ${r}`) : ["(nothing)"]));
  out.push(
    "",
    "OPTIONS (the Lab's experiment templates; a design tests one option in one direction on one seed panel):",
    ...optionLines(),
    `Seed panels: primary ${SEED_PANELS.primary.join(", ")} · replication ${SEED_PANELS.replication.join(", ")}. Every design costs 9,000 simulated ticks (6 arms of 1,500) against a matched no-event control.`,
    "",
    "DESIGNS (choose by id; only NOT RUN can be admitted):",
    ...v.designs.map((d) => `- ${d.id} · ${d.status}${d.by ? ` (${d.by})` : ""}`),
    "",
    "KNOWN LIMITATIONS:",
    ...v.limitations.map((l) => `- ${l}`),
    "",
    "TOOLS (read-only; the Lab answers from its records):",
    '- inspect_result: set "experiment" to a result id from RESULTS',
    '- inspect_design: set "design" to a design id, to read its protocol',
    "ACTIONS:",
    '- propose_experiment: set "design", and in your own words "question", "hypothesis", "competing_hypothesis" and "rationale" (why this design distinguishes them); optionally "ranking", up to 3 other NOT RUN design ids you would accept instead, best first; leave "stop_reason" empty',
    '- stop: set "stop_reason" when no NOT RUN design would tell you something new; leave "design" and "ranking" empty',
  );
  if (v.toolResults.length) {
    out.push("", "TOOL RESULTS THIS ITERATION (from the Lab's records):");
    for (const t of v.toolResults) out.push(`${t.tool} ${t.input}:`, t.output);
  }
  if (v.previousRefusal)
    out.push("", `YOUR PREVIOUS ANSWER WAS REFUSED: ${v.previousRefusal}`);
  out.push(
    "",
    `Answer with one JSON object with exactly these keys: ${RESEARCH_KEYS.join(", ")}. Use "" and [] for keys your action does not use.`,
  );
  return out.join("\n");
}

export interface AnalystView {
  sessionId: string;
  iteration: number;
  result: ExperimentEntry;
  preregistered: string;
  modelHypothesis: string;
  modelCompeting: string;
  criteria: string;
  limitations: readonly string[];
  priorOnOption: readonly ExperimentEntry[];
}

export function analystPrompt(v: AnalystView): string {
  const x = v.result;
  return [
    `R.A.I.N. AUTONOMOUS RESEARCH · analyst · session ${v.sessionId} · iteration ${v.iteration}`,
    "",
    `THE HYPOTHESIS AS PRE-REGISTERED (the Lab's words): ${v.preregistered}`,
    `THE RESEARCHER'S HYPOTHESIS (model words, not evidence): ${v.modelHypothesis}`,
    `ITS COMPETING HYPOTHESIS (model words): ${v.modelCompeting}`,
    `DESIGN: ${x.design_id} · seeds ${x.per_seed.map((s) => s.seed).join(", ")}`,
    "",
    "RESULT (simulation output; it describes the simulator's rules, not Bethesda):",
    ...x.per_seed.map(
      (s) =>
        `seed ${s.seed}: control ${s.control ?? "not measured"}, treatment ${s.treatment ?? "not measured"}, difference ${s.delta ?? "not computable"} ${x.unit}`,
    ),
    resultLine(x),
    `CRITERIA (rain-criteria/v1): ${v.criteria}`,
    `VERDICT (the registry's pre-registered criteria): ${x.verdict.replaceAll("_", " ")}`,
    "",
    "EARLIER RESULTS ON THIS OPTION:",
    ...(v.priorOnOption.length ? v.priorOnOption.map(resultLine) : ["(none)"]),
    "",
    "WHAT THE RECORD SAYS IS UNRESOLVED:",
    ...x.unresolved.map((u) => `- ${u}`),
    "LIMITATIONS:",
    ...v.limitations.map((l) => `- ${l}`),
    "",
    `Answer with one JSON object with exactly these keys: ${ANALYSIS_KEYS.join(", ")}. "action" is "record_analysis"; "reading" is "supports", "contradicts" or "inconclusive"; "caveats" and "open_questions" hold at most 3 short strings each.`,
  ].join("\n");
}
