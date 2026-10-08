/**
 * Import R.A.I.N.'s evidence corpus and its four perspectives from a checkout
 * of their source repository, with provenance.
 *
 * The R.A.I.N. research runtime in this repository (`src/rain/`) was
 * consolidated from `topherchris420/james_library`; the papers its offline
 * engine quotes and the SOUL files that define James, Jasmine, Luca and Elena
 * are data, kept here as JSON derivatives with a source manifest, like the
 * Bethesda OSM and terrain snapshots. Nothing is fetched at build or run time.
 *
 * The importer applies the runtime's own corpus rules (`isCorpusPath`) to the
 * checkout's `papers/` directory, so the bundled set is exactly what R.A.I.N.
 * counted as papers at that commit; it refuses a dirty checkout or one whose
 * commit it cannot name, hashes every file, records the real import time, and
 * runs the repository's formatter before hashing the derivatives. Every output
 * is formatted in memory before any is written, and the manifest is written
 * last, so a formatter failure leaves the previous import whole rather than
 * new data beside an old manifest.
 *
 *   node scripts/run-ts.mjs scripts/import-rain-source.ts --from ../james_library
 *
 * Never hand-edit the derivatives or the manifest; re-import instead.
 * `scripts/validate-bethesda.ts` fails when they disagree.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusFingerprint, discoverCorpus } from "../src/rain/corpus.ts";
import { formatAs } from "./prettier.ts";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = join(REPO, "src", "rain", "data");
const SOULS = [
  "JAMES_SOUL.md",
  "JASMINE_SOUL.md",
  "LUCA_SOUL.md",
  "ELENA_SOUL.md",
] as const;
const PERSPECTIVES = ["James", "Jasmine", "Luca", "Elena"] as const;

const args = process.argv.slice(2);
const fromIndex = args.indexOf("--from");
const from = fromIndex >= 0 ? args[fromIndex + 1] : undefined;
if (!from) {
  console.error(
    "usage: import-rain-source.ts --from <checkout of topherchris420/james_library>",
  );
  process.exit(2);
}
const source = resolve(from);
const git = (...argv: string[]) =>
  execFileSync("git", argv, { cwd: source, encoding: "utf8", timeout: 10_000 }).trim();
const commit = git("rev-parse", "HEAD");
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("the checkout's commit is unknown");
if (git("status", "--porcelain", "--untracked-files=no"))
  throw new Error("refusing to import from a checkout with uncommitted changes");
const commitDate = git("log", "-1", "--format=%cI", "HEAD");
const remote = (() => {
  try {
    return git("remote", "get-url", "origin");
  } catch {
    return "";
  }
})();
if (!/github\.com[/:]topherchris420\/james_library(\.git)?$/i.test(remote))
  throw new Error(`the checkout's origin is not topherchris420/james_library: ${remote}`);

const sha256 = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const papers = join(source, "papers");
const entries = readdirSync(papers)
  .filter((name) => statSync(join(papers, name)).isFile())
  .map((name) => ({ path: name }));
const files = discoverCorpus(entries).map(({ path }) => {
  const bytes = readFileSync(join(papers, path));
  const text = bytes.toString("utf8");
  if (Buffer.from(text, "utf8").compare(bytes) !== 0)
    throw new Error(`${path} is not valid UTF-8; the runtime hashes text, so it must be`);
  return { path, sha256: sha256(bytes), bytes: bytes.length, text };
});
if (!files.length) throw new Error("no corpus files found");
const souls = SOULS.map((file, i) => {
  const bytes = readFileSync(join(source, file));
  return {
    name: PERSPECTIVES[i]!,
    file,
    sha256: sha256(bytes),
    bytes: bytes.length,
    text: bytes.toString("utf8"),
  };
});
const license = readFileSync(join(source, "LICENSE"));

/** The bytes `name` will hold: its JSON as the repository's formatter writes it. */
const formatted = (name: string, value: unknown): string =>
  formatAs(join(OUT, name), JSON.stringify(value, null, 2) + "\n");

const corpusText = formatted("corpus.json", {
  schema: "rain-corpus/v1",
  license: "MIT",
  files,
});
const perspectivesText = formatted("perspectives.json", {
  schema: "rain-perspectives/v1",
  license: "MIT",
  souls,
});
const corpusSnapshot = sha256(corpusText);
const perspectivesSnapshot = sha256(perspectivesText);
const licenseText =
  "# License of the R.A.I.N. corpus and perspectives\n\n" +
  "`corpus.json` and `perspectives.json` are derived from `topherchris420/james_library`\n" +
  `at commit ${commit} (${commitDate}), which is published under the MIT License\n` +
  "reproduced below. The papers are quoted verbatim; the SOUL files are reproduced in\n" +
  "full. See `source.json` for the per-file hashes and the import time.\n\n```\n" +
  license.toString("utf8").trimEnd() +
  "\n```\n";
const manifest = {
  schema: "rain-source/v1",
  repository: "topherchris420/james_library",
  repositoryUrl: "https://github.com/topherchris420/james_library",
  commit,
  commitDate,
  importedAt: new Date().toISOString(),
  importer: "scripts/import-rain-source.ts",
  license: "MIT",
  licenseSha256: sha256(license),
  attribution: "Copyright (c) 2026 Vers3Dynamics",
  corpus: {
    directory: "papers",
    rules:
      "top-level .md and .txt files; names starting with _ and product-surface names (README, SOUL, LOG, MEETING, START_HERE, CONTRIBUTING, SECURITY, ARCHITECTURE, LICENSE) excluded; docs/ and assets/ never evidence",
    files: files.length,
    fingerprintSha256: corpusFingerprint(files),
    snapshotSha256: corpusSnapshot,
  },
  perspectives: {
    files: souls.map((s) => ({ name: s.name, file: s.file, sha256: s.sha256 })),
    snapshotSha256: perspectivesSnapshot,
  },
  notes: [
    "The corpus is the evidence R.A.I.N.'s offline engine quotes and the text a model meeting's quotations are verified against; each paper's text is stored in full so quotes carry their file, line and character span.",
    "The SOUL files are the four perspectives' identities and constraints, used as the system prompt of a model meeting and shown nowhere else.",
    "Nothing here is fetched at build or run time. Re-import with scripts/import-rain-source.ts from a clean checkout to update.",
  ],
};
const manifestText = formatted("source.json", manifest);
// Everything is formatted; now write. Each file goes to a temporary name and
// is renamed into place, data first and the manifest that names their hashes
// last, so no step can leave a derivative and the manifest disagreeing.
const outputs: [string, string][] = [
  ["corpus.json", corpusText],
  ["perspectives.json", perspectivesText],
  ["LICENSE.md", licenseText],
  ["source.json", manifestText],
];
for (const [name, text] of outputs) writeFileSync(join(OUT, `${name}.tmp`), text);
for (const [name] of outputs) renameSync(join(OUT, `${name}.tmp`), join(OUT, name));
console.log(
  `imported ${files.length} corpus files (fingerprint ${manifest.corpus.fingerprintSha256.slice(0, 16)}…) and ${souls.length} perspectives from james_library ${commit.slice(0, 12)}`,
);
