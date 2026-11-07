/**
 * The SAME deployed ECHO individual can continue as an organism with a bounded
 * action-outcome learning. Versioned as a distinct life kind so checkpoints from
 * the previous organism era are never silently interpreted as upgraded.
 *
 * No live deployment happens by importing this module. The only path to the
 * original is a validated, one-time continuation of its exact stored head.
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
import { EmbodiedPlasticity, ADAPTIVE_BRAIN_VERSION } from "../fly/echo/adaptiveBrain.js";
import { BETHESDA_LIFE, type HeadlessGenesis } from "./headless.js";
import {
  ORGANISM_ADAPTER_PATH as ADAPTER,
  ORGANISM_LIFE,
  OrganismAdapter,
  OrganismLife,
} from "./organism.js";
import { GRAPH_SCHEMA, type GraphSnapshot } from "./snapshot.js";

export const PLASTICITY_CONTINUATION = "bethesda-echo-plasticity-continuation/v1";
export const PLASTICITY_EVENT = "plasticity-continuation";

type Checkpoint = LifeCheckpoint<HeadlessGenesis>;
const exactSource = { ...ORGANISM_LIFE.versions, graph: GRAPH_SCHEMA };

export class PlasticOrganismAdapter extends OrganismAdapter {
  readonly plasticitys: EmbodiedPlasticity;

  constructor(rng: () => number, streams: AdapterStreams, seed: number) {
    super(rng, streams, seed);
    this.plasticitys = new EmbodiedPlasticity();
  }

  override get state() {
    return { ...super.state, plasticitys: this.plasticitys.state };
  }

  override decide(input: DecisionInput): MotorCommand {
    this.plasticity.observe(input.self);
    // The old organism has priority; the plasticity policy cannot alter reflexes
    // or bypass the motor-command safety gate.
    const command = super.decide(input);
    return this.plasticitys.decide(input, command);
  }
}

export class PlasticOrganismLife extends OrganismLife {
  constructor(config: HeadlessGenesis["config"]) {
    super(config, (rng, streams, seed) => new PlasticOrganismAdapter(rng, streams, seed));
  }

  get adaptive(): PlasticOrganismAdapter {
    const o = this.organism;
    if (!(o instanceof PlasticOrganismAdapter))
      throw new Error("expected the continued ECHO plasticity adapter");
    return o;
  }

  override organismStatus() {
    return {
      ...super.organismStatus(),
      plasticityVersion: ADAPTIVE_BRAIN_VERSION,
      plasticitys: structuredClone(this.adaptive.plasticitys.state),
    };
  }
}

/** Reverse ONLY the declared addition, then compare exactly to the old graph. */
export function plasticityProjection(graph: GraphSnapshot): string {
  const g = new Graph(graph);
  if (
    g.object([]).c !== "PlasticOrganismLife" ||
    g.object(ADAPTER).c !== "PlasticOrganismAdapter"
  )
    throw new Error("not an ECHO plasticity continuation graph");
  g.object([]).c = "OrganismLife";
  g.object(ADAPTER).c = "OrganismAdapter";
  g.remove([...ADAPTER, "plasticitys"]);
  return sha256(JSON.stringify(g.canonical()));
}

export const PLASTIC_LIFE: LifeKind<HeadlessGenesis, PlasticOrganismLife> = {
  id: BETHESDA_LIFE.id,
  versions: { ...ORGANISM_LIFE.versions, plasticitys: ADAPTIVE_BRAIN_VERSION },
  build: (genesis) => new PlasticOrganismLife(genesis.config),
  step: (life, ticks) => ORGANISM_LIFE.step(life, ticks),
  tick: (life) => life.city.tick,
  hash: (life) => `${ORGANISM_LIFE.hash(life)}|${sha256Json(life.adaptive.plasticitys.state)}`,
  history: {
    versions: [...ORGANISM_LIFE.history!.versions, ORGANISM_LIFE.versions],
    transition(previous, next) {
      const isNext = next.versions.plasticitys === ADAPTIVE_BRAIN_VERSION;
      const wasPrevious = previous?.versions.plasticitys === ADAPTIVE_BRAIN_VERSION;
      if (!isNext) {
        if (wasPrevious)
          return ["an ECHO plasticity continuation cannot be reversed or erased"];
        if (next.events.some((e) => e.kind === PLASTICITY_EVENT))
          return ["only the plasticity life may record a plasticity continuation"];
        return ORGANISM_LIFE.history!.transition(previous, next);
      }
      if (!previous) return ["plasticity continuation is never a new birth"];
      if (wasPrevious) {
        if (!sameVersions(previous.versions, next.versions))
          return ["changed plasticity version in one life"];
        if (next.events.some((e) => e.kind === PLASTICITY_EVENT))
          return ["a plasticity continuation cannot be repeated"];
        return [];
      }
      if (!sameVersions(previous.versions, exactSource))
        return ["only the actual organism era can continue to the plasticity era"];
      const events = next.events.filter(
        (e) =>
          e.kind === PLASTICITY_EVENT ||
          e.kind === "engine-upgrade" ||
          e.kind === "self-model-upgrade" ||
          e.kind === "organism-continuation" ||
          e.kind === "physics-repair",
      );
      const e = events[0];
      if (
        events.length !== 1 ||
        !e ||
        e.kind !== PLASTICITY_EVENT ||
        next.tick !== previous.tick ||
        e.tick !== previous.tick
      )
        return ["continuation requires exactly one plasticity event at an unchanged tick"];
      const d = e.data;
      if (
        d.migration !== PLASTICITY_CONTINUATION ||
        d.parent !== previous.digest ||
        d.sourceStateHash !== previous.stateHash ||
        d.sourceGraphDigest !== previous.graphDigest ||
        d.preservedGraphDigest !== previous.graphDigest
      )
        return ["plasticity continuation does not attest its exact original parent"];
      if (
        typeof d.pausedFromUtc !== "string" ||
        typeof d.upgradedUtc !== "string" ||
        !Number.isFinite(Date.parse(d.pausedFromUtc)) ||
        !Number.isFinite(Date.parse(d.upgradedUtc)) ||
        Date.parse(d.pausedFromUtc) > Date.parse(d.upgradedUtc)
      )
        return ["plasticity continuation has no valid pause interval"];
      if (next.graph) {
        try {
          if (plasticityProjection(next.graph) !== previous.graphDigest)
            return ["plasticity continuation failed exact graph preservation"];
        } catch {
          return ["plasticity continuation graph invalid"];
        }
      }
      return [];
    },
  },
};

/** Verify source checkpoint against its OWN versions before any migration. */
export function plasticitySourceErrors(source: Checkpoint): string[] {
  if (!sameVersions(source.versions, exactSource))
    return ["not a prior ECHO organism checkpoint"];
  return checkpointErrors(ORGANISM_LIFE, source);
}
