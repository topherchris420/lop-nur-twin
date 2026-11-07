/**
 * The recorded continuation of the deployed ECHO organism onto embodied
 * plasticity, and its policy changes. The source is a fixture: a real one is
 * only written by the release on the VM, which is what the rehearsal on the
 * deployed fly's backup is for (scripts/bethesda-life-rehearse-plasticity.ts).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sha256, sha256Json } from "../../rain/sha256.js";
import {
  birth,
  checkpointLife,
  divergence,
  historicalCheckpointErrors,
  restoreLife,
  type LifeCheckpoint,
  type LifeKind,
} from "./continuity.js";
import { Graph } from "./echoUpgrade.js";
import { HABIT_LIFE } from "./habitOrganism.js";
import { BETHESDA_LIFE, headlessGenesis, type HeadlessGenesis } from "./headless.js";
import { ORGANISM_LIFE, type OrganismLife } from "./organism.js";
import {
  PLASTICITY_CONTINUATION_SOURCE,
  PLASTICITY_EVENT,
  PLASTICITY_LIFE,
  PLASTICITY_MODE_LEAF,
  PLASTICITY_POLICY_EVENT,
  PlasticityOrganismAdapter,
  plasticityModeOf,
  plasticityProjection,
  plasticitySourceErrors,
  type PlasticityOrganismLife,
} from "./plasticOrganism.js";
import {
  changePlasticityPolicy,
  continueWithPlasticity,
} from "./plasticityContinuation.js";
import { indexGraph, snapshotGraph } from "./snapshot.js";
import { LifeStore } from "./store.js";
import { parseObservation } from "./observation.js";

type Checkpoint = LifeCheckpoint<HeadlessGenesis>;
const genesis = headlessGenesis({
  seed: 193884,
  pedestrians: 1,
  vehicles: 0,
  buses: 0,
  statisticalPopulation: 4,
});
const stopped = "2026-11-08T12:00:00.000Z",
  upgraded = "2026-11-08T12:10:00.000Z",
  later = "2026-11-09T12:00:00.000Z";
const NONCE = "0fedcba9876543210fedcba987654321";

/** An organism on this release's fly, as the deployed one is since the physics repair. */
function source(ticks = 20): { life: OrganismLife; checkpoint: Checkpoint } {
  const life = ORGANISM_LIFE.build(structuredClone(genesis));
  life.advanceTicks(ticks);
  const checkpoint = checkpointLife(ORGANISM_LIFE, life, {
    genesis,
    birth: birth(BETHESDA_LIFE.id, genesis, NONCE),
    previous: null,
  });
  return { life, checkpoint };
}

/** A checkpoint with its digests made true again: what forging one takes. */
function reseal(c: Checkpoint): Checkpoint {
  if (c.graph) c.graphDigest = sha256(JSON.stringify(c.graph));
  const { digest: _digest, graph: _graph, ...header } = c;
  c.digest = sha256Json(header);
  return c;
}

const digestOf = (life: object, kind: LifeKind<HeadlessGenesis, object>) =>
  sha256(
    JSON.stringify(snapshotGraph(life, indexGraph(kind.build(structuredClone(genesis))))),
  );

/** The counters that must never go back. */
function counters(life: OrganismLife) {
  const fly = life.cityFly.fly.state.counts;
  const a = life.organism;
  return {
    tick: life.city.tick,
    meals: fly.meals,
    escapes: fly.escapes,
    walkedM: fly.walkedM,
    spentJ: fly.spentJ,
    trials: a.circuit.state.trials,
    inquiries: a.model!.state.counts.inquiries,
    recoveryBouts: a.physiology.state.recoveryBouts,
    maintenanceJ: a.physiology.state.maintenanceJ,
  };
}

