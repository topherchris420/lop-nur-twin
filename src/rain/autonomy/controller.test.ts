/**
 * The autonomous loop end to end, against a scripted model: no Ollama, no LM
 * Studio, nothing on the network. The experiments are real — fresh simulators,
 * the runtime's real registry in a scratch directory, sealed records, replay.
 */
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureRuntime, type RuntimeApi } from "../runtime";
import { sha256Json } from "../sha256";
import { EVIDENCE_LEDGER } from "../../lib/evidence";
import { verifyRecordSync } from "../../bethesda/rain/replay";
import type { ExperimentRecord } from "../../bethesda/rain/record";
import { optionHypothesis } from "../../bethesda/rain/session";
import {
  authorizeCharter,
  budgetsWithin,
  buildCharter,
  charterSha256,
  designQuestion,
  type Ceilings,
  type Charter,
  type CharterAuthorization,
  type SessionBudgets,
} from "../../bethesda/rain/standing";
import { runSession, type SessionSummary } from "./controller";
import { ModelFailure } from "./models";
import { decisionDigestOK } from "./roles";
import { deriveState } from "./state";
import { ResearchStore, StoreError, type StoredRecord } from "./store";
import type { TraceEntry } from "./trace";
import {
  ScriptedModel,
  analyst,
  firstOpen,
  inspectDesign,
  proposal,
  stop,
  type Script,
} from "./fixtures";

const LONG = 240_000;
const root = mkdtempSync(join(tmpdir(), "rain-autonomy-"));
const revision = globalThis as { __LAB_REVISION__?: unknown };
const ledgerBefore = sha256Json(EVIDENCE_LEDGER);
const CEILINGS: Ceilings = {
  iterations: 6,
  experiments: 4,
  runtime_ms: 600_000,
  failed_proposals: 3,
  model_calls: 40,
  model_tokens: null,
};
beforeAll(() => {
  revision.__LAB_REVISION__ = { commit: "c".repeat(40), dirty: false, source: "git" };
});
afterAll(() => {
  delete revision.__LAB_REVISION__;
  rmSync(root, { recursive: true, force: true });
});

const charterFor = (model: ScriptedModel, ceilings: Ceilings = CEILINGS): Charter =>
  buildCharter({
    ceilings,
    model: { provider: model.provider, model: model.model, endpoint: model.endpoint },
    validHours: 24,
  });
const authorize = (charter: Charter, now = new Date()): CharterAuthorization => {
  const a = authorizeCharter({
    charter,
    operator: "R.A.I.N.Operator",
    typedPrefix: charterSha256(charter).slice(0, 8),
    reviewed: true,
    now,
  });
  if (!a.ok) throw new Error(a.errors.join("; "));
  return a.value;
};
const runtimes = new Map<string, RuntimeApi>();
async function runtimeFor(dir: string): Promise<RuntimeApi> {
  const known = runtimes.get(dir);
  if (known) return known;
  const c = await configureRuntime({
    env: { RAIN_REGISTRY_DIR: join(dir, "registry") },
    cwd: process.cwd(),
  });
  if (c.mode !== "local") throw new Error("the runtime must start");
  runtimes.set(dir, c.runtime);
  return c.runtime;
}

interface Run {
  summary: SessionSummary;
  entries: TraceEntry[];
  model: ScriptedModel;
  store: ResearchStore;
}
async function session(input: {
  dir: string;
  researcher: Script;
  analyst?: Script;
  mode?: "live" | "dry-run";
  budgets?: Partial<SessionBudgets>;
  ceilings?: Ceilings;
  authorization?: "yes" | "no" | "expired";
  model?: Partial<ConstructorParameters<typeof ScriptedModel>[0]>;
  monotonic?: () => number;
  onEntry?: (e: TraceEntry) => void;
  runtime?: (real: RuntimeApi) => RuntimeApi;
}): Promise<Run> {
  const model = new ScriptedModel({
    researcher: input.researcher,
    analyst: input.analyst,
    ...input.model,
  });
  const charter = charterFor(model, input.ceilings);
  const budgets = budgetsWithin(charter.ceilings, input.budgets ?? {});
  if (!budgets.ok) throw new Error(budgets.errors.join("; "));
  const mode = input.mode ?? "live";
  const authorization =
    input.authorization === "no"
      ? null
      : input.authorization === "expired"
        ? authorize(charter, new Date(Date.now() - 25 * 3_600_000))
        : authorize(charter);
  const store = new ResearchStore(input.dir);
  const entries: TraceEntry[] = [];
  const summary = await runSession({
    mode,
    charter,
    authorization,
    budgets: budgets.value,
    model,
    store,
    runtime:
      mode === "live"
        ? (input.runtime ?? ((real) => real))(await runtimeFor(input.dir))
        : null,
    operator: "R.A.I.N.Operator",
    monotonic: input.monotonic,
    onEntry: (e) => {
      entries.push(e);
      input.onEntry?.(e);
    },
  });
  return { summary, entries, model, store };
}
const kinds = (entries: readonly TraceEntry[]) => entries.map((e) => e.kind);
const of = <K extends TraceEntry["kind"]>(entries: readonly TraceEntry[], kind: K) =>
  entries.filter((e): e is Extract<TraceEntry, { kind: K }> => e.kind === kind);
