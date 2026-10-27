/**
 * The deployed individual's nervous system, extended during its life. It is
 * the ECHO v3 fly it already was: the same reduced-order controller and
 * self-model, every memory, belief and random stream as they were. One
 * recorded continuation (organismContinuation.ts) adds three things:
 *
 * - **Mushroom-body learning** (fly/mushroomBody/circuit.ts; Bennett,
 *   Philippides & Nowotny 2021): rate units whose synapses learn from every
 *   meal and every fruitless return from then on, and that value the food
 *   places the fly remembers from then on. A place it already remembered
 *   keeps the rule it was learned under (it draws a hungry fly, and two
 *   fruitless returns forget it): synapses that never saw it cannot value it,
 *   and an innate circuit would give up every one.
 * - **Olfactory navigation** (foraging/olfaction.ts; Álvarez-Salvado et al.
 *   2018): ON/OFF filters of the odour the fly smells, which turn a hungry
 *   walking fly upwind while odour is on and into local search when it goes
 *   off. It reads the fly's senses and its own reserve, never where food is,
 *   and adjusts only a walking command, never near an obstacle or a contact.
 * - **Recoverable physiology** (immortal/physiology.ts): tissue proxies (ATP
 *   availability, hydration, fatigue, sleep pressure, stress) and a
 *   deliberately artificial maintenance supply, metered apart from food, that
 *   keeps starvation recoverable. Nothing here dies, ages out or is replaced.
 *
 * What happens to it from then on is archived (`OrganismLife.archive`) into
 * the next verified checkpoint's events: recovery and rest bouts, every
 * mushroom-body update, and every ECHO episode its bounded memory forgets.
 *
 * Every command still passes the fly's own gate. These are rate units and
 * behavioural filters, not a complete nervous system, a connectome or
 * cellular physiology, and nothing here is evidence of awareness.
 */
import { sha256, sha256Json } from "../../rain/sha256.js";
import { DT, type Config } from "../simulation.js";
import { ReducedOrderController, REDUCED_ORDER_DESCRIPTOR } from "../fly/controller.js";
import { EchoAdapter, echoDescriptor, type EchoDecision } from "../fly/echo/adapter.js";
import type { Episode } from "../fly/echo/memory.js";
import { selfModelView } from "../fly/echo/view.js";
import { MushroomBody } from "../fly/mushroomBody/circuit.js";
import { MUSHROOM_BODY_DESCRIPTOR } from "../fly/mushroomBody/controller.js";
import { resolveMushroomBodyParams } from "../fly/mushroomBody/params.js";
import { PLACE_MISSES, type Place, type PlaceValuation } from "../fly/navigation.js";
import {
  PERCHED,
  type AdapterDescriptor,
  type AdapterStreams,
  type DecisionInput,
  type MotorCommand,
} from "../fly/neural.js";
import {
  sameVersions,
  type LifeCheckpoint,
  type LifeEvent,
  type LifeKind,
} from "./continuity.js";
import {
  ECHO_UPGRADED_LIFE,
  ECHO_V2_VERSIONS,
  Graph,
  LEGACY_VERSIONS,
} from "./echoUpgrade.js";
import {
  OlfactoryNavigation,
  olfactoryView,
  OLFACTION_VERSION,
} from "./foraging/olfaction.js";
import { BETHESDA_LIFE, HeadlessBethesdaLife, type HeadlessGenesis } from "./headless.js";
import { Physiology, PHYSIOLOGY_VERSION } from "./immortal/physiology.js";
import { GRAPH_SCHEMA, type GraphSnapshot, type GraphValue } from "./snapshot.js";

export const ORGANISM_VERSION = "bethesda-echo-organism/v1";
/** The recorded continuation from ECHO v3, and the deployed release whose engine wrote its source. */
export const ORGANISM_CONTINUATION = "bethesda-organism-continuation/v1";
export const ORGANISM_CONTINUATION_SOURCE = "d25e1f3b9e40c5ded3f8ce1f435365d5c6c80592";
export const ORGANISM_EVENT = "organism-continuation";
/** The engine the deployed individual ran on before this continuation. */
export const ECHO_V3_VERSIONS = ECHO_UPGRADED_LIFE.versions;
/** Records held for the archive at most. The runner checkpoints long before; past it the clock stops. */
export const ARCHIVE_LIMIT = 4096;
/** Room one tick needs in the archive, with plenty to spare; checked before the tick. */
const ARCHIVE_PER_TICK = 64;
type Checkpoint = LifeCheckpoint<HeadlessGenesis>;
export const ORGANISM_ADAPTER_PATH = ["cityFly", "fly", "adapter"];
/** Everything the continuation adds: to the life, and to the fly's controller. */
export const ORGANISM_ADDITIONS = {
  life: ["archive"],
  adapter: ["circuit", "valuation", "physiology", "olfaction"],
} as const;

