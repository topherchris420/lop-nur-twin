/**
 * The mathematical substrate's vocabulary: what R.A.I.N. may say about a
 * mathematical result, and what it may never say.
 *
 * A mathematical substrate is a version-pinned, read-only index of a public
 * repository of mathematical research — today `openai/math` — that R.A.I.N.
 * consults while it turns a question into a hypothesis. It sits beside the
 * evidence corpus (`../corpus.ts`), never inside it:
 *
 *   Mathematical substrate ≠ evidence corpus
 *   Mathematical result    ≠ empirical result
 *   Lean formalization     ≠ empirical validation
 *   Hypothesis             ≠ conclusion
 *
 * Three vocabularies keep those lines in the types:
 *
 * - a **status** says what the repository holds for a result at one commit
 *   (a Lean formalization, a manuscript, a reasoning summary, or metadata too
 *   incomplete to cite) — never whether the mathematics is true;
 * - a **relation** says how a result bears on the research question at hand,
 *   and is a claim with an author: a person, or a host rule that may only say
 *   that the context is insufficient or that the result is related by words
 *   and not directly applicable. Nothing here derives a relation from
 *   similarity;
 * - a **finding** is what the runtime's deterministic substrate stage can
 *   establish by itself: that results share terms with a query, that a
 *   formalization is present, that nothing matched.
 *
 * Shared by the runtime (`./substrate.ts`), the route and the browser, so it
 * imports only the runtime's pure protocol module.
 */
import { UNSAFE_TEXT } from "../protocol.js";

/** The wire family between the lab and the runtime's substrate operations. */
export const MATHEMATICS_SCHEMA = "rain-mathematics/v1" as const;
/** A substrate index, as `scripts/math-substrate.ts index` writes it. */
export const SUBSTRATE_INDEX_SCHEMA = "rain-math-substrate-index/v1" as const;
/** The runtime code paths a substrate answer names. */
export const SEARCH_ENGINE = "rain.mathematics.substrate.searchMathematics" as const;
export const INSPECT_ENGINE =
  "rain.mathematics.substrate.inspectMathematicalResult" as const;

/**
 * The repositories R.A.I.N. can hold as a substrate, and the shape of every
 * identifier and path each one may name. Closed: a second repository is a
 * contract change — its own identifier and path rules, an indexer for its
 * catalogue, and a new entry here — not a configuration.
 */
export const SUBSTRATES = {
  "openai/math": {
    url: "https://github.com/openai/math",
    license: "Apache-2.0",
    /** A result family's three-digit catalogue number. */
    family: /^[0-9]{3}$/,
    /** A manuscript is named by its preprint directory. */
    manuscript: /^[A-Za-z0-9][A-Za-z0-9().-]{2,159}$/,
    manuscriptPath:
      /^preprints\/[A-Za-z0-9][A-Za-z0-9().-]{2,159}\/[A-Za-z0-9][A-Za-z0-9()._-]{0,199}\.pdf$/,
    formalizationPath: /^lean\/docs\/[0-9]{3}\.md$/,
    reasoningSummaryPath: /^reasoning_traces\/[a-z0-9][a-z0-9-]{0,119}\.pdf$/,
    leanPath: /^lean\/[A-Za-z0-9][A-Za-z0-9_./-]{0,239}\.(?:lean|json)$/,
  },
} as const;
export type SubstrateRepository = keyof typeof SUBSTRATES;
export const SUBSTRATE_REPOSITORIES = Object.keys(SUBSTRATES) as SubstrateRepository[];
export const isSubstrate = (r: unknown): r is SubstrateRepository =>
  typeof r === "string" && Object.prototype.hasOwnProperty.call(SUBSTRATES, r);

/**
 * A repository path's URL at one commit — never a branch, so the link names
 * exactly the bytes that were indexed. Shown as text; nothing fetches it.
 */
export const pinnedUrl = (
  repository: SubstrateRepository,
  commit: string,
  path: string,
) => `${SUBSTRATES[repository].url}/blob/${commit}/${path}`;

