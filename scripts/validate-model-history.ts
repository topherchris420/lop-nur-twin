/**
 * Build gate for the model's recorded history (`model-history/`).
 *
 *   node scripts/run-ts.mjs scripts/validate-model-history.ts
 *
 * Runs after `generate-manifest.ts`, offline, with no git: it checks only what
 * is committed and what the build just generated.
 *
 * 1. The index is well formed, its revisions are contiguous, dated in order,
 *    and start at the declared origin.
 * 2. Every recorded manifest is present with the bytes its digest names, passes
 *    the same parser `/compare` uses, and has the content key the index says.
 * 3. Consecutive revisions differ: a revision is a change, never a repeat.
 * 4. The per-subject table is exactly what the manifests derive.
 * 5. The model this build describes is the latest recorded revision. A model
 *    whose current state is not in its own history cannot say when any claim
 *    entered it, so a model change is not done until `bun run model:record`
 *    has recorded it.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../src/lib/canonicalJson";
import { parseManifest } from "../src/lib/manifestDiff";
import {
  deriveSubjectHistory,
  parseModelHistory,
  type SubjectDigestRow,
} from "../src/lib/modelRevisions";
import { contentKey, sha256 } from "./model-history-content";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const historyDir = path.join(projectRoot, "model-history");
const currentManifestPath = path.join(projectRoot, "public", "model-manifest.json");

const errors: string[] = [];
const fail = (message: string) => errors.push(message);
const lfBytes = (bytes: Buffer): Buffer =>
  bytes.includes(13) ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n")) : bytes;

const history = parseModelHistory(
  JSON.parse(readFileSync(path.join(historyDir, "index.json"), "utf8")),
);

if (history.origin.commit !== history.revisions[0]?.commit) {
  fail("the first revision is not the declared origin commit");
}

const derivedInput: { revision: number; subjects: readonly SubjectDigestRow[] }[] = [];
let previousKey: string | null = null;
let previousDate = "";

for (const revision of history.revisions) {
  const at = `r${revision.revision}`;
  const file = path.join(historyDir, revision.manifest);
  if (!existsSync(file)) {
    fail(`${at}: ${revision.manifest} is missing`);
    continue;
  }
  // A recorded manifest is committed LF text; a CRLF checkout has not changed
  // what it says, so the digest is checked over its LF form (the raw bytes,
  // for an LF file).
  const bytes = lfBytes(readFileSync(file));
  if (sha256(bytes) !== revision.manifestSha256) {
    fail(`${at}: ${revision.manifest} does not have the bytes its digest names`);
  }
  const text = bytes.toString("utf8");
  const parsed = parseManifest(text);
  if (!parsed.ok) {
    fail(`${at}: ${parsed.error}`);
    continue;
  }
  if (
    (parsed.manifest.manifestSchemaVersion ?? "unstated") !==
    revision.manifestSchemaVersion
  ) {
    fail(`${at}: schema version disagrees with its manifest`);
  }
  const key = contentKey(text);
  if (key !== revision.contentKey) fail(`${at}: content key does not match its manifest`);
  if (key === previousKey) fail(`${at}: identical in content to the revision before it`);
  if (revision.committedAt < previousDate)
    fail(`${at}: dated before the revision before it`);
  previousKey = key;
  previousDate = revision.committedAt;
  const subjects = parsed.manifest.subjects;
  if (subjects === undefined) {
    fail(`${at}: manifest carries no per-subject digests`);
    continue;
  }
  derivedInput.push({ revision: revision.revision, subjects });
}

if (
  canonicalJson(deriveSubjectHistory(derivedInput)) !== canonicalJson(history.subjects)
) {
  fail("the per-subject table is not what the recorded manifests derive");
}

const latest = history.revisions[history.revisions.length - 1]!;
if (!existsSync(currentManifestPath)) {
  fail("public/model-manifest.json is missing: run the manifest generator first");
} else if (contentKey(readFileSync(currentManifestPath, "utf8")) !== latest.contentKey) {
  fail(
    `the model has changed since r${latest.revision} (${latest.commit.slice(0, 12)}). ` +
      "Commit the change, run `bun run model:record` with full history, and commit model-history/.",
  );
}

if (errors.length > 0) {
  console.error("[validate:model-history] FAILED");
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(
  `[validate:model-history] OK: ${history.revisions.length} revisions, ${Object.keys(history.subjects).length} subjects, current model is r${latest.revision}`,
);
