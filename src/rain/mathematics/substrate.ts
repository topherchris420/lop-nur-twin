/**
 * The mathematical substrate, served: R.A.I.N.'s bounded operations over a
 * pinned index of a mathematics repository.
 *
 *   searchMathematics          query, discipline?, formalization?, limit? → results and findings
 *   inspectMathematicalResult  one result family → its record, every text bounded
 *   status                     which repository, which commit, which index
 *   verifyBasis                does a proposal's mathematical basis match this index?
 *
 * Everything here is read-only and deterministic. The index is checked
 * (`indexErrors`, its content hash included) before anything is served and is
 * then frozen; a search ranks with BM25 over the repository's own titles,
 * summaries and abstracts and reports which words matched where — never a
 * score, never a probability, never a relation. What a result has to do with
 * a research question is not decided here: the answer says what is
 * established (terms shared, a formalization present, nothing found) and the
 * rest is a person's to state. In challenge mode the search looks for what
 * could weaken a hypothesis — counterexamples, obstructions, bounds and
 * conditional results, by the repository's own words — and says so.
 *
 * There is no write operation, no file read, no network, no subprocess and no
 * model here: the index arrives as data, and every answer is a new object
 * built from it. Every answer names the repository, the commit, the index's
 * content hash and when it was produced.
 *
 * Server only.
 */
import { Refused } from "../errors.js";
import { UNSAFE_TEXT } from "../protocol.js";
import {
  CHALLENGE_GROUPS,
  CHALLENGE_GROUP_OF,
  FORMALIZATION_FILTERS,
  INSPECT_ENGINE,
  MATHEMATICS_SCHEMA,
  MATH_LIMITS,
  SEARCH_ENGINE,
  SEARCH_MODES,
  basisRuleErrors,
  isSubstrate,
  type ChallengeGroup,
  type Finding,
  type FormalizationFilter,
  type MathematicalBasisEntry,
  type SearchMode,
} from "./contracts.js";
import {
  indexErrors,
  type IndexedFamily,
  type KindBasis,
  type SubstrateIndex,
} from "./substrateIndex.js";

/** An index that may not be served, and why. The reason is safe to show. */
export class SubstrateUnavailable extends Error {}

export interface Provenance {
  repository: string;
  repository_url: string;
  commit: string;
  commit_date: string | null;
  index_sha256: string;
  generated_at: string;
  retrieved_at: string;
}
export interface SearchInput {
  query: string;
  discipline: string | null;
  formalization: FormalizationFilter;
  limit: number;
  mode: SearchMode;
  hypothesis: string | null;
}
export type MatchField =
  "title" | "summary" | "manuscripts" | "abstracts" | "discipline" | "formalization";
export interface ResultSummary {
  family: string;
  title: string;
  discipline: { id: number; name: string } | null;
  status: IndexedFamily["status"];
  kinds: IndexedFamily["kinds"];
  kind_basis: KindBasis[];
  formalization_path: string | null;
  statements: number;
  reasoning_summary_path: string | null;
  manuscripts: {
    id: string;
    title: string;
    path: string;
    status: IndexedFamily["status"] | "reasoning-summary";
    annotation: string | null;
  }[];
  matched: { term: string; fields: MatchField[] }[];
  rank: number;
  group: ChallengeGroup | null;
}
export interface Excerpt {
  text: string;
  /** The whole text's length; `truncated` says whether `text` is all of it. */
  chars: number;
  truncated: boolean;
  /** Where the text is, verbatim, at the pinned commit. */
  source: string;
}

const STOP = new Set(
  (
    "a an and are as at be been but by can could did do does each every for from had has have how " +
    "if in into is it its may might more most no not of on or other our over such than that the their " +
    "them then there these they this those through to under up very was we were what when where which " +
    "while who why will with within would without also both either any all some same so only one two " +
    "about above after against along among around before behind below between beyond during less " +
    "many much near off once since than toward towards until upon via whether yet " +
    "make makes made making take takes took get gets got let lets like likely just still even " +
    "prove proves proved proof show shows shown result results theorem theorems paper papers give gives " +
    "new give using use used establish establishes main"
  ).split(" "),
);

/**
 * Words as the search sees them: accents folded ("Mézard" → "mezard"), TeX
 * commands and HTML tags dropped, lower case, a plural `s` stripped. Small
 * and deterministic on purpose: this ranks, it does not understand.
 */
