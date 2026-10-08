/**
 * The research state on disk: one directory, written by the host only.
 *
 *   charters/CH-<12>.json                         a charter, written once
 *   charters/CH-<12>.authorization-<12>.json      a person's authorization of it, written once
 *   records/<run id>.json                         a sealed lab record, written once, never overwritten
 *   sessions/<session id>/trace.jsonl             the session's trace, append-only
 *   sessions/<session id>/summary.json            the session's summary, written once
 *   registry/                                     the runtime's experiment registry, by default
 *   state.json                                    a snapshot of the derived state, for people
 *
 * Every path is resolved inside the root and refused if it would leave it.
 * Nothing here writes anywhere else — not the Lop Nur evidence ledger, not
 * the source tree, not the lab's DEMO — and a record that exists is never
 * replaced: `writeRecord` opens with `wx`, so a second write fails instead of
 * overwriting. `state.json` is the one file rewritten, and nothing reads it
 * back: the state is derived again from the records and traces every time
 * (`state.ts`), so a hand-edited snapshot changes nothing.
 *
 * Server only.
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { canonicalJson } from "../sha256.js";
import { recordDigestOK, type ExperimentRecord } from "../../bethesda/rain/record.js";
import {
  charterIdOf,
  charterSha256,
  verifyCharterAuthorization,
  type Charter,
  type CharterAuthorization,
} from "../../bethesda/rain/standing.js";
import { TRACE_SCHEMA, type TraceEntry } from "./trace.js";

/** Bounds on what is read back. */
const MAX_RECORD = 8 * 1024 * 1024;
const MAX_TRACE = 64 * 1024 * 1024;
const RUN_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{3,127}\.json$/;
const SESSION_DIR = /^RS-[0-9TZ]{16}-[0-9a-f]{8}$/;

export interface StoredRecord {
  /** Relative to the store's root. */
  path: string;
  record: ExperimentRecord | null;
  digestOK: boolean;
  /** Why the file could not be read as a record, when it could not. */
  problem: string | null;
}

export class StoreError extends Error {}