/** A path is shown and never opened: no traversal, no scheme, no leading slash. */
export const SAFE_RELATIVE_PATH =
  /^(?![/\\])(?!.*(?:^|\/)\.\.(?:\/|$))(?![A-Za-z][A-Za-z0-9+.-]*:)[^\0\\]+$/;
export const COMMIT_SHA = /^[0-9a-f]{40}$/;
export const SHA256_HEX = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Status: what the repository holds for a result at one commit.
// ---------------------------------------------------------------------------
export const MATHEMATICAL_STATUSES = [
  "formalized",
  "manuscript",
  "reasoning-summary",
  "unverified",
] as const;
export type MathematicalStatus = (typeof MATHEMATICAL_STATUSES)[number];
export const STATUS_WORDS: Record<
  MathematicalStatus,
  { label: string; meaning: string }
> = {
  formalized: {
    label: "LEAN FORMALIZATION PRESENT · NOT CHECKED HERE",
    meaning:
      "A Lean formalization related to this result is present in the repository at this commit; its scope page says which statements it covers. This runtime has not compiled or checked it, and the repository's formalization catalogue records its own review status. A formalization proves a mathematical statement; it never validates an empirical claim.",
  },
  manuscript: {
    label: "MANUSCRIPT · NOT FORMALIZED",
    meaning:
      "A manuscript exists in the repository, and the result is not represented by a Lean formalization at this commit. The repository itself says some unformalized results could have issues.",
  },
  "reasoning-summary": {
    label: "REASONING SUMMARY · NOT A PROOF",
    meaning:
      "An abridged summary of a model's reasoning, released with the collection. It is not a proof and is never treated as one.",
  },
  unverified: {
    label: "UNVERIFIED · NOT ADMISSIBLE",
    meaning:
      "Listed in the repository's catalogue, but its metadata is incomplete or inconsistent at this commit, so it cannot be cited as a mathematical basis.",
  },
};

// ---------------------------------------------------------------------------
// Relation: how a result bears on the research question. A claim, with an author.
// ---------------------------------------------------------------------------
export const MATHEMATICAL_RELATIONS = [
  "supports_hypothesis",
  "suggests_hypothesis",
  "provides_method",
  "provides_definition",
  "provides_counterexample",
  "related_but_not_applicable",
  "contradicts_candidate",
  "insufficient_context",
] as const;
export type MathematicalRelation = (typeof MATHEMATICAL_RELATIONS)[number];
export const RELATION_WORDS: Record<
  MathematicalRelation,
  { label: string; meaning: string }
> = {
  supports_hypothesis: {
    label: "supports the hypothesis",
    meaning:
      "Under the stated assumptions, the result makes the candidate hypothesis expected. It does not establish what the simulator will do.",
  },
  suggests_hypothesis: {
    label: "suggests a hypothesis",
    meaning:
      "The result suggests a testable hypothesis about the simulator, under the stated assumptions. A suggestion is not a prediction the mathematics guarantees.",
  },
  provides_method: {
    label: "provides a method",
    meaning:
      "The result offers a method — a construction, a bound, a way to measure — that the experiment can borrow, under the stated assumptions.",
  },
  provides_definition: {
    label: "provides a definition",
    meaning:
      "The result fixes what a term in the question means, so the hypothesis can be stated precisely.",
  },
  provides_counterexample: {
    label: "provides a counterexample",
    meaning:
      "Under the stated assumptions, the result shows that a framing of the question does not hold in general.",
  },
  related_but_not_applicable: {
    label: "related, not directly applicable",
    meaning:
      "The result shares words or objects with the question, but its assumptions do not match the simulator; it bears on nothing the experiment measures.",
  },
  contradicts_candidate: {
    label: "contradicts the candidate",
    meaning:
      "Under the stated assumptions, the result suggests the candidate's conclusion does not follow. It does not say what the simulator will do.",
  },
  insufficient_context: {
    label: "insufficient context",
    meaning:
      "Nobody has established how the result bears on the question; it was consulted and is recorded as context only.",
  },
};
/** Relations that assert a connection need the assumptions that make it, and a rationale. */
export const CONNECTING_RELATIONS: readonly MathematicalRelation[] = [
  "supports_hypothesis",
  "suggests_hypothesis",
  "provides_method",
  "provides_definition",
  "provides_counterexample",
  "contradicts_candidate",
];
/** Relations that challenge a framing: counterexamples are first-class. */
export const CHALLENGING_RELATIONS: readonly MathematicalRelation[] = [
  "provides_counterexample",
  "contradicts_candidate",
];
/** All a deterministic host rule may say: nothing that asserts a connection. */
export const HOST_RULE_RELATIONS: readonly MathematicalRelation[] = [
  "insufficient_context",
  "related_but_not_applicable",
];
/** Relations that lean on the mathematics being established; never from a reasoning summary. */
export const ESTABLISHED_RELATIONS: readonly MathematicalRelation[] = [
  "supports_hypothesis",
  "provides_counterexample",
  "contradicts_candidate",
];
export const ASSESSORS = ["person", "host-rule"] as const;
export type Assessor = (typeof ASSESSORS)[number];

