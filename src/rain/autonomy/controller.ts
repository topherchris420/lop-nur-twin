/**
 * The autonomous research loop: bounded, and nothing in it holds authority
 * the Lab did not give it.
 *
 *   observe    derive the research state from sealed records and traces
 *   research   the researcher (a local model) reads it, may inspect a result
 *              or a design (read-only, at most two calls), then proposes one
 *              of the charter's designs in its own words — or stops
 *   propose    the host writes the experiment for that design (`standing.ts`)
 *   validate   the lab's deterministic validation (`validateExperiment`)
 *   authorize  the autonomy policy admits it under the charter a person
 *              authorized, or refuses it, every rule reported
 *   register   the runtime's registry pre-registers it before it runs
 *   execute    matched arms on fresh simulators (`runner.ts`); the live city
 *              is not involved
 *   replay     the sealed record is re-simulated at once (`verifyRecord`)
 *   analyze    the analyst (the same model) reads the result; its reading is
 *              checked against the criteria, which stand either way
 *   record     the registry admits the measurements and judges its own
 *              criteria; the sealed record is written once
 *   repeat     until a budget is spent, the researcher stops, nothing
 *              admissible remains, or something fails — then it stops
 *
 * There is no `while (true)`: the loop runs at most `budgets.iterations`
 * times, and every model call, experiment, failed proposal, second and token
 * is counted against a budget no higher than the charter's ceilings. Anything
 * ambiguous ends the session rather than being worked around: a model that
 * does not answer, a registry that refuses, a run that fails or does not
 * replay, a proposal repeated after its refusal.
 *
 * A dry run does all of it up to authorization and executes nothing: no
 * pre-registration, no simulator, no analysis, no file written. It shows what
 * would run, and treats each such design as planned so it can show the next.
 *
 * Server only.
 */
import { labRevision } from "../../bethesda/rain/provenance.js";
import {
  admitStanding,
  attachAdmission,
  begin,
  complete,
  fail,
  openCase,
  refuseByPolicy,
  type ExperimentCase,
  type Origin,
} from "../../bethesda/rain/cases.js";
import { protocolOf, validateExperiment } from "../../bethesda/rain/experiments.js";
import { runExperiment } from "../../bethesda/rain/runner.js";
import { verifyRecordSync } from "../../bethesda/rain/replay.js";
import {
  rainDefinitionDraft,
  rainSubmission,
  type SubmittedModel,
} from "../../bethesda/rain/submission.js";
import {
  validateAdmission,
  validatePreregistration,
} from "../../bethesda/rain/validation.js";
import {
  admit,
  autonomousProposal,
  charterSha256,
  verifyCharterAuthorization,
  type Charter,
  type CharterAuthorization,
  type SessionBudgets,
  type StandingAuthority,
} from "../../bethesda/rain/standing.js";
import { runArtifactSha256, type ExperimentRecord } from "../../bethesda/rain/record.js";
import type { RuntimeApi } from "../runtime.js";
import {
  ANALYSIS_SCHEMA,
  parseAnalysis,
  parseResearchAction,
  readingFor,
  researchActionSchema,
  type Analysis,
  type ResearchAction,
} from "./actions.js";
import { PROVIDERS } from "./config.js";
import { listsModel, type LocalModel } from "./models.js";
import {
  ANALYST_SYSTEM,
  RESEARCHER_SYSTEM,
  analystPrompt,
  researcherPrompt,
  resultLine,
  type DesignLine,
} from "./prompts.js";
import { SEATS, ask, type DecisionRecord } from "./roles.js";
import {
  RUNTIME_SPENT,
  RUNTIME_SPENT_MESSAGE,
  deriveState,
  type ResearchState,
} from "./state.js";
import { StoreError, type ResearchStore, type SessionLog } from "./store.js";
import {
  SESSION_SCHEMA,
  STOP_REASONS,
  TRACE_SCHEMA,
  type StopReason,
  type TraceBody,
  type TraceEntry,
} from "./trace.js";

/** What the loop needs of the runtime: its identity and its registry. */
export type AutonomyRuntime = Pick<RuntimeApi, "identity" | "preregister" | "submission">;

export interface SessionInput {
  mode: "live" | "dry-run";
  charter: Charter;
  /** Required live; a dry run without one shows what would need it. */
  authorization: CharterAuthorization | null;
  budgets: SessionBudgets;
  model: LocalModel;
  store: ResearchStore;
  /** Required live; a dry run never pre-registers. */
  runtime: AutonomyRuntime | null;
  /** The role label pre-registration drafts name. */
  operator: string;
  /** Every trace entry, as it happens (live, also appended to the trace). */
  onEntry?: (entry: TraceEntry) => void;
  now?: () => Date;
  monotonic?: () => number;
  randomHex?: (bytes: number) => string;
  /** Read-only tool calls the researcher may make per iteration (default 2). */
  toolCalls?: number;
}

