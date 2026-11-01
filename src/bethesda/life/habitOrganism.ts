/**
 * The SAME deployed ECHO individual can continue as an organism with a small
 * learned habit layer. Versioned as a distinct life kind so checkpoints from
 * the previous organism era are never silently interpreted as upgraded.
 *
 * No live deployment happens by importing this module. The only path to the
 * original is a validated, one-time continuation of its exact stored head.
 */
import { sha256, sha256Json } from "../../rain/sha256.js";
import type { AdapterStreams, DecisionInput, MotorCommand } from "../fly/neural.js";
import { checkpointErrors, sameVersions, type LifeCheckpoint, type LifeKind } from "./continuity.js";
import { Graph } from "./echoUpgrade.js";
import { ExperientialHabits, HABIT_VERSION } from "./experientialHabits.js";
import { BETHESDA_LIFE, type HeadlessGenesis } from "./headless.js";
import { ORGANISM_ADAPTER_PATH as ADAPTER, ORGANISM_LIFE, OrganismAdapter, OrganismLife } from "./organism.js";
import { GRAPH_SCHEMA, type GraphSnapshot } from "./snapshot.js";

export const HABIT_CONTINUATION = "bethesda-echo-habit-continuation/v1";
export const HABIT_EVENT = "habit-continuation";

type Checkpoint = LifeCheckpoint<HeadlessGenesis>;
const exactSource = { ...ORGANISM_LIFE.versions, graph: GRAPH_SCHEMA };

export class HabitOrganismAdapter extends OrganismAdapter {
  readonly habits: ExperientialHabits;

  constructor(rng: () => number, streams: AdapterStreams, seed: number) {
    super(rng, streams, seed);
    this.habits = new ExperientialHabits();
  }

  override get state() {
    return { ...super.state, habits: this.habits.state };
  }

  override decide(input: DecisionInput): MotorCommand {
    // The old organism has priority; the habit policy cannot alter reflexes
    // or bypass the motor-command safety gate.
    const command = super.decide(input);
    return this.habits.decide(input, command);
  }
}

export class HabitOrganismLife extends OrganismLife {
  constructor(config: HeadlessGenesis["config"]) {
    super(config, (rng, streams, seed) => new HabitOrganismAdapter(rng, streams, seed));
  }

  get adaptive(): HabitOrganismAdapter {
    const o = this.organism;
    if (!(o instanceof HabitOrganismAdapter)) throw new Error("expected the continued ECHO habit adapter");
    return o;
  }

  override organismStatus() {
    return {
      ...super.organismStatus(),
      habitVersion: HABIT_VERSION,
      habits: structuredClone(this.adaptive.habits.state),
    };
  }
}

/** Reverse ONLY the declared addition, then compare exactly to the old graph. */
export function habitProjection(graph: GraphSnapshot): string {
  const g = new Graph(graph);
  if (g.object([]).c !== "HabitOrganismLife" || g.object(ADAPTER).c !== "HabitOrganismAdapter")
    throw new Error("not an ECHO habit continuation graph");
  g.object([]).c = "OrganismLife";
  g.object(ADAPTER).c = "OrganismAdapter";
  g.remove([...ADAPTER, "habits"]);
  return sha256(JSON.stringify(g.canonical()));
}

export const HABIT_LIFE: LifeKind<HeadlessGenesis, HabitOrganismLife> = {
  id: BETHESDA_LIFE.id,
  versions: { ...ORGANISM_LIFE.versions, habits: HABIT_VERSION },
  build: (genesis) => new HabitOrganismLife(genesis.config),
  step: (life, ticks) => ORGANISM_LIFE.step(life, ticks),
  tick: (life) => life.city.tick,
  hash: (life) =>
    `${ORGANISM_LIFE.hash(life)}|${sha256Json(life.adaptive.habits.state)}`,
  history: {
    versions: [...ORGANISM_LIFE.history!.versions, ORGANISM_LIFE.versions],
    transition(previous, next) {
      const isNext = next.versions.habits === HABIT_VERSION;
      const wasPrevious = previous?.versions.habits === HABIT_VERSION;
      if (!isNext) {
        if (wasPrevious) return ["an ECHO habit continuation cannot be reversed or erased"];
        if (next.events.some((e) => e.kind === HABIT_EVENT))
          return ["only the habit life may record a habit continuation"];
        return ORGANISM_LIFE.history!.transition(previous, next);
      }
      if (!previous) return ["habit continuation is never a new birth"];
      if (wasPrevious) {
        if (!sameVersions(previous.versions, next.versions))
          return ["changed habit version in one life"];
        if (next.events.some((e) => e.kind === HABIT_EVENT))
          return ["a habit continuation cannot be repeated"];
        return [];
      }
      if (!sameVersions(previous.versions, exactSource))
        return ["only the actual organism era can continue to the habit era"];
      const events = next.events.filter((e) =>
        e.kind === HABIT_EVENT ||
        e.kind === "engine-upgrade" ||
        e.kind === "self-model-upgrade" ||
        e.kind === "organism-continuation",
      );
      const e = events[0];
      if (events.length !== 1 || !e || e.kind !== HABIT_EVENT ||
          next.tick !== previous.tick || e.tick !== previous.tick)
        return ["continuation requires exactly one habit event at an unchanged tick"];
      const d = e.data;
      if (
        d.migration !== HABIT_CONTINUATION ||
        d.parent !== previous.digest ||
        d.sourceStateHash !== previous.stateHash ||
        d.sourceGraphDigest !== previous.graphDigest ||
        d.preservedGraphDigest !== previous.graphDigest
      )
        return ["habit continuation does not attest its exact original parent"];
      if (
        typeof d.pausedFromUtc !== "string" ||
        typeof d.upgradedUtc !== "string" ||
        !Number.isFinite(Date.parse(d.pausedFromUtc)) ||
        !Number.isFinite(Date.parse(d.upgradedUtc)) ||
        Date.parse(d.pausedFromUtc) > Date.parse(d.upgradedUtc)
      )
        return ["habit continuation has no valid pause interval"];
      if (next.graph) {
        try {
          if (habitProjection(next.graph) !== previous.graphDigest)
            return ["habit continuation failed exact graph preservation"];
        } catch {
          return ["habit continuation graph invalid"];
        }
      }
      return [];
    },
  },
};

/** Verify source checkpoint against its OWN versions before any migration. */
export function habitSourceErrors(source: Checkpoint): string[] {
  if (!sameVersions(source.versions, exactSource))
    return ["not a prior ECHO organism checkpoint"];
  return checkpointErrors(ORGANISM_LIFE, source);
}