export function searchTerms(text: string): string[] {
  const plain = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/<\/?[a-z]+>/gi, " ")
    .replace(/\\[A-Za-z]+/g, " ")
    .toLowerCase();
  const out: string[] = [];
  for (const raw of plain.match(/[a-z][a-z0-9]*/g) ?? []) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    let w = raw;
    if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
    else if (w.length > 4 && w.endsWith("s") && !/(?:ss|us|is)$/.test(w))
      w = w.slice(0, -1);
    out.push(w);
  }
  return out;
}

interface Doc {
  family: IndexedFamily;
  /** Term frequencies, each field's terms counted by its weight. */
  tf: Map<string, number>;
  length: number;
  fields: Record<MatchField, Set<string>>;
}
const FIELD_WEIGHT: Record<MatchField, number> = {
  title: 3,
  summary: 2,
  manuscripts: 2,
  abstracts: 1,
  discipline: 1,
  formalization: 1,
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}
const bounded = (text: string, max: number, source: string): Excerpt => ({
  text: text.length > max ? text.slice(0, max) : text,
  chars: text.length,
  truncated: text.length > max,
  source,
});
const clean = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");

export class MathematicalSubstrate {
  readonly index: SubstrateIndex;
  private readonly docs: Doc[];
  private readonly idf = new Map<string, number>();
  /** Terms rare enough to say something: in at most a fifth of the families. */
  private readonly informative = new Set<string>();
  private readonly averageLength: number;
  private readonly now: () => Date;

  private constructor(index: SubstrateIndex, now: () => Date) {
    this.index = index;
    this.now = now;
    this.docs = index.families.map((family) => {
      const fields = {} as Record<MatchField, Set<string>>;
      const text: Record<MatchField, string> = {
        title: `${family.title} ${family.overview_title ?? ""}`,
        summary: family.summary,
        manuscripts: family.manuscripts.map((m) => m.title).join(" "),
        abstracts: family.manuscripts.map((m) => m.abstract).join(" "),
        discipline: family.discipline?.name ?? "",
        formalization: family.formalization
          ? `${family.formalization.title} ${family.formalization.statements.map((s) => s.result).join(" ")}`
          : "",
      };
      const tf = new Map<string, number>();
      let length = 0;
      for (const f of Object.keys(text) as MatchField[]) {
        const t = searchTerms(text[f]);
        fields[f] = new Set(t);
        for (const term of t) tf.set(term, (tf.get(term) ?? 0) + FIELD_WEIGHT[f]);
        length += t.length * FIELD_WEIGHT[f];
      }
      return { family, tf, length, fields };
    });
    const df = new Map<string, number>();
    for (const d of this.docs)
      for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    const n = this.docs.length;
    for (const [t, k] of df) {
      this.idf.set(t, Math.log(1 + (n - k + 0.5) / (k + 0.5)));
      if (k <= n / 5) this.informative.add(t);
    }
    this.averageLength = n ? this.docs.reduce((s, d) => s + d.length, 0) / n : 0;
  }

  /** Check, freeze and serve an index; refuse one that fails any check. */
  static load(raw: unknown, now: () => Date = () => new Date()): MathematicalSubstrate {
    const errors = indexErrors(raw);
    if (errors.length)
      throw new SubstrateUnavailable(
        "the bundled substrate index failed its checks: " + errors.slice(0, 3).join("; "),
      );
    return new MathematicalSubstrate(deepFreeze(raw as SubstrateIndex), now);
  }

  provenance(): Provenance {
    const ix = this.index;
    return {
      repository: ix.repository,
      repository_url: ix.repository_url,
      commit: ix.commit,
      commit_date: ix.commit_date,
      index_sha256: ix.content_sha256,
      generated_at: ix.generated_at,
      retrieved_at: this.now().toISOString(),
    };
  }

  /** The substrate's identity, for the Systems Room and the instrument's header. */
  status() {
    const ix = this.index;
    return {
      schema: MATHEMATICS_SCHEMA,
      kind: "math-status" as const,
      available: true,
      reason: null,
      substrate: {
        repository: ix.repository,
        repository_url: ix.repository_url,
        commit: ix.commit,
        commit_date: ix.commit_date,
        index_schema: ix.schema,
        index_sha256: ix.content_sha256,
        generated_at: ix.generated_at,
        license: ix.license.spdx,
        review_status: ix.catalogue.review_status,
        formalization_scope: ix.catalogue.formalization_scope,
        counts: { ...ix.counts },
        disciplines: ix.disciplines.map((d) => ({ ...d })),
        collection: ix.collection.sections.map((s) => ({
          heading: s.heading.slice(0, 80),
          text: s.text.slice(0, 1600),
        })),
      },
    };
  }

