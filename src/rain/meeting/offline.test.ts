import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CorpusDocument, discoverCorpus, findQuoteSpan } from "../corpus.js";
import corpusData from "../data/corpus.json" with { type: "json" };
import { pySplitlines } from "../text.js";
import {
  AGENT_ROLES,
  DEFAULT_QUESTION,
  type OfflineMeeting,
  buildOfflineMeeting,
  loadCorpus,
  quotesOf,
  verifyMeetingQuotes,
} from "./offline.js";
import { offlineMeetingRecord } from "./record.js";

/**
 * The offline research meeting, ported from R.A.I.N.'s
 * `tests/test_offline_meeting.py`, plus the one check the port exists for:
 * the engine reproduces the prerecorded DEMO meeting word for word.
 */
const QUESTION = "Does phase coherence in coupled oscillators predict synchronization?";

const OSCILLATOR_PAPER = `Coupled Oscillators and Phase Coherence
R.A.I.N._project
Abstract
We study phase coherence in networks of coupled oscillators under weak periodic driving.
In a benchtop array of 64 oscillators, phase coherence rose to 0.91 within 12 seconds of
coupling onset.
The coupling strength required for synchronization scales with the spread of natural frequencies
across the array.
This result does not establish that phase coherence causes synchronization in larger coupled
networks.
A preregistered test would compare phase coherence in the coupled array against an uncoupled
control array under identical driving.
The oscilla-
tors in the phase coherence array were never observed to synchronize without coupling at all.
References
Example, A. Coupled oscillators and phase coherence in synchronization studies. Journal, 1999.
`;

const GEOMETRY_PAPER = `Field Geometry of Synchronization
Abstract
The geometry of the phase field shapes how synchronization spreads through coupled oscillator
networks.
# This paper argues that phase coherence concentrates where the natural frequencies of
neighbouring oscillators overlap across the array.
`;

const corpus = (): CorpusDocument[] => [
  { path: "Coupled Oscillators.md", text: OSCILLATOR_PAPER },
  { path: "Field Geometry.md", text: GEOMETRY_PAPER },
];
const speakers = (m: OfflineMeeting) => new Set(m.turns.map((t) => t.speaker));
const bundled = (): CorpusDocument[] =>
  discoverCorpus(corpusData.files.map((f) => ({ path: f.path, text: f.text })));

