/**
 * The one supported, recorded continuation from the deployed reduced-order
 * digital-fly/7 to ECHO v2. Old checkpoints are never edited or restored on
 * new rules. A new checkpoint continues their digest, birth and genesis.
 * The migration preserves the old graph by a checked, reversible projection;
 * only the new wind fields, sense and ECHO wrapper are introduced.
 */
import { sha256 } from "../../rain/sha256";
import { DT } from "../simulation";
import {
  checkpointErrors,
  checkpointLife,
  restoreLife,
  sameVersions,
  type LifeCheckpoint,
  type LifeKind,
} from "./continuity";
import {
  BETHESDA_LIFE,
  type HeadlessBethesdaLife,
  type HeadlessGenesis,
} from "./headless";
import {
  GRAPH_SCHEMA,
  indexGraph,
  restoreGraph,
  snapshotGraph,
  type GraphNode,
  type GraphSnapshot,
  type GraphValue,
} from "./snapshot";

export const ECHO_UPGRADE = "bethesda-echo-upgrade/v1";
export const ECHO_UPGRADE_SOURCE = "c8b5fb163b22381fb08c3c0f4a18d5b92bfc2f4b";
export const LEGACY_VERSIONS = {
  headless: "bethesda-headless-life/v2",
  city: "bethesda-city/4",
  fly: "digital-fly/7",
  echo: "echo-self-model/v1",
} as const;
const LEGACY = { ...LEGACY_VERSIONS, graph: GRAPH_SCHEMA };
const EVENT = "engine-upgrade";
const ROOT = ["cityFly", "fly"];
const ADAPTER = [...ROOT, "adapter"];
const WORLD = ["cityFly", "world"];
const WIND_PARAMS = ["windFeltMS", "windTakeoffMS", "maxAirspeedCmS"];
type Checkpoint = LifeCheckpoint<HeadlessGenesis>;

/** Same kind and immutable birth; its genesis still says which controller it was born with. */
export const ECHO_UPGRADED_LIFE: LifeKind<HeadlessGenesis, HeadlessBethesdaLife> = {
  ...BETHESDA_LIFE,
  versions: { ...BETHESDA_LIFE.versions, upgrade: ECHO_UPGRADE },
  build: (g) => BETHESDA_LIFE.build({ ...g, flyController: "echo" }),
  history: {
    versions: [LEGACY_VERSIONS],
    transition: (previous, next) => {
      const errors: string[] = [];
      const legacy = sameVersions(next.versions, LEGACY);
      const events = next.events.filter((e) => e.kind === EVENT);
      if (next.genesis.flyController !== "reduced-order")
        errors.push("this continuation requires a reduced-order birth");
      if (!previous) {
        if (!legacy || events.length)
          errors.push("an upgraded life must have its legacy birth");
        return errors;
      }
      const wasLegacy = sameVersions(previous.versions, LEGACY);
      if (legacy) {
        if (!wasLegacy || events.length)
          errors.push("a life cannot revert its engine upgrade");
        return errors;
      }
      if (!wasLegacy) {
        if (!sameVersions(previous.versions, next.versions) || events.length)
          errors.push("an engine upgrade cannot be repeated or changed");
        return errors;
      }
      const e = events[0];
      if (
        events.length !== 1 ||
        !e ||
        e.tick !== previous.tick ||
        next.tick !== previous.tick
      ) {
        errors.push(
          "an engine change needs exactly one upgrade event at the unchanged tick",
        );
        return errors;
      }
      const d = e.data;
      if (
        d.migration !== ECHO_UPGRADE ||
        d.sourceRelease !== ECHO_UPGRADE_SOURCE ||
        d.parent !== previous.digest ||
        d.sourceStateHash !== previous.stateHash ||
        d.sourceGraphDigest !== previous.graphDigest ||
        d.preservedGraphDigest !== previous.graphDigest ||
        d.selfModel !== "innate-at-upgrade"
      )
        errors.push("the upgrade does not attest preservation of its exact parent");
      if (
        typeof d.pausedFromUtc !== "string" ||
        typeof d.upgradedUtc !== "string" ||
        !Number.isFinite(Date.parse(d.pausedFromUtc)) ||
        !Number.isFinite(Date.parse(d.upgradedUtc)) ||
        Date.parse(d.pausedFromUtc) > Date.parse(d.upgradedUtc)
      )
        errors.push("the upgrade has no valid pause interval");
      return errors;
    },
  },
};

