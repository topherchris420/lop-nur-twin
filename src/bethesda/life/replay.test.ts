import { describe, expect, it } from "vitest";
import { sha256Json } from "../../rain/sha256";
import { birth, checkpointLife, type LifeCheckpoint, type LifeEvent } from "./continuity";
import type { GraphNode } from "./snapshot";
import {
  BETHESDA_LIFE,
  headlessGenesis,
  type HeadlessBethesdaLife,
  type HeadlessGenesis,
} from "./headless";
import { ORGANISM_LIFE, type OrganismLife } from "./organism";
import { graphDifference, replayChain } from "./replay";

const genesis = headlessGenesis({
  seed: 393977,
  pedestrians: 4,
  vehicles: 1,
  buses: 0,
  statisticalPopulation: 10,
});
const born = birth(BETHESDA_LIFE.id, genesis, "0123456789abcdef0123456789abcdef");
type Checkpoint = LifeCheckpoint<HeadlessGenesis>;

/** A chain as the runner writes it: advance, then seal, each continuing the last. */
function chain(
  intervals: readonly number[],
  events: (index: number) => LifeEvent[] = () => [],
): Checkpoint[] {
  const life = BETHESDA_LIFE.build(structuredClone(genesis));
  const out = [
    checkpointLife(BETHESDA_LIFE, life, { genesis, birth: born, previous: null }),
  ];
  intervals.forEach((ticks, i) => {
    BETHESDA_LIFE.step(life, ticks);
    out.push(
      checkpointLife(BETHESDA_LIFE, life, {
        genesis,
        birth: born,
        previous: out.at(-1)!,
        events: events(i),
      }),
    );
  });
  return out;
}

/** What a store keeps of an old checkpoint: everything but the graph. */
const header = (c: Checkpoint): Checkpoint => ({ ...c, graph: null });

/** The seal over a header, recomputed the way `continuity.ts` does, so a forgery is well formed. */
function reseal(c: Checkpoint): Checkpoint {
  const { digest: _digest, graph: _graph, ...body } = c;
  return { ...c, digest: sha256Json(body) };
}