/** One value's subgraph on its own, canonical: how the continuation event records the descriptor it replaced. */
export function subgraph(g: Graph, value: GraphValue): GraphSnapshot {
  const out = new Graph({ schema: GRAPH_SCHEMA, root: null, nodes: [] });
  out.snapshot.root = out.import(g, value);
  return out.snapshot;
}

/**
 * The digest of the ECHO v3 graph that an organism graph holds: the declared
 * additions removed, the two classes renamed back, and the v3 descriptor that
 * the organism's replaced put back. It equals the v3 source's graph digest
 * exactly when every byte of that graph was kept. Pure, and needs nothing but
 * the organism graph and the descriptor its continuation event records, so
 * anyone holding the continuation checkpoint can check it again.
 */
export function organismProjection(
  graph: GraphSnapshot,
  descriptor: GraphSnapshot,
): string {
  const A = ORGANISM_ADAPTER_PATH;
  const projection = new Graph(graph);
  if (
    projection.object([]).c !== "OrganismLife" ||
    projection.object(A).c !== "OrganismAdapter"
  )
    throw new Error("not an organism graph");
  projection.object([]).c = "HeadlessBethesdaLife";
  for (const key of ORGANISM_ADDITIONS.life) projection.remove([key]);
  projection.object(A).c = "EchoAdapter";
  for (const key of ORGANISM_ADDITIONS.adapter) projection.remove([...A, key]);
  const d = new Graph(descriptor);
  projection.set([...A, "descriptor"], projection.import(d, d.snapshot.root));
  return sha256(JSON.stringify(projection.canonical()));
}

/**
 * What makes a remembered food place worth going back to, for a fly given a
 * mushroom body during its life. The circuit learns from every meal and every
 * fruitless return, and decides for the places remembered since it was added.
 * The places remembered before (`inherited`, the navigator's own objects) keep
 * the bookkeeping's rule: they draw a hungry fly, and `PLACE_MISSES` fruitless
 * returns forget them.
 */
export class LifelongPlaceValuation implements PlaceValuation {
  readonly circuit: MushroomBody;
  readonly inherited: Place[] = [];

  constructor(circuit: MushroomBody) {
    this.circuit = circuit;
  }

  worth(place: Place): boolean {
    return this.inherited.includes(place) || this.circuit.worth(place);
  }

  fed(place: Place): void {
    this.circuit.fed(place);
  }

  missed(place: Place): boolean {
    const at = this.inherited.indexOf(place);
    if (at < 0) return this.circuit.missed(place);
    // Learned from like any return, and forgotten by the rule it was remembered under.
    const cue = place.landmarks[0];
    if (cue !== undefined) this.circuit.trial(cue, 0, "fruitless return");
    const forget = ++place.misses >= PLACE_MISSES;
    if (forget) this.inherited.splice(at, 1);
    return forget;
  }

  /** Let go of the inherited places the navigator no longer remembers (by age, or crowded out). */
  keep(places: readonly Place[]): void {
    for (let i = this.inherited.length - 1; i >= 0; i--)
      if (!places.includes(this.inherited[i]!)) this.inherited.splice(i, 1);
  }
}

export function organismDescriptor(): AdapterDescriptor {
  return {
    id: `${ORGANISM_VERSION}: ${echoDescriptor("full").id}, with ${MUSHROOM_BODY_DESCRIPTOR.id}, ${OLFACTION_VERSION} and ${PHYSIOLOGY_VERSION}`,
    label: "ECHO organism (experimental)",
    fidelity:
      "The reduced-order behavioural controller and its ECHO v3 self-model, with three additions: the mushroom body's associative learning (Bennett, Philippides & Nowotny 2021; rate units: Kenyon cells, two output and two dopaminergic neurons) valuing the food places remembered since it was added; behavioural odour ON/OFF filters (Álvarez-Salvado et al. 2018) that steer a hungry walking fly; and tissue-level physiology proxies with a deliberately artificial maintenance supply that keeps starvation recoverable. Every command passes the fly's gate. Not a complete nervous system, a connectome or cellular physiology, and nothing here is a claim about awareness.",
    simulatesNeurons: true,
    // Copied, so no module constant is shared with the life's graph from here.
    regions: structuredClone([
      ...REDUCED_ORDER_DESCRIPTOR.regions,
      ...MUSHROOM_BODY_DESCRIPTOR.regions,
    ]),
    selfMotion: true,
  };
}

