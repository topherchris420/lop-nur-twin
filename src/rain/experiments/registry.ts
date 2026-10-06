/**
 * File-backed experiment registry.
 *
 * A port of R.A.I.N.'s `experiments/registry.py` (james_library, MIT).
 * Layout (plain JSON files, reviewable with git):
 *
 *     <root>/
 *       registry.json                allocation ledger: every ID ever issued
 *       V3D-EXP-0001/
 *         experiment.json            pre-registered definition (write-once per version)
 *         runs/
 *           RUN-0001/
 *             result.json            run record (rain-experiment-run/v1)
 *
 * Identifiers are never reused: allocation takes the maximum of the ledger
 * and the directories, so deleting an experiment directory does not free its
 * ID. Experiment and run directories are claimed with an exclusive `mkdir`,
 * the ledger is written under an exclusive lock file, and a final run record
 * is never overwritten.
 *
 * Server only: this is the one place the runtime writes to disk.
 */
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DEFINITION_SCHEMA, ExperimentError, canonicalJson, validateDefinition, type Json } from "./schema.js";

export type { Json } from "./schema.js";

export const LEDGER_SCHEMA = "rain-experiment-registry/v1" as const;
export const EXPERIMENT_ID = /^V3D-EXP-(\d{4,})$/;
export const RUN_ID = /^(V3D-EXP-\d{4,})-RUN-(\d{4,})$/;
const RUN_DIR = /^RUN-(\d{4,})$/;

export const utcNow = (date = new Date()) => date.toISOString();
export const formatExperimentId = (number: number) => `V3D-EXP-${String(number).padStart(4, "0")}`;

/**
 * The definition `create` writes: the registry's fields around the draft's.
 * One assembly, so a definition another instance certified (`adopt`) is
 * rebuilt byte for byte as it was registered.
 */
export function assembleDefinition(fields: Json, experimentId: string, createdAt: string): Json {
  return {
    schema_version: DEFINITION_SCHEMA,
    experiment_version: 1,
    ...fields,
    experiment_id: experimentId,
    created_at: createdAt,
  };
}

export function checkExperimentId(value: unknown): string {
  if (typeof value !== "string" || !EXPERIMENT_ID.test(value))
    throw new ExperimentError(`Not an experiment ID: ${JSON.stringify(value)} (expected V3D-EXP-0001 form)`);
  return value;
}

function atomicWrite(path: string, text: string): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, text, { encoding: "utf8", flag: "wx" });
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      /* already gone */
    }
    throw error;
  }
}

/**
 * Read a bounded regular file through one descriptor: opened without following
 * a symlink, measured and read as the same file, so nothing can be swapped in
 * between the check and the read.
 */
export function readBoundedFile(path: string, limit: number): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "EMLINK")
      throw new ExperimentError(`Refusing to read symlink ${name}`);
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new ExperimentError(`${name} is not a regular file`);
    if (stat.size > limit) throw new ExperimentError(`${name} exceeds ${limit} bytes`);
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

/** Parse a file's text as JSON; a parse error is the registry's, named by file. */
export function parseJsonText(text: string, name: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ExperimentError(`${name} is not valid JSON: ${(error as Error).message}`);
  }
}

/** Read a bounded JSON file; symlinks are refused and parse errors are the registry's. */
export function readJson(path: string, limit = 16 * 1024 * 1024): unknown {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return parseJsonText(readBoundedFile(path, limit), name);
}