const readRecord = (dir: string, path: string) =>
  JSON.parse(readFileSync(join(dir, path), "utf8")) as ExperimentRecord;

describe("a live session, end to end", () => {
  const dir = join(root, "live");
  let first: Run;
  beforeAll(async () => {
    // Inspect a design first, then propose the first open one; the analyst
    // reads every result as support, whatever the criteria say.
    first = await session({
      dir,
      researcher: (prompt, call) =>
        call === 1 ? inspectDesign("X1-increase-primary") : firstOpen(prompt, call),
      analyst: analyst("supports"),
      budgets: { experiments: 2, iterations: 4 },
    });
  }, LONG);

  it("observes, researches, proposes, validates, authorizes, registers, runs, replays, analyzes, records — and repeats", () => {
    const s = first.summary;
    expect(s.started).toBe(true);
    expect(s.stop_reason).toBe("experiments");
    expect(s.experiments.map((x) => x.design_id)).toEqual([
      "X1-increase-primary",
      "X1-increase-replication",
    ]);
    const iteration1 = first.entries.filter((e) => e.iteration === 1).map((e) => e.kind);
    expect(iteration1).toEqual([
      "observation",
      "decision",
      "tool",
      "decision",
      "proposal",
      "validation",
      "policy",
      "preregistration",
      "execution",
      "replay",
      "decision",
      "analysis",
      "submission",
      "record",
    ]);
    expect(kinds(first.entries)[0]).toBe("session-started");
    expect(kinds(first.entries).at(-1)).toBe("session-ended");
    expect(of(first.entries, "replay").every((r) => r.ok)).toBe(true);
    expect(of(first.entries, "policy").every((p) => p.admitted)).toBe(true);
    expect(s.tokens).not.toBeNull();
    expect(s.model_calls).toBe(5);
  });

  it(
    "traces every run back to the model decision that asked for it",
    () => {
      const decisions = new Map(
        of(first.entries, "decision").map((d) => [d.decision.decision_id, d.decision]),
      );
      for (const e of first.summary.experiments) {
        const record = readRecord(dir, e.path);
        expect(verifyRecordSync(record).ok).toBe(true);
        const a = record.standing!.admission;
        const decision = decisions.get(a.decision_id)!;
        expect(decision.seat).toBe("researcher");
        expect(decisionDigestOK(decision)).toBe(true);
        expect(a.decision_sha256).toBe(decision.decision_sha256);
        expect(record.definition!.proposal.rain_decision).toEqual({
          decision_id: decision.decision_id,
          envelope_hash: decision.decision_sha256,
        });
        expect(decision.prompt.user).toContain("R.A.I.N. AUTONOMOUS RESEARCH");
        expect(decision.response?.text).toContain(a.design_id);
        expect(record.provenance).toMatchObject({
          provider: "ollama",
          model: "scripted-model",
        });
        expect(record.rain_admission?.run_id).toBe(e.registry_run_id);
      }
    },
    LONG,
  );

  it("keeps the model's words out of everything that ran and was sealed", () => {
    for (const e of first.summary.experiments) {
      const record = readRecord(dir, e.path);
      const design = record.standing!.charter.designs.find(
        (d) => d.design_id === e.design_id,
      )!;
      expect(record.definition!.question).toBe(designQuestion(design));
      expect(record.definition!.hypothesis).toBe(
        optionHypothesis(design.option, design.expected_direction),
      );
      expect(JSON.stringify(record)).not.toContain("[scripted]");
    }
    const proposals = of(first.entries, "proposal");
    expect(
      proposals.every(
        (p) => p.generation === "model" && p.hypothesis.startsWith("[scripted]"),
      ),
    ).toBe(true);
  });

  it("records a model reading that disagrees with the criteria, and the criteria stand", () => {
    const analyses = of(first.entries, "analysis");
    expect(analyses).toHaveLength(2);
    for (const a of analyses) {
      expect(a.reading).toBe("supports");
      expect(a.criteria_reading).toBe("contradicts");
      expect(a.agrees).toBe(false);
    }
    const registry = join(dir, "registry");
    const results = readdirSync(registry)
      .filter((d) => d.startsWith("V3D-EXP-"))
      .map(
        (d) =>
          JSON.parse(
            readFileSync(join(registry, d, "runs", "RUN-0001", "result.json"), "utf8"),
          ) as {
            status: string;
            evidence_class: string;
            interpretation: { model: { origin: string; text: string } | null };
            models: { role: string; provider: string }[];
          },
      );
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.status).toBe("failed");
      expect(r.evidence_class).toBe("simulated");
      expect(r.interpretation.model?.origin).toBe("MODEL_INFERRED");
      expect(r.interpretation.model?.text).toMatch(/the criteria stand/);
      expect(r.models.map((m) => m.role)).toEqual(["researcher", "analyst"]);
    }
  });

  it("writes the trace, a summary and a derived state snapshot, and never touches the evidence ledger", () => {
    const session = join(dir, "sessions", first.summary.session_id);
    expect(existsSync(join(session, "trace.jsonl"))).toBe(true);
    expect(existsSync(join(session, "summary.json"))).toBe(true);
    const lines = readFileSync(join(session, "trace.jsonl"), "utf8").trim().split("\n");
    expect(lines.length).toBe(first.entries.length);
    const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as {
      schema: string;
      experiments: unknown[];
    };
    expect(state.schema).toBe("rain-research-state/v1");
    expect(state.experiments).toHaveLength(2);
    expect(sha256Json(EVIDENCE_LEDGER)).toBe(ledgerBefore);
  });

  it(
    "remembers across sessions, refuses measured seeds, and stops on a repeated refused proposal",
    async () => {
      const second = await session({
        dir,
        researcher: () => proposal("X1-increase-primary"),
      });
      expect(second.summary.stop_reason).toBe("repeated");
      expect(second.summary.experiments).toEqual([]);
      const prompt = second.model.requests[0]!.user;
      expect(prompt).toContain("- X1-increase-primary · RUN (BX-");
      expect(prompt).toContain(
        "- X1-decrease-primary · SEEDS MEASURED (by X1-increase-primary)",
      );
      expect(prompt).toMatch(
        /NOTE: an earlier model reading of X1-increase-primary \(supports\) disagreed/,
      );
      const refusal = of(second.entries, "policy")[0]!;
      expect(refusal.admitted).toBe(false);
      expect(refusal.rules.filter((r) => !r.ok).map((r) => r.id)).toEqual([
        "fresh-seeds",
      ]);
      // The refusal is a sealed REJECTED record; nothing ran.
      const rejected = of(second.entries, "record")[0]!;
      expect(rejected.state).toBe("REJECTED");
      expect(readRecord(dir, rejected.path).run).toBeNull();
    },
    LONG,
  );

  it("never overwrites a sealed record, and leaves out one that was edited", () => {
    const store = new ResearchStore(dir);
    const path = first.summary.experiments[0]!.path;
    const record = readRecord(dir, path);
    expect(() => store.writeRecord(record)).toThrow(/never overwritten/);
    expect(readRecord(dir, path)).toEqual(record);

    const copy = join(root, "tampered");
    cpSync(dir, copy, { recursive: true });
    const edited = readRecord(copy, path);
    edited.outcome.verdict = "supported";
    writeFileSync(join(copy, path), JSON.stringify(edited));
    writeFileSync(join(copy, "state.json"), '{"experiments": "anything at all"}');
    const tampered = new ResearchStore(copy);
    const state = deriveState(tampered.records(), tampered.traces().entries);
    expect(state.experiments.map((x) => x.design_id)).toEqual([
      "X1-increase-replication",
    ]);
    expect(state.warnings.join()).toMatch(/does not match its digest/);
  });
});