/** EchoAdapter's bookkeeping that a decision updates. */
type EchoBookkeeping = { now: number; onDecision?: (d: EchoDecision) => void };

/**
 * The ECHO controller with the three additions. Its own properties come
 * first and in EchoAdapter's order, so the continuation's projection removes
 * exactly the additions. Each addition draws only from a stream of its own.
 */
export class OrganismAdapter extends EchoAdapter {
  readonly circuit: MushroomBody;
  readonly valuation: LifelongPlaceValuation;
  readonly physiology: Physiology;
  readonly olfaction: OlfactoryNavigation;

  constructor(rng: () => number, streams: AdapterStreams, seed: number) {
    super(rng, streams, { variant: "full", seed });
    const self = this as unknown as {
      descriptor: AdapterDescriptor;
      inner: ReducedOrderController;
    };
    self.descriptor = organismDescriptor();
    this.circuit = new MushroomBody(resolveMushroomBodyParams(), seed);
    this.valuation = new LifelongPlaceValuation(this.circuit);
    // EchoAdapter (whose source the fly's digest pins) builds its controller
    // without a valuation. This is the same controller on the same streams,
    // its navigator valued by the circuit; neither constructor draws.
    self.inner = new ReducedOrderController(rng, streams.navigation, this.valuation);
    this.physiology = new Physiology(true);
    this.olfaction = new OlfactoryNavigation(seed);
  }

  override get state() {
    return {
      ...super.state,
      circuit: this.circuit.state,
      inherited: this.valuation.inherited.map((p) =>
        this.inner.state.nav.places.indexOf(p),
      ),
      physiology: this.physiology.state,
      olfaction: this.olfaction.state,
    };
  }

  /**
   * The self-model observes; the controller (its navigator valued as above)
   * intends; physiology may hold a perched fly at rest; odour adjusts a walk;
   * fatigue slows it; then the self-model acts, as in EchoAdapter.
   */
  override decide(input: DecisionInput): MotorCommand {
    const echo = this as unknown as EchoBookkeeping;
    const model = this.model!;
    echo.now = input.body.t;
    const view = selfModelView(input);
    model.observe(view);
    const smell = olfactoryView(input);
    this.olfaction.sample(smell.odour, input.dt);
    let intention = this.inner.decide(input);
    this.valuation.keep(this.inner.state.nav.places);
    const p = this.physiology.state;
    if (
      (p.protective || p.sleeping) &&
      PERCHED.has(input.body.mode) &&
      intention.mode !== "escape" &&
      intention.mode !== "feed"
    ) {
      model.interrupted();
      const command: MotorCommand = {
        mode: "rest",
        reason: p.protective ? "protective maintenance" : "sleep-pressure recovery",
      };
      echo.onDecision?.({ t: view.t, intention, command });
      return command;
    }
    if (!p.protective && !p.sleeping)
      intention = this.olfaction.modulate(intention, smell, input.dt);
    if (intention.mode === "walk" && intention.walkSpeed !== undefined)
      intention = {
        ...intention,
        walkSpeed: intention.walkSpeed * (1 - 0.7 * p.fatigue),
      };
    const { intention: intent, command } = model.act(intention, view);
    echo.onDecision?.({ t: view.t, intention: intent, command });
    return command;
  }
}

/** The city's fly's seed (cityFly.ts), checked against the fly once it is built. */
const flySeed = (config: Config) => (Math.imul(config.seed, 0x9e3779b1) ^ 0x0f1e5) >>> 0;

interface Watched {
  protective: boolean;
  sleeping: boolean;
  trials: number;
  /** The self-model's episodes before the tick, by id. */
  episodes: Map<number, Episode>;
}

