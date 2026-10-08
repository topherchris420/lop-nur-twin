/**
 * Fail-closed validation for the mathematical substrate's answers
 * (`rain-mathematics/v1`): the substrate's identity, a search, an inspected
 * result family.
 *
 * Shared by the server, which validates every runtime answer before the
 * browser sees it, and the browser, which validates again before anything is
 * shown — the same discipline as every other R.A.I.N. answer
 * (`validation.ts`). Each answer must be closed, bounded, drawn from the
 * substrate's vocabulary, bound to the request that asked for it, and must
 * name the repository, the commit and the index that supplied it. A status
 * that does not follow from what the answer holds — a family called
 * formalized with no formalization, a manuscript called formalized that its
 * family's scope page does not list — is refused, never repaired.
 */
import {
  CHALLENGE_GROUPS,
  COMMIT_SHA,
  FINDINGS,
  FORMALIZATION_FILTERS,
  INSPECT_ENGINE,
  MATHEMATICAL_STATUSES,
  MATHEMATICS_SCHEMA,
  MATH_LIMITS,
  RESULT_KINDS,
  SAFE_RELATIVE_PATH,
  SEARCH_ENGINE,
  SEARCH_MODES,
  SHA256_HEX,
  SUBSTRATES,
  SUBSTRATE_INDEX_SCHEMA,
  isSubstrate,
  type ChallengeGroup,
  type Finding,
  type MathematicalStatus,
  type ResultKind,
  type SearchMode,
  type SubstrateRepository,
} from "../../rain/mathematics/contracts.js";
import { Reader, normalizeQuestion, type Checked } from "./validation.js";

type Json = Record<string, unknown>;

export interface MathProvenance {
  repository: SubstrateRepository;
  repository_url: string;
  commit: string;
  commit_date: string | null;
  index_sha256: string;
  generated_at: string;
  retrieved_at: string;
}
export interface KindBasis {
  kind: ResultKind;
  field: "title" | "summary" | "manuscript-title";
  phrase: string;
}
export interface MathStatus {
  schema: typeof MATHEMATICS_SCHEMA;
  kind: "math-status";
  available: boolean;
  reason: string | null;
  substrate: {
    repository: SubstrateRepository;
    repository_url: string;
    commit: string;
    commit_date: string | null;
    index_schema: typeof SUBSTRATE_INDEX_SCHEMA;
    index_sha256: string;
    generated_at: string;
    license: string;
    review_status: string | null;
    formalization_scope: string | null;
    counts: Record<
      | "disciplines"
      | "families"
      | "manuscripts"
      | "formalizations"
      | "statements"
      | "reasoning_summaries"
      | "unverified_families"
      | "unverified_manuscripts"
      | "rejected",
      number
    >;
    disciplines: { id: number; name: string; families: number }[];
    collection: { heading: string; text: string }[];
  } | null;
}
export interface MathResultSummary {
  family: string;
  title: string;
  discipline: { id: number; name: string } | null;
  status: MathematicalStatus;
  kinds: ResultKind[];
  kind_basis: KindBasis[];
  formalization_path: string | null;
  statements: number;
  reasoning_summary_path: string | null;
  manuscripts: {
    id: string;
    title: string;
    path: string;
    status: MathematicalStatus;
    annotation: string | null;
  }[];
  matched: { term: string; fields: string[] }[];
  rank: number;
  group: ChallengeGroup | null;
}
export interface MathResults {
  schema: typeof MATHEMATICS_SCHEMA;
  kind: "math-results";
  request_id: string;
  engine: typeof SEARCH_ENGINE;
  query: string;
  mode: SearchMode;
  hypothesis: string | null;
  filters: {
    discipline: string | null;
    formalization: (typeof FORMALIZATION_FILTERS)[number];
    limit: number;
  };
  terms: { used: string[]; ignored: number };
  matches: number;
  results: MathResultSummary[];
  findings: Finding[];
  provenance: MathProvenance;
}
export interface Excerpt {
  text: string;
  chars: number;
  truncated: boolean;
  source: string;
}
export interface MathManuscript {
  id: string;
  title: string;
  path: string;
  annotation: string | null;
  abstract: Excerpt;
  date: string | null;
  citation: {
    key: string;
    author: string;
    title: string;
    year: string;
    url: string | null;
  } | null;
  notes: string[];
  readme_sha256: string | null;
  status: MathematicalStatus;
  main_result_catalogued: boolean;
  issues: string[];
}
export interface MathStatement {
  result: string;
  statement_path: string;
  config_path: string;
  config_sha256: string;
  theorems: string[];
  definitions: string[];
  solution_module: string;
  solution_path: string;
  solution_present: boolean;
  permitted_axioms: string[];
  catalogued_main_result: boolean;
}
export interface MathRecord {
  schema: typeof MATHEMATICS_SCHEMA;
  kind: "math-record";
  request_id: string;
  engine: typeof INSPECT_ENGINE;
  family: {
    id: string;
    title: string;
    overview_title: string | null;
    discipline: { id: number; name: string } | null;
    summary: Excerpt;
    status: MathematicalStatus;
    kinds: ResultKind[];
    kind_basis: KindBasis[];
    issues: string[];
    manuscripts: MathManuscript[];
    formalization: {
      path: string;
      sha256: string;
      title: string;
      papers: string[];
      scope: Excerpt;
      statements: MathStatement[];
      review_status: string | null;
      catalogue_scope: string | null;
    } | null;
    reasoning_summary: {
      path: string;
      subject: string;
      status: "reasoning-summary";
    } | null;
  };
  provenance: MathProvenance;
}

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const ISSUE_TEXT = 200;

