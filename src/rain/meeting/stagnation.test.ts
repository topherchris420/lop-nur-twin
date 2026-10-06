import { describe, expect, it } from "vitest";
import { sequenceRatio } from "./difflib.js";
import {
  DeadEndDetector,
  MeetingRecoveryController,
  StagnationDetector,
  StagnationMonitor,
} from "./stagnation.js";

/** The epistemic failsafe: Python's difflib ratio, reproduced, and bounded recovery. */
describe("sequence ratio", () => {
  it("matches CPython's SequenceMatcher.ratio, autojunk included", () => {
    const long =
      "the measured resonance peak sits at forty hertz in this simulated setup and the sweep covered thirty to fifty hertz with a fixed load ";
    const longer =
      "the measured resonance peak sits at forty one hertz in this simulated setup and the sweep covered thirty to fifty hertz with a fixed load ";
    const cases: [string, string, number][] = [
      ["abcd", "bcde", 0.75],
      ["the quick brown fox", "the quick brown dog", 0.8947368421052632],
      ["abcabcabc", "cbacbacba", 0.4444444444444444],
      ["", "", 1.0],
      ["a", "", 0.0],
      [long.repeat(3), longer.repeat(3), 0.9852941176470589],
      ["x".repeat(250), "x".repeat(200) + "y".repeat(50), 0.8],
    ];
    for (const [a, b, expected] of cases)
      expect(sequenceRatio(a, b), `${a.slice(0, 20)} / ${b.slice(0, 20)}`).toBeCloseTo(
        expected,
        12,
      );
  });
});

describe("stagnation monitor", () => {
  it("declares a dead end after three consecutive near-identical turns", () => {
    const detector = new DeadEndDetector();
    const line = "The resonance peak is at forty hertz, as the paper says.";
    expect(detector.check(line)).toBe(false);
    expect(detector.check(line)).toBe(false);
    expect(detector.check(line)).toBe(false);
    expect(detector.check(line)).toBe(true);
    detector.reset();
    expect(detector.check(line)).toBe(false);
    expect(detector.check("A different, unrelated argument about field geometry.")).toBe(
      false,
    );
  });

  it("declares stagnation when novelty collapses across the window", () => {
    const detector = new StagnationDetector();
    const line = "Nothing new here, the same point again.";
    const verdicts = Array.from({ length: 6 }, () => detector.check(line));
    expect(verdicts).toEqual([false, false, false, false, false, true]);
    const monitor = new StagnationMonitor();
    for (let i = 0; i < 6; i++) monitor.check(line);
    expect(monitor.check(line)).toEqual({ isDeadEnd: true, isStagnant: true });
    monitor.reset();
    expect(monitor.check(line)).toEqual({ isDeadEnd: false, isStagnant: false });
  });

  it("escalates once per panel round and asks for the summary third", () => {
    const controller = new MeetingRecoveryController(2, 3);
    const flagged = { isDeadEnd: true, isStagnant: false };
    const clear = { isDeadEnd: false, isStagnant: false };
    const first = controller.observe(flagged);
    expect(first?.action).toBe("evidence");
    expect(first?.reason).toBe("dead_end");
    expect(
      first?.prompt.startsWith(
        "SYSTEM OVERRIDE: Adaptive recovery (evidence; dead_end).",
      ),
    ).toBe(true);
    // Cooldown: two turns pass before another action may fire.
    expect(controller.observe(flagged)).toBeNull();
    expect(controller.observe(flagged)).toBeNull();
    expect(controller.observe({ isDeadEnd: false, isStagnant: true })?.action).toBe(
      "alternative",
    );
    expect(controller.observe(flagged)).toBeNull();
    expect(controller.observe(flagged)).toBeNull();
    const third = controller.observe(flagged);
    expect(third?.action).toBe("wrap_up");
    expect(third?.prompt).toContain("final summary");
    // Terminal until reset; a wrap-up turn is never flagged.
    expect(controller.observe(flagged)).toBeNull();
    controller.reset();
    expect(controller.observe(flagged, true)).toBeNull();
    expect(controller.observe(flagged)?.action).toBe("evidence");
    // Sustained varied discussion resets escalation.
    for (let i = 0; i < 3; i++) controller.observe(clear);
    expect(controller.observe(flagged)?.action).toBe("evidence");
    expect(() => new MeetingRecoveryController(0, 1)).toThrow();
  });
});