describe("a dry run", () => {
  it("proposes, validates and shows what would run, and executes and writes nothing", async () => {
    const dir = join(root, "dry");
    const run = await session({
      dir,
      mode: "dry-run",
      researcher: firstOpen,
      authorization: "no",
      budgets: { iterations: 3 },
    });
    expect(run.summary.stop_reason).toBe("iterations");
    expect(run.summary.would_execute).toEqual([
      "X1-increase-primary",
      "X1-increase-replication",
      "X2-increase-primary",
    ]);
    expect(run.summary.experiments).toEqual([]);
    expect(run.summary.trace).toBeNull();
    expect(existsSync(dir)).toBe(false);
    const policies = of(run.entries, "policy");
    expect(policies.every((p) => !p.admitted && p.admissible_once_authorized)).toBe(true);
    expect(kinds(run.entries)).not.toContain("preregistration");
    expect(kinds(run.entries)).not.toContain("execution");
    expect(of(run.entries, "would-execute")).toHaveLength(3);
  });
});

describe("failing closed", () => {
  it("does not start a live session without a standing authorization, or after it expired", async () => {
    for (const authorization of ["no", "expired"] as const) {
      const dir = join(root, `unauthorized-${authorization}`);
      const run = await session({ dir, researcher: firstOpen, authorization });
      expect(run.summary.started).toBe(false);
      expect(run.summary.stop_reason).toBe("not_authorized");
      expect(run.entries).toEqual([]);
      expect(existsSync(join(dir, "sessions"))).toBe(false);
      expect(run.model.requests).toEqual([]);
    }
  });
  it("lets no model direct the work but the one the charter names", async () => {
    const named = new ScriptedModel({ researcher: firstOpen });
    const other = new ScriptedModel({ researcher: firstOpen, model: "another-model" });
    const charter = charterFor(named);
    const budgets = budgetsWithin(charter.ceilings, {});
    if (!budgets.ok) throw new Error("budgets");
    const dir = join(root, "other-model");
    const summary = await runSession({
      mode: "live",
      charter,
      authorization: authorize(charter),
      budgets: budgets.value,
      model: other,
      store: new ResearchStore(dir),
      runtime: await runtimeFor(dir),
      operator: "R.A.I.N.Operator",
    });
    expect([summary.started, summary.stop_reason]).toEqual([false, "not_authorized"]);
    expect(summary.detail).toMatch(/names scripted-model .* not another-model/);
    expect(other.requests).toEqual([]);
    expect(existsSync(join(dir, "sessions"))).toBe(false);
  });
  it("stops when the model server does not answer, or does not serve the model", async () => {
    const down = await session({
      dir: join(root, "down"),
      researcher: firstOpen,
      model: {
        listed: new ModelFailure(
          "unavailable",
          "nothing answered at http://127.0.0.1:11434",
        ),
      },
    });
    expect(down.summary.stop_reason).toBe("model_unavailable");
    expect(kinds(down.entries)).toEqual([
      "session-started",
      "model-check",
      "session-ended",
    ]);
    const missing = await session({
      dir: join(root, "missing"),
      researcher: firstOpen,
      model: { listed: ["llama3.2:latest"] },
    });
    expect(missing.summary.stop_reason).toBe("model_unavailable");
    expect(missing.summary.detail).toMatch(/llama3\.2:latest, not scripted-model/);
    const silent = await session({
      dir: join(root, "silent"),
      researcher: () => new ModelFailure("timeout", "no answer within 120 s"),
    });
    expect(silent.summary.stop_reason).toBe("model_unavailable");
    expect(silent.summary.experiments).toEqual([]);
  });
  it("refuses a malformed answer, and stops when it is repeated or the budget is spent", async () => {
    const same = await session({
      dir: join(root, "garbled"),
      researcher: () => "Sure! Let me think.",
    });
    expect(same.summary.stop_reason).toBe("repeated");
    expect(of(same.entries, "refusal")[0]!.reason).toMatch(/not one JSON object/);
    const varied = await session({
      dir: join(root, "varied"),
      researcher: (_p, call) => ({
        ...proposal("X1-increase-primary"),
        action: `do_${call}`,
      }),
    });
    expect(varied.summary.stop_reason).toBe("failed_proposals");
    expect(varied.summary.failed_proposals).toBe(3);
    expect(varied.summary.experiments).toEqual([]);
  });
  it("stops when the researcher stops, or a call or token budget is spent", async () => {
    const stopped = await session({
      dir: join(root, "stopped"),
      researcher: () => stop("[scripted] nothing listed would tell me anything new"),
    });
    expect(stopped.summary.stop_reason).toBe("researcher");
    expect(stopped.summary.detail).toMatch(/nothing listed/);
    const calls = await session({
      dir: join(root, "calls"),
      researcher: () => inspectDesign("X1-increase-primary"),
      budgets: { model_calls: 1 },
    });
    expect(calls.summary.stop_reason).toBe("model_calls");
    const tokens = await session({
      dir: join(root, "tokens"),
      researcher: firstOpen,
      ceilings: { ...CEILINGS, model_tokens: 10_000 },
      model: { tokens: false },
    });
    expect(tokens.summary.stop_reason).toBe("model_tokens");
    expect(tokens.summary.tokens).toBeNull();
    expect(tokens.summary.detail).toMatch(/cannot be enforced/);
  });
  it("runs nothing unregistered: a refused pre-registration is a sealed rejection, and the seeds stay fresh", async () => {
    const dir = join(root, "unregistered");
    const run = await session({
      dir,
      researcher: firstOpen,
      runtime: (real) => ({
        ...real,
        identity: () => real.identity(),
        preregister: () => {
          throw new Error("the registry is not available: test");
        },
        submission: (...args) => real.submission(...args),
      }),
    });
    expect(run.summary.stop_reason).toBe("registry");
    expect(kinds(run.entries)).not.toContain("execution");
    const record = readRecord(dir, of(run.entries, "record")[0]!.path);
    expect(record.outcome.state).toBe("REJECTED");
    expect(record.run).toBeNull();
    expect(record.lifecycle.at(-1)!.detail).toMatch(/did not pre-register/);
    const store = new ResearchStore(dir);
    const state = deriveState(store.records(), store.traces().entries);
    expect(state.experiments).toEqual([]);
    expect(state.measured).toEqual({});
  });
  it(
    "records a run the runtime budget cut short as FAILED, reports it as an error, and stops",
    async () => {
      let spent = false;
      const dir = join(root, "cut-short");
      const run = await session({
        dir,
        researcher: firstOpen,
        monotonic: () => (spent ? 1e12 : 0),
        onEntry: (e) => {
          if (e.kind === "preregistration") spent = true;
        },
      });
      expect(run.summary.stop_reason).toBe("runtime");
      const execution = of(run.entries, "execution")[0]!;
      expect([execution.state, execution.verdict]).toEqual(["FAILED", "not_evaluated"]);
      expect(of(run.entries, "submission")[0]!.status).toBe("error");
      expect(kinds(run.entries)).not.toContain("analysis");
      const record = readRecord(dir, of(run.entries, "record")[0]!.path);
      expect(record.error?.message).toMatch(/runtime budget ran out/);
    },
    LONG,
  );
});