const sleepMs = (ms: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

export interface Ledger {
  schema_version: typeof LEDGER_SCHEMA;
  allocated: { id: string; created_at: string }[];
}

export class Registry {
  readonly root: string;
  readonly ledgerPath: string;
  private readonly now: () => Date;
  constructor(root: string, now: () => Date = () => new Date()) {
    this.now = now;
    this.root = root;
    this.ledgerPath = join(root, "registry.json");
  }

  // ── identifiers ────────────────────────────────────────────────────
  ledger(): Ledger {
    if (!existsSync(this.ledgerPath)) return { schema_version: LEDGER_SCHEMA, allocated: [] };
    const ledger = readJson(this.ledgerPath) as Partial<Ledger> | null;
    if (
      !ledger ||
      typeof ledger !== "object" ||
      ledger.schema_version !== LEDGER_SCHEMA ||
      !Array.isArray(ledger.allocated)
    )
      throw new ExperimentError("registry.json is not a valid allocation ledger");
    return ledger as Ledger;
  }

  experimentIds(): string[] {
    if (!existsSync(this.root) || !statSync(this.root).isDirectory()) return [];
    return readdirSync(this.root)
      .filter((name) => EXPERIMENT_ID.test(name) && statSync(join(this.root, name)).isDirectory())
      .sort();
  }

  /** Serialize ledger read-claim-write so concurrent creates cannot drop an allocation. */
  withLedgerLock<T>(fn: () => T, timeoutMs = 10_000): T {
    const lock = join(this.root, ".registry.lock");
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        closeSync(openSync(lock, "wx"));
        break;
      } catch {
        if (Date.now() >= deadline)
          throw new ExperimentError(
            `Registry is locked by another process (${lock}); if none is running, delete the lock file`,
          );
        sleepMs(20);
      }
    }
    try {
      return fn();
    } finally {
      try {
        unlinkSync(lock);
      } catch {
        /* already removed */
      }
    }
  }

  private allocate(createdAt: string): string {
    mkdirSync(this.root, { recursive: true });
    return this.withLedgerLock(() => {
      const ledger = this.ledger();
      const seen = [...ledger.allocated.map((entry) => entry.id ?? ""), ...this.experimentIds()];
      const numbers = seen.map((id) => EXPERIMENT_ID.exec(id)).flatMap((m) => (m ? [Number(m[1])] : []));
      let number = Math.max(0, ...numbers) + 1;
      let candidate = formatExperimentId(number);
      for (;;) {
        try {
          mkdirSync(join(this.root, candidate));
          break;
        } catch {
          number += 1;
          candidate = formatExperimentId(number);
        }
      }
      ledger.allocated.push({ id: candidate, created_at: createdAt });
      atomicWrite(this.ledgerPath, canonicalJson(ledger));
      return candidate;
    });
  }

  // ── experiments ────────────────────────────────────────────────────
  experimentDir(experimentId: string): string {
    return join(this.root, checkExperimentId(experimentId));
  }

  /** Allocate the next ID and write a validated, write-once definition. */
  create(fields: Json): Json {
    const createdAt = utcNow(this.now());
    const draft = assembleDefinition(fields, "V3D-EXP-0000", createdAt);
    validateDefinition(draft); // refuse before an ID is consumed
    const experimentId = this.allocate(createdAt);
    const definition = assembleDefinition(fields, experimentId, createdAt);
    writeFileSync(join(this.experimentDir(experimentId), "experiment.json"), canonicalJson(definition), {
      encoding: "utf8",
      flag: "wx",
    });
    return definition;
  }

  /** Whether this registry holds a definition under the ID. */
  holds(experimentId: string): boolean {
    return existsSync(join(this.experimentDir(experimentId), "experiment.json"));
  }

  /**
   * Hold a definition registered elsewhere — by another instance of this
   * registry, which certified it — under the ID it was given there. Written
   * once; holding it again is a no-op only if it is the same definition. No ID
   * is allocated, so the ledger is not touched.
   */
  adopt(definition: Json): void {
    validateDefinition(definition);
    const experimentId = checkExperimentId(definition.experiment_id);
    const text = canonicalJson(definition);
    const path = join(this.experimentDir(experimentId), "experiment.json");
    mkdirSync(this.experimentDir(experimentId), { recursive: true });
    try {
      writeFileSync(path, text, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (canonicalJson(this.loadDefinition(experimentId)) !== text)
        throw new ExperimentError(`${experimentId} is already held here with a different definition`);
    }
  }

  loadDefinition(experimentId: string): Json {
    const path = join(this.experimentDir(experimentId), "experiment.json");
    if (!existsSync(path)) throw new ExperimentError(`${experimentId} is not registered`);
    const definition = readJson(path) as Json;
    validateDefinition(definition);
    if (definition.experiment_id !== experimentId)
      throw new ExperimentError(`${path} declares ${definition.experiment_id}, not ${experimentId}`);
    return definition;
  }

  // ── runs ───────────────────────────────────────────────────────────
  runDirs(experimentId: string): string[] {
    const runs = join(this.experimentDir(experimentId), "runs");
    if (!existsSync(runs)) return [];
    return readdirSync(runs)
      .filter((name) => RUN_DIR.test(name) && statSync(join(runs, name)).isDirectory())
      .sort((a, b) => Number(RUN_DIR.exec(a)![1]) - Number(RUN_DIR.exec(b)![1]))
      .map((name) => join(runs, name));
  }

  runs(experimentId: string): Json[] {
    return this.runDirs(experimentId).flatMap((dir): Json[] => {
      const path = join(dir, "result.json");
      return existsSync(path) ? [readJson(path) as Json] : [];
    });
  }

  beginRun(experimentId: string): { runId: string; runDir: string } {
    const runs = join(this.experimentDir(experimentId), "runs");
    mkdirSync(runs, { recursive: true });
    const existing = this.runDirs(experimentId).map((dir) => Number(RUN_DIR.exec(dir.slice(dir.lastIndexOf("/") + 1))![1]));
    let number = Math.max(0, ...existing) + 1;
    for (;;) {
      const name = `RUN-${String(number).padStart(4, "0")}`;
      const runDir = join(runs, name);
      try {
        mkdirSync(runDir);
        return { runId: `${experimentId}-${name}`, runDir };
      } catch {
        number += 1;
      }
    }
  }

  writeRun(runDir: string, record: Json): void {
    const path = join(runDir, "result.json");
    if (existsSync(path)) {
      const current = readJson(path) as Json;
      if (current.status !== "running")
        throw new ExperimentError(`${record.run_id} is final; run records are never overwritten`);
    }
    atomicWrite(path, canonicalJson(record));
  }

  resolveRun(runId: string): { runDir: string; record: Json } {
    const match = RUN_ID.exec(runId ?? "");
    if (!match) throw new ExperimentError(`Not a run ID: ${JSON.stringify(runId)} (expected V3D-EXP-0001-RUN-0001 form)`);
    const runDir = join(this.experimentDir(match[1]!), "runs", `RUN-${match[2]}`);
    const path = join(runDir, "result.json");
    if (!existsSync(path)) throw new ExperimentError(`${runId} is not recorded`);
    return { runDir, record: readJson(path) as Json };
  }
}
