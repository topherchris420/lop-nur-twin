import { describe, expect, it } from "vitest";
import meeting from "./fixtures/demo-meeting.json" with { type: "json" };
import { LIMITS, RAIN_BETHESDA_SCHEMA } from "./contracts";
import {
  validateMeeting,
  validateMeetingAnswer,
  validateMeetingFailed,
  validateMeetingPending,
  validateProposalChoice,
} from "./validation";
import { evidenceItems } from "./session";

type Json = Record<string, unknown>;
const clone = <T>(v: T): T => structuredClone(v);
const bound = { requestId: meeting.request_id, question: meeting.question };
const JOB = "c".repeat(32);

/**
 * A model meeting shaped as the bridge expresses R.A.I.N.'s session artifact:
 * the DEMO's turns re-labelled as model-written, its last line as the fixed
 * closing R.A.I.N.'s code adds, no offline-engine analysis, and R.A.I.N.'s own
 * record named by hash.
 */
function modelMeeting(): Json {
  const m = clone(meeting) as unknown as Json & { turns: Json[] };
  m.generation = "model";
  m.model = "qwen2.5:7b";
  m.engine = "rain.meeting.model.holdMeeting";
  m.grounding = null;
  m.matched_terms = null;
  m.missing_terms = null;
  m.verdict = null;
  m.turns.forEach(
    (t, i) => (t.generation = i === m.turns.length - 1 ? "scripted" : "model"),
  );
  m.source_artifact = {
    schema: "rain-session-artifact/v1",
    session_id: "3298be35",
    status: "completed",
    sha256: "d".repeat(64),
  };
  return m;
}

describe("rain-bethesda/v2: who wrote a meeting", () => {
  it("accepts a model meeting that names its model and R.A.I.N.'s record, and claims no analysis", () => {
    const v = validateMeeting(modelMeeting(), bound);
    expect(v.ok).toBe(true);
    expect(v.ok && v.value.verdict).toBeNull();
  });
  it("accepts the recorded offline meeting, every turn scripted", () => {
    const v = validateMeeting(clone(meeting), bound);
    expect(v.ok).toBe(true);
    expect(v.ok && v.value.turns.every((t) => t.generation === "scripted")).toBe(true);
  });
  it.each<[string, () => Json]>([
    ["a model meeting that names no model", () => ({ ...modelMeeting(), model: null })],
    [
      "a model meeting without R.A.I.N.'s own record of it",
      () => ({ ...modelMeeting(), source_artifact: null }),
    ],
    [
      "a model meeting in which the model wrote nothing",
      () => {
        const m = modelMeeting() as Json & { turns: Json[] };
        m.turns.forEach((t) => (t.generation = "scripted"));
        return m;
      },
    ],
    [
      "R.A.I.N.'s record in another schema",
      () => {
        const m = modelMeeting();
        (m.source_artifact as Json).schema = "rain-session-artifact/v9";
        return m;
      },
    ],
    [
      "a meeting R.A.I.N. never finished",
      () => {
        const m = modelMeeting();
        (m.source_artifact as Json).status = "in_progress";
        return m;
      },
    ],
    [
      "an offline meeting without its verdict",
      () => ({ ...clone(meeting), verdict: null }),
    ],
    [
      "an offline meeting without its grounding",
      () => ({ ...clone(meeting), grounding: null, matched_terms: null }),
    ],
    [
      "an offline meeting with a model-written turn",
      () => {
        const m = clone(meeting) as unknown as Json & { turns: Json[] };
        m.turns[0]!.generation = "model";
        return m;
      },
    ],
    [
      "an offline meeting claiming a session artifact",
      () => ({ ...clone(meeting), source_artifact: modelMeeting().source_artifact }),
    ],
    [
      "a turn that does not say who wrote it",
      () => {
        const m = clone(meeting) as unknown as Json & { turns: Json[] };
        delete m.turns[0]!.generation;
        return m;
      },
    ],
    [
      "a model meeting that brings the offline engine's verdict",
      () => ({ ...modelMeeting(), verdict: clone(meeting.verdict) }),
    ],
    [
      "a model meeting that grades the corpus",
      () => ({ ...modelMeeting(), grounding: "strong" }),
    ],
    [
      "a model meeting that lists matched and missing terms",
      () => ({ ...modelMeeting(), matched_terms: ["metro"], missing_terms: [] }),
    ],
    [
      "a model meeting relabelled as scripted, with an invented verdict",
      () => ({
        ...modelMeeting(),
        generation: "scripted",
        model: null,
        verdict: {
          agreed: "Everyone agreed.",
          contested: "",
          next_move: "",
          read_next: [],
        },
      }),
    ],
  ])("refuses %s", (_what, build) => {
    expect(validateMeeting(build(), bound).ok).toBe(false);
  });
});

