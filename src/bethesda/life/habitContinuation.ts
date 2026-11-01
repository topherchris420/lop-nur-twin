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
import {
  checkpointLife,
  restoreLife,
  type LifeCheckpoint,
} from "./continuity.js";
import { Graph } from "./echoUpgrade.js";
import {
  HABIT_CONTINUATION,
  HABIT_EVENT,
  HABIT_LIFE,
  habitProjection,
  habitSourceErrors,
  type HabitOrganismLife,
} from "./habitOrganism.js";
import { HABIT_VERSION } from "./experientialHabits.js";
import { type HeadlessGenesis } from "./headless.js";
import { ORGANISM_ADAPTER_PATH as ADAPTER } from "./organism.js";
import { indexGraph, restoreGraph, snapshotGraph } from "./snapshot.js";

type Checkpoint = LifeCheckpoint<HeadlessGenesis>;

export interface HabitContinuation {
  life: HabitOrganismLife;
  checkpoint: Checkpoint;
  preservedGraphDigest: string;
}

export function continueWithHabits(
  source: Checkpoint,
  upgradedUtc: string,
  stoppedUtc = upgradedUtc,
): HabitContinuation {
  const errors = habitSourceErrors(source);
  if (errors.length) throw new Error(`habit continuation refused: ${errors.join("; ")}`);
  if (!source.graph) throw new Error("habit continuation needs the un-compacted source graph");
  if (
    !Number.isFinite(Date.parse(upgradedUtc)) ||
    !Number.isFinite(Date.parse(stoppedUtc)) ||
    Date.parse(stoppedUtc) > Date.parse(upgradedUtc)
  ) throw new Error("invalid ECHO pause interval");
  const old = new Graph(source.graph, false);
  if (
    old.object([]).c !== "OrganismLife" ||
    old.object(ADAPTER).c !== "OrganismAdapter" ||
    old.get(["cityFly", "controller"]) !== "echo" ||
    old.get(["cityFly", "failed"]) !== null
  ) throw new Error("source is not the existing, healthy ECHO organism");

  // A fresh NEW-KIND template supplies only the new habits property. Existing
  // object references and streams are reused from the authentic source graph.
  const fresh = () => HABIT_LIFE.build(structuredClone(source.genesis));
  const templateLife = fresh();
  const template = new Graph(snapshotGraph(templateLife, indexGraph(templateLife)), false);
  const graph = new Graph(source.graph);
  graph.object([]).c = "HabitOrganismLife";
  graph.object(ADAPTER).c = "HabitOrganismAdapter";
  graph.set(
    [...ADAPTER, "habits"],
    graph.import(template, template.get([...ADAPTER, "habits"])),
  );
  const life = restoreGraph(graph.snapshot, fresh());
  if (life.city.tick !== source.tick)
    throw new Error("habit continuation changed the organism's clock");
  if (life.adaptive.habits.state.experiences !== 0)
    throw new Error("new habit learning was not initialized at zero experience");

  const restoredGraph = snapshotGraph(life, indexGraph(fresh()));
  const preservedGraphDigest = habitProjection(restoredGraph);
  if (preservedGraphDigest !== source.graphDigest)
    throw new Error("habit continuation did not preserve every old graph byte");

  const checkpoint = checkpointLife(HABIT_LIFE, life, {
    genesis: source.genesis,
    birth: source.birth,
    previous: source,
    events: [
      {
        tick: source.tick,
        kind: HABIT_EVENT,
        data: {
          migration: HABIT_CONTINUATION,
          parent: source.digest,
          sourceStateHash: source.stateHash,
          sourceGraphDigest: source.graphDigest,
          preservedGraphDigest,
          pausedFromUtc: stoppedUtc,
          upgradedUtc,
          added: HABIT_VERSION,
          interpretation:
            "The same ECHO organism learns bounded walking-pace habits from its own movement and energy, without altering its prior history, reflexes or the motor gate.",
        },
      },
    ],
  });
  const transition = HABIT_LIFE.history!.transition(source, checkpoint);
  if (transition.length) throw new Error(transition.join("; "));
  restoreLife(HABIT_LIFE, checkpoint);
  return { life, checkpoint, preservedGraphDigest };
}
