/**
 * The mathematical substrate's index: build it, verify it, inspect it, search it.
 *
 *   node scripts/run-ts.mjs scripts/math-substrate.ts index --from <checkout of openai/math>
 *   node scripts/run-ts.mjs scripts/math-substrate.ts verify [--from <checkout>]
 *   node scripts/run-ts.mjs scripts/math-substrate.ts inspect <family>
 *   node scripts/run-ts.mjs scripts/math-substrate.ts search <query> [--discipline <name>]
 *        [--formalization required|preferred|any] [--limit N] [--challenge <hypothesis>]
 *
 * `index` reads a clean checkout of `openai/math` — it refuses one with
 * uncommitted changes, one whose commit it cannot name, and one whose origin
 * is another repository — runs the deterministic indexer
 * (`src/rain/mathematics/indexer.ts`) over the repository's own catalogue
 * files, and writes `src/rain/mathematics/data/openai-math.json` with the
 * commit, the real generation time and the content hash, and
 * `data/LICENSE.md` with the repository's licence verbatim. Nothing is
 * fetched: the checkout is the source, and no PDF, LaTeX or Lean file is
 * copied. Never hand-edit the index; re-index instead.
 *
 * `verify` checks the bundled index (its schema, its paths, its statuses,
 * its counts and its content hash) and the licence beside it; with `--from`
 * it also re-indexes the checkout and requires the same content hash, which
 * proves the index is what that commit's catalogue says.
 *
 * `inspect` and `search` answer exactly as the runtime's substrate does, from
 * the bundled index, so what the lab shows can be checked from a terminal.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, type SourceTree } from "../src/rain/mathematics/indexer.ts";
import {
  indexErrors,
  type SubstrateIndex,
} from "../src/rain/mathematics/substrateIndex.ts";
import { MathematicalSubstrate } from "../src/rain/mathematics/substrate.ts";
import {
  FORMALIZATION_FILTERS,
  RELATION_WORDS,
  STATUS_WORDS,
  findingText,
  pinnedUrl,
  type FormalizationFilter,
} from "../src/rain/mathematics/contracts.ts";
import { sha256 } from "../src/rain/sha256.ts";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DATA = join(REPO, "src", "rain", "mathematics", "data");
const INDEX = join(DATA, "openai-math.json");
const LICENSE = join(DATA, "LICENSE.md");
const GENERATOR = "scripts/math-substrate.ts index";

// Run through `scripts/run-ts.mjs`, or directly by Bun: the arguments follow this script's path.
const self = process.argv.findIndex((a) => a.endsWith("math-substrate.ts"));
const [command, ...args] = process.argv.slice(self + 1);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const die = (message: string, code = 1): never => {
  console.error(`math-substrate: ${message}`);
  process.exit(code);
};

/** A checkout as the indexer sees it. Every path stays inside it, and text must be UTF-8. */
function checkoutTree(root: string): SourceTree {
  const inside = (path: string) => {
    const full = resolve(root, path);
    if (full !== root && !full.startsWith(root + sep)) die(`${path} leaves the checkout`);
    return full;
  };
  return {
    read(path) {
      let bytes: Buffer;
      try {
        bytes = readFileSync(inside(path));
      } catch {
        return null;
      }
      const text = bytes.toString("utf8");
      if (Buffer.from(text, "utf8").compare(bytes) !== 0)
        die(`${path} is not valid UTF-8; the index hashes text, so it must be`);
      return text;
    },
    exists(path) {
      try {
        return statSync(inside(path)).isFile();
      } catch {
        return false;
      }
    },
  };
}

/** The checkout's commit and date, refusing anything that is not a clean openai/math. */
function pinned(root: string) {
  const git = (...argv: string[]) =>
    execFileSync("git", argv, { cwd: root, encoding: "utf8", timeout: 120_000 }).trim();
  const commit = git("rev-parse", "HEAD");
  if (!/^[0-9a-f]{40}$/.test(commit)) die("the checkout's commit is unknown");
  if (git("status", "--porcelain", "--untracked-files=no"))
    die("refusing to index a checkout with uncommitted changes");
  const origin = (() => {
    try {
      return git("remote", "get-url", "origin");
    } catch {
      return "";
    }
  })();
  if (!/github\.com[/:]openai\/math(\.git)?$/i.test(origin))
    die(`the checkout's origin is not openai/math: ${origin || "none"}`);
  return { commit, commitDate: git("log", "-1", "--format=%cI", "HEAD") };
}

function writeFormatted(path: string, text: string) {
  writeFileSync(path, text);
  execFileSync(join(REPO, "node_modules", ".bin", "prettier"), ["--write", path], {
    stdio: "ignore",
  });
}

function bundled(): SubstrateIndex {
  return JSON.parse(readFileSync(INDEX, "utf8")) as SubstrateIndex;
}

/** The licence file beside the index: its fenced text must be the licence the index hashed. */
function licenseErrors(index: SubstrateIndex): string[] {
  const text = readFileSync(LICENSE, "utf8");
  const fenced = /```\n([\s\S]*?)```/.exec(text)?.[1] ?? "";
  return sha256(fenced) === index.license.sha256
    ? []
    : ["data/LICENSE.md does not carry the licence the index names"];
}