/**
 * The city and its organism fly as one life. Each tick: physiology first
 * (its maintenance is external energy, put into the reserve before the body
 * spends), then the city and the fly as before, then what changed is
 * recorded in `archive` until a verified checkpoint carries it: recovery
 * bouts, rest bouts, mushroom-body updates, and each ECHO episode in its
 * final form when the self-model's bounded memory lets it go, so that the
 * archive and the memory together hold every episode kept since the
 * continuation.
 */
export class OrganismLife extends HeadlessBethesdaLife {
  archive: LifeEvent[] = [];

  constructor(config: Config) {
    const seed = flySeed(config);
    super(config, {
      flyController: "echo",
      researchAdapter: (rng, streams) => new OrganismAdapter(rng, streams, seed),
    });
    if (this.cityFly.seed !== seed)
      throw new Error("the organism is not seeded as its fly");
  }

  get organism(): OrganismAdapter {
    const a = this.cityFly.fly.adapter;
    if (!(a instanceof OrganismAdapter))
      throw new Error("this fly has no organism adapter");
    return a;
  }

  override advanceTicks(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > 10_000) {
      throw new Error("Headless tick count must be an integer from 0 to 10,000");
    }
    const a = this.organism,
      fly = this.cityFly.fly;
    for (let i = 0; i < count; i++) {
      // Fail closed: a full archive stops the clock; it never drops a record.
      if (this.archive.length > ARCHIVE_LIMIT - ARCHIVE_PER_TICK)
        throw new Error(
          "experience archive backpressure: checkpoint before advancing; nothing was discarded",
        );
      const p = a.physiology.state;
      const before: Watched = {
        protective: p.protective,
        sleeping: p.sleeping,
        trials: a.circuit.state.trials,
        episodes: new Map(a.model!.state.episodes.map((e) => [e.id, e])),
      };
      // The body's own ledger is untouched unless maintenance actually supplies energy.
      const capacity = fly.params.reserveJ;
      const supplied = a.physiology.advance(DT, {
        mode: fly.state.mode,
        reserve: Math.min(fly.state.reserve, capacity),
        capacity,
      });
      if (supplied > 0)
        fly.state.reserve = Math.min(capacity, fly.state.reserve + supplied);
      super.advanceTicks(1);
      this.note(before);
    }
  }

  private note(before: Watched): void {
    const a = this.organism,
      p = a.physiology.state,
      tick = this.city.tick;
    const add = (kind: string, data: Record<string, unknown>) =>
      this.archive.push({ tick, kind, data });
    if (p.protective !== before.protective)
      add(p.protective ? "recovery-enter" : "recovery-exit", {
        reserveFraction:
          this.cityFly.fly.state.reserve / this.cityFly.fly.params.reserveJ,
        maintenanceJ: p.maintenanceJ,
        recoveryBouts: p.recoveryBouts,
      });
    if (p.sleeping !== before.sleeping)
      add(p.sleeping ? "rest-bout" : "rest-complete", { sleepPressure: p.sleepPressure });
    const S = a.circuit.state;
    if (S.trials !== before.trials)
      add("associative-update", {
        updates: S.trials - before.trials,
        trials: S.trials,
        latestTrial: structuredClone(S.last),
      });
    const kept = new Set(a.model!.state.episodes.map((e) => e.id));
    for (const [id, episode] of before.episodes)
      if (!kept.has(id))
        add("echo-episode-archived", { episode: structuredClone(episode) });
  }

  /** Hand the pending records to a checkpoint; `returnArchive` puts them back if it is not committed. */
  takeArchive(): LifeEvent[] {
    const out = this.archive;
    this.archive = [];
    return out;
  }

  returnArchive(events: LifeEvent[]): void {
    this.archive = [...events, ...this.archive];
  }

  /** What the additions hold now, for the runner's log and checks. Model variables, not measurements. */
  organismStatus() {
    const a = this.organism,
      p = a.physiology.state,
      S = a.circuit.state,
      o = a.olfaction.state;
    return {
      version: ORGANISM_VERSION,
      physiology: {
        atp: p.atp,
        water: p.water,
        fatigue: p.fatigue,
        sleepPressure: p.sleepPressure,
        stress: p.stress,
        protective: p.protective,
        sleeping: p.sleeping,
        recoveryBouts: p.recoveryBouts,
        maintenanceJ: p.maintenanceJ,
      },
      mushroomBody: {
        trials: S.trials,
        fruitless: S.fruitless,
        inheritedPlaces: a.valuation.inherited.length,
      },
      olfaction: {
        on: o.on,
        off: o.off,
        modulatedDecisions: o.modulatedDecisions,
        searchTurns: o.searchTurns,
      },
      archivePending: this.archive.length,
      classification:
        "model variables of a simulated fly: not measured biology, and not evidence of awareness",
    };
  }
}