function provenance(r: Reader, v: unknown, path: string): MathProvenance {
  const o = r.object(v, path, [
    "repository",
    "repository_url",
    "commit",
    "commit_date",
    "index_sha256",
    "generated_at",
    "retrieved_at",
  ]);
  const repository = isSubstrate(o?.repository) ? o.repository : null;
  if (!repository)
    r.fail(path + ".repository", "not a mathematical substrate R.A.I.N. holds");
  const url = r.text(o?.repository_url, path + ".repository_url", 200, 1);
  if (repository && url !== SUBSTRATES[repository].url)
    r.fail(path + ".repository_url", "is not the substrate's repository");
  return {
    repository: repository ?? "openai/math",
    repository_url: url,
    commit: r.pattern(o?.commit, path + ".commit", COMMIT_SHA),
    commit_date:
      o?.commit_date === null ? null : r.timestamp(o?.commit_date, path + ".commit_date"),
    index_sha256: r.pattern(o?.index_sha256, path + ".index_sha256", SHA256_HEX),
    generated_at: r.timestamp(o?.generated_at, path + ".generated_at"),
    retrieved_at: r.timestamp(o?.retrieved_at, path + ".retrieved_at"),
  };
}

function discipline(r: Reader, v: unknown, path: string) {
  if (v === null) return null;
  const o = r.object(v, path, ["id", "name"]);
  return {
    id: r.integer(o?.id, path + ".id", 1, 999),
    name: r.text(o?.name, path + ".name", MATH_LIMITS.disciplineName, 1),
  };
}
function kinds(r: Reader, v: unknown, path: string): ResultKind[] {
  const list = r
    .array(v, path, RESULT_KINDS.length)
    .map((k, i) => r.oneOf(k, `${path}[${i}]`, RESULT_KINDS));
  if (!list.length) r.fail(path, "a result has at least one kind");
  return list;
}
function kindBasis(r: Reader, v: unknown, path: string): KindBasis[] {
  return r.array(v, path, MATH_LIMITS.kindBasis).map((b, i) => {
    const at = `${path}[${i}]`;
    const o = r.object(b, at, ["kind", "field", "phrase"]);
    return {
      kind: r.oneOf(o?.kind, at + ".kind", RESULT_KINDS),
      field: r.oneOf(o?.field, at + ".field", [
        "title",
        "summary",
        "manuscript-title",
      ] as const),
      phrase: r.text(o?.phrase, at + ".phrase", 120, 1),
    };
  });
}
function repoPath(
  r: Reader,
  v: unknown,
  path: string,
  pattern: RegExp,
  nullable = false,
): string | null {
  if (nullable && v === null) return null;
  if (typeof v !== "string" || !pattern.test(v) || !SAFE_RELATIVE_PATH.test(v)) {
    r.fail(path, "not a path this substrate names");
    return "";
  }
  return v;
}
function texts(r: Reader, v: unknown, path: string, max: number, len: number) {
  return r.array(v, path, max).map((t, i) => r.text(t, `${path}[${i}]`, len, 1));
}
function excerpt(r: Reader, v: unknown, path: string, max: number): Excerpt {
  const o = r.object(v, path, ["text", "chars", "truncated", "source"]);
  const e: Excerpt = {
    text: r.text(o?.text, path + ".text", max),
    chars: r.integer(o?.chars, path + ".chars", 0, 1_000_000),
    truncated: r.boolean(o?.truncated, path + ".truncated"),
    source: r.text(o?.source, path + ".source", 300, 1),
  };
  if (e.source && !SAFE_RELATIVE_PATH.test(e.source))
    r.fail(path + ".source", "not a repository path");
  if (e.truncated !== e.chars > e.text.length || e.chars < e.text.length)
    r.fail(path, "the excerpt's length does not agree with its truncation");
  return e;
}
function status(r: Reader, v: unknown, path: string, family = false): MathematicalStatus {
  const s = r.oneOf(v, path, MATHEMATICAL_STATUSES);
  if (family && s === "reasoning-summary")
    r.fail(path, "a family's status is formalized, manuscript or unverified");
  return s;
}

