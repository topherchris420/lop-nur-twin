/**
 * Re-deriving a stored life: the check anyone can run on the fly's history.
 *
 * A store's seals show that nobody changed its bytes. They cannot show that
 * the bytes follow from anything: whoever writes a chain can seal whatever
 * they like. A replay asks the stronger question. Start from one checkpoint's
 * whole state, advance it on this machine with this code, and at every later
 * checkpoint in the chain seal what came out. If the life really is its
 * genesis, its events and its code, the seals are the same, digit for digit.
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
 * - **Produced:** the state hash, the graph digest, every event the life
 *   records about itself (a kind's `derived` events), and so the seal.
 *
 * What a match does not show is in docs/BETHESDA_CONTINUOUS_LIFE.md: it says
 * the history can be computed from public inputs, not who computed it or when.
 *
 * Pure and browser-safe, like continuity.ts: no I/O, no clock, no randomness.
 */
import {
  checkpointLife,
  restoreLife,
  sameVersions,
  type LifeCheckpoint,
  type LifeEvent,
  type LifeKind,
} from "./continuity";
import { GRAPH_SCHEMA } from "./snapshot";

export const REPLAY_SCHEMA = "bethesda-life-replay/v1" as const;

/** Events that state a fact about the host and do not change the life. */
const RECORD_ONLY = new Set(["gap"]);

/** A point in a chain. */
export interface ChainPoint {
  sequence: number;
  tick: number;
  digest: string;
}

/** The first place the replay and the record disagree. */
export interface ReplayDifference {
  sequence: number;
  tick: number;
  field: "stateHash" | "events" | "graphDigest" | "digest";
  recorded: string;
  derived: string;
}

export interface ReplayOutcome {
  /** The checkpoint the replay was restored from. */
  from: ChainPoint;
  /** The last checkpoint whose seal the replay reproduced; `from` if none. */
  to: ChainPoint;
  /** Checkpoints whose seals were reproduced. */
  matched: number;
  /** Ticks simulated on this machine, up to and including `to`. */
  ticks: number;
  /** Every digest reproduced, oldest first (`from` is not among them). */
  digests: string[];
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

/**
 * Restore `from` and reproduce each of `later` in turn, stopping at the first
 * disagreement. `later` may be headers only (their graphs compacted away): the
 * graph digest and the seal survive compaction, and those are what is compared.
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
  const outcome: ReplayOutcome = {
    from: point(from),
    to: point(from),
    matched: 0,
    ticks: 0,
    digests: [],
    difference: null,
    stopped: null,
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
    if (unknown) {
      outcome.stopped = `checkpoint ${c.sequence} records a ${unknown.kind} event this replay does not apply`;
      return outcome;
    }
    const next = checkpointLife(kind, life, {
      genesis: from.genesis,
      birth: from.birth,
      previous,
      events: [...taken, ...derived],
    });
    const compare: readonly [ReplayDifference["field"], string, string][] = [
      ["stateHash", c.stateHash, next.stateHash],
      ["events", JSON.stringify(c.events), JSON.stringify(next.events)],
      ["graphDigest", c.graphDigest, next.graphDigest],
      ["digest", c.digest, next.digest],
    ];
    const differs = compare.find(([, recorded, made]) => recorded !== made);
    if (differs) {
      const [field, recorded, made] = differs;
      outcome.difference = {
        sequence: c.sequence,
        tick: c.tick,
        field,
        recorded,
        derived: made,
      };
      return outcome;
    }
    outcome.to = point(c);
    outcome.matched += 1;
    outcome.ticks += c.tick - previous.tick;
    outcome.digests.push(c.digest);
    options.onMatch?.(outcome.to, outcome.ticks);
    previous = c;
  }
  return outcome;
}