// ---------------------------------------------------------------------------
// Result kinds: what a result says it is, in the repository's own words.
// ---------------------------------------------------------------------------
export const RESULT_KINDS = [
  "counterexample",
  "obstruction",
  "threshold",
  "conditional",
  "statement",
] as const;
export type ResultKind = (typeof RESULT_KINDS)[number];
export const KIND_WORDS: Record<ResultKind, string> = {
  counterexample: "counterexample",
  obstruction: "obstruction or no-go result",
  threshold: "bound, threshold or critical case",
  conditional: "conditional result",
  statement: "stated result",
};
/**
 * The challenge groups of a challenge search, by kind. Grouping follows the
 * words of the repository's own titles and summaries, never a judgment of how
 * a result bears on a hypothesis.
 */
export const CHALLENGE_GROUPS = [
  "counterexamples",
  "boundaries",
  "stronger_assumptions",
  "stated_results",
] as const;
export type ChallengeGroup = (typeof CHALLENGE_GROUPS)[number];
export const CHALLENGE_GROUP_OF: Record<ResultKind, ChallengeGroup> = {
  counterexample: "counterexamples",
  obstruction: "counterexamples",
  threshold: "boundaries",
  conditional: "stronger_assumptions",
  statement: "stated_results",
};
export const CHALLENGE_GROUP_WORDS: Record<ChallengeGroup, string> = {
  counterexamples: "Counterexamples and no-go results",
  boundaries: "Bounds, thresholds and critical cases",
  stronger_assumptions: "Conditional results (stronger assumptions)",
  stated_results: "Stated results that share terms (no stance established)",
};