/** The substrate's identity, or why none is served. */
export function validateMathStatus(v: unknown): Checked<MathStatus> {
  const r = new Reader("math-status");
  const o = r.object(v, "", ["schema", "kind", "available", "reason", "substrate"]);
  if (!o) return r.done(null as never);
  if (o.schema !== MATHEMATICS_SCHEMA) r.fail("schema", "unsupported schema");
  if (o.kind !== "math-status") r.fail("kind", "not a substrate status");
  const available = r.boolean(o.available, "available");
  const reason = o.reason === null ? null : r.text(o.reason, "reason", 300, 1);
  if (available !== (o.substrate !== null) || available !== (reason === null))
    r.fail(
      "available",
      "a substrate is described exactly when it is available, and a reason given when it is not",
    );
  let substrate: MathStatus["substrate"] = null;
  if (o.substrate !== null) {
    const s = r.object(o.substrate, "substrate", [
      "repository",
      "repository_url",
      "commit",
      "commit_date",
      "index_schema",
      "index_sha256",
      "generated_at",
      "license",
      "review_status",
      "formalization_scope",
      "counts",
      "disciplines",
      "collection",
    ]);
    const p = provenance(
      r,
      s
        ? {
            repository: s.repository,
            repository_url: s.repository_url,
            commit: s.commit,
            commit_date: s.commit_date,
            index_sha256: s.index_sha256,
            generated_at: s.generated_at,
            retrieved_at: s.generated_at,
          }
        : null,
      "substrate",
    );
    if (s?.index_schema !== SUBSTRATE_INDEX_SCHEMA)
      r.fail("substrate.index_schema", "unsupported index schema");
    const countKeys = [
      "disciplines",
      "families",
      "manuscripts",
      "formalizations",
      "statements",
      "reasoning_summaries",
      "unverified_families",
      "unverified_manuscripts",
      "rejected",
    ] as const;
    const c = r.object(s?.counts, "substrate.counts", countKeys);
    const counts = Object.fromEntries(
      countKeys.map((k) => [k, r.integer(c?.[k], `substrate.counts.${k}`, 0, 1_000_000)]),
    ) as Record<(typeof countKeys)[number], number>;
    substrate = {
      repository: p.repository,
      repository_url: p.repository_url,
      commit: p.commit,
      commit_date: p.commit_date,
      index_schema: SUBSTRATE_INDEX_SCHEMA,
      index_sha256: p.index_sha256,
      generated_at: p.generated_at,
      license: r.text(s?.license, "substrate.license", 64, 1),
      review_status:
        s?.review_status === null
          ? null
          : r.text(s?.review_status, "substrate.review_status", 80, 1),
      formalization_scope:
        s?.formalization_scope === null
          ? null
          : r.text(s?.formalization_scope, "substrate.formalization_scope", 200, 1),
      counts,
      disciplines: r.array(s?.disciplines, "substrate.disciplines", 64).map((d, i) => {
        const at = `substrate.disciplines[${i}]`;
        const x = r.object(d, at, ["id", "name", "families"]);
        return {
          id: r.integer(x?.id, at + ".id", 1, 999),
          name: r.text(x?.name, at + ".name", MATH_LIMITS.disciplineName, 1),
          families: r.integer(x?.families, at + ".families", 0, 100_000),
        };
      }),
      collection: r.array(s?.collection, "substrate.collection", 4).map((x, i) => {
        const at = `substrate.collection[${i}]`;
        const y = r.object(x, at, ["heading", "text"]);
        return {
          heading: r.text(y?.heading, at + ".heading", 80, 1),
          text: r.text(y?.text, at + ".text", 1600),
        };
      }),
    };
  }
  return r.done({
    schema: MATHEMATICS_SCHEMA,
    kind: "math-status",
    available,
    reason,
    substrate,
  });
}

