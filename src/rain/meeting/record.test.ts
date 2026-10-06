import { describe, expect, it } from "vitest";
import { sha256 } from "../sha256.js";
import { TURN_LIMITS } from "../protocol.js";
import { type ArtifactTurn, type SessionArtifact } from "./artifact.js";
import { MODEL_ROLES } from "./perspectives.js";
import { MeetingFailed, modelMeetingRecord } from "./record.js";

/**
 * A model meeting's session artifact becomes a `rain-bethesda/v2` record:
 * ported from the bridge's `test_bridge.py` (ModelMeetingRecord), which this
 * module replaced. Every quote is re-verified against the corpus and every
 * turn says who wrote it.
 */
const QUESTION =
  "What evidence would distinguish coordinated crowd behavior from coincidental local responses?";
const PAPER = "papers/closure.md";
const PAPER_TEXT =
  "# Closures\n\nCrowds near a closed entrance wait before they disperse.\n" +
  "Onlookers gather where an event is visible.\n";
const CLOSING = "Meeting adjourned. Great discussion everyone!";
const documents = [{ path: PAPER, text: PAPER_TEXT }];
const placeholder = (name: string) =>
  `[${name} is processing... Let me gather my thoughts on this topic.]`;

function turn(agent: string, content: string, quotes: string[] = []): ArtifactTurn {
  return {
    index: 0,
    timestamp: "2026-10-03T04:00:00Z",
    agent,
    content,
    metadata: { verified_count: 0, unverified_count: 0, citation_rate: 0 },
    grounded_response: {
      answer: content,
      confidence: 0.2,
      provenance: quotes.length ? [PAPER] : [],
      evidence: quotes.map((q) => ({
        source: PAPER,
        quote: q,
        span_start: null,
        span_end: null,
      })),
      repro_steps: [],
      grounded: quotes.length > 0,
      red_badge: quotes.length === 0,
    },
  };
}

function artifact(
  turns: ArtifactTurn[],
  extra: Record<string, unknown> = {},
): SessionArtifact {
  return {
    schema_version: "rain-session-artifact/v1",
    status: "completed",
    topic: QUESTION,
    model: "qwen2.5:7b",
    session_id: "3298be35",
    recursive_depth: 0,
    started_at: "2026-10-03T03:50:00Z",
    completed_at: "2026-10-03T04:00:00Z",
    library_path: "src/rain/data/corpus.json",
    log_path: "this session artifact",
    loaded_papers_count: 1,
    loaded_papers: [PAPER],
    corpus_files: [{ path: PAPER, sha256: sha256(PAPER_TEXT) }],
    metrics: {},
    summary: "",
    turns,
    judgments: [],
    decisions: [],
    ...extra,
  } as unknown as SessionArtifact;
}

const revision = {
  repository: "topherchris420/lop-nur-twin",
  commit: "9".repeat(40),
  dirty: false,
};

function record(
  turns: ArtifactTurn[],
  options: { modelStopped?: boolean; extra?: Record<string, unknown> } = {},
) {
  const a = artifact(turns, options.extra);
  return modelMeetingRecord({
    artifact: a,
    artifactText: JSON.stringify(a),
    question: QUESTION,
    requestId: "a".repeat(32),
    revision,
    documents,
    modelStopped: options.modelStopped ?? false,
  });
}

const meeting = () => [
  turn("James", "Crowds wait first, as the paper says.", [
    "Crowds near a closed entrance wait before they disperse.",
  ]),
  turn("Jasmine", placeholder("Jasmine")),
  turn("SYSTEM", "SYSTEM: Research process suggestion: narrow the question."),
  turn("Luca", "An invented quote follows.", ["Crowds always panic at closures."]),
  turn("Elena", "Onlookers gather where they can see.", [
    "Onlookers gather   where an event\nis visible.",
  ]),
  turn("James", CLOSING),
];

