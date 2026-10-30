/**
 * The watcher's judgement of the deployed life, from what anyone may read:
 * the observer's witness (`/v1/now`) and the newest backup's record
 * (`/v1/backup`, which `deploy/bethesda-life/backup.sh` writes and Caddy
 * serves). `scripts/bethesda-life-watch.ts` fetches both, and
 * `.github/workflows/bethesda-life-watch.yml` runs it every 15 minutes,
 * keeping one issue open while anything here is wrong.
 *
 * Watching changes nothing: it reads what the observer and Caddy serve and
 * reaches the machine no other way. Pure, so the tests hand it any witness,
 * record and clock.
 */
import type { Witness } from "./observation.js";

export const BACKUP_SCHEMA = "bethesda-life-backup/v1" as const;

/**
 * The life commits a checkpoint every 5 simulated minutes and keeps to wall
 * time: four missed is a life that no longer checkpoints.
 */
export const CHECKPOINT_LATE_S = 20 * 60;

/**
 * Backups run every 6 hours, up to 20 minutes late (the timer's random
 * delay): two runs missed, and time to spare.
 */
export const BACKUP_LATE_S = 13 * 3600;

export const HEX64 = /^[0-9a-f]{64}$/;

/** What `backup.sh` records: its newest run, and the newest archive kept and copied off. */
export interface BackupStatus {
  schema: typeof BACKUP_SCHEMA;
  attempt: {
    utc: string;
    /** kept: the copy passed `--check`; skipped: no memory to spare, or another run at work. */
    result: "kept" | "skipped" | "failed";
    detail: string | null;
    /** What became of this run's off-site copy: uploaded, not configured, or why not. */
    offsite: string;
  };
  /** The newest archive kept (it passed `--check`); null before the first. */
  kept: {
    utc: string;
    archive: string;
    sha256: string;
    bytes: number;
    individual: string;
    checkpoint: number;
    tick: number;
    release: string;
    /**
     * The archived head checkpoint's digest and the time the life committed
     * it, as the check verified them; null in records from before backup.sh
     * read them. The watcher's ledger (ledger.ts) anchors them.
     */
    digest: string | null;
    committed: string | null;
  } | null;
  /** The newest archive uploaded off the machine; null before the first. */
  offsite: { utc: string; archive: string } | null;
}

/** One look at something: what it showed, or why it showed nothing. */
export type Look<T> = { ok: true; value: T } | { ok: false; error: string };

export type ProblemCode =
  "unreachable" | "status" | "individual" | "checkpoint" | "backup" | "offsite";

export interface Problem {
  code: ProblemCode;
  detail: string;
}

type Obj = Record<string, unknown>;

class Invalid extends Error {}
const fail = (path: string, what: string): never => {
  throw new Invalid(`${path}: ${what}`);
};

export function object(
  v: unknown,
  path: string,
  keys: readonly string[],
  optional: readonly string[] = [],
): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    fail(path, "not an object");
  const o = v as Obj;
  const extra = Object.keys(o).filter((k) => !keys.includes(k) && !optional.includes(k));
  if (extra.length) fail(path, `unexpected ${extra.join(", ")}`);
  for (const k of keys) if (!(k in o)) fail(path, `missing ${k}`);
  return o;
}

export function str(v: unknown, path: string, max: number, pattern?: RegExp): string {
  if (typeof v !== "string") fail(path, "not a string");
  const s = v as string;
  if (s.length > max) fail(path, `longer than ${max}`);
  if (pattern && !pattern.test(s)) fail(path, "malformed");
  return s;
}

export function int(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    fail(path, "not a whole number");
  return v as number;
}

