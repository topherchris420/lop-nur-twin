import { describe, expect, it } from "vitest";
import { verifyQuote } from "../corpus.js";
import { CLOSING_LINE, TEAM, placeholderLine } from "./perspectives.js";
import {
  ModelUnavailable,
  analyzeCitations,
  corruptionReason,
  extractQuotes,
  holdMeeting,
  libraryContext,
  looksTruncated,
  soulOf,
  stripAgentPrefix,
} from "./model.js";
import { modelMeetingRecord } from "./record.js";

/**
 * A model meeting against an in-process stand-in for an OpenAI-compatible
 * server. The stand-in quotes the corpus verbatim, so the artifact's
 * grounding is checkable; nothing it writes is ever executed.
 */
const PAPER = "papers/closure.md";
const PAPER_TEXT =
  "# Closures\n\nCrowds near a closed entrance wait before they disperse.\n" +
  "Onlookers gather where an event is visible.\n";
const documents = [{ path: PAPER, text: PAPER_TEXT }];
const QUOTE = "Crowds near a closed entrance wait before they disperse.";
const GROUNDED = `That measurement matters more than the slogan. The closure paper notes that "${QUOTE}" That is a measurable claim, so what observation would falsify it?`;
const UNGROUNDED =
  "I think the crowd simply behaves as crowds do, and no further evidence is needed to see it. Does anyone disagree with that reading of the situation?";

type Message = { role: string; content: string };
type Body = {
  model: string;
  messages: Message[];
  temperature: number;
  max_tokens: number;
};
interface StandIn {
  calls: Body[];
  fetchImpl: typeof fetch;
}
function standIn(
  answer: (body: Body, turn: number) => string | Promise<string>,
): StandIn {
  const calls: Body[] = [];
  let turn = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Body;
    calls.push(body);
    if (!String(input).endsWith("/v1/chat/completions"))
      throw new Error(`unexpected url ${String(input)}`);
    const last = body.messages.at(-1)!.content;
    const content = last === "test" ? "ok" : await answer(body, ++turn);
    return new Response(
      JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  return { calls, fetchImpl };
}
const settings = {
  baseUrl: "http://127.0.0.1:1/v1",
  model: "stand-in-model",
  maxTurns: 4,
  wrapUpTurns: 2,
  recursiveIntellect: false,
  timeoutMs: 1000,
  maxRetries: 1,
};
const hooks = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) => ({
  fetchImpl,
  sleep: async () => {},
  now: () => new Date("2026-10-06T02:00:00Z"),
  sessionId: "abcd1234",
  ...extra,
});

describe("model meeting", () => {
  it("holds a four-turn meeting whose quotes verify against the corpus", async () => {
    const server = standIn(() => GROUNDED);
    const held = await holdMeeting(
      "Why do crowds wait?",
      documents,
      settings,
      hooks(server.fetchImpl),
    );
    expect([held.cancelled, held.modelStopped]).toEqual([false, false]);
    const { artifact } = held;
    expect(artifact.status).toBe("completed");
    expect(artifact.model).toBe("stand-in-model");
    expect(artifact.session_id).toBe("abcd1234");
    expect(artifact.topic).toBe("Why do crowds wait?");
    expect(artifact.recursive_depth).toBe(0);
    expect(artifact.loaded_papers).toEqual([PAPER]);
    expect(artifact.corpus_files).toHaveLength(1);
    expect(artifact.turns.map((t) => t.agent)).toEqual([
      "James",
      "Jasmine",
      "Luca",
      "Elena",
      "James",
    ]);
    expect(artifact.turns.at(-1)!.content).toBe(CLOSING_LINE);
    for (const turn of artifact.turns.slice(0, 4)) {
      expect(turn.grounded_response.grounded).toBe(true);
      expect(turn.grounded_response.evidence[0]).toMatchObject({
        source: PAPER,
        quote: QUOTE,
      });
      expect(turn.metadata.citation_success).toBe(true);
      expect(
        PAPER_TEXT.slice(
          turn.grounded_response.evidence[0]!.span_start!,
          turn.grounded_response.evidence[0]!.span_end!,
        ),
      ).toBe(QUOTE);
    }
    expect(held.text).toBe(JSON.stringify(artifact, null, 2));
    // What left: the connection test, then one completion per turn, each with the soul and the library.
    expect(server.calls).toHaveLength(5);
    expect(server.calls.every((c) => c.model === "stand-in-model")).toBe(true);
    const system = server.calls[1]!.messages[0]!;
    expect(system.role).toBe("system");
    expect(system.content).toContain("# MEETING RULES (CRITICAL)");
    expect(system.content).toContain("### RESEARCH DATABASE");
    expect(system.content).toContain(QUOTE);
    expect(server.calls[1]!.messages[1]!.content).toContain("[Meeting Start]");
    // The lab's record of it names the model and re-verifies every quote.
    const record = modelMeetingRecord({
      artifact,
      artifactText: held.text,
      question: "Why do crowds wait?",
      requestId: "b".repeat(32),
      revision: { repository: "topherchris420/lop-nur-twin", commit: null, dirty: null },
      documents,
    });
    expect(record.turns.map((t) => t.generation)).toEqual([
      "model",
      "model",
      "model",
      "model",
      "scripted",
    ]);
    expect(record.audit).toMatchObject({ checked: 4, verified: 4, corpus_files: 1 });
  });

  it("records ungrounded answers with a red badge and keeps going", async () => {
    const server = standIn(() => UNGROUNDED);
    const { artifact } = await holdMeeting(
      "Why do crowds wait?",
      documents,
      settings,
      hooks(server.fetchImpl),
    );
    expect(artifact.status).toBe("completed");
    for (const turn of artifact.turns.slice(0, 4)) {
      expect(turn.grounded_response.red_badge).toBe(true);
      expect(turn.metadata.citation_success).toBe(false);
      expect(turn.metadata.require_quotes).toBe(true);
    }
  });

  it("is unavailable when the server never answers the connection test", async () => {
    let attempts = 0;
    const fetchImpl: typeof fetch = async () => {
      attempts += 1;
      throw new Error("connection refused");
    };
    await expect(holdMeeting("q", documents, settings, hooks(fetchImpl))).rejects.toThrow(
      ModelUnavailable,
    );
    expect(attempts).toBe(3);
  });

  it("ends a meeting the model stops answering, and says so", async () => {
    const server = standIn((_, turn) => {
      if (turn > 2) throw new Error("server went away");
      return GROUNDED;
    });
    const held = await holdMeeting("q", documents, settings, hooks(server.fetchImpl));
    expect(held.modelStopped).toBe(true);
    expect(held.artifact.status).toBe("completed");
    expect(held.artifact.turns.map((t) => t.agent)).toEqual([
      "James",
      "Jasmine",
      "James",
    ]);
    const record = modelMeetingRecord({
      artifact: held.artifact,
      artifactText: held.text,
      question: "q",
      requestId: "c".repeat(32),
      revision: { repository: "topherchris420/lop-nur-twin", commit: null, dirty: null },
      documents,
      modelStopped: true,
    });
    expect(record.turns[1]!.coda).toContain(
      "The model stopped answering after this turn",
    );
  });

  it("stops at the lab's request and records the interruption", async () => {
    const controller = new AbortController();
    const server = standIn((_, turn) => {
      if (turn === 2) controller.abort();
      return GROUNDED;
    });
    const held = await holdMeeting(
      "q",
      documents,
      settings,
      hooks(server.fetchImpl, { signal: controller.signal }),
    );
    expect(held.cancelled).toBe(true);
    expect(held.artifact.status).toBe("interrupted");
    expect(held.artifact.turns.map((t) => t.agent)).toEqual(["James", "Jasmine"]);
  });

  it("stands a placeholder in for an answer it cannot use", async () => {
    const server = standIn((body, turn) =>
      turn === 1 && body.messages.at(-1)!.content.includes("[Meeting Start]")
        ? "@@@ ### $$$ %%% ^^^ &&& *** ((( ))) {{{ }}} [[[ ]]] <<< >>> ||| \\\\ /// ~~~ ``` +++ === ;;; :::"
        : GROUNDED,
    );
    const { artifact } = await holdMeeting(
      "q",
      documents,
      settings,
      hooks(server.fetchImpl),
    );
    expect(artifact.turns[0]!.content).toBe(placeholderLine("James"));
    expect(artifact.turns[0]!.grounded_response.red_badge).toBe(true);
  });
});

