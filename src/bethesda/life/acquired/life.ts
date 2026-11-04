/**
 * How the same individual would come to have acquired search: one recorded
 * continuation of its exact organism checkpoint, at the same tick, adding one
 * object whose counts are all zero and changing nothing else.
 *
 * Importing this changes nothing about any running life. It offers the kind
 * and the continuation; only an explicit, separately authorized commit could
 * apply them to the original, and nothing here reaches a store.
 *
 * Three things hold by construction, and life.test.ts checks them:
 *
 * - **Nothing is lost.** Taking the addition back out of the new graph gives
 *   the source's graph digest exactly, so its birth, history, memories,
 *   learned weights, physiology and random streams are all the source's.
 * - **It cannot be a new fly.** The kind refuses a birth, a second
 *   continuation, a parent other than the one it attests, and going back.
 * - **Until it has eaten, it is the organism.** The layer draws nothing and
 *   changes no command before its counts entitle it to, so a continued fly and
 *   an uncontinued one step to the same hash until then, tick for tick.
 */
import { sha256, sha256Json } from "../../../rain/sha256.js";
import {
  checkpointErrors,
  checkpointLife,
  restoreLife,
  sameVersions,
  type LifeCheckpoint,
  type LifeKind,
} from "../continuity.js";
import { Graph } from "../echoUpgrade.js";
import type { HeadlessGenesis } from "../headless.js";
import { ORGANISM_ADAPTER_PATH as ADAPTER, ORGANISM_LIFE } from "../organism.js";
import {
  GRAPH_SCHEMA,
  indexGraph,
  restoreGraph,
  snapshotGraph,
  type GraphSnapshot,
} from "../snapshot.js";
import { AcquiredAdapter, AcquiredLife } from "./adapter.js";
import { ACQUIRED_VERSION } from "./search.js";

export const ACQUIRED_CONTINUATION = "bethesda-acquired-continuation/v1";
export const ACQUIRED_EVENT = "acquired-continuation";

type Checkpoint = LifeCheckpoint<HeadlessGenesis>;
const SOURCE = { ...ORGANISM_LIFE.versions, graph: GRAPH_SCHEMA };

/** The graph with the addition taken back out, as a digest: the source's, when nothing else changed. */
export function acquiredProjection(graph: GraphSnapshot): string {
  const g = new Graph(graph);
  if (
    g.object([]).c !== AcquiredLife.name ||
    g.object(ADAPTER).c !== AcquiredAdapter.name
  )
    throw new Error("not an acquired-search graph");
  g.object([]).c = "OrganismLife";
  g.object(ADAPTER).c = "OrganismAdapter";
  g.remove([...ADAPTER, "search"]);
  return sha256(JSON.stringify(g.canonical()));
}

export const ACQUIRED_LIFE: LifeKind<HeadlessGenesis, AcquiredLife> = {
  id: ORGANISM_LIFE.id,
  versions: { ...ORGANISM_LIFE.versions, acquired: ACQUIRED_VERSION },
  build: (genesis) => new AcquiredLife(genesis.config),
  step: (life, ticks) => ORGANISM_LIFE.step(life, ticks),
  tick: (life) => life.city.tick,
  hash: (life) => `${ORGANISM_LIFE.hash(life)}|${sha256Json(life.acquired.search.state)}`,
  history: {
    versions: [...ORGANISM_LIFE.history!.versions, ORGANISM_LIFE.versions],
    transition(previous, next) {
      const isNext = next.versions.acquired === ACQUIRED_VERSION;
      const wasAcquired = previous?.versions.acquired === ACQUIRED_VERSION;
      if (!isNext) {
        if (wasAcquired) return ["an acquired continuation cannot be taken back"];
        if (next.events.some((e) => e.kind === ACQUIRED_EVENT))
          return ["only an acquired checkpoint records the continuation"];
        return ORGANISM_LIFE.history!.transition(previous, next);
      }
      if (!previous) return ["acquired search is a continuation, never a birth"];
      if (wasAcquired) {
        if (!sameVersions(previous.versions, next.versions))
          return ["changed version within one life"];
        if (next.events.some((e) => e.kind === ACQUIRED_EVENT))
          return ["a continuation cannot be repeated"];
        return [];
      }
      if (!sameVersions(previous.versions, SOURCE))
        return ["only the organism continues to acquired search"];
      const marks = next.events.filter(
        (e) =>
          e.kind === ACQUIRED_EVENT ||
          e.kind === "engine-upgrade" ||
          e.kind === "self-model-upgrade" ||
          e.kind === "organism-continuation" ||
          e.kind === "physics-repair",
      );
      const e = marks[0];
      if (
        marks.length !== 1 ||
        !e ||
        e.kind !== ACQUIRED_EVENT ||
        next.tick !== previous.tick ||
        e.tick !== previous.tick
      )
        return ["the continuation needs exactly one event at the unchanged tick"];
      const d = e.data;
      if (
        d.migration !== ACQUIRED_CONTINUATION ||
        d.parent !== previous.digest ||
        d.sourceStateHash !== previous.stateHash ||
        d.sourceGraphDigest !== previous.graphDigest ||
        d.preservedGraphDigest !== previous.graphDigest
      )
        return ["the continuation does not attest its exact parent"];
      if (
        typeof d.pausedFromUtc !== "string" ||
        typeof d.upgradedUtc !== "string" ||
        !Number.isFinite(Date.parse(d.pausedFromUtc)) ||
        !Number.isFinite(Date.parse(d.upgradedUtc)) ||
        Date.parse(d.pausedFromUtc) > Date.parse(d.upgradedUtc)
      )
        return ["the continuation has no valid pause interval"];
      if (next.graph) {
        let held: string | null = null;
        try {
          held = acquiredProjection(next.graph);
        } catch {
          held = null;
        }
        if (held !== previous.graphDigest)
          return ["the continuation's graph does not hold its parent's, byte for byte"];
      }
      return [];
    },
  },
};

