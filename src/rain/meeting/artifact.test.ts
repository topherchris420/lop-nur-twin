import { describe, expect, it } from "vitest";
import { sha256 } from "../sha256.js";
import {
  SessionArtifactWriter,
  artifactTime,
  buildGroundedResponse,
} from "./artifact.js";

/** The session artifact writer, ported from R.A.I.N.'s `tests/test_session_artifact.py`. */
const clock = () => new Date("2026-10-06T01:02:03.456Z");

function writer(
  overrides: Partial<ConstructorParameters<typeof SessionArtifactWriter>[0]> = {},
) {
  return new SessionArtifactWriter({
    sessionId: "sess-1234",
    topic: "phononic assembly",
    model: "minimax-m2.7:cloud",
    recursiveDepth: 1,
    libraryPath: "library",
    logPath: "RAIN_LAB_MEETING_LOG.md",
    loadedPapers: ["paper_a.md", "paper_b.md"],
    corpusFiles: [],
    now: clock,
    ...overrides,
  });
}

describe("session artifact", () => {
  it("persists grounded turns and metrics", () => {
    const w = writer();
    w.recordTurn(
      "James",
      'The DRR paper says "standing wave anchoring remains plausible".',
      {
        verified: [["standing wave anchoring remains plausible", "paper_a.md"]],
        unverified: [],
        citation_rate: 1.0,
      },
    );
    const { artifact, text } = w.finalize(
      "completed",
      { citation_accuracy: 1.0, novel_claim_density: 0.25 },
      "Session ended cleanly.",
    );
    expect(artifact.schema_version).toBe("rain-session-artifact/v1");
    expect(artifact.session_id).toBe("sess-1234");
    expect(artifact.status).toBe("completed");
    expect(artifact.metrics.citation_accuracy).toBe(1.0);
    expect(artifact.loaded_papers_count).toBe(2);
    expect(artifact.summary).toBe("Session ended cleanly.");
    expect(artifact.started_at).toBe("2026-10-06T01:02:03Z");
    expect(artifact.completed_at).toBe("2026-10-06T01:02:03Z");
    const turn = artifact.turns[0]!;
    expect(turn.agent).toBe("James");
    expect(turn.grounded_response.grounded).toBe(true);
    expect(turn.grounded_response.red_badge).toBe(false);
    expect(turn.grounded_response.provenance).toEqual(["paper_a.md"]);
    expect(turn.grounded_response.evidence[0]!.quote).toBe(
      "standing wave anchoring remains plausible",
    );
    expect(turn.grounded_response.confidence).toBe(0.95);
    expect(text).toBe(JSON.stringify(artifact, null, 2));
  });

  it("marks ungrounded turns", () => {
    const w = writer({ sessionId: "sess-ungrounded", loadedPapers: [] });
    w.recordTurn("Elena", "The claim is satisfiable but not plausible.", {
      verified: [],
      unverified: ["The claim is satisfiable but not plausible."],
      citation_rate: 0.0,
    });
    const { artifact } = w.finalize("interrupted");
    const turn = artifact.turns[0]!;
    expect(artifact.status).toBe("interrupted");
    expect(turn.grounded_response.grounded).toBe(false);
    expect(turn.grounded_response.red_badge).toBe(true);
    expect(turn.metadata.verified_count).toBe(0);
    expect(turn.metadata.unverified_count).toBe(1);
    expect(turn.grounded_response.confidence).toBe(0.2);
  });

  it("stores a required quote that did not match as ungrounded, with the corpus hashes", () => {
    const text = "This file discusses unrelated laboratory fixtures only.";
    const w = writer({ corpusFiles: [{ path: "note.md", sha256: sha256(text) }] });
    w.recordTurn("Elena", 'The paper says "something else" and that settles it.', {
      verified: [],
      unverified: ["something else"],
      citation_rate: 0,
      citation_success: false,
      require_quotes: true,
    });
    const { artifact } = w.finalize("completed");
    const turn = artifact.turns[0]!;
    expect(turn.grounded_response.grounded).toBe(false);
    expect(turn.grounded_response.red_badge).toBe(true);
    expect(turn.metadata.citation_success).toBe(false);
    expect(turn.metadata.require_quotes).toBe(true);
    expect(artifact.corpus_files).toEqual([{ path: "note.md", sha256: sha256(text) }]);
  });

  it("records a verified quote's span", () => {
    const w = writer();
    w.recordTurn("James", 'Quote: "alpha beta gamma delta"', {
      verified: [["alpha beta gamma delta", "note.md"]],
      unverified: [],
      verified_spans: [
        {
          quote: "alpha beta gamma delta",
          source: "note.md",
          span_start: 8,
          span_end: 30,
        },
      ],
      citation_rate: 1,
      citation_success: true,
    });
    const evidence =
      w.finalize("completed").artifact.turns[0]!.grounded_response.evidence[0]!;
    expect(evidence).toEqual({
      source: "note.md",
      quote: "alpha beta gamma delta",
      span_start: 8,
      span_end: 30,
    });
  });

  it("builds the grounding-first envelope", () => {
    const red = buildGroundedResponse({
      answer: "x",
      confidence: 2,
      provenance: [],
      evidence: [],
      reproSteps: [],
    });
    expect([red.grounded, red.red_badge, red.confidence]).toEqual([false, true, 1]);
    expect(artifactTime(new Date("2026-01-02T03:04:05.678Z"))).toBe(
      "2026-01-02T03:04:05Z",
    );
  });
});
