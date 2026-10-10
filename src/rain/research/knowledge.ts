/** Bounded, read-only research context; source text is data, never instructions. */
import corpus from "../data/corpus.json" with { type: "json" };
import origin from "../data/source.json" with { type: "json" };
import { sha256, sha256Json } from "../sha256.js";
import { MathematicalSubstrate } from "../mathematics/substrate.js";
import { bundledIndex } from "../mathematics/bundled.js";
import type { ResearchSource } from "../../bethesda/rain/researchProtocol.js";

const stop = new Set([
  "the",
  "and",
  "that",
  "with",
  "what",
  "does",
  "from",
  "this",
  "into",
  "which",
  "their",
  "under",
  "different",
]);
const terms = (s: string) =>
  [...new Set(s.toLowerCase().match(/[a-z]{3,}/g) ?? [])]
    .filter((t) => !stop.has(t))
    .slice(0, 30);
export function corpusContext(query: string, limit = 4): ResearchSource[] {
  const words = terms(query);
  return corpus.files
    .map((f) => {
      const lower = f.text.toLowerCase();
      const score = words.reduce(
        (n, t) =>
          n + (f.path.toLowerCase().includes(t) ? 4 : 0) + (lower.includes(t) ? 1 : 0),
        0,
      );
      const first =
        words
          .map((w) => lower.indexOf(w))
          .filter((i) => i >= 0)
          .sort((a, b) => a - b)[0] ?? 0;
      const start = Math.max(0, first - 120);
      return { f, score, start };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.f.path.localeCompare(b.f.path))
    .slice(0, Math.min(6, Math.max(1, limit)))
    .map(({ f, start }) => ({
      id: "P-" + f.sha256.slice(0, 20),
      kind: "corpus",
      title: f.path.replace(/\.md$/, ""),
      locator:
        origin.repositoryUrl +
        "/blob/" +
        origin.commit +
        "/papers/" +
        encodeURIComponent(f.path),
      sha256: f.sha256,
      excerpt: f.text.slice(start, start + 1800),
      reading_scope:
        "Pinned author-supplied manuscript excerpt; character range " +
        start +
        "–" +
        Math.min(start + 1800, f.text.length) +
        ". Not independent validation.",
      retrieved_at: origin.importedAt,
      authors: ["Christopher Woodyard"],
      year: null,
      doi: null,
    }));
}
export function mathematicsContext(query: string): ResearchSource[] {
  const math = MathematicalSubstrate.load(bundledIndex());
  const found = math.searchMathematics(
    {
      query: query.slice(0, 400),
      discipline: null,
      formalization: "any",
      limit: 3,
      mode: "context",
      hypothesis: null,
    },
    "research-program",
  );
  return found.results.map((r) => {
    const detail = math.inspectMathematicalResult(
      { family: r.family },
      "research-program",
    );
    const { retrieved_at: _retrieved, ...pinned } = found.provenance;
    const payload = { family: detail.family, provenance: pinned };
    const hash = sha256Json(payload);
    return {
      id: "M-" + hash.slice(0, 20),
      kind: "mathematics",
      title: detail.family.title,
      locator:
        found.provenance.repository_url +
        "/blob/" +
        found.provenance.commit +
        "/CONTENTS.md",
      sha256: hash,
      excerpt: (
        detail.family.summary.text +
        "\n" +
        detail.family.manuscripts.map((m) => m.abstract.text).join("\n")
      ).slice(0, 1800),
      reading_scope:
        "Pinned catalogue summary/abstract; status: " +
        detail.family.status +
        ". Applicability requires mapped assumptions; Lean was not executed.",
      retrieved_at: found.provenance.retrieved_at,
      authors: [],
      year: null,
      doi: null,
    };
  });
}
export interface LiteratureReceipt {
  provider: "crossref";
  query: string;
  url: string;
  retrieved_at: string;
  response_sha256: string;
  raw: string;
  sources: ResearchSource[];
}
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const plain = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        .replace(/<[^>]*>/g, " ")
        .replace(/\p{Cc}/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";
/** Crossref returns publisher-deposited metadata. An abstract is not full-text reading. */
export function parseCrossref(
  raw: string,
  query: string,
  url: string,
  at: string,
  limit: number,
): LiteratureReceipt {
  const message = obj(obj(JSON.parse(raw)).message);
  if (!Array.isArray(message.items)) throw new Error("Malformed Crossref response");
  const sources: ResearchSource[] = [];
  for (const value of message.items.slice(0, limit)) {
    const item = obj(value);
    const doi = plain(item.DOI, 240).toLowerCase();
    const title = Array.isArray(item.title) ? plain(item.title[0], 300) : "";
    if (!/^10\.\d{4,9}\/[^\s<>]+$/.test(doi) || !title) continue;
    const abstract = plain(item.abstract, 2400);
    const authors = Array.isArray(item.author)
      ? item.author
          .slice(0, 12)
          .map((a) => {
            const row = obj(a);
            return plain(
              [row.given, row.family].filter((v) => typeof v === "string").join(" "),
              140,
            );
          })
          .filter(Boolean)
      : [];
    const dates = obj(item.published)["date-parts"];
    const year =
      Array.isArray(dates) && Array.isArray(dates[0]) && Number.isInteger(dates[0][0])
        ? String(dates[0][0])
        : null;
    const hash = sha256Json({ doi, title, abstract, authors, year });
    sources.push({
      id: "L-" + hash.slice(0, 20),
      kind: "literature",
      title,
      locator: "https://doi.org/" + encodeURIComponent(doi),
      sha256: hash,
      excerpt: abstract || title,
      reading_scope: abstract
        ? "Publisher-deposited abstract and metadata only; full text not read."
        : "Bibliographic metadata only; no abstract or full text read.",
      retrieved_at: at,
      authors,
      year,
      doi,
    });
  }
  return {
    provider: "crossref",
    query,
    url,
    retrieved_at: at,
    response_sha256: sha256(raw),
    raw,
    sources,
  };
}
