/**
 * The recorded continuation onto the repaired physics. Its source here is a fixture:
 * a real one can only be made by the release that wrote it, which is what the
 * rehearsal on the deployed fly's backup is for (docs/ECHO_COLLISION.md).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256, sha256Json } from "../../rain/sha256";
import { PROFILES } from "../simulation";
import { FLY_VERSION } from "../fly/fly";
import {
  birth,
  checkpointLife,
  divergence,
  restoreLife,
  type LifeCheckpoint,
} from "./continuity";
import { Graph } from "./echoUpgrade";
import {
  BETHESDA_LIFE,
  HeadlessBethesdaLife,
  headlessGenesis,
  type HeadlessGenesis,
} from "./headless";
import {
  BODY_ENTERED_SOLID,
  BODY_LEFT_SOLID,
  ORGANISM_LIFE,
  ORGANISM_V1_LIFE,
  ORGANISM_V1_VERSIONS,
  PHYSICS_REPAIR,
  PHYSICS_REPAIR_EVENT,
  PHYSICS_REPAIR_LEAF,
  PHYSICS_REPAIR_SOURCE,
  physicsRepairProjection,
  type OrganismLife,
} from "./organism";
import { continueOnRepairedPhysics } from "./physicsRepair";

type Checkpoint = LifeCheckpoint<HeadlessGenesis>;
const genesis = headlessGenesis({
  ...PROFILES[1]!,
  seed: 77,
  pedestrians: 4,
  vehicles: 1,
  buses: 0,
  statisticalPopulation: 10,
});
const stopped = "2026-11-04T12:00:00.000Z",
  upgraded = "2026-11-04T12:15:00.000Z";

/** An organism on digital-fly/8, as the deployed one is: labelled so, down to its self-model. */
function source(ticks = 20): { life: OrganismLife; checkpoint: Checkpoint } {
  const life = ORGANISM_V1_LIFE.build(structuredClone(genesis));
  life.organism.model!.state.fly = "digital-fly/8";
  life.advanceTicks(ticks);
  const b = birth(BETHESDA_LIFE.id, genesis, "0fedcba9876543210fedcba987654321");
  const checkpoint = checkpointLife(ORGANISM_V1_LIFE, life, {
    genesis,
    birth: b,
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

/** The same checkpoint with something done to its graph, resealed. */
function forged(c: Checkpoint, edit: (g: Graph) => void): Checkpoint {
  const copy = structuredClone(c);
  edit(new Graph(copy.graph!, false));
  return reseal(copy);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the repaired organism's versions", () => {
  it("are this release's fly, and the era before stays what it was", () => {
    expect(ORGANISM_LIFE.versions.fly).toBe(FLY_VERSION);
    expect(FLY_VERSION).not.toBe("digital-fly/8");
    expect(ORGANISM_LIFE.versions.physicsRepair).toBe(PHYSICS_REPAIR);
    expect(ORGANISM_V1_VERSIONS.fly).toBe("digital-fly/8");
    expect("physicsRepair" in ORGANISM_V1_VERSIONS).toBe(false);
    expect(ORGANISM_LIFE.history!.versions).toContainEqual(ORGANISM_V1_VERSIONS);
  });

  it("keeps the old checkpoint from being run under the new physics", () => {
    const { checkpoint } = source();
    expect(() => restoreLife(ORGANISM_LIFE, checkpoint)).toThrow(/versions/);
  });
});

describe("continuing onto the repaired physics", () => {
  it("is the same individual, one checkpoint later, at the same tick", () => {
    const { checkpoint: from } = source();
    const { checkpoint: c } = continueOnRepairedPhysics(from, upgraded, stopped);
    expect(c.birth).toEqual(from.birth);
    expect(c.genesisDigest).toBe(from.genesisDigest);
    expect(c.tick).toBe(from.tick);
    expect(c.parent).toBe(from.digest);
    expect(c.sequence).toBe(from.sequence + 1);
    expect(c.versions.fly).toBe(FLY_VERSION);
    expect(c.events).toHaveLength(1);
    const e = c.events[0]!;
    expect(e.kind).toBe(PHYSICS_REPAIR_EVENT);
    expect(e.tick).toBe(from.tick);
    expect(e.data).toMatchObject({
      migration: PHYSICS_REPAIR,
      sourceRelease: PHYSICS_REPAIR_SOURCE,
      parent: from.digest,
      sourceStateHash: from.stateHash,
      sourceGraphDigest: from.graphDigest,
      preservedGraphDigest: from.graphDigest,
      pausedFromUtc: stopped,
      upgradedUtc: upgraded,
      physics: { from: "digital-fly/8", to: FLY_VERSION },
    });
    expect(String(e.data.attribution)).toMatch(/not something this fly did, learned/);
  });

  it("changes one leaf of the graph, and gives back every byte of the source", () => {
    const { checkpoint: from } = source();
    const { checkpoint: c, preservedGraphDigest } = continueOnRepairedPhysics(
      from,
      upgraded,
      stopped,
    );
    expect(preservedGraphDigest).toBe(from.graphDigest);
    expect(physicsRepairProjection(c.graph!)).toBe(from.graphDigest);
    expect(c.graphDigest).not.toBe(from.graphDigest);
    const before = new Graph(from.graph!);
    const after = new Graph(c.graph!);
    expect(before.get(PHYSICS_REPAIR_LEAF)).toBe("digital-fly/8");
    expect(after.get(PHYSICS_REPAIR_LEAF)).toBe(FLY_VERSION);
    // Exactly one node differs, and in exactly that entry.
    const changed = before.snapshot.nodes.flatMap((n, i) =>
      JSON.stringify(n) === JSON.stringify(after.snapshot.nodes[i]) ? [] : [i],
    );
    expect(changed).toHaveLength(1);
    expect(after.snapshot.nodes).toHaveLength(before.snapshot.nodes.length);
  });

  it("keeps everything the fly holds, its place in the world among it", () => {
    const { life: original, checkpoint: from } = source();
    const { life } = continueOnRepairedPhysics(from, upgraded, stopped);
    expect(life.cityFly.fly.state).toEqual(original.cityFly.fly.state);
    expect(life.city.stateHash()).toBe(original.city.stateHash());
    expect(life.archive).toEqual(original.archive);
    const without = (l: OrganismLife) => {
      const s = JSON.parse(JSON.stringify(l.organism.state)) as {
        self: Record<string, unknown>;
      };
      delete s.self.fly;
      return s;
    };
    expect(without(life)).toEqual(without(original));
    expect(life.organism.model!.state.fly).toBe(FLY_VERSION);
    expect(original.organism.model!.state.fly).toBe("digital-fly/8");
  });

  it("restores to the same life, which goes on the same way", () => {
    const { checkpoint: from } = source();
    const { life, checkpoint: c } = continueOnRepairedPhysics(from, upgraded, stopped);
    const restored = restoreLife(ORGANISM_LIFE, c);
    expect(divergence(ORGANISM_LIFE, life, restored, [1, 10, 100])).toBeNull();
  });

  it("labels what the fly remembers from then on with the fly it happened on", () => {
    const { checkpoint: from } = source();
    const { life } = continueOnRepairedPhysics(from, upgraded, stopped);
    expect(life.organism.model!.state.fly).toBe(FLY_VERSION);
  });

  it("refuses what it should not continue, changing nothing", () => {
    const { checkpoint: from } = source();
    expect(() => continueOnRepairedPhysics(from, stopped, upgraded)).toThrow(/UTC/);
    const compacted = structuredClone(from);
    compacted.graph = null;
    expect(() => continueOnRepairedPhysics(compacted, upgraded, stopped)).toThrow();
    const corrupt = structuredClone(from);
    corrupt.stateHash = "0".repeat(64);
    expect(() => continueOnRepairedPhysics(corrupt, upgraded, stopped)).toThrow(/digest/);
    const { checkpoint: done } = continueOnRepairedPhysics(from, upgraded, stopped);
    expect(() => continueOnRepairedPhysics(done, upgraded, stopped)).toThrow(
      /not an organism on digital-fly\/8/,
    );
    const failed = structuredClone(from);
    new Graph(failed.graph!, false).set(["cityFly", "failed"], "for this test");
    expect(() => continueOnRepairedPhysics(reseal(failed), upgraded, stopped)).toThrow(
      /healthy organism/,
    );
    const label = structuredClone(from);
    new Graph(label.graph!, false).set(PHYSICS_REPAIR_LEAF, "digital-fly/7");
    expect(() => continueOnRepairedPhysics(reseal(label), upgraded, stopped)).toThrow(
      /healthy organism/,
    );
  });
});

describe("the rules a chain is checked by", () => {
  const t = ORGANISM_LIFE.history!.transition;
  const made = () => {
    const { checkpoint: from } = source();
    const { checkpoint: c, life } = continueOnRepairedPhysics(from, upgraded, stopped);
    return { from, c, life };
  };

  it("accept the continuation, and the life after it", () => {
    const { from, c, life } = made();
    expect(t(from, c)).toEqual([]);
    life.advanceTicks(5);
    const next = checkpointLife(ORGANISM_LIFE, life, {
      genesis,
      birth: c.birth,
      previous: c,
    });
    expect(t(c, next)).toEqual([]);
  });

  it("refuse a birth on it, a second one, and going back", () => {
    const { from, c } = made();
    expect(t(null, c).join()).toMatch(/never a birth/);
    const again = reseal({
      ...structuredClone(c),
      parent: c.digest,
      sequence: c.sequence + 1,
    });
    expect(t(c, again).join()).toMatch(/cannot be repeated/);
    const back = reseal({
      ...structuredClone(from),
      sequence: c.sequence + 1,
      parent: c.digest,
    });
    expect(t(c, back).join()).toMatch(/cannot revert/);
  });

  it("refuse an old fly claiming the repair, or the repair without its record", () => {
    const { from, c } = made();
    const claimed = reseal({
      ...structuredClone(from),
      events: structuredClone(c.events),
    });
    expect(t(from, claimed).join()).toMatch(/only a repaired checkpoint/);
    const silent = reseal({ ...structuredClone(c), events: [] });
    expect(t(from, silent).join()).toMatch(/exactly one event/);
  });

  it("refuse time passing, or anything else being recorded with it", () => {
    const { from, c } = made();
    const later = structuredClone(c);
    later.tick = from.tick + 1;
    expect(t(from, reseal(later)).join()).toMatch(/unchanged tick/);
    const more = structuredClone(c);
    more.events.push({ tick: from.tick, kind: "gap", data: {} });
    expect(t(from, reseal(more)).join()).toMatch(/and no other/);
  });

  it("refuse a claim that does not name its exact parent", () => {
    const { from, c } = made();
    for (const key of [
      "migration",
      "sourceRelease",
      "parent",
      "sourceStateHash",
      "sourceGraphDigest",
      "preservedGraphDigest",
    ]) {
      const wrong = structuredClone(c);
      wrong.events[0]!.data[key] = "something else";
      expect(t(from, reseal(wrong)).join(), key).toMatch(/does not attest/);
    }
  });

  it("refuse a body moved under the repair's name: no silent teleport", () => {
    const { from, c } = made();
    const moved = forged(c, (g) => {
      const p = g.node(g.get(["cityFly", "fly", "state", "p"]));
      if (p.t !== "a") throw new Error("expected a position");
      p.e[0] = (p.e[0] as number) + 1;
    });
    expect(t(from, moved).join()).toMatch(/does not hold its parent's/);
  });

  it("refuse a mind changed under the repair's name", () => {
    const { from, c } = made();
    const changed = forged(c, (g) => {
      g.set([...PHYSICS_REPAIR_LEAF.slice(0, -1), "seed"], 12345);
    });
    expect(t(from, changed).join()).toMatch(/does not hold its parent's/);
  });

  it("refuse a pause that does not make sense", () => {
    const { from, c } = made();
    const wrong = structuredClone(c);
    wrong.events[0]!.data.pausedFromUtc = upgraded;
    wrong.events[0]!.data.upgradedUtc = stopped;
    expect(t(from, reseal(wrong)).join()).toMatch(/pause interval/);
  });
});

describe("the body and a solid, on the record", () => {
  /** A tick of the life that only moves the body there. */
  const moves = (to: readonly number[]) =>
    vi.spyOn(HeadlessBethesdaLife.prototype, "advanceTicks").mockImplementation(function (
      this: HeadlessBethesdaLife,
    ) {
      this.cityFly.fly.state.p = [to[0]!, to[1]!, to[2]!];
    });
  const places = (life: OrganismLife) => {
    const world = life.cityFly.world;
    const open = life.cityFly.fly.state.p;
    expect(world.solid(open)).toBe(false);
    for (const b of (world as unknown as { spec: { boxes: { center: number[] }[] } }).spec
      .boxes)
      if (world.solid(b.center as [number, number, number]))
        return { open, inside: b.center };
    throw new Error("no solid in this world");
  };

  it("says when it leaves one and when it enters one, and what physics it was", () => {
    const life = ORGANISM_LIFE.build(structuredClone(genesis));
    const { open, inside } = places(life);
    life.archive = [];
    const entering = moves(inside);
    life.advanceTicks(1);
    entering.mockRestore();
    expect(life.takeArchive().map((e) => e.kind)).toContain(BODY_ENTERED_SOLID);
    const leaving = moves(open);
    life.advanceTicks(1);
    leaving.mockRestore();
    const left = life.takeArchive().find((e) => e.kind === BODY_LEFT_SOLID);
    expect(left?.data).toMatchObject({ physics: FLY_VERSION });
    expect(left?.data.p).toEqual([...open]);
  });

  it("says nothing of a body that stays out", () => {
    const life = ORGANISM_LIFE.build(structuredClone(genesis));
    life.advanceTicks(50);
    const kinds = life.takeArchive().map((e) => e.kind);
    expect(kinds).not.toContain(BODY_ENTERED_SOLID);
    expect(kinds).not.toContain(BODY_LEFT_SOLID);
  });
});