describe("replaying a stored life", { timeout: 120_000 }, () => {
  const stored = chain([40, 25, 60]);
  const [from, ...later] = stored;

  it("reproduces every later seal from one checkpoint's state, with their graphs gone", () => {
    const outcome = replayChain(BETHESDA_LIFE, from!, later.map(header));
    expect(outcome.difference).toBeNull();
    expect(outcome.stopped).toBeNull();
    expect(outcome.matched).toBe(3);
    expect(outcome.ticks).toBe(125);
    expect(outcome.to.digest).toBe(stored.at(-1)!.digest);
    expect(outcome.seals).toBe(3);
  });

  it("carries a gap across from the record: it says when no process ran, and changes nothing", () => {
    const gap: LifeEvent = {
      tick: 40,
      kind: "gap",
      data: {
        stoppedUtc: "2026-10-27T01:00:00.000Z",
        resumedUtc: "2026-10-27T01:01:00.000Z",
      },
    };
    const gapped = chain([40, 25], (i) => (i === 1 ? [gap] : []));
    const outcome = replayChain(BETHESDA_LIFE, gapped[0]!, gapped.slice(1).map(header));
    expect(outcome.difference).toBeNull();
    expect(outcome.matched).toBe(2);
  });

  it("finds a history that does not follow from its past, though every seal is well formed", () => {
    // The forger's best case: a real state from five ticks on, relabelled and resealed so the
    // chain still links. (Splitting the same ticks differently forges nothing: 41 + 24 reaches
    // the same state as 40 + 25.)
    const honest = chain([40, 25]);
    const other = chain([40, 30]);
    const forged = reseal({
      ...other[2]!,
      parent: honest[1]!.digest,
      tick: 65,
      sequence: 2,
    });
    const outcome = replayChain(BETHESDA_LIFE, honest[0]!, [
      header(honest[1]!),
      header(forged),
    ]);
    expect(outcome.matched).toBe(1);
    expect(outcome.to.sequence).toBe(1);
    expect(outcome.difference?.sequence).toBe(2);
    expect(outcome.difference?.field).toBe("stateHash");
    expect(outcome.difference?.recorded).toBe(forged.stateHash);
    expect(outcome.difference?.derived).toBe(honest[2]!.stateHash);
  });

  it("finds a state hash kept true while the graph digest is changed", () => {
    const forged = reseal({ ...later[0]!, graphDigest: "0".repeat(64) });
    const outcome = replayChain(BETHESDA_LIFE, from!, [header(forged)]);
    expect(outcome.matched).toBe(0);
    expect(outcome.to).toEqual({ sequence: 0, tick: 0, digest: from!.digest });
    expect(outcome.difference?.field).toBe("graphDigest");
  });

  it("finds events the life never recorded about itself", () => {
    const self = (life: HeadlessBethesdaLife): LifeEvent[] => [
      { tick: life.city.tick, kind: "meal", data: { place: 671 } },
    ];
    const forged = reseal({
      ...later[0]!,
      events: [{ tick: 40, kind: "meal", data: { place: 672 } }],
    });
    const outcome = replayChain(BETHESDA_LIFE, from!, [header(forged)], {
      derived: self,
    });
    expect(outcome.difference?.field).toBe("events");
  });

  it("stops without a verdict at an event it does not apply, rather than guessing", () => {
    const placed: LifeEvent = { tick: 40, kind: "food-placed", data: {} };
    const withFood = chain([40], () => [placed]);
    const outcome = replayChain(BETHESDA_LIFE, withFood[0]!, [header(withFood[1]!)]);
    expect(outcome.difference).toBeNull();
    expect(outcome.matched).toBe(0);
    expect(outcome.stopped).toMatch(/food-placed/);
  });

  it("stops without a verdict at a checkpoint another engine made", () => {
    const newer = reseal({
      ...later[1]!,
      versions: { ...later[1]!.versions, fly: "digital-fly/next" },
    });
    const outcome = replayChain(BETHESDA_LIFE, from!, [header(later[0]!), header(newer)]);
    expect(outcome.difference).toBeNull();
    expect(outcome.matched).toBe(1);
    expect(outcome.stopped).toMatch(/another engine/);
  });

  it("refuses a chain that does not line up, and a start with no state", () => {
    expect(() => replayChain(BETHESDA_LIFE, from!, [later[1]!])).toThrow(
      /does not follow/,
    );
    expect(() =>
      replayChain(BETHESDA_LIFE, from!, [{ ...later[0]!, parent: "x" }]),
    ).toThrow(/parent/);
    expect(() => replayChain(BETHESDA_LIFE, header(from!), later)).toThrow(/compacted/);
  });

  it("re-derives what an organism records about itself", () => {
    // The deployed kind: its archive leaves the life at each checkpoint and is sealed in it.
    const organism = ORGANISM_LIFE.build(structuredClone(genesis));
    const first = checkpointLife(ORGANISM_LIFE, organism, {
      genesis,
      birth: born,
      previous: null,
    });
    const sealed = [first];
    for (const ticks of [3000, 3000]) {
      ORGANISM_LIFE.step(organism, ticks);
      sealed.push(
        checkpointLife(ORGANISM_LIFE, organism, {
          genesis,
          birth: born,
          previous: sealed.at(-1)!,
          events: organism.takeArchive(),
        }),
      );
    }
    const recorded = sealed.flatMap((c) => c.events);
    expect(recorded.length).toBeGreaterThan(0);
    const derived = (life: HeadlessBethesdaLife) => (life as OrganismLife).takeArchive();

    const later = sealed.slice(1).map(header);
    const outcome = replayChain(ORGANISM_LIFE, first, later, { derived });
    expect(outcome.difference).toBeNull();
    expect(outcome.matched).toBe(2);

    // A replay that is not told how to take the archive reaches no verdict: it cannot pass by omission.
    const unaware = replayChain(ORGANISM_LIFE, first, later);
    expect(unaware.matched).toBe(0);
    expect(unaware.stopped).toMatch(/does not apply/);

    // A record quietly dropped from what the life says happened to it.
    const index = sealed.findIndex((c, i) => i > 0 && c.events.length > 0);
    const dropped = sealed.map((c, i) =>
      i === index ? reseal({ ...c, events: c.events.slice(1) }) : c,
    );
    for (let i = index + 1; i < dropped.length; i++) {
      dropped[i] = reseal({ ...dropped[i]!, parent: dropped[i - 1]!.digest });
    }
    const caught = replayChain(ORGANISM_LIFE, first, dropped.slice(1).map(header), {
      derived,
    });
    expect(caught.difference?.field).toBe("events");
    expect(caught.difference?.sequence).toBe(index);

    // A record invented on top of what it says: told how to take the archive, this is a disagreement.
    const invented = sealed.map((c, i) =>
      i === index
        ? reseal({
            ...c,
            events: [{ tick: c.tick, kind: "recovery-enter", data: {} }, ...c.events],
          })
        : c,
    );
    for (let i = index + 1; i < invented.length; i++) {
      invented[i] = reseal({ ...invented[i]!, parent: invented[i - 1]!.digest });
    }
    const made = replayChain(ORGANISM_LIFE, first, invented.slice(1).map(header), {
      derived,
    });
    expect(made.stopped).toBeNull();
    expect(made.difference?.field).toBe("events");
    // Few enough words to publish, however long the record.
    expect(made.difference!.recorded.length).toBeLessThan(160);
  });

  describe("a chain whose observer moved its caches, as the deployed release's does", () => {
    // What release 62bd125's observation did: query the wind at the fly, through the caches.
    const look = (life: HeadlessBethesdaLife) => {
      const { world, fly } = life.cityFly;
      world.wind(fly.state.p, fly.state.t);
    };
    const observed = () => {
      const life = ORGANISM_LIFE.build(structuredClone(genesis));
      const out = [
        checkpointLife(ORGANISM_LIFE, life, { genesis, birth: born, previous: null }),
      ];
      for (let c = 0; c < 2; c++) {
        for (let i = 0; i < 12; i++) {
          life.advanceTicks(10);
          look(life);
        }
        out.push(
          checkpointLife(ORGANISM_LIFE, life, {
            genesis,
            birth: born,
            previous: out.at(-1)!,
            events: life.takeArchive(),
          }),
        );
      }
      return out;
    };
    const derived = (life: HeadlessBethesdaLife) => (life as OrganismLife).takeArchive();
    const sealed = observed();
    const whole = [header(sealed[1]!), sealed[2]!];

    it("cannot reproduce its seals, and says where they part", () => {
      const outcome = replayChain(ORGANISM_LIFE, sealed[0]!, whole, { derived });
      expect(outcome.matched).toBe(0);
      expect(outcome.difference?.field).toBe("graphDigest");
    });

    it("still reproduces its state, its records and its whole graph apart from the caches", () => {
      const outcome = replayChain(ORGANISM_LIFE, sealed[0]!, whole, {
        derived,
        seals: false,
      });
      expect(outcome.difference).toBeNull();
      expect(outcome.stopped).toBeNull();
      expect(outcome.matched).toBe(2);
      expect(outcome.seals).toBe(0);
      expect(outcome.graphs).toBe(1);
    });

    it("finds a change hidden from the state hash, and names where it is", () => {
      const { graph } = sealed[2]!;
      const nodes = structuredClone(graph!.nodes);
      // The fly's energy, with the recorded state hash left as it was.
      const state = nodes.find(
        (n: GraphNode) => n.t === "o" && n.e.some(([k]) => k === "reserve"),
      ) as Extract<GraphNode, { t: "o" }>;
      const reserve = state.e.find(([k]) => k === "reserve")!;
      reserve[1] = (reserve[1] as number) + 1;
      const forged = { ...sealed[2]!, graph: { ...graph!, nodes } };
      const outcome = replayChain(ORGANISM_LIFE, sealed[0]!, [whole[0]!, forged], {
        derived,
        seals: false,
      });
      expect(outcome.difference?.field).toBe("graph");
      expect(outcome.difference?.recorded).toMatch(/^root.*\.reserve: /);
    });

    it("compares only the caches it names", () => {
      const { graph } = sealed[2]!;
      expect(graphDifference(graph!, graph!)).toBeNull();
      const nodes = structuredClone(graph!.nodes);
      const grid = nodes.find(
        (n: GraphNode) => n.t === "o" && n.c === "FootprintGrid",
      ) as Extract<GraphNode, { t: "o" }>;
      const stamp = grid.e.find(([k]) => k === "stamp")!;
      stamp[1] = (stamp[1] as number) + 7;
      expect(graphDifference(graph!, { ...graph!, nodes })).toBeNull();
      const other = grid.e.find(([k]) => k === "count")!;
      other[1] = (other[1] as number) + 1;
      expect(graphDifference(graph!, { ...graph!, nodes })?.path).toMatch(/\.count$/);
    });
  });

  it("seals the same whether or not it was watched, right up to the seal", () => {
    // The whole point of OBSERVATION_LEAVES_NO_TRACE: a watcher cannot be told from no watcher.
    const look = (life: HeadlessBethesdaLife) =>
      life.observation({
        individual: born.individual,
        epoch: 1,
        checkpoint: { sequence: 0, tick: 0, committedUtc: "2026-11-02T00:00:00.000Z" },
        checkpointing: false,
        observedUtc: "2026-11-02T00:00:00.000Z",
      });
    for (const kind of [BETHESDA_LIFE, ORGANISM_LIFE]) {
      const watched = kind.build(structuredClone(genesis));
      const alone = kind.build(structuredClone(genesis));
      for (let i = 0; i < 12; i++) {
        kind.step(watched, 10);
        kind.step(alone, 10);
        look(watched);
      }
      const seal = (life: typeof watched) =>
        checkpointLife(kind, life, { genesis, birth: born, previous: null });
      expect(seal(watched).digest).toBe(seal(alone).digest);
    }
  });

  it("seals the same when it was watched flying in wind", () => {
    // A flying fly's velocity over the ground adds the wind, whose query moves the
    // world's lookup caches. Watched only while perched, that path never runs: the
    // test above passed while the deployed fly's seals could not be reproduced
    // (issue 162, state hash and events equal, graph digest not).
    for (const kind of [BETHESDA_LIFE, ORGANISM_LIFE]) {
      const watched = kind.build(structuredClone(genesis));
      const alone = kind.build(structuredClone(genesis));
      let inWind = 0;
      for (let i = 0; i < 4000 && inWind < 5; i++) {
        kind.step(watched, 10);
        kind.step(alone, 10);
        const s = watched.cityFly.fly.state;
        if (
          (s.mode === "flight" || s.mode === "land") &&
          watched.cityFly.world.windNow(s.t).speedMS > 0
        ) {
          watched.observation({
            individual: born.individual,
            epoch: 1,
            checkpoint: {
              sequence: 0,
              tick: 0,
              committedUtc: "2026-11-02T00:00:00.000Z",
            },
            checkpointing: false,
            observedUtc: "2026-11-02T00:00:00.000Z",
          });
          inWind++;
        }
      }
      expect(inWind).toBe(5);
      const seal = (life: typeof watched) =>
        checkpointLife(kind, life, { genesis, birth: born, previous: null });
      expect(seal(watched).digest).toBe(seal(alone).digest);
    }
  }, 120_000);

  it("does not disturb the record it reads", () => {
    const before = JSON.stringify(stored);
    replayChain(BETHESDA_LIFE, from!, later);
    expect(JSON.stringify(stored)).toBe(before);
  });
});
