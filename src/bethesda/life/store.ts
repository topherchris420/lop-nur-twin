/**
 * Where one individual's checkpoints are kept: a directory, append-only,
 * with one writer at a time. Node only (the headless runner and the
 * experiment reports use it; nothing in the browser does).
 *
 *   <dir>/individual.json             who lives here (kind, individual, genesis digest)
 *   <dir>/checkpoints/<sequence>.json each sealed checkpoint, with the epoch that wrote it
 *   <dir>/leases/<epoch>.json         one per writer that ever held the lease
 *
 * - **Atomic and exclusive.** A file is written to a temporary name, synced,
 *   and published by `link`, which fails if the name exists: two processes
 *   continuing the same checkpoint cannot both write the next one. The second
 *   is refused as a fork, and its history is never merged into this one.
 * - **One writer, fenced by epoch.** A writer takes the lease by creating the
 *   next epoch's file, which only one can. The lease expires unless renewed;
 *   a writer that finds a higher epoch than its own has been replaced and
 *   every commit it tries is refused.
 * - **A chain.** Every checkpoint names its parent's digest. Opening the store
 *   checks every seal and link from birth to the head; any break stops it
 *   with the reason, and nothing is started in its place.
 * - **Bounded.** Only the newest `keepGraphs` checkpoints keep their whole
 *   graph; older ones keep their header (digests, events) so the chain and
 *   the life's events stay complete while the store stays small.
 * - **Wall time is for audit only.** Leases use it; the life's clock is its
 *   tick, and ticks that were not computed are never claimed.
 */
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { checkpointErrors, type LifeCheckpoint, type LifeKind } from "./continuity";

export const LIFE_STORE_SCHEMA = "life-store/v1" as const;
/** A lease lasts this long unless renewed (ms). */
export const LEASE_MS = 60_000;
const PAD = 12;

interface StoredCheckpoint<G> {
  schema: typeof LIFE_STORE_SCHEMA;
  /** The lease epoch of the writer that committed it. */
  epoch: number;
  committedUtc: string;
  checkpoint: LifeCheckpoint<G>;
}
interface Lease {
  schema: typeof LIFE_STORE_SCHEMA;
  epoch: number;
  holder: string;
  acquiredUtc: string;
  expiresUtc: string;
}
interface Identity {
  schema: typeof LIFE_STORE_SCHEMA;
  kind: string;
  individual: string;
  genesisDigest: string;
  twinOf: LifeCheckpoint["birth"]["twinOf"];
}

const pad = (n: number) => String(n).padStart(PAD, "0");

function writeExclusive(path: string, text: string): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tmp, "wx");
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(tmp, path);
  } finally {
    unlinkSync(tmp);
  }
  syncDir(path);
}

function writeReplacing(path: string, text: string): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tmp, "wx");
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  syncDir(path);
}

function syncDir(path: string): void {
  const dir = path.slice(0, path.lastIndexOf("/")) || ".";
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Some filesystems refuse to sync a directory; the file itself was synced.
  }
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

function numbered(dir: string): number[] {
  return readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => Number(f.slice(0, -5)))
    .sort((a, b) => a - b);
}

export class LifeStore<G, L> {
  readonly dir: string;
  readonly kind: LifeKind<G, L>;
  private now: () => number;
  private epoch: number | null = null;
  private holder: string;
  /** Checkpoints whose graphs are kept. */
  readonly keepGraphs: number;

  private constructor(
    dir: string,
    kind: LifeKind<G, L>,
    o: { now?: () => number; holder?: string; keepGraphs?: number },
  ) {
    this.dir = dir;
    this.kind = kind;
    this.now = o.now ?? Date.now;
    this.holder = o.holder ?? `pid ${process.pid}`;
    this.keepGraphs = Math.max(1, o.keepGraphs ?? 4);
  }

  /** Make a store for a newborn individual, holding its first checkpoint (sequence 0). */
  static create<G, L>(
    dir: string,
    kind: LifeKind<G, L>,
    first: LifeCheckpoint<G>,
    o: { now?: () => number; holder?: string; keepGraphs?: number } = {},
  ): LifeStore<G, L> {
    if (first.sequence !== 0) throw new Error("a store starts at an individual's birth");
    const errors = checkpointErrors(kind, first);
    if (errors.length) throw new Error(`checkpoint refused: ${errors.join("; ")}`);
    mkdirSync(dir, { recursive: true });
    if (readdirSync(dir).length)
      throw new Error(`${dir} is not empty: one individual per store`);
    mkdirSync(join(dir, "checkpoints"));
    mkdirSync(join(dir, "leases"));
    const id: Identity = {
      schema: LIFE_STORE_SCHEMA,
      kind: kind.id,
      individual: first.birth.individual,
      genesisDigest: first.genesisDigest,
      twinOf: first.birth.twinOf,
    };
    writeExclusive(join(dir, "individual.json"), JSON.stringify(id, null, 2) + "\n");
    const store = new LifeStore(dir, kind, o);
    store.acquire();
    store.publish(first);
    return store;
  }