export interface AcquiredContinuation {
  life: AcquiredLife;
  checkpoint: Checkpoint;
  preservedGraphDigest: string;
}

/** Pure: reads a checkpoint, writes nothing. A caller decides whether anything is ever committed. */
export function continueWithAcquiredSearch(
  source: Checkpoint,
  upgradedUtc: string,
  stoppedUtc = upgradedUtc,
): AcquiredContinuation {
  if (!sameVersions(source.versions, SOURCE))
    throw new Error("acquired continuation refused: not an organism checkpoint");
  const errors = checkpointErrors(ORGANISM_LIFE, source);
  if (errors.length)
    throw new Error(`acquired continuation refused: ${errors.join("; ")}`);
  if (!source.graph)
    throw new Error("acquired continuation needs the un-compacted source graph");
  if (
    !Number.isFinite(Date.parse(upgradedUtc)) ||
    !Number.isFinite(Date.parse(stoppedUtc)) ||
    Date.parse(stoppedUtc) > Date.parse(upgradedUtc)
  )
    throw new Error("invalid pause interval");
  const old = new Graph(source.graph, false);
  if (
    old.object([]).c !== "OrganismLife" ||
    old.object(ADAPTER).c !== "OrganismAdapter" ||
    old.get(["cityFly", "controller"]) !== "echo" ||
    old.get(["cityFly", "failed"]) !== null
  )
    throw new Error("source is not a healthy ECHO organism");

  const fresh = () => ACQUIRED_LIFE.build(structuredClone(source.genesis));
  // A different fresh instance supplies the shared index: indexing the same
  // one would share away every field of the new object.
  const template = new Graph(snapshotGraph(fresh(), indexGraph(fresh())), false);
  const graph = new Graph(source.graph);
  graph.object([]).c = AcquiredLife.name;
  graph.object(ADAPTER).c = AcquiredAdapter.name;
  graph.set(
    [...ADAPTER, "search"],
    graph.import(template, template.get([...ADAPTER, "search"])),
  );
  const life = restoreGraph(graph.snapshot, fresh());
  if (life.city.tick !== source.tick)
    throw new Error("the continuation changed the fly's clock");
  if (life.acquired.search.state.meals !== 0)
    throw new Error("acquired search did not start from nothing");

  const preservedGraphDigest = acquiredProjection(
    snapshotGraph(life, indexGraph(fresh())),
  );
  if (preservedGraphDigest !== source.graphDigest)
    throw new Error("the continuation did not preserve every byte of its source");

  const checkpoint = checkpointLife(ACQUIRED_LIFE, life, {
    genesis: source.genesis,
    birth: source.birth,
    previous: source,
    events: [
      {
        tick: source.tick,
        kind: ACQUIRED_EVENT,
        data: {
          migration: ACQUIRED_CONTINUATION,
          parent: source.digest,
          sourceStateHash: source.stateHash,
          sourceGraphDigest: source.graphDigest,
          preservedGraphDigest,
          pausedFromUtc: stoppedUtc,
          upgradedUtc,
          added: ACQUIRED_VERSION,
          interpretation:
            "The same organism, with counts of where its meals come from starting at zero, which it may use when hungry with no food odour to follow.",
        },
      },
    ],
  });
  const transition = ACQUIRED_LIFE.history!.transition(source, checkpoint);
  if (transition.length) throw new Error(transition.join("; "));
  restoreLife(ACQUIRED_LIFE, checkpoint);
  return { life, checkpoint, preservedGraphDigest };
}
