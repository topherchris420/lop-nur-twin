/**
 * The lab's discrete state and every action a person can take in it.
 *
 * React reads it through `useSyncExternalStore`; nothing here runs on the
 * frame loop. The live city is held read-only — the store never steps,
 * pauses, injects into, moves or refocuses it; experiments run on their own
 * simulators in a worker — so leaving the lab finds Bethesda exactly where
 * its own rules took it.
 */
import { SIM_VERSION, type CitySimulation } from "../simulation";
import {
  LIMITS,
  RECORD_SCHEMA,
  type DecisionAttempt,
  type MeetingRecord,
  type RuntimeMode,
} from "./contracts";
import { RainClient, hex, type MeetingProgress, type RuntimeStatus } from "./client";
import { demoMeeting, demoProposalInput } from "./demo";
import {
  approve,
  attachAdmission,
  begin,
  complete,
  decline,
  expireIfStale,
  fail,
  openCase,
  type ExperimentCase,
  type Origin,
} from "./cases";
import { OPTIONS, ESCALATE, proposalFrom } from "./session";
import { runExperiment, type Progress, type RunResult } from "./runner";
import { verifyRecord, type Verification } from "./replay";
import { recordDigestOK, type ExperimentRecord } from "./record";
import { rainDefinitionDraft, rainSubmission } from "./submission";
import { ROOMS, type RoomId } from "./labLayout";
import type { WorkerRequest } from "./experimentWorker";
import {
  MAX_OUTINGS,
  observeIfArrived,
  planOuting,
  positionAt,
  type AvatarObservation,
  type Outing,
  type PresenceMark,
} from "./presence";
import { runTool, type ToolResult } from "./tools";
import type { LocationId, Perspective } from "./contracts";

export interface Handoff {
  at: string;
  decisionId: string;
  question: string;
  destination: string;
  reason: string | null;
  attempts: DecisionAttempt[];
}
/** How the lab names R.A.I.N.'s engines: `typesafe` is TypeSafe's Jev. */
export const engineName = (engine: DecisionAttempt["engine"]) =>
  engine === "typesafe" ? "Jev" : "Laya";
/**
 * What an engine chose in a handed-off decision, if it chose an experiment:
 * the last attempt with a selection that is one of the host's experiment
 * options. "No experiment" is not a suggestion.
 */
export function suggestion(h: Handoff) {
  const a = [...h.attempts]
    .reverse()
    .find((x) => x.selected !== null && x.selected !== ESCALATE);
  if (!a || a.selected === null) return null;
  const p = a.probabilities.find(([id]) => id === a.selected)?.[1] ?? null;
  return { engine: a.engine, model: a.model, selected: a.selected, p, reason: a.reason };
}
export interface MeetingState {
  record: MeetingRecord;
  source: "LIVE" | "DEMO";
  revealed: number;
}
export interface RunState {
  caseId: string;
  started: Date;
  progress: Progress | null;
  /** Packets as they arrive, for the Observation Room's charts. */
  series: { arm: string; seed: number; tick: number; value: number | null }[];
}
const STORAGE_KEY = "lop-nur:rain-lab:registry/v1";
const STORED_RECORDS = 24;
/** Imports awaiting or failing replay; a quarantine is not a second registry. */
const QUARANTINED = 8;
const REVEAL_MS = 2600;

const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

type Job =
  | { kind: "run"; onProgress: (p: Progress) => void; done: (r: RunResult) => void }
  | { kind: "verify"; done: (v: Verification) => void };

