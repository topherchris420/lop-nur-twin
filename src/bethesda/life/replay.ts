/**
 * Re-deriving a stored life: the check anyone can run on the fly's history.
 *
 * A store's seals show that nobody changed its bytes. They cannot show that
 * the bytes follow from anything: whoever writes a chain can seal whatever
 * they like. A replay asks the stronger question. Start from one checkpoint's
 * whole state, advance it on this machine with this code, and at every later
 * checkpoint in the chain compare what came out with what was recorded.
 *
 * A replay never holds the lease and never writes a checkpoint. It lives in
 * memory and ends with the process, so it cannot fork the individual. Nothing
 * reaches the life but what `LifeKind` promises: its genesis, its ticks and
 * its events.
 *
 * What the replay takes from the record and what it must produce itself:
 *
 * - **Taken:** where each checkpoint falls (its tick and sequence), and gaps,
 *   which say when no process ran. A gap changes nothing in the life.
 * - **Produced:** the state hash, every event the life records about itself
 *   (a kind's `derived` events), and the graph.
 *
 * How much can be compared depends on the release that made the chain. A seal
 * covers the whole graph, lookup caches included. Before the observer left no
 * trace (`OBSERVATION_LEAVES_NO_TRACE` in headless.ts), watching a life moved
 * those caches, at moments nobody recorded, so a seal from such a release can
 * never be reproduced. It changes no answer the caches give, so the replay then
 * compares the state hash and events at every checkpoint, and the whole graph
 * apart from the caches wherever the record still holds one: `seals: false`.
 * From a release whose observer leaves no trace, every seal must come out the
 * same, digit for digit.
 *
 * What a match does not show is in docs/BETHESDA_CONTINUOUS_LIFE.md: it says
 * the history can be computed from public inputs, not who computed it or when.
 *
 * Pure and browser-safe, like continuity.ts: no I/O, no clock, no randomness.
 */
import { sha256 } from "../../rain/sha256";
import {
  checkpointLife,
  restoreLife,
  sameVersions,
  type LifeCheckpoint,
  type LifeEvent,
  type LifeKind,
} from "./continuity";
import { GRAPH_SCHEMA, type GraphNode, type GraphSnapshot } from "./snapshot";

export const REPLAY_SCHEMA = "bethesda-life-replay/v1" as const;

/** Events that state a fact about the host and do not change the life. */
const RECORD_ONLY = new Set(["gap"]);

/**
 * Fields that are lookup caches: they change no answer they give, whatever they
 * hold, and an observer that queried the world moved them. Named by class and by
 * field, so the exception cannot grow by accident.
 */
const CACHES: Readonly<Record<string, ReadonlySet<string>>> = {
  FootprintGrid: new Set(["stamp", "seen"]),
  PrimitiveWorld: new Set(["localAt", "local"]),
  BethesdaFlyWorld: new Set(["localAt", "local"]),
};

/** A point in a chain. */
export interface ChainPoint {
  sequence: number;
  tick: number;
  digest: string;
}

/** The first place the replay and the record disagree. Bounded: it is published. */
export interface ReplayDifference {
  sequence: number;
  tick: number;
  field: "stateHash" | "events" | "graph" | "graphDigest" | "digest";
  recorded: string;
  derived: string;
}

export interface ReplayOutcome {
  /** The checkpoint the replay was restored from: taken as given, not reproduced. */
  from: ChainPoint;
  /** The last checkpoint the replay reproduced; `from` if none. */
  to: ChainPoint;
  /** Checkpoints reproduced, at the level `seals` asks for. */
  matched: number;
  /** Ticks simulated on this machine, up to and including `to`. */
  ticks: number;
  /** Of the checkpoints compared, how many came out with the recorded seal. */
  seals: number;
  /** Whole graphs compared with the record, field by field. */
  graphs: number;
  /** Why the replay disagrees with the record; null when it does not. */
  difference: ReplayDifference | null;
  /** Why it stopped short without disagreeing; null when it reached the end. */
  stopped: string | null;
}