const V3 = { ...ECHO_V3_VERSIONS, graph: GRAPH_SCHEMA };
const MARKS = ["engine-upgrade", "self-model-upgrade", ORGANISM_EVENT];
const isOrganism = (c: Checkpoint) => "organism" in c.versions;

/**
 * The same kind and immutable birth as every earlier engine of this
 * individual. Its history is all of theirs: the legacy reduced-order fly,
 * ECHO v2, ECHO v3, then this.
 */
export const ORGANISM_LIFE: LifeKind<HeadlessGenesis, OrganismLife> = {
  id: BETHESDA_LIFE.id,
  versions: {
    ...ECHO_V3_VERSIONS,
    organism: ORGANISM_VERSION,
    mushroomBody: MUSHROOM_BODY_DESCRIPTOR.id,
    olfaction: OLFACTION_VERSION,
    physiology: PHYSIOLOGY_VERSION,
  },
  build: (g) => new OrganismLife(g.config),
  step: (life, ticks) => {
    for (let left = ticks; left > 0; left -= 10_000)
      life.advanceTicks(Math.min(left, 10_000));
  },
  tick: (life) => life.city.tick,
  hash: (life) =>
    `${life.city.stateHash()}|${life.cityFly.stateHash()}|${sha256Json(life.archive)}`,
  history: {
    versions: [LEGACY_VERSIONS, ECHO_V2_VERSIONS, ECHO_V3_VERSIONS],
    transition: (previous, next) => {
      if (!isOrganism(next)) {
        if (previous && isOrganism(previous))
          return ["a life cannot revert its organism continuation"];
        if (next.events.some((e) => e.kind === ORGANISM_EVENT))
          return ["only an organism checkpoint records the organism continuation"];
        return ECHO_UPGRADED_LIFE.history!.transition(previous, next);
      }
      const errors: string[] = [];
      if (next.genesis.flyController !== "reduced-order")
        errors.push(
          "this continuation requires the deployed individual's reduced-order birth",
        );
      if (!previous) {
        errors.push("the organism is a continuation, never a birth");
        return errors;
      }
      const marks = next.events.filter((e) => MARKS.includes(e.kind));
      if (isOrganism(previous)) {
        if (marks.length)
          errors.push("an organism continuation cannot be repeated or changed");
        return errors;
      }
      if (!sameVersions(previous.versions, V3)) {
        errors.push("only an ECHO v3 checkpoint continues as the organism");
        return errors;
      }
      const e = marks[0];
      if (
        marks.length !== 1 ||
        !e ||
        e.kind !== ORGANISM_EVENT ||
        e.tick !== previous.tick ||
        next.tick !== previous.tick
      ) {
        errors.push(
          "the continuation needs exactly one organism event at the unchanged tick",
        );
        return errors;
      }
      const d = e.data;
      if (
        d.migration !== ORGANISM_CONTINUATION ||
        d.sourceRelease !== ORGANISM_CONTINUATION_SOURCE ||
        d.parent !== previous.digest ||
        d.sourceStateHash !== previous.stateHash ||
        d.sourceGraphDigest !== previous.graphDigest ||
        d.preservedGraphDigest !== previous.graphDigest
      )
        errors.push("the continuation does not attest preservation of its exact parent");
      // While its graph is held (at the commit, and until it is compacted), the
      // claim is not trusted: the parent's graph must come back out of it.
      else if (next.graph) {
        let held: string | null = null;
        try {
          held = organismProjection(next.graph, d.sourceDescriptor as GraphSnapshot);
        } catch {
          held = null;
        }
        if (held !== previous.graphDigest)
          errors.push(
            "the continuation's graph does not hold its parent's, byte for byte",
          );
      }
      if (
        typeof d.pausedFromUtc !== "string" ||
        typeof d.upgradedUtc !== "string" ||
        !Number.isFinite(Date.parse(d.pausedFromUtc)) ||
        !Number.isFinite(Date.parse(d.upgradedUtc)) ||
        Date.parse(d.pausedFromUtc) > Date.parse(d.upgradedUtc)
      )
        errors.push("the continuation has no valid pause interval");
      return errors;
    },
  },
};
