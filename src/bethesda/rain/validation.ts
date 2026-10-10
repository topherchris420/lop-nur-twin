import { checkParameters, GENERATED_PROPOSAL_SCHEMA } from "./discoveryProtocol.js";
/**
 * Fail-closed validation for everything that crosses the R.A.I.N. boundary.
 *
 * Shared by the browser and the server, which validates every runtime answer
 * before the browser sees it; the browser validates again before anything is
 * displayed. Each validator returns the value only when every field is present,
 * typed, bounded and drawn from its vocabulary, and the object has no field
 * the contract did not declare. Otherwise it returns the reasons. Nothing is
 * coerced, trimmed into shape, defaulted or repaired.
 */
import {
  COMMIT,
  DIRECTIONS,
  EXPERIMENT_BOUNDS,
  EXPERIMENT_PROPOSAL_SCHEMA,
  GENERATIONS,
  HEX32,
  ID,
  LIMITS,
  LOCATION_IDS,
  METRICS,
  METRIC_IDS,
  PERSPECTIVES,
  PROPOSAL_ORIGINS,
  RAIN_BETHESDA_SCHEMA,
  RAIN_DECISION_ENGINES,
  RAIN_DECISION_SCHEMA,
  RAIN_ESCALATION_REASONS,
  RAIN_EXPERIMENT_ID,
  RAIN_PROVIDER_ERRORS,
  REPOSITORY,
  RAIN_RUN_ID,
  RAIN_SESSION_ARTIFACT_SCHEMA,
  SCENARIO_IDS,
  SCENARIO_LOCATIONS,
  SHA256,
  CRITERIA_RULE,
  MODEL_ID,
  UNSAFE_TEXT,
  type Admission,
  type CriterionResult,
  type DecisionAttempt,
  type Evaluation,
  type ExperimentProposal,
  type MeetingFailed,
  type MeetingPending,
  type MeetingRecord,
  type SourceArtifact,
  type PreregistrationAnswer,
  type ProposalChoice,
  type Quote,
  type RainIdentity,
  type RainRevision,
  type Turn,
} from "./contracts.js";
import { parseBasis } from "../../rain/mathematics/contracts.js";

export type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const unsafeText = (s: string) => UNSAFE_TEXT.test(s);
/** Whitespace collapsed exactly as the runtime collapses it (Python's `" ".join(q.split())`). */
export const normalizeQuestion = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");

/** UTF-8 byte length without allocating the encoding. */
export function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** Parse a bounded JSON payload. Oversized or malformed text never reaches a validator. */
export function parseBounded(text: string, maxBytes: number): Checked<unknown> {
  if (utf8Length(text) > maxBytes)
    return { ok: false, errors: [`payload exceeds ${maxBytes} bytes`] };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, errors: ["payload is not JSON"] };
  }
}

class Reader {
  readonly errors: string[] = [];
  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }
  fail(path: string, why: string) {
    this.errors.push(`${this.root}${path ? "." + path : ""}: ${why}`);
  }
  closed(v: Json, path: string, keys: readonly string[]) {
    const allowed = new Set(keys);
    for (const k of Object.keys(v))
      if (!allowed.has(k)) this.fail(path, `unknown field "${k.slice(0, 40)}"`);
    for (const k of keys) if (!(k in v)) this.fail(path, `missing field "${k}"`);
  }
  object(v: unknown, path: string, keys: readonly string[]): Json | null {
    if (!isObject(v)) {
      this.fail(path, "expected an object");
      return null;
    }
    this.closed(v, path, keys);
    return v;
  }
  text(v: unknown, path: string, max: number, min = 0): string {
    if (typeof v !== "string") {
      this.fail(path, "expected text");
      return "";
    }
    if (v.length < min) this.fail(path, "too short");
    if (v.length > max) this.fail(path, `longer than ${max} characters`);
    if (UNSAFE_TEXT.test(v))
      this.fail(path, "contains control or bidirectional characters");
    return v;
  }
  pattern(v: unknown, path: string, re: RegExp): string {
    if (typeof v !== "string" || !re.test(v)) {
      this.fail(path, "malformed identifier");
      return "";
    }
    return v;
  }
  integer(v: unknown, path: string, min: number, max: number): number {
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
      this.fail(path, `expected an integer in [${min}, ${max}]`);
      return 0;
    }
    return v;
  }
  number(v: unknown, path: string, min: number, max: number): number {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
      this.fail(path, `expected a finite number in [${min}, ${max}]`);
      return 0;
    }
    return v;
  }
  boolean(v: unknown, path: string): boolean {
    if (typeof v !== "boolean") this.fail(path, "expected true or false");
    return v === true;
  }
  oneOf<T extends string>(v: unknown, path: string, values: readonly T[]): T {
    if (typeof v !== "string" || !values.includes(v as T)) {
      this.fail(path, "not in the supported vocabulary");
      return values[0]!;
    }
    return v as T;
  }
  array(v: unknown, path: string, max: number): unknown[] {
    if (!Array.isArray(v)) {
      this.fail(path, "expected a list");
      return [];
    }
    if (v.length > max) this.fail(path, `more than ${max} items`);
    return v.slice(0, max);
  }
  timestamp(v: unknown, path: string): string {
    const s = this.text(v, path, 40, 20);
    if (s && (!/^\d{4}-\d{2}-\d{2}T/.test(s) || Number.isNaN(Date.parse(s))))
      this.fail(path, "not an ISO-8601 timestamp");
    return s;
  }
  done<T>(value: T): Checked<T> {
    return this.errors.length
      ? { ok: false, errors: this.errors.slice(0, 20) }
      : { ok: true, value };
  }
}