  private family(id: string): IndexedFamily {
    const f = this.index.families.find((x) => x.id === id);
    if (!f)
      throw new Refused(
        404,
        `no result family ${id} in ${this.index.repository} at ${this.index.commit.slice(0, 12)}`,
      );
    return f;
  }

  /** `search_mathematics`: bounded in, bounded out. */
  searchMathematics(input: SearchInput, requestId: string) {
    const query = clean(String(input.query ?? ""));
    if (!query || query.length > MATH_LIMITS.query || UNSAFE_TEXT.test(query))
      throw new Refused(422, `a query of 1 to ${MATH_LIMITS.query} characters`);
    if (!SEARCH_MODES.includes(input.mode)) throw new Refused(422, "unknown search mode");
    if (!FORMALIZATION_FILTERS.includes(input.formalization))
      throw new Refused(422, "formalization must be required, preferred or any");
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MATH_LIMITS.results
    )
      throw new Refused(422, `a limit from 1 to ${MATH_LIMITS.results}`);
    const hypothesis = input.hypothesis === null ? null : clean(String(input.hypothesis));
    if (
      hypothesis !== null &&
      (hypothesis.length > MATH_LIMITS.hypothesis || UNSAFE_TEXT.test(hypothesis))
    )
      throw new Refused(
        422,
        `a hypothesis of at most ${MATH_LIMITS.hypothesis} characters`,
      );
    if (input.mode === "challenge" && !hypothesis)
      throw new Refused(
        422,
        "a challenge searches against a candidate hypothesis; none was given",
      );
    let discipline: { id: number; name: string } | null = null;
    if (input.discipline !== null) {
      discipline =
        this.index.disciplines.find((d) => d.name === input.discipline) ?? null;
      if (!discipline) throw new Refused(422, "not one of the substrate's disciplines");
    }
    // A challenge searches the candidate's own words; a context search, the question's.
    const all = [
      ...new Set(searchTerms(input.mode === "challenge" ? hypothesis! : query)),
    ];
    const terms = all.slice(0, MATH_LIMITS.queryTerms);
    const k1 = 1.2,
      b = 0.75;
    const scored: { doc: Doc; score: number; hits: string[] }[] = [];
    for (const doc of this.docs) {
      if (discipline && doc.family.discipline?.id !== discipline.id) continue;
      if (input.formalization === "required" && !doc.family.formalization) continue;
      let score = 0;
      const hits: string[] = [];
      for (const t of terms) {
        const tf = doc.tf.get(t) ?? 0;
        if (!tf) continue;
        hits.push(t);
        const norm = k1 * (1 - b + (b * doc.length) / (this.averageLength || 1));
        score += (this.idf.get(t)! * tf * (k1 + 1)) / (tf + norm);
      }
      if (hits.length) scored.push({ doc, score, hits });
    }
    scored.sort(
      (x, y) => y.score - x.score || (x.doc.family.id < y.doc.family.id ? -1 : 1),
    );
    // One shared word is not relevance, and a common one says nothing: a
    // query with three or more informative terms needs two of them matched,
    // unless a result scores close to the best.
    const informative = terms.filter((t) => this.informative.has(t));
    const needed = informative.length >= 3 ? 2 : 1;
    const floor = scored.length ? scored[0]!.score * 0.5 : 0;
    let kept = scored.filter(
      (s) =>
        s.hits.filter((t) => this.informative.has(t)).length >= needed ||
        s.score >= floor,
    );
    if (input.formalization === "preferred")
      kept = [
        ...kept.filter((s) => s.doc.family.formalization),
        ...kept.filter((s) => !s.doc.family.formalization),
      ];
    const groupOf = (f: IndexedFamily): ChallengeGroup => {
      for (const g of CHALLENGE_GROUPS)
        if (f.kinds.some((k) => CHALLENGE_GROUP_OF[k] === g)) return g;
      return "stated_results";
    };
    // A challenge looks first for what could weaken the hypothesis — every
    // counterexample, obstruction, bound and conditional result, by relevance
    // — and only then for stated results that merely share its terms.
    if (input.mode === "challenge")
      kept = [
        ...kept.filter((s) => groupOf(s.doc.family) !== "stated_results"),
        ...kept.filter((s) => groupOf(s.doc.family) === "stated_results"),
      ];
    const shown = kept.slice(0, input.limit);
    const results: ResultSummary[] = shown.map((s, i) =>
      this.summary(
        s.doc,
        s.hits,
        i + 1,
        input.mode === "challenge" ? groupOf(s.doc.family) : null,
      ),
    );
    const findings: Finding[] = [];
    if (!kept.length) findings.push({ id: "no_result", n: null, of: null });
    else {
      findings.push({ id: "results_found", n: kept.length, of: null });
      const best = Math.max(...kept.map((s) => s.hits.length));
      if (best * 2 < terms.length)
        findings.push({ id: "insufficient_grounding", n: best, of: terms.length });
      const formalized = shown.filter((s) => s.doc.family.formalization).length;
      findings.push(
        formalized
          ? { id: "formalization_present", n: formalized, of: shown.length }
          : { id: "formalization_absent", n: null, of: null },
      );
      const summaries = shown.filter((s) => s.doc.family.reasoning_summary).length;
      if (summaries)
        findings.push({
          id: "reasoning_summary_present",
          n: summaries,
          of: shown.length,
        });
      const unverified = shown.filter((s) => s.doc.family.status === "unverified").length;
      if (unverified)
        findings.push({ id: "unverified_present", n: unverified, of: shown.length });
      findings.push({ id: "assumptions_unmapped", n: null, of: null });
    }
    if (input.mode === "challenge") {
      const challenging = kept.filter(
        (s) => groupOf(s.doc.family) !== "stated_results",
      ).length;
      findings.push(
        challenging
          ? { id: "challenge_material", n: challenging, of: null }
          : { id: "no_challenge_found", n: null, of: null },
      );
    }
    return {
      schema: MATHEMATICS_SCHEMA,
      kind: "math-results" as const,
      request_id: requestId,
      engine: SEARCH_ENGINE,
      query,
      mode: input.mode,
      hypothesis,
      filters: {
        discipline: discipline?.name ?? null,
        formalization: input.formalization,
        limit: input.limit,
      },
      terms: {
        used: terms.slice(0, MATH_LIMITS.queryTerms),
        ignored: all.length - terms.length,
      },
      matches: kept.length,
      results,
      findings,
      provenance: this.provenance(),
    };
  }

  private summary(
    doc: Doc,
    hits: string[],
    rank: number,
    group: ChallengeGroup | null,
  ): ResultSummary {
    const f = doc.family;
    return {
      family: f.id,
      title: f.title.slice(0, MATH_LIMITS.title),
      discipline: f.discipline ? { ...f.discipline } : null,
      status: f.status,
      kinds: [...f.kinds],
      kind_basis: f.kind_basis.slice(0, MATH_LIMITS.kindBasis).map((k) => ({ ...k })),
      formalization_path: f.formalization?.path ?? null,
      statements: f.formalization?.statements.length ?? 0,
      reasoning_summary_path: f.reasoning_summary?.path ?? null,
      manuscripts: f.manuscripts.slice(0, MATH_LIMITS.manuscriptsPerFamily).map((m) => ({
        id: m.id,
        title: m.title.slice(0, MATH_LIMITS.title),
        path: m.path,
        status: m.status,
        annotation: m.annotation,
      })),
      matched: hits.slice(0, MATH_LIMITS.matchedTerms).map((term) => ({
        term,
        fields: (Object.keys(doc.fields) as MatchField[]).filter((k) =>
          doc.fields[k].has(term),
        ),
      })),
      rank,
      group,
    };
  }

  /** `inspect_mathematical_result`: one family, every text bounded and attributed to its file. */
  inspectMathematicalResult(input: { family: string }, requestId: string) {
    const id = String(input.family ?? "");
    if (!/^[0-9]{3}$/.test(id)) throw new Refused(422, "a result family is three digits");
    const f = this.family(id);
    const ix = this.index;
    return {
      schema: MATHEMATICS_SCHEMA,
      kind: "math-record" as const,
      request_id: requestId,
      engine: INSPECT_ENGINE,
      family: {
        id: f.id,
        title: f.title.slice(0, MATH_LIMITS.title),
        overview_title: f.overview_title?.slice(0, MATH_LIMITS.title) ?? null,
        discipline: f.discipline ? { ...f.discipline } : null,
        summary: bounded(f.summary, MATH_LIMITS.summary, "CONTENTS.md"),
        status: f.status,
        kinds: [...f.kinds],
        kind_basis: f.kind_basis.slice(0, MATH_LIMITS.kindBasis).map((k) => ({ ...k })),
        issues: f.issues.slice(0, 8),
        manuscripts: f.manuscripts
          .slice(0, MATH_LIMITS.manuscriptsPerFamily)
          .map((m) => ({
            id: m.id,
            title: m.title.slice(0, MATH_LIMITS.title),
            path: m.path,
            annotation: m.annotation,
            abstract: bounded(m.abstract, MATH_LIMITS.abstract, "CONTENTS.md"),
            date: m.date,
            citation: m.citation ? { ...m.citation } : null,
            notes: m.notes.slice(0, MATH_LIMITS.notes),
            readme_sha256: m.readme_sha256,
            status: m.status,
            main_result_catalogued: m.main_result_catalogued,
            issues: m.issues.slice(0, 8),
          })),
        formalization: f.formalization
          ? {
              path: f.formalization.path,
              sha256: f.formalization.sha256,
              title: f.formalization.title.slice(0, MATH_LIMITS.title),
              papers: [...f.formalization.papers],
              scope: bounded(
                f.formalization.scope,
                MATH_LIMITS.scope,
                f.formalization.path,
              ),
              statements: f.formalization.statements
                .slice(0, MATH_LIMITS.statementsPerFamily)
                .map((s) => ({
                  ...s,
                  theorems: s.theorems.slice(0, MATH_LIMITS.namesPerStatement),
                  definitions: s.definitions.slice(0, MATH_LIMITS.namesPerStatement),
                  permitted_axioms: s.permitted_axioms.slice(
                    0,
                    MATH_LIMITS.namesPerStatement,
                  ),
                })),
              review_status: ix.catalogue.review_status,
              catalogue_scope: ix.catalogue.formalization_scope,
            }
          : null,
        reasoning_summary: f.reasoning_summary ? { ...f.reasoning_summary } : null,
      },
      provenance: this.provenance(),
    };
  }

  /**
   * Whether each basis entry names this repository, this commit and this
   * index, and says about its result exactly what the index holds. A
   * pre-registration whose basis does not match is refused: an experiment
   * never changes its substrate revision silently.
   */
  verifyBasis(entries: readonly MathematicalBasisEntry[]): string[] {
    const errors: string[] = [];
    const ix = this.index;
    entries.forEach((e, i) => {
      const at = `mathematical_basis[${i}]`;
      if (!isSubstrate(e.repository) || e.repository !== ix.repository) {
        errors.push(`${at}: names a substrate this runtime does not hold`);
        return;
      }
      if (e.commit !== ix.commit || e.index_sha256 !== ix.content_sha256) {
        errors.push(
          `${at}: was read at ${String(e.commit).slice(0, 12)}, index ${String(e.index_sha256).slice(0, 12)}; this substrate is ${ix.commit.slice(0, 12)}, index ${ix.content_sha256.slice(0, 12)}. Attach it again from the substrate in use`,
        );
        return;
      }
      const f = ix.families.find((x) => x.id === e.result_family);
      if (!f) {
        errors.push(`${at}: no result family ${e.result_family} at this commit`);
        return;
      }
      if (e.title !== f.title.slice(0, MATH_LIMITS.title))
        errors.push(`${at}: the title is not the family's`);
      let status: string;
      if (e.reasoning_summary_path !== null) {
        if (e.reasoning_summary_path !== f.reasoning_summary?.path)
          errors.push(`${at}: the family has no such reasoning summary`);
        status = "reasoning-summary";
      } else if (e.manuscript_path !== null) {
        const m = f.manuscripts.find((x) => x.path === e.manuscript_path);
        if (!m) errors.push(`${at}: the family holds no such manuscript`);
        status = m?.status ?? "unverified";
      } else status = f.status;
      if (e.status !== status)
        errors.push(`${at}: the index holds this result as ${status}, not ${e.status}`);
      const formalization =
        status === "formalized" ? (f.formalization?.path ?? null) : null;
      if (e.formalization_path !== formalization)
        errors.push(`${at}: the formalization path is not the index's`);
      for (const rule of basisRuleErrors(e)) errors.push(`${at}: ${rule}`);
    });
    return errors;
  }
}