describe("offline meeting", () => {
  it("every quote is verbatim at its cited line", () => {
    const docs = corpus();
    const meeting = buildOfflineMeeting(QUESTION, docs);
    expect(meeting.grounding).toBe("strong");
    const quotes = quotesOf(meeting);
    expect(quotes.length).toBeGreaterThan(0);
    for (const quote of quotes) {
      const content = docs.find((d) => d.path === quote.source)!.text;
      expect(findQuoteSpan(content, quote.text)).toEqual([
        quote.spanStart,
        quote.spanEnd,
      ]);
      const firstWord = quote.text.split(/\s+/)[0]!;
      expect(pySplitlines(content)[quote.line - 1]).toContain(firstWord);
    }
    expect(meeting.audit.verified).toBe(meeting.audit.checked);
    expect(meeting.audit.checked).toBe(quotes.length);
  });

  it("all four agents speak in their roles", () => {
    const meeting = buildOfflineMeeting(QUESTION, corpus());
    expect(speakers(meeting)).toEqual(new Set(Object.keys(AGENT_ROLES)));
    expect(meeting.turns[0]!.speaker).toBe("James");
    expect(meeting.turns.at(-1)!.move).toBe("next move");
  });

  it("lenses choose role-appropriate evidence", () => {
    const meeting = buildOfflineMeeting(QUESTION, corpus());
    const byMove = new Map(meeting.turns.map((t) => [t.move, t]));
    expect(
      byMove.get("frame")!.quotes[0]!.text,
      "James anchors on the measured result",
    ).toContain("0.91");
    expect(
      byMove.get("counter-argument")!.quotes[0]!.text,
      "Elena quotes the paper's own caveat",
    ).toContain("does not establish");
    const luca = byMove.get("connection")!.quotes;
    expect(luca, "Luca bridges two different papers").toHaveLength(2);
    expect(luca[0]!.source).not.toBe(luca[1]!.source);
    expect(byMove.get("next move")!.quotes[0]!.text).toContain("preregistered test");
  });

  it("extraction skips PDF debris and references", () => {
    const docs = corpus();
    const quoted = quotesOf(buildOfflineMeeting(QUESTION, docs))
      .map((q) => q.text)
      .join(" ");
    expect(quoted).not.toContain("oscilla- tors");
    expect(quoted).not.toContain("Journal");
    // A body sentence mislabelled as a markdown heading is still quotable, minus the marker.
    const texts = loadCorpus(docs).sentences.map((s) => s.text);
    expect(
      texts.some((t) => t.startsWith("This paper argues that phase coherence")),
    ).toBe(true);
    expect(
      texts.some((t) => t.includes("oscilla- tors") || t.startsWith("Example, A.")),
    ).toBe(false);
  });

  it("Elena finds a low-ranked caveat in a cited paper", () => {
    const paper = {
      path: "Single Paper.md",
      text:
        "Abstract\n" +
        "In a benchtop array of 64 oscillators, phase coherence rose to 0.91 within 12 seconds of coupling.\n" +
        "This result does not establish that phase coherence causes synchronization in larger networks.\n" +
        "Phase coherence across the oscillators decayed within seconds once the coupling was switched off.\n",
    };
    const meeting = buildOfflineMeeting("phase coherence in oscillators", [paper]);
    const elena = meeting.turns.find((t) => t.move === "counter-argument")!;
    expect(elena.quotes.length).toBeGreaterThan(0);
    expect(elena.quotes[0]!.text).toContain("does not establish");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(buildOfflineMeeting(QUESTION, corpus()))).toBe(
      JSON.stringify(buildOfflineMeeting(QUESTION, corpus())),
    );
  });

  it("verifies each quote against its own source, not the first paper that holds it", () => {
    // An earlier-sorted paper carrying the same words must not unverify a quote
    // whose own source holds it verbatim.
    const meeting = buildOfflineMeeting(QUESTION, corpus());
    expect(quotesOf(meeting).length).toBeGreaterThan(0);
    expect(meeting.audit.verified).toBe(meeting.audit.checked);
    const reprint = { path: "000 Reprint.md", text: OSCILLATOR_PAPER + GEOMETRY_PAPER };
    const docs = [reprint, ...corpus()];
    expect(
      quotesOf(meeting).every((q) => findQuoteSpan(reprint.text, q.text) !== null),
    ).toBe(true);
    expect(verifyMeetingQuotes(meeting, docs).every(Boolean)).toBe(true);
    const record = offlineMeetingRecord(meeting, docs, "a".repeat(32), {
      repository: "topherchris420/lop-nur-twin",
      commit: null,
      dirty: null,
    });
    const quotes = record.turns.flatMap((t) => t.quotes);
    expect(quotes.every((q) => q.verified)).toBe(true);
    expect(quotes.filter((q) => q.verified)).toHaveLength(record.audit.verified);
  });

  it("does not dress an off-topic question up as evidence", () => {
    const meeting = buildOfflineMeeting(
      "a social app for roommates who never answer texts",
      corpus(),
    );
    expect(meeting.grounding).toBe("none");
    expect(quotesOf(meeting)).toEqual([]);
    expect(meeting.audit.checked).toBe(0);
    expect(meeting.turns[0]!.coda).toContain("not in our active research context");
    expect(meeting.suggestions.length).toBeGreaterThan(0);
    for (const question of meeting.suggestions)
      expect(question.startsWith("What do we really know about"), question).toBe(true);
  });

  it("runs an empty library without evidence", () => {
    const meeting = buildOfflineMeeting(null, []);
    expect(meeting.question).toBe(DEFAULT_QUESTION);
    expect(meeting.grounding).toBe("none");
    expect(meeting.corpusFiles).toBe(0);
    expect(meeting.suggestions).toEqual([]);
    expect(meeting.turns[0]!.lead).toContain("no paper library");
  });

  it("falls back from the default question to one the library covers", () => {
    const meeting = buildOfflineMeeting(null, corpus());
    expect(meeting.question).not.toBe(DEFAULT_QUESTION);
    expect(meeting.question.startsWith("What do we really know about")).toBe(true);
    expect(meeting.grounding).not.toBe("none");
  });

  it("the bundled corpus grounds the default question", () => {
    const meeting = buildOfflineMeeting(null, bundled());
    expect(meeting.question).toBe(DEFAULT_QUESTION);
    expect(meeting.grounding).toBe("strong");
    expect(speakers(meeting)).toEqual(new Set(Object.keys(AGENT_ROLES)));
    const quotes = quotesOf(meeting);
    expect(new Set(quotes.map((q) => q.source)).size).toBeGreaterThanOrEqual(2);
    expect(meeting.audit.verified).toBe(meeting.audit.checked);
    expect(meeting.audit.checked).toBe(quotes.length);
    expect(quotes.length).toBeGreaterThanOrEqual(3);
  });

  it("reproduces the prerecorded DEMO meeting, word for word and by id", () => {
    const fixture = JSON.parse(
      readFileSync(
        join(__dirname, "..", "..", "bethesda", "rain", "fixtures", "demo-meeting.json"),
        "utf8",
      ),
    ) as Record<string, unknown> & {
      question: string;
      request_id: string;
      rain: { repository: string; commit: string | null; dirty: boolean | null };
      produced_at: string;
      meeting_id: string;
    };
    const docs = bundled();
    const record = offlineMeetingRecord(
      buildOfflineMeeting(fixture.question, docs),
      docs,
      fixture.request_id,
      fixture.rain,
      fixture.produced_at,
    );
    expect(record.meeting_id).toBe(fixture.meeting_id);
    // The engine's name is the runtime's own; everything it produced is the recording's.
    const without = (value: Record<string, unknown>, keys: string[]) =>
      Object.fromEntries(Object.entries(value).filter(([k]) => !keys.includes(k)));
    expect(without(record as unknown as Record<string, unknown>, ["engine"])).toEqual(
      without(fixture, ["engine"]),
    );
  });
});