/** A small editor used only on an in-memory copy, never on stored checkpoint bytes. */
class Graph {
  readonly snapshot: GraphSnapshot;
  constructor(snapshot: GraphSnapshot, copy = true) {
    this.snapshot = copy ? structuredClone(snapshot) : snapshot;
  }
  node(v: GraphValue): GraphNode {
    if (typeof v !== "object" || v === null || !("r" in v))
      throw new Error("migration expected a graph reference");
    const n = this.snapshot.nodes[v.r];
    if (!n) throw new Error("migration found a missing graph node");
    return n;
  }
  get(path: readonly (string | number)[]): GraphValue {
    let value = this.snapshot.root;
    for (const key of path) {
      const n = this.node(value);
      const found =
        n.t === "o"
          ? n.e.find(([k]) => k === key)?.[1]
          : n.t === "a" && typeof key === "number"
            ? n.e[key]
            : undefined;
      if (found === undefined) throw new Error(`migration found no ${path.join(".")}`);
      value = found;
    }
    return value;
  }
  object(path: readonly (string | number)[]): Extract<GraphNode, { t: "o" }> {
    const n = this.node(this.get(path));
    if (n.t !== "o") throw new Error(`migration expected an object at ${path.join(".")}`);
    return n;
  }
  set(path: readonly (string | number)[], value: GraphValue): void {
    const o = this.object(path.slice(0, -1));
    const key = String(path.at(-1));
    const entry = o.e.find(([k]) => k === key);
    if (entry) entry[1] = value;
    else o.e.push([key, value]);
  }
  remove(path: readonly (string | number)[]): void {
    const o = this.object(path.slice(0, -1));
    const key = String(path.at(-1));
    if (!o.e.some(([k]) => k === key))
      throw new Error(`migration found no ${path.join(".")}`);
    o.e = o.e.filter(([k]) => k !== key);
  }
  /** Copy a reachable subgraph, including its aliases, with reference ids rebased. */
  import(source: Graph, value: GraphValue): GraphValue {
    const ids = new Map<number, number>();
    const copy = (v: GraphValue): GraphValue => {
      if (typeof v !== "object" || v === null || !("r" in v)) return structuredClone(v);
      const seen = ids.get(v.r);
      if (seen !== undefined) return { r: seen };
      const id = this.snapshot.nodes.length;
      ids.set(v.r, id);
      this.snapshot.nodes.push({ t: "fn" });
      const n = structuredClone(source.node(v));
      if (n.t === "o") n.e = n.e.map(([k, x]) => [k, copy(x)]);
      if (n.t === "a" || n.t === "s" || n.t === "ta") n.e = n.e.map(copy);
      if (n.t === "m") n.e = n.e.map(([k, x]) => [copy(k), copy(x)]);
      this.snapshot.nodes[id] = n;
      return { r: id };
    };
    return copy(value);
  }
  data(value: unknown): GraphValue {
    const source = new Graph(snapshotGraph({ value }));
    return this.import(source, source.get(["value"]));
  }
  /** Shared descriptor paths must follow the preserved controller inside its new wrapper. */
  sharedController(wrap: boolean): void {
    const from = wrap ? ADAPTER : [...ADAPTER, "inner"];
    const to = wrap ? [...ADAPTER, "inner"] : ADAPTER;
    for (const n of this.snapshot.nodes) {
      if (n.t === "sh" && from.every((key, i) => n.p[i] === key))
        n.p = [...to, ...n.p.slice(from.length)];
    }
  }
  frames(): Extract<GraphNode, { t: "o" }>[] {
    const frames = this.node(this.get([...ROOT, "frames"]));
    if (frames.t !== "a") throw new Error("migration expected delayed sense frames");
    const values = [...frames.e, this.get([...ROOT, "lastFrame"])].filter(
      (v) => v !== null,
    );
    return [...new Set(values.map((v) => this.node(v)))].map((n) => {
      if (n.t !== "o") throw new Error("migration expected a sense frame");
      return n;
    });
  }
  /** Canonical traversal removes unreachable template nodes and restores snapshot order. */
  canonical(): GraphSnapshot {
    const out = new Graph({ schema: GRAPH_SCHEMA, root: null, nodes: [] });
    out.snapshot.root = out.import(this, this.snapshot.root);
    return out.snapshot;
  }
}