export interface SessionSummary {
  schema: typeof SESSION_SCHEMA;
  session_id: string;
  mode: "live" | "dry-run";
  started: boolean;
  started_at: string;
  ended_at: string;
  provider: string;
  model: string;
  endpoint: string;
  charter_sha256: string;
  charter_authorization_sha256: string | null;
  budgets: SessionBudgets;
  stop_reason: StopReason;
  stop: string;
  detail: string;
  iterations: number;
  experiments: {
    run_id: string;
    experiment_id: string;
    design_id: string;
    state: string;
    verdict: string;
    registry_run_id: string | null;
    path: string;
  }[];
  /** Dry run: the designs it would have executed, in order. */
  would_execute: string[];
  failed_proposals: number;
  refusals: number;
  model_calls: number;
  tokens: { prompt: number; completion: number } | null;
  trace: string | null;
  note: string;
}

class Stop extends Error {
  readonly reason: StopReason;
  readonly detail: string;
  constructor(reason: StopReason, detail: string) {
    super(detail);
    this.reason = reason;
    this.detail = detail.slice(0, 600);
  }
}
/** Named, so a sealed record says the budget, not the run, ended it (`cutOffUnmeasured`). */
class RuntimeSpent extends Error {
  override name = RUNTIME_SPENT;
}

const message = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 400);
const defaultHex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const hypothesisOf = (design: string) => design.split("-").slice(0, 2).join("-");
const NOTE =
  "Every question, hypothesis and interpretation attributed to the model is its text, not evidence. What ran was written by the host from a design a person authorized in the charter; every verdict is the registry's pre-registered criteria applied to simulated measurements, which describe the Bethesda simulator's rules, not Bethesda.";