export interface ReplayOptions<L> {
  /**
   * The events the life recorded about itself since the last call, emptying
   * them, as the runner does before it seals a checkpoint. A kind with none
   * leaves this out.
   */
  derived?: (life: L) => LifeEvent[];
  /**
   * Must every seal come out the same? True unless the chain's release let its
   * observer move the caches a seal covers (the header says why).
   */
  seals?: boolean;
  /** Told after each checkpoint is reproduced. */
  onMatch?: (point: ChainPoint, ticks: number) => void;
}

/** Why the chain does not line up: `later` must continue `from`, one link at a time. */
function linkError<G>(from: LifeCheckpoint<G>, later: readonly LifeCheckpoint<G>[]) {
  let previous = from;
  for (const c of later) {
    if (c.sequence !== previous.sequence + 1)
      return `checkpoint ${c.sequence} does not follow ${previous.sequence}`;
    if (c.parent !== previous.digest)
      return `checkpoint ${c.sequence} does not name ${previous.sequence} as its parent`;
    if (c.birth.individual !== from.birth.individual)
      return `checkpoint ${c.sequence} belongs to another individual`;
    if (c.tick < previous.tick)
      return `checkpoint ${c.sequence} is earlier than its parent`;
    previous = c;
  }
  return null;
}

const point = <G>(c: LifeCheckpoint<G>): ChainPoint => ({
  sequence: c.sequence,
  tick: c.tick,
  digest: c.digest,
});

const brief = (v: unknown): string => {
  const s = JSON.stringify(v);
  return s.length <= 80 ? s : `${s.slice(0, 64)}… sha256 ${sha256(s).slice(0, 16)}`;
};

const isRef = (v: unknown): v is { r: number } =>
  typeof v === "object" && v !== null && "r" in v;

/**
 * Where two graphs differ, apart from `CACHES`, or null. It walks from the root,
 * because a cache can hold nodes of its own, which shifts the numbers of all the
 * nodes after them while changing nothing else.
 */
export function graphDifference(
  recorded: GraphSnapshot,
  derived: GraphSnapshot,
): { path: string; recorded: string; derived: string } | null {
  const stack: [unknown, unknown, string][] = [[recorded.root, derived.root, "root"]];
  const seen = new Set<number>();
  const pairs = recorded.nodes.length + 1;
  while (stack.length) {
    const [a, b, path] = stack.pop()!;
    if (isRef(a) && isRef(b)) {
      const pair = a.r * pairs + b.r;
      if (seen.has(pair)) continue;
      seen.add(pair);
      const x: GraphNode | undefined = recorded.nodes[a.r];
      const y: GraphNode | undefined = derived.nodes[b.r];
      if (!x || !y) return { path, recorded: brief(x), derived: brief(y) };
      if (x.t !== y.t || !("e" in x) || !("e" in y)) {
        if (JSON.stringify(x) !== JSON.stringify(y))
          return { path, recorded: brief(x), derived: brief(y) };
        continue;
      }
      if (x.t === "o" && y.t === "o") {
        if (x.c !== y.c) return { path, recorded: brief(x.c), derived: brief(y.c) };
        const skip = x.c ? CACHES[x.c] : undefined;
        const kept = (n: typeof x) => n.e.filter(([k]) => !skip?.has(k));
        const [p, q] = [kept(x), kept(y)];
        if (p.length !== q.length || p.some(([k], i) => k !== q[i]![0]))
          return {
            path,
            recorded: brief(p.map(([k]) => k)),
            derived: brief(q.map(([k]) => k)),
          };
        p.forEach(([k, v], i) => stack.push([v, q[i]![1], `${path}.${k}`]));
        continue;
      }
      const [p, q] = [x.e as unknown[], y.e as unknown[]];
      if (p.length !== q.length || ("c" in x && "c" in y && x.c !== y.c))
        return { path, recorded: brief(x.t), derived: brief(y.t) };
      p.forEach((v, i) => stack.push([v, q[i], `${path}[${i}]`]));
      continue;
    }
    if (a === b) continue;
    // Inline numbers JSON cannot hold, and the pairs a map's entries are made of.
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      a.forEach((v, i) => stack.push([v, b[i], `${path}[${i}]`]));
      continue;
    }
    if (JSON.stringify(a) !== JSON.stringify(b))
      return { path, recorded: brief(a), derived: brief(b) };
  }
  return null;
}