/** Corpus-relative, no traversal, no scheme: a path is shown, never followed. */
const SOURCE_PATH =
  /^(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$))(?![A-Za-z][A-Za-z0-9+.-]*:)[^\0]+$/;

function revision(r: Reader, v: unknown, path: string): RainRevision {
  const o = r.object(v, path, ["repository", "commit", "dirty"]);
  if (!o) return { repository: "", commit: null, dirty: null };
  const repository = r.pattern(o.repository, path + ".repository", REPOSITORY);
  const commit = o.commit === null ? null : r.pattern(o.commit, path + ".commit", COMMIT);
  const dirty = o.dirty === null ? null : r.boolean(o.dirty, path + ".dirty");
  return { repository, commit, dirty };
}

function quote(r: Reader, v: unknown, path: string): Quote {
  const o = r.object(v, path, [
    "source",
    "line",
    "span_start",
    "span_end",
    "text",
    "verified",
  ]);
  if (!o)
    return { source: "", line: 1, span_start: 0, span_end: 0, text: "", verified: false };
  const source = r.text(o.source, path + ".source", LIMITS.sourcePath, 1);
  if (source && !SOURCE_PATH.test(source))
    r.fail(path + ".source", "not a corpus-relative path");
  const q: Quote = {
    source,
    line: r.integer(o.line, path + ".line", 1, 10_000_000),
    span_start: r.integer(o.span_start, path + ".span_start", 0, 100_000_000),
    span_end: r.integer(o.span_end, path + ".span_end", 0, 100_000_000),
    text: r.text(o.text, path + ".text", LIMITS.quoteText, 1),
    verified: r.boolean(o.verified, path + ".verified"),
  };
  if (q.verified && q.span_end <= q.span_start)
    r.fail(path, "a verified quote needs a non-empty span");
  return q;
}

function turn(r: Reader, v: unknown, path: string): Turn {
  const o = r.object(v, path, [
    "index",
    "speaker",
    "role",
    "move",
    "lead",
    "quotes",
    "coda",
    "unverified",
    "generation",
  ]);
  const empty: Turn = {
    index: 1,
    speaker: "James",
    role: "",
    move: "",
    lead: "",
    quotes: [],
    coda: "",
    unverified: 0,
    generation: "scripted",
  };
  if (!o) return empty;
  return {
    index: r.integer(o.index, path + ".index", 1, LIMITS.turns),
    speaker: r.oneOf(o.speaker, path + ".speaker", PERSPECTIVES),
    role: r.text(o.role, path + ".role", 80, 1),
    move: r.text(o.move, path + ".move", 40, 1),
    lead: r.text(o.lead, path + ".lead", LIMITS.turnText),
    quotes: r
      .array(o.quotes, path + ".quotes", LIMITS.quotesPerTurn)
      .map((q, i) => quote(r, q, `${path}.quotes[${i}]`)),
    coda: r.text(o.coda, path + ".coda", LIMITS.turnText),
    unverified: r.integer(o.unverified, path + ".unverified", 0, 100),
    generation: r.oneOf(o.generation, path + ".generation", GENERATIONS),
  };
}

function sourceArtifact(r: Reader, v: unknown, path: string): SourceArtifact {
  const o = r.object(v, path, ["schema", "session_id", "status", "sha256"]);
  if (o && o.schema !== RAIN_SESSION_ARTIFACT_SCHEMA)
    r.fail(path + ".schema", "not R.A.I.N.'s session artifact");
  return {
    schema: RAIN_SESSION_ARTIFACT_SCHEMA,
    session_id: r.pattern(o?.session_id, path + ".session_id", /^[A-Za-z0-9_-]{4,64}$/),
    // R.A.I.N. finalizes a meeting it ran to its end as "completed"; a
    // founder who stopped it makes it "interrupted". Nothing else is a result.
    status: r.oneOf(o?.status, path + ".status", ["completed", "interrupted"] as const),
    sha256: r.pattern(o?.sha256, path + ".sha256", SHA256),
  };
}

