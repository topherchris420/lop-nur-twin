/**
 * The recorded continuation of the deployed ECHO v3 individual as the
 * organism (organism.ts). Pure: no store, no clock, no randomness. It edits
 * an in-memory copy of the source graph, never stored bytes, and advances no
 * time. Everything the fly held is kept by reference: its body, the city, its
 * controller and navigation memory, its self-model's beliefs, episodes and
 * inquiry, and every random stream's position. The declared additions are new
 * and fresh: an innate mushroom body, olfactory filters at rest, tissue
 * proxies at their resting values, an empty archive. A reversible projection
 * that removes exactly those additions must give back every byte of the
 * source graph, or nothing is produced.
 */
import { MushroomBody } from "../fly/mushroomBody/circuit.js";
import { MUSHROOM_BODY_DESCRIPTOR } from "../fly/mushroomBody/controller.js";
import { resolveMushroomBodyParams } from "../fly/mushroomBody/params.js";
import {
  checkpointErrors,
  checkpointLife,
  restoreLife,
  sameVersions,
  type LifeCheckpoint,
} from "./continuity.js";
import { ECHO_UPGRADED_LIFE, Graph } from "./echoUpgrade.js";
import { OLFACTION_VERSION } from "./foraging/olfaction.js";
import { BETHESDA_LIFE, type HeadlessGenesis } from "./headless.js";
import { PHYSIOLOGY_VERSION } from "./immortal/physiology.js";
import {
  ECHO_V3_VERSIONS,
  ORGANISM_ADAPTER_PATH as ADAPTER,
  ORGANISM_ADDITIONS,
  ORGANISM_CONTINUATION,
  ORGANISM_CONTINUATION_SOURCE,
  ORGANISM_EVENT,
  ORGANISM_LIFE,
  organismProjection,
  type OrganismLife,
  subgraph,
} from "./organism.js";
import { GRAPH_SCHEMA, indexGraph, restoreGraph, snapshotGraph } from "./snapshot.js";

type Checkpoint = LifeCheckpoint<HeadlessGenesis>;
const STATE = [...ADAPTER, "model", "state"];
const PLACES = [...ADAPTER, "inner", "state", "nav", "places"];
/** EchoAdapter's own properties after its descriptor, each kept as it was. */
const KEPT = ["variant", "inner", "model", "replaced", "onDecision", "seedOf", "now"];

/** The valuation the fly's navigator consults (navigation.ts keeps it private). */
export function valuationOf(a: OrganismLife["organism"]): unknown {
  return (a.inner as unknown as { nav: { valuation: unknown } }).nav.valuation;
}

export interface OrganismContinuation {
  life: OrganismLife;
  checkpoint: Checkpoint;
  preservedGraphDigest: string;
}

/**
 * Called only after the exact source release has restored and verified
 * `source`. `stoppedUtc` is when the source was committed (the service
 * stopped); `upgradedUtc` is now. The interval between them is a pause:
 * recorded, never lived.
 */
