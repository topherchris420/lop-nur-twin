import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_CORPUS_FILES,
  corpusFingerprint,
  discoverCorpus,
  documentMap,
  findQuoteSpan,
  hashCorpusDocuments,
  isCorpusPath,
  isProductSurfaceName,
  verifyQuote,
} from "./corpus.js";

/**
 * Corpus boundary and citation spans, ported from R.A.I.N.'s
 * `tests/test_citation_corpus.py`: product markdown is not evidence, and a
 * quote verifies only as a whole.
 */
const UNIQUE = "Zed corpus token alpha refuses readme substitution in this sentence.";
const PREFIX = UNIQUE.split(" ").slice(0, 5).join(" ");
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("corpus discovery", () => {
  it("README, SOUL, START_HERE, docs/ and assets/ are product surface, not papers", () => {
    const entries = [
      "README.md",
      "JAMES_SOUL.md",
      "docs/pitch.md",
      "START_HERE.md",
      "note.md",
      "_draft.md",
      "assets/figure.md",
      "data.csv",
      "Notes.TXT",
    ].map((path) => ({ path, text: "" }));
    expect(discoverCorpus(entries).map((e) => e.path)).toEqual(["Notes.TXT", "note.md"]);
    expect(
      discoverCorpus(entries, { includeProductSurface: true }).map((e) => e.path),
    ).toEqual(["JAMES_SOUL.md", "Notes.TXT", "README.md", "START_HERE.md", "note.md"]);
    for (const path of ["docs/pitch.md", "_draft.md", "assets/figure.md", "data.csv"])
      expect(isCorpusPath(path), path).toBe(false);
  });

  it("names product files by R.A.I.N.'s markers and prefixes", () => {
    for (const name of [
      "README.md",
      "readme.txt",
      "JAMES_SOUL.md",
      "RAIN_LAB_MEETING_LOG.md",
      "LICENSE.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "ARCHITECTURE.md",
      "START_HERE.md",
    ])
      expect(isProductSurfaceName(name), name).toBe(true);
    for (const name of ["note.md", "Coupled Oscillators.md", "phase-coherence.md"])
      expect(isProductSurfaceName(name), name).toBe(false);
  });

  it("caps the corpus as R.A.I.N. does", () => {
    const many = Array.from({ length: MAX_CORPUS_FILES + 25 }, (_, i) => ({
      path: `paper-${String(i).padStart(4, "0")}.md`,
      text: "",
    }));
    expect(discoverCorpus(many)).toHaveLength(MAX_CORPUS_FILES);
    expect(discoverCorpus(many, { maxFiles: 3 }).map((e) => e.path)).toEqual([
      "paper-0000.md",
      "paper-0001.md",
      "paper-0002.md",
    ]);
  });
});

describe("quote spans", () => {
  it("a quote in a designated paper verifies with its source and span", () => {
    const body = `Intro paragraph.\n\n${UNIQUE}\n\nClosing.`;
    const docs = documentMap([{ path: "note.md", text: body }]);
    const match = verifyQuote(docs, UNIQUE);
    expect(match).not.toBeNull();
    expect(match!.source).toBe("note.md");
    expect(body.slice(match!.spanStart, match!.spanEnd)).toBe(UNIQUE);
    // A longer sentence that only shares a five-word prefix must not verify.
    expect(
      verifyQuote(docs, `${PREFIX} not present anywhere in the corpus file`),
    ).toBeNull();
  });

  it("a README-only sentence is not a verified citation", () => {
    const entries = discoverCorpus([
      { path: "README.md", text: `# Product\n\n${UNIQUE}\n` },
      { path: "docs/pitch.md", text: `marketing copy ${UNIQUE}` },
      { path: "START_HERE.md", text: "start here is not a paper" },
    ]);
    expect(entries).toEqual([]);
    expect(verifyQuote(documentMap(entries), UNIQUE)).toBeNull();
  });

  it("whitespace and case still require the full quote", () => {
    const text =
      "Prefix Zed   Corpus Token alpha refuses readme substitution in this sentence. Suffix";
    const match = verifyQuote(
      documentMap([{ path: "note.md", text }]),
      UNIQUE.toLowerCase(),
    );
    expect(match).not.toBeNull();
    const snippet = text.slice(match!.spanStart, match!.spanEnd);
    expect(snippet.split(/\s+/).join(" ").toLowerCase()).toBe(UNIQUE.toLowerCase());
  });

  it("short quotes never match, and the first document in path order names the source", () => {
    expect(findQuoteSpan("one two three four", "two three")).toBeNull();
    expect(findQuoteSpan("one two three four", "two three four")).toEqual([4, 18]);
    const docs = documentMap([
      { path: "b.md", text: UNIQUE },
      { path: "a.md", text: `x ${UNIQUE}` },
    ]);
    expect(verifyQuote(docs, UNIQUE)?.source).toBe("a.md");
  });
});

describe("corpus fingerprint", () => {
  it("hashes documents in path order and fingerprints path, NUL, sha, newline per file", () => {
    const docs = [
      { path: "b.md", text: "beta" },
      { path: "a.md", text: "alpha" },
    ];
    const rows = hashCorpusDocuments(docs);
    expect(rows).toEqual([
      { path: "a.md", sha256: sha("alpha") },
      { path: "b.md", sha256: sha("beta") },
    ]);
    expect(corpusFingerprint(rows)).toBe(
      sha(`a.md\0${sha("alpha")}\nb.md\0${sha("beta")}\n`),
    );
  });
});