function summary(
  r: Reader,
  v: unknown,
  path: string,
  repository: SubstrateRepository,
  mode: SearchMode,
): MathResultSummary {
  const rules = SUBSTRATES[repository];
  const o = r.object(v, path, [
    "family",
    "title",
    "discipline",
    "status",
    "kinds",
    "kind_basis",
    "formalization_path",
    "statements",
    "reasoning_summary_path",
    "manuscripts",
    "matched",
    "rank",
    "group",
  ]);
  const s: MathResultSummary = {
    family: r.pattern(o?.family, path + ".family", rules.family),
    title: r.text(o?.title, path + ".title", MATH_LIMITS.title, 1),
    discipline: discipline(r, o?.discipline, path + ".discipline"),
    status: status(r, o?.status, path + ".status", true),
    kinds: kinds(r, o?.kinds, path + ".kinds"),
    kind_basis: kindBasis(r, o?.kind_basis, path + ".kind_basis"),
    formalization_path: repoPath(
      r,
      o?.formalization_path,
      path + ".formalization_path",
      rules.formalizationPath,
      true,
    ),
    statements: r.integer(
      o?.statements,
      path + ".statements",
      0,
      MATH_LIMITS.statementsPerFamily,
    ),
    reasoning_summary_path: repoPath(
      r,
      o?.reasoning_summary_path,
      path + ".reasoning_summary_path",
      rules.reasoningSummaryPath,
      true,
    ),
    manuscripts: r
      .array(o?.manuscripts, path + ".manuscripts", MATH_LIMITS.manuscriptsPerFamily)
      .map((m, i) => {
        const at = `${path}.manuscripts[${i}]`;
        const x = r.object(m, at, ["id", "title", "path", "status", "annotation"]);
        return {
          id: r.pattern(x?.id, at + ".id", rules.manuscript),
          title: r.text(x?.title, at + ".title", MATH_LIMITS.title, 1),
          path: repoPath(r, x?.path, at + ".path", rules.manuscriptPath) ?? "",
          status: status(r, x?.status, at + ".status"),
          annotation:
            x?.annotation === null
              ? null
              : r.text(x?.annotation, at + ".annotation", MATH_LIMITS.annotation, 1),
        };
      }),
    matched: r
      .array(o?.matched, path + ".matched", MATH_LIMITS.matchedTerms)
      .map((m, i) => {
        const at = `${path}.matched[${i}]`;
        const x = r.object(m, at, ["term", "fields"]);
        return {
          term: r.pattern(x?.term, at + ".term", /^[a-z][a-z0-9]{0,63}$/),
          fields: r
            .array(x?.fields, at + ".fields", 6)
            .map((f, j) =>
              r.oneOf(f, `${at}.fields[${j}]`, [
                "title",
                "summary",
                "manuscripts",
                "abstracts",
                "discipline",
                "formalization",
              ] as const),
            ),
        };
      }),
    rank: r.integer(o?.rank, path + ".rank", 1, MATH_LIMITS.results),
    group:
      o?.group === null ? null : r.oneOf(o?.group, path + ".group", CHALLENGE_GROUPS),
  };
  if (s.status === "formalized" && s.formalization_path === null)
    r.fail(path + ".status", "a formalized result names its formalization");
  if (s.status === "manuscript" && s.formalization_path !== null)
    r.fail(path + ".status", "a result with a formalization is not a bare manuscript");
  if (
    s.formalization_path !== null &&
    s.formalization_path !== `lean/docs/${s.family}.md`
  )
    r.fail(path + ".formalization_path", "is not its family's scope page");
  if ((mode === "challenge") !== (s.group !== null))
    r.fail(path + ".group", "results are grouped exactly when the search is a challenge");
  if (!s.matched.length) r.fail(path + ".matched", "a result shares at least one term");
  for (const m of s.manuscripts) {
    if (m.status === "reasoning-summary")
      r.fail(path + ".manuscripts", "a manuscript is not a reasoning summary");
    if (m.path && !m.path.startsWith(`preprints/${m.id}/`))
      r.fail(path + ".manuscripts", "a manuscript's path is outside its directory");
  }
  return s;
}

