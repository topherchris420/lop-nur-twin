/**
 * The SAME deployed ECHO individual, continued as an organism with embodied
 * plasticity (fly/echo/adaptiveBrain.ts). Versioned as a distinct life kind so
 * checkpoints from the organism era are never silently read as upgraded.
 *
 * The addition is one object on the organism's adapter, `plasticity`, holding
 * its own state; the projection that removes it and names the two classes back
 * must give the organism graph's digest exactly. It acts through the organism's
 * `shape` hook, before the ECHO self-model acts on an intention, so the
 * self-model predicts from what is really commanded and every command still
 * passes the self-model, the physiology rest, the fast pathway's reflexes and
 * the body's gate exactly as before.
 *
 * Its policy (shadow, active or disabled) is part of its state. The continuation
 * starts it in shadow mode; any later change is its own recorded checkpoint, at
 * an unchanged tick, whose projection (the mode put back) gives the previous
 * graph's digest. Nothing is ever rolled back: disabling it is a forward change.
 *
 * No live deployment happens by importing this module.
 */
import { sha256, sha256Json } from "../../rain/sha256.js";
import type { AdapterStreams, DecisionInput, MotorCommand } from "../fly/neural.js";
import {
  checkpointErrors,
  sameVersions,
  type LifeCheckpoint,
  type LifeKind,
} from "./continuity.js";
import { Graph } from "./echoUpgrade.js";
import {
  ADAPTIVE_BRAIN_VERSION,
  EmbodiedPlasticity,
  isPlasticityMode,
  type AdaptiveBrainStatus,
  type PlasticityMode,
} from "../fly/echo/adaptiveBrain.js";
import { BETHESDA_LIFE, type HeadlessGenesis } from "./headless.js";
import type { LifeObservation } from "./observation.js";
import {
  ORGANISM_ADAPTER_PATH as ADAPTER,
  ORGANISM_EVENT,
  ORGANISM_LIFE,
  OrganismAdapter,
  OrganismLife,
  PHYSICS_REPAIR_EVENT,
} from "./organism.js";
import { GRAPH_SCHEMA, type GraphSnapshot } from "./snapshot.js";

export const PLASTICITY_CONTINUATION = "bethesda-echo-plasticity-continuation/v2";
export const PLASTICITY_EVENT = "plasticity-continuation";
/** The release that writes the organism checkpoints this continuation accepts (the VM's since 2026-11-04). */
export const PLASTICITY_CONTINUATION_SOURCE = "e458f7cb34904d85127779a3700c26b376ab4a80";
export const PLASTICITY_POLICY = "bethesda-echo-plasticity-policy/v1";
export const PLASTICITY_POLICY_EVENT = "plasticity-policy";
/** The mode the continuation starts in: learning, changing nothing. */
export const PLASTICITY_START_MODE: PlasticityMode = "shadow";
/** Where the plasticity's mode sits in the life's graph. */
export const PLASTICITY_MODE_LEAF = [...ADAPTER, "plasticity", "state", "mode"];

type Checkpoint = LifeCheckpoint<HeadlessGenesis>;
const exactSource = { ...ORGANISM_LIFE.versions, graph: GRAPH_SCHEMA };
/** Events that move a life from one engine or era to another. */
const MARKS = [
  "engine-upgrade",
  "self-model-upgrade",
  ORGANISM_EVENT,
  PHYSICS_REPAIR_EVENT,
  PLASTICITY_EVENT,
  PLASTICITY_POLICY_EVENT,
];

export class PlasticityOrganismAdapter extends OrganismAdapter {
  readonly plasticity: EmbodiedPlasticity;

  constructor(
    rng: () => number,
    streams: AdapterStreams,
    seed: number,
    mode: PlasticityMode = PLASTICITY_START_MODE,
  ) {
    super(rng, streams, seed);
    this.plasticity = new EmbodiedPlasticity(mode);
  }

  override get state() {
    return { ...super.state, plasticity: this.plasticity.state };
  }

  /** The organism's hook: the intention before the self-model acts on it. */
  protected override shape(input: DecisionInput, intention: MotorCommand): MotorCommand {
    return this.plasticity.shape(input, intention);
  }

  override decide(input: DecisionInput): MotorCommand {
    this.plasticity.observe(input);
    const command = super.decide(input);
    this.plasticity.issued(command, input.body);
    return command;
  }