/** The first event that differs, in few enough words to publish. */
function eventsDifference(recorded: readonly LifeEvent[], derived: readonly LifeEvent[]) {
  const say = (list: readonly LifeEvent[], i: number) => {
    const e = list[i];
    return `${list.length} events; [${i}] ${e ? `${e.kind.slice(0, 40)} at tick ${e.tick}, sha256 ${sha256(JSON.stringify(e)).slice(0, 16)}` : "none"}`;
  };
  let i = 0;
  while (
    i < recorded.length &&
    i < derived.length &&
    JSON.stringify(recorded[i]) === JSON.stringify(derived[i])
  )
    i++;
  return { recorded: say(recorded, i), derived: say(derived, i) };
}

/**
 * Restore `from` and reproduce each of `later` in turn, stopping at the first
 * disagreement. `later` may be headers only (their graphs compacted away): the
 * state hash and events, the graph digest and the seal survive compaction. A
 * checkpoint that still holds its graph is compared with it as well.
 *
 * Throws when the inputs cannot be replayed at all: a checkpoint this engine
 * refuses to restore, or a chain that does not line up. A chain that lines up
 * and comes out different is not an error; it is the finding, in `difference`.
 */
export function replayChain<G, L>(
  kind: LifeKind<G, L>,
  from: LifeCheckpoint<G>,
  later: readonly LifeCheckpoint<G>[],
  options: ReplayOptions<L> = {},
): ReplayOutcome {
  const broken = linkError(from, later);
  if (broken) throw new Error(`replay refused: ${broken}`);
  const life = restoreLife(kind, from);
  const engine = { ...kind.versions, graph: GRAPH_SCHEMA };
  const mustSeal = options.seals ?? true;
  const outcome: ReplayOutcome = {
    from: point(from),
    to: point(from),
    matched: 0,
    ticks: 0,
    seals: 0,
    graphs: 0,
    difference: null,
    stopped: null,
  };
  const differ = (
    c: LifeCheckpoint<G>,
    field: ReplayDifference["field"],
    recorded: string,
    derived: string,
  ) => {
    outcome.difference = { sequence: c.sequence, tick: c.tick, field, recorded, derived };
    return outcome;
  };
  let previous = from;
  for (const c of later) {
    // A recorded continuation changes the engine: this code cannot speak for the far side of it.
    if (!sameVersions(engine, c.versions)) {
      outcome.stopped = `checkpoint ${c.sequence} was made by another engine`;
      return outcome;
    }
    kind.step(life, c.tick - previous.tick);
    const derived = options.derived?.(life) ?? [];
    const taken = c.events.slice(0, Math.max(0, c.events.length - derived.length));
    const unknown = taken.find((e) => !RECORD_ONLY.has(e.kind));
    if (unknown && !options.derived) {
      outcome.stopped = `checkpoint ${c.sequence} records a ${unknown.kind.slice(0, 40)} event this replay does not apply`;
      return outcome;
    }
    // What the life keeps about itself is all derived, so anything left over is not its own.
    const events = unknown ? derived : [...taken, ...derived];
    const next = checkpointLife(kind, life, {
      genesis: from.genesis,
      birth: from.birth,
      previous,
      events,
    });
    if (c.stateHash !== next.stateHash)
      return differ(c, "stateHash", c.stateHash, next.stateHash);
    if (JSON.stringify(c.events) !== JSON.stringify(next.events)) {
      const said = eventsDifference(c.events, next.events);
      return differ(c, "events", said.recorded, said.derived);
    }
    if (mustSeal) {
      if (c.graphDigest !== next.graphDigest)
        return differ(c, "graphDigest", c.graphDigest, next.graphDigest);
      if (c.digest !== next.digest) return differ(c, "digest", c.digest, next.digest);
    }
    if (c.graph) {
      const apart = graphDifference(c.graph, next.graph!);
      if (apart)
        return differ(
          c,
          "graph",
          `${apart.path}: ${apart.recorded}`,
          `${apart.path}: ${apart.derived}`,
        );
      outcome.graphs += 1;
    }
    if (c.digest === next.digest) outcome.seals += 1;
    outcome.to = point(c);
    outcome.matched += 1;
    outcome.ticks += c.tick - previous.tick;
    options.onMatch?.(outcome.to, outcome.ticks);
    previous = c;
  }
  return outcome;
}