  /** Open an existing store, checking its whole chain. Does not take the lease. */
  static open<G, L>(
    dir: string,
    kind: LifeKind<G, L>,
    o: { now?: () => number; holder?: string; keepGraphs?: number } = {},
  ): LifeStore<G, L> {
    const store = new LifeStore(dir, kind, o);
    store.verify();
    return store;
  }

  private identity(): Identity {
    return readJson<Identity>(join(this.dir, "individual.json"));
  }

  /** The highest lease epoch ever taken, and its lease. */
  private latestLease(): Lease | null {
    const epochs = numbered(join(this.dir, "leases"));
    const last = epochs[epochs.length - 1];
    return last === undefined
      ? null
      : readJson<Lease>(join(this.dir, "leases", `${pad(last)}.json`));
  }

  /** Take the lease: refused while another writer's has not expired. Returns the epoch. */
  acquire(): number {
    const latest = this.latestLease();
    const now = this.now();
    if (latest && latest.holder !== this.holder && Date.parse(latest.expiresUtc) > now)
      throw new Error(
        `the lease is held by ${latest.holder} (epoch ${latest.epoch}) until ${latest.expiresUtc}`,
      );
    const epoch = (latest?.epoch ?? 0) + 1;
    const lease: Lease = {
      schema: LIFE_STORE_SCHEMA,
      epoch,
      holder: this.holder,
      acquiredUtc: new Date(now).toISOString(),
      expiresUtc: new Date(now + LEASE_MS).toISOString(),
    };
    try {
      writeExclusive(
        join(this.dir, "leases", `${pad(epoch)}.json`),
        JSON.stringify(lease) + "\n",
      );
    } catch (e) {
      throw new Error(`another writer took epoch ${epoch} first`, { cause: e });
    }
    this.epoch = epoch;
    return epoch;
  }

  /** Throws unless this writer holds the newest, unexpired lease. */
  private fence(): number {
    if (this.epoch === null) throw new Error("this writer holds no lease");
    const latest = this.latestLease();
    if (!latest || latest.epoch !== this.epoch)
      throw new Error(
        `fenced: epoch ${this.epoch} was replaced by epoch ${latest?.epoch}`,
      );
    if (Date.parse(latest.expiresUtc) <= this.now())
      throw new Error(`the lease of epoch ${this.epoch} expired at ${latest.expiresUtc}`);
    return this.epoch;
  }

  /** Extend this writer's lease. */
  renew(): void {
    const epoch = this.fence();
    const path = join(this.dir, "leases", `${pad(epoch)}.json`);
    const lease = readJson<Lease>(path);
    lease.expiresUtc = new Date(this.now() + LEASE_MS).toISOString();
    writeReplacing(path, JSON.stringify(lease) + "\n");
  }

  /** Give the lease up (it expires now), so the next writer need not wait for it. */
  release(): void {
    const epoch = this.fence();
    const path = join(this.dir, "leases", `${pad(epoch)}.json`);
    const lease = readJson<Lease>(path);
    lease.expiresUtc = new Date(this.now()).toISOString();
    writeReplacing(path, JSON.stringify(lease) + "\n");
    this.epoch = null;
  }

  /** The newest checkpoint, with its graph. */
  head(): LifeCheckpoint<G> {
    return this.headRecord().checkpoint;
  }

  /** The newest checkpoint with when, and under which epoch, it was committed. */
  headRecord(): { checkpoint: LifeCheckpoint<G>; epoch: number; committedUtc: string } {
    const seqs = numbered(join(this.dir, "checkpoints"));
    const last = seqs[seqs.length - 1];
    if (last === undefined) throw new Error(`${this.dir} holds no checkpoint`);
    const { checkpoint, epoch, committedUtc } = this.read(last);
    return { checkpoint, epoch, committedUtc };
  }