function finding(r: Reader, v: unknown, path: string): Finding {
  const o = r.object(v, path, ["id", "n", "of"]);
  return {
    id: r.oneOf(o?.id, path + ".id", FINDINGS),
    n: o?.n === null ? null : r.integer(o?.n, path + ".n", 0, 100_000),
    of: o?.of === null ? null : r.integer(o?.of, path + ".of", 0, 100_000),
  };
}

/** A search's answer, bound to the request that asked for it. */
export function validateMathResults(
  v: unknown,
  expected: { requestId: string; query: string; mode: SearchMode },
): Checked<MathResults> {
  const r = new Reader("math-results");
  const o = r.object(v, "", [
    "schema",
    "kind",
    "request_id",
    "engine",
    "query",
    "mode",
    "hypothesis",
    "filters",
    "terms",
    "matches",
    "results",
    "findings",
    "provenance",
  ]);
  if (!o) return r.done(null as never);
  if (o.schema !== MATHEMATICS_SCHEMA) r.fail("schema", "unsupported schema");
  if (o.kind !== "math-results") r.fail("kind", "not a substrate search");
  if (o.engine !== SEARCH_ENGINE) r.fail("engine", "not the substrate's search");
  const p = provenance(r, o.provenance, "provenance");
  const mode = r.oneOf(o.mode, "mode", SEARCH_MODES);
  const f = r.object(o.filters, "filters", ["discipline", "formalization", "limit"]);
  const filters = {
    discipline:
      f?.discipline === null
        ? null
        : r.text(f?.discipline, "filters.discipline", MATH_LIMITS.disciplineName, 1),
    formalization: r.oneOf(
      f?.formalization,
      "filters.formalization",
      FORMALIZATION_FILTERS,
    ),
    limit: r.integer(f?.limit, "filters.limit", 1, MATH_LIMITS.results),
  };
  const t = r.object(o.terms, "terms", ["used", "ignored"]);
  const results = r
    .array(o.results, "results", MATH_LIMITS.results)
    .map((x, i) => summary(r, x, `results[${i}]`, p.repository, mode));
  const answer: MathResults = {
    schema: MATHEMATICS_SCHEMA,
    kind: "math-results",
    request_id: r.pattern(o.request_id, "request_id", /^[0-9a-f]{32}$/),
    engine: SEARCH_ENGINE,
    query: r.text(o.query, "query", MATH_LIMITS.query, 1),
    mode,
    hypothesis:
      o.hypothesis === null
        ? null
        : r.text(o.hypothesis, "hypothesis", MATH_LIMITS.hypothesis, 1),
    filters,
    terms: {
      used: r
        .array(t?.used, "terms.used", MATH_LIMITS.queryTerms)
        .map((x, i) => r.pattern(x, `terms.used[${i}]`, /^[a-z][a-z0-9]{0,63}$/)),
      ignored: r.integer(t?.ignored, "terms.ignored", 0, 10_000),
    },
    matches: r.integer(o.matches, "matches", 0, 100_000),
    results,
    findings: r
      .array(o.findings, "findings", FINDINGS.length)
      .map((x, i) => finding(r, x, `findings[${i}]`)),
    provenance: p,
  };
  if (answer.request_id !== expected.requestId)
    r.fail("request_id", "answers a different request (stale or mismatched)");
  if (answer.query !== normalizeQuestion(expected.query))
    r.fail("query", "answers a different query");
  if (answer.mode !== expected.mode) r.fail("mode", "answers a different kind of search");
  if (mode === "challenge" && answer.hypothesis === null)
    r.fail("hypothesis", "a challenge is made against a hypothesis");
  if (results.length > filters.limit) r.fail("results", "more results than the limit");
  if (results.length > answer.matches) r.fail("matches", "fewer matches than results");
  results.forEach((x, i) => {
    if (x.rank !== i + 1) r.fail(`results[${i}].rank`, "results are ranked in order");
  });
  if (new Set(results.map((x) => x.family)).size !== results.length)
    r.fail("results", "a family appears twice");
  if (!results.length !== answer.findings.some((x) => x.id === "no_result"))
    r.fail("findings", "no_result is stated exactly when nothing matched");
  return r.done(answer);
}