const terms = (r: Reader, v: unknown, path: string, max: number, len = 80) =>
  r.array(v, path, max).map((t, i) => r.text(t, `${path}[${i}]`, len, 1));

/**
 * A meeting, as R.A.I.N. produced it. `expected` binds it to the request that
 * asked for it: an answer to a different, older or invented request is stale.
 */
export function validateMeeting(
  v: unknown,
  expected?: { requestId: string; question: string },
): Checked<MeetingRecord> {
  const r = new Reader("meeting");
  const o = r.object(v, "", [
    "schema",
    "kind",
    "request_id",
    "meeting_id",
    "question",
    "generation",
    "engine",
    "model",
    "grounding",
    "matched_terms",
    "missing_terms",
    "turns",
    "verdict",
    "audit",
    "suggestions",
    "rain",
    "produced_at",
    "source_artifact",
  ]);
  if (!o) return r.done(null as never);
  if (o.schema !== RAIN_BETHESDA_SCHEMA) r.fail("schema", "unsupported schema");
  if (o.kind !== "meeting") r.fail("kind", "not a meeting");
  const generation = r.oneOf(o.generation, "generation", GENERATIONS);
  const model = o.model === null ? null : r.pattern(o.model, "model", MODEL_ID);
  if (generation === "model" && model === null)
    r.fail("model", "a model-generated meeting must name its model");
  if (generation === "scripted" && model !== null)
    r.fail("model", "a scripted meeting cannot name a model");
  // The offline engine always grades its corpus and states where the room
  // stands; a model meeting computes neither, and must not pretend to.
  const analysed = generation === "scripted";
  for (const k of ["grounding", "matched_terms", "missing_terms", "verdict"] as const)
    if (analysed && o[k] === null)
      r.fail(k, "an offline-engine meeting always carries it");
    else if (!analysed && o[k] !== null)
      r.fail(
        k,
        "R.A.I.N.'s model meeting computes no such analysis, so it cannot carry one",
      );
  const verdict =
    o.verdict === null
      ? null
      : r.object(o.verdict, "verdict", ["agreed", "contested", "next_move", "read_next"]);
  const audit = r.object(o.audit, "audit", [
    "checked",
    "verified",
    "corpus_files",
    "corpus_sha256",
  ]);
  const record: MeetingRecord = {
    schema: RAIN_BETHESDA_SCHEMA,
    kind: "meeting",
    request_id: r.pattern(o.request_id, "request_id", HEX32),
    meeting_id: r.pattern(o.meeting_id, "meeting_id", ID),
    question: r.text(o.question, "question", LIMITS.question, 1),
    generation,
    engine: r.text(o.engine, "engine", 120, 1),
    model,
    grounding:
      o.grounding === null
        ? null
        : r.oneOf(o.grounding, "grounding", ["strong", "partial", "none"] as const),
    matched_terms:
      o.matched_terms === null
        ? null
        : terms(r, o.matched_terms, "matched_terms", LIMITS.terms),
    missing_terms:
      o.missing_terms === null
        ? null
        : terms(r, o.missing_terms, "missing_terms", LIMITS.terms),
    turns: r
      .array(o.turns, "turns", LIMITS.turns)
      .map((t, i) => turn(r, t, `turns[${i}]`)),
    verdict:
      o.verdict === null
        ? null
        : {
            agreed: r.text(verdict?.agreed, "verdict.agreed", LIMITS.turnText),
            contested: r.text(verdict?.contested, "verdict.contested", LIMITS.turnText),
            next_move: r.text(verdict?.next_move, "verdict.next_move", LIMITS.turnText),
            read_next: terms(
              r,
              verdict?.read_next,
              "verdict.read_next",
              LIMITS.readNext,
              320,
            ),
          },
    audit: {
      checked: r.integer(audit?.checked, "audit.checked", 0, 1000),
      verified: r.integer(audit?.verified, "audit.verified", 0, 1000),
      corpus_files: r.integer(audit?.corpus_files, "audit.corpus_files", 0, 100_000),
      corpus_sha256: r.pattern(audit?.corpus_sha256, "audit.corpus_sha256", SHA256),
    },
    suggestions: terms(r, o.suggestions, "suggestions", LIMITS.suggestions, 300),
    rain: revision(r, o.rain, "rain"),
    produced_at: r.timestamp(o.produced_at, "produced_at"),
    source_artifact:
      o.source_artifact === null
        ? null
        : sourceArtifact(r, o.source_artifact, "source_artifact"),
  };
  if (!record.turns.length) r.fail("turns", "a meeting has at least one turn");
  // Who wrote what is part of the record, and has to add up.
  if (analysed && record.turns.some((t) => t.generation !== "scripted"))
    r.fail("turns", "an offline-engine meeting has no model-written turn");
  if (analysed && record.source_artifact !== null)
    r.fail("source_artifact", "the offline engine keeps no session artifact");
  if (generation === "model" && !record.turns.some((t) => t.generation === "model"))
    r.fail("turns", "a model meeting has at least one model-written turn");
  if (generation === "model" && record.source_artifact === null)
    r.fail("source_artifact", "a model meeting names R.A.I.N.'s own record of it");
  record.turns.forEach((t, i) => {
    if (t.index !== i + 1) r.fail(`turns[${i}].index`, "turns are numbered in order");
  });
  // The audit must describe the quotes actually present; a self-reported
  // tally that disagrees with the record is a malformed record.
  const quotes = record.turns.flatMap((t) => t.quotes);
  if (record.audit.checked !== quotes.length)
    r.fail("audit.checked", "does not match the quotes in the record");
  if (record.audit.verified !== quotes.filter((q) => q.verified).length)
    r.fail("audit.verified", "does not match the verified quotes in the record");
  if (expected) {
    if (record.request_id !== expected.requestId)
      r.fail("request_id", "answers a different request (stale or mismatched)");
    if (record.question !== expected.question)
      r.fail("question", "answers a different question");
  }
  return r.done(record);
}

