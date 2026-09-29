import { describe, expect, it } from "vitest";
import { formatValue, niceTicks } from "./charts";

describe("chart helpers", () => {
  it("picks round ticks that cover the range", () => {
    expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    const ticks = niceTicks(3.2, 97.1);
    expect(ticks[0]).toBeLessThanOrEqual(3.2);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(97.1 - 1e-9);
    expect(ticks.every((t) => Number.isInteger(t / 20) || Number.isInteger(t / 25))).toBe(
      true,
    );
  });

  it("widens a zero-width range instead of dividing by zero", () => {
    expect(niceTicks(5, 5).length).toBeGreaterThan(1);
    expect(niceTicks(0, 0).length).toBeGreaterThan(1);
  });

  it("returns no ticks for a non-finite range", () => {
    expect(niceTicks(Number.NaN, 1)).toEqual([]);
  });

  it("prints unknown as n/a, never as zero", () => {
    expect(formatValue(null)).toBe("n/a");
    expect(formatValue(undefined)).toBe("n/a");
    expect(formatValue(Number.NaN)).toBe("n/a");
    expect(formatValue(0)).toBe("0.00");
    expect(formatValue(1234.5)).toBe("1,235");
    expect(formatValue(11.434, 3)).toBe("11.4");
    expect(formatValue(-80.664, 3)).toBe("-80.7");
    expect(formatValue(0.1234, 3)).toBe("0.123");
  });
});