/** One worker per job; a main-thread, time-sliced fallback drives the same generators. */
function startJob(request: WorkerRequest, job: Job, onError: (e: Error) => void) {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("./experimentWorker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    worker = null;
  }
  if (worker) {
    const w = worker;
    w.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      const m = event.data;
      if (m.type === "progress" && job.kind === "run")
        job.onProgress(m.progress as Progress);
      else if (m.type === "done" && job.kind === "run") {
        job.done(m.result as RunResult);
        w.terminate();
      } else if (m.type === "verified" && job.kind === "verify") {
        job.done(m.verification as Verification);
        w.terminate();
      } else if (m.type === "error") {
        const reasons = m.refused as string[] | null;
        onError(
          new Error(reasons ? "Run refused: " + reasons.join("; ") : String(m.message)),
        );
        w.terminate();
      }
    };
    w.onerror = () => {
      onError(new Error("the experiment worker stopped"));
      w.terminate();
    };
    w.postMessage(request);
    return () => w.terminate();
  }
  // No worker: drive the generator in slices so the page stays responsive.
  let cancelled = false;
  const steps: Generator<unknown, unknown> =
    request.type === "run"
      ? runExperiment(
          request.definition,
          request.definitionSha256,
          request.experimentId,
          request.authorization,
        )
      : verifyRecord(request.record);
  const slice = () => {
    if (cancelled) return;
    const until = performance.now() + 10;
    try {
      while (performance.now() < until) {
        const next = steps.next();
        if (next.done) {
          if (job.kind === "run") job.done(next.value as RunResult);
          else job.done(next.value as Verification);
          return;
        }
        if (job.kind === "run") job.onProgress(next.value as Progress);
      }
      setTimeout(slice, 0);
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)));
    }
  };
  setTimeout(slice, 0);
  return () => {
    cancelled = true;
  };
}

export class LabStore {
  private readonly listeners = new Set<() => void>();
  version = 0;
  readonly client: RainClient;
  /** The live city, read-only. Re-attached when the city is reset or replaced by a replay. */
  sim: CitySimulation;
  room: RoomId = "threshold";
  hint: string = ROOMS.threshold.hint;
  runtime: { status: RuntimeStatus | null; checking: boolean; error: string | null } = {
    status: null,
    checking: false,
    error: null,
  };
  meeting: MeetingState | null = null;
  note = "";
  asking = false;
  proposalNote = "";
  cases: ExperimentCase[] = [];
  focusCase: string | null = null;
  run: RunState | null = null;
  records: ExperimentRecord[] = [];
  /**
   * Imported records, held apart until replay re-simulates every arm. A digest
   * only shows a record was not changed after it was sealed, and anyone can
   * seal one: until replay passes, an import is not in the registry, the
   * Evidence Library or the tools, and one that fails stays here. An import is
   * never stored.
   *
   * Records this browser kept from earlier visits wait here too. Storage is
   * writable by anything on this origin, and a record sealed under another
   * revision of the simulator no longer describes this one, so a stored copy
   * re-joins the registry only when replay passes again; until then it stays
   * stored, so a visit cannot lose it.
   */
  quarantine: ExperimentRecord[] = [];
  /** Run ids in the quarantine that came from this browser's storage, not an import. */
  private readonly restored = new Set<string>();
  verifications: Record<string, Verification | "running"> = {};
  registryNote = "";
  /**
   * R.A.I.N. answers that proposed nothing, kept visible — with every engine
   * R.A.I.N. consulted on the way, and what each chose, as it returned them.
   */
  handoffs: Handoff[] = [];
  /** A model meeting R.A.I.N. is running: progress, never words. */
  meetingProgress: MeetingProgress | null = null;
  /** How often a running model meeting is checked on. */
  pollMs = 3000;
  private askAbort: AbortController | null = null;
  /** Perspectives walking the city, and what the simulator observed for them. */
  outings: Outing[] = [];
  avatarObservations: AvatarObservation[] = [];
  presenceNote = "";
  /** Direct, read-only tool inspections from the Observation Room. */
  toolResults: ToolResult[] = [];
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private snapshot: { tick: number; outings: Outing[]; marks: PresenceMark[] } | null =
    null;
  private revealTimer: ReturnType<typeof setInterval> | null = null;
  private cancelRun: (() => void) | null = null;

  constructor(sim: CitySimulation, fetchImpl?: typeof fetch) {
    this.sim = sim;
    this.client = new RainClient(fetchImpl);
    const stored = this.loadRecords();
    if (stored.length) {
      this.quarantine = stored;
      for (const r of stored) this.restored.add(r.run_id);
      this.registryNote = `${stored.length} record${stored.length === 1 ? "" : "s"} kept in this browser ${stored.length === 1 ? "is" : "are"} held until replay re-verifies ${stored.length === 1 ? "it" : "them"}, one at a time; a stored copy is not evidence until it re-simulates.`;
      this.verifyNextRestored();
    }
  }
  /** Whether a held record came from this browser's storage rather than an import. */
  heldFrom(runId: string): "storage" | "import" {
    return this.restored.has(runId) ? "storage" : "import";
  }
  /** Stored records are re-verified one at a time, so a visit does not start a worker per record. */
  private verifyNextRestored() {
    const next = this.quarantine.find(
      (r) => this.restored.has(r.run_id) && this.verifications[r.run_id] === undefined,
    );
    if (next) this.verify(next.run_id);
  }

