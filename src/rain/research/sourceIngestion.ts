/** Explicitly supplied UTF-8 documents only; this module never discovers or reads files. */
import { sha256, sha256Json } from "../sha256.js";
import { checkData, closed } from "../../bethesda/rain/discoveryProtocol.js";
import { UNSAFE_TEXT } from "../../bethesda/rain/contracts.js";
import type { ResearchSource } from "../../bethesda/rain/researchProtocol.js";
import type { ResearchStore } from "../autonomy/store.js";
export interface SourceManifest {
  schema: "rain-approved-source/v1";
  collection: string;
  version: number;
  previous_sha256: string | null;
  title: string;
  creator: string;
  category:
    | "paper"
    | "engineering"
    | "poetry"
    | "music-description"
    | "art-description"
    | "philosophy"
    | "approved-discussion";
  document_sha256: string;
  document_bytes: number;
  excerpt_start: number;
  excerpt_end: number;
  excerpt_sha256: string;
  consent: "operator-supplied-for-research";
}
export interface ApprovedSourceVersion {
  manifest: SourceManifest;
  manifest_sha256: string;
  source: ResearchSource;
}
const text = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const integer = (minimum: number, maximum: number) => ({
  type: "integer",
  minimum,
  maximum,
});
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const schema = closed({
  schema: { const: "rain-approved-source/v1" },
  collection: { ...text(64), pattern: "^[a-z][a-z0-9-]*$" },
  version: integer(1, 1000000),
  previous_sha256: { type: ["string", "null"], pattern: "^[a-f0-9]{64}$" },
  title: text(200),
  creator: text(200),
  category: {
    enum: [
      "paper",
      "engineering",
      "poetry",
      "music-description",
      "art-description",
      "philosophy",
      "approved-discussion",
    ],
  },
  document_sha256: digest,
  document_bytes: integer(1, 1048576),
  excerpt_start: integer(0, 1048576),
  excerpt_end: integer(1, 1048576),
  excerpt_sha256: digest,
  consent: { const: "operator-supplied-for-research" },
});
function sourceFor(manifest: SourceManifest, excerpt: string): ResearchSource {
  const hash = sha256Json(manifest);
  return {
    id: "OS-" + hash.slice(0, 24),
    kind: "operator",
    title: manifest.title,
    locator: `operator-supplied:${manifest.collection}@${manifest.version}`,
    sha256: hash,
    excerpt,
    reading_scope: `Approved supplied excerpt, UTF-16 range [${manifest.excerpt_start}, ${manifest.excerpt_end}); document SHA-256 ${manifest.document_sha256}. Creator attribution is operator supplied, not independently verified.`,
    retrieved_at: null,
    authors: [manifest.creator],
    year: null,
    doi: null,
  };
}
export function prepareSourceVersion(
  document: string,
  metadata: Pick<
    SourceManifest,
    "collection" | "version" | "previous_sha256" | "title" | "creator" | "category"
  >,
  start = 0,
  end = Math.min(document.length, 4000),
): ApprovedSourceVersion {
  const excerpt = document.slice(start, end);
  const manifest: SourceManifest = {
    schema: "rain-approved-source/v1",
    ...metadata,
    document_sha256: sha256(document),
    document_bytes: new TextEncoder().encode(document).length,
    excerpt_start: start,
    excerpt_end: end,
    excerpt_sha256: sha256(excerpt),
    consent: "operator-supplied-for-research",
  };
  const checked = checkData<SourceManifest>(manifest, schema);
  if (
    !checked.ok ||
    !excerpt.trim() ||
    end <= start ||
    end > document.length ||
    end - start > 4000 ||
    UNSAFE_TEXT.test(excerpt)
  )
    throw new Error(
      "Invalid source manifest or excerpt; supply at most one MiB of UTF-8 text and a visible excerpt of at most 4000 characters",
    );
  return {
    manifest,
    manifest_sha256: sha256Json(manifest),
    source: sourceFor(manifest, excerpt),
  };
}
export function admitSourceVersion(
  store: ResearchStore,
  version: ApprovedSourceVersion,
  reviewedDigest: string,
  operator: string,
) {
  if (
    !checkData(version.manifest, schema).ok ||
    !/^[a-zA-Z0-9_.-]{1,80}$/.test(operator) ||
    reviewedDigest !== version.manifest_sha256 ||
    sha256Json(version.manifest) !== reviewedDigest ||
    sha256(version.source.excerpt) !== version.manifest.excerpt_sha256 ||
    sha256Json(version.source) !==
      sha256Json(sourceFor(version.manifest, version.source.excerpt)) ||
    !version.source.excerpt.trim() ||
    version.source.excerpt.length > 4000 ||
    version.source.excerpt.length !==
      version.manifest.excerpt_end - version.manifest.excerpt_start
  )
    throw new Error("Exact source-manifest approval required");
  const release = store.acquireLock("source-ingestion");
  try {
    const prior = store
      .discoveryEntries()
      .filter((e) => e.kind === "operator-source-version")
      .map((e) => e.payload as ApprovedSourceVersion)
      .filter((v) => v.manifest.collection === version.manifest.collection);
    const head = prior.at(-1);
    if (
      version.manifest.version !== (head?.manifest.version ?? 0) + 1 ||
      version.manifest.previous_sha256 !== (head?.manifest_sha256 ?? null)
    )
      throw new Error("Source revision must extend the exact current version");
    store.appendDiscovery("operator", "operator-source-version", {
      ...version,
      operator,
      approved_at: new Date().toISOString(),
    });
    return version.source;
  } finally {
    release();
  }
}
