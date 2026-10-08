/**
 * The deterministic indexer: one repository's catalogue at one commit → a
 * substrate index (`./substrateIndex.ts`).
 *
 * It reads `openai/math`'s own catalogue files and nothing else — the
 * manuscript map (`CONTENTS.md`), the overview that classifies each family by
 * discipline (`overview.tex`), the README's reasoning-summary table and its
 * account of how the collection was produced, the formalization catalogue
 * (`lean/formalization.yaml`), each family's Lean scope page and comparator
 * configs, and each manuscript's README for its citation and any attribution
 * note — and checks every path they name exists at the commit, without
 * opening a PDF, a LaTeX source or a Lean file.
 *
 * What it decides, and from what:
 *
 * - a family is **formalized** when its catalogue entry links a Lean scope
 *   page that is present; a manuscript is formalized when that page lists it;
 * - a family or manuscript is **unverified** when something its catalogue
 *   entry needs is missing or inconsistent (no discipline, no README, a file
 *   that is not there) — the issue is recorded, never repaired;
 * - an entry that is **malformed** — a family number that is not three
 *   digits, a duplicate, a link outside `preprints/` — is refused: recorded in
 *   `rejected` with its reason and kept out of the records;
 * - a family's **kinds** come from words in its own title and summary
 *   ("counterexample", "disproves", "threshold", "conditional"), and every
 *   kind keeps the phrase it came from.
 *
 * Deterministic: the same files give the same index, byte for byte, apart from
 * `generated_at`, which the content hash leaves out. Pure: a `SourceTree`
 * supplies the files, so the suite indexes a fixture and the CLI a checkout.
 */
import { canonicalJson, sha256 } from "../sha256.js";
import {
  SUBSTRATES,
  SUBSTRATE_INDEX_SCHEMA,
  SAFE_RELATIVE_PATH,
  type MathematicalStatus,
  type ResultKind,
} from "./contracts.js";
import {
  contentSha256,
  type IndexedCitation,
  type IndexedFamily,
  type IndexedFormalization,
  type IndexedManuscript,
  type IndexedStatement,
  type KindBasis,
  type SubstrateIndex,
} from "./substrateIndex.js";

/** The repository as the indexer sees it: text files by path, and whether a path exists. */
export interface SourceTree {
  /** A repository-relative file's UTF-8 text, or null when it is not there. */
  read(path: string): string | null;
  /** Whether a repository-relative file is there. Its bytes are not read. */
  exists(path: string): boolean;
}
export interface IndexInput {
  tree: SourceTree;
  commit: string;
  commitDate: string | null;
  generatedAt: string;
  generator: string;
}

const RULES = SUBSTRATES["openai/math"];
const REPOSITORY = "openai/math" as const;

// ---------------------------------------------------------------------------
// Small parsers. Each one is strict about the shape it accepts.
// ---------------------------------------------------------------------------

/** Normalise line endings; the catalogue is LF, but a checkout may not be. */
const lines = (text: string) => text.replace(/\r\n?/g, "\n").split("\n");

/**
 * `[label](target)` at `start` (the `[`), allowing parentheses inside the
 * target, as in `preprints/Sharp-integral-fillings-in-CAT(0)-spaces-…`.
 */
export function markdownLink(
  text: string,
  start = 0,
): { label: string; target: string; end: number } | null {
  if (text[start] !== "[") return null;
  let depth = 0,
    i = start;
  for (; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]" && --depth === 0) break;
  }
  if (i >= text.length || text[i + 1] !== "(") return null;
  const label = text.slice(start + 1, i);
  let parens = 0,
    j = i + 1;
  for (; j < text.length; j++) {
    if (text[j] === "(") parens++;
    else if (text[j] === ")" && --parens === 0) break;
  }
  if (j >= text.length) return null;
  return { label, target: text.slice(i + 2, j), end: j + 1 };
}