function manuscript(
  r: Reader,
  v: unknown,
  path: string,
  repository: SubstrateRepository,
): MathManuscript {
  const rules = SUBSTRATES[repository];
  const o = r.object(v, path, [
    "id",
    "title",
    "path",
    "annotation",
    "abstract",
    "date",
    "citation",
    "notes",
    "readme_sha256",
    "status",
    "main_result_catalogued",
    "issues",
  ]);
  let citation: MathManuscript["citation"] = null;
  if (o?.citation !== null) {
    const c = r.object(o?.citation, path + ".citation", [
      "key",
      "author",
      "title",
      "year",
      "url",
    ]);
    const url = c?.url === null ? null : r.text(c?.url, path + ".citation.url", 400, 1);
    if (url !== null && !/^https:\/\/github\.com\/openai\/math\/blob\/\S+$/.test(url))
      r.fail(path + ".citation.url", "not a repository URL");
    citation = {
      key: r.text(c?.key, path + ".citation.key", 220, 1),
      author: r.text(c?.author, path + ".citation.author", 200, 1),
      title: r.text(c?.title, path + ".citation.title", 400, 1),
      year: r.text(c?.year, path + ".citation.year", 16, 1),
      url,
    };
  }
  const m: MathManuscript = {
    id: r.pattern(o?.id, path + ".id", rules.manuscript),
    title: r.text(o?.title, path + ".title", MATH_LIMITS.title, 1),
    path: repoPath(r, o?.path, path + ".path", rules.manuscriptPath) ?? "",
    annotation:
      o?.annotation === null
        ? null
        : r.text(o?.annotation, path + ".annotation", MATH_LIMITS.annotation, 1),
    abstract: excerpt(r, o?.abstract, path + ".abstract", MATH_LIMITS.abstract),
    date: o?.date === null ? null : r.text(o?.date, path + ".date", 40, 1),
    citation,
    notes: texts(r, o?.notes, path + ".notes", MATH_LIMITS.notes, MATH_LIMITS.note),
    readme_sha256:
      o?.readme_sha256 === null
        ? null
        : r.pattern(o?.readme_sha256, path + ".readme_sha256", SHA256_HEX),
    status: status(r, o?.status, path + ".status"),
    main_result_catalogued: r.boolean(
      o?.main_result_catalogued,
      path + ".main_result_catalogued",
    ),
    issues: texts(r, o?.issues, path + ".issues", 8, ISSUE_TEXT),
  };
  if (m.status === "reasoning-summary")
    r.fail(path + ".status", "a manuscript is not a reasoning summary");
  if ((m.status === "unverified") !== m.issues.length > 0)
    r.fail(path + ".status", "a manuscript is unverified exactly when it has issues");
  if (m.path && !m.path.startsWith(`preprints/${m.id}/`))
    r.fail(path + ".path", "outside the manuscript's directory");
  return m;
}

