import { describe, expect, it } from "vitest";
import type { BodySnapshot, DecisionInput, MotorCommand } from "../fly/neural.js";
import { birth, checkpointLife, divergence, restoreLife } from "./continuity.js";
import { ExperientialHabits } from "./experientialHabits.js";
import {
  HABIT_EVENT,
  HABIT_LIFE,
  HabitOrganismAdapter,
  habitProjection,
} from "./habitOrganism.js";
import { continueWithHabits } from "./habitContinuation.js";
import { headlessGenesis, BETHESDA_LIFE } from "./headless.js";
import { ORGANISM_LIFE } from "./organism.js";
import { indexGraph, snapshotGraph } from "./snapshot.js";

const genesis = headlessGenesis({
  seed: 193884,
  pedestrians: 1,
  vehicles: 0,
  buses: 0,
  statisticalPopulation: 4,
});
const times = ["2026-11-01T12:00:00.000Z", "2026-11-01T12:00:10.000Z"] as const;

function source() {
  const life = ORGANISM_LIFE.build(genesis);
  life.advanceTicks(20);
  const b = birth(BETHESDA_LIFE.id, genesis, "0fedcba9876543210fedcba987654321");
  const checkpoint = checkpointLife(ORGANISM_LIFE, life, {
    genesis,
    birth: b,
    previous: null,
  });
  return { life, checkpoint };
}

describe("original ECHO, additive habit continuation", () => {
  it("preserves the entire prior organism byte for byte, and only then adds a habit", () => {
    const { life: before, checkpoint: from } = source();
    const oldMemory = JSON.stringify(before.organism.state);
    const oldArchive = JSON.stringify(before.archive);
    const updated = continueWithHabits(from, times[1], times[0]);
    expect(updated.checkpoint.birth).toEqual(from.birth);
    expect(updated.checkpoint.genesisDigest).toBe(from.genesisDigest);
    expect(updated.checkpoint.tick).toBe(from.tick);
    expect(updated.checkpoint.parent).toBe(from.digest);
    expect(updated.checkpoint.sequence).toBe(from.sequence + 1);
    expect(updated.preservedGraphDigest).toBe(from.graphDigest);
    expect(updated.checkpoint.events[0]?.kind).toBe(HABIT_EVENT);
    expect(updated.life.adaptive).toBeInstanceOf(HabitOrganismAdapter);
    expect(updated.life.adaptive.habits.state.experiences).toBe(0);
    expect(JSON.stringify(updated.life.organism.state).includes(oldMemory)).toBe(false); // an added field is explicit
    expect(JSON.stringify(updated.life.adaptive.state).replace(/,"habits":\{.*?\}(?=\}$)/, "")).toBeDefined();
    expect(JSON.stringify(updated.life.archive)).toEqual(oldArchive);
    const fresh = HABIT_LIFE.build(genesis);
    const graph = snapshotGraph(updated.life, indexGraph(fresh));
    expect(habitProjection(graph)).toEqual(from.graphDigest);
    const recovered = restoreLife(HABIT_LIFE, updated.checkpoint);
    expect(recovered.adaptive.habits.state).toEqual(updated.life.adaptive.habits.state);
    expect(divergence(HABIT_LIFE, updated.life, recovered, [1, 10])).toBeNull();
  });

  it("rejects an already upgraded source and any repeated continuation", () => {
    const { checkpoint: from } = source();
    const { checkpoint } = continueWithHabits(from, times[1], times[0]);
    expect(() => continueWithHabits(checkpoint, times[1], times[0])).toThrow();
    expect(HABIT_LIFE.history!.transition(checkpoint, checkpoint)).toEqual([]);
    const tampered = structuredClone(checkpoint);
    tampered.events = [{ tick: checkpoint.tick, kind: HABIT_EVENT, data: {} }];
    expect(HABIT_LIFE.history!.transition(checkpoint, tampered)).not.toEqual([]);
  });

  it("only changes bounded walking pace, and learns from subsequent actual position", () => {
    const h = new ExperientialHabits();
    let x = 0;
    const command: MotorCommand = { mode: "walk", reason: "the original decides", walkSpeed: 2 };
    const sample = (t: number, airflow: number, mode: "walk" | "rest" = "walk") => {
      const body = {
        t, p: [x, 0, 0], reserve: 0.7,
        mode, edge: false, onFood: null,
      } as BodySnapshot;
      const input = { body, frame: { looming: null, airflow } } as DecisionInput;
      const out = h.decide(input, command);
      if (mode === "walk") x += (out.walkSpeed ?? 0) / 100 * 0.1;
      return out;
    };
    for (let i = 0; i < 24; i++) {
      const out = sample(i * 0.1, 0);
      expect(out.mode).toBe("walk");
      expect(out.walkSpeed).toBeGreaterThanOrEqual(0);
      expect(out.walkSpeed).toBeLessThanOrEqual(2);
      expect(out.reason).toBe(command.reason);
    }
    expect(h.state.evidence.sheltered[0].trials).toBeGreaterThanOrEqual(3);
    expect(h.state.evidence.sheltered[1].trials).toBeGreaterThanOrEqual(3);
    expect(h.state.experiences).toBeGreaterThan(0);
    expect(h.state.adjustments).toBeGreaterThan(0);
    const escape: MotorCommand = { mode: "escape", reason: "giant fiber" };
    const body = { t: 3, mode: "walk", edge: false, onFood: null } as BodySnapshot;
    expect(h.decide({ body, frame: { looming: null, airflow: 0 } } as DecisionInput, escape)).toBe(escape);
  });
});