describe("model meeting helpers", () => {
  it("extracts and verifies quotations", () => {
    expect(
      extractQuotes(`He said "one two three" and "one two three four five".`),
    ).toEqual(["one two three four five"]);
    const docs = new Map(documents.map((d) => [d.path, d.text]));
    const analysis = analyzeCitations(GROUNDED, docs);
    expect(analysis.verified).toEqual([[QUOTE, PAPER]]);
    expect(analysis.verified_spans[0]).toMatchObject({ source: PAPER, span_start: 12 });
    expect(analysis.citation_rate).toBe(1);
    expect(verifyQuote(docs, "Crowds always panic at closures.")).toBeNull();
    expect(analyzeCitations(UNGROUNDED, docs).citation_success).toBe(false);
  });

  it("detects truncated and corrupted output", () => {
    expect(looksTruncated("A complete sentence.", null)).toBe(false);
    expect(looksTruncated("A complete sentence.", "length")).toBe(true);
    expect(looksTruncated("It stops because,", null)).toBe(true);
    expect(
      looksTruncated(
        "The array of oscillators, each coupled to its neighbour, showed that the",
        null,
      ),
    ).toBe(false);
    expect(corruptionReason("")).toBe("Response too short");
    expect(corruptionReason("Why?")).toBeNull();
    expect(corruptionReason("I disagree with Luca.")).toBeNull();
    expect(
      corruptionReason(
        "The oscillators synchronized within twelve seconds of coupling onset, and the geometry showed that,",
      ),
    ).toBe("Incomplete sentence");
    expect(
      corruptionReason(
        "This long reply never reaches its end because the model stopped mid-clause while",
      ),
    ).toBeNull();
    expect(corruptionReason(GROUNDED)).toBeNull();
  });

  it("strips repeated speaker labels and builds souls with the meeting rules", () => {
    expect(stripAgentPrefix("James: James here, the data say otherwise.", "James")).toBe(
      "the data say otherwise.",
    );
    expect(stripAgentPrefix("I'm Elena and I disagree.", "Elena")).toBe("I disagree.");
    expect(stripAgentPrefix("I'm Elena, the data say otherwise.", "Elena")).toBe(
      "the data say otherwise.",
    );
    expect(stripAgentPrefix("Luca (R.A.I.N. Lab): fields first.", "Luca")).toBe(
      "fields first.",
    );
    for (const member of TEAM) {
      const soul = soulOf(member.name);
      expect(soul).toContain(`You are ONLY ${member.name}.`);
      expect(soul).toContain("Cite sources: [from filename.md]");
    }
    const { context, papers } = libraryContext(documents, 20, 5000);
    expect(papers).toEqual([PAPER]);
    expect(context).toContain(PAPER);
    expect(context.length).toBeLessThan(200);
  });
});
