/**
 * One-time, state-preserving continuation of THE EXISTING ECHO organism onto
 * embodied plasticity, and the recorded policy changes that may follow it.
 * Neither touches a store or advances the clock. A caller verifies against a
 * backup and the exact engine that produced the checkpoint, then takes the
 * one-writer lease before any production commit.
 *
 * Birth, individual ID, epoch, city and fly state, controller, learned mushroom
 * body weights, self-model, physiology, remembered places, random streams and
 * archive are all preserved, which the projection proves byte for byte.
 */
import { checkpointLife, restoreLife, type LifeCheckpoint } from "./continuity.js";
import { Graph } from "./echoUpgrade.js";
import {
  PLASTICITY_CONTINUATION,
  PLASTICITY_CONTINUATION_SOURCE,
  PLASTICITY_EVENT,
  PLASTICITY_LIFE,
  PLASTICITY_MODE_LEAF,
  PLASTICITY_POLICY,
  PLASTICITY_POLICY_EVENT,
  PLASTICITY_START_MODE,
  plasticityModeOf,
  plasticityPolicyProjection,
  plasticityProjection,
  plasticitySourceErrors,
  type PlasticityOrganismLife,
} from "./plasticOrganism.js";
import {
  ADAPTIVE_BRAIN_VERSION,
  isPlasticityMode,
  type PlasticityMode,
} from "../fly/echo/adaptiveBrain.js";
import { type HeadlessGenesis } from "./headless.js";
import { ORGANISM_ADAPTER_PATH as ADAPTER } from "./organism.js";
import { indexGraph, restoreGraph, snapshotGraph } from "./snapshot.js";

type Checkpoint = LifeCheckpoint<HeadlessGenesis>;

export interface PlasticityContinuation {
  life: PlasticityOrganismLife;
  checkpoint: Checkpoint;
  preservedGraphDigest: string;
}

const validInterval = (from: string, to: string) =>
  Number.isFinite(Date.parse(from)) &&
  Number.isFinite(Date.parse(to)) &&
  Date.parse(from) <= Date.parse(to);

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
  if (!validInterval(stoppedUtc, upgradedUtc))
    throw new Error("invalid ECHO pause interval");
  const old = new Graph(source.graph, false);
  if (
    old.object([]).c !== "OrganismLife" ||
    old.object(ADAPTER).c !== "OrganismAdapter" ||
    old.get(["cityFly", "controller"]) !== "echo" ||
    old.get(["cityFly", "failed"]) !== null
  )
    throw new Error("source is not the existing, healthy ECHO organism");

  // A fresh NEW-KIND template supplies only the new plasticity object. Every
  // existing object and stream is the authentic source graph's.
  const fresh = () => PLASTICITY_LIFE.build(structuredClone(source.genesis));
  // The reference graph comes from a DIFFERENT fresh instance: passing the same
  // instance as its shared index would share away the new adapter's own fields.
  const template = new Graph(snapshotGraph(fresh(), indexGraph(fresh())), false);
  if (template.get(PLASTICITY_MODE_LEAF) !== PLASTICITY_START_MODE)
    throw new Error("the plasticity template does not start in shadow mode");
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
  const p = life.adaptive.plasticity.state;
  if (p.samples !== 0 || p.pending !== null || p.mode !== PLASTICITY_START_MODE)
    throw new Error("new plasticity did not start empty and in shadow mode");

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
          sourceRelease: PLASTICITY_CONTINUATION_SOURCE,
          parent: source.digest,
          sourceStateHash: source.stateHash,
          sourceGraphDigest: source.graphDigest,
          preservedGraphDigest,
          pausedFromUtc: stoppedUtc,
          upgradedUtc,
          added: ADAPTIVE_BRAIN_VERSION,
          mode: PLASTICITY_START_MODE,
          interpretation:
            "The same ECHO organism now also keeps a bounded memory of how reliably its own walking carries it forward, learned from its own self-motion sense and touch. It starts empty and in shadow mode, so it changes no command. Every earlier byte of the organism is unchanged.",
        },
      },
    ],
  });
  const transition = PLASTICITY_LIFE.history!.transition(source, checkpoint);
  if (transition.length) throw new Error(transition.join("; "));
  restoreLife(PLASTICITY_LIFE, checkpoint);
  return { life, checkpoint, preservedGraphDigest };
}

export interface PlasticityPolicyChange {
  life: PlasticityOrganismLife;
  checkpoint: Checkpoint;
  from: PlasticityMode;
  to: PlasticityMode;
}

/**
 * A recorded change of the plasticity's mode: a checkpoint at the unchanged
 * tick whose graph differs from its parent's in that one leaf, which the
 * projection proves. This is the only way a mode changes, and the way to
 * disable it: never a restore of an earlier checkpoint.
 */
export function changePlasticityPolicy(
  source: Checkpoint,
  to: PlasticityMode,
  reason: string,
  changedUtc: string,
  stoppedUtc = changedUtc,
): PlasticityPolicyChange {
  if (!isPlasticityMode(to)) throw new Error(`unknown plasticity mode ${String(to)}`);
  if (!reason.trim()) throw new Error("a policy change needs its reason");
  if (!validInterval(stoppedUtc, changedUtc))
    throw new Error("invalid ECHO pause interval");
  const restored = restoreLife(PLASTICITY_LIFE, source);
  if (!source.graph)
    throw new Error("a policy change needs the un-compacted source graph");
  const from = plasticityModeOf(source.graph);
  if (from === to) throw new Error(`the plasticity is already ${to}`);
  if (restored.adaptive.plasticity.state.mode !== from)
    throw new Error("the restored plasticity does not hold its graph's mode");
  const graph = new Graph(source.graph);
  graph.set(PLASTICITY_MODE_LEAF, to);
  const life = restoreGraph(
    graph.snapshot,
    PLASTICITY_LIFE.build(structuredClone(source.genesis)),
  );
  if (life.city.tick !== source.tick) throw new Error("a policy change moved the clock");
  if (life.adaptive.plasticity.state.mode !== to)
    throw new Error("the changed plasticity does not hold its new mode");
  const again = snapshotGraph(
    life,
    indexGraph(PLASTICITY_LIFE.build(structuredClone(source.genesis))),
  );
  if (plasticityPolicyProjection(again, from) !== source.graphDigest)
    throw new Error("the policy change changed more than its mode");
  const checkpoint = checkpointLife(PLASTICITY_LIFE, life, {
    genesis: source.genesis,
    birth: source.birth,
    previous: source,
    events: [
      {
        tick: source.tick,
        kind: PLASTICITY_POLICY_EVENT,
        data: {
          policy: PLASTICITY_POLICY,
          parent: source.digest,
          sourceStateHash: source.stateHash,
          sourceGraphDigest: source.graphDigest,
          from,
          to,
          reason: reason.trim(),
          pausedFromUtc: stoppedUtc,
          changedUtc,
        },
      },
    ],
  });
  const transition = PLASTICITY_LIFE.history!.transition(source, checkpoint);
  if (transition.length) throw new Error(transition.join("; "));
  restoreLife(PLASTICITY_LIFE, checkpoint);
  return { life, checkpoint, from, to };
}