export function validateIdentity(v: unknown): Checked<RainIdentity> {
  const r = new Reader("identity");
  const o = r.object(v, "", [
    "schema",
    "kind",
    "runtime",
    "rain",
    "corpus",
    "meeting_engine",
    "meeting_generation",
    "model",
    "bounded_decision",
    "remote_decisions",
    "registry",
  ]);
  if (!o) return r.done(null as never);
  if (o.schema !== RAIN_BETHESDA_SCHEMA) r.fail("schema", "unsupported schema");
  if (o.kind !== "identity") r.fail("kind", "not an identity");
  const runtime = r.object(o.runtime, "runtime", ["name", "version"]);
  const corpus = r.object(o.corpus, "corpus", ["files", "sha256"]);
  const registry = r.object(o.registry, "registry", ["available", "scratch", "reason"]);
  const generation = r.oneOf(o.meeting_generation, "meeting_generation", GENERATIONS);
  const model = o.model === null ? null : r.pattern(o.model, "model", MODEL_ID);
  if ((generation === "model") !== (model !== null))
    r.fail("model", "a model is named exactly when meetings are model-generated");
  return r.done({
    schema: RAIN_BETHESDA_SCHEMA,
    kind: "identity",
    runtime: {
      name: r.text(runtime?.name, "runtime.name", 64, 1),
      version: r.text(runtime?.version, "runtime.version", 32, 1),
    },
    rain: revision(r, o.rain, "rain"),
    corpus: {
      files: r.integer(corpus?.files, "corpus.files", 0, 100_000),
      sha256: r.pattern(corpus?.sha256, "corpus.sha256", SHA256),
    },
    meeting_engine: r.text(o.meeting_engine, "meeting_engine", 120, 1),
    meeting_generation: generation,
    model,
    bounded_decision: r.text(o.bounded_decision, "bounded_decision", 32, 1),
    remote_decisions: r.boolean(o.remote_decisions, "remote_decisions"),
    registry: {
      available: r.boolean(registry?.available, "registry.available"),
      scratch: r.boolean(registry?.scratch, "registry.scratch"),
      reason:
        registry?.reason === null
          ? null
          : r.text(registry?.reason, "registry.reason", 300, 1),
    },
  });
}

/** R.A.I.N.'s bounded decision over the host's own options. */
export function validateProposalChoice(
  v: unknown,
  expected: { requestId: string; optionIds: readonly string[] },
): Checked<ProposalChoice> {
  const r = new Reader("proposal");
  const o = r.object(v, "", ["schema", "kind", "request_id", "decision"]);
  if (!o) return r.done(null as never);
  if (o.schema !== RAIN_BETHESDA_SCHEMA) r.fail("schema", "unsupported schema");
  if (o.kind !== "proposal-choice") r.fail("kind", "not a proposal choice");
  const d = r.object(o.decision, "decision", [
    "schema_version",
    "decision_id",
    "destination",
    "selected",
    "reason",
    "envelope_hash",
    "attempts",
    "latency_ms",
  ]);
  if (d && d.schema_version !== RAIN_DECISION_SCHEMA)
    r.fail("decision.schema_version", "unsupported decision schema");
  const destination = r.text(d?.destination, "decision.destination", 32, 1);
  const selected =
    d?.selected === null || d?.selected === undefined
      ? null
      : r.text(d.selected, "decision.selected", 64, 1);
  if (selected !== null && !expected.optionIds.includes(selected))
    r.fail("decision.selected", "is not one of the options offered");
  if (selected !== null && destination !== "proposal")
    r.fail("decision.destination", "a selection is only a proposal");
  const requestId = r.pattern(o.request_id, "request_id", HEX32);
  if (requestId && requestId !== expected.requestId)
    r.fail("request_id", "answers a different request (stale or mismatched)");
  return r.done({
    schema: RAIN_BETHESDA_SCHEMA,
    kind: "proposal-choice",
    request_id: requestId,
    decision: {
      schema_version: RAIN_DECISION_SCHEMA,
      decision_id: r.pattern(
        d?.decision_id,
        "decision.decision_id",
        /^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$/,
      ),
      destination,
      selected,
      reason:
        d?.reason === null || d?.reason === undefined
          ? null
          : r.oneOf(d.reason, "decision.reason", RAIN_ESCALATION_REASONS),
      envelope_hash: r.pattern(d?.envelope_hash, "decision.envelope_hash", SHA256),
      attempts: r
        .array(d?.attempts, "decision.attempts", LIMITS.attempts)
        .map((a, i) => attempt(r, a, `decision.attempts[${i}]`, expected.optionIds)),
      latency_ms: r.number(d?.latency_ms, "decision.latency_ms", 0, 600_000),
    },
  });
}

