/**
 * Records the model's revisions from `main`'s history.
 *
 *   bun run model:record            # append revisions for commits not yet recorded
 *   bun run model:record --verify   # reproduce every recorded manifest, byte for byte
 *
 * For each first-parent commit after the latest recorded revision (or from the
 * origin, for an empty history), this checks the commit out into a temporary
 * worktree and runs *that commit's own* `scripts/generate-manifest.ts` with
 * `SOURCE_DATE_EPOCH` set to the commit's time. Where the manifest's content —
 * everything but `generatedAt` and `modelVersion` — differs from the previous
 * revision's, the file is kept byte for byte as a new revision. Nothing is
 * typed in: every date is git's, every byte is the generator's, and
 * `recordedAt` is the real time of this run.
 *
 * The reconstruction needs the full history (`git fetch --unshallow` in a
 * shallow clone) and Bun, because the commits before `scripts/run-ts.mjs`
 * existed ran their generator only under Bun. The build itself needs neither:
 * `scripts/validate-model-history.ts` checks the committed files offline.
 *
 * A model change is recorded after it is committed: commit the change, run
 * this, commit `model-history/`. The build fails in between, by design — a
 * model whose current state is not in its own history cannot say when any of
 * its claims entered it.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MODEL_HISTORY_SCHEMA,
  deriveSubjectHistory,
  type ModelHistoryFile,
  type ModelRevision,
  type SubjectDigestRow,
} from "../src/lib/modelRevisions";
import { contentKey, sha256 } from "./model-history-content";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const historyDir = path.join(projectRoot, "model-history");
const indexPath = path.join(historyDir, "index.json");

/**
 * The first commit whose generator digests each subject (manifest schema
 * 1.1.0). Earlier manifests hash the model as a whole, so nothing before this
 * can be attributed to a subject.
 */
const ORIGIN_COMMIT = "088c729b567a4dd6df499446876c26db0925ec33";
const ORIGIN_REASON =
  "The first commit on main whose manifest generator digests each subject (manifest schema 1.1.0). Earlier manifests hash the model as a whole and name no subject, so the record cannot attribute anything to a subject before it: a subject present here entered the model by this revision, at an unknown earlier time.";
const METHOD =
  "Each revision's manifest is the output of that commit's own scripts/generate-manifest.ts, run by scripts/record-model-history.ts with SOURCE_DATE_EPOCH set to the commit's time, kept byte for byte. A revision is recorded wherever the manifest's content (everything but generatedAt and modelVersion) differs from the previous first-parent commit's. `bun run model:record --verify` reproduces every file.";

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" }).trim();
}

function subjectsOf(manifestText: string): SubjectDigestRow[] {
  const manifest = JSON.parse(manifestText) as { subjects?: SubjectDigestRow[] };
  if (!Array.isArray(manifest.subjects)) {
    throw new Error("manifest has no per-subject digests");
  }
  return manifest.subjects;
}

function loadHistory(): ModelHistoryFile | null {
  if (!existsSync(indexPath)) return null;
  return JSON.parse(readFileSync(indexPath, "utf8")) as ModelHistoryFile;
}

function requireBun(): void {
  const probe = spawnSync("bun", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    console.error(
      "[model-history] Bun is required: commits before scripts/run-ts.mjs existed ran their generator only under Bun.",
    );
    process.exit(2);
  }
}

function requireFullHistory(): void {
  if (git("rev-parse", "--is-shallow-repository") === "true") {
    console.error(
      "[model-history] This clone is shallow. Run `git fetch --unshallow` first: every revision is reproduced from its own commit.",
    );
    process.exit(2);
  }
}