describe("rain-bethesda/v2: the Evidence Library keeps who wrote each turn", () => {
  const v = validateMeeting(modelMeeting(), bound);
  if (!v.ok) throw new Error("fixture must validate");
  const items = evidenceItems(v.value, []);
  const prose = items.filter((i) => i.category === "INTERPRETATION");
  it("credits the model with its turns and R.A.I.N.'s code with its fixed lines", () => {
    expect(
      prose.slice(0, -1).every((i) => i.provenance.startsWith("generated by qwen2.5:7b")),
    ).toBe(true);
    expect(prose.at(-1)!.provenance).toMatch(
      /^a fixed line in R\.A\.I\.N\.'s code .*not the model's$/,
    );
  });
  it("names R.A.I.N.'s check, not the offline engine's, and counts what did not verify", () => {
    const m = clone(v.value);
    m.turns[0]!.unverified = 2;
    const audit = evidenceItems(m, []).find((i) => i.title === "Citation audit")!;
    expect(audit.provenance).toMatch(
      /^R\.A\.I\.N\.'s citation check in its model meeting/,
    );
    expect(audit.body).toMatch(
      /2 more quotations did not verify and are not shown as a source/,
    );
    expect(audit.grounded).toBe(false);
  });
  it("still calls the offline engine's turns scripted", () => {
    const d = validateMeeting(clone(meeting), bound);
    if (!d.ok) throw new Error("fixture must validate");
    const offline = evidenceItems(d.value, []).filter(
      (i) => i.category === "INTERPRETATION",
    );
    expect(offline.every((i) => i.provenance.startsWith("scripted by "))).toBe(true);
  });
});

describe("rain-bethesda/v2: a model meeting is a job", () => {
  const pending = (extra: Json = {}): Json => ({
    schema: RAIN_BETHESDA_SCHEMA,
    kind: "meeting-pending",
    request_id: bound.requestId,
    job_id: JOB,
    question: bound.question,
    model: "qwen2.5:7b",
    started_at: "2026-10-03T03:43:59.086Z",
    elapsed_s: 12.5,
    turns_started: 3,
    turns_planned: 25,
    ...extra,
  });
  const failed = (extra: Json = {}): Json => ({
    schema: RAIN_BETHESDA_SCHEMA,
    kind: "meeting-failed",
    request_id: bound.requestId,
    job_id: JOB,
    reason: "stopped at the lab's request",
    ...extra,
  });
  it("accepts a pending meeting bound to its request, with progress only", () => {
    expect(validateMeetingPending(pending(), bound).ok).toBe(true);
  });
  it.each<[string, Json]>([
    ["another request's job", { request_id: "f".repeat(32) }],
    ["another question's job", { question: "Is it raining?" }],
    ["a malformed job id", { job_id: "../../job" }],
    ["more turns than a meeting may hold", { turns_started: LIMITS.turns + 1 }],
    ["words smuggled into progress", { words: "James says…" }],
    ["a model id that is a URL", { model: "http://evil.example/m" }],
  ])("refuses %s", (_what, extra) => {
    expect(validateMeetingPending(pending(extra), bound).ok).toBe(false);
  });
  it("accepts a failure for the job asked about, and refuses one for another", () => {
    expect(
      validateMeetingFailed(failed(), { requestId: bound.requestId, jobId: JOB }).ok,
    ).toBe(true);
    expect(
      validateMeetingFailed(failed(), {
        requestId: bound.requestId,
        jobId: "d".repeat(32),
      }).ok,
    ).toBe(false);
    expect(
      validateMeetingFailed(failed({ reason: "a\u202eb" }), {
        requestId: bound.requestId,
        jobId: JOB,
      }).ok,
    ).toBe(false);
  });
  it("routes each answer by kind and binds it to the job in hand", () => {
    expect(validateMeetingAnswer(pending(), bound).ok).toBe(true);
    expect(validateMeetingAnswer(modelMeeting(), { ...bound, jobId: JOB }).ok).toBe(true);
    // A failure only answers a job the caller holds.
    expect(validateMeetingAnswer(failed(), bound).ok).toBe(false);
    expect(validateMeetingAnswer(failed(), { ...bound, jobId: JOB }).ok).toBe(true);
    expect(
      validateMeetingAnswer(pending({ job_id: "d".repeat(32) }), { ...bound, jobId: JOB })
        .ok,
    ).toBe(false);
    expect(validateMeetingAnswer({ kind: "transcript" }, bound).ok).toBe(false);
  });
});

