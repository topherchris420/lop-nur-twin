/**
 * Holding documents to their records.
 *
 * A binding names a document, optionally a section of it, and a function that
 * rebuilds one of its sentences from committed records. `check` runs every
 * binding and answers two questions:
 *
 * - does the document still say what the records give? (a binding fails when
 *   its sentence is not in the document, or a record it reads is gone or has
 *   another shape);
 * - of the quantities each section states, how many were recomputed? A
 *   quantity counts only when it lies inside text a binding computed, in a
 *   sentence that was found.
 *
 * Nothing here decides whether a claim is true. It decides whether a number
 * in a document is the number in its record.
 */
import { evidenceDigest, fileSha256, readText, traced } from "./records.js";
import { normalise, sections, type Section } from "./numerals.js";
import type { Statement } from "./statement.js";

export interface Binding {
  /** A stable name: the claim or section, a dot, what is recomputed (`3.trapped`). */
  id: string;
  /** The document that makes the statement, as a repository path. */
  doc: string;
  /** The section it is in (a profile's key); anywhere in the document when absent. */
  section?: string;
  /** The sentence, rebuilt from the records. */
  statement: () => Statement;
  /**
   * For a value computed from this repository's source instead of read from a
   * record: the module it comes from. Such a binding names no evidence digest.
   */
  model?: string;
}

/** How a document is cut into the sections its bindings and coverage name. */
export interface DocumentProfile {
  path: string;
  /** What the report calls it. */
  name: string;
  keyFor: (heading: string) => { key: string; title: string } | null;
}

export interface BindingResult {
  id: string;
  doc: string;
  section: string | null;
  ok: boolean;
  /** Why it failed; null when it holds. */
  problem: string | null;
  /** The recomputed sentence; null when the records could not give one. */
  statement: Statement | null;
  /** How many times the section says it. */
  occurrences: number;
  /** The records read, as repository paths. */
  records: string[];
  /** One SHA-256 over the records' paths and digests; null when it read none. */
  evidence: string | null;
  model: string | null;
}

export interface SectionCoverage {
  key: string;
  title: string;
  quantities: number;
  recomputed: number;
  /** The quantities no binding computed, in the order the section states them. */
  copied: string[];
  bindings: string[];
}

export interface DocumentCoverage {
  path: string;
  name: string;
  sections: SectionCoverage[];
  quantities: number;
  recomputed: number;
}

export interface Report {
  results: BindingResult[];
  documents: DocumentCoverage[];
}

function occurrencesOf(needle: string, haystack: string): number[] {
  const found: number[] = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1))
    found.push(at);
  return found;
}

/**
 * Runs `bindings` against the documents. `read` returns a document's text and
 * exists so a test can hand in an altered one.
 */
export function check(
  bindings: readonly Binding[],
  profiles: readonly DocumentProfile[],
  read: (path: string) => string = readText,
): Report {
  const ids = new Set<string>();
  for (const b of bindings) {
    if (ids.has(b.id)) throw new Error(`two bindings are named ${b.id}`);
    ids.add(b.id);
  }

  const whole = new Map<string, string>();
  const cut = new Map<string, Section[]>();
  const textOf = (path: string) => {
    let text = whole.get(path);
    if (text === undefined) whole.set(path, (text = normalise(read(path))));
    return text;
  };
  for (const p of profiles) cut.set(p.path, sections(read(p.path), p.keyFor));

  /** Per document and section: the character ranges some binding computed. */
  const computed = new Map<string, [number, number][]>();
  const boundBy = new Map<string, string[]>();
  const results: BindingResult[] = [];

  for (const b of bindings) {
    const result: BindingResult = {
      id: b.id,
      doc: b.doc,
      section: b.section ?? null,
      ok: false,
      problem: null,
      statement: null,
      occurrences: 0,
      records: [],
      evidence: null,
      model: b.model ?? null,
    };
    results.push(result);
    try {
      const { value, files } = traced(b.statement);
      result.statement = value;
      result.records = files;
      result.evidence = files.length > 0 ? evidenceDigest(files) : null;
    } catch (cause) {
      result.problem = `its records no longer give the sentence: ${
        cause instanceof Error ? cause.message : String(cause)
      }`;
      continue;
    }
    if (result.records.length === 0 && !b.model) {
      result.problem = "it read no record and names no model, so it recomputes nothing";
      continue;
    }
    let haystack: string;
    if (b.section === undefined) haystack = textOf(b.doc);
    else {
      const section = cut.get(b.doc)?.find((s) => s.key === b.section);
      if (!section) {
        result.problem = `${b.doc} has no section "${b.section}"`;
        continue;
      }
      haystack = section.text;
    }
    const found = occurrencesOf(result.statement.text, haystack);
    result.occurrences = found.length;
    if (found.length === 0) {
      result.problem = `${b.doc} does not say: ${result.statement.text}`;
      continue;
    }
    result.ok = true;
    if (b.section !== undefined) {
      const where = `${b.doc}#${b.section}`;
      const ranges = computed.get(where) ?? [];
      for (const at of found)
        for (const [start, end] of result.statement.computed)
          ranges.push([at + start, at + end]);
      computed.set(where, ranges);
      boundBy.set(where, [...(boundBy.get(where) ?? []), b.id]);
    }
  }

  const documents = profiles.map((p): DocumentCoverage => {
    const covered = cut.get(p.path)!.map((s): SectionCoverage => {
      const ranges = computed.get(`${p.path}#${s.key}`) ?? [];
      const quantities = s.numerals.filter((n) => n.kind === "quantity");
      const copied = quantities.filter(
        (n) => !ranges.some(([start, end]) => start <= n.start && n.end <= end),
      );
      return {
        key: s.key,
        title: s.title,
        quantities: quantities.length,
        recomputed: quantities.length - copied.length,
        copied: copied.map((n) => n.text),
        bindings: boundBy.get(`${p.path}#${s.key}`) ?? [],
      };
    });
    return {
      path: p.path,
      name: p.name,
      sections: covered,
      quantities: covered.reduce((n, s) => n + s.quantities, 0),
      recomputed: covered.reduce((n, s) => n + s.recomputed, 0),
    };
  });

  return { results, documents };
}

/**
 * The machine-readable report: every binding with the records it read, and
 * every record's SHA-256 once. A binding's `evidence_sha256` is the SHA-256 of
 * its records' `path sha256` lines, sorted by path, each ended by a newline.
 */
export function reportJson(report: Report): string {
  const records = [...new Set(report.results.flatMap((r) => r.records))].sort();
  const body = {
    schema: "claim-bindings/v1",
    generated_by: "node scripts/run-ts.mjs scripts/claim-bindings.ts --write",
    note: "A binding rebuilds one sentence of a document from committed records. `computed` lists the parts of the sentence the records produced; everything else in it is quoted. Never edit this file.",
    documents: report.documents.map((d) => ({
      path: d.path,
      quantities: d.quantities,
      recomputed: d.recomputed,
      sections: d.sections.map((s) => ({
        section: s.key,
        title: s.title,
        quantities: s.quantities,
        recomputed: s.recomputed,
      })),
    })),
    bindings: report.results.map((r) => ({
      id: r.id,
      document: r.doc,
      section: r.section,
      statement: r.statement?.text ?? null,
      computed:
        r.statement?.computed.map(([a, b]) => r.statement!.text.slice(a, b)) ?? [],
      ...(r.model ? { model: r.model } : {}),
      evidence_sha256: r.evidence,
      records: r.records,
    })),
    records: Object.fromEntries(records.map((path) => [path, fileSha256(path)])),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}