// ---------------------------------------------------------------------------
// Findings: what the deterministic substrate stage can establish by itself.
// ---------------------------------------------------------------------------
export const FINDINGS = [
  "no_result",
  "results_found",
  "insufficient_grounding",
  "formalization_present",
  "formalization_absent",
  "reasoning_summary_present",
  "unverified_present",
  "assumptions_unmapped",
  "challenge_material",
  "no_challenge_found",
] as const;
export type FindingId = (typeof FINDINGS)[number];
/** A finding carries numbers, never words: the words are `findingText`'s, here, once. */
export interface Finding {
  id: FindingId;
  n: number | null;
  of: number | null;
}
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** The sentence for a finding. The only place these words are written. */
export function findingText(f: Finding): string {
  const n = f.n ?? 0;
  const of = f.of ?? 0;
  switch (f.id) {
    case "no_result":
      return "No relevant result found: nothing in the substrate shares enough of the query's terms.";
    case "results_found":
      return `${n} result ${plural(n, "family shares", "families share")} terms with the query. Shared words are not applicability: how any of them bears on the question has not been established.`;
    case "insufficient_grounding":
      return `Insufficient mathematical grounding: the strongest match shares ${n} of the query's ${of} terms.`;
    case "formalization_present":
      return `Formalization exists for ${n} of ${of}: a Lean formalization is present in the repository at this commit. Present is not checked here, and a formalization is not an empirical validation.`;
    case "formalization_absent":
      return "No formalization found: none of these results has a Lean formalization in the repository at this commit.";
    case "reasoning_summary_present":
      return `${n} of ${of} also ${plural(n, "has", "have")} a released reasoning summary. A reasoning summary is not a proof.`;
    case "unverified_present":
      return `${n} of ${of} ${plural(n, "is", "are")} listed with incomplete metadata and cannot be cited.`;
    case "assumptions_unmapped":
      return "No result's assumptions have been mapped to the simulator. Until a person states the assumptions that connect a result to the experiment, it bears on no simulated outcome.";
    case "challenge_material":
      return `${n} ${plural(n, "result states", "results state")} a counterexample, an obstruction, a bound or a condition and ${plural(n, "shares", "share")} terms with the hypothesis. Read ${plural(n, "it", "them")} before treating the framing as settled; whether ${plural(n, "it bears", "they bear")} on it has not been established.`;
    case "no_challenge_found":
      return "No counterexample, obstruction, bound or conditional result shares terms with the hypothesis. That is not support: this substrate holds nothing that challenges it in these words.";
  }
}

// ---------------------------------------------------------------------------
// Bounds. Every request and every answer is bounded.
// ---------------------------------------------------------------------------
export const SEARCH_MODES = ["context", "challenge"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];
export const FORMALIZATION_FILTERS = ["required", "preferred", "any"] as const;
export type FormalizationFilter = (typeof FORMALIZATION_FILTERS)[number];
export const MATH_LIMITS = {
  query: 300,
  hypothesis: 1000,
  disciplineName: 80,
  results: 8,
  defaultResults: 5,
  /** Terms a query is reduced to; the rest are ignored, and the answer says how many were. */
  queryTerms: 24,
  matchedTerms: 12,
  title: 300,
  summary: 1600,
  abstract: 1600,
  scope: 4000,
  annotation: 120,
  note: 400,
  notes: 4,
  manuscriptsPerFamily: 16,
  statementsPerFamily: 24,
  namesPerStatement: 16,
  leanName: 160,
  kindBasis: 6,
  /** Entries in one proposal's mathematical basis. */
  basisEntries: 6,
  assumptions: 6,
  assumptionText: 300,
  rationale: 600,
  /** Bytes, measured on the UTF-8 encoding. */
  statusResponse: 8 * 1024,
  searchRequest: 4 * 1024,
  inspectRequest: 1024,
  searchResponse: 64 * 1024,
  inspectResponse: 128 * 1024,
} as const;

// ---------------------------------------------------------------------------
// A mathematical basis entry: one result a proposal cites, and how.
// ---------------------------------------------------------------------------
/**
 * One result a proposal cites as its mathematical basis — the answer to
 * "what mathematics led to this experiment?". It travels with the proposal
 * into the definition a person authorizes, the registry's pre-registration
 * and the sealed record, so its digest changes if the substrate revision
 * does.
 */
export interface MathematicalBasisEntry {
  repository: SubstrateRepository;
  /** The substrate repository's commit the result was read at. */
  commit: string;
  /** The substrate index's content SHA-256: the revision of the index that supplied it. */
  index_sha256: string;
  result_family: string;
  /** The family's title as indexed, for reading; the identifiers above are what count. */
  title: string;
  /** The manuscript cited, if one is; otherwise the family as a whole. */
  manuscript_path: string | null;
  formalization_path: string | null;
  /** When the entry cites the family's released reasoning summary. */
  reasoning_summary_path: string | null;
  status: MathematicalStatus;
  relation: MathematicalRelation;
  /** The assumptions that connect the result to the experiment, as stated by the assessor. */
  assumptions: string[];
  rationale: string;
  assessed_by: Assessor;
}
export const BASIS_FIELDS = [
  "repository",
  "commit",
  "index_sha256",
  "result_family",
  "title",
  "manuscript_path",
  "formalization_path",
  "reasoning_summary_path",
  "status",
  "relation",
  "assumptions",
  "rationale",
  "assessed_by",
] as const;