/** An inspected result family, bound to the request and the family asked for. */
export function validateMathRecord(
  v: unknown,
  expected: { requestId: string; family: string },
): Checked<MathRecord> {
  const r = new Reader("math-record");
  const o = r.object(v, "", [
    "schema",
    "kind",
    "request_id",
    "engine",
    "family",
    "provenance",
  ]);
  if (!o) return r.done(null as never);
  if (o.schema !== MATHEMATICS_SCHEMA) r.fail("schema", "unsupported schema");
  if (o.kind !== "math-record") r.fail("kind", "not an inspected result");
  if (o.engine !== INSPECT_ENGINE) r.fail("engine", "not the substrate's inspection");
  const p = provenance(r, o.provenance, "provenance");
  const rules = SUBSTRATES[p.repository];
  const f = r.object(o.family, "family", [
    "id",
    "title",
    "overview_title",
    "discipline",
    "summary",
    "status",
    "kinds",
    "kind_basis",
    "issues",
    "manuscripts",
    "formalization",
    "reasoning_summary",
  ]);
  let formalization: MathRecord["family"]["formalization"] = null;
  if (f?.formalization !== null) {
    const z = r.object(f?.formalization, "family.formalization", [
      "path",
      "sha256",
      "title",
      "papers",
      "scope",
      "statements",
      "review_status",
      "catalogue_scope",
    ]);
    formalization = {
      path:
        repoPath(r, z?.path, "family.formalization.path", rules.formalizationPath) ?? "",
      sha256: r.pattern(z?.sha256, "family.formalization.sha256", SHA256_HEX),
      title: r.text(z?.title, "family.formalization.title", MATH_LIMITS.title, 1),
      papers: r
        .array(z?.papers, "family.formalization.papers", MATH_LIMITS.manuscriptsPerFamily)
        .map(
          (x, i) =>
            repoPath(r, x, `family.formalization.papers[${i}]`, rules.manuscriptPath) ??
            "",
        ),
      scope: excerpt(r, z?.scope, "family.formalization.scope", MATH_LIMITS.scope),
      statements: r
        .array(
          z?.statements,
          "family.formalization.statements",
          MATH_LIMITS.statementsPerFamily,
        )
        .map((x, i) => {
          const at = `family.formalization.statements[${i}]`;
          const s = r.object(x, at, [
            "result",
            "statement_path",
            "config_path",
            "config_sha256",
            "theorems",
            "definitions",
            "solution_module",
            "solution_path",
            "solution_present",
            "permitted_axioms",
            "catalogued_main_result",
          ]);
          const name = /^[A-Za-z_][A-Za-z0-9_.'!?₀-₉]{0,159}$/u;
          return {
            result: r.text(s?.result, at + ".result", 160, 1),
            statement_path:
              repoPath(r, s?.statement_path, at + ".statement_path", rules.leanPath) ??
              "",
            config_path:
              repoPath(r, s?.config_path, at + ".config_path", rules.leanPath) ?? "",
            config_sha256: r.pattern(s?.config_sha256, at + ".config_sha256", SHA256_HEX),
            theorems: r
              .array(s?.theorems, at + ".theorems", MATH_LIMITS.namesPerStatement)
              .map((t, j) => r.pattern(t, `${at}.theorems[${j}]`, name)),
            definitions: r
              .array(s?.definitions, at + ".definitions", MATH_LIMITS.namesPerStatement)
              .map((t, j) => r.pattern(t, `${at}.definitions[${j}]`, name)),
            solution_module: r.pattern(
              s?.solution_module,
              at + ".solution_module",
              /^[A-Za-z][A-Za-z0-9_.]{0,159}$/,
            ),
            solution_path:
              repoPath(r, s?.solution_path, at + ".solution_path", rules.leanPath) ?? "",
            solution_present: r.boolean(s?.solution_present, at + ".solution_present"),
            permitted_axioms: r
              .array(
                s?.permitted_axioms,
                at + ".permitted_axioms",
                MATH_LIMITS.namesPerStatement,
              )
              .map((t, j) => r.pattern(t, `${at}.permitted_axioms[${j}]`, name)),
            catalogued_main_result: r.boolean(
              s?.catalogued_main_result,
              at + ".catalogued_main_result",
            ),
          };
        }),
      review_status:
        z?.review_status === null
          ? null
          : r.text(z?.review_status, "family.formalization.review_status", 80, 1),
      catalogue_scope:
        z?.catalogue_scope === null
          ? null
          : r.text(z?.catalogue_scope, "family.formalization.catalogue_scope", 200, 1),
    };
  }
  let reasoning: MathRecord["family"]["reasoning_summary"] = null;
  if (f?.reasoning_summary !== null) {
    const x = r.object(f?.reasoning_summary, "family.reasoning_summary", [
      "path",
      "subject",
      "status",
    ]);
    if (x?.status !== "reasoning-summary")
      r.fail(
        "family.reasoning_summary.status",
        "a reasoning summary's status is reasoning-summary",
      );
    reasoning = {
      path:
        repoPath(
          r,
          x?.path,
          "family.reasoning_summary.path",
          rules.reasoningSummaryPath,
        ) ?? "",
      subject: r.text(
        x?.subject,
        "family.reasoning_summary.subject",
        MATH_LIMITS.title,
        1,
      ),
      status: "reasoning-summary",
    };
  }
  const family: MathRecord["family"] = {
    id: r.pattern(f?.id, "family.id", rules.family),
    title: r.text(f?.title, "family.title", MATH_LIMITS.title, 1),
    overview_title:
      f?.overview_title === null
        ? null
        : r.text(f?.overview_title, "family.overview_title", MATH_LIMITS.title, 1),
    discipline: discipline(r, f?.discipline, "family.discipline"),
    summary: excerpt(r, f?.summary, "family.summary", MATH_LIMITS.summary),
    status: status(r, f?.status, "family.status", true),
    kinds: kinds(r, f?.kinds, "family.kinds"),
    kind_basis: kindBasis(r, f?.kind_basis, "family.kind_basis"),
    issues: texts(r, f?.issues, "family.issues", 8, ISSUE_TEXT),
    manuscripts: r
      .array(f?.manuscripts, "family.manuscripts", MATH_LIMITS.manuscriptsPerFamily)
      .map((m, i) => manuscript(r, m, `family.manuscripts[${i}]`, p.repository)),
    formalization,
    reasoning_summary: reasoning,
  };
  const expectedStatus: MathematicalStatus = family.issues.length
    ? "unverified"
    : formalization
      ? "formalized"
      : "manuscript";
  if (family.status !== expectedStatus)
    r.fail("family.status", "does not follow from what the record holds");
  if (formalization && formalization.path !== `lean/docs/${family.id}.md`)
    r.fail("family.formalization.path", "is not the family's scope page");
  for (const [i, m] of family.manuscripts.entries()) {
    const covered = !!formalization && formalization.papers.includes(m.path);
    if (m.status === "formalized" && !covered)
      r.fail(
        `family.manuscripts[${i}].status`,
        "called formalized, but the family's scope page does not list it",
      );
    if (m.status === "manuscript" && covered)
      r.fail(
        `family.manuscripts[${i}].status`,
        "listed by the scope page, so it is formalized",
      );
  }
  if (family.id !== expected.family) r.fail("family.id", "answers a different family");
  const requestId = r.pattern(o.request_id, "request_id", /^[0-9a-f]{32}$/);
  if (requestId !== expected.requestId)
    r.fail("request_id", "answers a different request (stale or mismatched)");
  return r.done({
    schema: MATHEMATICS_SCHEMA,
    kind: "math-record",
    request_id: requestId,
    engine: INSPECT_ENGINE,
    family,
    provenance: p,
  });
}

/** Whether a value is an object; exported for the route's request checks. */
export const isRecord = isObject;
