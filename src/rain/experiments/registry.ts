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
  lstatSync,
  linkSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve, isAbsolute, sep } from "node:path";
import { DEFINITION_SCHEMA, ExperimentError, canonicalJson, validateDefinition, sha256Json, type Json } from "./schema.js";
import { assessResearch, validateResearchPlan, validateResearchReview, MAX_RESEARCH_REVISIONS, MAX_RESEARCH_BYTES, type ResearchPlan, type ResearchRevision, type ResearchReview } from "./research.js";

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
  const name = basename(path);
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
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
  const name = basename(path);
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
    this.root = resolve(root);
    this.ledgerPath = join(this.root, "registry.json");
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
    const path = this.safePath(join(this.experimentDir(experimentId), "experiment.json"));
    if (!existsSync(path)) throw new ExperimentError(`${experimentId} is not registered`);
    const definition = readJson(path) as Json;
    validateDefinition(definition);
    if (definition.experiment_id !== experimentId)
      throw new ExperimentError(`${path} declares ${definition.experiment_id}, not ${experimentId}`);
    return definition;
  }

  // ── runs ───────────────────────────────────────────────────────────
  runDirs(experimentId: string): string[] {
    const runs = this.safePath(join(this.experimentDir(experimentId), "runs"));
    if (!existsSync(runs)) return [];
    return readdirSync(runs)
      .filter((name) => RUN_DIR.test(name) && statSync(this.safePath(join(runs, name))).isDirectory())
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
    const existing = this.runDirs(experimentId).map((dir) => Number(RUN_DIR.exec(basename(dir))![1]));
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
    const path = this.safePath(join(runDir, "result.json"));
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
    const path = this.safePath(join(runDir, "result.json"));
    if (!existsSync(path)) throw new ExperimentError(`${runId} is not recorded`);
    return { runDir, record: readJson(path) as Json };
  }

  /** Reject traversal and symlinked ancestors before reading or writing artifacts. */
  safePath(path: string): string {
    const target = resolve(path);
    const rel = relative(this.root, target);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new ExperimentError("Path leaves the experiment registry");
    let current = this.root;
    for (const part of ["", ...rel.split(sep).filter(Boolean)]) {
      current = join(current, part);
      try {
        if (lstatSync(current).isSymbolicLink()) throw new ExperimentError("Symlinked registry paths are refused");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return target;
  }

  /** Publish a complete immutable file; interruption never exposes a partial revision. */
  private writeOnce(path: string, text: string): void {
    this.safePath(path);
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    const fd = openSync(temp, "wx");
    try { writeFileSync(fd, text, "utf8"); fsyncSync(fd); }
    finally { closeSync(fd); }
    try { linkSync(temp, path); }
    finally { unlinkSync(temp); }
  }

  /** Bytes supplied by the host, never a URI or path supplied by a producer. */
  writeArtifacts(runDir: string, artifacts: Readonly<Record<string, string>>): void {
    if (!Object.keys(artifacts).length) return;
    const dir = this.safePath(join(runDir, "artifacts"));
    mkdirSync(dir);
    for (const [name, text] of Object.entries(artifacts)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)) throw new ExperimentError("Invalid artifact name");
      this.writeOnce(join(dir, name), text);
    }
  }

  readArtifact(runId: string, name: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)) throw new ExperimentError("Invalid artifact name");
    const { runDir } = this.resolveRun(runId);
    return readBoundedFile(this.safePath(join(runDir, "artifacts", name)), 8 * 1024 * 1024);
  }

  researchHistory(): ResearchRevision[] {
    const dir = this.safePath(join(this.root, "research"));
    if (!existsSync(dir)) return [];
    const names = readdirSync(dir).filter((n) => /^REV-\d{6}\.json$/.test(n)).sort();
    if (names.length > MAX_RESEARCH_REVISIONS) throw new ExperimentError("Research history exceeds its revision budget");
    const history: ResearchRevision[] = [];
    for (const name of names) {
      const r = readJson(this.safePath(join(dir, name)), MAX_RESEARCH_BYTES * 16) as ResearchRevision;
      const { sha256, ...body } = r;
      const previous = history.at(-1);
      if (r.schema !== "rain-research-revision/v1" || r.revision !== history.length + 1 ||
          name !== `REV-${String(r.revision).padStart(6, "0")}.json` ||
          sha256Json(body) !== sha256 || r.previous_sha256 !== (previous?.sha256 ?? null))
        throw new ExperimentError("Research history is missing a revision or has changed");
      validateResearchPlan(r.plan);
      const { identity_verified, ...review } = r.review;
      if (identity_verified !== false) throw new ExperimentError("Research review is an attestation, not identity verification");
      validateResearchReview(r.plan, review);
      if (r.plan.based_on !== null && !history.some((h) => h.revision === r.plan.based_on))
        throw new ExperimentError("Missing research branch parent");
      history.push(r);
    }
    return history;
  }

  /** Append a reviewed branch snapshot under the registry's existing writer lock. */
  saveResearch(raw: ResearchPlan, expectedRevision: number, review: ResearchReview): ResearchRevision {
    const plan = structuredClone(validateResearchPlan(raw));
    const approved = validateResearchReview(plan, review);
    mkdirSync(this.safePath(this.root), { recursive: true });
    return this.withLedgerLock(() => {
      const history = this.researchHistory();
      if (history.length !== expectedRevision) throw new ExperimentError("Research revision conflict; review the current history first");
      if (history.length >= MAX_RESEARCH_REVISIONS) throw new ExperimentError("Research revision budget exhausted");
      if (plan.based_on !== null && !history.some((h) => h.revision === plan.based_on)) throw new ExperimentError("Missing branch parent");
      const head = history.filter((h) => h.plan.branch === plan.branch).at(-1);
      if (head && plan.based_on !== head.revision) throw new ExperimentError("An existing branch must extend its latest revision");
      for (const claim of plan.claims) {
        this.loadDefinition(claim.experiment.id);
        for (const source of claim.runs) this.resolveRun(source.id);
      }
      const body: Omit<ResearchRevision, "sha256"> = {
        schema: "rain-research-revision/v1", revision: history.length + 1,
        previous_sha256: history.at(-1)?.sha256 ?? null, created_at: utcNow(this.now()),
        review: { ...approved, identity_verified: false }, plan, assessment: assessResearch(this, plan),
      };
      const result = { ...body, sha256: sha256Json(body) };
      const text = canonicalJson(result);
      if (Buffer.byteLength(text) > MAX_RESEARCH_BYTES * 16) throw new ExperimentError("Research revision is too large");
      const dir = this.safePath(join(this.root, "research"));
      mkdirSync(dir, { recursive: true });
      this.writeOnce(join(dir, `REV-${String(result.revision).padStart(6, "0")}.json`), text);
      return result;
    });
  }

  /** Preserve an interrupted record, close it as an error, never infer an outcome. */
  recoverInterruptedRun(runId: string, review: { operator: string; reviewed: true; record_sha256: string }): Json {
    return this.withLedgerLock(() => {
      const { runDir, record } = this.resolveRun(runId);
      if (review.reviewed !== true || typeof review.operator !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(review.operator) || review.record_sha256 !== sha256Json(record))
        throw new ExperimentError("Recovery requires operator review of the exact interrupted record");
      if (record.status !== "running") throw new ExperimentError("Only a running record can be recovered");
      const prior = this.safePath(join(runDir, "interrupted.json"));
      const text = canonicalJson(record);
      if (existsSync(prior)) {
        if (readBoundedFile(prior, 16 * 1024 * 1024) !== text) throw new ExperimentError("Interrupted snapshot differs");
      } else this.writeOnce(prior, text);
      const recovered = { ...record, status: "error", hypothesis_verdict: "not_evaluated", evaluation: null,
        finished_at: utcNow(this.now()), error: { stage: "recovery", type: "InterruptedExecution", message: `Closed by ${review.operator}; restart requires a new authorized run. Original record retained as interrupted.json.` },
        interpretation: { deterministic: "Execution was interrupted; the hypothesis was not evaluated.", model: null } };
      this.writeRun(runDir, recovered);
      return recovered;
    });
  }
}
