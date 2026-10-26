/**
 * Durable individual continuity: who a living simulation is, and how its
 * whole state is carried across a save and a restore without becoming
 * someone else.
 *
 * - **An individual is a birth, not a genome.** Its identity is the digest of
 *   its kind, its genesis (the plain data it was built from: seeds,
 *   configuration, start) and a birth nonce the host draws when it is born.
 *   Two individuals with the same genesis are two individuals: identical at
 *   birth, apart from then on by whatever happens to each.
 * - **A checkpoint is the whole life at a tick**, as `snapshot.ts` records it,
 *   bound to the versions of every engine it ran on, to its individual, to
 *   its sequence number and to its parent checkpoint's digest, and sealed.
 *   It also carries the life events since its parent: the exogenous inputs
 *   (food placed, a gap while no process ran) that made this life this one.
 * - **A restore is checked, never trusted.** `restoreLife` refuses another
 *   schema, kind, version, individual or byte; rebuilds the life from its
 *   genesis; writes the snapshot into it; and then re-snapshots it and
 *   compares byte for byte, and compares the life's own state hash. A
 *   mismatch stops: nothing starts in its place.
 * - **A copy is a new individual.** `twinCheckpoint` starts another
 *   individual from a checkpoint: the same state, a new identity, its
 *   parentage recorded. It is never the same fly.
 *
 * Pure and browser-safe: no I/O, no clock, no randomness. The store that
 * keeps checkpoints durable and admits one writer is `store.ts`.
 */
import { sha256, sha256Json } from "../../rain/sha256";
import {
  GRAPH_SCHEMA,
  indexGraph,
  restoreGraph,
  snapshotGraph,
  type GraphSnapshot,
} from "./snapshot";

export const LIFE_CHECKPOINT_SCHEMA = "life-checkpoint/v1" as const;

/** An exogenous event in a life, recorded where it happened. */
export interface LifeEvent {
  /** The life's tick when it was applied (or, for a gap, when the clock stopped). */
  tick: number;
  kind: string;
  /** Plain data saying what happened. */
  data: Record<string, unknown>;
}

/**
 * A kind of life: how to build one from its genesis, step it, apply an
 * event to it and hash it. Every outcome-changing input is the genesis or an
 * event; nothing else reaches the life.
 */
export interface LifeKind<G, L> {
  readonly id: string;
  /** Every engine version the life's behaviour depends on. */
  readonly versions: Readonly<Record<string, string>>;
  build(genesis: G): L;
  step(life: L, ticks: number): void;
  tick(life: L): number;
  /** The life's own state hash, compared after every restore. */
  hash(life: L): string;
  /** Apply an exogenous event. Kinds that take none throw. */
  apply?(life: L, event: LifeEvent): void;
  /** Classes a restore may need that a fresh life holds no instance of. */
  readonly classes?: readonly (abstract new (...args: never[]) => unknown)[];
}

export interface Birth {
  /** The individual's identity: sha256 of kind, genesis digest and nonce. */
  individual: string;
  /** Drawn by the host when the individual was born; never chosen by a design. */
  nonce: string;
  /** If this individual was started from another's checkpoint: whose, and which. */
  twinOf: { individual: string; sequence: number; digest: string } | null;
}

export interface LifeCheckpoint<G = unknown> {
  schema: typeof LIFE_CHECKPOINT_SCHEMA;
  kind: string;
  versions: Record<string, string>;
  genesis: G;
  genesisDigest: string;
  birth: Birth;
  /** 0 for the checkpoint made at birth, then one more each time. */
  sequence: number;
  /** The previous checkpoint's digest; null at sequence 0. */
  parent: string | null;
  tick: number;
  /** The life's own state hash at this tick. */
  stateHash: string;
  /** Exogenous events since the parent, in order. */
  events: LifeEvent[];
  /** sha256 of the graph's JSON; kept when an old checkpoint's graph is compacted away. */
  graphDigest: string;
  /** The whole life (null once a store has compacted this checkpoint). */
  graph: GraphSnapshot | null;
  /** sha256 of everything above except the graph itself (which `graphDigest` covers). */
  digest: string;
}