if (command === "index") {
  const from =
    option("--from") ?? die("usage: index --from <checkout of openai/math>", 2);
  const root = resolve(from);
  const { commit, commitDate } = pinned(root);
  const tree = checkoutTree(root);
  const index = buildIndex({
    tree,
    commit,
    commitDate,
    generatedAt: new Date().toISOString(),
    generator: GENERATOR,
  });
  const errors = indexErrors(index);
  if (errors.length) die("the new index fails its own checks:\n  " + errors.join("\n  "));
  const license = tree.read("LICENSE")!;
  writeFormatted(INDEX, JSON.stringify(index, null, 2) + "\n");
  writeFormatted(
    LICENSE,
    "# License of the mathematical substrate index\n\n" +
      "`openai-math.json` is derived from the catalogue of `openai/math`\n" +
      `(${index.repository_url}) at commit ${commit} (${commitDate}): titles, summaries,\n` +
      "abstracts, citations and attribution notes as the repository's own files give them, the\n" +
      "Lean scope pages' text and the comparator configs' declaration names, reformatted into\n" +
      "JSON. No manuscript, LaTeX source, Lean source or reasoning-summary PDF is copied. The\n" +
      "repository is published under the Apache License, Version 2.0, reproduced below; see\n" +
      "`openai-math.json` for the per-file hashes and the generation time.\n\n```\n" +
      license +
      "```\n",
  );
  const c = index.counts;
  console.log(
    `indexed ${c.families} families, ${c.manuscripts} manuscripts, ${c.formalizations} Lean scope pages (${c.statements} comparator statements) and ${c.reasoning_summaries} reasoning summaries in ${c.disciplines} disciplines from openai/math ${commit.slice(0, 12)}; content ${index.content_sha256.slice(0, 16)}…`,
  );
  if (c.unverified_families || c.unverified_manuscripts || c.rejected)
    console.log(
      `  ${c.unverified_families} families and ${c.unverified_manuscripts} manuscripts are unverified; ${c.rejected} catalogue entries were refused:`,
      JSON.stringify(index.rejected.slice(0, 10)),
    );
} else if (command === "verify") {
  const index = bundled();
  const errors = [...indexErrors(index), ...licenseErrors(index)];
  const from = option("--from");
  if (from && !errors.length) {
    const root = resolve(from);
    const { commit, commitDate } = pinned(root);
    if (commit !== index.commit)
      errors.push(
        `the checkout is at ${commit.slice(0, 12)}; the index is pinned to ${index.commit.slice(0, 12)}`,
      );
    else {
      const again = buildIndex({
        tree: checkoutTree(root),
        commit,
        commitDate,
        generatedAt: index.generated_at,
        generator: index.generator,
      });
      if (again.content_sha256 !== index.content_sha256)
        errors.push("re-indexing the pinned commit gives different content");
    }
  }
  if (errors.length) die("verification failed:\n  " + errors.join("\n  "));
  console.log(
    `verified the substrate index: openai/math ${index.commit.slice(0, 12)}, ${index.counts.families} families, content ${index.content_sha256.slice(0, 16)}…${from ? ", reproduced from the checkout" : ""}`,
  );
} else if (command === "inspect") {
  const substrate = MathematicalSubstrate.load(bundled());
  const id = args[0] ?? die("usage: inspect <family>", 2);
  const answer = substrate.inspectMathematicalResult({ family: id }, "cli");
  const f = answer.family;
  const p = answer.provenance;
  const repo = substrate.index.repository;
  console.log(`${f.id}. ${f.title}`);
  console.log(
    `  ${f.discipline?.name ?? "no discipline"} · ${STATUS_WORDS[f.status].label}`,
  );
  console.log(`  ${f.summary.text}${f.summary.truncated ? " […]" : ""}`);
  for (const m of f.manuscripts) {
    console.log(`  - ${m.title} [${STATUS_WORDS[m.status].label}]`);
    console.log(`    ${pinnedUrl(repo, p.commit, m.path)}`);
    for (const n of m.notes) console.log(`    note: ${n}`);
  }
  if (f.formalization) {
    console.log(`  Lean: ${pinnedUrl(repo, p.commit, f.formalization.path)}`);
    for (const s of f.formalization.statements)
      console.log(`    ${s.result}: ${s.theorems.join(", ")} (${s.statement_path})`);
    console.log(
      `    catalogue review status: ${f.formalization.review_status ?? "not stated"}`,
    );
  }
  if (f.reasoning_summary)
    console.log(
      `  Reasoning summary (not a proof): ${pinnedUrl(repo, p.commit, f.reasoning_summary.path)}`,
    );
  console.log(`  ${p.repository} ${p.commit} · index ${p.index_sha256.slice(0, 16)}…`);
} else if (command === "search") {
  const substrate = MathematicalSubstrate.load(bundled());
  const query = args[0] ?? die("usage: search <query> [options]", 2);
  const formalization = (option("--formalization") ?? "any") as FormalizationFilter;
  if (!FORMALIZATION_FILTERS.includes(formalization))
    die("--formalization is required, preferred or any", 2);
  const hypothesis = option("--challenge") ?? null;
  const answer = substrate.searchMathematics(
    {
      query,
      discipline: option("--discipline") ?? null,
      formalization,
      limit: Number(option("--limit") ?? 5),
      mode: hypothesis ? "challenge" : "context",
      hypothesis,
    },
    "cli",
  );
  for (const r of answer.results)
    console.log(
      `${r.rank}. ${r.family} ${r.title} — ${r.discipline?.name ?? "no discipline"} · ${STATUS_WORDS[r.status].label}${r.group ? ` · ${r.group}` : ""}\n   shares: ${r.matched.map((m) => `${m.term} (${m.fields.join(", ")})`).join("; ")}`,
    );
  for (const f of answer.findings) console.log(`• ${findingText(f)}`);
  console.log(
    `  ${answer.provenance.repository} ${answer.provenance.commit.slice(0, 12)} · index ${answer.provenance.index_sha256.slice(0, 16)}… · relation: ${RELATION_WORDS.insufficient_context.label} until a person states one`,
  );
} else die("usage: math-substrate.ts index|verify|inspect|search …", 2);