describe("the research state is derived, and contradictions are kept", () => {
  const fake = (design: string, verdict: string): StoredRecord => ({
    path: `records/${design}.json`,
    digestOK: true,
    problem: null,
    record: {
      run_id: `BX-${design}`,
      experiment_id: `BX-${design}`,
      definition: { primary_metric: "leaving" },
      outcome: {
        state: "COMPLETED",
        verdict,
        rain_status: "passed",
        summary: "",
        unresolved: [],
      },
      run: { measurements: {}, per_seed: [] },
      rain_admission: null,
      record_sha256: "0".repeat(64),
      standing: {
        admission: {
          design_id: design,
          session_id: "RS-x",
          iteration: 1,
          decision_id: "d1",
        },
      },
    } as unknown as ExperimentRecord,
  });
  it("marks a hypothesis contested when its seed panels disagree, keeping both runs", () => {
    const state = deriveState(
      [
        fake("X2-increase-primary", "supported"),
        fake("X2-increase-replication", "not_supported"),
      ],
      [],
    );
    const h = state.hypotheses.find((x) => x.id === "X2-increase")!;
    expect(h.status).toBe("contested");
    expect(h.runs).toHaveLength(2);
    expect(state.measured).toEqual({
      "X2:primary": "X2-increase-primary",
      "X2:replication": "X2-increase-replication",
    });
  });
  it("reads every verdict the criteria give: insufficient evidence is inconclusive, a failed run is not evaluated", () => {
    const state = deriveState(
      [
        fake("X4-increase-primary", "insufficient_evidence"),
        fake("X5-increase-primary", "not_evaluated"),
        fake("X6-increase-primary", "supported"),
        fake("X6-increase-replication", "insufficient_evidence"),
      ],
      [],
    );
    const status = (id: string) => state.hypotheses.find((x) => x.id === id)!.status;
    expect(status("X4-increase")).toBe("inconclusive");
    expect(status("X5-increase")).toBe("not_evaluated");
    expect(status("X6-increase")).toBe("inconclusive");
  });
  it("leaves out a record this loop did not make", () => {
    const foreign = fake("X3-increase-primary", "supported");
    (foreign.record as { standing: unknown }).standing = null;
    const state = deriveState([foreign], []);
    expect(state.experiments).toEqual([]);
    expect(state.warnings.join()).toMatch(/not admitted under a standing authority/);
  });
});

describe("the store keeps to its directory", () => {
  it("refuses any path that would leave the research directory", () => {
    const store = new ResearchStore(join(root, "confined"));
    expect(() =>
      store.saveAuthorization({
        charter_sha256: "/../../../../../tmp/escape",
        authorization_sha256: "0".repeat(64),
      } as CharterAuthorization),
    ).toThrow(StoreError);
    expect(() => store.openSession("../../escape")).toThrow(/malformed session id/);
  });
});