  override interrupt(input: DecisionInput): MotorCommand | null {
    const command = super.interrupt(input);
    if (command) this.plasticity.interrupted();
    return command;
  }
}

export class PlasticityOrganismLife extends OrganismLife {
  constructor(
    config: HeadlessGenesis["config"],
    mode: PlasticityMode = PLASTICITY_START_MODE,
  ) {
    super(
      config,
      (rng, streams, seed) => new PlasticityOrganismAdapter(rng, streams, seed, mode),
    );
  }

  get adaptive(): PlasticityOrganismAdapter {
    const o = this.organism;
    if (!(o instanceof PlasticityOrganismAdapter))
      throw new Error("expected the continued ECHO plasticity adapter");
    return o;
  }

  override organismStatus() {
    return { ...super.organismStatus(), plasticity: this.adaptive.plasticity.status() };
  }

  /** The organism's observation, with what the plasticity holds. Reads only. */
  override observation(at: Parameters<OrganismLife["observation"]>[0]): LifeObservation {
    return { ...super.observation(at), adaptiveBrain: this.adaptive.plasticity.status() };
  }
}

/** The mode a plasticity graph holds. */
export function plasticityModeOf(graph: GraphSnapshot): PlasticityMode {
  const mode = new Graph(graph).get(PLASTICITY_MODE_LEAF);
  if (!isPlasticityMode(mode)) throw new Error("the graph holds no plasticity mode");
  return mode;
}

/** Reverse ONLY the declared addition, then hash: equals the organism graph's digest when every byte was kept. */
export function plasticityProjection(graph: GraphSnapshot): string {
  const g = new Graph(graph);
  if (
    g.object([]).c !== "PlasticityOrganismLife" ||
    g.object(ADAPTER).c !== "PlasticityOrganismAdapter"
  )
    throw new Error("not an ECHO plasticity continuation graph");
  g.object([]).c = "OrganismLife";
  g.object(ADAPTER).c = "OrganismAdapter";
  g.remove([...ADAPTER, "plasticity"]);
  return sha256(JSON.stringify(g.canonical()));
}

/** Put the previous mode back, then hash: equals the previous graph's digest when the mode was the only change. */
export function plasticityPolicyProjection(
  graph: GraphSnapshot,
  from: PlasticityMode,
): string {
  const g = new Graph(graph);
  if (g.object([]).c !== "PlasticityOrganismLife")
    throw new Error("not a plasticity graph");
  if (!isPlasticityMode(g.get(PLASTICITY_MODE_LEAF)))
    throw new Error("the graph holds no plasticity mode");
  g.set(PLASTICITY_MODE_LEAF, from);
  return sha256(JSON.stringify(g.canonical()));
}

const validPause = (d: Record<string, unknown>, from: string, to: string) =>
  typeof d[from] === "string" &&
  typeof d[to] === "string" &&
  Number.isFinite(Date.parse(d[from])) &&
  Number.isFinite(Date.parse(d[to])) &&
  Date.parse(d[from]) <= Date.parse(d[to]);

/** A policy checkpoint: one event, at the unchanged tick, attesting its parent, the mode the only change. */
function policyErrors(previous: Checkpoint, next: Checkpoint): string[] {
  const policies = next.events.filter((e) => e.kind === PLASTICITY_POLICY_EVENT);
  if (!policies.length) return [];
  const e = policies[0]!;
  if (
    policies.length !== 1 ||
    next.events.length !== 1 ||
    e.tick !== previous.tick ||
    next.tick !== previous.tick
  )
    return [
      "a plasticity policy change needs exactly one event, and no other, at the unchanged tick",
    ];
  const d = e.data;
  if (
    d.policy !== PLASTICITY_POLICY ||
    d.parent !== previous.digest ||
    d.sourceStateHash !== previous.stateHash ||
    d.sourceGraphDigest !== previous.graphDigest ||
    !isPlasticityMode(d.from) ||
    !isPlasticityMode(d.to) ||
    d.from === d.to ||
    typeof d.reason !== "string" ||
    !d.reason.trim()
  )
    return ["a plasticity policy change does not attest its exact parent and modes"];
  if (!validPause(d, "pausedFromUtc", "changedUtc"))
    return ["a plasticity policy change has no valid pause interval"];
  if (next.graph) {
    try {
      if (plasticityModeOf(next.graph) !== d.to)
        return ["a plasticity policy change does not hold the mode it names"];
      if (plasticityPolicyProjection(next.graph, d.from) !== previous.graphDigest)
        return ["a plasticity policy change changed more than its mode"];
    } catch {
      return ["a plasticity policy change's graph is invalid"];
    }
  }
  return [];
}

