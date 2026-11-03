/**
 * A software update for a research fly: a release that adds to the deployed
 * configuration's adapter, and the one way a fly already living on the
 * baseline moves onto it, as a recorded continuation of its exact checkpoint.
 * Modelled on the acquired-search continuation (`life/acquired/life.ts`), for
 * research flies, which may also be born on the new release.
 *
 * Three things hold by construction, and C2 checks them on every individual:
 *
 * - **Nothing is lost.** Taking the additions back out of the continued graph
 *   gives the source's graph digest exactly: its birth, history, remembered
 *   places, circuit, self-model, physiology and random streams are the source's.
 * - **It is the same individual.** Same birth, genesis and tick; the
 *   continuation is a checkpoint that names its parent's digest and state hash.
 * - **It cannot be undone or repeated.** The kind's history refuses going back,
 *   a second continuation, and a continuation that does not attest its parent.
 */
import { sha256 } from "../../rain/sha256.js";
import {
  checkpointErrors,
  checkpointLife,
  restoreLife,
  sameVersions,
  type LifeCheckpoint,
  type LifeKind,
} from "../life/continuity.js";
import { Graph } from "../life/echoUpgrade.js";
import type { AdapterStreams } from "../fly/neural.js";
import type { OrganismAdapter } from "../life/organism.js";
import {
  GRAPH_SCHEMA,
  indexGraph,
  restoreGraph,
  snapshotGraph,
} from "../life/snapshot.js";
import type { Continue } from "./study.js";
import {
  BASELINE_KIND,
  researchKind,
  type FlyGenesis,
  type Release,
  type ResearchLife,
} from "./yard.js";

/** Where the adapter sits in a research life's graph. */
export const ADAPTER = ["fly", "adapter"] as const;
const BASE_ADAPTER = "OrganismAdapter";

export interface AdditiveRelease {
  name: string;
  /** The version key and value this release adds to the life's versions. */
  version: readonly [string, string];
  /** The event a continuation onto it records. */
  event: string;
  /** The adapter class: an `OrganismAdapter` with fields added after its own. */
  Adapter: new (
    rng: () => number,
    streams: AdapterStreams,
    seed: number,
  ) => OrganismAdapter;
  /** The adapter's fields this release adds, removed by the projection. */
  added: readonly string[];
  /** What the continuation means, in a sentence, for its event. */
  interpretation: string;
}

type Checkpoint = LifeCheckpoint<FlyGenesis>;

/** The digest of the baseline graph an updated graph holds: additions removed, the class named back. */
export function projection(r: AdditiveRelease, graph: Checkpoint["graph"]): string {
  if (!graph) throw new Error("no graph to project");
  const g = new Graph(graph);
  if (g.object([...ADAPTER]).c !== r.Adapter.name)
    throw new Error(`not a ${r.name} graph`);
  g.object([...ADAPTER]).c = BASE_ADAPTER;
  for (const key of r.added) g.remove([...ADAPTER, key]);
  return sha256(JSON.stringify(g.canonical()));
}

/**
 * An additive release as the suite runs it: the release, and its research life
 * kind with the history rules for moving onto it.
 */
