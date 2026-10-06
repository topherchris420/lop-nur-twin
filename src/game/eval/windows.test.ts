import { describe, expect, it } from "vitest";
import { outcome, record } from "./testing/fixtures";
import { disjointWindows, overlapCounts, windowSpans } from "./windows";

const at = (start: number | null, elapsedS = 5) =>
  record({
    execution: { ...record().execution, actionStart: start },
    outcome: outcome({ elapsedS }),
  });

describe("outcome windows", () => {
  it("are the executed decisions' windows, in start order", () => {
    const late = at(1);
    const early = at(0.5);
    const short = at(2, 1.5);
    expect(
      windowSpans([late, at(null), record({ outcome: null }), early, short]),
    ).toEqual([
      { sequence: early.sequence, start: 0.5, end: 5.5 },
      { sequence: late.sequence, start: 1, end: 6 },
      { sequence: short.sequence, start: 2, end: 3.5 },
    ]);
  });

  it("count the other decisions each window shares time with", () => {
    // A decision every 0.25 s, each with a 5 s window.
    const records = Array.from({ length: 81 }, (_, i) => at(i * 0.25));
    const counts = overlapCounts(windowSpans(records));
    // [10, 15) shares time with every window that starts after 5 and before 15.
    expect(counts.get(records[40]!.sequence)).toBe(38);
    expect(counts.get(records[0]!.sequence)).toBe(19);
    expect(counts.get(records[80]!.sequence)).toBe(19);
    // A window that ends as another begins shares nothing with it.
    const [a, b] = [at(0), at(5)];
    expect(overlapCounts(windowSpans([a, b]))).toEqual(
      new Map([
        [a.sequence, 0],
        [b.sequence, 0],
      ]),
    );
  });

  it("thin to windows that share no time, by start time alone", () => {
    const records = Array.from({ length: 81 }, (_, i) => at(i * 0.25));
    const kept = disjointWindows(windowSpans(records));
    expect([...kept]).toEqual([0, 20, 40, 60, 80].map((i) => records[i]!.sequence));
    // The outcomes play no part: different outcomes at the same times keep the same decisions.
    const died = records.map((r) => ({ ...r, outcome: { ...r.outcome!, died: true } }));
    expect([...disjointWindows(windowSpans(died))]).toEqual([...kept]);
    // A window cut short by the episode's end frees the time after it.
    expect([...disjointWindows(windowSpans([at(0, 1), at(1), at(2)]))]).toHaveLength(2);
  });
});
