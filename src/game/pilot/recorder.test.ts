import { describe, expect, it } from "vitest";
import { ACTION_CONTRACT_VERSION } from "./contract";
import {
  TRACE_VERSION,
  TraceRecorder,
  fnv1a64,
  hashObservation,
  parseTrace,
  type TraceRecord,
} from "./recorder";
import { makeObservation } from "./testing/fixtures";

function record(sequence: number, actionStart: number | null): TraceRecord {
  const observation = makeObservation({ sequence });
  return {
    type: "decision",
    timestamp: new Date(1_700_000_000_000 + sequence * 250).toISOString(),
    sequence,
    source: "jev",
    observationHash: hashObservation(observation),
    legal: observation.legal,
    frame: {
      move: "FORWARD",
      turn: "TURN_RIGHT_FINE",
      tilt: "NO_TILT",
      weapon: "FIRE",
      target: "NONE",
      aim: "CENTER_MASS",
    },
    axes: null,
    model: "jev-1.13.0",
    latencyMs: 140,
    serverLatencyMs: 95,
    actionStart,
    actionExpiry: actionStart === null ? null : actionStart + 0.4,
    actionEnd: actionStart === null ? null : actionStart + 0.25,
    endReason: actionStart === null ? null : "replaced",
    execution: null,
    playerAfter: null,
    matchId: "m",
    seed: 42,
  };
}

function recorderWith(records: TraceRecord[]): TraceRecorder {
  const recorder = new TraceRecorder();
  recorder.begin({
    brain: "jev",
    seed: 42,
    control: "precision",
    mode: "tdm",
    matchId: "m",
    startedAt: "2026-09-26T00:00:00.000Z",
    build: null,
  });
  for (const r of records) recorder.record(r);
  return recorder;
}

describe("observation hashes", () => {
  it("are stable across key order and sensitive to content", () => {
    const a = makeObservation();
    const reordered = JSON.parse(JSON.stringify(a)) as Record<string, unknown>;
    const swapped = Object.fromEntries(Object.entries(reordered).reverse());
    expect(hashObservation(swapped)).toBe(hashObservation(a));
    expect(hashObservation(makeObservation({ sequence: 2 }))).not.toBe(
      hashObservation(a),
    );
    expect(fnv1a64("")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("traces", () => {
  it("round-trips through JSON Lines", () => {
    const recorder = recorderWith([record(1, 10), record(2, 10.25)]);
    recorder.event({ kind: "timeout", sequence: 3, detail: "no answer in time" });
    const text = recorder.toJsonl();
    const lines = text.trim().split("\n");
    expect(JSON.parse(lines[0]!).traceVersion).toBe(TRACE_VERSION);
    expect(lines).toHaveLength(4);
    const parsed = parseTrace(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.trace.records.map((r) => r.sequence)).toEqual([1, 2]);
      expect(parsed.trace.header.actionContract).toBe(ACTION_CONTRACT_VERSION);
    }
  });

  it("skips decisions that never executed and orders by execution time", () => {
    const text = recorderWith([record(3, 11), record(1, 10), record(2, null)]).toJsonl();
    const parsed = parseTrace(text);
    expect(parsed.ok && parsed.trace.records.map((r) => r.sequence)).toEqual([1, 3]);
  });

  it("rejects incompatible traces cleanly", () => {
    const good = recorderWith([record(1, 10)]).toJsonl();
    const [header, ...rest] = good.trim().split("\n");
    const withHeader = (patch: Record<string, unknown>) =>
      [JSON.stringify({ ...JSON.parse(header!), ...patch }), ...rest].join("\n");
    expect(parseTrace("").ok).toBe(false);
    expect(parseTrace("{not json").ok).toBe(false);
    expect(parseTrace(withHeader({ traceVersion: "blacksite-jev-trace/v0" })).ok).toBe(
      false,
    );
    expect(
      parseTrace(withHeader({ actionContract: "blacksite-jev-actions/v1" })).ok,
    ).toBe(false);
    expect(parseTrace(withHeader({ observationSchema: "x" })).ok).toBe(false);
    // The executed frame, not the legal list that also names FIRE.
    const unknownControl = good.replace('"weapon":"FIRE"', '"weapon":"SELF_DESTRUCT"');
    expect(unknownControl).not.toBe(good);
    const result = parseTrace(unknownControl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("does not know");
  });

  it("stays bounded", () => {
    const recorder = recorderWith([]);
    for (let i = 1; i <= 5010; i += 1) recorder.record(record(i, i));
    expect(recorder.size).toBe(5000);
    expect(recorder.dropped).toBe(10);
  });

  it("never contains anything shaped like a credential", () => {
    const text = recorderWith([record(1, 10)]).toJsonl();
    expect(text).not.toMatch(/apikey_|TYPESAFE|Authorization|Bearer/i);
  });
});