function readBounded(path: string, limit: number): string {
  const fd = openSync(path, "r");
  try {
    if (fstatSync(fd).size > limit)
      throw new StoreError(`${path} exceeds ${limit} bytes`);
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

export class ResearchStore {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  /** A path inside the root, or a refusal. */
  private at(...parts: string[]): string {
    const path = resolve(this.root, ...parts);
    const rel = relative(this.root, path);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new StoreError("a path outside the research directory was refused");
    return path;
  }
  relative(path: string): string {
    return relative(this.root, path);
  }
  exists(): boolean {
    return existsSync(this.root);
  }
  private ensure(...parts: string[]): string {
    const dir = this.at(...parts);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  /** Write a file that must not exist yet. */
  private writeOnce(path: string, text: string): void {
    writeFileSync(path, text, { encoding: "utf8", flag: "wx" });
  }

  registryDir(): string {
    return this.at("registry");
  }

  /** The charter, kept once; a different charter under the same id is refused. */
  saveCharter(charter: Charter): string {
    const sha = charterSha256(charter);
    this.ensure("charters");
    const path = this.at("charters", `${charterIdOf(sha)}.json`);
    const text = canonicalJson(charter) + "\n";
    if (existsSync(path)) {
      if (readBounded(path, MAX_RECORD) !== text)
        throw new StoreError(`${this.relative(path)} holds a different charter`);
      return path;
    }
    this.writeOnce(path, text);
    return path;
  }

  saveAuthorization(auth: CharterAuthorization): string {
    this.ensure("charters");
    const path = this.at(
      "charters",
      `${charterIdOf(auth.charter_sha256)}.authorization-${auth.authorization_sha256.slice(0, 12)}.json`,
    );
    this.writeOnce(path, canonicalJson(auth) + "\n");
    return path;
  }

  /**
   * Every authorization of this charter that verifies, newest first. Whether
   * one still stands is the caller's question, asked against its own clock.
   */
  authorizations(charter: Charter): CharterAuthorization[] {
    const dir = this.at("charters");
    if (!existsSync(dir)) return [];
    const prefix = `${charterIdOf(charterSha256(charter))}.authorization-`;
    const out: CharterAuthorization[] = [];
    for (const name of readdirSync(dir).sort()) {
      if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
      try {
        const auth = JSON.parse(readBounded(join(dir, name), 64 * 1024)) as unknown;
        if (!verifyCharterAuthorization(auth, charter).length)
          out.push(auth as CharterAuthorization);
      } catch {
        // A file that is not an authorization of this charter authorizes nothing.
      }
    }
    return out.sort((a, b) => Date.parse(b.authorized_at) - Date.parse(a.authorized_at));
  }

  /** Seal a record into the store. A record already there is never replaced. */
  writeRecord(record: ExperimentRecord): string {
    if (!recordDigestOK(record))
      throw new StoreError(
        `${record.run_id} does not match its digest; it was not written`,
      );
    const name = `${record.run_id}.json`;
    if (!RUN_FILE.test(name))
      throw new StoreError("a run id that is not a file name was refused");
    this.ensure("records");
    const path = this.at("records", name);
    try {
      this.writeOnce(path, JSON.stringify(record) + "\n");
    } catch (error) {
      throw new StoreError(
        (error as NodeJS.ErrnoException).code === "EEXIST"
          ? `${this.relative(path)} already exists; a sealed record is never overwritten`
          : `${this.relative(path)} could not be written`,
      );
    }
    return this.relative(path);
  }

  records(): StoredRecord[] {
    const dir = this.at("records");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => RUN_FILE.test(name))
      .sort()
      .map((name) => {
        const path = this.relative(join(dir, name));
        try {
          const record = JSON.parse(
            readBounded(join(dir, name), MAX_RECORD),
          ) as ExperimentRecord;
          return { path, record, digestOK: recordDigestOK(record), problem: null };
        } catch (error) {
          return {
            path,
            record: null,
            digestOK: false,
            problem: error instanceof Error ? error.message.slice(0, 200) : "unreadable",
          };
        }
      });
  }

  /** Every session's trace entries, oldest session first; unreadable lines are skipped and counted. */
  traces(): { entries: TraceEntry[]; skipped: number } {
    const dir = this.at("sessions");
    const entries: TraceEntry[] = [];
    let skipped = 0;
    if (!existsSync(dir)) return { entries, skipped };
    for (const id of readdirSync(dir)
      .filter((d) => SESSION_DIR.test(d))
      .sort()) {
      const path = join(dir, id, "trace.jsonl");
      if (!existsSync(path)) continue;
      for (const line of readBounded(path, MAX_TRACE).split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as TraceEntry;
          if (entry?.schema === TRACE_SCHEMA && entry.session_id === id)
            entries.push(entry);
          else skipped += 1;
        } catch {
          skipped += 1;
        }
      }
    }
    return { entries, skipped };
  }

  /** A new session's trace; the directory must not exist yet. */
  openSession(sessionId: string): SessionLog {
    if (!SESSION_DIR.test(sessionId)) throw new StoreError("malformed session id");
    this.ensure("sessions");
    const dir = this.at("sessions", sessionId);
    mkdirSync(dir);
    const trace = join(dir, "trace.jsonl");
    this.writeOnce(trace, "");
    return {
      append: (entry) => appendFileSync(trace, JSON.stringify(entry) + "\n", "utf8"),
      close: (summary) => {
        const path = join(dir, "summary.json");
        this.writeOnce(path, JSON.stringify(summary, null, 2) + "\n");
        return this.relative(path);
      },
      trace: this.relative(trace),
    };
  }

  /** A derived snapshot for people to read; written atomically, never read back. */
  writeState(state: unknown): string {
    this.ensure();
    const path = this.at("state.json");
    const temp = this.at(`state.json.${process.pid}.tmp`);
    writeFileSync(temp, JSON.stringify(state, null, 2) + "\n", "utf8");
    renameSync(temp, path);
    return this.relative(path);
  }
}

export interface SessionLog {
  append(entry: TraceEntry): void;
  close(summary: unknown): string;
  trace: string;
}
