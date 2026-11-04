/**
 * The recorded continuation of the deployed organism onto the repaired physics
 * (docs/ECHO_COLLISION.md). Pure: no store, no clock, no randomness. It edits an
 * in-memory copy of the source graph, never stored bytes, and advances no time.
 *
 * One leaf changes: what the self-model says it runs on, so that the episodes it
 * keeps from now on name the fly they happened on, as the ones before it do.
 * Everything else the fly held is kept by reference, and a projection that puts
 * that leaf back must give back every byte of the source graph, or nothing is
 * produced. A body the old physics let into a solid is left where it is: this
 * moves nothing, and what the new physics then lets it do is recorded when it
 * happens (`BODY_LEFT_SOLID`). That is a repair to the world, not something the
 * fly learned or found its way to, and the record says so.
 */
import { FLY_VERSION } from "../fly/fly.js";
import {
  checkpointErrors,
  checkpointLife,
  historicalCheckpointErrors,
  restoreLife,
  sameVersions,
  type LifeCheckpoint,
} from "./continuity.js";
import { Graph } from "./echoUpgrade.js";
import type { HeadlessGenesis } from "./headless.js";
import {
  ORGANISM_ADAPTER_PATH as ADAPTER,
  ORGANISM_LIFE,
  ORGANISM_V1_VERSIONS,
  PHYSICS_REPAIR,
  PHYSICS_REPAIR_EVENT,
  PHYSICS_REPAIR_LEAF,
  PHYSICS_REPAIR_SOURCE,
  physicsRepairProjection,
  type OrganismLife,
} from "./organism.js";
import { GRAPH_SCHEMA, indexGraph, restoreGraph, snapshotGraph } from "./snapshot.js";

type Checkpoint = LifeCheckpoint<HeadlessGenesis>;

export interface PhysicsRepair {
  life: OrganismLife;
  checkpoint: Checkpoint;
  preservedGraphDigest: string;
}

/**
 * Called only after the exact source release has restored and verified `source`.
 * `stoppedUtc` is when the source was committed (the service stopped); `upgradedUtc`
 * is now. The interval between them is a pause: recorded, never lived.
 */
export function continueOnRepairedPhysics(
  source: Checkpoint,
  upgradedUtc: string,
  stoppedUtc = upgradedUtc,
): PhysicsRepair {
  if (!sameVersions(source.versions, { ...ORGANISM_V1_VERSIONS, graph: GRAPH_SCHEMA }))
    throw new Error("repair refused: the source is not an organism on digital-fly/8");
  const errors = historicalCheckpointErrors(ORGANISM_LIFE, source);
  if (errors.length) throw new Error(`repair refused: ${errors.join("; ")}`);
  if (!source.graph) throw new Error("repair refused: its graph was compacted away");
  if (
    !Number.isFinite(Date.parse(upgradedUtc)) ||
    !Number.isFinite(Date.parse(stoppedUtc)) ||
    Date.parse(stoppedUtc) > Date.parse(upgradedUtc)
  )
    throw new Error("repair needs its real UTC time, after the source's");
  const old = new Graph(source.graph, false);
  if (
    old.object([]).c !== "OrganismLife" ||
    old.object(ADAPTER).c !== "OrganismAdapter" ||
    old.get(["cityFly", "controller"]) !== "echo" ||
    old.get(["cityFly", "failed"]) !== null ||
    old.get(PHYSICS_REPAIR_LEAF) !== ORGANISM_V1_VERSIONS.fly
  )
    throw new Error("repair refused: the source is not the healthy organism it expects");
  const graph = new Graph(source.graph);
  graph.set(PHYSICS_REPAIR_LEAF, FLY_VERSION);
  const fresh = () => ORGANISM_LIFE.build(structuredClone(source.genesis));
  const life = restoreGraph(graph.snapshot, fresh());
  if (life.city.tick !== source.tick) throw new Error("repair advanced the city's clock");
  // Put the one leaf back, and require every old graph byte.
  const preservedGraphDigest = physicsRepairProjection(
    snapshotGraph(life, indexGraph(fresh())),
  );
  if (preservedGraphDigest !== source.graphDigest)
    throw new Error("repair refused: the old state did not survive byte for byte");
  const fly = life.cityFly.fly.state;
  const a = life.organism;
  const S = a.model!.state;
  const circuit = a.circuit.state;
  const checkpoint = checkpointLife(ORGANISM_LIFE, life, {
    genesis: source.genesis,
    birth: source.birth,
    previous: source,
    events: [
      {
        tick: source.tick,
        kind: PHYSICS_REPAIR_EVENT,
        data: {
          migration: PHYSICS_REPAIR,
          sourceRelease: PHYSICS_REPAIR_SOURCE,
          parent: source.digest,
          sourceStateHash: source.stateHash,
          sourceGraphDigest: source.graphDigest,
          preservedGraphDigest,
          upgradedUtc,
          pausedFromUtc: stoppedUtc,
          physics: { from: ORGANISM_V1_VERSIONS.fly, to: FLY_VERSION },
          changed: { leaf: PHYSICS_REPAIR_LEAF.join(".") },
          body: { p: [...fly.p], mode: fly.mode },
          preserved:
            "the whole organism graph, byte for byte but that one label: body and where it is, city, controller and navigation memory, self-model, mushroom body, physiology, archive and every random stream",
          kept: {
            rememberedPlaces: a.inner.state.nav.places.length,
            mushroomBodyTrials: circuit.trials,
            inquiries: S.counts.inquiries,
            episodesKept: S.episodes.length,
            archivePending: life.archive.length,
          },
          attribution:
            "an environmental repair made by the people who keep this simulation: a change to how the world's surfaces hold a body, not something this fly did, learned or found its way to",
        },
      },
    ],
  });
  const transition = ORGANISM_LIFE.history!.transition(source, checkpoint);
  if (transition.length) throw new Error(transition.join("; "));
  const later = checkpointErrors(ORGANISM_LIFE, checkpoint);
  if (later.length) throw new Error(later.join("; "));
  restoreLife(ORGANISM_LIFE, checkpoint);
  return { life, checkpoint, preservedGraphDigest };
}