const isHex64 = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

export function individualId(kind: string, genesisDigest: string, nonce: string): string {
  return sha256Json({ kind, genesis: genesisDigest, nonce });
}

/** Why `b` is not a birth that follows from its genesis (or its twin's parentage), or null. */
function birthError(
  kind: string,
  genesisDigest: string,
  b: Partial<Birth> | undefined,
): string | null {
  if (!b || !isHex64(b.individual)) return "it names no individual";
  if (typeof b.nonce !== "string") return "its birth has no nonce";
  const expected = b.twinOf
    ? sha256Json({
        twinOf: b.twinOf.individual,
        sequence: b.twinOf.sequence,
        nonce: b.nonce,
      })
    : individualId(kind, genesisDigest, b.nonce);
  return expected === b.individual
    ? null
    : "its individual does not follow from its birth";
}

/** A birth for a new individual from `genesis`. `nonce` must come from the host's entropy. */
export function birth(kind: string, genesis: unknown, nonce: string): Birth {
  if (!/^[0-9a-f]{32,128}$/.test(nonce))
    throw new Error("a birth nonce is 32–128 hex digits");
  return {
    individual: individualId(kind, sha256Json(genesis), nonce),
    nonce,
    twinOf: null,
  };
}

function seal<G>(c: Omit<LifeCheckpoint<G>, "digest">): string {
  const { graph: _graph, ...header } = c;
  return sha256Json(header);
}

/** A fresh life's genesis-graph index, to tell module data from state. */
function sharedIndex<G, L>(kind: LifeKind<G, L>, genesis: G) {
  return indexGraph(kind.build(structuredClone(genesis)));
}

/**
 * Checkpoint `life`. `previous` is the checkpoint it continues (null at
 * birth); `events` are those applied since.
 */
export function checkpointLife<G, L>(
  kind: LifeKind<G, L>,
  life: L,
  o: {
    genesis: G;
    birth: Birth;
    previous: LifeCheckpoint<G> | null;
    events?: readonly LifeEvent[];
  },
): LifeCheckpoint<G> {
  const genesisDigest = sha256Json(o.genesis);
  const wrong = birthError(kind.id, genesisDigest, o.birth);
  if (wrong) throw new Error(`the birth does not belong to this genesis: ${wrong}`);
  if (o.previous && o.previous.birth.individual !== o.birth.individual)
    throw new Error("a checkpoint continues only its own individual");
  const graph = snapshotGraph(life, sharedIndex(kind, o.genesis));
  const body: Omit<LifeCheckpoint<G>, "digest"> = {
    schema: LIFE_CHECKPOINT_SCHEMA,
    kind: kind.id,
    versions: { ...kind.versions, graph: GRAPH_SCHEMA },
    genesis: structuredClone(o.genesis),
    genesisDigest,
    birth: structuredClone(o.birth),
    sequence: o.previous ? o.previous.sequence + 1 : 0,
    parent: o.previous ? o.previous.digest : null,
    tick: kind.tick(life),
    stateHash: kind.hash(life),
    events: (o.events ?? []).map((e) => structuredClone(e)),
    graphDigest: sha256(JSON.stringify(graph)),
    graph,
  };
  return { ...body, digest: seal(body) };
}

