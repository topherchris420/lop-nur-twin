import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT, EXIT_FIGURE, exitFigure, exitRecords } from "./echo-exit-figure";

describe("the figure of ECHO leaving building 1011267786", () => {
  it("is what its records draw, byte for byte", () => {
    const kept = readFileSync(join(process.cwd(), EXIT_FIGURE), "utf8");
    expect(exitFigure().svg).toBe(kept);
  }, 60_000);

  it("marks the exit where the witness saw the fly either side of it", () => {
    // EXIT is quoted from the cutover record, not read from these files: hold it to them.
    const { fives } = exitRecords();
    const before = fives.filter((s) => s.tick < EXIT.tick).at(-1)!;
    const after = fives.find((s) => s.tick > EXIT.tick)!;
    expect(after.tick - before.tick).toBeLessThan(200);
    for (const s of [before, after])
      expect(Math.hypot(s.x - EXIT.x, s.z - EXIT.z)).toBeLessThan(0.25);
  });

  it("draws no line across a stretch the journal does not cover", () => {
    const { minutes } = exitRecords();
    const silent = minutes
      .slice(1)
      .map((s, i) => ({ from: minutes[i]!.utc, gap: s.tick - minutes[i]!.tick }))
      .filter((g) => g.gap > 6_000);
    // The one long silence that day, which the figure's note names.
    expect(silent).toEqual([{ from: "2026-11-04T12:19:29Z", gap: 78_643 }]);
    expect(exitFigure().svg).toContain(
      "No positions were recorded from 12:19 to 14:30 UTC",
    );
  }, 60_000);
});
