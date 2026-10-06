/**
 * The citation corpus: which texts may count as evidence, and exact quote spans.
 *
 * A port of R.A.I.N.'s `citation_corpus` (james_library, MIT), kept to its
 * rules: product markdown (README, SOUL and LOG files, docs/, assets/) is not
 * evidence; a quote verifies only when its full whitespace-collapsed,
 * case-folded text occurs in one corpus document; a quote shorter than three
 * words never verifies; a five-word prefix of a longer quote does not match.
 *
 * The runtime's corpus is bundled data (`data/corpus.json`): the same rules
 * are applied to its entries, and the importer that produced it applied them
 * to the source checkout's `papers/` directory, so the two cannot disagree
 * about what a paper is.
 *
 * Shared with the server: imports siblings as `./x.js`, nothing else.
 */
import { sha256 } from "./sha256.js";
import { isSpace, pySplit } from "./text.js";

export const MIN_QUOTE_WORDS = 3;
const BLOCKED_DIR_NAMES = new Set(["docs", "assets"]);
const PRODUCT_NAME_MARKERS = ["SOUL", "LOG", "MEETING"];
const PRODUCT_NAME_PREFIXES = [
  "readme",
  "start_here",
  "contributing",
  "security",
  "architecture",
  "license",
];
export const MAX_CORPUS_FILES = 400;

/** One corpus document: its corpus-relative path and its full text. */
export interface CorpusDocument {
  path: string;
  text: string;
}
export interface CitationMatch {
  source: string;
  spanStart: number;
  spanEnd: number;
}

/** README, SOUL, LOG, LICENSE and the other product filenames. */
export function isProductSurfaceName(name: string): boolean {
  const upper = name.toUpperCase();
  const lower = name.toLowerCase();
  if (PRODUCT_NAME_MARKERS.some((marker) => upper.includes(marker))) return true;
  return PRODUCT_NAME_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Whether a corpus-relative path names a paper: a top-level `.md` or `.txt`
 * file whose name does not start with `_`, is not product surface, and sits
 * in no `docs/` or `assets/` directory.
 */
export function isCorpusPath(
  path: string,
  options: { includeProductSurface?: boolean } = {},
) {
  const parts = path.split("/");
  const name = parts[parts.length - 1]!;
  if (!name || name.startsWith("_")) return false;
  if (parts.slice(0, -1).some((part) => BLOCKED_DIR_NAMES.has(part.toLowerCase())))
    return false;
  if (!options.includeProductSurface && isProductSurfaceName(name)) return false;
  const lower = name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".txt");
}

/** The entries that count as papers, sorted by path and capped, as R.A.I.N. lists a directory. */
export function discoverCorpus<T extends { path: string }>(
  entries: readonly T[],
  options: { includeProductSurface?: boolean; maxFiles?: number } = {},
): T[] {
  const found = entries
    .filter((entry) => isCorpusPath(entry.path, options))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const max = options.maxFiles ?? MAX_CORPUS_FILES;
  return max >= 0 ? found.slice(0, max) : found;
}

/** Collapse whitespace to single spaces, case-fold, and map each kept character to its origin. */
function normalizeWithOrigins(text: string): { normalized: string; origins: number[] } {
  const chars: string[] = [];
  const origins: number[] = [];
  let pendingSpace = false;
  let started = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (isSpace(char)) {
      if (started) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      chars.push(" ");
      origins.push(index);
      pendingSpace = false;
    }
    chars.push(char.toLowerCase());
    origins.push(index);
    started = true;
  }
  return { normalized: chars.join(""), origins };
}

/**
 * `[start, end)` in `content` for the full quote, or null. Matching is
 * case-insensitive and collapses whitespace; the indexes refer to the
 * original text. A quote under three words never matches.
 */
export function findQuoteSpan(content: string, quote: string): [number, number] | null {
  const normalizedQuote = pySplit(quote).join(" ").toLowerCase();
  if (normalizedQuote.split(" ").filter(Boolean).length < MIN_QUOTE_WORDS) return null;
  const { normalized, origins } = normalizeWithOrigins(content);
  const index = normalized.indexOf(normalizedQuote);
  if (index < 0) return null;
  const start = origins[index]!;
  const end = origins[index + normalizedQuote.length - 1]! + 1;
  return [start, end];
}

/** Find `quote` in the documents, by path order; the first hit names the source. */
export function verifyQuote(
  documents: ReadonlyMap<string, string>,
  quote: string,
): CitationMatch | null {
  for (const source of [...documents.keys()].sort()) {
    const span = findQuoteSpan(documents.get(source)!, quote);
    if (span === null) continue;
    return { source, spanStart: span[0], spanEnd: span[1] };
  }
  return null;
}

/** SHA-256 of each document's UTF-8 bytes, sorted by path. */
export function hashCorpusDocuments(documents: readonly CorpusDocument[]) {
  return documents
    .map((d) => ({ path: d.path, sha256: sha256(d.text) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** R.A.I.N.'s corpus fingerprint: SHA-256 over `path\0sha256\n` per document. */
export function corpusFingerprint(
  rows: readonly { path: string; sha256: string }[],
): string {
  return sha256(rows.map((row) => `${row.path}\0${row.sha256}\n`).join(""));
}

/** The documents as a map, in path order, for `verifyQuote`. */
export function documentMap(documents: readonly CorpusDocument[]): Map<string, string> {
  return new Map(documents.map((d) => [d.path, d.text]));
}