describe("model meeting record", () => {
  it("says who wrote every turn", () => {
    const r = record(meeting());
    expect(r.turns.map((t) => t.speaker)).toEqual([
      "James",
      "Jasmine",
      "Luca",
      "Elena",
      "James",
    ]);
    expect(r.turns.map((t) => t.generation)).toEqual([
      "model",
      "scripted",
      "model",
      "model",
      "scripted",
    ]);
    expect(r.turns.map((t) => t.move)).toEqual([
      "speaks",
      "stands in for an unusable answer",
      "speaks",
      "speaks",
      "closes the meeting",
    ]);
    expect(r.turns.slice(0, 4).map((t) => t.role)).toEqual([
      MODEL_ROLES.James,
      MODEL_ROLES.Jasmine,
      MODEL_ROLES.Luca,
      MODEL_ROLES.Elena,
    ]);
    expect(MODEL_ROLES.James).toMatch(/^Lead Scientist/);
    expect([r.generation, r.model, r.verdict, r.grounding]).toEqual([
      "model",
      "qwen2.5:7b",
      null,
      null,
    ]);
    expect(r.matched_terms).toBeNull();
    expect(r.missing_terms).toBeNull();
  });

  it("re-verifies and locates every quote", () => {
    const r = record(meeting());
    const [james, , luca, elena] = r.turns;
    expect(james!.quotes).toHaveLength(1);
    const q = james!.quotes[0]!;
    expect([q.source, q.line, q.verified]).toEqual([PAPER, 3, true]);
    expect(PAPER_TEXT.slice(q.span_start, q.span_end)).toBe(q.text);
    // An invented quote is not carried; it is counted.
    expect([luca!.quotes, luca!.unverified]).toEqual([[], 1]);
    // Whitespace collapses, as R.A.I.N.'s matcher does.
    expect(elena!.quotes).toHaveLength(1);
    expect(r.audit.checked).toBe(r.audit.verified);
    expect(r.audit.corpus_files).toBe(1);
  });

  it("names R.A.I.N.'s record by hash", () => {
    const a = artifact(meeting());
    const text = JSON.stringify(a);
    const r = modelMeetingRecord({
      artifact: a,
      artifactText: text,
      question: QUESTION,
      requestId: "a".repeat(32),
      revision: { repository: "topherchris420/lop-nur-twin", commit: null, dirty: null },
      documents,
    });
    expect(r.source_artifact).toEqual({
      schema: "rain-session-artifact/v1",
      session_id: "3298be35",
      status: "completed",
      sha256: sha256(text),
    });
    expect(r.meeting_id).toBe("rain-model-3298be35");
    expect(r.engine).toBe("rain.meeting.model.holdMeeting");
    expect(r.rain.commit).toBeNull();
  });

  it("says where a meeting the model stopped ended", () => {
    const r = record(meeting(), { modelStopped: true });
    expect(r.turns[3]!.coda).toContain("The model stopped answering after this turn");
    expect(r.turns[4]!.coda).toBe(""); // not on R.A.I.N.'s closing line
    expect(
      r.turns
        .slice(0, 3)
        .map((t) => t.coda)
        .join(" "),
    ).not.toContain("stopped");
    expect(
      record(meeting())
        .turns.map((t) => t.coda)
        .join(" "),
    ).not.toContain("stopped");
  });

  it("fails a meeting without a word from the model", () => {
    const placeholders = [
      turn("James", placeholder("James")),
      turn("Jasmine", placeholder("Jasmine")),
      turn("James", CLOSING),
    ];
    expect(() => record(placeholders)).toThrow(MeetingFailed);
    expect(() => record(placeholders)).toThrow(/no turn from the model$/);
    expect(() => record(placeholders, { modelStopped: true })).toThrow(
      /before the model stopped answering/,
    );
  });

  it("refuses a record it cannot vouch for", () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ schema_version: "rain-session-artifact/v9" }, /not a session artifact/],
      [{ status: "in_progress" }, /did not finish/],
      [{ topic: "Another question?" }, /different question/],
      [{ model: "http://evil.example/m" }, /no usable model/],
      [{ session_id: "../x" }, /no session id/],
    ];
    for (const [extra, reason] of cases)
      expect(() => record(meeting(), { extra }), JSON.stringify(extra)).toThrow(reason);
  });

  it("cleans and bounds what it carries", () => {
    const long = "x".repeat(TURN_LIMITS.turnText + 50);
    const r = record([
      turn("James", "a" + String.fromCharCode(0x202e) + "b"),
      turn("Luca", long),
      turn("James", CLOSING),
    ]);
    expect(r.turns[0]!.lead).toBe("ab");
    expect(r.turns[0]!.coda).toContain("removed 1 invisible");
    expect(r.turns[1]!.lead.length).toBeLessThanOrEqual(TURN_LIMITS.turnText);
    expect(r.turns[1]!.coda).toContain("shortened");
  });
});