describe("rain-bethesda/v2: what an engine chose is kept as returned", () => {
  const options = ["X1", "X7", "ESCALATE_TO_HUMAN"];
  const expectedChoice = { requestId: "a".repeat(32), optionIds: options };
  // What R.A.I.N. recorded when Jev (jev-1.13.0) chose X1 and R.A.I.N. did not act on it.
  const jev = (extra: Json = {}): Json => ({
    engine: "typesafe",
    model: "jev-1.13.0",
    selected: "X1",
    probabilities: [
      ["X7", 0.01],
      ["X1", 0.63],
      ["ESCALATE_TO_HUMAN", 0.36],
    ],
    confidence: 0.59,
    reason: "INSUFFICIENT_CALIBRATION",
    error_code: null,
    latency_ms: 233.367,
    ...extra,
  });
  const choice = (attempts: unknown[], extra: Json = {}): Json => ({
    schema: RAIN_BETHESDA_SCHEMA,
    kind: "proposal-choice",
    request_id: "a".repeat(32),
    decision: {
      schema_version: "rain-bounded-decision/v1",
      decision_id: "c78bbc57-51be-4443-b1b2-f191aa9988f0",
      destination: "rain",
      selected: null,
      reason: "INSUFFICIENT_CALIBRATION",
      envelope_hash: "f".repeat(64),
      attempts,
      latency_ms: 234.1,
      ...extra,
    },
  });
  it("keeps an engine's choice that R.A.I.N. did not act on, with its probabilities", () => {
    const v = validateProposalChoice(choice([jev()]), expectedChoice);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.decision.selected).toBeNull();
    expect(v.value.decision.attempts[0]).toMatchObject({
      engine: "typesafe",
      selected: "X1",
      reason: "INSUFFICIENT_CALIBRATION",
    });
  });
  it("keeps an engine that was not asked as not asked", () => {
    const notAsked = jev({
      model: null,
      selected: null,
      probabilities: [],
      confidence: null,
      reason: "POLICY_REQUIRES_REVIEW",
      latency_ms: 0,
    });
    expect(validateProposalChoice(choice([notAsked]), expectedChoice).ok).toBe(true);
  });
  it.each<[string, unknown[], Json?]>([
    ["a choice that was not offered", [jev({ selected: "X99" })]],
    ["a probability for an option not offered", [jev({ probabilities: [["X99", 0.5]] })]],
    [
      "the same option twice",
      [
        jev({
          probabilities: [
            ["X1", 0.5],
            ["X1", 0.5],
          ],
        }),
      ],
    ],
    ["a probability above one", [jev({ probabilities: [["X1", 1.2]] })]],
    ["a non-finite probability", [jev({ probabilities: [["X1", Number.NaN]] })]],
    ["an engine R.A.I.N. does not have", [jev({ engine: "gpt" })]],
    ["a reason outside R.A.I.N.'s vocabulary", [jev({ reason: "TRUST_ME" })]],
    ["an error code outside R.A.I.N.'s vocabulary", [jev({ error_code: "rm -rf" })]],
    ["more attempts than a decision may report", [jev(), jev(), jev(), jev(), jev()]],
    ["a decision reason outside R.A.I.N.'s vocabulary", [jev()], { reason: "MAYBE" }],
    ["an attempts count instead of the attempts", 3 as unknown as unknown[]],
  ])("refuses %s", (_what, attempts, extra) => {
    expect(validateProposalChoice(choice(attempts, extra), expectedChoice).ok).toBe(
      false,
    );
  });
});
