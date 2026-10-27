import { describe, expect, it } from "vitest";
import { birth, checkpointLife, restoreLife } from "../continuity.js";
import { BETHESDA_LIFE, headlessGenesis } from "../headless.js";
import { prepareMaintenanceContinuation } from "./continuation.js";

const times = {
  pausedFromUtc: "2026-10-27T12:00:00Z",
  preparedUtc: "2026-10-27T12:01:00Z",
};
function source() {
  const g = headlessGenesis(
    { seed: 42, pedestrians: 2, vehicles: 0, buses: 0, statisticalPopulation: 2 },
    "echo",
  );
  const life = BETHESDA_LIFE.build(g);
  life.advanceTicks(30);
  return checkpointLife(BETHESDA_LIFE, life, {
    genesis: g,
    birth: birth(BETHESDA_LIFE.id, g, "0123456789abcdef0123456789abcdef"),
    previous: null,
  });
}

describe("maintenance-only migration dry run", () => {
  it("preserves identity, exact old graph, genesis, body, self-model and tick", () => {
    const old = source(),
      bytes = JSON.stringify(old);
    const candidate = prepareMaintenanceContinuation(old, times);
    expect(JSON.stringify(old)).toBe(bytes);
    expect(candidate.checkpoint.birth).toEqual(old.birth);
    expect(candidate.checkpoint.genesis).toEqual(old.genesis);
    expect(candidate.checkpoint.tick).toBe(old.tick);
    expect(candidate.checkpoint.parent).toBe(old.digest);
    expect(candidate.preservedGraphDigest).toBe(old.graphDigest);
    expect(candidate.originalHash).toBe(old.stateHash);
    expect(candidate.life.selfModelCheckpoint()).toEqual(
      restoreLife(BETHESDA_LIFE, old).selfModelCheckpoint(),
    );
    const back = restoreLife(candidate.kind, candidate.checkpoint);
    candidate.kind.step(candidate.life, 100);
    candidate.kind.step(back, 100);
    expect(candidate.kind.hash(back)).toBe(candidate.kind.hash(candidate.life));
    // The unmodified source can still be restored by its own release.
    expect(BETHESDA_LIFE.hash(restoreLife(BETHESDA_LIFE, old))).toBe(old.stateHash);
  }, 60_000);
  it("refuses corrupt parents, unsupported releases, backwards pauses and repeated upgrades", () => {
    const old = source();
    expect(() =>
      prepareMaintenanceContinuation({ ...old, stateHash: "corrupt" }, times),
    ).toThrow();
    expect(() =>
      prepareMaintenanceContinuation({ ...old, versions: { fly: "unknown" } }, times),
    ).toThrow(/exact/);
    expect(() =>
      prepareMaintenanceContinuation(old, {
        pausedFromUtc: times.preparedUtc,
        preparedUtc: times.pausedFromUtc,
      }),
    ).toThrow(/pause/);
    const c = prepareMaintenanceContinuation(old, times);
    expect(() => prepareMaintenanceContinuation(c.checkpoint, times)).toThrow(/exact/);
    expect(c.kind.history!.transition(c.checkpoint, old)).toEqual([
      "maintenance continuation cannot silently downgrade",
    ]);
  }, 60_000);
});
