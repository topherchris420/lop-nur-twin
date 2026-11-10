/**
 * Which characters of a document are quantities.
 *
 * Coverage needs a denominator: how many numbers does an entry of the register
 * state? This module answers with a rule that can be read and argued with,
 * rather than a judgement made entry by entry.
 *
 * A **quantity** is a number written in digits in the document's prose:
 * `9`, `0.297`, `1,347,336`. Not counted, because they name things rather
 * than measure them:
 *
 * - anything in code (a span or a fenced block), a link's target, a bare URL
 *   or an HTML tag;
 * - dates and times: `2026-11-04`, `2026-11`, `4 November`, `19:27`, `264 BC`;
 * - identifiers: digits attached to letters (`v783`, `H2`, `ECHO-01`,
 *   `288b3a8`), the rest of such a range (`ECHO-03–05`), version numbers of
 *   three or more parts (`24.19.0`), a padded ordinal (`07`) and an unbroken
 *   run of seven or more digits (`1011267786`);
 * - the ordinal of a numbered list item or heading, and a number alone in the
 *   first cell of a table row, which labels the row.
 *
 * Numbers written as words ("three runs") are not seen at all. The sign of a
 * number is not part of it; a binding's computed text carries its own.
 */

export type NumeralKind = "quantity" | "date" | "identifier";

export interface Numeral {
  text: string;
  start: number;
  end: number;
  kind: NumeralKind;
}

/** Markdown as one line: every run of white space becomes a single space. */
export function normalise(markdown: string): string {
  return markdown.replace(/\s+/g, " ").trim();
}

const blank = (match: string) => " ".repeat(match.length);

/**
 * `text` (already normalised) with everything that is not prose replaced by
 * spaces, character for character, so positions in the two agree.
 */
export function maskNonProse(text: string): string {
  return (
    text
      .replace(/```.*?```/g, blank)
      .replace(/`[^`]*`/g, blank)
      .replace(/<!--.*?-->/g, blank)
      // A link's target and title; its text stays.
      .replace(/\]\([^)\s]*(?: "[^"]*")?\)/g, (m) => `]${blank(m.slice(1))}`)
      .replace(/<\/?[A-Za-z][^>]*>/g, blank)
      .replace(/\bhttps?:\/\/\S+/g, blank)
  );
}

const MONTH =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
/** Dates and times, tried before plain numbers so their digits stay together. */
const DATE = new RegExp(
  [
    String.raw`\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?`,
    String.raw`\d{4}-\d{2}(?![\d-])`,
    String.raw`\d{1,2} ${MONTH}(?: \d{4})?`,
    String.raw`${MONTH} \d{4}`,
    String.raw`\d{1,2}:\d{2}(?::\d{2})?`,
    String.raw`\d+ (?:BC|AD)\b`,
  ].join("|"),
  "g",
);
const VERSION = /\d+(?:\.\d+){2,}/g;
const NUMBER = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;

/** Every number in `text` (normalised), in order, with its kind. */
export function numerals(text: string): Numeral[] {
  const prose = maskNonProse(text);
  const found: Numeral[] = [];
  const taken = new Uint8Array(prose.length);
  const claim = (pattern: RegExp, kind: NumeralKind | null) => {
    for (const m of prose.matchAll(pattern)) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.subarray(start, end).some((t) => t === 1)) continue;
      // A date or version preceded by a letter or digit is part of something else.
      if (kind !== null && start > 0 && /[A-Za-z\d]/.test(prose[start - 1]!)) continue;
      taken.fill(1, start, end);
      found.push({ text: m[0], start, end, kind: kind ?? "quantity" });
    }
  };
  claim(DATE, "date");
  claim(VERSION, "identifier");
  claim(NUMBER, null);
  found.sort((a, b) => a.start - b.start);

  // Digits attached to letters name something: `v783`, `H2`, `ECHO-01`, and the
  // far end of such a range (`ECHO-03–05`).
  let previous: Numeral | undefined;
  for (const n of found) {
    if (n.kind === "quantity") {
      const before = prose[n.start - 1] ?? " ";
      const twoBefore = prose[n.start - 2] ?? " ";
      const attached =
        /[A-Za-z]/.test(before) || (/[-/]/.test(before) && /[A-Za-z]/.test(twoBefore));
      const continues =
        previous?.kind === "identifier" &&
        previous.end === n.start - 1 &&
        /[-–]/.test(before);
      // `288b3a8`: a number run straight into a letter is the start of a name.
      const runsOn = /[A-Za-z]/.test(prose[n.end] ?? " ");
      // `07`, `1011267786`: a padded ordinal, or an id too long to be read as a count.
      const label = /^0\d+$/.test(n.text) || /^\d{7,}$/.test(n.text);
      if (attached || continues || runsOn || label) n.kind = "identifier";
    }
    previous = n;
  }
  return found;
}

export interface Section {
  /** What a binding names it by: a claim's number, `summary`, a README section's `04`. */
  key: string;
  title: string;
  /** Its heading and body as one normalised line, without list ordinals. */
  text: string;
  numerals: Numeral[];
}

interface OpenSection {
  key: string;
  title: string;
  depth: number;
  lines: string[];
}

/**
 * A document cut at its headings. `keyFor` is given each heading's text and
 * answers the section it opens, or null. A deeper heading that opens nothing
 * stays inside the open section; any other closes it, and the text under it
 * belongs to no section.
 */
export function sections(
  markdown: string,
  keyFor: (heading: string) => { key: string; title: string } | null,
): Section[] {
  const out: Section[] = [];
  let open: OpenSection | null = null;
  const close = () => {
    if (open) {
      const text = normalise(`${open.title} ${open.lines.join("\n")}`);
      out.push({ key: open.key, title: open.title, text, numerals: numerals(text) });
    }
    open = null;
  };
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (!heading) {
      // A numbered list's ordinal and a table row's label are not quantities.
      open?.lines.push(
        fenced
          ? line
          : line
              .replace(/^(\s*)\d+\.(\s)/, "$1-$2")
              .replace(/^\|(\s*)\d+(\s*)\|/, "|$1-$2|"),
      );
      continue;
    }
    const depth = heading[1]!.length;
    const opened = keyFor(heading[2]!);
    if (opened) {
      close();
      open = { ...opened, depth, lines: [] };
    } else if (open && depth > open.depth) open.lines.push(heading[2]!);
    else close();
  }
  close();
  return out;
}
