import { describe, expect, it } from "vitest";
import { birth, checkpointLife, divergence, restoreLife } from "./continuity.js";
import {
  PLASTICITY_EVENT,
  PLASTICITY_LIFE,
  PlasticityOrganismAdapter,
  plasticityProjection,
} from "./plasticOrganism.js";
import { continueWithPlasticity } from "./plasticityContinuation.js";
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

describe("original ECHO, additive plasticity continuation", () => {
  it("preserves the entire prior organism byte for byte, and only then adds a plasticity", () => {
    const { life: before, checkpoint: from } = source();
    const oldState = before.organism.state;
    const oldArchive = JSON.stringify(before.archive);
    const updated = continueWithPlasticity(from, times[1], times[0]);
    expect(updated.checkpoint.birth).toEqual(from.birth);
    expect(updated.checkpoint.genesisDigest).toBe(from.genesisDigest);
    expect(updated.checkpoint.tick).toBe(from.tick);
    expect(updated.checkpoint.parent).toBe(from.digest);
    expect(updated.checkpoint.sequence).toBe(from.sequence + 1);
    expect(updated.preservedGraphDigest).toBe(from.graphDigest);
    expect(updated.checkpoint.events[0]?.kind).toBe(PLASTICITY_EVENT);
    expect(updated.life.adaptive).toBeInstanceOf(PlasticityOrganismAdapter);
    expect(updated.life.adaptive.plasticity.state.samples).toBe(0);
    const recoveredState: Record<string, unknown> = { ...updated.life.adaptive.state };
    delete recoveredState.plasticity;
    expect(recoveredState).toEqual(oldState);
    expect(JSON.stringify(updated.life.archive)).toEqual(oldArchive);
    const fresh = PLASTICITY_LIFE.build(genesis);
    const graph = snapshotGraph(updated.life, indexGraph(fresh));
    expect(plasticityProjection(graph)).toEqual(from.graphDigest);
    const recovered = restoreLife(PLASTICITY_LIFE, updated.checkpoint);
    expect(recovered.adaptive.plasticity.state).toEqual(
      updated.life.adaptive.plasticity.state,
    );
    expect(divergence(PLASTICITY_LIFE, updated.life, recovered, [1, 10])).toBeNull();
  }, 60000);

  it("rejects an already upgraded source and any repeated continuation", () => {
    const { checkpoint: from } = source();
    const { checkpoint } = continueWithPlasticity(from, times[1], times[0]);
    expect(() => continueWithPlasticity(checkpoint, times[1], times[0])).toThrow();
    expect(PLASTICITY_LIFE.history!.transition(checkpoint, checkpoint)).not.toEqual([]);
    const tampered = structuredClone(checkpoint);
    tampered.events = [{ tick: checkpoint.tick, kind: PLASTICITY_EVENT, data: {} }];
    expect(PLASTICITY_LIFE.history!.transition(checkpoint, tampered)).not.toEqual([]);
  }, 60000);
});