/**
 * One engine R.A.I.N. consulted. What it chose and the probabilities it gave
 * are kept exactly as returned — over the options offered and nothing else —
 * even when R.A.I.N. did not act on them.
 */
function attempt(
  r: Reader,
  v: unknown,
  path: string,
  optionIds: readonly string[],
): DecisionAttempt {
  const o = r.object(v, path, [
    "engine",
    "model",
    "selected",
    "probabilities",
    "confidence",
    "reason",
    "error_code",
    "latency_ms",
  ]);
  const selected =
    o?.selected === null || o?.selected === undefined
      ? null
      : r.text(o.selected, path + ".selected", 64, 1);
  if (selected !== null && !optionIds.includes(selected))
    r.fail(path + ".selected", "is not one of the options offered");
  const seen = new Set<string>();
  const probabilities = r
    .array(o?.probabilities, path + ".probabilities", optionIds.length)
    .map((pair, i): [string, number] => {
      const at = `${path}.probabilities[${i}]`;
      if (!Array.isArray(pair) || pair.length !== 2) {
        r.fail(at, "expected [option, probability]");
        return ["", 0];
      }
      const id = r.text(pair[0], at + "[0]", 64, 1);
      if (!optionIds.includes(id))
        r.fail(at + "[0]", "is not one of the options offered");
      if (seen.has(id)) r.fail(at + "[0]", "repeats an option");
      seen.add(id);
      return [id, r.number(pair[1], at + "[1]", 0, 1)];
    });
  return {
    engine: r.oneOf(o?.engine, path + ".engine", RAIN_DECISION_ENGINES),
    model:
      o?.model === null || o?.model === undefined
        ? null
        : r.pattern(o.model, path + ".model", MODEL_ID),
    selected,
    probabilities,
    confidence:
      o?.confidence === null || o?.confidence === undefined
        ? null
        : r.number(o.confidence, path + ".confidence", 0, 1),
    reason:
      o?.reason === null || o?.reason === undefined
        ? null
        : r.oneOf(o.reason, path + ".reason", RAIN_ESCALATION_REASONS),
    error_code:
      o?.error_code === null || o?.error_code === undefined
        ? null
        : r.oneOf(o.error_code, path + ".error_code", RAIN_PROVIDER_ERRORS),
    latency_ms: r.number(o?.latency_ms, path + ".latency_ms", 0, 600_000),
  };
}

/** A model meeting R.A.I.N. is still running, bound to the request that started it. */
export function validateMeetingPending(
  v: unknown,
  expected: { requestId: string; question: string },
): Checked<MeetingPending> {
  const r = new Reader("meeting-pending");
  const o = r.object(v, "", [
    "schema",
    "kind",
    "request_id",
    "job_id",
    "question",
    "model",
    "started_at",
    "elapsed_s",
    "turns_started",
    "turns_planned",
  ]);
  if (!o) return r.done(null as never);
  if (o.schema !== RAIN_BETHESDA_SCHEMA) r.fail("schema", "unsupported schema");
  if (o.kind !== "meeting-pending") r.fail("kind", "not a pending meeting");
  const pending: MeetingPending = {
    schema: RAIN_BETHESDA_SCHEMA,
    kind: "meeting-pending",
    request_id: r.pattern(o.request_id, "request_id", HEX32),
    job_id: r.pattern(o.job_id, "job_id", HEX32),
    question: r.text(o.question, "question", LIMITS.question, 1),
    model: r.pattern(o.model, "model", MODEL_ID),
    started_at: r.timestamp(o.started_at, "started_at"),
    elapsed_s: r.number(o.elapsed_s, "elapsed_s", 0, LIMITS.meetingJobMinutes * 60 * 2),
    turns_started: r.integer(o.turns_started, "turns_started", 0, LIMITS.turns),
    turns_planned: r.integer(o.turns_planned, "turns_planned", 1, LIMITS.turns),
  };
  if (pending.request_id !== expected.requestId)
    r.fail("request_id", "answers a different request (stale or mismatched)");
  if (pending.question !== expected.question)
    r.fail("question", "answers a different question");
  return r.done(pending);
}