export function continueAsOrganism(
  source: Checkpoint,
  upgradedUtc: string,
  stoppedUtc = upgradedUtc,
): OrganismContinuation {
  if (!sameVersions(source.versions, { ...ECHO_V3_VERSIONS, graph: GRAPH_SCHEMA }))
    throw new Error("continuation refused: the source is not an ECHO v3 checkpoint");
  const errors = checkpointErrors(ECHO_UPGRADED_LIFE, source);
  if (errors.length) throw new Error(`continuation refused: ${errors.join("; ")}`);
  if (!source.graph)
    throw new Error("continuation refused: its graph was compacted away");
  if (
    !Number.isFinite(Date.parse(upgradedUtc)) ||
    !Number.isFinite(Date.parse(stoppedUtc)) ||
    Date.parse(stoppedUtc) > Date.parse(upgradedUtc)
  )
    throw new Error("continuation needs its real UTC time, after the source's");
  // Guard this specific continuation against later simulator changes.
  if (
    BETHESDA_LIFE.versions.fly !== "digital-fly/8" ||
    BETHESDA_LIFE.versions.echo !== "echo-self-model/v3" ||
    BETHESDA_LIFE.versions.city !== "bethesda-city/4" ||
    BETHESDA_LIFE.versions.headless !== "bethesda-headless-life/v2"
  )
    throw new Error("this continuation supports ECHO v3 on digital-fly/8 only");
  const old = new Graph(source.graph, false);
  const root = old.object([]);
  const adapter = old.object(ADAPTER);
  if (
    root.c !== "HeadlessBethesdaLife" ||
    root.e.map(([k]) => k).join() !== "city,cityFly" ||
    old.get(["cityFly", "controller"]) !== "echo" ||
    old.get(["cityFly", "failed"]) !== null ||
    adapter.c !== "EchoAdapter" ||
    adapter.e.map(([k]) => k).join() !== ["descriptor", ...KEPT].join() ||
    old.object([...ADAPTER, "inner"]).c !== "ReducedOrderController" ||
    old.get([...STATE, "schema"]) !== "echo-state/v3" ||
    old.get([...STATE, "version"]) !== "echo-self-model/v3" ||
    old.get([...STATE, "variant"]) !== "full"
  )
    throw new Error("continuation refused: the source is not a healthy ECHO v3 fly");
  const fresh = () => ORGANISM_LIFE.build(structuredClone(source.genesis));
  const template = new Graph(snapshotGraph(fresh(), indexGraph(fresh())), false);
  const graph = new Graph(source.graph);
  graph.object([]).c = "OrganismLife";
  for (const key of ORGANISM_ADDITIONS.life)
    graph.set([key], graph.import(template, template.get([key])));
  // The template's adapter, imported whole so its additions keep sharing their
  // circuit, with everything the old one held put back in its place.
  graph.set(ADAPTER, graph.import(template, template.get(ADAPTER)));
  for (const key of KEPT) graph.set([...ADAPTER, key], old.get([...ADAPTER, key]));
  // The places it remembers keep their rule: the navigator's very objects.
  const places = graph.node(graph.get(PLACES));
  const inherited = graph.node(graph.get([...ADAPTER, "valuation", "inherited"]));
  if (places.t !== "a" || inherited.t !== "a" || inherited.e.length)
    throw new Error("continuation expected the remembered places and an empty valuation");
  inherited.e = [...places.e];
  const life = restoreGraph(graph.snapshot, fresh());
  if (life.city.tick !== source.tick)
    throw new Error("continuation advanced the city's clock");
  const a = life.organism;
  const remembered = a.inner.state.nav.places;
  if (
    a.valuation.inherited.length !== remembered.length ||
    a.valuation.inherited.some((p, i) => p !== remembered[i])
  )
    throw new Error(
      "continuation did not keep the remembered places as the same memories",
    );
  const innate = new MushroomBody(resolveMushroomBodyParams(), life.cityFly.seed);
  if (JSON.stringify(a.circuit.state) !== JSON.stringify(innate.state))
    throw new Error("continuation's mushroom body is not the fly's innate one");
  if (valuationOf(a) !== a.valuation)
    throw new Error("continuation's navigator is not valued by the fly's mushroom body");
  // Reverse only the declared additions, and require every old graph byte back.
  const sourceDescriptor = subgraph(old, old.get([...ADAPTER, "descriptor"]));
  const preservedGraphDigest = organismProjection(
    snapshotGraph(life, indexGraph(fresh())),
    sourceDescriptor,
  );
  if (preservedGraphDigest !== source.graphDigest)
    throw new Error("continuation refused: the old state did not survive byte for byte");
  const S = a.model!.state;
  const checkpoint = checkpointLife(ORGANISM_LIFE, life, {
    genesis: source.genesis,
    birth: source.birth,
    previous: source,
    events: [
      {
        tick: source.tick,
        kind: ORGANISM_EVENT,
        data: {
          migration: ORGANISM_CONTINUATION,
          sourceRelease: ORGANISM_CONTINUATION_SOURCE,
          parent: source.digest,
          sourceStateHash: source.stateHash,
          sourceGraphDigest: source.graphDigest,
          preservedGraphDigest,
          sourceDescriptor,
          upgradedUtc,
          pausedFromUtc: stoppedUtc,
          preserved:
            "the whole ECHO v3 graph, byte for byte: body, city, controller and navigation memory, self-model, and every random stream",
          kept: {
            rememberedPlaces: remembered.length,
            inquiries: S.counts.inquiries,
            episodesKept: S.episodes.length,
            lastEpisode: S.episodes.at(-1)?.id ?? null,
            inquiryOpen: S.inquiry !== null,
          },
          introduced: {
            mushroomBody: `${MUSHROOM_BODY_DESCRIPTOR.id}: ${a.circuit.state.wPlus.length} Kenyon cells, innate weights drawn from the fly's seed, no trials; values the places remembered from now on`,
            inheritedPlaces: `${remembered.length} remembered places keep the rule they were learned under`,
            olfaction: `${OLFACTION_VERSION}: filters at rest, a stream of its own at its start`,
            physiology: `${PHYSIOLOGY_VERSION}: tissue proxies at their resting values; artificial maintenance metered apart from food`,
            archive:
              "recovery and rest bouts, mushroom-body updates, and each ECHO episode when the self-model's bounded memory lets it go, recorded from now on",
          },
        },
      },
    ],
  });
  const transition = ORGANISM_LIFE.history!.transition(source, checkpoint);
  if (transition.length) throw new Error(transition.join("; "));
  restoreLife(ORGANISM_LIFE, checkpoint);
  return { life, checkpoint, preservedGraphDigest };
}