/** Why `c` cannot be restored as a `kind`, or null. Checks the seal and the graph's bytes. */
export function checkpointErrors<G, L>(kind: LifeKind<G, L>, c: unknown): string[] {
  const errors: string[] = [];
  if (typeof c !== "object" || c === null) return ["not a checkpoint"];
  const k = c as Partial<LifeCheckpoint<G>>;
  if (k.schema !== LIFE_CHECKPOINT_SCHEMA)
    return [`a ${String(k.schema)} record is not a ${LIFE_CHECKPOINT_SCHEMA}`];
  if (k.kind !== kind.id)
    errors.push(`a ${String(k.kind)} checkpoint is not a ${kind.id} one`);
  const want = { ...kind.versions, graph: GRAPH_SCHEMA };
  for (const [name, v] of Object.entries(want))
    if (k.versions?.[name] !== v)
      errors.push(`made by ${name} ${String(k.versions?.[name])}; this is ${v}`);
  for (const name of Object.keys(k.versions ?? {}))
    if (!(name in want))
      errors.push(`made with ${name}, which this engine does not have`);
  if (!isHex64(k.digest) || !isHex64(k.graphDigest) || !isHex64(k.genesisDigest))
    errors.push("its digests are malformed");
  if (sha256Json(k.genesis) !== k.genesisDigest) errors.push("its genesis was changed");
  const wrongBirth = birthError(kind.id, k.genesisDigest ?? "", k.birth);
  if (wrongBirth) errors.push(wrongBirth);
  if (!Number.isSafeInteger(k.sequence) || k.sequence! < 0)
    errors.push("its sequence is invalid");
  if ((k.sequence === 0) !== (k.parent === null))
    errors.push("its parent does not match its sequence");
  if (!errors.length) {
    const { digest, ...body } = k as LifeCheckpoint<G>;
    if (seal(body) !== digest) errors.push("its seal does not match: a byte was changed");
    if (k.graph && sha256(JSON.stringify(k.graph)) !== k.graphDigest)
      errors.push("its graph does not match its digest: a byte was changed");
  }
  return errors;
}

/**
 * Rebuild the life `c` holds, check it is that life, and return it. Throws,
 * saying why, on any mismatch; never returns a substitute.
 */
export function restoreLife<G, L>(kind: LifeKind<G, L>, c: LifeCheckpoint<G>): L {
  const errors = checkpointErrors(kind, c);
  if (errors.length) throw new Error(`checkpoint refused: ${errors.join("; ")}`);
  if (!c.graph) throw new Error("checkpoint refused: its graph was compacted away");
  const life = restoreGraph(
    structuredClone(c.graph),
    kind.build(structuredClone(c.genesis)),
    kind.classes ?? [],
  );
  const again = snapshotGraph(life, sharedIndex(kind, c.genesis));
  if (sha256(JSON.stringify(again)) !== c.graphDigest)
    throw new Error(
      "restore refused: the restored life does not snapshot to the same bytes",
    );
  if (kind.tick(life) !== c.tick || kind.hash(life) !== c.stateHash)
    throw new Error(
      "restore refused: the restored life's state hash differs from the checkpoint's",
    );
  return life;
}

/**
 * Step `original` and `restored` side by side over `intervals` (ticks each)
 * and return the first interval at which they differ, or null. Criterion 2's
 * check that a restore continues the same life, not a similar one.
 */
export function divergence<G, L>(
  kind: LifeKind<G, L>,
  original: L,
  restored: L,
  intervals: readonly number[],
): { after: number; original: string; restored: string } | null {
  let after = 0;
  for (const n of intervals) {
    kind.step(original, n);
    kind.step(restored, n);
    after += n;
    const a = kind.hash(original),
      b = kind.hash(restored);
    if (a !== b) return { after, original: a, restored: b };
  }
  return null;
}

/**
 * Another individual, started from `c`: the same state at the same tick, a
 * new identity (from `nonce`), its parentage recorded. Its sequence starts
 * at 0 again: it has no past of its own.
 */
export function twinCheckpoint<G>(
  c: LifeCheckpoint<G>,
  nonce: string,
): LifeCheckpoint<G> {
  if (!c.graph) throw new Error("a compacted checkpoint cannot start a twin");
  const twin: Birth = {
    individual: sha256Json({ twinOf: c.birth.individual, sequence: c.sequence, nonce }),
    nonce,
    twinOf: { individual: c.birth.individual, sequence: c.sequence, digest: c.digest },
  };
  if (!/^[0-9a-f]{32,128}$/.test(nonce))
    throw new Error("a birth nonce is 32–128 hex digits");
  const body: Omit<LifeCheckpoint<G>, "digest"> = {
    ...structuredClone(c),
    birth: twin,
    sequence: 0,
    parent: null,
    events: [],
  };
  delete (body as Partial<LifeCheckpoint<G>>).digest;
  return { ...body, digest: seal(body) };
}
