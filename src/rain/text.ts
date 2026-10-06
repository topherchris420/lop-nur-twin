/**
 * Text helpers with Python's string semantics.
 *
 * The offline meeting engine and the citation verifier were first written in
 * Python (james_library), and the DEMO recording was made by that code. This
 * port reproduces that recording byte for byte, which means agreeing with
 * Python about what a "space" is, where a line ends, how a number rounds and
 * how JSON is serialised for hashing. Those rules live here, once, with the
 * Python call each one stands in for.
 *
 * Shared with the server: imports nothing.
 */

/**
 * `str.isspace()`: Unicode category Zs, or bidirectional class WS, B or S.
 * JavaScript's `\s` differs in both directions (it has U+FEFF, lacks
 * U+001C–U+001F and U+0085).
 */
export const PY_SPACE_CLASS =
  "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_SPACE = new RegExp(`[${PY_SPACE_CLASS}]`, "u");
const PY_SPACE_RUN = new RegExp(`[${PY_SPACE_CLASS}]+`, "gu");
const PY_SPACE_EDGES = new RegExp(`^[${PY_SPACE_CLASS}]+|[${PY_SPACE_CLASS}]+$`, "gu");

export const isSpace = (ch: string) => ch !== "" && PY_SPACE.test(ch);

/** `str.split()` with no separator: runs of whitespace, empty pieces dropped. */
export function pySplit(text: string): string[] {
  return text.split(PY_SPACE_RUN).filter((piece) => piece !== "");
}

/** `str.strip()` with no argument. */
export const pyStrip = (text: string) => text.replace(PY_SPACE_EDGES, "");

/** `str.lstrip(chars)` / `str.rstrip(chars)` with an explicit character set. */
export function lstripChars(text: string, chars: string): string {
  let i = 0;
  while (i < text.length && chars.includes(text[i]!)) i++;
  return text.slice(i);
}
export function rstripChars(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1]!)) end--;
  return text.slice(0, end);
}

/**
 * `str.splitlines()`: splits on \n, \r, \r\n, \v, \f, U+001C–U+001E, U+0085,
 * U+2028 and U+2029, and drops a trailing empty line.
 */
export function pySplitlines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const breaks =
      c === 0x0a ||
      c === 0x0d ||
      c === 0x0b ||
      c === 0x0c ||
      c === 0x1c ||
      c === 0x1d ||
      c === 0x1e ||
      c === 0x85 ||
      c === 0x2028 ||
      c === 0x2029;
    if (!breaks) continue;
    lines.push(text.slice(start, i));
    if (c === 0x0d && text.charCodeAt(i + 1) === 0x0a) i++;
    start = i + 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/** `str.isupper()` for one character: it has the Uppercase property. */
export const isUpper = (ch: string) => /^\p{Uppercase}$/u.test(ch);
/** `str.isalpha()` for one character: Unicode category L*. */
export const isAlpha = (ch: string) => /^\p{L}$/u.test(ch);

/** Python's `round(x)`: to the nearest integer, ties to even. */
export function pyRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** `s.count(sub, 0, end)` for a one-character needle. */
export function countBefore(text: string, needle: string, end: number): number {
  let n = 0;
  for (let i = 0; i < end && i < text.length; i++) if (text[i] === needle) n++;
  return n;
}

/**
 * Python's `json.dumps(value, sort_keys=True, ensure_ascii=False)` with its
 * default separators (", " and ": "). Only the JSON types the meeting engine
 * produces are accepted: strings, integers, booleans, null, lists and objects.
 * A float would print differently in the two languages, so one is refused.
 */
export function pyJsonDumps(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error("pyJsonDumps: non-integer number");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pyJsonDumps).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${pyJsonDumps(v)}`).join(", ")}}`;
  }
  throw new Error("pyJsonDumps: unsupported value");
}

/** A Unicode-aware `\b` for a pattern fragment: Python's word boundary, not JavaScript's ASCII one. */
export const WB_BEFORE = "(?<![\\p{L}\\p{N}_])";
export const WB_AFTER = "(?![\\p{L}\\p{N}_])";
