import { describe, expect, it } from "vitest";
import { IDLE_FRAME, type ControlFrame } from "./contract";
import {
  DecisionLoop,
  type AcceptedDecision,
  type DecisionProvider,
  type ProviderResult,
} from "./loop";
import { revalidate, type ExecutionSnapshot } from "./staleness";
import { makeObservation } from "./testing/fixtures";

/**
 * The world changes while a brain decides. These tests stage exactly that —
 * observation, decision under way, the world moves, the answer arrives — and
 * check the answer is judged against the world it arrives in.
 */

const precision = makeObservation({
  control: "precision",
  perception: {
    visibleEnemies: [
      {
        bearingDeg: 2,
        elevationDeg: 0,
        distanceM: 40,
        onCrosshair: false,
        firing: true,
        headVisible: true,
        chestVisible: true,
        lateralMps: 0,
        tracked: false,
      },
    ],
  },
});

function snapshot(overrides: Partial<ExecutionSnapshot> = {}): ExecutionSnapshot {
  return {
    alive: true,
    health: precision.player.health,
    stance: precision.player.stance,
    grounded: true,
    pitchDeg: 0,
    weapon: { ...precision.weapon },
    visibleEnemies: 1,
    targetStillValid: null,
    travelling: false,
    ...overrides,
  };
}

const frame = (overrides: Partial<ControlFrame>): ControlFrame => ({
  ...IDLE_FRAME,
  ...overrides,
});

describe("revalidation at execution", () => {
  it("passes a decision when nothing relevant changed", () => {
    const r = revalidate(precision, frame({ weapon: "FIRE" }), snapshot());
    expect(r).toEqual({ worldChanged: [], illegal: [] });
  });

  it("flags a target that died or left view while the brain decided", () => {
    const r = revalidate(
      precision,
      frame({ target: "TARGET_0", weapon: "ADS_FIRE" }),
      snapshot({ targetStillValid: false, visibleEnemies: 0 }),
    );
    expect(r.illegal).toEqual(["target"]);
    expect(r.worldChanged).toEqual(
      expect.arrayContaining(["target_gone", "enemy_left_view"]),
    );
  });

  it("flags fire on a magazine that emptied in the meantime", () => {
    const r = revalidate(
      precision,
      frame({ weapon: "FIRE" }),
      snapshot({ weapon: { ...precision.weapon, ammo: 0 } }),
    );
    expect(r.illegal).toEqual(["weapon"]);
    expect(r.worldChanged).toContain("weapon_state");
  });

  it("flags a jump chosen on the ground and executed in the air", () => {
    const r = revalidate(
      precision,
      frame({ move: "JUMP" }),
      snapshot({ grounded: false }),
    );
    expect(r.illegal).toEqual(["move"]);
  });

  it("records a world change that leaves the choice legal without flagging it illegal", () => {
    const r = revalidate(
      precision,
      frame({ weapon: "FIRE" }),
      snapshot({ health: 60, visibleEnemies: 2 }),
    );
    expect(r.illegal).toEqual([]);
    expect(r.worldChanged).toEqual(
      expect.arrayContaining(["health_dropped", "enemy_appeared"]),
    );
  });

  it("flags CONTINUE when the travel it would continue has ended", () => {
    const places = makeObservation({
      navigation: "places",
      travel: { kind: "cover", bearingDeg: 10, remainingM: 3 },
    });
    expect(places.legal.go).toContain("CONTINUE");
    const r = revalidate(
      places,
      frame({ go: "CONTINUE" }),
      snapshot({ travelling: false, visibleEnemies: 1 }),
    );
    expect(r.illegal).toEqual(["go"]);
  });

  it("treats every axis as illegal once the seat is dead", () => {
    const r = revalidate(precision, frame({}), snapshot({ alive: false }));
    expect(r.illegal).toHaveLength(7);
    expect(r.worldChanged).toContain("seat_died");
  });
});

describe("a slow brain meets a changing world", () => {
  it("accepts a timely answer, then the host judges it against the world at arrival", async () => {
    // A manual clock: the brain answers when the test says so.
    let now = 0;
    const timers: { at: number; fn: () => void }[] = [];
    const clock = {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => {
        const t = { at: now + ms, fn };
        timers.push(t);
        return t;
      },
      clearTimeout: (handle: unknown) => {
        const i = timers.indexOf(handle as { at: number; fn: () => void });
        if (i >= 0) timers.splice(i, 1);
      },
    };
    let answer: (result: ProviderResult) => void = () => undefined;
    const brain: DecisionProvider = {
      kind: "llm",
      decide: () => new Promise((resolve) => (answer = resolve)),
    };
    const accepted: AcceptedDecision[] = [];
    const loop = new DecisionLoop({
      primary: brain,
      clock,
      onDecision: (d) => accepted.push(d),
    });

    // 1. The observation is captured and the request goes out.
    loop.tick({
      eligible: true,
      lifeId: 1,
      capture: (sequence) => ({ ...precision, sequence }),
    });
    // 2. The brain is deciding. 3. The world moves: the target dies at 600 ms.
    now = 900;
    // 4. The answer arrives, inside the loop's age limit, so the loop accepts it.
    answer({
      ok: true,
      decision: {
        frame: frame({ target: "TARGET_0", weapon: "ADS_FIRE" }),
        axes: null,
        model: "test-double",
        serverLatencyMs: 880,
        usage: null,
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.latencyMs).toBe(900);
    // 5. The host revalidates against the world as it is now: the choice names
    // an enemy that is gone, so under the strict policy it does not execute.
    const verdict = revalidate(
      accepted[0]!.observation,
      accepted[0]!.frame,
      snapshot({ targetStillValid: false, visibleEnemies: 0 }),
    );
    expect(verdict.illegal).toContain("target");
  });

  it("drops an answer that arrives after the age limit before the host sees it", async () => {
    let now = 0;
    const clock = { now: () => now, setTimeout: () => 0, clearTimeout: () => undefined };
    let answer: (result: ProviderResult) => void = () => undefined;
    const events: string[] = [];
    const loop = new DecisionLoop({
      primary: {
        kind: "llm",
        decide: () => new Promise((resolve) => (answer = resolve)),
      },
      clock,
      maxAgeMs: 1500,
      onDecision: () => events.push("accepted"),
      onEvent: (e) => events.push(e.kind === "stale" ? `stale:${e.latencyMs}` : e.kind),
    });
    loop.tick({
      eligible: true,
      lifeId: 1,
      capture: (sequence) => ({ ...precision, sequence }),
    });
    now = 1600;
    answer({
      ok: true,
      decision: {
        frame: IDLE_FRAME,
        axes: null,
        model: null,
        serverLatencyMs: null,
        usage: null,
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["requested", "stale:1600"]);
  });
});
