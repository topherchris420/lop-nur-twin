/**
 * A substrate index: the shape `scripts/math-substrate.ts index` writes, its
 * content hash, and the checks every reader applies before trusting one.
 *
 * The index is derived from a repository's own catalogue files at one commit
 * — for `openai/math`: `CONTENTS.md`, `overview.tex`, `README.md`,
 * `lean/formalization.yaml`, the Lean scope pages and comparator configs, and
 * each manuscript's README — and holds metadata and the repository's own
 * summaries and abstracts, verbatim. It holds no manuscript, no LaTeX source,
 * no Lean source and no reasoning-summary PDF: those stay in the repository,
 * named by path at the pinned commit.
 *
 * The content hash covers everything except when and by what the index was
 * generated, so indexing the same commit twice gives the same hash: the hash
 * names the content, `generated_at` says when it was made.
 *
 * Shared by the indexer, the runtime's substrate and the build's validator.
 * Imports only the runtime's pure modules.
 */
import { canonicalJson, sha256 } from "../sha256.js";
import {
  COMMIT_SHA,
  MATHEMATICAL_STATUSES,
  RESULT_KINDS,
  SAFE_RELATIVE_PATH,
  SHA256_HEX,
  SUBSTRATES,
  SUBSTRATE_INDEX_SCHEMA,
  isSubstrate,
  type MathematicalStatus,
  type ResultKind,
  type SubstrateRepository,
} from "./contracts.js";

export interface KindBasis {
  kind: ResultKind;
  /** Where the words were found: the family's title or summary, or a manuscript's title. */
  field: "title" | "summary" | "manuscript-title";
  /** The matched words, exactly as written there. */
  phrase: string;
}
export interface IndexedCitation {
  /** The BibTeX key and fields, as the manuscript's README writes them. */
  key: string;
  author: string;
  title: string;
  year: string;
  url: string | null;
}
export interface IndexedManuscript {
  /** The preprint directory, which names the manuscript. */
  id: string;
  title: string;
  /** Repository-relative path of the PDF at the pinned commit. Named, never opened. */
  path: string;
  /** Words the catalogue appends to the link, such as "secondary writeup". */
  annotation: string | null;
  /** The abstract as the catalogue's manuscript map gives it, verbatim. */
  abstract: string;
  /** The date as the manuscript's README writes it. */
  date: string | null;
  citation: IndexedCitation | null;
  /** Anything else the README says before its citation — attribution is never flattened. */
  notes: string[];
  readme_sha256: string | null;
  status: MathematicalStatus;
  /** Listed in the formalization catalogue as a paper with a formalized main result. */
  main_result_catalogued: boolean;
  issues: string[];
}
export interface IndexedStatement {
  /** The result as the scope page's comparator table names it. */
  result: string;
  statement_path: string;
  config_path: string;
  config_sha256: string;
  theorems: string[];
  definitions: string[];
  solution_module: string;
  solution_path: string;
  /** Whether the solution module's file exists at the commit (its bytes are not read). */
  solution_present: boolean;
  permitted_axioms: string[];
  /** Listed among the formalization catalogue's main results. */
  catalogued_main_result: boolean;
}
export interface IndexedFormalization {
  /** The family's Lean scope page. */
  path: string;
  sha256: string;
  title: string;
  /** The manuscripts the scope page says the formalization accompanies. */
  papers: string[];
  /** The scope page's own account of what is formalized and what is not, verbatim. */
  scope: string;
  statements: IndexedStatement[];
}
export interface IndexedReasoningSummary {
  path: string;
  /** The subject as the repository's README lists it. */
  subject: string;
  status: "reasoning-summary";
}
export interface IndexedFamily {
  id: string;
  title: string;
  /** The family's title in the catalogue overview, which can be shorter. */
  overview_title: string | null;
  discipline: { id: number; name: string } | null;
  summary: string;
  kinds: ResultKind[];
  kind_basis: KindBasis[];
  status: MathematicalStatus;
  manuscripts: IndexedManuscript[];
  formalization: IndexedFormalization | null;
  reasoning_summary: IndexedReasoningSummary | null;
  issues: string[];
}
export interface IndexedSource {
  path: string;
  sha256: string;
}
export interface SubstrateIndex {
  schema: typeof SUBSTRATE_INDEX_SCHEMA;
  repository: SubstrateRepository;
  repository_url: string;
  commit: string;
  commit_date: string | null;
  /** When the index was generated. Not part of the content hash. */
  generated_at: string;
  /** What generated it. Not part of the content hash. */
  generator: string;
  /** SHA-256 over the canonical content (everything but the three fields above). */
  content_sha256: string;
  license: { spdx: string; path: string; sha256: string };
  /** What the repository says about the collection as a whole, verbatim. */
  collection: {
    path: string;
    sha256: string;
    sections: { heading: string; text: string }[];
  };
  catalogue: {
    sources: IndexedSource[];
    formalization_version: string | null;
    formalization_scope: string | null;
    review_status: string | null;
    automation: string[];
    /** The libraries the Lean formalizations build on, as the catalogue lists them. Never fetched. */
    related_formalizations: { id: string; relationship: string }[];
  };
  counts: {
    disciplines: number;
    families: number;
    manuscripts: number;
    formalizations: number;
    statements: number;
    reasoning_summaries: number;
    unverified_families: number;
    unverified_manuscripts: number;
    rejected: number;
  };
  disciplines: { id: number; name: string; families: number }[];
  families: IndexedFamily[];
  /** Catalogue entries the indexer refused, and why. Never searchable, never citable. */
  rejected: { where: string; reason: string }[];
}