/**
 * The rules a basis entry's fields must satisfy together, beyond each field's
 * own shape (which the validators check). Returns the broken rules; empty
 * when the entry is admissible. Shared by the browser, the route and the
 * runtime, so all three refuse the same entries.
 */
export function basisRuleErrors(e: MathematicalBasisEntry): string[] {
  const errors: string[] = [];
  if (e.status === "unverified")
    errors.push(
      "an unverified result is discoverable but not admissible: it cannot be a mathematical basis",
    );
  if (CONNECTING_RELATIONS.includes(e.relation)) {
    if (!e.assumptions.length)
      errors.push(
        `"${e.relation}" asserts a connection, so it must state the assumptions that make it`,
      );
    if (!e.rationale.trim())
      errors.push(`"${e.relation}" asserts a connection, so it needs a rationale`);
  }
  if (e.assessed_by === "host-rule" && !HOST_RULE_RELATIONS.includes(e.relation))
    errors.push(
      "a host rule may only say insufficient_context or related_but_not_applicable; any other relation needs a person",
    );
  if (e.status === "reasoning-summary") {
    if (e.reasoning_summary_path === null)
      errors.push("a reasoning-summary entry names the summary it cites");
    if (e.manuscript_path !== null || e.formalization_path !== null)
      errors.push(
        "a reasoning-summary entry cites the summary alone, not a manuscript or a formalization",
      );
    if (ESTABLISHED_RELATIONS.includes(e.relation))
      errors.push(
        `a reasoning summary is not a proof, so it cannot carry "${e.relation}"`,
      );
  } else {
    if (e.reasoning_summary_path !== null)
      errors.push(
        "an entry that names a reasoning summary has the status reasoning-summary",
      );
    // A manuscript outside its family's Lean scope is a manuscript, even when
    // the family has a formalization: the repository does not say it is formalized.
    if ((e.status === "formalized") !== (e.formalization_path !== null))
      errors.push(
        "an entry names a formalization exactly when what it cites is formalized",
      );
  }
  return errors;
}

type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
/** Text a person or the index wrote: bounded, no control or bidirectional characters. */
const textOk = (v: unknown, max: number, min = 0): v is string =>
  typeof v === "string" && v.length >= min && v.length <= max && !UNSAFE_TEXT.test(v);

/**
 * One basis entry, checked field by field and then by the rules that tie the
 * fields together. Nothing is coerced, trimmed or defaulted: an entry is
 * returned as it came, or refused with its reasons.
 */
