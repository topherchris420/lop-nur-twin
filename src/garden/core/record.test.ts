import { describe, expect, it } from "vitest";
import { observations } from "./fixtures/index.js";
import { observationIn, observationRecord } from "./record.js";
import { Timeline } from "./timeline.js";

describe("portable garden observations", () => {
  const [first, second] = observations("stone-to-flowers");
  const timeline = () => {
    const t = new Timeline();
    t.push(first!);
    t.push(second!);
    return t;
  };

  it("keeps the displayed facts on the earlier state until the next step is reached", () => {
    const t = timeline();
    const at = (first!.updatedAt + second!.updatedAt) / 2;
    const paused = t.at(at);
    expect(observationIn(paused)).toBe(t.stateAt(at));
    expect(observationIn(paused)).toBe(first);
    expect(observationIn(t.at(second!.updatedAt))).toBe(second);
    expect(observationIn(null)).toBeNull();
    t.push({ ...second!, lifeId: "different-individual" });
    expect(observationIn(paused)).toBe(first);
  });

  it("exports actual states and separates local time, server time and presentation", () => {
    const at = (first!.updatedAt + second!.updatedAt) / 2;
    const t = timeline();
    const before = JSON.stringify([first, second]);
    const record = observationRecord({
      interval: t.at(at)!,
      presentedAt: at,
      paused: true,
      exportedAt: "2026-10-30T12:00:00.000Z",
      source: "https://example.test/api/state",
      connection: "reconnecting",
    });
    const parsed = JSON.parse(JSON.stringify(record));
    expect(parsed.observation).toEqual(first);
    expect(parsed.nextObservation).toEqual(second);
    expect(parsed.presentation).toMatchObject({
      at,
      paused: true,
      connection: "reconnecting",
      interpolation: 0.5,
    });
    expect(parsed.exportedAt).not.toBe(parsed.observation.serverTime);
    expect(record.scope).toContain("Not a checkpoint");
    expect(JSON.stringify([first, second])).toBe(before);
  });

  it("keeps missing fields null and preserves a held state during an outage", () => {
    const t = new Timeline();
    t.push({ ...first!, learning: null, needs: null, momentsCount: null });
    const record = observationRecord({
      interval: t.at(first!.updatedAt + 200)!,
      presentedAt: first!.updatedAt + 200,
      paused: false,
      exportedAt: "2026-10-30T12:00:00.000Z",
      source: "https://example.test/api/state",
      connection: "offline",
    });
    expect(record.observation).toMatchObject({
      learning: null,
      needs: null,
      momentsCount: null,
      updatedAt: first!.updatedAt,
    });
    expect(record.nextObservation).toBeNull();
    expect(record.presentation.lateSeconds).toBe(200);
  });
});