/** A model meeting that ended without a record. The reason is shown, never a substitute. */
export function validateMeetingFailed(
  v: unknown,
  expected: { requestId: string; jobId: string },
): Checked<MeetingFailed> {
  const r = new Reader("meeting-failed");
  const o = r.object(v, "", ["schema", "kind", "request_id", "job_id", "reason"]);
  if (!o) return r.done(null as never);
  if (o.schema !== RAIN_BETHESDA_SCHEMA) r.fail("schema", "unsupported schema");
  if (o.kind !== "meeting-failed") r.fail("kind", "not a failed meeting");
  const failed: MeetingFailed = {
    schema: RAIN_BETHESDA_SCHEMA,
    kind: "meeting-failed",
    request_id: r.pattern(o.request_id, "request_id", HEX32),
    job_id: r.pattern(o.job_id, "job_id", HEX32),
    reason: r.text(o.reason, "reason", 300, 1),
  };
  if (failed.request_id !== expected.requestId)
    r.fail("request_id", "answers a different request (stale or mismatched)");
  if (failed.job_id !== expected.jobId) r.fail("job_id", "answers a different job");
  return r.done(failed);
}

export type MeetingAnswer = MeetingRecord | MeetingPending | MeetingFailed;
/**
 * Whatever a meeting request or a status check returned: the meeting, a
 * pending job, or a failure — each validated against what was asked. A
 * failure can only answer a job the caller already holds.
 */
export function validateMeetingAnswer(
  v: unknown,
  expected: { requestId: string; question: string; jobId?: string },
): Checked<MeetingAnswer> {
  const kind = isObject(v) ? v.kind : undefined;
  if (kind === "meeting") return validateMeeting(v, expected);
  if (kind === "meeting-pending") {
    const p = validateMeetingPending(v, expected);
    if (p.ok && expected.jobId && p.value.job_id !== expected.jobId)
      return { ok: false, errors: ["meeting-pending.job_id: answers a different job"] };
    return p;
  }
  if (kind === "meeting-failed" && expected.jobId)
    return validateMeetingFailed(v, {
      requestId: expected.requestId,
      jobId: expected.jobId,
    });
  return {
    ok: false,
    errors: ["meeting: not a meeting, a pending meeting or a failure"],
  };
}

export function validatePreregistration(
  v: unknown,
  expected: { requestId: string },
): Checked<PreregistrationAnswer> {
  const r = new Reader("preregistration");
  const o = r.object(v, "", [
    "schema",
    "kind",
    "request_id",
    "experiment_id",
    "experiment_version",
    "definition_sha256",
    "created_at",
    "registry",
    "certificate",
  ]);
  if (!o) return r.done(null as never);
  if (o.schema !== RAIN_BETHESDA_SCHEMA) r.fail("schema", "unsupported schema");
  if (o.kind !== "preregistration") r.fail("kind", "not a pre-registration");
  const requestId = r.pattern(o.request_id, "request_id", HEX32);
  if (requestId && requestId !== expected.requestId)
    r.fail("request_id", "answers a different request (stale or mismatched)");
  return r.done({
    schema: RAIN_BETHESDA_SCHEMA,
    kind: "preregistration",
    request_id: requestId,
    experiment_id: r.pattern(o.experiment_id, "experiment_id", RAIN_EXPERIMENT_ID),
    experiment_version: r.integer(o.experiment_version, "experiment_version", 1, 10_000),
    definition_sha256: r.pattern(o.definition_sha256, "definition_sha256", SHA256),
    created_at: r.timestamp(o.created_at, "created_at"),
    registry: r.oneOf(o.registry, "registry", ["scratch", "configured"] as const),
    certificate: r.pattern(o.certificate, "certificate", SHA256),
  });
}