// Each test builds a city and its fly and restores it at least once.
describe("the plasticity continuation of the deployed ECHO organism", () => {
  it("is the same individual: birth, genesis, tick and every old byte preserved; it starts empty in shadow mode", () => {
    const { life: before, checkpoint: from } = source();
    const oldState = JSON.parse(JSON.stringify(before.organism.state)) as object;
    const oldArchive = JSON.stringify(before.archive);
    const updated = continueWithPlasticity(from, upgraded, stopped);
    const c = updated.checkpoint;
    expect(c.birth).toEqual(from.birth);
    expect(c.birth.individual).toBe(from.birth.individual);
    expect(c.genesisDigest).toBe(from.genesisDigest);
    expect(c.tick).toBe(from.tick);
    expect(c.parent).toBe(from.digest);
    expect(c.sequence).toBe(from.sequence + 1);
    expect(c.events).toHaveLength(1);
    expect(c.events[0]).toMatchObject({
      kind: PLASTICITY_EVENT,
      tick: from.tick,
      data: { sourceRelease: PLASTICITY_CONTINUATION_SOURCE, mode: "shadow" },
    });
    expect(updated.preservedGraphDigest).toBe(from.graphDigest);
    expect(plasticityProjection(c.graph!)).toBe(from.graphDigest);
    expect(plasticityModeOf(c.graph!)).toBe("shadow");
    expect(updated.life.adaptive).toBeInstanceOf(PlasticityOrganismAdapter);
    const p = updated.life.adaptive.plasticity.state;
    expect([p.samples, p.discarded, p.adaptations, p.mode]).toEqual([0, 0, 0, "shadow"]);
    const kept = JSON.parse(JSON.stringify(updated.life.adaptive.state)) as Record<
      string,
      unknown
    >;
    delete kept.plasticity;
    expect(kept).toEqual(oldState);
    expect(JSON.stringify(updated.life.archive)).toEqual(oldArchive);
    expect(counters(updated.life)).toEqual(counters(before));
    const recovered = restoreLife(PLASTICITY_LIFE, c);
    expect(recovered.adaptive.plasticity.state).toEqual(p);
    expect(divergence(PLASTICITY_LIFE, updated.life, recovered, [1, 10])).toBeNull();
  }, 120000);

  it("in shadow mode, lives on exactly as the organism would have: everything but the addition, RNG streams included", () => {
    const { checkpoint: from } = source();
    const original = restoreLife(ORGANISM_LIFE, from);
    const continued = continueWithPlasticity(from, upgraded, stopped).life;
    for (const ticks of [300, 300, 600]) {
      ORGANISM_LIFE.step(original, ticks);
      PLASTICITY_LIFE.step(continued, ticks);
      const projected = plasticityProjection(
        snapshotGraph(
          continued,
          indexGraph(PLASTICITY_LIFE.build(structuredClone(genesis))),
        ),
      );
      expect(projected).toBe(digestOf(original, ORGANISM_LIFE));
      expect(ORGANISM_LIFE.hash(original).split("|")[0]).toBe(
        ORGANISM_LIFE.hash(continued).split("|")[0],
      );
      expect(JSON.stringify(continued.archive)).toBe(JSON.stringify(original.archive));
    }
    expect(counters(continued)).toEqual(counters(original));
  }, 180000);

  it("keeps what it learned through a stop and a start, and the counters only grow", () => {
    const { checkpoint: from } = source();
    const first = continueWithPlasticity(from, upgraded, stopped);
    const life = first.life;
    const start = counters(life);
    PLASTICITY_LIFE.step(life, 1200);
    const grown = counters(life);
    for (const [k, v] of Object.entries(start))
      expect(grown[k as keyof typeof grown]).toBeGreaterThanOrEqual(v);
    const c = checkpointLife(PLASTICITY_LIFE, life, {
      genesis,
      birth: first.checkpoint.birth,
      previous: first.checkpoint,
      events: life.takeArchive(),
    });
    expect(PLASTICITY_LIFE.history!.transition(first.checkpoint, c)).toEqual([]);
    const restarted = restoreLife(PLASTICITY_LIFE, c);
    expect(restarted.adaptive.plasticity.state).toEqual(life.adaptive.plasticity.state);
    expect(divergence(PLASTICITY_LIFE, life, restarted, [1, 10, 100])).toBeNull();
  }, 180000);

  it("refuses a repeated continuation, a forged one, and the wrong source release", () => {
    const { checkpoint: from } = source();
    const { checkpoint } = continueWithPlasticity(from, upgraded, stopped);
    expect(() => continueWithPlasticity(checkpoint, upgraded, stopped)).toThrow();
    expect(PLASTICITY_LIFE.history!.transition(checkpoint, checkpoint)).not.toEqual([]);
    const tampered = structuredClone(checkpoint);
    tampered.events = [{ tick: checkpoint.tick, kind: PLASTICITY_EVENT, data: {} }];
    expect(PLASTICITY_LIFE.history!.transition(checkpoint, reseal(tampered))).not.toEqual(
      [],
    );
    const otherRelease = structuredClone(checkpoint);
    otherRelease.events[0]!.data.sourceRelease = "0".repeat(40);
    expect(PLASTICITY_LIFE.history!.transition(from, reseal(otherRelease))).not.toEqual(
      [],
    );
    const active = structuredClone(checkpoint);
    new Graph(active.graph!, false).set(PLASTICITY_MODE_LEAF, "active");
    expect(PLASTICITY_LIFE.history!.transition(from, reseal(active))).toEqual([
      "plasticity continuation must start in shadow mode",
    ]);
    const extra = structuredClone(checkpoint);
    new Graph(extra.graph!, false).set(
      ["cityFly", "fly", "state", "counts", "meals"],
      99,
    );
    expect(PLASTICITY_LIFE.history!.transition(from, reseal(extra))).toEqual([
      "plasticity continuation failed exact graph preservation",
    ]);
    const moved = structuredClone(checkpoint);
    moved.tick += 1;
    moved.events[0]!.tick += 1;
    expect(PLASTICITY_LIFE.history!.transition(from, reseal(moved))).not.toEqual([]);
  }, 120000);

  it("never restores a graph on an engine that did not write it", () => {
    const { checkpoint: from } = source();
    const { checkpoint } = continueWithPlasticity(from, upgraded, stopped);
    expect(() => restoreLife(ORGANISM_LIFE, checkpoint)).toThrow(/refused/);
    expect(() => restoreLife(PLASTICITY_LIFE, from)).toThrow(/refused/);
    expect(() => restoreLife(HABIT_LIFE, checkpoint)).toThrow(/refused/);
    // The two candidate adaptive eras exclude each other.
    expect(plasticitySourceErrors(checkpoint)).not.toEqual([]);
    const habitShaped = structuredClone(from);
    habitShaped.versions = { ...habitShaped.versions, habits: "x" };
    expect(plasticitySourceErrors(habitShaped)).toEqual([
      "not a prior ECHO organism checkpoint",
    ]);
    // A store of either other kind refuses the plasticity era's headers outright.
    expect(historicalCheckpointErrors(HABIT_LIFE, checkpoint)).not.toEqual([]);
    expect(historicalCheckpointErrors(ORGANISM_LIFE, checkpoint)).not.toEqual([]);
    expect(historicalCheckpointErrors(PLASTICITY_LIFE, from)).toEqual([]);
  }, 120000);
});

