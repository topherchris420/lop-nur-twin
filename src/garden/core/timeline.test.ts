import { describe, expect, it } from "vitest";
import { observations, raw, SEQUENCES } from "./fixtures/index.js";
import { parseObservation } from "./observation.js";
import {
  BROADCAST_DELAY_S,
  PresentationClock,
  ServerClock,
  Timeline,
} from "./timeline.js";

const flight = () => observations("stone-to-flowers");

describe("Timeline", () => {
  it("keeps states in order and refuses repeats and stragglers", () => {
    const [a, b, c] = flight();
    const tl = new Timeline();
    expect(tl.push(a!)).toBe("added");
    expect(tl.push(c!)).toBe("added");
    expect(tl.push(b!)).toBe("older");
    expect(tl.push(c!)).toBe("duplicate");
    expect(tl.size).toBe(2);
    expect(tl.latest()).toBe(c);
  });

  it("freezes what it keeps", () => {
    const tl = new Timeline();
    const [a] = flight();
    tl.push(a!);
    expect(Object.isFrozen(tl.latest())).toBe(true);
    expect(Object.isFrozen(tl.latest()!.position)).toBe(true);
    expect(() => {
      (tl.latest()!.position as number[])[0] = 0;
    }).toThrow();
  });

  it("brackets a presented time with the states around it", () => {
    const tl = new Timeline();
    const states = flight();
    for (const o of states) tl.push(o);
    const [a, b] = states;
    const mid = (a!.updatedAt + b!.updatedAt) / 2;
    const iv = tl.at(mid)!;
    expect(iv.prev).toBe(a);
    expect(iv.next).toBe(b);
    expect(iv.tau).toBeCloseTo(0.5, 9);
    expect(iv.late).toBe(0);
    // Exactly at a state's time, that state has just been reached.
    expect(tl.at(b!.updatedAt)!.next).toBe(b);
    expect(tl.at(b!.updatedAt)!.tau).toBe(1);
    expect(tl.stateAt(b!.updatedAt)).toBe(b);
  });

  it("holds the latest state when the next is late, and says how late", () => {
    const tl = new Timeline();
    for (const o of flight()) tl.push(o);
    const last = tl.latest()!;
    const iv = tl.at(last.updatedAt + 2.5)!;
    expect(iv.next).toBe(last);
    expect(iv.tau).toBe(1);
    expect(iv.late).toBeCloseTo(2.5, 9);
  });

  it("animates across a missed tick but not across an outage", () => {
    const tl = new Timeline();
    for (const o of observations("missed-tick")) tl.push(o);
    // 23981 → 23983: ten seconds, still one continuous move.
    const iv = tl.at(tl.latest()!.updatedAt - 5)!;
    expect(iv.next.ticks - iv.prev.ticks).toBe(2);
    expect(iv.discontinuous).toBe(false);
    const late = raw(SEQUENCES["missed-tick"][2]!);
    late.ticks += 100;
    late.updated_at += 500;
    late.server_time = (late.server_time as number) + 500;
    tl.push(parseObservation(late));
    expect(tl.at(tl.latest()!.updatedAt - 1)!.discontinuous).toBe(true);
  });

  it("never blends one life into another", () => {
    const tl = new Timeline();
    const [a, b] = SEQUENCES["stone-to-flowers"];
    tl.push(parseObservation(raw(a!)));
    const other = raw(b!);
    other.life_id = "a-different-life";
    expect(tl.push(parseObservation(other))).toBe("new-life");
    expect(tl.size).toBe(1);
    expect(tl.lifeChanges).toHaveLength(1);
    expect(tl.at(0)!.prev.lifeId).toBe("a-different-life");
  });
});

describe("ServerClock", () => {
  it("estimates the server's clock from the fastest round trip", () => {
    const c = new ServerClock();
    // Server is 100 s ahead; replies take 0.4 s and 0.1 s.
    c.update(1100.2, 1_000_000, 1_000_400);
    c.update(1110, 1_009_950, 1_010_050);
    expect(c.now(1_010_050)! - 1010.05).toBeCloseTo(100, 6);
  });

  it("slews small corrections instead of jumping", () => {
    const c = new ServerClock();
    c.update(1000, 0, 0);
    c.update(1001, 0, 0); // a disagreement of a second, with an equally fast reply
    expect(c.now(0)).toBeCloseTo(1000.25, 9);
  });

  it("knows nothing before the first reply", () => {
    expect(new ServerClock().now(5)).toBeNull();
  });
});

describe("PresentationClock", () => {
  it("runs the broadcast delay behind the server and only forward", () => {
    const p = new PresentationClock();
    expect(p.tick(0, 1000)).toBe(1000 - BROADCAST_DELAY_S);
    let last = p.tick(0, 1000)!;
    // A server estimate that wobbles back by half a second never moves the picture backward.
    for (let ms = 16; ms < 2000; ms += 16) {
      const now = p.tick(ms, 1000 + ms / 1000 - (ms > 800 ? 0.5 : 0))!;
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it("cuts after a long sleep and says so", () => {
    const p = new PresentationClock();
    p.tick(0, 1000);
    expect(p.jumped).toBe(false);
    p.tick(16, 1300);
    expect(p.jumped).toBe(true);
    expect(p.tick(16, 1300)).toBe(1300 - BROADCAST_DELAY_S);
  });
});
