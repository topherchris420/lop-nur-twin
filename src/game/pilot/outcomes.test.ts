import { describe, expect, it } from "vitest";
import { OutcomeTracker } from "./outcomes";
import { record } from "../eval/testing/fixtures";

const fresh = () => {
  const r = record({ outcome: null });
  r.execution.placeBound = true;
  return r;
};

describe("outcome windows", () => {
  it("accumulates what happened and closes when the window is up", () => {
    const tracker = new OutcomeTracker(2);
    const r = fresh();
    tracker.begin(r, 10, { targetId: 7, ownsTravel: true });
    tracker.shot();
    tracker.damageDealt(7, 40, false, true);
    tracker.damageDealt(8, 30, true, true);
    tracker.damageTaken(12);
    tracker.exposureSample(true);
    tracker.exposureSample(false);
    tracker.step(11, 1.5);
    expect(r.outcome!.complete).toBe(false);
    tracker.step(12, 0.5);
    const o = r.outcome!;
    expect(o.complete).toBe(true);
    expect(o.elapsedS).toBe(2);
    expect(o).toMatchObject({
      shotsFired: 1,
      hits: 2,
      kills: 1,
      damageDealt: 70,
      damageTaken: 12,
      exposureSamples: 2,
      exposedSamples: 1,
      movedM: 2,
    });
    // Only damage to the bound target counts toward it.
    expect(o.target).toEqual({ hit: true, killed: false, damage: 40 });
    expect(tracker.openCount).toBe(0);
    // Nothing after the window touches it.
    tracker.damageTaken(99);
    expect(r.outcome!.damageTaken).toBe(12);
  });

  it("ends every open window at death, as a known outcome", () => {
    const tracker = new OutcomeTracker(5);
    const a = fresh();
    const b = fresh();
    tracker.begin(a, 0, { targetId: null, ownsTravel: false });
    tracker.begin(b, 1, { targetId: null, ownsTravel: false });
    tracker.death(3);
    expect(a.outcome).toMatchObject({ died: true, timeToDeathS: 3, complete: true });
    expect(b.outcome).toMatchObject({ died: true, timeToDeathS: 2, complete: true });
  });

  it("closes windows as incomplete when the episode ends first", () => {
    const tracker = new OutcomeTracker(5);
    const r = fresh();
    tracker.begin(r, 0, { targetId: null, ownsTravel: false });
    tracker.closeAll(1.5);
    expect(r.outcome).toMatchObject({ complete: false, elapsedS: 1.5 });
  });

  it("credits a travel's end to the decision that started it, not to later ones", () => {
    const tracker = new OutcomeTracker(5);
    const first = fresh();
    const second = fresh();
    tracker.begin(first, 0, { targetId: null, ownsTravel: true });
    tracker.begin(second, 0.2, { targetId: null, ownsTravel: true });
    tracker.travelEnded("arrived");
    expect(first.outcome!.place).toEqual({ reached: false, endReason: null });
    expect(second.outcome!.place).toEqual({ reached: true, endReason: "arrived" });
  });

  it("reads the objective at the start and the end", () => {
    let distance = 50;
    const tracker = new OutcomeTracker(1, () => distance);
    const r = fresh();
    tracker.begin(r, 0, { targetId: null, ownsTravel: false });
    distance = 42;
    tracker.step(1, 0);
    expect(r.outcome).toMatchObject({ objectiveStartM: 50, objectiveEndM: 42 });
  });

  it("reports a provisional copy without closing an open window", () => {
    const tracker = new OutcomeTracker(5);
    const r = fresh();
    tracker.begin(r, 2, { targetId: null, ownsTravel: false });
    const copy = tracker.readOut(r, 3);
    expect(copy).toMatchObject({ complete: false, elapsedS: 1 });
    expect(tracker.openCount).toBe(1);
  });

  it("censors a death window whose nominal end lies past the episode's end", () => {
    // Started at 57 with a 5 s window: it could not have run its full five
    // seconds in a 60 s episode, so it is censored like a window without a
    // death, rather than scored only because it ended in one.
    const tracker = new OutcomeTracker(5);
    const late = fresh();
    tracker.begin(late, 57, { targetId: null, ownsTravel: false });
    tracker.death(58);
    // Read out mid-run, it already says what the episode end would make it.
    expect(tracker.readOut(late, 59)).toMatchObject({ died: true, complete: false });
    tracker.closeAll(60);
    expect(late.outcome).toMatchObject({ died: true, timeToDeathS: 1, complete: false });
  });

  it("keeps a death window complete once its nominal end falls inside the episode", () => {
    const tracker = new OutcomeTracker(5);
    const early = fresh();
    tracker.begin(early, 50, { targetId: null, ownsTravel: false });
    tracker.death(52);
    // The episode runs on past 55, the window's nominal end.
    tracker.step(55, 0);
    expect(tracker.readOut(early, 56)).toMatchObject({ died: true, complete: true });
    tracker.closeAll(60);
    expect(early.outcome).toMatchObject({ died: true, timeToDeathS: 2, complete: true });
  });

  it("treats a death window and a quiet window at the episode's end alike", () => {
    const tracker = new OutcomeTracker(5);
    const quiet = fresh();
    tracker.begin(quiet, 56, { targetId: null, ownsTravel: false });
    tracker.closeAll(58);
    const dying = new OutcomeTracker(5);
    const died = fresh();
    dying.begin(died, 56, { targetId: null, ownsTravel: false });
    dying.death(57);
    dying.closeAll(58);
    expect(quiet.outcome!.complete).toBe(false);
    expect(died.outcome!.complete).toBe(false);
  });
});