export function utc(v: unknown, path: string): string {
  const s = str(v, path, 40, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  if (!Number.isFinite(Date.parse(s))) fail(path, "not a date");
  return s;
}

export const ARCHIVE = /^bethesda-life-\d{8}T\d{6}Z-[0-9a-f]{12}\.tar\.gz$/;

/** The record `backup.sh` writes to status.json, validated; throws on anything else. */
export function parseBackupStatus(value: unknown): BackupStatus {
  const s = object(value, "backup", ["schema", "attempt", "kept", "offsite"]);
  if (s.schema !== BACKUP_SCHEMA) fail("backup.schema", `not ${BACKUP_SCHEMA}`);
  const a = object(s.attempt, "backup.attempt", ["utc", "result", "detail", "offsite"]);
  if (a.result !== "kept" && a.result !== "skipped" && a.result !== "failed")
    fail("backup.attempt.result", "not kept, skipped or failed");
  let kept: BackupStatus["kept"] = null;
  if (s.kept !== null) {
    const k = object(
      s.kept,
      "backup.kept",
      [
        "utc",
        "archive",
        "sha256",
        "bytes",
        "individual",
        "checkpoint",
        "tick",
        "release",
      ],
      ["digest", "committed"],
    );
    if ("digest" in k !== "committed" in k)
      fail("backup.kept", "a digest and its commit time come together");
    kept = {
      utc: utc(k.utc, "backup.kept.utc"),
      archive: str(k.archive, "backup.kept.archive", 80, ARCHIVE),
      sha256: str(k.sha256, "backup.kept.sha256", 64, HEX64),
      bytes: int(k.bytes, "backup.kept.bytes"),
      individual: str(k.individual, "backup.kept.individual", 64, HEX64),
      checkpoint: int(k.checkpoint, "backup.kept.checkpoint"),
      tick: int(k.tick, "backup.kept.tick"),
      release: str(k.release, "backup.kept.release", 40, /^[0-9a-f]{40}$/),
      digest: "digest" in k ? str(k.digest, "backup.kept.digest", 64, HEX64) : null,
      committed: "committed" in k ? utc(k.committed, "backup.kept.committed") : null,
    };
  }
  let offsite: BackupStatus["offsite"] = null;
  if (s.offsite !== null) {
    const o = object(s.offsite, "backup.offsite", ["utc", "archive"]);
    offsite = {
      utc: utc(o.utc, "backup.offsite.utc"),
      archive: str(o.archive, "backup.offsite.archive", 80, ARCHIVE),
    };
  }
  return {
    schema: BACKUP_SCHEMA,
    attempt: {
      utc: utc(a.utc, "backup.attempt.utc"),
      result: a.result as BackupStatus["attempt"]["result"],
      detail: a.detail === null ? null : str(a.detail, "backup.attempt.detail", 240),
      offsite: str(a.offsite, "backup.attempt.offsite", 240),
    },
    kept,
    offsite,
  };
}

/**
 * Text from the machine, made inert for an issue: no mention (`@`), tag or
 * code span can start in it.
 */
export const plain = (s: string): string => s.replace(/[@<>`]/g, "");

/** A duration for people: minutes up to an hour and a half, hours after. */
export function ago(seconds: number): string {
  return seconds < 5400
    ? `${Math.round(seconds / 60)} min`
    : `${(seconds / 3600).toFixed(1)} h`;
}

/**
 * Everything wrong with the deployed life, judged by the machine's own clock
 * (the witness's `servedUtc`), which wrote every time compared with it; the
 * watcher's `now` stands in only when the observer gave no witness.
 */
export function assess(o: {
  witness: Look<Witness>;
  /** null: no backup has recorded anything there (Caddy answers 404). */
  backup: Look<BackupStatus | null>;
  /** The deployed individual, which never changes. */
  individual: string;
  now: number;
}): Problem[] {
  const problems: Problem[] = [];
  let at = o.now;
  if (!o.witness.ok) {
    problems.push({
      code: "unreachable",
      detail: `the observer did not answer: ${plain(o.witness.error)}`,
    });
  } else {
    const w = o.witness.value;
    at = Date.parse(w.servedUtc);
    if (w.status !== "live")
      problems.push({
        code: "status",
        detail: `the witness is ${w.status}: ${plain(w.reason ?? "")}`,
      });
    const life = w.observation;
    if (life && life.individual !== o.individual)
      problems.push({
        code: "individual",
        detail: `the observer shows individual ${life.individual}, not ${o.individual}`,
      });
    if (life) {
      const late = (at - Date.parse(life.checkpoint.committedUtc)) / 1000;
      if (late > CHECKPOINT_LATE_S)
        problems.push({
          code: "checkpoint",
          detail: `the newest checkpoint, ${life.checkpoint.sequence}, was committed ${ago(late)} ago`,
        });
    }
  }

  if (!o.backup.ok) {
    problems.push({
      code: "backup",
      detail: `the backup record could not be read: ${plain(o.backup.error)}`,
    });
    return problems;
  }
  const b = o.backup.value;
  if (!b) {
    problems.push({
      code: "backup",
      detail:
        "no backup has recorded anything: the timer is not installed, or has not run",
    });
    return problems;
  }
  const newest = `the newest run, at ${b.attempt.utc}: ${b.attempt.result}${
    b.attempt.detail ? ` (${plain(b.attempt.detail)})` : ""
  }`;
  if (!b.kept) {
    problems.push({ code: "backup", detail: `no archive has been kept; ${newest}` });
  } else {
    const age = (at - Date.parse(b.kept.utc)) / 1000;
    if (age > BACKUP_LATE_S)
      problems.push({
        code: "backup",
        detail: `the newest archive kept is ${ago(age)} old; ${newest}`,
      });
    if (b.kept.individual !== o.individual)
      problems.push({
        code: "backup",
        detail: `the newest archive holds individual ${b.kept.individual}, not ${o.individual}`,
      });
  }
  const copy = `the newest run's copy: ${plain(b.attempt.offsite)}`;
  if (!b.offsite) {
    problems.push({
      code: "offsite",
      detail: `no archive has been copied off the machine; ${copy}`,
    });
  } else {
    const age = (at - Date.parse(b.offsite.utc)) / 1000;
    if (age > BACKUP_LATE_S)
      problems.push({
        code: "offsite",
        detail: `the newest archive copied off the machine is ${ago(age)} old; ${copy}`,
      });
  }
  return problems;
}

/** The kinds of problem, sorted: the same key means nothing new to report. */
export const problemKey = (problems: readonly Problem[]): string =>
  [...new Set(problems.map((p) => p.code))].sort().join(",");