describe("recorded plasticity policy changes", () => {
  it("changes only the mode, at the unchanged tick, attesting its parent; never repeats or reverts silently", () => {
    const { checkpoint: from } = source();
    const shadow = continueWithPlasticity(from, upgraded, stopped).checkpoint;
    expect(() => changePlasticityPolicy(shadow, "shadow", "no-op", later)).toThrow(
      /already/,
    );
    expect(() => changePlasticityPolicy(shadow, "active", " ", later)).toThrow(/reason/);
    const on = changePlasticityPolicy(
      shadow,
      "active",
      "held-out evidence supports it",
      later,
    );
    expect(on.from).toBe("shadow");
    expect(on.to).toBe("active");
    expect(on.checkpoint.tick).toBe(shadow.tick);
    expect(on.checkpoint.parent).toBe(shadow.digest);
    expect(on.checkpoint.events.map((e) => e.kind)).toEqual([PLASTICITY_POLICY_EVENT]);
    expect(plasticityModeOf(on.checkpoint.graph!)).toBe("active");
    expect(on.life.adaptive.plasticity.state.mode).toBe("active");
    expect(on.checkpoint.birth).toEqual(shadow.birth);
    // Disabling is a forward change, never a restore of the shadow checkpoint.
    const off = changePlasticityPolicy(on.checkpoint, "disabled", "owner asked", later);
    expect(PLASTICITY_LIFE.history!.transition(on.checkpoint, off.checkpoint)).toEqual(
      [],
    );
    expect(off.checkpoint.sequence).toBe(on.checkpoint.sequence + 1);
    // A policy checkpoint that changed anything else is refused.
    const forged = structuredClone(on.checkpoint);
    new Graph(forged.graph!, false).set(
      ["cityFly", "fly", "state", "counts", "meals"],
      99,
    );
    expect(PLASTICITY_LIFE.history!.transition(shadow, reseal(forged))).toEqual([
      "a plasticity policy change changed more than its mode",
    ]);
    // A policy event naming a mode the graph does not hold is refused.
    const lying = structuredClone(on.checkpoint);
    lying.events[0]!.data.to = "disabled";
    expect(PLASTICITY_LIFE.history!.transition(shadow, reseal(lying))).toEqual([
      "a plasticity policy change does not hold the mode it names",
    ]);
    // Only the plasticity era records one.
    const early = structuredClone(from);
    early.events = [{ tick: from.tick, kind: PLASTICITY_POLICY_EVENT, data: {} }];
    expect(PLASTICITY_LIFE.history!.transition(null, reseal(early))).not.toEqual([]);
  }, 180000);

  it("reports its status through the observation, and the observer accepts it", () => {
    const { checkpoint: from } = source();
    const life: PlasticityOrganismLife = continueWithPlasticity(
      from,
      upgraded,
      stopped,
    ).life;
    const observation = life.observation({
      individual: "a".repeat(64),
      epoch: 1,
      checkpoint: { sequence: 1, tick: life.city.tick, committedUtc: upgraded },
      checkpointing: false,
      observedUtc: upgraded,
    });
    const parsed = parseObservation(JSON.parse(JSON.stringify(observation)));
    expect(parsed.adaptiveBrain).toMatchObject({
      mode: "shadow",
      samples: 0,
      adaptations: 0,
    });
    const bad = JSON.parse(JSON.stringify(observation)) as Record<string, unknown>;
    (bad.adaptiveBrain as Record<string, unknown>).mode = "on";
    expect(() => parseObservation(bad)).toThrow(/adaptiveBrain.mode/);
    (bad.adaptiveBrain as Record<string, unknown>).mode = "shadow";
    (bad.adaptiveBrain as Record<string, unknown>).extra = 1;
    expect(() => parseObservation(bad)).toThrow(/unexpected extra/);
  }, 120000);
});