export const PLASTICITY_LIFE: LifeKind<HeadlessGenesis, PlasticityOrganismLife> = {
  id: BETHESDA_LIFE.id,
  versions: { ...ORGANISM_LIFE.versions, plasticity: ADAPTIVE_BRAIN_VERSION },
  build: (genesis) => new PlasticityOrganismLife(genesis.config),
  step: (life, ticks) => ORGANISM_LIFE.step(life, ticks),
  tick: (life) => life.city.tick,
  hash: (life) =>
    `${ORGANISM_LIFE.hash(life)}|${sha256Json(life.adaptive.plasticity.state)}`,
  history: {
    versions: [...ORGANISM_LIFE.history!.versions, ORGANISM_LIFE.versions],
    transition(previous, next) {
      const isNext = next.versions.plasticity === ADAPTIVE_BRAIN_VERSION;
      const wasPrevious = previous?.versions.plasticity === ADAPTIVE_BRAIN_VERSION;
      if (!isNext) {
        if (wasPrevious)
          return ["an ECHO plasticity continuation cannot be reversed or erased"];
        if (
          next.events.some(
            (e) => e.kind === PLASTICITY_EVENT || e.kind === PLASTICITY_POLICY_EVENT,
          )
        )
          return [
            "only the plasticity life may record a plasticity continuation or policy",
          ];
        return ORGANISM_LIFE.history!.transition(previous, next);
      }
      if (next.genesis.flyController !== "reduced-order")
        return [
          "this continuation requires the deployed individual's reduced-order birth",
        ];
      if (!previous) return ["plasticity continuation is never a new birth"];
      if (wasPrevious) {
        if (!sameVersions(previous.versions, next.versions))
          return ["changed plasticity version in one life"];
        if (next.events.some((e) => e.kind === PLASTICITY_EVENT))
          return ["a plasticity continuation cannot be repeated"];
        if (
          next.events.some(
            (e) => MARKS.includes(e.kind) && e.kind !== PLASTICITY_POLICY_EVENT,
          )
        )
          return ["no other era change may follow the plasticity continuation"];
        return policyErrors(previous, next);
      }
      if (!sameVersions(previous.versions, exactSource))
        return ["only the actual organism era can continue to the plasticity era"];
      const marks = next.events.filter((e) => MARKS.includes(e.kind));
      const e = marks[0];
      if (
        marks.length !== 1 ||
        next.events.length !== 1 ||
        !e ||
        e.kind !== PLASTICITY_EVENT ||
        next.tick !== previous.tick ||
        e.tick !== previous.tick
      )
        return [
          "continuation requires exactly one plasticity event, and no other, at an unchanged tick",
        ];
      const d = e.data;
      if (
        d.migration !== PLASTICITY_CONTINUATION ||
        d.sourceRelease !== PLASTICITY_CONTINUATION_SOURCE ||
        d.parent !== previous.digest ||
        d.sourceStateHash !== previous.stateHash ||
        d.sourceGraphDigest !== previous.graphDigest ||
        d.preservedGraphDigest !== previous.graphDigest ||
        d.added !== ADAPTIVE_BRAIN_VERSION ||
        d.mode !== PLASTICITY_START_MODE
      )
        return ["plasticity continuation does not attest its exact original parent"];
      if (!validPause(d, "pausedFromUtc", "upgradedUtc"))
        return ["plasticity continuation has no valid pause interval"];
      if (next.graph) {
        try {
          if (plasticityProjection(next.graph) !== previous.graphDigest)
            return ["plasticity continuation failed exact graph preservation"];
          if (plasticityModeOf(next.graph) !== PLASTICITY_START_MODE)
            return ["plasticity continuation must start in shadow mode"];
        } catch {
          return ["plasticity continuation graph invalid"];
        }
      }
      return [];
    },
  },
};

/** Verify a source checkpoint against its OWN versions before any migration. */
export function plasticitySourceErrors(source: Checkpoint): string[] {
  if (!sameVersions(source.versions, exactSource))
    return ["not a prior ECHO organism checkpoint"];
  return checkpointErrors(ORGANISM_LIFE, source);
}

export type { AdaptiveBrainStatus };