/** A detached worktree that shares this checkout's dependencies. */
function withWorktree<T>(run: (worktree: string) => T): T {
  const base = mkdtempSync(path.join(tmpdir(), "lop-nur-history-"));
  const worktree = path.join(base, "wt");
  git("worktree", "add", "--quiet", "--detach", worktree, "HEAD");
  try {
    // A directory junction on Windows: a plain symlink there needs admin
    // rights or Developer Mode, and `junction` is ignored everywhere else.
    symlinkSync(
      path.join(projectRoot, "node_modules"),
      path.join(worktree, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    return run(worktree);
  } finally {
    git("worktree", "remove", "--force", worktree);
    rmSync(base, { recursive: true, force: true });
  }
}

/** Runs one commit's own generator, pinned to its commit time; returns the bytes. */
function generateAt(worktree: string, commit: string): Buffer {
  execFileSync("git", ["checkout", "--quiet", "--detach", commit], { cwd: worktree });
  const output = path.join(worktree, "public", "model-manifest.json");
  rmSync(output, { force: true });
  const epoch = git("log", "-1", "--format=%ct", commit);
  const run = spawnSync("bun", ["scripts/generate-manifest.ts"], {
    cwd: worktree,
    env: { ...process.env, SOURCE_DATE_EPOCH: epoch },
    encoding: "utf8",
  });
  if (run.status !== 0 || !existsSync(output)) {
    throw new Error(
      `generator failed at ${commit.slice(0, 12)}: ${(run.stderr || run.stdout).trim().split("\n").slice(-3).join(" | ")}`,
    );
  }
  return readFileSync(output);
}

function revisionCommits(after: string | null): string[] {
  const head = git("rev-parse", "HEAD");
  const range = after === null ? [`${ORIGIN_COMMIT}^..${head}`] : [`${after}..${head}`];
  if (after !== null) {
    try {
      git("merge-base", "--is-ancestor", after, head);
    } catch {
      throw new Error(
        `the latest recorded revision's commit ${after.slice(0, 12)} is not an ancestor of HEAD`,
      );
    }
  }
  const list = git("rev-list", "--first-parent", "--reverse", ...range);
  return list === "" ? [] : list.split("\n");
}

function writeHistory(revisions: ModelRevision[]): void {
  const manifests = revisions.map((revision) => ({
    revision: revision.revision,
    subjects: subjectsOf(readFileSync(path.join(historyDir, revision.manifest), "utf8")),
  }));
  const file: ModelHistoryFile = {
    schema: MODEL_HISTORY_SCHEMA,
    origin: { commit: ORIGIN_COMMIT, reason: ORIGIN_REASON },
    method: METHOD,
    revisions,
    subjects: deriveSubjectHistory(manifests),
  };
  writeFileSync(indexPath, `${JSON.stringify(file, null, 2)}\n`);
}

function record(): void {
  const existing = loadHistory();
  const revisions: ModelRevision[] = existing === null ? [] : [...existing.revisions];
  const last = revisions[revisions.length - 1];
  const commits = revisionCommits(last?.commit ?? null);
  if (commits.length === 0) {
    console.log(`[model-history] up to date at r${last?.revision ?? 0}`);
    return;
  }
  mkdirSync(path.join(historyDir, "manifests"), { recursive: true });
  const recordedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  withWorktree((worktree) => {
    let previousKey = last?.contentKey ?? null;
    for (const commit of commits) {
      const bytes = generateAt(worktree, commit);
      const key = contentKey(bytes.toString("utf8"));
      if (key === previousKey) continue;
      const revision = revisions.length + 1;
      const manifest = `manifests/r${revision}.json`;
      writeFileSync(path.join(historyDir, manifest), bytes);
      const schema = (
        JSON.parse(bytes.toString("utf8")) as { manifestSchemaVersion?: string }
      ).manifestSchemaVersion;
      revisions.push({
        revision,
        commit,
        committedAt: new Date(Number(git("log", "-1", "--format=%ct", commit)) * 1000)
          .toISOString()
          .replace(/\.\d{3}Z$/, "Z"),
        title: git("log", "-1", "--format=%s", commit),
        manifest,
        manifestSha256: sha256(bytes),
        manifestSchemaVersion: schema ?? "unstated",
        contentKey: key,
        recordedAt,
      });
      previousKey = key;
      console.log(
        `[model-history] r${revision} ${commit.slice(0, 12)} ${key.slice(0, 19)}`,
      );
    }
  });

  writeHistory(revisions);
  console.log(`[model-history] ${revisions.length} revisions recorded`);
}

function verify(): void {
  const history = loadHistory();
  if (history === null) {
    console.error(
      "[model-history] nothing to verify: model-history/index.json is missing",
    );
    process.exit(1);
  }
  let failures = 0;
  withWorktree((worktree) => {
    for (const revision of history.revisions) {
      const bytes = generateAt(worktree, revision.commit);
      const ok = sha256(bytes) === revision.manifestSha256;
      if (!ok) failures += 1;
      console.log(
        `[model-history] r${revision.revision} ${revision.commit.slice(0, 12)} ${ok ? "reproduces" : "DIFFERS"}`,
      );
    }
  });
  if (failures > 0) {
    console.error(`[model-history] ${failures} revision(s) did not reproduce`);
    process.exit(1);
  }
  console.log("[model-history] every recorded manifest reproduces byte for byte");
}

requireBun();
requireFullHistory();
if (process.argv.includes("--verify")) verify();
else record();