export async function runSession(input: SessionInput): Promise<SessionSummary> {
  if (input.mode === "dry-run") return runSessionUnlocked(input);
  const release = input.store.acquireLock("template-research");
  try {
    return await runSessionUnlocked(input);
  } finally {
    release();
  }
}
async function runSessionUnlocked(input: SessionInput): Promise<SessionSummary> {
  const now = input.now ?? (() => new Date());
  const monotonic = input.monotonic ?? (() => performance.now());
  const hex = input.randomHex ?? defaultHex;
  const live = input.mode === "live";
  const { charter, model, budgets, store } = input;
  const toolCalls = input.toolCalls ?? 2;
  const startedAt = now();
  const sessionId = `RS-${startedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}-${hex(4)}`;
  const deadline = monotonic() + budgets.runtime_ms;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), budgets.runtime_ms);
  (timer as { unref?: () => void }).unref?.();

  let log: SessionLog | null = null;
  let seq = 0;
  let iteration: number | null = null;
  const sessionEntries: TraceEntry[] = [];
  const emit = (body: TraceBody): TraceEntry => {
    const entry = {
      schema: TRACE_SCHEMA,
      seq: ++seq,
      at: now().toISOString(),
      session_id: sessionId,
      iteration,
      ...body,
    } as TraceEntry;
    sessionEntries.push(entry);
    if (log)
      try {
        log.append(entry);
      } catch (error) {
        log = null;
        throw new Stop("store", `the trace could not be appended: ${message(error)}`);
      }
    input.onEntry?.(entry);
    return entry;
  };

  let modelCalls = 0;
  let tokens = { prompt: 0, completion: 0 };
  let tokensKnown = true;
  let failed = 0;
  let experimentsRun = 0;
  let refusalCount = 0;
  let decisionN = 0;
  let currentQuestion: string | null = null;
  let previousRefusal: string | null = null;
  let lastRefusedAnswer: string | null = null;
  const refusedDesigns = new Map<string, string>();
  const refusalLines: string[] = [];
  /** Dry run: `option:panel` → the design it would have run there. */
  const planned = new Map<string, string>();
  const results: SessionSummary["experiments"] = [];

  const sample = validateExperiment(
    autonomousProposal(charter.designs[0]!.design_id, {
      decision_id: "limitations",
      envelope_hash: "0".repeat(64),
    }),
  );
  const limitations = sample.ok ? sample.value.definition.limitations.slice(0, 4) : [];
  const designIds = charter.designs.map((d) => d.design_id);
  const identity = live && input.runtime ? input.runtime.identity() : null;
  const origin: Origin = {
    rain: identity?.rain ?? null,
    rainSource: identity ? "live-identity" : "unavailable",
    model: model.model,
    provider: model.provider,
  };

  const load = (): ResearchState => {
    const traces = store.traces();
    const state = deriveState(
      store.records(),
      live ? traces.entries : [...traces.entries, ...sessionEntries],
    );
    if (traces.skipped)
      state.warnings.push(
        `${traces.skipped} trace line(s) could not be read and were skipped`,
      );
    return state;
  };

  const summary = (stop: Stop, started: boolean): SessionSummary => ({
    schema: SESSION_SCHEMA,
    session_id: sessionId,
    mode: input.mode,
    started,
    started_at: startedAt.toISOString(),
    ended_at: now().toISOString(),
    provider: model.provider,
    model: model.model,
    endpoint: model.endpoint,
    charter_sha256: charterSha256(charter),
    charter_authorization_sha256: input.authorization?.authorization_sha256 ?? null,
    budgets: { ...budgets },
    stop_reason: stop.reason,
    stop: STOP_REASONS[stop.reason],
    detail: stop.detail,
    iterations: iteration ?? 0,
    experiments: results,
    would_execute: [...planned.values()],
    failed_proposals: failed,
    refusals: refusalCount,
    model_calls: modelCalls,
    tokens: tokensKnown ? { ...tokens } : null,
    trace: log?.trace ?? null,
    note: NOTE,
  });

  // The charter names the model that may direct the work; another one may not.
  const named = charter.model;
  if (
    named.provider !== model.provider ||
    named.model !== model.model ||
    named.endpoint !== model.endpoint
  ) {
    clearTimeout(timer);
    return summary(
      new Stop(
        "not_authorized",
        `the charter names ${named.model} via ${named.provider} at ${named.endpoint}, not ${model.model} via ${model.provider} at ${model.endpoint}`,
      ),
      false,
    );
  }
  // A live session that could not run anything never starts, and writes nothing.
  if (live) {
    const refusal = (() => {
      const a = input.authorization;
      if (!a) return new Stop("not_authorized", "no person has authorized this charter");
      const errors = verifyCharterAuthorization(a, charter);
      if (errors.length) return new Stop("not_authorized", errors.join("; "));
      if (now().getTime() > Date.parse(a.expires_at))
        return new Stop("not_authorized", `the authorization expired at ${a.expires_at}`);
      if (!input.runtime || !identity)
        return new Stop("registry", "a live session needs the runtime's registry");
      if (!identity.registry.available)
        return new Stop(
          "registry",
          `the registry is not available: ${identity.registry.reason ?? "unknown"}`,
        );
      if (!labRevision().commit)
        return new Stop(
          "registry",
          "this checkout's commit is unknown, and the registry's submission contract requires the producing commit; it is not invented",
        );
      return null;
    })();
    if (refusal) {
      clearTimeout(timer);
      return summary(refusal, false);
    }
    try {
      log = store.openSession(sessionId);
    } catch (error) {
      clearTimeout(timer);
      return summary(
        new Stop("store", `the session could not be opened: ${message(error)}`),
        false,
      );
    }
  }

  const account = (record: DecisionRecord) => {
    modelCalls += 1;
    if (
      record.response &&
      (record.tokens.prompt === null || record.tokens.completion === null)
    )
      tokensKnown = false;
    tokens = {
      prompt: tokens.prompt + (record.tokens.prompt ?? 0),
      completion: tokens.completion + (record.tokens.completion ?? 0),
    };
  };
  const checkTokens = () => {
    if (budgets.model_tokens === null) return;
    if (!tokensKnown)
      throw new Stop(
        "model_tokens",
        "a token budget is set, and the model server reported no token count: the budget cannot be enforced",
      );
    if (tokens.prompt + tokens.completion >= budgets.model_tokens)
      throw new Stop(
        "model_tokens",
        `${tokens.prompt + tokens.completion} of ${budgets.model_tokens} tokens used`,
      );
  };
  const modelFailed = (record: DecisionRecord): Stop =>
    abort.signal.aborted || record.failure === "cancelled"
      ? new Stop("runtime", "the session's runtime ran out during a model call")
      : new Stop(
          "model_unavailable",
          `${model.model} at ${model.endpoint}: ${record.refused ?? record.failure ?? "no answer"}`,
        );
  const checkBudgets = () => {
    if (monotonic() >= deadline)
      throw new Stop("runtime", `${Math.round(budgets.runtime_ms / 1000)} s spent`);
    if (experimentsRun >= budgets.experiments)
      throw new Stop(
        "experiments",
        `${experimentsRun} of ${budgets.experiments} experiments`,
      );
    if (failed >= budgets.failed_proposals)
      throw new Stop(
        "failed_proposals",
        `${failed} of ${budgets.failed_proposals} proposals failed${previousRefusal ? `; the last: ${previousRefusal}` : ""}`,
      );
    if (modelCalls >= budgets.model_calls)
      throw new Stop(
        "model_calls",
        `${modelCalls} of ${budgets.model_calls} model calls`,
      );
  };
  const refuse = (stage: TraceBody & { kind: "refusal" }) => {
    refusalCount += 1;
    emit(stage);
  };
  const writeRecord = (record: ExperimentRecord, designId: string | null) => {
    if (!live) return null;
    let path: string;
    try {
      path = store.writeRecord(record);
    } catch (error) {
      throw new Stop("store", message(error));
    }
    emit({
      kind: "record",
      run_id: record.run_id,
      experiment_id: record.experiment_id,
      design_id: designId,
      state: record.outcome.state,
      path,
      record_sha256: record.record_sha256,
    });
    return path;
  };

  const designLines = (state: ResearchState): DesignLine[] =>
    charter.designs.map((d) => {
      const key = `${d.option}:${d.panel}`;
      const by = state.measured[key];
      if (by === d.design_id) {
        const x = state.experiments.find((e) => e.design_id === d.design_id);
        return { id: d.design_id, status: "RUN", by: x?.experiment_id ?? null };
      }
      if (by) return { id: d.design_id, status: "SEEDS MEASURED", by: `by ${by}` };
      const plan = planned.get(key);
      if (plan)
        return {
          id: d.design_id,
          status: "PLANNED IN THIS DRY RUN",
          by: plan === d.design_id ? null : `seeds planned for ${plan}`,
        };
      const refused = refusedDesigns.get(d.design_id);
      if (refused)
        return { id: d.design_id, status: "REFUSED THIS SESSION", by: refused };
      return { id: d.design_id, status: "NOT RUN", by: null };
    });

  const inspectResult = (state: ResearchState, id: string): string => {
    const x = [...state.experiments].reverse().find((e) => e.experiment_id === id);
    if (!x) return "No such result.";
    const readings = state.analyses
      .filter((a) => a.run_id === x.run_id)
      .map(
        (a) =>
          `Model reading (${a.model}; not evidence): ${a.reading}${a.agrees ? "" : ` — disagreed with the criteria (${a.criteria_reading}), which stand`}: ${a.interpretation.slice(0, 400)}`,
      );
    return [
      resultLine(x),
      ...x.per_seed.map(
        (s) =>
          `seed ${s.seed}: control ${s.control ?? "not measured"}, treatment ${s.treatment ?? "not measured"}, difference ${s.delta ?? "not computable"} ${x.unit}`,
      ),
      `Criteria: ${x.summary}`,
      ...x.unresolved.map((u) => `Unresolved: ${u}`),
      ...readings,
    ].join("\n");
  };
  const inspectDesign = (id: string): string => {
    const v = validateExperiment(
      autonomousProposal(id, {
        decision_id: "inspect-design",
        envelope_hash: "0".repeat(64),
      }),
    );
    if (!v.ok) return "No such design.";
    const p = protocolOf(v.value.definition);
    return [
      `Hypothesis: ${p.hypothesis}`,
      `Control: ${p.control}`,
      `Treatment: ${p.treatment}`,
      `Metric: ${p.metric}`,
      `If it holds: ${p.expected}`,
      `Failure: ${p.failure}`,
      ...p.limitations.slice(4).map((l) => `Limitation: ${l}`),
    ].join("\n");
  };

  /** The researcher's next action, after at most `toolCalls` reads; null when its answer was refused. */
  const research = async (
    state: ResearchState,
    calls: { latency: number[] },
  ): Promise<{ action: ResearchAction; decision: DecisionRecord } | null> => {
    let toolsLeft = toolCalls;
    const toolResults: { tool: string; input: string; output: string }[] = [];
    for (;;) {
      checkBudgets();
      const experimentIds = state.experiments.map((x) => x.experiment_id);
      const designs = designLines(state);
      const answer = await ask(
        model,
        {
          seat: "researcher",
          system: RESEARCHER_SYSTEM,
          user: researcherPrompt({
            sessionId,
            iteration: iteration!,
            iterations: budgets.iterations,
            experimentsRun,
            experimentsBudget: budgets.experiments,
            modelCalls,
            modelCallsBudget: budgets.model_calls,
            secondsLeft: Math.max(0, Math.round((deadline - monotonic()) / 1000)),
            toolsLeft,
            dryRun: !live,
            currentQuestion,
            hypotheses: state.hypotheses,
            results: state.experiments.slice(-30),
            analyses: state.analyses,
            questions: state.questions.slice(-8).map((q) => q.text),
            refusals: refusalLines.slice(-8),
            designs,
            limitations,
            toolResults,
            previousRefusal,
          }),
          schemaName: "rain_research_action",
          schema: researchActionSchema(designIds, experimentIds),
        },
        (raw) =>
          parseResearchAction(raw, {
            designs: new Set(designIds),
            experiments: new Set(experimentIds),
            toolsLeft,
          }),
        {
          decisionId: `${sessionId}-d${++decisionN}`,
          sessionId,
          iteration: iteration!,
          now,
          signal: abort.signal,
        },
      );
      account(answer.record);
      if (answer.record.latency_ms !== null) calls.latency.push(answer.record.latency_ms);
      emit({ kind: "decision", decision: answer.record });
      checkTokens();
      if (answer.record.failure && answer.record.failure !== "malformed")
        throw modelFailed(answer.record);
      if (!answer.value) {
        failed += 1;
        const reason = answer.record.refused ?? "the answer was refused";
        refuse({
          kind: "refusal",
          stage: "research",
          decision_id: answer.record.decision_id,
          reason,
        });
        const sha = answer.record.response?.sha256 ?? null;
        if (sha && sha === lastRefusedAnswer)
          throw new Stop(
            "repeated",
            `the researcher gave the same refused answer twice: ${reason}`,
          );
        lastRefusedAnswer = sha;
        previousRefusal = reason;
        return null;
      }
      const a = answer.value;
      if (a.action === "inspect_result" || a.action === "inspect_design") {
        toolsLeft -= 1;
        const target = a.action === "inspect_result" ? a.experiment : a.design;
        const output =
          a.action === "inspect_result"
            ? inspectResult(state, a.experiment)
            : inspectDesign(a.design);
        emit({
          kind: "tool",
          decision_id: answer.record.decision_id,
          tool: a.action,
          input: target,
          output,
        });
        toolResults.push({ tool: a.action, input: target, output });
        continue;
      }
      previousRefusal = null;
      lastRefusedAnswer = null;
      return { action: a, decision: answer.record };
    }
  };

  type Admitted =
    | { kind: "admitted"; c: ExperimentCase; standing: StandingAuthority }
    | { kind: "planned" }
    | { kind: "refused"; reason: string };

  const admitOne = (
    state: ResearchState,
    id: string,
    decision: DecisionRecord,
  ): Admitted => {
    const proposal = autonomousProposal(id, {
      decision_id: decision.decision_id,
      envelope_hash: decision.decision_sha256,
    });
    const c = openCase(proposal, {
      id: `${sessionId}-i${iteration}-${id}`,
      now: now(),
      origin,
    });
    emit({
      kind: "validation",
      decision_id: decision.decision_id,
      design_id: id,
      ok: !!c.validated,
      experiment_id: c.validated?.experimentId ?? null,
      checks: c.checks.map(({ id: check, ok, detail }) => ({ id: check, ok, detail })),
    });
    if (!c.validated) {
      const reason = `failed the host's validation: ${c.checks
        .filter((x) => !x.ok)
        .map((x) => x.detail)
        .join("; ")}`;
      if (c.record) writeRecord(c.record, id);
      refuse({
        kind: "refusal",
        stage: "validation",
        decision_id: decision.decision_id,
        reason,
      });
      return { kind: "refused", reason };
    }
    const measured = new Map(Object.entries(state.measured));
    for (const [key, by] of planned)
      if (!measured.has(key)) measured.set(key, `${by} (planned in this dry run)`);
    const verdict = admit({
      charter,
      authorization: input.authorization,
      sessionId,
      iteration: iteration!,
      decision: {
        decision_id: decision.decision_id,
        decision_sha256: decision.decision_sha256,
      },
      designId: id,
      validated: c.validated,
      measured,
      experimentsThisSession: experimentsRun,
      budgets,
      runtimeLeftMs: deadline - monotonic(),
      now: now(),
    });
    const blocking = verdict.rules.filter((r) => !r.ok);
    const onlyAuthorization =
      !verdict.ok && blocking.every((r) => r.id === "charter-authorized");
    emit({
      kind: "policy",
      decision_id: decision.decision_id,
      design_id: id,
      admitted: verdict.ok,
      admissible_once_authorized: onlyAuthorization,
      rules: verdict.rules,
      admission_sha256: verdict.ok ? verdict.standing.admission.admission_sha256 : null,
    });
    const reason = blocking.map((r) => `${r.id}: ${r.detail}`).join("; ");
    if (!live) {
      if (verdict.ok || onlyAuthorization) {
        const d = charter.designs.find((x) => x.design_id === id)!;
        planned.set(`${d.option}:${d.panel}`, id);
        const p = protocolOf(c.validated.definition);
        emit({
          kind: "would-execute",
          decision_id: decision.decision_id,
          design_id: id,
          experiment_id: c.validated.experimentId,
          definition_sha256: c.validated.definitionSha256,
          protocol: `${p.treatment} Metric: ${p.metric}`,
        });
        return { kind: "planned" };
      }
      refuse({
        kind: "refusal",
        stage: "policy",
        decision_id: decision.decision_id,
        reason,
      });
      return { kind: "refused", reason };
    }
    if (!verdict.ok) {
      refuseByPolicy(
        c,
        blocking.map((r) => `${r.id}: ${r.detail}`),
        now(),
      );
      if (c.record) writeRecord(c.record, id);
      refuse({
        kind: "refusal",
        stage: "policy",
        decision_id: decision.decision_id,
        reason,
      });
      return { kind: "refused", reason };
    }
    const admitted = admitStanding(c, verdict.standing, now());
    if (!admitted.ok) {
      const why = admitted.errors.join("; ");
      refuseByPolicy(c, [why], now());
      if (c.record) writeRecord(c.record, id);
      refuse({
        kind: "refusal",
        stage: "policy",
        decision_id: decision.decision_id,
        reason: why,
      });
      return { kind: "refused", reason: why };
    }
    return { kind: "admitted", c, standing: verdict.standing };
  };

  const analyze = async (
    record: ExperimentRecord,
    action: ResearchAction,
    designId: string,
    state: ResearchState,
  ): Promise<
    | { value: Analysis; decision: DecisionRecord; stop: Stop | null }
    | { value: null; stop: Stop | null }
  > => {
    if (modelCalls >= budgets.model_calls || monotonic() >= deadline)
      return { value: null, stop: null };
    const entry = deriveState(
      [{ path: "(this run)", record, digestOK: true, problem: null }],
      [],
    ).experiments[0];
    if (!entry || !record.definition || !record.run) return { value: null, stop: null };
    const answer = await ask(
      model,
      {
        seat: "analyst",
        system: ANALYST_SYSTEM,
        user: analystPrompt({
          sessionId,
          iteration: iteration!,
          result: entry,
          preregistered: record.definition.hypothesis,
          modelHypothesis: action.hypothesis,
          modelCompeting: action.competing_hypothesis,
          criteria: record.run.evaluation.summary,
          limitations: record.definition.limitations,
          priorOnOption: state.experiments.filter((x) => x.option === entry.option),
        }),
        schemaName: "rain_analysis",
        schema: ANALYSIS_SCHEMA,
      },
      parseAnalysis,
      {
        decisionId: `${sessionId}-d${++decisionN}`,
        sessionId,
        iteration: iteration!,
        now,
        signal: abort.signal,
      },
    );
    account(answer.record);
    emit({ kind: "decision", decision: answer.record });
    let stop: Stop | null = null;
    try {
      checkTokens();
    } catch (error) {
      stop = error as Stop;
    }
    if (answer.record.failure && answer.record.failure !== "malformed")
      return { value: null, stop: stop ?? modelFailed(answer.record) };
    if (!answer.value) {
      refuse({
        kind: "refusal",
        stage: "analysis",
        decision_id: answer.record.decision_id,
        reason: answer.record.refused ?? "the analysis was refused",
      });
      return { value: null, stop };
    }
    const criteria = readingFor(record.outcome.verdict);
    emit({
      kind: "analysis",
      decision_id: answer.record.decision_id,
      run_id: record.run_id,
      design_id: designId,
      reading: answer.value.reading,
      criteria_reading: criteria,
      agrees: answer.value.reading === criteria,
      interpretation: answer.value.interpretation,
      caveats: answer.value.caveats,
      open_questions: answer.value.open_questions,
      generation: "model",
      model: model.model,
    });
    return { value: answer.value, decision: answer.record, stop };
  };

  const execute = async (
    c: ExperimentCase,
    standing: StandingAuthority,
    action: ResearchAction,
    designId: string,
    state: ResearchState,
    calls: { latency: number[] },
  ) => {
    const v = c.validated!;
    const runtime = input.runtime!;
    const draft = rainDefinitionDraft(
      v.definition,
      v.experimentId,
      v.definitionSha256,
      input.operator,
    );
    const requestId = hex(16);
    let prereg;
    try {
      const raw = runtime.preregister(draft, requestId);
      const checked = validatePreregistration(JSON.parse(JSON.stringify(raw)), {
        requestId,
      });
      if (!checked.ok) throw new Error(checked.errors.join("; "));
      prereg = checked.value;
    } catch (error) {
      const reason = `the registry did not pre-register it: ${message(error)}`;
      refuseByPolicy(c, [reason], now());
      if (c.record) writeRecord(c.record, designId);
      refuse({ kind: "refusal", stage: "preregistration", decision_id: null, reason });
      throw new Stop("registry", reason);
    }
    const { certificate, ...preregistration } = prereg;
    c.preregistration = preregistration;
    c.receipt = { draft, created_at: preregistration.created_at, certificate };
    emit({
      kind: "preregistration",
      experiment_id: v.experimentId,
      rain_experiment_id: preregistration.experiment_id,
      registry: preregistration.registry,
      definition_sha256: v.definitionSha256,
    });

    const refused = begin(c, now());
    if (refused.length) {
      if (c.record) writeRecord(c.record, designId);
      const reason = `the runner's preflight refused: ${refused.join("; ")}`;
      refuse({ kind: "refusal", stage: "execution", decision_id: null, reason });
      throw new Stop("simulator", reason);
    }
    const started = now();
    const t0 = monotonic();
    let record: ExperimentRecord;
    let failure: unknown = null;
    try {
      const steps = runExperiment(
        v.definition,
        v.definitionSha256,
        v.experimentId,
        standing,
      );
      for (;;) {
        const next = steps.next();
        if (next.done) {
          record = complete(c, next.value, { started, finished: now() });
          break;
        }
        if (monotonic() >= deadline) throw new RuntimeSpent(RUNTIME_SPENT_MESSAGE);
      }
    } catch (error) {
      failure = error;
      record = fail(c, error, now());
    }
    experimentsRun += 1;
    emit({
      kind: "execution",
      experiment_id: v.experimentId,
      run_id: record.run_id,
      design_id: designId,
      state: record.outcome.state,
      verdict: record.outcome.verdict,
      rain_status: record.outcome.rain_status,
      summary: record.outcome.summary,
      seconds: Math.round((monotonic() - t0) / 100) / 10,
    });
    let replayFailed = false;
    if (!failure) {
      const verification = verifyRecordSync(record);
      replayFailed = !verification.ok;
      emit({
        kind: "replay",
        run_id: record.run_id,
        artifact_sha256: runArtifactSha256(record),
        ok: verification.ok,
        failed: verification.checks
          .filter((x) => !x.ok)
          .map((x) => `${x.id}: ${x.detail}`),
      });
    }
    let stopAfter: Stop | null = null;
    let analysis: Analysis | null = null;
    if (!failure && !replayFailed) {
      const read = await analyze(record, action, designId, state);
      analysis = read.value;
      stopAfter = read.stop;
    }
    const label =
      model.provider === "openai" ? "OpenAI" : PROVIDERS[model.provider].label;
    const models: SubmittedModel[] = [
      {
        role: "researcher",
        name: model.model,
        provider: label,
        calls: calls.latency.length,
        latency_ms: [...calls.latency],
      },
    ];
    if (analysis)
      models.push({ role: "analyst", name: model.model, provider: label, calls: 1 });
    const criteria = readingFor(record.outcome.verdict);
    const submission = rainSubmission(
      record,
      {
        experimentId: preregistration.experiment_id,
        experimentVersion: preregistration.experiment_version,
      },
      {
        models,
        modelInterpretation: analysis
          ? {
              model: `${model.model} (${label})`,
              text: `Reading: ${analysis.reading}${analysis.reading === criteria ? "" : ` (the pre-registered criteria read ${criteria}; the criteria stand)`}. ${analysis.interpretation}${analysis.caveats.length ? ` Caveats: ${analysis.caveats.join(" ")}` : ""} [Written by ${model.model} through ${label} as R.A.I.N.'s analyst: an interpretation, not evidence.]`,
            }
          : null,
      },
    );
    const submissionId = hex(16);
    let rainRunId: string | null = null;
    try {
      if (!submission.ok) throw new Error(submission.errors.join("; "));
      const raw = runtime.submission(
        preregistration.experiment_id,
        submission.value,
        submissionId,
        c.receipt,
      );
      const checked = validateAdmission(JSON.parse(JSON.stringify(raw)), {
        requestId: submissionId,
        experimentId: preregistration.experiment_id,
      });
      if (!checked.ok) throw new Error(checked.errors.join("; "));
      attachAdmission(c, checked.value);
      record = c.record!;
      rainRunId = checked.value.run_id;
      emit({
        kind: "submission",
        run_id: record.run_id,
        rain_run_id: checked.value.run_id,
        status: checked.value.status,
        verdict: checked.value.hypothesis_verdict,
        refused: null,
      });
    } catch (error) {
      emit({
        kind: "submission",
        run_id: record.run_id,
        rain_run_id: null,
        status: null,
        verdict: null,
        refused: message(error),
      });
      stopAfter ??= new Stop(
        "registry",
        `the registry did not admit ${record.run_id}: ${message(error)}`,
      );
    }
    const path = writeRecord(record, designId)!;
    results.push({
      run_id: record.run_id,
      experiment_id: v.experimentId,
      design_id: designId,
      state: record.outcome.state,
      verdict: record.outcome.verdict,
      registry_run_id: rainRunId,
      path,
    });
    // A contradiction is kept, never resolved: both results stay, and say so.
    const after = load();
    const h = after.hypotheses.find((x) => x.id === hypothesisOf(designId));
    const rival = h ? after.hypotheses.find((x) => x.id === h.competitor) : undefined;
    if (
      h?.status === "contested" ||
      (h?.status === "supported" && rival?.status === "supported")
    )
      emit({
        kind: "contradiction",
        hypothesis: h.id,
        runs: [...h.runs, ...(h.status === "supported" ? (rival?.runs ?? []) : [])].map(
          (r) => ({
            run_id: r.run_id,
            design_id: r.design_id,
            verdict: r.verdict,
          }),
        ),
        detail:
          h.status === "contested"
            ? `the seed panels disagree about H ${h.id}; both results are kept, and neither overrides the other`
            : `H ${h.id} and its competitor H ${h.competitor} are each supported on a different panel; both results are kept`,
      });
    if (failure)
      throw failure instanceof RuntimeSpent
        ? new Stop("runtime", failure.message)
        : new Stop(
            "simulator",
            `${v.experimentId} did not complete: ${message(failure)}`,
          );
    if (replayFailed)
      throw new Stop("replay", `${record.run_id} did not re-simulate identically`);
    if (stopAfter) throw stopAfter;
  };

  let ended: Stop;
  try {
    emit({
      kind: "session-started",
      mode: input.mode,
      provider: model.provider,
      model: model.model,
      endpoint: model.endpoint,
      charter_sha256: charterSha256(charter),
      charter_authorization_sha256: input.authorization?.authorization_sha256 ?? null,
      budgets: { ...budgets },
      roles: Object.fromEntries(
        Object.entries(SEATS).map(([role, seat]) => [role, seat.by]),
      ),
      research_dir: store.root,
      records_before: store.records().length,
    });
    let listed: string[];
    try {
      listed = await model.listModels({ signal: abort.signal });
    } catch (error) {
      emit({ kind: "model-check", ok: false, listed: [], detail: message(error) });
      throw new Stop(
        "model_unavailable",
        `${model.provider === "openai" ? "OpenAI" : PROVIDERS[model.provider].label} at ${model.endpoint}: ${message(error)}`,
      );
    }
    if (!listsModel(listed, model)) {
      const detail = `the server lists ${listed.length} model(s)${listed.length ? `: ${listed.slice(0, 12).join(", ")}` : ""}, not ${model.model}`;
      emit({ kind: "model-check", ok: false, listed: listed.slice(0, 64), detail });
      throw new Stop("model_unavailable", detail);
    }
    emit({
      kind: "model-check",
      ok: true,
      listed: listed.slice(0, 64),
      detail: `${model.model} is served by ${model.provider === "openai" ? "OpenAI" : PROVIDERS[model.provider].label} at ${model.endpoint}`,
    });
    for (let i = 1; i <= budgets.iterations; i++) {
      iteration = i;
      checkBudgets();
      const state = load();
      const open = designLines(state).filter((d) => d.status === "NOT RUN");
      emit({
        kind: "observation",
        designs_open: open.length,
        experiments_recorded: state.experiments.length,
        hypotheses_tested: state.hypotheses.filter((h) => h.runs.length).length,
        open_questions: state.questions.length,
      });
      if (!open.length)
        throw new Stop(
          "no_design",
          "every design's seeds are measured, planned or refused",
        );
      const calls = { latency: [] as number[] };
      const asked = await research(state, calls);
      if (!asked) continue;
      const { action, decision } = asked;
      if (action.action === "stop") throw new Stop("researcher", action.stop_reason);
      emit({
        kind: "proposal",
        decision_id: decision.decision_id,
        design_id: action.design,
        ranking: action.ranking,
        question: action.question,
        hypothesis: action.hypothesis,
        competing_hypothesis: action.competing_hypothesis,
        rationale: action.rationale,
        generation: "model",
        model: model.model,
      });
      currentQuestion = action.question;
      const earlier = refusedDesigns.get(action.design);
      if (earlier)
        throw new Stop(
          "repeated",
          `${action.design} was refused earlier this session (${earlier}) and was proposed again`,
        );
      let outcome: Admitted = { kind: "refused", reason: "no candidate" };
      const candidates = [
        action.design,
        ...action.ranking.filter((d) => d !== action.design),
      ];
      for (const id of candidates) {
        if (refusedDesigns.has(id)) continue;
        outcome = admitOne(state, id, decision);
        if (outcome.kind !== "refused") break;
        refusedDesigns.set(id, outcome.reason.slice(0, 200));
        refusalLines.push(`${id}: ${outcome.reason.slice(0, 200)}`);
      }
      if (outcome.kind === "refused") {
        failed += 1;
        previousRefusal = `none of ${candidates.join(", ")} could be admitted; the policy said: ${outcome.reason}`;
        continue;
      }
      if (outcome.kind === "planned") {
        experimentsRun += 1;
        continue;
      }
      const admittedDesign = outcome.standing.admission.design_id;
      await execute(outcome.c, outcome.standing, action, admittedDesign, state, calls);
    }
    throw new Stop("iterations", `${budgets.iterations} iteration(s)`);
  } catch (error) {
    ended =
      error instanceof Stop
        ? error
        : error instanceof StoreError
          ? new Stop("store", message(error))
          : new Stop("error", message(error));
  } finally {
    clearTimeout(timer);
  }
  try {
    emit({
      kind: "session-ended",
      stop_reason: ended.reason,
      detail: ended.detail,
      experiments: experimentsRun,
      model_calls: modelCalls,
      tokens: tokensKnown ? { ...tokens } : null,
      failed_proposals: failed,
    });
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
  }
  const result = summary(ended, true);
  if (live && log) {
    try {
      log.close(result);
      store.writeState(load());
    } catch {
      // The trace already holds every step; a summary that cannot be written loses nothing.
    }
  }
  return result;
}
