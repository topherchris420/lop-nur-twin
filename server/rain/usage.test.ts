import { describe, expect, it } from "vitest";
import { UsageLedger } from "./usage";

describe("the route's usage ledger", () => {
  it("counts a key within its window, which opens at its first use", () => {
    const ledger = new UsageLedger(1000, 10);
    ledger.record("a", 0);
    ledger.record("a", 400);
    expect(ledger.get("a", 999)).toEqual({ since: 0, last: 400, count: 2 });
    // The window does not slide with use: it closes 1000 after it opened.
    expect(ledger.get("a", 1000)).toBeUndefined();
    ledger.record("a", 1000);
    expect(ledger.get("a", 1000)).toEqual({ since: 1000, last: 1000, count: 1 });
  });
  it("makes room by forgetting the least recently used key, never every key", () => {
    const ledger = new UsageLedger(60_000, 3);
    for (let i = 0; i < 5; i++) ledger.record("capped", i);
    ledger.record("b", 10);
    ledger.record("c", 20);
    ledger.record("capped", 30);
    // Full: "b" is now the least recently used, and only it goes.
    ledger.record("d", 40);
    expect(ledger.size).toBe(3);
    expect(ledger.get("b", 40)).toBeUndefined();
    expect(ledger.get("capped", 40)?.count).toBe(6);
    // A flood of new keys pushes keys out one at a time, oldest first.
    for (let i = 0; i < 2; i++) ledger.record(`flood${i}`, 50 + i);
    expect(ledger.get("capped", 60)).toBeUndefined();
    expect(ledger.size).toBe(3);
  });
  it("forgets keys whose window has closed before it forgets a recent one", () => {
    const ledger = new UsageLedger(1000, 3);
    ledger.record("old", 0);
    ledger.record("recent", 900);
    ledger.record("newer", 950);
    ledger.record("old", 960);
    // "old" was used last, but its window opened at 0 and has closed by 1500.
    ledger.record("new", 1500);
    expect(ledger.get("old", 1500)).toBeUndefined();
    expect(ledger.get("recent", 1500)?.count).toBe(1);
    expect(ledger.get("newer", 1500)?.count).toBe(1);
    expect(ledger.size).toBe(3);
  });
});
