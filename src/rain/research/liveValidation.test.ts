import { describe, it, expect } from "vitest";
import { liveStudyAudit } from "./liveValidation.js";
import { sha256Json } from "../sha256.js";
import type { DiscoveryEntry } from "../autonomy/store.js";
const entry = (kind: string, payload: unknown): DiscoveryEntry => ({
  kind,
  payload,
  sequence: 0,
  previous: null,
  session: "fixture",
  at: "2026-10-10T00:00:00Z",
  sha256: sha256Json(payload),
});
describe("live validation evidence", () => {
  it("does not label an empty or scripted trace a live research cycle", () => {
    expect(liveStudyAudit([], new Set()).live_cycle_complete).toBe(false);
    const audit = liveStudyAudit(
      [
        entry("inference-request", {
          id: "fixture",
          model: "fixture",
          generation: "scripted",
          request: {},
        }),
        entry("inference-answer", {
          id: "fixture",
          generation: "scripted",
          answer: {
            reportedModel: "fixture",
            finishReason: "stop",
            promptTokens: 1,
            completionTokens: 1,
          },
        }),
      ],
      new Set(),
    );
    expect(audit.checks.all_calls_are_completed_real_inference).toBe(false);
    expect(audit.live_cycle_complete).toBe(false);
  });
  it("detects evidence-review context contamination and incomplete model answers", () => {
    const entries = ["Christopher-Sim", "Research-Collaborator"].flatMap((name, i) => [
      entry("inference-request", {
        id: name,
        seat: "research-" + name + "-Independent evidence review",
        model: "qwen-fixture",
        generation: "model",
        request: {
          user: JSON.stringify({ context: { priorInterpretation: i }, results: [] }),
        },
      }),
      entry("inference-answer", {
        id: name,
        generation: "model",
        answer: {
          reportedModel: "qwen-fixture",
          finishReason: "length",
          promptTokens: 1,
          completionTokens: 1,
        },
      }),
    ]);
    const audit = liveStudyAudit(entries, new Set());
    expect(audit.checks.independent_evidence_review_contexts).toBe(false);
    expect(audit.checks.all_calls_are_completed_real_inference).toBe(false);
    expect(audit.checks.replay_verified_admitted_experiments).toBe(false);
  });
});