function criterion(r: Reader, v: unknown, path: string): CriterionResult {
  const o = r.object(v, path, ["id", "metric", "op", "value", "observed", "holds"]);
  return {
    id: r.pattern(o?.id, path + ".id", /^[GSF][0-9]{1,3}$/),
    metric: r.pattern(o?.metric, path + ".metric", /^[a-z][a-z0-9_]{0,63}$/),
    op: r.oneOf(o?.op, path + ".op", [">=", ">", "<=", "<"] as const),
    value: r.number(o?.value, path + ".value", -1e12, 1e12),
    observed:
      o?.observed === null
        ? null
        : r.number(o?.observed, path + ".observed", -1e12, 1e12),
    holds: o?.holds === null ? null : r.boolean(o?.holds, path + ".holds"),
  };
}
export function validateEvaluation(r: Reader, v: unknown, path: string): Evaluation {
  const o = r.object(v, path, ["rule", "guards", "success", "failure", "summary"]);
  if (o && o.rule !== CRITERIA_RULE) r.fail(path + ".rule", "unsupported criteria rule");
  const list = (k: "guards" | "success" | "failure") =>
    r
      .array(o?.[k], `${path}.${k}`, 32)
      .map((c, i) => criterion(r, c, `${path}.${k}[${i}]`));
  return {
    rule: CRITERIA_RULE,
    guards: list("guards"),
    success: list("success"),
    failure: list("failure"),
    summary: r.text(o?.summary, path + ".summary", 2000, 1),
  };
}

/** R.A.I.N.'s own run record for a submission it admitted. */
export function validateAdmission(
  v: unknown,
  expected: { requestId: string; experimentId: string },
): Checked<Admission> {
  const r = new Reader("admission");
  const o = r.object(v, "", [
    "schema",
    "kind",
    "request_id",
    "run_id",
    "status",
    "hypothesis_verdict",
    "evaluation",
    "interpretation",
    "definition_sha256",
    "recorded_at",
  ]);
  if (!o) return r.done(null as never);
  if (o.schema !== RAIN_BETHESDA_SCHEMA) r.fail("schema", "unsupported schema");
  if (o.kind !== "admission") r.fail("kind", "not an admission");
  const requestId = r.pattern(o.request_id, "request_id", HEX32);
  if (requestId && requestId !== expected.requestId)
    r.fail("request_id", "answers a different request (stale or mismatched)");
  const runId = r.pattern(o.run_id, "run_id", RAIN_RUN_ID);
  if (runId && !runId.startsWith(expected.experimentId + "-RUN-"))
    r.fail("run_id", "belongs to a different experiment");
  const status = r.oneOf(o.status, "status", [
    "passed",
    "failed",
    "inconclusive",
    "error",
  ] as const);
  const verdict = r.oneOf(o.hypothesis_verdict, "hypothesis_verdict", [
    "supported",
    "not_supported",
    "insufficient_evidence",
    "not_evaluated",
  ] as const);
  const expectedVerdict = {
    passed: "supported",
    failed: "not_supported",
    inconclusive: "insufficient_evidence",
    error: "not_evaluated",
  }[status];
  if (verdict !== expectedVerdict)
    r.fail("hypothesis_verdict", "inconsistent with the run status");
  const interpretation = r.object(o.interpretation, "interpretation", [
    "deterministic",
    "model",
  ]);
  if (interpretation && interpretation.model !== null)
    r.fail("interpretation.model", "model interpretations are not accepted here");
  const evaluation =
    o.evaluation === null ? null : validateEvaluation(r, o.evaluation, "evaluation");
  if ((status === "error") !== (evaluation === null))
    r.fail("evaluation", "present exactly when the run was evaluated");
  return r.done({
    schema: RAIN_BETHESDA_SCHEMA,
    kind: "admission",
    request_id: requestId,
    run_id: runId,
    status,
    hypothesis_verdict: verdict,
    evaluation,
    interpretation: {
      deterministic: r.text(
        interpretation?.deterministic,
        "interpretation.deterministic",
        4000,
        1,
      ),
      model: null,
    },
    definition_sha256: r.pattern(o.definition_sha256, "definition_sha256", SHA256),
    recorded_at: r.timestamp(o.recorded_at, "recorded_at"),
  });
}

/**
 * The shape of a structured experiment proposal: closed fields, closed
 * vocabulary, bounded numbers. Whatever its origin — R.A.I.N., the demo
 * fixture or a person — a proposal passes exactly this check, and then the
 * host's map-level checks in `experiments.ts`. A proposal never carries
 * coordinates, code, URLs or world state: there is no field to put them in.
 */
