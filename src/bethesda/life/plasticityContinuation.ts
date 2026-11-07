/**
 * One-time, state-preserving continuation for THE EXISTING ECHO organism.
 * Never touches a store or advances the original clock. A caller must verify
 * this against a backup and the exact engine that produced the checkpoint,
 * then acquire the one-writer lease before any production commit.
 *
 * Birth, individual ID, epoch, city and fly state, controller, learned mushroom
 * body weights, self-model, physiology, remembered places, random streams and
 * archive are all preserved by a reversible, byte-for-byte graph projection.
 */
import { checkpointLife, restoreLife, type LifeCheckpoint } from "./continuity.js";
import { Graph } from "./echoUpgrade.js";
import {
  PLASTICITY_CONTINUATION,
  PLASTICITY_EVENT,
  PLASTICITY_LIFE,
  plasticityProjection,
  plasticitySourceErrors,
  type PlasticityOrganismLife,
} from "./plasticOrganism.js";
import { ADAPTIVE_BRAIN_VERSION } from "../fly/echo/adaptiveBrain.js";
import { type HeadlessGenesis } from "./headless.js";
import { ORGANISM_ADAPTER_PATH as ADAPTER } from "./organism.js";
import { indexGraph, restoreGraph, snapshotGraph } from "./snapshot.js";

type Checkpoint = LifeCheckpoint<HeadlessGenesis>;

export interface PlasticityContinuation {
  life: PlasticityOrganismLife;
  checkpoint: Checkpoint;
  preservedGraphDigest: string;
}

export function continueWithPlasticity(
  source: Checkpoint,
  upgradedUtc: string,
  stoppedUtc = upgradedUtc,
): PlasticityContinuation {
  const errors = plasticitySourceErrors(source);
  if (errors.length)
    throw new Error(`plasticity continuation refused: ${errors.join("; ")}`);
  if (!source.graph)
    throw new Error("plasticity continuation needs the un-compacted source graph");
  if (
    !Number.isFinite(Date.parse(upgradedUtc)) ||
    !Number.isFinite(Date.parse(stoppedUtc)) ||
    Date.parse(stoppedUtc) > Date.parse(upgradedUtc)
  )
    throw new Error("invalid ECHO pause interval");
  const old = new Graph(source.graph, false);
  if (
    old.object([]).c !== "OrganismLife" ||
    old.object(ADAPTER).c !== "OrganismAdapter" ||
    old.get(["cityFly", "controller"]) !== "echo" ||
    old.get(["cityFly", "failed"]) !== null
  )
    throw new Error("source is not the existing, healthy ECHO organism");

  // A fresh NEW-KIND template supplies only the new plasticity property. Existing
  // object references and streams are reused from the authentic source graph.
  const fresh = () => PLASTICITY_LIFE.build(structuredClone(source.genesis));
  // The reference graph must come from a DIFFERENT fresh instance: passing
  // the same instance as its shared index would incorrectly share away all
  // of the new adapter\x27s own fields.
  const template = new Graph(snapshotGraph(fresh(), indexGraph(fresh())), false);
  const graph = new Graph(source.graph);
  graph.object([]).c = "PlasticityOrganismLife";
  graph.object(ADAPTER).c = "PlasticityOrganismAdapter";
  graph.set(
    [...ADAPTER, "plasticity"],
    graph.import(template, template.get([...ADAPTER, "plasticity"])),
  );
  const life = restoreGraph(graph.snapshot, fresh());
  if (life.city.tick !== source.tick)
    throw new Error("plasticity continuation changed the organism's clock");
  if (life.adaptive.plasticity.state.samples !== 0)
    throw new Error("new plasticity learning was not initialized without prior samples");

  const restoredGraph = snapshotGraph(life, indexGraph(fresh()));
  const preservedGraphDigest = plasticityProjection(restoredGraph);
  if (preservedGraphDigest !== source.graphDigest)
    throw new Error("plasticity continuation did not preserve every old graph byte");

  const checkpoint = checkpointLife(PLASTICITY_LIFE, life, {
    genesis: source.genesis,
    birth: source.birth,
    previous: source,
    events: [
      {
        tick: source.tick,
        kind: PLASTICITY_EVENT,
        data: {
          migration: PLASTICITY_CONTINUATION,
          parent: source.digest,
          sourceStateHash: source.stateHash,
          sourceGraphDigest: source.graphDigest,
          preservedGraphDigest,
          pausedFromUtc: stoppedUtc,
          upgradedUtc,
          added: ADAPTIVE_BRAIN_VERSION,
          interpretation:
            "The same ECHO organism can now adapt walking pace using measured self-motion and touch. Previous state is unchanged; the added brain begins with no samples and remains bounded by reflexes and the motor gate.",
        },
      },
    ],
  });
  const transition = PLASTICITY_LIFE.history!.transition(source, checkpoint);
  if (transition.length) throw new Error(transition.join("; "));
  restoreLife(PLASTICITY_LIFE, checkpoint);
  return { life, checkpoint, preservedGraphDigest };
}
