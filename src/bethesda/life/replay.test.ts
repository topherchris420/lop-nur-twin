import { describe, expect, it } from "vitest";
import { sha256Json } from "../../rain/sha256";
import { birth, checkpointLife, type LifeCheckpoint, type LifeEvent } from "./continuity";
import {
  BETHESDA_LIFE,
  headlessGenesis,
  type HeadlessBethesdaLife,
  type HeadlessGenesis,
} from "./headless";
import { ORGANISM_LIFE, type OrganismLife } from "./organism";
import { replayChain } from "./replay";

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
    expect(outcome.digests).toEqual(later.map((c) => c.digest));
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
  });

  it("does not disturb the record it reads", () => {
    const before = JSON.stringify(stored);
    replayChain(BETHESDA_LIFE, from!, later);
    expect(JSON.stringify(stored)).toBe(before);
  });
});