export function additive(r: AdditiveRelease): {
  release: Release;
  kind: LifeKind<FlyGenesis, ResearchLife>;
} {
  const [key, version] = r.version;
  const base = BASELINE_KIND;
  const source = { ...base.versions, graph: GRAPH_SCHEMA };
  const release: Release = {
    name: r.name,
    versions: { [key]: version },
    adapter: (rng, streams, seed) => new r.Adapter(rng, streams, seed),
  };
  const kind: LifeKind<FlyGenesis, ResearchLife> = {
    ...researchKind(release),
    history: {
      versions: [base.versions],
      transition(previous, next) {
        const isNext = next.versions[key] === version;
        const wasNext = previous?.versions[key] === version;
        const marks = next.events.filter((e) => e.kind === r.event);
        if (!isNext) {
          if (wasNext) return [`a ${r.name} continuation cannot be taken back`];
          return marks.length
            ? [`only a ${r.name} checkpoint records the continuation`]
            : [];
        }
        // A research fly may be born on this release; a birth records no continuation.
        if (!previous) return marks.length ? ["a birth is not a continuation"] : [];
        if (wasNext) {
          if (!sameVersions(previous.versions, next.versions))
            return ["changed version within one life"];
          return marks.length ? ["a continuation cannot be repeated"] : [];
        }
        if (!sameVersions(previous.versions, source))
          return [`only the baseline continues to ${r.name}`];
        const e = marks[0];
        if (
          marks.length !== 1 ||
          next.events.length !== 1 ||
          !e ||
          next.tick !== previous.tick ||
          e.tick !== previous.tick
        )
          return ["the continuation needs exactly one event at the unchanged tick"];
        const d = e.data;
        if (
          d.parent !== previous.digest ||
          d.sourceStateHash !== previous.stateHash ||
          d.sourceGraphDigest !== previous.graphDigest ||
          d.preservedGraphDigest !== previous.graphDigest
        )
          return ["the continuation does not attest its exact parent"];
        if (next.graph) {
          let held: string | null = null;
          try {
            held = projection(r, next.graph);
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
  return { release, kind };
}

/**
 * Move a baseline checkpoint onto `r`. Pure: reads a checkpoint, returns the
 * continued life and its checkpoint, writes nothing. Refuses, saying why,
 * rather than return anything it has not verified.
 */
export function continueOnto(
  r: AdditiveRelease,
  kind: LifeKind<FlyGenesis, ResearchLife>,
  source: Checkpoint,
): { life: ResearchLife; checkpoint: Checkpoint } {
  const base = BASELINE_KIND;
  const errors = checkpointErrors(base, source);
  if (errors.length) throw new Error(`continuation refused: ${errors.join("; ")}`);
  if (!source.graph)
    throw new Error("continuation refused: the source graph was compacted");
  const old = new Graph(source.graph, false);
  if (old.object([...ADAPTER]).c !== BASE_ADAPTER)
    throw new Error("continuation refused: the source is not the baseline organism");

  const fresh = () => kind.build(structuredClone(source.genesis));
  // A different fresh instance supplies the shared index: indexing the same
  // one would share away every field of the additions.
  const template = new Graph(snapshotGraph(fresh(), indexGraph(fresh())), false);
  const graph = new Graph(source.graph);
  graph.object([...ADAPTER]).c = r.Adapter.name;
  for (const key of r.added)
    graph.set([...ADAPTER, key], graph.import(template, template.get([...ADAPTER, key])));
  const life = restoreGraph(graph.snapshot, fresh(), kind.classes ?? []);
  if (life.tick !== source.tick)
    throw new Error("the continuation changed the fly's clock");
  const preservedGraphDigest = projection(r, snapshotGraph(life, indexGraph(fresh())));
  if (preservedGraphDigest !== source.graphDigest)
    throw new Error("the continuation did not keep every byte of its source");

  const checkpoint = checkpointLife(kind, life, {
    genesis: source.genesis,
    birth: source.birth,
    previous: source,
    events: [
      {
        tick: source.tick,
        kind: r.event,
        data: {
          parent: source.digest,
          sourceStateHash: source.stateHash,
          sourceGraphDigest: source.graphDigest,
          preservedGraphDigest,
          added: `${r.version[0]} ${r.version[1]}`,
          interpretation: r.interpretation,
        },
      },
    ],
  });
  const refused = kind.history!.transition(source, checkpoint);
  if (refused.length) throw new Error(refused.join("; "));
  return { life: restoreLife(kind, checkpoint), checkpoint };
}

/** C2's arm: the continuation, or why it was refused. */
export const continuation =
  (r: AdditiveRelease, kind: LifeKind<FlyGenesis, ResearchLife>): Continue =>
  (source) => {
    try {
      return { life: continueOnto(r, kind, source).life };
    } catch (e) {
      return { refused: (e as Error).message };
    }
  };