const UNHASHED = ["generated_at", "generator", "content_sha256"] as const;
/** The content hash: the index without when, by what, and its own hash. */
export function contentSha256(
  index: Omit<SubstrateIndex, (typeof UNHASHED)[number]> | SubstrateIndex,
) {
  const body: Record<string, unknown> = { ...index };
  for (const k of UNHASHED) delete body[k];
  return sha256(canonicalJson(body));
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown, max = 100_000) => typeof v === "string" && v.length <= max;

/**
 * Every reason not to trust an index; empty when it may be read. Checks the
 * schema, the repository's identifier and path rules, sorting and uniqueness,
 * that each status agrees with what the index holds, the counts and the
 * content hash. Fails closed: a reader that finds anything here uses nothing.
 */
export function indexErrors(raw: unknown): string[] {
  const errors: string[] = [];
  const fail = (why: string) => {
    if (errors.length < 50) errors.push(why);
  };
  if (!isObject(raw)) return ["the index is not an object"];
  const ix = raw as unknown as SubstrateIndex;
  if (ix.schema !== SUBSTRATE_INDEX_SCHEMA)
    fail(`schema is not ${SUBSTRATE_INDEX_SCHEMA}`);
  if (!isSubstrate(ix.repository)) {
    fail("the repository is not a known substrate");
    return errors;
  }
  const rules = SUBSTRATES[ix.repository];
  if (ix.repository_url !== rules.url) fail("the repository URL is not the substrate's");
  if (typeof ix.commit !== "string" || !COMMIT_SHA.test(ix.commit))
    fail("the commit is not a 40-hex SHA: an index must be pinned to one commit");
  if (typeof ix.content_sha256 !== "string" || !SHA256_HEX.test(ix.content_sha256))
    fail("the content hash is malformed");
  if (typeof ix.generated_at !== "string" || Number.isNaN(Date.parse(ix.generated_at)))
    fail("the generation time is not a timestamp");
  if (
    !Array.isArray(ix.families) ||
    !Array.isArray(ix.disciplines) ||
    !Array.isArray(ix.rejected)
  )
    return [...errors, "families, disciplines and rejected must be lists"];
  const familyIds = new Set<string>();
  const manuscriptIds = new Set<string>();
  const paths = new Set<string>();
  let previous = "";
  let manuscripts = 0,
    formalizations = 0,
    statements = 0,
    summaries = 0,
    unverifiedFamilies = 0,
    unverifiedManuscripts = 0;
  for (const f of ix.families) {
    if (!isObject(f)) {
      fail("a family is not an object");
      continue;
    }
    const at = `family ${String(f.id).slice(0, 8)}`;
    if (typeof f.id !== "string" || !rules.family.test(f.id)) fail(`${at}: malformed id`);
    if (familyIds.has(f.id)) fail(`${at}: duplicate family`);
    familyIds.add(f.id);
    if (f.id <= previous) fail(`${at}: families are not sorted by id`);
    previous = f.id;
    if (!isText(f.title, 2000) || !f.title) fail(`${at}: missing title`);
    if (!isText(f.summary, 20_000)) fail(`${at}: malformed summary`);
    if (!MATHEMATICAL_STATUSES.includes(f.status) || f.status === "reasoning-summary")
      fail(`${at}: a family's status is formalized, manuscript or unverified`);
    if (
      !Array.isArray(f.kinds) ||
      !f.kinds.length ||
      f.kinds.some((k) => !RESULT_KINDS.includes(k))
    )
      fail(`${at}: malformed kinds`);
    if (!Array.isArray(f.issues) || !Array.isArray(f.manuscripts)) {
      fail(`${at}: malformed lists`);
      continue;
    }
    const expected: MathematicalStatus = f.issues.length
      ? "unverified"
      : f.formalization
        ? "formalized"
        : "manuscript";
    if (f.status !== expected)
      fail(
        `${at}: status ${f.status} does not follow from what the index holds (${expected})`,
      );
    if (f.status === "unverified") unverifiedFamilies++;
    if (
      f.discipline !== null &&
      (!isObject(f.discipline) || !Number.isInteger(f.discipline.id))
    )
      fail(`${at}: malformed discipline`);
    for (const m of f.manuscripts) {
      manuscripts++;
      const mat = `${at} manuscript ${String(m?.id).slice(0, 40)}`;
      if (!isObject(m) || typeof m.id !== "string" || !rules.manuscript.test(m.id)) {
        fail(`${mat}: malformed id`);
        continue;
      }
      if (manuscriptIds.has(m.id)) fail(`${mat}: duplicate manuscript`);
      manuscriptIds.add(m.id);
      if (
        typeof m.path !== "string" ||
        !rules.manuscriptPath.test(m.path) ||
        !SAFE_RELATIVE_PATH.test(m.path)
      )
        fail(`${mat}: malformed path`);
      else if (!m.path.startsWith(`preprints/${m.id}/`))
        fail(`${mat}: path outside its directory`);
      if (paths.has(m.path)) fail(`${mat}: duplicate path`);
      paths.add(m.path);
      const covered =
        !!f.formalization &&
        Array.isArray(f.formalization.papers) &&
        f.formalization.papers.includes(m.path);
      const mStatus: MathematicalStatus = m.issues.length
        ? "unverified"
        : covered
          ? "formalized"
          : "manuscript";
      if (m.status !== mStatus)
        fail(
          `${mat}: status ${m.status} does not follow from what the index holds (${mStatus})`,
        );
      if (m.status === "unverified") unverifiedManuscripts++;
      if (m.readme_sha256 !== null && !SHA256_HEX.test(String(m.readme_sha256)))
        fail(`${mat}: malformed README hash`);
    }
    if (f.formalization) {
      formalizations++;
      const fz = f.formalization;
      if (
        typeof fz.path !== "string" ||
        !rules.formalizationPath.test(fz.path) ||
        fz.path !== `lean/docs/${f.id}.md`
      )
        fail(`${at}: malformed formalization path`);
      if (!SHA256_HEX.test(String(fz.sha256)))
        fail(`${at}: malformed formalization hash`);
      if (!Array.isArray(fz.statements) || !Array.isArray(fz.papers))
        fail(`${at}: malformed formalization`);
      else {
        statements += fz.statements.length;
        for (const p of fz.papers)
          if (!f.manuscripts.some((m) => m.path === p))
            fail(`${at}: the scope page names a manuscript the family does not hold`);
        for (const s of fz.statements)
          for (const p of [s.statement_path, s.config_path, s.solution_path])
            if (
              typeof p !== "string" ||
              !rules.leanPath.test(p) ||
              !SAFE_RELATIVE_PATH.test(p)
            )
              fail(`${at}: malformed Lean path`);
      }
    }
    if (f.reasoning_summary) {
      summaries++;
      if (!rules.reasoningSummaryPath.test(String(f.reasoning_summary.path)))
        fail(`${at}: malformed reasoning summary path`);
      if (f.reasoning_summary.status !== "reasoning-summary")
        fail(`${at}: a reasoning summary's status is reasoning-summary`);
    }
  }
  const disciplineIds = new Set<number>();
  for (const d of ix.disciplines) {
    if (!isObject(d) || !Number.isInteger(d.id) || typeof d.name !== "string")
      fail("malformed discipline");
    else if (disciplineIds.has(d.id)) fail(`duplicate discipline ${d.id}`);
    else disciplineIds.add(d.id);
  }
  const c = ix.counts;
  if (
    !isObject(c) ||
    c.families !== ix.families.length ||
    c.manuscripts !== manuscripts ||
    c.formalizations !== formalizations ||
    c.statements !== statements ||
    c.reasoning_summaries !== summaries ||
    c.unverified_families !== unverifiedFamilies ||
    c.unverified_manuscripts !== unverifiedManuscripts ||
    c.disciplines !== ix.disciplines.length ||
    c.rejected !== ix.rejected.length
  )
    fail("the counts do not describe the records");
  if (!errors.length && contentSha256(ix) !== ix.content_sha256)
    fail(
      "the content does not match its SHA-256: the index was changed after it was generated",
    );
  return errors;
}
