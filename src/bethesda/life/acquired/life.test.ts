import { describe, expect, it } from "vitest";
import { sha256 } from "../../../rain/sha256.js";
import { birth, checkpointLife, divergence, restoreLife } from "../continuity.js";
import { BETHESDA_LIFE, headlessGenesis } from "../headless.js";
import { Graph } from "../echoUpgrade.js";
import { ORGANISM_ADAPTER_PATH, ORGANISM_LIFE } from "../organism.js";
import { indexGraph, snapshotGraph, type GraphSnapshot } from "../snapshot.js";
import {
  ACQUIRED_EVENT,
  ACQUIRED_LIFE,
  acquiredProjection,
  continueWithAcquiredSearch,
} from "./life.js";

const genesis = headlessGenesis({
  seed: 193884,
  pedestrians: 1,
  vehicles: 0,
  buses: 0,
  statisticalPopulation: 4,
});
const times = ["2026-11-02T12:00:00.000Z", "2026-11-02T12:00:10.000Z"] as const;

function source(ticks = 20) {
  const life = ORGANISM_LIFE.build(genesis);
  life.advanceTicks(ticks);
  const b = birth(BETHESDA_LIFE.id, genesis, "0fedcba9876543210fedcba987654321");
  return {
    life,
    checkpoint: checkpointLife(ORGANISM_LIFE, life, {
      genesis,
      birth: b,
      previous: null,
    }),
  };
}

describe("the same individual, with acquired search", () => {
  it("holds its source byte for byte, and starts knowing nothing", () => {
    const { checkpoint: from, life: before } = source();
    const next = continueWithAcquiredSearch(from, times[1], times[0]);
    expect(next.checkpoint.birth).toEqual(from.birth);
    expect(next.checkpoint.genesisDigest).toBe(from.genesisDigest);
    expect(next.checkpoint.tick).toBe(from.tick);
    expect(next.checkpoint.parent).toBe(from.digest);
    expect(next.checkpoint.sequence).toBe(from.sequence + 1);
    expect(next.preservedGraphDigest).toBe(from.graphDigest);
    expect(next.checkpoint.events.map((e) => e.kind)).toEqual([ACQUIRED_EVENT]);
    expect(JSON.stringify(next.life.archive)).toBe(JSON.stringify(before.archive));
    const fresh = ACQUIRED_LIFE.build(genesis);
    expect(acquiredProjection(snapshotGraph(next.life, indexGraph(fresh)))).toBe(
      from.graphDigest,
    );
    const s = next.life.acquired.search;
    expect(s.state.meals).toBe(0);
    expect(s.lifts().every((v) => v === 0)).toBe(true);
    const back = restoreLife(ACQUIRED_LIFE, next.checkpoint);
    expect(back.acquired.search.state).toEqual(s.state);
    expect(divergence(ACQUIRED_LIFE, next.life, back, [1, 10])).toBeNull();
  }, 120_000);

  it("carries what it has learned through a checkpoint and a restore", () => {
    const { checkpoint: from } = source();
    const next = continueWithAcquiredSearch(from, times[1], times[0]);
    const g = next.life.acquired.search.state;
    g.meals = 7;
    g.mealsIn[0] = 5;
    g.mealsOut[0] = 1;
    g.timeIn[0] = 2000;
    g.timeOut[0] = 3000;
    next.life.advanceTicks(30);
    const later = checkpointLife(ACQUIRED_LIFE, next.life, {
      genesis,
      birth: next.checkpoint.birth,
      previous: next.checkpoint,
    });
    const back = restoreLife(ACQUIRED_LIFE, later);
    expect(back.acquired.search.state).toEqual(g);
    expect(back.acquired.search.lift(0)).toBeGreaterThan(0);
    expect(back.acquired.search.lifts()).toEqual(next.life.acquired.search.lifts());
    expect(divergence(ACQUIRED_LIFE, next.life, back, [1, 10])).toBeNull();
  }, 120_000);

  it("refuses a birth, a repeat, a forged parent and going back", () => {
    const { checkpoint: from } = source();
    const { checkpoint } = continueWithAcquiredSearch(from, times[1], times[0]);
    const T = ACQUIRED_LIFE.history!.transition;
    expect(T(null, checkpoint)).not.toEqual([]);
    expect(() => continueWithAcquiredSearch(checkpoint, times[1], times[0])).toThrow();
    const repeated = structuredClone(checkpoint);
    expect(T(checkpoint, repeated)).not.toEqual([]);
    const forged = structuredClone(checkpoint);
    forged.events[0]!.data.parent = "0".repeat(64);
    expect(T(from, forged)).not.toEqual([]);
    expect(T(checkpoint, from)).not.toEqual([]);
    const tampered = structuredClone(checkpoint);
    const changed = new Graph(tampered.graph!);
    changed.set([...ORGANISM_ADAPTER_PATH, "added"], 1);
    tampered.graph = changed.snapshot;
    expect(T(from, tampered)).not.toEqual([]);
  }, 120_000);

  it("steps exactly as the organism until its own meals entitle it to act", () => {
    const { checkpoint: from } = source();
    const a = restoreLife(ORGANISM_LIFE, from);
    const { life: b } = continueWithAcquiredSearch(from, times[1], times[0]);
    const search = b.acquired.search;
    const index = () => indexGraph(ACQUIRED_LIFE.build(genesis));
    const whole = (graph: GraphSnapshot) =>
      sha256(JSON.stringify(new Graph(graph).canonical()));
    let compared = 0;
    // Everything but the addition, not a hash of part of it: positions, memories,
    // weights, physiology and every random stream's position.
    for (let i = 0; i < 40 && search.state.meals < 3; i++) {
      a.advanceTicks(300);
      b.advanceTicks(300);
      expect(acquiredProjection(snapshotGraph(b, index()))).toBe(
        whole(snapshotGraph(a, indexGraph(ORGANISM_LIFE.build(genesis)))),
      );
      compared += 300;
    }
    expect(compared).toBeGreaterThanOrEqual(300);
    // What it has by then is real evidence that the layer has been counting.
    expect(search.state.timeIn.some((v) => v > 0)).toBe(true);
  }, 300_000);
});
