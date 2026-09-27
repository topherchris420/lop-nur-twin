import { describe, expect, it } from "vitest";
import { Debrief, mergeDebriefs } from "./debrief";

const place = { rangeM: 80, openGround: true, place: "Main Apron" };

describe("the debrief", () => {
  it("classes a death to an enemy never in view as unseen", () => {
    const debrief = new Debrief();
    for (let t = 0; t < 3; t += 0.1) {
      debrief.sample(t, 0.1, [{ id: 7, inView: false, exposedTo: true }]);
    }
    const death = debrief.onDeath(3, { id: 7, name: "VOSS" }, place);
    expect(death.cls).toBe("unseen");
    expect(death.seenForS).toBe(0);
    expect(death.exposedToKillerS).toBeCloseTo(3, 5);
  });

  it("separates seen-but-not-engaged from an exchange that was lost", () => {
    const debrief = new Debrief();
    debrief.sample(0, 0.5, [
      { id: 7, inView: true, exposedTo: true },
      { id: 8, inView: true, exposedTo: true },
    ]);
    debrief.onEngaged(8);
    expect(debrief.onDeath(1, { id: 7, name: "VOSS" }, place).cls).toBe(
      "seen_not_engaged",
    );
    // A new life starts clean: 8 was engaged in the previous one only.
    debrief.sample(2, 0.5, [{ id: 8, inView: true, exposedTo: true }]);
    expect(debrief.onDeath(3, { id: 8, name: "PIKE" }, place).cls).toBe(
      "seen_not_engaged",
    );
    debrief.sample(4, 0.5, [{ id: 8, inView: true, exposedTo: true }]);
    debrief.onEngaged(8);
    expect(debrief.onDeath(5, { id: 8, name: "PIKE" }, place).cls).toBe("engaged");
    const summary = debrief.summary();
    expect(summary.deaths).toMatchObject({
      total: 3,
      seen_not_engaged: 2,
      engaged: 1,
      unseen: 0,
      onOpenGround: 3,
    });
  });

  it("a death with no living attacker is 'other', never guessed", () => {
    const debrief = new Debrief();
    expect(debrief.onDeath(1, null, { ...place, rangeM: null }).cls).toBe("other");
  });

  it("measures exposure and its longest unbroken stretch", () => {
    const debrief = new Debrief();
    const pattern = [true, true, true, false, true, false, false, true, true];
    pattern.forEach((exposed, i) =>
      debrief.sample(i, 1, [{ id: 3, inView: false, exposedTo: exposed }]),
    );
    const summary = debrief.summary();
    expect(summary.aliveSeconds).toBe(9);
    expect(summary.exposedSeconds).toBe(6);
    expect(summary.exposedFraction).toBeCloseTo(6 / 9, 9);
    expect(summary.longestExposedS).toBe(3);
  });

  it("times kills from first sight, and counts kills of enemies never seen", () => {
    const debrief = new Debrief();
    debrief.sample(10, 0.1, [{ id: 4, inView: true, exposedTo: false }]);
    debrief.onKill(11.5, 4, 90);
    debrief.onKill(12, 5, 20);
    const summary = debrief.summary();
    expect(summary.kills.total).toBe(2);
    expect(summary.kills.unseenVictims).toBe(1);
    expect(summary.kills.meanSightToKillS).toBeCloseTo(1.5, 9);
  });

  it("reports nothing as zero that was never measured", () => {
    const summary = new Debrief().summary();
    expect(summary.exposedFraction).toBeNull();
    expect(summary.kills.meanSightToKillS).toBeNull();
  });

  it("pools episodes with sums and a kill-weighted mean", () => {
    const a = new Debrief();
    a.sample(0, 2, [{ id: 1, inView: true, exposedTo: true }]);
    a.onKill(1, 1, 50); // 1 s from sight
    const b = new Debrief();
    b.sample(0, 2, [{ id: 2, inView: true, exposedTo: false }]);
    b.onKill(3, 2, 50); // 3 s
    b.sample(4, 0.1, [{ id: 3, inView: true, exposedTo: false }]);
    b.onKill(7, 3, 50); // 3 s
    const merged = mergeDebriefs([a.summary(), b.summary()]);
    expect(merged.aliveSeconds).toBeCloseTo(4.1, 9);
    expect(merged.exposedSeconds).toBe(2);
    expect(merged.kills.total).toBe(3);
    expect(merged.kills.meanSightToKillS).toBeCloseTo(7 / 3, 9);
  });
});