const graphHash = (g: GraphSnapshot) => sha256(JSON.stringify(g));

export interface EchoUpgradeResult {
  life: HeadlessBethesdaLife;
  checkpoint: Checkpoint;
}

/**
 * Called only after the exact source release has restored and verified `source`.
 * No time advances here. The caller must verify future checkpoint/restore
 * equivalence on a backup before committing a production transition.
 */
export function upgradeToEcho(
  source: Checkpoint,
  upgradedUtc: string,
  stoppedUtc = upgradedUtc,
): EchoUpgradeResult {
  const legacyKind = { ...BETHESDA_LIFE, versions: LEGACY_VERSIONS };
  const errors = checkpointErrors(legacyKind, source);
  if (errors.length) throw new Error(`upgrade refused: ${errors.join("; ")}`);
  if (!source.graph || source.genesis.flyController !== "reduced-order")
    throw new Error("upgrade needs the complete graph of a reduced-order individual");
  if (
    !Number.isFinite(Date.parse(upgradedUtc)) ||
    !Number.isFinite(Date.parse(stoppedUtc)) ||
    Date.parse(stoppedUtc) > Date.parse(upgradedUtc)
  )
    throw new Error("upgrade needs its real UTC time");
  // Guard this specific migration against future simulator changes.
  if (
    BETHESDA_LIFE.versions.fly !== "digital-fly/8" ||
    BETHESDA_LIFE.versions.echo !== "echo-self-model/v2" ||
    BETHESDA_LIFE.versions.city !== LEGACY_VERSIONS.city
  )
    throw new Error("this migration supports digital-fly/8 and ECHO v2 only");
  const old = new Graph(source.graph, false);
  if (
    old.get(["cityFly", "controller"]) !== "reduced-order" ||
    old.node(old.get(ADAPTER)).t !== "o" ||
    old.object(ADAPTER).c !== "ReducedOrderController" ||
    old.get([...ROOT, "selfMotion"]) !== null ||
    old.get(["cityFly", "failed"]) !== null
  )
    throw new Error("upgrade source is not a healthy reduced-order fly");
  const fresh = () => ECHO_UPGRADED_LIFE.build(structuredClone(source.genesis));
  const template = new Graph(snapshotGraph(fresh(), indexGraph(fresh())), false);
  const graph = new Graph(source.graph);
  const inner = graph.get(ADAPTER);
  graph.sharedController(true);
  graph.set(ADAPTER, graph.import(template, template.get(ADAPTER)));
  graph.set([...ADAPTER, "inner"], inner);
  graph.set(["cityFly", "controller"], "echo");
  graph.set(
    [...ROOT, "selfMotion"],
    graph.import(template, template.get([...ROOT, "selfMotion"])),
  );
  const t = graph.get([...ROOT, "state", "t"]);
  graph.set([...ADAPTER, "now"], t);
  graph.set([...ADAPTER, "model", "state", "t"], t);
  for (const name of ["params", "adapterParams"]) {
    const path = [...ROOT, name];
    const before = graph.object(path),
      after = template.object(path);
    // No old parameter may be silently retuned by a migration.
    for (const [key, value] of before.e) {
      if (JSON.stringify(after.e.find(([k]) => k === key)?.[1]) !== JSON.stringify(value))
        throw new Error(`upgrade would change the old parameter ${key}`);
    }
    const additions = after.e.filter(([key]) => !before.e.some(([k]) => k === key));
    if (
      additions
        .map(([key]) => key)
        .sort()
        .join() !== [...WIND_PARAMS].sort().join()
    )
      throw new Error("upgrade found unexpected new body parameters");
    for (const [key, value] of additions) graph.set([...path, key], value);
  }
  for (const frame of graph.frames()) {
    if (frame.e.some(([key]) => key === "airflow" || key === "airflowFrom"))
      throw new Error("legacy frame already has airflow fields");
    // The delayed frames were sampled in still air, before the new wind existed.
    frame.e.push(["airflow", 0], ["airflowFrom", null]);
  }
  const placedAt = graph.get(["cityFly", "placedAtTick"]);
  if (typeof placedAt !== "number") throw new Error("invalid fly placement tick");
  graph.set([...WORLD, "windSeed"], source.genesis.config.seed >>> 0);
  graph.set([...WORLD, "clock0"], placedAt * DT);
  graph.set([...WORLD, "storms"], graph.data([]));
  let life = restoreGraph(graph.snapshot, fresh());
  const storms = life.city.events
    .filter((e) => e.kind === "storm")
    .map((e) => ({
      from: e.startTick * DT,
      to: (e.startTick + e.durationTicks) * DT,
    }));
  graph.set([...WORLD, "storms"], graph.data(storms));
  life = restoreGraph(graph.snapshot, fresh());
  // v7 stored ground velocity; v8 stores air velocity in flight/landing.
  const s = life.cityFly.fly.state;
  const groundVelocity = [...s.v];
  const wind =
    s.mode === "flight" || s.mode === "land"
      ? life.cityFly.world.wind(s.p, s.t)
      : [0, 0, 0];
  const airVelocity = [
    groundVelocity[0]! - wind[0]!,
    groundVelocity[1]!,
    groundVelocity[2]! - wind[2]!,
  ];
  graph.set([...ROOT, "state", "v"], graph.data(airVelocity));
  life = restoreGraph(graph.snapshot, fresh());
  if (!life.cityFly.fly.state.v.every((v, i) => Object.is(v, airVelocity[i])))
    throw new Error("upgrade failed to preserve ground velocity in the new air frame");
  if (life.city.tick !== source.tick)
    throw new Error("upgrade advanced the city's clock");
  // Reverse only the declared additions, and require every old graph byte back.
  const projection = new Graph(snapshotGraph(life, indexGraph(fresh())), false);
  projection.set(ADAPTER, projection.get([...ADAPTER, "inner"]));
  projection.sharedController(false);
  projection.set(["cityFly", "controller"], "reduced-order");
  projection.set([...ROOT, "selfMotion"], null);
  projection.set([...ROOT, "state", "v"], projection.data(groundVelocity));
  for (const name of ["params", "adapterParams"])
    for (const key of WIND_PARAMS) projection.remove([...ROOT, name, key]);
  for (const frame of projection.frames())
    frame.e = frame.e.filter(([key]) => key !== "airflow" && key !== "airflowFrom");
  for (const key of ["windSeed", "clock0", "storms"]) projection.remove([...WORLD, key]);
  const preservedGraphDigest = graphHash(projection.canonical());
  if (preservedGraphDigest !== source.graphDigest)
    throw new Error("upgrade refused: the old state did not survive byte for byte");
  const checkpoint = checkpointLife(ECHO_UPGRADED_LIFE, life, {
    genesis: source.genesis,
    birth: source.birth,
    previous: source,
    events: [
      {
        tick: source.tick,
        kind: EVENT,
        data: {
          migration: ECHO_UPGRADE,
          sourceRelease: ECHO_UPGRADE_SOURCE,
          parent: source.digest,
          sourceStateHash: source.stateHash,
          sourceGraphDigest: source.graphDigest,
          preservedGraphDigest,
          upgradedUtc,
          pausedFromUtc: stoppedUtc,
          selfModel: "innate-at-upgrade",
          groundVelocity,
          airVelocity,
          wind,
        },
      },
    ],
  });
  const transition = ECHO_UPGRADED_LIFE.history!.transition(source, checkpoint);
  if (transition.length) throw new Error(transition.join("; "));
  restoreLife(ECHO_UPGRADED_LIFE, checkpoint);
  return { life, checkpoint };
}