  attach(sim: CitySimulation) {
    if (sim === this.sim) return;
    this.sim = sim;
    // An outing walks one city's clock. A replaced city ends it; what the
    // simulator observed before then is kept, with the world hash it names.
    if (this.outings.length) {
      this.outings = [];
      this.presenceNote =
        "The city was replaced, so the walks in it ended. Observations made before then are kept.";
    }
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
    this.snapshot = null;
    this.emit();
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  setFocusCase(id: string) {
    this.focusCase = id;
    this.emit();
  }
  say(where: "registry" | "proposal" | "meeting", text: string) {
    if (where === "registry") this.registryNote = text;
    else if (where === "proposal") this.proposalNote = text;
    else this.note = text;
    this.emit();
  }

  // --- The runtime ------------------------------------------------------------
  mode(): RuntimeMode {
    const s = this.runtime.status;
    return s?.configured && s.reachable && s.identity ? "LIVE" : "OFFLINE";
  }
  async checkRuntime() {
    this.runtime = { ...this.runtime, checking: true };
    this.emit();
    const r = await this.client.status();
    this.runtime = r.ok
      ? { status: r.value, checking: false, error: null }
      : { status: null, checking: false, error: `${r.failure} · ${r.detail}` };
    this.emit();
  }

  // --- Rooms --------------------------------------------------------------------
  enterRoom(room: RoomId) {
    if (room === this.room) return;
    this.room = room;
    this.hint = ROOMS[room].hint;
    this.emit();
  }

  // --- The Research Panel --------------------------------------------------------
  async ask(question: string) {
    if (this.asking) return;
    if (this.mode() !== "LIVE") {
      this.note =
        "The research runtime is unavailable (OFFLINE). Nothing was sent and no meeting was produced. You can replay the recorded DEMO meeting instead; it is labelled as a recording.";
      this.emit();
      return;
    }
    this.asking = true;
    this.note = "Asking R.A.I.N.… nothing is shown until a validated answer arrives.";
    this.emit();
    const stop = new AbortController();
    this.askAbort = stop;
    const r = await this.client.meeting(question, {
      signal: stop.signal,
      pollMs: this.pollMs,
      onProgress: (p) => {
        this.meetingProgress = p;
        const minutes = Math.floor(p.elapsedS / 60),
          seconds = Math.round(p.elapsedS % 60);
        this.note = `R.A.I.N.'s meeting is running on ${p.model}: ${p.turnsStarted} of ${p.turnsPlanned} turns started, ${minutes ? `${minutes} min ` : ""}${seconds} s so far. Its words arrive, checked, when it ends; nothing is shown before.`;
        this.emit();
      },
    });
    this.asking = false;
    this.askAbort = null;
    this.meetingProgress = null;
    if (!r.ok) {
      this.note =
        `LIVE request failed: ${r.failure} — ${r.detail}. Nothing is shown in its place.` +
        (this.meeting
          ? ` The meeting below is the earlier ${this.meeting.source} one, for the question it names.`
          : "");
      this.emit();
      return;
    }
    this.startMeeting(r.value, "LIVE");
  }
  /** Stop the meeting being waited on. R.A.I.N. is asked to stop it; nothing is kept. */
  stopAsking() {
    this.askAbort?.abort();
  }
  playDemo() {
    const d = demoMeeting();
    if (!d.ok) {
      this.note = "The DEMO recording failed validation and is not shown: " + d.errors[0];
      this.emit();
      return;
    }
    this.startMeeting(d.value, "DEMO");
  }
  private startMeeting(record: MeetingRecord, source: "LIVE" | "DEMO") {
    if (this.revealTimer) clearInterval(this.revealTimer);
    this.meeting = {
      record,
      source,
      revealed: reducedMotion() ? record.turns.length : 1,
    };
    this.note =
      source === "DEMO"
        ? "PRERECORDED · DEMO: a recording of R.A.I.N.'s offline engine. No process is running and your question was not sent anywhere."
        : `LIVE · ${record.generation === "scripted" ? "R.A.I.N.'s offline engine answered; its reasoning text is scripted and no model ran" : `generated by ${record.model}`}.`;
    if (this.meeting.revealed < record.turns.length)
      this.revealTimer = setInterval(() => {
        if (!this.meeting || this.meeting.revealed >= this.meeting.record.turns.length) {
          if (this.revealTimer) clearInterval(this.revealTimer);
          this.revealTimer = null;
          return;
        }
        this.meeting = { ...this.meeting, revealed: this.meeting.revealed + 1 };
        this.emit();
      }, REVEAL_MS);
    this.emit();
  }
  revealAll() {
    if (!this.meeting) return;
    if (this.revealTimer) clearInterval(this.revealTimer);
    this.revealTimer = null;
    this.meeting = { ...this.meeting, revealed: this.meeting.record.turns.length };
    this.emit();
  }

  // --- Proposals ---------------------------------------------------------------------
  private origin(): Origin {
    const live = this.mode() === "LIVE" ? this.runtime.status?.identity : null;
    if (live) return { rain: live.rain, rainSource: "live-identity", model: null };
    if (this.meeting?.source === "DEMO")
      return {
        rain: this.meeting.record.rain,
        rainSource: "demo-recording",
        model: null,
      };
    return { rain: null, rainSource: "unavailable", model: null };
  }
  private open(raw: unknown, origin: Origin, reproduces: ExperimentRecord | null = null) {
    const c = openCase(raw, { id: hex(8), now: new Date(), origin, reproduces });
    this.cases = [c, ...this.cases].slice(0, 32);
    this.focusCase = c.id;
    if (c.record) this.addRecord(c.record);
    this.emit();
    return c;
  }
  proposeDemo() {
    const demo = demoMeeting();
    this.open(demoProposalInput(), {
      rain: demo.ok ? demo.value.rain : null,
      rainSource: demo.ok ? "demo-recording" : "unavailable",
      model: null,
    });
    this.proposalNote =
      "Loaded the DEMO's scripted proposal. It was written by hand for the demo; no model or R.A.I.N. process produced it.";
    this.emit();
  }
  /**
   * Propose, as a person, the option an engine chose in a handed-off decision.
   * The proposal is the person's (origin "human"); R.A.I.N. made no proposal,
   * and the handoff it recorded stays beside it.
   */
  adoptSuggestion(decisionId: string) {
    const h = this.handoffs.find((x) => x.decisionId === decisionId);
    const pick = h ? suggestion(h) : null;
    if (!h || !pick) return;
    this.proposeOption(pick.selected, h.question);
    this.proposalNote = `You proposed ${pick.selected}, which ${engineName(pick.engine)} chose and R.A.I.N. handed back (decision ${h.decisionId.slice(0, 8)}…). The proposal is yours; it needs validation and your approval.`;
    this.emit();
  }
  proposeOption(optionId: string, question: string) {
    const p = proposalFrom(optionId, {
      question,
      meetingId: this.meeting?.record.meeting_id ?? null,
      origin: "human",
      decision: null,
    });
    if (!p) return;
    this.open(p, this.origin());
    this.proposalNote =
      "You proposed this experiment. It now needs validation and your approval.";
    this.emit();
  }
  /**
   * A person's own proposal, from the Bay's form. It is theirs: it may not
   * claim to be R.A.I.N.'s or the DEMO's, so a record can never name a
   * R.A.I.N. decision that R.A.I.N. did not make. R.A.I.N.'s proposals come
   * only from `askRainForProposal`, the fixture only from `proposeDemo`.
   */
  proposeByHand(raw: unknown) {
    const claims =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    if (claims && (claims.origin !== "human" || claims.rain_decision != null)) {
      this.proposalNote =
        'A proposal written here is a person\'s: its origin must be "human" and it can claim no R.A.I.N. decision. Nothing was proposed.';
      this.emit();
      return;
    }
    const c = this.open(raw, this.origin());
    this.proposalNote =
      c.lifecycle.state === "REJECTED"
        ? "Rejected by deterministic validation. The record stays in the Registry."
        : "Proposal validated. It needs your approval before anything runs.";
    this.emit();
  }
  async askRainForProposal(question: string) {
    if (this.mode() !== "LIVE") {
      this.proposalNote = "R.A.I.N. is OFFLINE: no proposal was requested.";
      this.emit();
      return;
    }
    this.proposalNote = "Offering R.A.I.N. the supported experiments…";
    this.emit();
    const r = await this.client.proposal(
      question,
      OPTIONS.map(({ id, description }) => ({ id, description })),
    );
    if (!r.ok) {
      this.proposalNote = `R.A.I.N. proposal request failed: ${r.failure} — ${r.detail}. Nothing was proposed.`;
      this.emit();
      return;
    }
    const d = r.value.decision;
    if (d.destination !== "proposal" || !d.selected || d.selected === ESCALATE) {
      const handoff: Handoff = {
        at: new Date().toISOString(),
        decisionId: d.decision_id,
        question,
        destination: d.destination,
        reason: d.reason,
        attempts: d.attempts,
      };
      this.handoffs = [handoff, ...this.handoffs].slice(0, 20);
      const pick = suggestion(handoff);
      this.proposalNote =
        `R.A.I.N. made no proposal (${d.destination}${d.reason ? " · " + d.reason : ""}).` +
        (pick
          ? ` It consulted ${engineName(pick.engine)}${pick.model ? ` (${pick.model})` : ""}, which chose ${pick.selected}${pick.p !== null ? ` at ${pick.p}` : ""}; R.A.I.N. did not act on that answer (${pick.reason ?? "not acted on"}). You may propose it yourself.`
          : " A person may choose an experiment instead.");
      this.emit();
      return;
    }
    const p = proposalFrom(d.selected, {
      question,
      meetingId: this.meeting?.record.meeting_id ?? null,
      origin: "rain",
      decision: { decision_id: d.decision_id, envelope_hash: d.envelope_hash },
    });
    if (!p) return;
    this.open(p, this.origin());
    this.proposalNote = `R.A.I.N.'s router chose option ${d.selected}. It is a proposal: it needs validation and your approval.`;
    this.emit();
  }

  // --- Authority -----------------------------------------------------------------------
  caseById(id: string | null) {
    return this.cases.find((c) => c.id === id) ?? null;
  }
  approve(
    id: string,
    input: { operator: string; typedPrefix: string; reviewed: boolean },
  ) {
    const c = this.caseById(id);
    if (!c) return ["no such case"];
    const r = approve(c, { ...input, now: new Date() });
    if (c.record) this.addRecord(c.record);
    this.emit();
    return r.ok ? [] : r.errors;
  }
  decline(id: string) {
    const c = this.caseById(id);
    if (c && decline(c, "the operator declined", new Date()) && c.record)
      this.addRecord(c.record);
    this.emit();
  }
  /** Stale R.A.I.N. proposals are rejected, visibly, the next time anyone looks. */
  sweepStale() {
    let changed = false;
    for (const c of this.cases)
      if (expireIfStale(c, new Date()) && c.record) {
        this.addRecord(c.record);
        changed = true;
      }
    if (changed) this.emit();
  }

  // --- Running ---------------------------------------------------------------------------
  async preregisterAndRun(id: string) {
    const c = this.caseById(id);
    if (!c?.validated || c.lifecycle.state !== "AUTHORIZED") return;
    const identity = this.runtime.status?.identity;
    if (this.mode() !== "LIVE" || !identity?.registry.available) {
      const reason = identity?.registry.reason;
      this.proposalNote = `R.A.I.N.'s registry is not available${reason ? `: ${reason}` : ""}; nothing was pre-registered.`;
      this.emit();
      return;
    }
    const v = c.validated;
    const draft = rainDefinitionDraft(
      v.definition,
      v.experimentId,
      v.definitionSha256,
      c.authorization?.operator ?? "R.A.I.N.Operator",
    );
    this.proposalNote = "Pre-registering with R.A.I.N. before the run…";
    this.emit();
    const r = await this.client.preregister(draft);
    if (!r.ok) {
      this.proposalNote = `R.A.I.N. did not pre-register the experiment: ${r.failure} — ${r.detail}. Nothing ran. You may run it in Bethesda only; the record will say it was not pre-registered.`;
      this.emit();
      return;
    }
    // The record keeps the registry's answer. The certificate stays with the
    // case and goes back with the submission, so whichever instance of the
    // registry admits the run can check it against this definition.
    const { certificate, ...preregistration } = r.value;
    c.preregistration = preregistration;
    c.receipt = { draft, created_at: preregistration.created_at, certificate };
    this.run_(c, true);
  }
  runLocal(id: string) {
    const c = this.caseById(id);
    if (c) this.run_(c, false);
  }
  private run_(c: ExperimentCase, report: boolean) {
    if (this.run) {
      this.proposalNote = "One experiment runs at a time.";
      this.emit();
      return;
    }
    const refused = begin(c, new Date());
    if (refused.length) {
      if (c.record) this.addRecord(c.record);
      this.proposalNote = "The runner refused to start: " + refused.join("; ");
      this.emit();
      return;
    }
    const v = c.validated!;
    const started = new Date();
    this.run = { caseId: c.id, started, progress: null, series: [] };
    this.proposalNote = `RUNNING ${v.experimentId}: ${v.definition.seeds.length * 2} arms on separate simulators. The live city is untouched.`;
    this.emit();
    const metric = v.definition.primary_metric;
    let lastEmit = 0;
    this.cancelRun = startJob(
      {
        type: "run",
        definition: v.definition,
        definitionSha256: v.definitionSha256,
        experimentId: v.experimentId,
        authorization: c.authorization,
      },
      {
        kind: "run",
        onProgress: (p) => {
          if (!this.run) return;
          this.run.progress = p;
          if (p.packet)
            this.run.series.push({
              arm: p.arm,
              seed: p.seed,
              tick: p.packet.tick,
              value: p.packet.metrics[metric],
            });
          const now = performance.now();
          if (now - lastEmit > 250 || p.packet) {
            lastEmit = now;
            this.emit();
          }
        },
        done: (result) => {
          this.cancelRun = null;
          this.run = null;
          const record = complete(c, result, { started, finished: new Date() });
          this.addRecord(record);
          this.proposalNote = `${record.outcome.state}: ${record.outcome.summary}`;
          this.emit();
          if (report) void this.report(c);
        },
      },
      (error) => {
        this.cancelRun = null;
        this.run = null;
        const record = fail(c, error, new Date());
        this.addRecord(record);
        this.proposalNote = "FAILED: the run did not complete — " + error.message;
        this.emit();
      },
    );
  }
  cancelActiveRun() {
    const c = this.caseById(this.run?.caseId ?? null);
    if (!c || !this.cancelRun) return;
    this.cancelRun();
    this.cancelRun = null;
    this.run = null;
    const record = fail(c, new Error("cancelled by the operator"), new Date());
    this.addRecord(record);
    this.proposalNote =
      "FAILED: cancelled by the operator. The record stays in the Registry.";
    this.emit();
  }
  /** Return the measurements to R.A.I.N., which evaluates them itself. */
  async report(c: ExperimentCase) {
    const record = c.record;
    if (!record || !c.preregistration) return;
    const submission = rainSubmission(record, {
      experimentId: c.preregistration.experiment_id,
      experimentVersion: c.preregistration.experiment_version,
    });
    if (!submission.ok) {
      this.registryNote = "No submission was produced: " + submission.errors.join("; ");
      this.emit();
      return;
    }
    this.registryNote = `Reporting ${record.run_id} to R.A.I.N. as ${c.preregistration.experiment_id}…`;
    this.emit();
    const r = await this.client.submit(
      c.preregistration.experiment_id,
      submission.value,
      c.receipt,
    );
    if (!r.ok) {
      this.registryNote = `R.A.I.N. did not admit the run: ${r.failure} — ${r.detail}. Export the admission bundle to admit it later.`;
      this.emit();
      return;
    }
    const updated = attachAdmission(c, r.value);
    if (updated) this.replaceRecord(updated);
    this.registryNote = `R.A.I.N. recorded ${r.value.run_id}: ${r.value.status} (${r.value.hypothesis_verdict.replaceAll("_", " ")}).`;
    this.emit();
  }

  // --- The Registry ---------------------------------------------------------------------------
  private addRecord(record: ExperimentRecord) {
    if (this.records.some((r) => r.run_id === record.run_id))
      return this.replaceRecord(record);
    this.records = [record, ...this.records].slice(0, LIMITS.registryEntries);
    this.saveRecords();
  }
  private replaceRecord(record: ExperimentRecord) {
    this.records = this.records.map((r) => (r.run_id === record.run_id ? record : r));
    this.saveRecords();
  }
  importRecord(text: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.registryNote = "Not JSON; nothing was imported.";
      this.emit();
      return;
    }
    const r = parsed as ExperimentRecord;
    if (!r || r.schema !== RECORD_SCHEMA || !recordDigestOK(r)) {
      this.registryNote = `Not a ${RECORD_SCHEMA} record, or its digest does not match; nothing was imported.`;
      this.emit();
      return;
    }
    // An import never shadows or replaces what the registry holds.
    const held = this.records.find((x) => x.run_id === r.run_id);
    if (held) {
      this.registryNote =
        held.record_sha256 === r.record_sha256
          ? `${r.run_id} is already in the registry; nothing changed.`
          : `The registry already holds a different record numbered ${r.run_id}; nothing was imported.`;
      this.emit();
      return;
    }
    if (this.verifications[r.run_id] === "running") {
      this.registryNote = `A record numbered ${r.run_id} is being verified; nothing was imported. Try again when it finishes.`;
      this.emit();
      return;
    }
    this.quarantine = [r, ...this.quarantine.filter((x) => x.run_id !== r.run_id)].slice(
      0,
      QUARANTINED,
    );
    this.registryNote = `Imported ${r.run_id}. It is quarantined — not in the registry and not evidence — until replay re-simulates every arm.`;
    this.emit();
    this.verify(r.run_id);
  }
  /** Drop a held record that has not joined the registry (and, if it was stored, its stored copy). */
  discardImport(runId: string) {
    if (this.verifications[runId] === "running") return;
    this.quarantine = this.quarantine.filter((x) => x.run_id !== runId);
    if (this.restored.delete(runId)) {
      this.saveRecords();
      this.registryNote = `Discarded ${runId} from this browser.`;
    } else this.registryNote = `Discarded the imported ${runId}.`;
    this.emit();
  }
  verify(runId: string) {
    const record =
      this.records.find((r) => r.run_id === runId) ??
      this.quarantine.find((r) => r.run_id === runId);
    if (!record || this.verifications[runId] === "running") return;
    this.verifications = { ...this.verifications, [runId]: "running" };
    this.emit();
    const settle = (v: Verification) => {
      this.verifications = { ...this.verifications, [runId]: v };
      this.admitImport(record, v);
      this.emit();
      this.verifyNextRestored();
    };
    startJob({ type: "verify", record }, { kind: "verify", done: settle }, (error) =>
      settle({ ok: false, checks: [{ id: "worker", ok: false, detail: error.message }] }),
    );
  }
  /** A held record joins the registry only once replay has verified it. */
  private admitImport(record: ExperimentRecord, v: Verification) {
    if (!this.quarantine.includes(record)) return;
    const stored = this.restored.has(record.run_id);
    if (!v.ok) {
      this.registryNote = stored
        ? `${record.run_id}, kept in this browser, does not re-simulate identically under this simulator (${SIM_VERSION}) and stays held: it is not evidence here. It was recorded by another revision or changed in storage; replay it with the revision that recorded it, or discard it.`
        : `${record.run_id} failed verification by replay and stays quarantined: it is not evidence.`;
      return;
    }
    this.quarantine = this.quarantine.filter((x) => x !== record);
    if (stored) {
      this.restored.delete(record.run_id);
      // Stored newest first and verified in that order: appending keeps the
      // stored order, after anything run during this visit.
      this.records = [...this.records, record].slice(0, LIMITS.registryEntries);
      this.saveRecords();
      this.registryNote = `${record.run_id}, kept in this browser, re-simulated identically and is back in the registry.`;
      return;
    }
    this.addRecord(record);
    this.registryNote = `${record.run_id} was verified by replay — every arm re-simulated identically — and joined the registry.`;
  }
  reproduce(runId: string) {
    const source = this.records.find((r) => r.run_id === runId);
    if (!source?.proposal) return;
    this.open(structuredClone(source.proposal), this.origin(), source);
    this.proposalNote = `Reproduction of ${runId}: the same definition, awaiting a fresh approval.`;
    this.emit();
  }
  private loadRecords(): ExperimentRecord[] {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw) as unknown;
      if (!Array.isArray(list)) return [];
      const seen = new Set<string>();
      return list.filter((r): r is ExperimentRecord => {
        const record = r as ExperimentRecord | null;
        if (
          !record ||
          record.schema !== RECORD_SCHEMA ||
          typeof record.run_id !== "string" ||
          seen.has(record.run_id) ||
          !recordDigestOK(record)
        )
          return false;
        seen.add(record.run_id);
        return true;
      });
    } catch {
      return [];
    }
  }
  private saveRecords() {
    // Stored records still waiting for replay stay stored: a visit that ends
    // before they re-verify must not lose them.
    const waiting = this.quarantine.filter((r) => this.restored.has(r.run_id));
    try {
      globalThis.localStorage?.setItem(
        STORAGE_KEY,
        JSON.stringify([...this.records, ...waiting].slice(0, STORED_RECORDS)),
      );
    } catch {
      this.registryNote =
        "This browser would not store the registry; export records to keep them.";
    }
  }

  // --- Presence in the city ------------------------------------------------------------
  sendOuting(who: Perspective, location: LocationId) {
    const active = this.outings.filter(
      (o) => positionAt(o, this.sim.tick).phase !== "done",
    );
    if (active.length >= MAX_OUTINGS) {
      this.presenceNote = `At most ${MAX_OUTINGS} perspectives walk the city at once.`;
      this.emit();
      return;
    }
    if (active.some((o) => o.who === who)) {
      this.presenceNote = `${who} is already out.`;
      this.emit();
      return;
    }
    const planned = planOuting(who, location, this.sim.tick, hex(6));
    if ("error" in planned) {
      this.presenceNote = planned.error;
      this.emit();
      return;
    }
    this.outings = [planned, ...this.outings].slice(0, 12);
    this.presenceNote = `${who} is walking ${Math.round(planned.length)} m of mapped sidewalk. Nothing is observed until the avatar is inside the place's observation region, and then only by the simulator.`;
    if (!this.presenceTimer)
      this.presenceTimer = setInterval(() => this.tickPresence(), 500);
    this.emit();
  }
  private tickPresence() {
    let changed = false;
    for (const o of this.outings) {
      const had = o.refused;
      const seen = observeIfArrived(o, this.sim, this.records);
      if (seen) {
        this.avatarObservations = [seen, ...this.avatarObservations].slice(0, 40);
        this.presenceNote = `${seen.who} at ${seen.place}: the simulator recorded an observation at tick ${seen.tick}.`;
        changed = true;
      } else if (o.refused && !had) {
        this.presenceNote = `${o.who}: ${o.refused}.`;
        changed = true;
      }
    }
    if (this.outings.every((o) => positionAt(o, this.sim.tick).phase === "done")) {
      if (this.presenceTimer) clearInterval(this.presenceTimer);
      this.presenceTimer = null;
      changed = true;
    }
    // Positions are drawn from the city tick; panels refresh at most twice a second.
    if (changed || this.outings.length) this.emit();
  }
  /**
   * Where the avatars on outings are, for drawing — read every frame by the
   * city and the lab's wall, so it is computed once per city tick. It is a
   * drawing, not evidence of anything.
   */
  presenceSnapshot(): readonly PresenceMark[] {
    const tick = this.sim.tick;
    if (this.snapshot?.tick === tick && this.snapshot.outings === this.outings)
      return this.snapshot.marks;
    const marks: PresenceMark[] = [];
    for (const o of this.outings) {
      const at = positionAt(o, tick);
      if (at.phase !== "done")
        marks.push({ who: o.who, x: at.point.x, z: at.point.z, phase: at.phase });
    }
    this.snapshot = { tick, outings: this.outings, marks };
    return marks;
  }
  /** One read-only inspection through the bounded tools. */
  inspect(request: unknown) {
    const result = runTool(request, {
      sim: this.sim,
      records: this.records,
      observer: null,
    });
    this.toolResults = [result, ...this.toolResults].slice(0, 12);
    this.emit();
    return result;
  }

  /** Leaving Bethesda ends a run in progress, and the record says so. */
  dispose() {
    this.askAbort?.abort();
    if (this.revealTimer) clearInterval(this.revealTimer);
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
    const c = this.caseById(this.run?.caseId ?? null);
    if (c && this.cancelRun) {
      this.cancelRun();
      this.cancelRun = null;
      this.run = null;
      this.addRecord(
        fail(c, new Error("cancelled: the operator left Bethesda"), new Date()),
      );
    }
  }
}