  private read(sequence: number): StoredCheckpoint<G> {
    return readJson<StoredCheckpoint<G>>(
      join(this.dir, "checkpoints", `${pad(sequence)}.json`),
    );
  }

  /**
   * Commit the next checkpoint: it must continue the head, under this
   * writer's lease. Returns the UTC time it records the commit at.
   */
  commit(c: LifeCheckpoint<G>): string {
    this.fence();
    const head = this.head();
    if (c.birth.individual !== head.birth.individual)
      throw new Error("refused: that checkpoint is another individual's");
    if (c.sequence !== head.sequence + 1 || c.parent !== head.digest)
      throw new Error(
        `refused as a fork: it continues sequence ${c.sequence - 1} (${String(c.parent).slice(0, 12)}), the head is ${head.sequence} (${head.digest.slice(0, 12)})`,
      );
    if (c.tick < head.tick)
      throw new Error("refused: a checkpoint's tick never goes back");
    const errors = checkpointErrors(this.kind, c);
    if (errors.length) throw new Error(`checkpoint refused: ${errors.join("; ")}`);
    const committedUtc = this.publish(c);
    this.compact();
    return committedUtc;
  }

  private publish(c: LifeCheckpoint<G>): string {
    const stored: StoredCheckpoint<G> = {
      schema: LIFE_STORE_SCHEMA,
      epoch: this.fence(),
      committedUtc: new Date(this.now()).toISOString(),
      checkpoint: c,
    };
    try {
      writeExclusive(
        join(this.dir, "checkpoints", `${pad(c.sequence)}.json`),
        JSON.stringify(stored) + "\n",
      );
    } catch (e) {
      throw new Error(`refused as a fork: sequence ${c.sequence} was already written`, {
        cause: e,
      });
    }
    return stored.committedUtc;
  }

  /** Drop the graphs of all but the newest `keepGraphs` checkpoints. */
  private compact(): void {
    const seqs = numbered(join(this.dir, "checkpoints"));
    for (const seq of seqs.slice(0, Math.max(0, seqs.length - this.keepGraphs))) {
      const stored = this.read(seq);
      if (!stored.checkpoint.graph) continue;
      stored.checkpoint = { ...stored.checkpoint, graph: null };
      writeReplacing(
        join(this.dir, "checkpoints", `${pad(seq)}.json`),
        JSON.stringify(stored) + "\n",
      );
    }
  }

  /**
   * Check the whole chain: every seal, every parent link, contiguous
   * sequences, one individual, epochs that never go back. Throws on the
   * first break.
   */
  verify(): { checkpoints: number; head: number; events: number } {
    const id = this.identity();
    if (id.schema !== LIFE_STORE_SCHEMA || id.kind !== this.kind.id)
      throw new Error(`${this.dir} is not a ${this.kind.id} store`);
    const seqs = numbered(join(this.dir, "checkpoints"));
    if (!seqs.length) throw new Error(`${this.dir} holds no checkpoint`);
    let prev: LifeCheckpoint<G> | null = null;
    let epoch = 0,
      events = 0;
    for (const [i, seq] of seqs.entries()) {
      if (seq !== i) throw new Error(`checkpoint ${i} is missing`);
      const stored = this.read(seq);
      const c = stored.checkpoint;
      const errors = checkpointErrors(this.kind, c);
      if (errors.length)
        throw new Error(`checkpoint ${seq} is corrupt: ${errors.join("; ")}`);
      if (c.sequence !== seq)
        throw new Error(`checkpoint ${seq} says it is ${c.sequence}`);
      if (c.birth.individual !== id.individual)
        throw new Error(`checkpoint ${seq} is another individual's`);
      if (c.parent !== (prev ? prev.digest : null))
        throw new Error(`checkpoint ${seq} does not continue checkpoint ${seq - 1}`);
      if (prev && c.tick < prev.tick)
        throw new Error(`checkpoint ${seq} goes back in time`);
      if (stored.epoch < epoch)
        throw new Error(`checkpoint ${seq} was written by a fenced writer`);
      epoch = stored.epoch;
      events += c.events.length;
      prev = c;
    }
    if (!prev!.graph) throw new Error("the head checkpoint has lost its graph");
    return { checkpoints: seqs.length, head: prev!.sequence, events };
  }

  /** Every life event from birth to the head, in order. */
  events(): LifeCheckpoint<G>["events"] {
    return numbered(join(this.dir, "checkpoints")).flatMap(
      (s) => this.read(s).checkpoint.events,
    );
  }
}