export function validateProposalShape(v: unknown): Checked<ExperimentProposal> {
  const r = new Reader("proposal");
  const generated =
    !!v &&
    typeof v === "object" &&
    (v as { schema?: unknown }).schema === GENERATED_PROPOSAL_SCHEMA;
  const o = r.object(v, "", [
    "schema",
    "proposal_id",
    "origin",
    "question",
    "hypothesis",
    "scenario",
    "location",
    "primary_metric",
    "expected_direction",
    "minimum_effect",
    "comparison",
    "seeds",
    "warmup_ticks",
    "observation_window_ticks",
    "rain_decision",
    "meeting_id",
    "mathematical_basis",
    ...(generated ? ["parameters"] : []),
  ]);
  if (!o) return r.done(null as never);
  if (!generated && o.schema !== EXPERIMENT_PROPOSAL_SCHEMA)
    r.fail("schema", "unsupported schema");
  const parameters = generated ? checkParameters(o.parameters) : null;
  if (parameters && !parameters.ok)
    for (const e of parameters.errors) r.fail("parameters", e);
  // The mathematics a proposal cites: every entry closed and admissible, no
  // result twice, one substrate revision. Context for the hypothesis only.
  const basis = parseBasis(o.mathematical_basis);
  if (!basis.ok) for (const e of basis.errors) r.fail("", e);
  if (o.comparison !== "matched_seed_control")
    r.fail("comparison", "only matched-seed controls are supported");
  const scenario = r.oneOf(o.scenario, "scenario", SCENARIO_IDS);
  const location = r.oneOf(o.location, "location", LOCATION_IDS);
  if (
    SCENARIO_IDS.includes(scenario) &&
    LOCATION_IDS.includes(location) &&
    o.scenario === scenario &&
    o.location === location &&
    !SCENARIO_LOCATIONS[scenario].includes(location)
  )
    r.fail("location", `is not a supported place for ${scenario}`);
  const metric = r.oneOf(o.primary_metric, "primary_metric", METRIC_IDS);
  const seedsRaw = r.array(o.seeds, "seeds", EXPERIMENT_BOUNDS.maxSeeds);
  if (Array.isArray(o.seeds) && !o.seeds.length) r.fail("seeds", "at least one seed");
  const seeds = seedsRaw.map((s, i) => r.integer(s, `seeds[${i}]`, 0, 0xffffffff));
  if (new Set(seeds).size !== seeds.length) r.fail("seeds", "seeds must be distinct");
  const warmup = r.integer(
    o.warmup_ticks,
    "warmup_ticks",
    EXPERIMENT_BOUNDS.warmup.min,
    EXPERIMENT_BOUNDS.warmup.max,
  );
  const window = r.integer(
    o.observation_window_ticks,
    "observation_window_ticks",
    EXPERIMENT_BOUNDS.window.min,
    EXPERIMENT_BOUNDS.window.max,
  );
  const step = EXPERIMENT_BOUNDS.sampleInterval;
  if (warmup % step) r.fail("warmup_ticks", `must be a multiple of ${step}`);
  if (window % step) r.fail("observation_window_ticks", `must be a multiple of ${step}`);
  if (seeds.length * 2 * (warmup + window) > EXPERIMENT_BOUNDS.maxTotalTicks)
    r.fail("seeds", `the run exceeds ${EXPERIMENT_BOUNDS.maxTotalTicks} simulated ticks`);
  const spec = METRICS[metric];
  const minimum = r.number(o.minimum_effect, "minimum_effect", 0, spec?.maxEffect ?? 0);
  if (minimum <= 0) r.fail("minimum_effect", "must be greater than zero");
  const origin = r.oneOf(o.origin, "origin", PROPOSAL_ORIGINS);
  let decision: ExperimentProposal["rain_decision"] = null;
  if (o.rain_decision !== null) {
    const d = r.object(o.rain_decision, "rain_decision", [
      "decision_id",
      "envelope_hash",
    ]);
    decision = {
      decision_id: r.pattern(d?.decision_id, "rain_decision.decision_id", ID),
      envelope_hash: r.pattern(d?.envelope_hash, "rain_decision.envelope_hash", SHA256),
    };
  }
  // R.A.I.N.'s choice must carry its decision record; a fixture can never claim
  // one; a person may finalize a proposal from R.A.I.N.'s choice and keep the link.
  if (origin === "rain" && decision === null)
    r.fail("rain_decision", "a R.A.I.N. proposal carries its bounded decision");
  if (origin === "fixture" && o.rain_decision !== null)
    r.fail("rain_decision", "a fixture cannot claim a R.A.I.N. decision");
  return r.done({
    schema: generated ? GENERATED_PROPOSAL_SCHEMA : EXPERIMENT_PROPOSAL_SCHEMA,
    ...(parameters?.ok ? { parameters: parameters.value } : {}),
    proposal_id: r.pattern(o.proposal_id, "proposal_id", ID),
    origin,
    question: r.text(o.question, "question", LIMITS.question, 1),
    hypothesis: r.text(o.hypothesis, "hypothesis", LIMITS.hypothesis, 1),
    scenario,
    location,
    primary_metric: metric,
    expected_direction: r.oneOf(o.expected_direction, "expected_direction", DIRECTIONS),
    minimum_effect: minimum,
    comparison: "matched_seed_control",
    seeds,
    warmup_ticks: warmup,
    observation_window_ticks: window,
    rain_decision: decision,
    meeting_id: o.meeting_id === null ? null : r.pattern(o.meeting_id, "meeting_id", ID),
    mathematical_basis: basis.ok ? basis.value.map((e) => structuredClone(e)) : [],
  });
}

export { Reader };