describe("in a store: one writer, one continuation, verified chain", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  /** The fixture's root stands in for the real chain's history; every later step is judged by the real rules. */
  const rooted = <L>(
    kind: LifeKind<HeadlessGenesis, L>,
  ): LifeKind<HeadlessGenesis, L> => ({
    ...kind,
    history: {
      versions: kind.history!.versions,
      transition: (previous, next) =>
        previous === null && next.sequence === 0
          ? []
          : kind.history!.transition(previous, next),
    },
  });

  it("commits the continuation and a policy change under the lease, refuses a second writer, a repeat and a reversion", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "plasticity-store-")), "store");
    dirs.push(dir);
    const { checkpoint: from } = source();
    const organismWriter = LifeStore.create(dir, rooted(ORGANISM_LIFE), from, {
      holder: "the runner",
    });
    // The running service holds the lease: a migration must not commit beside it.
    const migrator = LifeStore.open(dir, rooted(PLASTICITY_LIFE), {
      holder: "the migration",
    });
    const updated = continueWithPlasticity(migrator.head(), upgraded, stopped);
    expect(() => migrator.acquire()).toThrow(/lease is held/);
    organismWriter.release();
    migrator.acquire();
    migrator.commit(updated.checkpoint);
    // Neither a repeat nor an organism-era checkpoint may follow it.
    expect(() => migrator.commit(updated.checkpoint)).toThrow();
    const reverted = checkpointLife(ORGANISM_LIFE, restoreLife(ORGANISM_LIFE, from), {
      genesis,
      birth: from.birth,
      previous: updated.checkpoint,
    });
    expect(() => migrator.commit(reverted)).toThrow();
    const on = changePlasticityPolicy(migrator.head(), "active", "evidence", later);
    migrator.commit(on.checkpoint);
    migrator.release();
    const verified = LifeStore.open(dir, rooted(PLASTICITY_LIFE)).verify();
    expect(verified.checkpoints).toBe(3);
    const head = LifeStore.open(dir, rooted(PLASTICITY_LIFE)).head();
    expect(head.birth.individual).toBe(from.birth.individual);
    expect(plasticityModeOf(head.graph!)).toBe("active");
    // The old organism engine refuses this store's head.
    expect(() => restoreLife(ORGANISM_LIFE, head)).toThrow(/refused/);
  }, 180000);
});