/** The balanced `{…}` groups after a TeX command at `start`. Escaped braces are text. */
export function texGroups(text: string, start: number, count: number): string[] | null {
  const out: string[] = [];
  let i = start;
  while (out.length < count) {
    while (i < text.length && /\s/.test(text[i]!)) i++;
    if (text[i] !== "{") return null;
    let depth = 0,
      j = i;
    for (; j < text.length; j++) {
      const c = text[j]!;
      if (c === "\\") {
        j++;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) break;
    }
    if (j >= text.length) return null;
    out.push(text.slice(i + 1, j));
    i = j + 1;
  }
  return out;
}

/** One YAML scalar as the catalogue writes it: bare, or double-quoted. */
function yamlScalar(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2)
    return v.slice(1, -1).replace(/\\(["\\])/g, "$1");
  return v;
}

interface Catalogue {
  version: string | null;
  scope: string | null;
  review: string | null;
  automation: string[];
  sources: Set<string>;
  mainResults: Set<string>;
  related: { id: string; relationship: string }[];
}
/**
 * The few fields of `lean/formalization.yaml` the index records. The file
 * follows the mathlib-initiative `formalization.yaml` schema; this reads it
 * line by line by indentation rather than pulling in a YAML library, and
 * records nothing it does not recognise.
 */
export function parseCatalogue(text: string | null): Catalogue {
  const c: Catalogue = {
    version: null,
    scope: null,
    review: null,
    automation: [],
    sources: new Set(),
    mainResults: new Set(),
    related: [],
  };
  if (text === null) return c;
  let top = "",
    sub = "";
  let pendingRelated: { id: string; relationship: string } | null = null;
  for (const line of lines(text)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const topKey = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (topKey) {
      top = topKey[1]!;
      sub = "";
      if (top === "version") c.version = yamlScalar(topKey[2]!);
      continue;
    }
    const subKey = /^ {2}([a-z_]+):\s*(.*)$/.exec(line);
    if (subKey) {
      sub = subKey[1]!;
      if (top === "status" && sub === "scope") c.scope = yamlScalar(subKey[2]!);
      if (top === "review" && sub === "status") c.review = yamlScalar(subKey[2]!);
      continue;
    }
    const item = /^\s*-?\s*([a-z_]+):\s*(.*)$/.exec(line);
    if (!item) continue;
    const [, key, value] = item as unknown as [string, string, string];
    if (top === "sources" && key === "id") {
      const id = yamlScalar(value);
      if (id.startsWith("../")) c.sources.add(id.slice(3));
    } else if (top === "related_formalizations") {
      if (key === "id") {
        pendingRelated = { id: yamlScalar(value), relationship: "" };
        c.related.push(pendingRelated);
      } else if (key === "relationship" && pendingRelated)
        pendingRelated.relationship = yamlScalar(value);
    } else if (top === "status" && sub === "main_results" && key === "comparator_config")
      c.mainResults.add("lean/" + yamlScalar(value));
    else if (top === "automation" && key === "method")
      c.automation.push(yamlScalar(value));
  }
  return c;
}

// ---------------------------------------------------------------------------
// Kinds, in the repository's own words.
// ---------------------------------------------------------------------------
const KIND_PATTERNS: [ResultKind, RegExp][] = [
  [
    "counterexample",
    /\bcounter-?examples?\b|\bdisprov(?:e|es|ed|ing)\b|\brefut(?:e|es|ed|ing|ation)\b/i,
  ],
  [
    "obstruction",
    /\bobstructions?\b|\bno-go\b|\bimpossib(?:le|ility)\b|\bthere (?:is|are) no\b|\bwith no\b|\bwithout\b|\bdoes not (?:hold|exist|admit|extend|imply|capture)\b|\bcannot\b/i,
  ],
  [
    "threshold",
    /\bthresholds?\b|\bcritical\b|\bsharp\b|\boptimal\b|\b(?:upper|lower) bounds?\b|\bphase transitions?\b|\bexponents?\b/i,
  ],
  [
    "conditional",
    /\bconditional(?:ly)?\b|\bassuming\b|\bunder (?:the )?(?:[A-Za-z’'–-]+ )?(?:hypothes[ie]s|assumptions?|conjectures?)\b/i,
  ],
];
export function kindsOf(
  title: string,
  summary: string,
  manuscriptTitles: readonly string[],
): { kinds: ResultKind[]; basis: KindBasis[] } {
  const basis: KindBasis[] = [];
  for (const [kind, pattern] of KIND_PATTERNS) {
    const fields: [KindBasis["field"], string][] = [
      ["title", title],
      ["summary", summary],
      ...manuscriptTitles.map((t): [KindBasis["field"], string] => [
        "manuscript-title",
        t,
      ]),
    ];
    for (const [field, text] of fields) {
      const m = pattern.exec(text);
      if (m) {
        basis.push({ kind, field, phrase: m[0] });
        break;
      }
    }
  }
  const kinds = basis.map((b) => b.kind);
  return kinds.length
    ? { kinds, basis: basis.slice(0, 6) }
    : { kinds: ["statement"], basis: [] };
}

// ---------------------------------------------------------------------------
// The catalogue files.
// ---------------------------------------------------------------------------
interface ContentsFamily {
  id: string;
  title: string;
  summary: string;
  lean: string | null;
  line: number;
  manuscripts: {
    title: string;
    target: string;
    annotation: string | null;
    abstract: string;
    line: number;
  }[];
  rejected: string[];
}
const FAMILY_LINE = /^\*\*([0-9]+)\. (.*?)\.\*\*(?:\s+(.*))?$/;
/** A line that sets out to be a family entry — a bold number and a period — well-formed or not. */
const FAMILY_CANDIDATE = /^\*\*[0-9]+\.\s/;
const LEAN_SUFFIX = /\s*\(\[Lean\]\(([^)\s]+)\)\)\s*$/;
const BLOCK_END = /^<\/?(?:td|tr|tbody|thead|table)\b/;

/** `CONTENTS.md`: families, their manuscripts and abstracts, and refusals. */
export function parseContents(text: string): {
  families: ContentsFamily[];
  rejected: { where: string; reason: string }[];
} {
  const families: ContentsFamily[] = [];
  const rejected: { where: string; reason: string }[] = [];
  const ls = lines(text);
  let current: ContentsFamily | null = null;
  const paragraph = (from: number) => {
    const out: string[] = [];
    let i = from;
    for (; i < ls.length; i++) {
      const l = ls[i]!;
      if (BLOCK_END.test(l.trim()) || l.startsWith("&emsp;[") || FAMILY_CANDIDATE.test(l))
        break;
      out.push(l);
    }
    return {
      text: out
        .join("\n")
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .join("\n\n"),
      next: i,
    };
  };
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]!;
    if (FAMILY_CANDIDATE.test(l)) {
      const m = FAMILY_LINE.exec(l);
      if (!m || !RULES.family.test(m[1]!)) {
        rejected.push({
          where: `CONTENTS.md:${i + 1}`,
          reason: "a family entry must read **NNN. Title.** with a three-digit number",
        });
        current = null;
        continue;
      }
      let rest = m[3] ?? "";
      const rest2 = paragraph(i + 1);
      if (rest2.text) rest = rest ? `${rest}\n\n${rest2.text}` : rest2.text;
      let lean: string | null = null;
      const leanMatch = LEAN_SUFFIX.exec(rest);
      if (leanMatch) {
        lean = leanMatch[1]!;
        rest = rest.slice(0, leanMatch.index).trimEnd();
      }
      current = {
        id: m[1]!,
        title: m[2]!.trim(),
        summary: rest.trim(),
        lean,
        line: i + 1,
        manuscripts: [],
        rejected: [],
      };
      families.push(current);
      continue;
    }
    if (l.startsWith("&emsp;[")) {
      const link = markdownLink(l, "&emsp;".length);
      const where = `CONTENTS.md:${i + 1}`;
      if (!current) {
        rejected.push({ where, reason: "a manuscript entry outside any family" });
        continue;
      }
      if (!link) {
        rejected.push({ where, reason: "a manuscript entry without a well-formed link" });
        current.rejected.push(where);
        continue;
      }
      const tail = l.slice(link.end).trim();
      const annotation = tail.startsWith("—") ? tail.slice(1).trim() : tail || null;
      const body = paragraph(i + 1);
      if (
        !RULES.manuscriptPath.test(link.target) ||
        !SAFE_RELATIVE_PATH.test(link.target)
      ) {
        rejected.push({
          where,
          reason:
            "a manuscript link must name preprints/<directory>/<file>.pdf inside the repository",
        });
        current.rejected.push(where);
        continue;
      }
      current.manuscripts.push({
        title: link.label.trim(),
        target: link.target,
        annotation: annotation ? annotation.slice(0, 120) : null,
        abstract: body.text,
        line: i + 1,
      });
    }
  }
  return { families, rejected };
}

/** `overview.tex`: each family's discipline and the overview's title for it. */
export function parseOverview(text: string | null): {
  disciplines: { id: number; name: string }[];
  entries: Map<string, { discipline: number; title: string }>;
} {
  const disciplines: { id: number; name: string }[] = [];
  const entries = new Map<string, { discipline: number; title: string }>();
  if (text === null) return { disciplines, entries };
  const pattern = /\\(cataloguesection|resultentry)(?=\s*\{)/g;
  let section: number | null = null;
  for (const m of text.matchAll(pattern)) {
    const start = m.index + m[0].length;
    if (m[1] === "cataloguesection") {
      const g = texGroups(text, start, 2);
      if (!g || !/^[0-9]{1,3}$/.test(g[1]!.trim())) continue;
      section = Number(g[1]!.trim());
      if (!disciplines.some((d) => d.id === section))
        disciplines.push({ id: section, name: g[0]!.trim() });
    } else {
      const g = texGroups(text, start, 4);
      if (!g || section === null) continue;
      const id = g[0]!.trim();
      if (RULES.family.test(id) && !entries.has(id))
        entries.set(id, { discipline: section, title: g[1]!.trim() });
    }
  }
  disciplines.sort((a, b) => a.id - b.id);
  return { disciplines, entries };
}

/** Markdown sections of the README by heading, paragraphs kept verbatim. */
function sections(text: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  let heading = "";
  let body: string[] = [];
  const flush = () => {
    const t = body.join("\n").trim();
    if (heading || t) out.push({ heading, text: t });
  };
  for (const l of lines(text)) {
    const h = /^#{1,6}\s+(.*)$/.exec(l);
    if (h) {
      flush();
      heading = h[1]!.trim();
      body = [];
    } else body.push(l);
  }
  flush();
  return out;
}
const COLLECTION_SECTIONS = ["Readme", "How the results were produced"];

/** The README's reasoning-summary table: family → summary. */
export function parseReasoningSummaries(
  text: string | null,
): Map<string, { subject: string; path: string }> {
  const out = new Map<string, { subject: string; path: string }>();
  if (text === null) return out;
  for (const l of lines(text)) {
    const row = /^\|\s*([0-9]{3})\s*\|\s*(\[.*\]\(.*\))\s*\|\s*$/.exec(l);
    if (!row) continue;
    const link = markdownLink(row[2]!);
    if (link && RULES.reasoningSummaryPath.test(link.target) && !out.has(row[1]!))
      out.set(row[1]!, { subject: link.label.trim(), path: link.target });
  }
  return out;
}

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";
const DATE = new RegExp(
  `^(?:(?:${MONTHS}) [0-9]{1,2}, [0-9]{4}|[0-9]{1,2} (?:${MONTHS}) [0-9]{4})$`,
);
/** A line that only says who wrote the manuscript or when. Anything else is kept as a note. */
function bylineDate(line: string): { date: string | null } | null {
  const l = line.replace(/\s+$/, "").replace(/\*\*/g, "").trim();
  if (/^(?:Author:?\s*)?OpenAI$/i.test(l)) return { date: null };
  const dated = /^(?:Date:?\s*)?(.*)$/.exec(l)![1]!.trim();
  if (DATE.test(dated)) return { date: dated };
  const both = /^OpenAI\s*·\s*(.*)$/.exec(l);
  if (both && DATE.test(both[1]!.trim())) return { date: both[1]!.trim() };
  return null;
}
/** One BibTeX field's value: `{{…}}` or `{…}`, with a nested `\href{url}{…}` read for its URL. */
function bibField(block: string, name: string): string | null {
  const at = new RegExp(`\\b${name}\\s*=\\s*`, "i").exec(block);
  if (!at) return null;
  const g = texGroups(block, at.index + at[0].length, 1);
  if (!g) return null;
  const v = g[0]!.trim();
  return v.startsWith("{") && v.endsWith("}") ? v.slice(1, -1) : v;
}
/** A manuscript's README: its title line, attribution notes, date and citation. */
export function parseManuscriptReadme(text: string): {
  title: string | null;
  file: string | null;
  date: string | null;
  notes: string[];
  citation: IndexedCitation | null;
} {
  const ls = lines(text);
  const head = ls[0] ? markdownLink(ls[0].replace(/^#\s+/, "")) : null;
  const notes: string[] = [];
  let date: string | null = null;
  let i = 1;
  for (; i < ls.length && !/^##\s+Citation/i.test(ls[i]!); i++) {
    const l = ls[i]!;
    if (!l.trim()) continue;
    const by = bylineDate(l);
    if (by) {
      date = date ?? by.date;
      continue;
    }
    notes.push(l.trim().slice(0, 400));
  }
  // Fenced with backticks or tildes; both are CommonMark, and the collection uses both.
  const fence = /(```|~~~)bibtex\n([\s\S]*?)\1/.exec(ls.join("\n"));
  let citation: IndexedCitation | null = null;
  if (fence) {
    const block = fence[2]!;
    const key = /@[a-z]+\{([^,\s]+),/i.exec(block)?.[1] ?? null;
    const how = bibField(block, "howpublished");
    const url = how ? (/\\href\{([^}]+)\}/.exec(how)?.[1] ?? null) : null;
    const author = bibField(block, "author");
    const title = bibField(block, "title");
    const year = bibField(block, "year");
    if (key && author && title && year)
      citation = {
        key,
        author,
        title: title.slice(0, 400),
        year,
        url:
          url && /^https:\/\/github\.com\/openai\/math\/blob\/[^\s]+$/.test(url)
            ? url
            : null,
      };
  }
  return {
    title: head ? head.label.trim() : null,
    file: head ? head.target : null,
    date,
    notes,
    citation,
  };
}

/** A Lean scope page: its title, the manuscripts it accompanies, its scope and its statements. */
export function parseScopePage(text: string): {
  title: string;
  papers: string[];
  scope: string;
  statements: { result: string; statement: string }[];
  /** Comparator links on the page, so a row the parser could not read is never dropped silently. */
  links: number;
} | null {
  const ls = lines(text);
  const title = /^#\s+(.*)$/.exec(ls[0] ?? "")?.[1]?.trim();
  const scopeAt = ls.findIndex((l) => /^##\s+Scope\s*$/.test(l));
  const linksAt = ls.findIndex((l) => /^##\s+Comparator links\s*$/.test(l));
  if (!title || scopeAt < 0 || linksAt < scopeAt) return null;
  const papers: string[] = [];
  for (const l of ls.slice(1, scopeAt)) {
    const m = /^-\s+(\[.*)$/.exec(l.trim());
    const link = m ? markdownLink(m[1]!) : null;
    if (link && link.target.startsWith("../../")) papers.push(link.target.slice(6));
  }
  const statements: { result: string; statement: string }[] = [];
  for (const l of ls.slice(linksAt + 1)) {
    const row = /^\|\s*(.+?)\s*\|\s*(\[.*\]\(.*\))\s*\|\s*$/.exec(l);
    if (!row || /^-+$/.test(row[1]!) || row[1] === "Result") continue;
    const link = markdownLink(row[2]!);
    if (link && link.target.startsWith("../"))
      statements.push({
        result: row[1]!.slice(0, 160),
        statement: "lean/" + link.target.slice(3),
      });
  }
  return {
    title,
    papers,
    scope: ls
      .slice(scopeAt + 1, linksAt)
      .join("\n")
      .trim(),
    statements,
    links:
      ls
        .slice(linksAt + 1)
        .join("\n")
        .split("](../ComparatorChallenges/").length - 1,
  };
}

const stringList = (v: unknown) =>
  Array.isArray(v) && v.every((s) => typeof s === "string") ? v : null;

// ---------------------------------------------------------------------------
// The index.
// ---------------------------------------------------------------------------
export function buildIndex(input: IndexInput): SubstrateIndex {
  const { tree } = input;
  const sources: { path: string; sha256: string }[] = [];
  const read = (path: string) => {
    const text = tree.read(path);
    if (text !== null) sources.push({ path, sha256: sha256(text) });
    return text;
  };
  const contentsText = read("CONTENTS.md");
  if (contentsText === null)
    throw new Error("CONTENTS.md is missing: this is not a checkout of openai/math");
  const contents = parseContents(contentsText);
  const overview = parseOverview(read("overview.tex"));
  const readme = read("README.md");
  const summaries = parseReasoningSummaries(readme);
  const catalogue = parseCatalogue(read("lean/formalization.yaml"));
  const license = tree.read("LICENSE");
  if (license === null) throw new Error("LICENSE is missing");
  const rejected = [...contents.rejected];

  const familyIds = new Set<string>();
  const manuscriptDirs = new Set<string>();
  const families: IndexedFamily[] = [];
  for (const cf of contents.families) {
    if (familyIds.has(cf.id)) {
      rejected.push({
        where: `CONTENTS.md:${cf.line}`,
        reason: `duplicate family ${cf.id}`,
      });
      continue;
    }
    familyIds.add(cf.id);
    const issues: string[] = [];
    if (cf.rejected.length)
      issues.push(`${cf.rejected.length} of its manuscript entries were refused`);
    const ov = overview.entries.get(cf.id);
    const discipline = ov
      ? (overview.disciplines.find((d) => d.id === ov.discipline) ?? null)
      : null;
    if (!discipline) issues.push("the overview classifies it under no discipline");
    if (!cf.summary) issues.push("the catalogue gives it no description");

    let formalization: IndexedFormalization | null = null;
    if (cf.lean !== null) {
      const path = cf.lean;
      const page = RULES.formalizationPath.test(path) ? read(path) : null;
      const parsed = page === null ? null : parseScopePage(page);
      if (path !== `lean/docs/${cf.id}.md`)
        issues.push("its Lean link does not name its own scope page");
      else if (page === null) issues.push("its Lean scope page is not in the repository");
      else if (!parsed)
        issues.push("its Lean scope page lacks a title, a scope or comparator links");
      else {
        const statements: IndexedStatement[] = [];
        if (parsed.links !== parsed.statements.length)
          issues.push(
            "its Lean scope page has comparator links the index could not read",
          );
        if (parsed.statements.length > 24)
          issues.push(
            "its Lean scope page lists more comparator statements than the index keeps",
          );
        for (const s of parsed.statements) {
          const config = s.statement.replace(/\.lean$/, ".json");
          const configText = RULES.leanPath.test(config) ? read(config) : null;
          let json: Record<string, unknown> | null = null;
          try {
            json =
              configText === null
                ? null
                : (JSON.parse(configText) as Record<string, unknown>);
          } catch {
            json = null;
          }
          const theorems = stringList(json?.theorem_names);
          const module =
            typeof json?.solution_module === "string" ? json.solution_module : null;
          if (
            !RULES.leanPath.test(s.statement) ||
            !tree.exists(s.statement) ||
            !json ||
            !theorems ||
            !module ||
            !/^[A-Za-z][A-Za-z0-9_.]{0,159}$/.test(module)
          ) {
            issues.push(
              `its comparator statement ${s.statement} is missing or malformed`,
            );
            continue;
          }
          const definitions = stringList(json.definition_names) ?? [];
          const axioms = stringList(json.permitted_axioms) ?? [];
          if (
            [theorems, definitions, axioms].some(
              (list) => list.length > 16 || list.some((t) => t.length > 160),
            )
          )
            issues.push(
              `its comparator statement ${s.statement} names more than the index keeps`,
            );
          const solutionPath = `lean/${module.replace(/\./g, "/")}.lean`;
          statements.push({
            result: s.result,
            statement_path: s.statement,
            config_path: config,
            config_sha256: sha256(configText!),
            theorems: theorems.slice(0, 16).map((t) => t.slice(0, 160)),
            definitions: definitions.slice(0, 16).map((t) => t.slice(0, 160)),
            solution_module: module,
            solution_path: solutionPath,
            solution_present:
              RULES.leanPath.test(solutionPath) && tree.exists(solutionPath),
            permitted_axioms: axioms.slice(0, 16).map((t) => t.slice(0, 160)),
            catalogued_main_result: catalogue.mainResults.has(config),
          });
        }
        const holds = new Set(cf.manuscripts.map((m) => m.target));
        if (parsed.papers.some((p) => !holds.has(p)))
          issues.push("its Lean scope page names a manuscript the family does not hold");
        formalization = {
          path,
          sha256: sha256(page),
          title: parsed.title,
          papers: parsed.papers.filter((p) => holds.has(p)),
          scope: parsed.scope,
          statements: statements.slice(0, 24),
        };
      }
    }

    const manuscripts: IndexedManuscript[] = [];
    for (const m of cf.manuscripts) {
      const dir = m.target.split("/")[1]!;
      if (manuscriptDirs.has(dir)) {
        rejected.push({
          where: `CONTENTS.md:${m.line}`,
          reason: `the manuscript ${dir} is listed twice`,
        });
        issues.push("one of its manuscripts is listed twice");
        continue;
      }
      manuscriptDirs.add(dir);
      const mIssues: string[] = [];
      if (!tree.exists(m.target))
        mIssues.push("its PDF is not in the repository at this commit");
      const readmePath = `preprints/${dir}/README.md`;
      const readmeText = read(readmePath);
      const r = readmeText === null ? null : parseManuscriptReadme(readmeText);
      if (!r) mIssues.push("it has no README, so no citation");
      else {
        if (r.notes.length > 4)
          mIssues.push(
            "its README carries more notes than the index keeps; read the README",
          );
        if (!r.citation) mIssues.push("its README has no complete citation");
        else if (r.citation.key !== `OAI:${dir}`)
          mIssues.push("its citation key does not name its directory");
        if (r.file !== null && `preprints/${dir}/${r.file}` !== m.target)
          mIssues.push("its README links a different file than the catalogue");
      }
      if (!m.abstract) mIssues.push("the catalogue gives it no abstract");
      const covered = !!formalization && formalization.papers.includes(m.target);
      const status: MathematicalStatus = mIssues.length
        ? "unverified"
        : covered
          ? "formalized"
          : "manuscript";
      manuscripts.push({
        id: dir,
        title: m.title,
        path: m.target,
        annotation: m.annotation,
        abstract: m.abstract,
        date: r?.date ?? null,
        citation: r?.citation ?? null,
        notes: (r?.notes ?? []).slice(0, 4),
        readme_sha256: readmeText === null ? null : sha256(readmeText),
        status,
        main_result_catalogued: catalogue.sources.has(m.target),
        issues: mIssues,
      });
    }
    if (!manuscripts.length) issues.push("it holds no manuscript");

    const summary = summaries.get(cf.id);
    let reasoning: IndexedFamily["reasoning_summary"] = null;
    if (summary) {
      if (tree.exists(summary.path))
        reasoning = {
          path: summary.path,
          subject: summary.subject,
          status: "reasoning-summary",
        };
      else issues.push("its reasoning summary is listed but not in the repository");
    }
    const { kinds, basis } = kindsOf(
      cf.title,
      cf.summary,
      manuscripts.map((m) => m.title),
    );
    families.push({
      id: cf.id,
      title: cf.title,
      overview_title: ov?.title ?? null,
      discipline: discipline ? { id: discipline.id, name: discipline.name } : null,
      summary: cf.summary,
      kinds,
      kind_basis: basis,
      status: issues.length ? "unverified" : formalization ? "formalized" : "manuscript",
      manuscripts,
      formalization,
      reasoning_summary: reasoning,
      issues,
    });
  }
  families.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const id of overview.entries.keys())
    if (!familyIds.has(id))
      rejected.push({
        where: "overview.tex",
        reason: `family ${id} is in the overview but not in the manuscript map`,
      });
  rejected.sort((a, b) =>
    a.where < b.where
      ? -1
      : a.where > b.where
        ? 1
        : a.reason < b.reason
          ? -1
          : a.reason > b.reason
            ? 1
            : 0,
  );
  const disciplines = overview.disciplines.map((d) => ({
    ...d,
    families: families.filter((f) => f.discipline?.id === d.id).length,
  }));
  const collection = readme === null ? [] : sections(readme);
  const body = {
    schema: SUBSTRATE_INDEX_SCHEMA,
    repository: REPOSITORY,
    repository_url: RULES.url,
    commit: input.commit,
    commit_date: input.commitDate,
    license: { spdx: RULES.license, path: "LICENSE", sha256: sha256(license) },
    collection: {
      path: "README.md",
      sha256: readme === null ? "" : sha256(readme),
      sections: collection
        .filter((s) => COLLECTION_SECTIONS.includes(s.heading))
        .map((s) => ({ heading: s.heading, text: s.text.slice(0, 4000) })),
    },
    catalogue: {
      sources: sources
        .filter(
          (s) =>
            !s.path.startsWith("preprints/") &&
            !s.path.startsWith("lean/docs/") &&
            !s.path.startsWith("lean/ComparatorChallenges/"),
        )
        .sort((a, b) => (a.path < b.path ? -1 : 1)),
      formalization_version: catalogue.version,
      formalization_scope: catalogue.scope,
      review_status: catalogue.review,
      automation: catalogue.automation,
      related_formalizations: catalogue.related.slice(0, 64),
    },
    counts: {
      disciplines: disciplines.length,
      families: families.length,
      manuscripts: families.reduce((n, f) => n + f.manuscripts.length, 0),
      formalizations: families.filter((f) => f.formalization).length,
      statements: families.reduce(
        (n, f) => n + (f.formalization?.statements.length ?? 0),
        0,
      ),
      reasoning_summaries: families.filter((f) => f.reasoning_summary).length,
      unverified_families: families.filter((f) => f.status === "unverified").length,
      unverified_manuscripts: families.reduce(
        (n, f) => n + f.manuscripts.filter((m) => m.status === "unverified").length,
        0,
      ),
      rejected: rejected.length,
    },
    disciplines,
    families,
    rejected,
  };
  // Round-trip through canonical JSON so the object the caller writes is the
  // object that was hashed: no undefined, no shared references.
  const canonical = JSON.parse(canonicalJson(body)) as typeof body;
  return {
    ...canonical,
    generated_at: input.generatedAt,
    generator: input.generator,
    content_sha256: contentSha256(canonical),
  };
}