export function parseBasisEntry(
  v: unknown,
  at = "mathematical_basis",
): Checked<MathematicalBasisEntry> {
  const errors: string[] = [];
  const fail = (field: string, why: string) => errors.push(`${at}.${field}: ${why}`);
  if (!isRecord(v)) return { ok: false, errors: [`${at}: expected an object`] };
  for (const k of Object.keys(v))
    if (!(BASIS_FIELDS as readonly string[]).includes(k))
      fail(k.slice(0, 40), "unknown field");
  for (const k of BASIS_FIELDS) if (!(k in v)) fail(k, "missing field");
  if (errors.length) return { ok: false, errors };
  if (!isSubstrate(v.repository)) {
    fail("repository", "not a mathematical substrate R.A.I.N. holds");
    return { ok: false, errors };
  }
  const rules = SUBSTRATES[v.repository];
  if (typeof v.commit !== "string" || !COMMIT_SHA.test(v.commit))
    fail("commit", "a substrate result names the 40-hex commit it was read at");
  if (typeof v.index_sha256 !== "string" || !SHA256_HEX.test(v.index_sha256))
    fail("index_sha256", "malformed index hash");
  if (typeof v.result_family !== "string" || !rules.family.test(v.result_family))
    fail("result_family", "malformed result family");
  if (!textOk(v.title, MATH_LIMITS.title, 1)) fail("title", "missing or malformed title");
  const path = (field: string, value: unknown, pattern: RegExp) => {
    if (value === null) return;
    if (
      typeof value !== "string" ||
      !pattern.test(value) ||
      !SAFE_RELATIVE_PATH.test(value)
    )
      fail(field, "not a path this substrate names");
  };
  path("manuscript_path", v.manuscript_path, rules.manuscriptPath);
  path("formalization_path", v.formalization_path, rules.formalizationPath);
  path("reasoning_summary_path", v.reasoning_summary_path, rules.reasoningSummaryPath);
  if (
    typeof v.formalization_path === "string" &&
    v.formalization_path !== `lean/docs/${String(v.result_family)}.md`
  )
    fail("formalization_path", "is not its family's scope page");
  if (!MATHEMATICAL_STATUSES.includes(v.status as MathematicalStatus))
    fail("status", "not in the status vocabulary");
  if (!MATHEMATICAL_RELATIONS.includes(v.relation as MathematicalRelation))
    fail("relation", "not in the relation vocabulary");
  if (!ASSESSORS.includes(v.assessed_by as Assessor))
    fail("assessed_by", "not an assessor");
  if (
    !Array.isArray(v.assumptions) ||
    v.assumptions.length > MATH_LIMITS.assumptions ||
    !v.assumptions.every(
      (a) => textOk(a, MATH_LIMITS.assumptionText, 1) && a.trim().length > 0,
    )
  )
    fail(
      "assumptions",
      `up to ${MATH_LIMITS.assumptions} stated assumptions of 1 to ${MATH_LIMITS.assumptionText} characters`,
    );
  if (!textOk(v.rationale, MATH_LIMITS.rationale))
    fail("rationale", "malformed rationale");
  if (errors.length) return { ok: false, errors };
  const entry = v as unknown as MathematicalBasisEntry;
  for (const rule of basisRuleErrors(entry)) errors.push(`${at}: ${rule}`);
  return errors.length ? { ok: false, errors } : { ok: true, value: entry };
}

/**
 * A proposal's whole basis: at most `basisEntries` entries, no result cited
 * twice, and one substrate revision — an experiment's mathematics comes from
 * one repository, one commit and one index, or it is refused.
 */
export function parseBasis(v: unknown): Checked<MathematicalBasisEntry[]> {
  if (!Array.isArray(v))
    return { ok: false, errors: ["mathematical_basis: expected a list"] };
  if (v.length > MATH_LIMITS.basisEntries)
    return {
      ok: false,
      errors: [`mathematical_basis: at most ${MATH_LIMITS.basisEntries} entries`],
    };
  const errors: string[] = [];
  const entries: MathematicalBasisEntry[] = [];
  v.forEach((item, i) => {
    const r = parseBasisEntry(item, `mathematical_basis[${i}]`);
    if (r.ok) entries.push(r.value);
    else errors.push(...r.errors);
  });
  if (errors.length) return { ok: false, errors: errors.slice(0, 12) };
  const cited = entries.map(
    (e) =>
      `${e.result_family}|${e.manuscript_path ?? ""}|${e.reasoning_summary_path ?? ""}`,
  );
  if (new Set(cited).size !== cited.length)
    errors.push("mathematical_basis: the same result is cited twice");
  const revisions = new Set(
    entries.map((e) => `${e.repository}@${e.commit}#${e.index_sha256}`),
  );
  if (revisions.size > 1)
    errors.push(
      "mathematical_basis: entries come from more than one substrate revision; an experiment's mathematics is read at one commit of one index",
    );
  return errors.length ? { ok: false, errors } : { ok: true, value: entries };
}
