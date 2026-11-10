/**
 * A sentence of a document, recomputed.
 *
 * A binding writes the sentence as a tagged template: the words are quoted
 * from the document and every interpolated value is computed from records.
 * `says` keeps the two apart, so the check can tell which characters a
 * function of the records produced. A number typed into the words is only
 * quoted, and is never counted as recomputed.
 */

/** A sentence and the character ranges of it that were computed. */
export interface Statement {
  text: string;
  computed: readonly (readonly [start: number, end: number])[];
}

/**
 * Builds a statement. Each `${value}` must be a formatted string (a number, or
 * a record's own words such as its verdict) or a whole number; a fraction has
 * no one spelling, so it has to be formatted on purpose.
 * White space in the words is collapsed, as it is in the document before the
 * two are compared.
 */
export function says(
  words: TemplateStringsArray,
  ...values: readonly (string | number)[]
): Statement {
  let text = "";
  const computed: [number, number][] = [];
  words.forEach((literal, i) => {
    let quoted = literal.replace(/\s+/g, " ");
    if (i === 0) quoted = quoted.trimStart();
    if (i === words.length - 1) quoted = quoted.trimEnd();
    text += quoted;
    if (i >= values.length) return;
    const value = values[i]!;
    const rendered = typeof value === "number" ? whole(value) : value;
    if (rendered === "" || rendered !== rendered.trim() || /\s\s|[\n\t]/.test(rendered))
      throw new Error(`a computed value is a number or a few words, not "${rendered}"`);
    computed.push([text.length, text.length + rendered.length]);
    text += rendered;
  });
  if (computed.length === 0) throw new Error(`"${text}" computes nothing`);
  return { text, computed };
}

/** The document's minus sign (U+2212), which its numbers use. */
const MINUS = "−";

/** A whole number as written: `12`. */
export function whole(n: number): string {
  if (!Number.isSafeInteger(n)) throw new Error(`${n} is not a whole number`);
  return String(n).replace("-", MINUS);
}

/** A whole number with thousands separators: `1,347,336`. */
export function grouped(n: number): string {
  return whole(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * `x` to `digits` decimals: `0.297`, `−0.381`. Rounds the number as a record
 * writes it, half away from zero: a record's `0.3025` is `0.303`, where the
 * binary value just below it would print `0.302`. A value that rounds to zero
 * carries no sign.
 */
export function fixed(x: number, digits: number): string {
  if (!Number.isFinite(x)) throw new Error(`${x} cannot be printed`);
  if (!Number.isInteger(digits) || digits < 0 || digits > 12)
    throw new Error(`${digits} is not a number of decimals`);
  // The factor lifts a written tie (302.49999999999994) back onto its half.
  const scaled = Math.round(Math.abs(x) * 10 ** digits * (1 + 1e-12));
  if (!Number.isSafeInteger(scaled))
    throw new Error(`${x} is too large to print exactly`);
  const padded = String(scaled).padStart(digits + 1, "0");
  const text =
    digits === 0 ? padded : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
  return x < 0 && scaled !== 0 ? `${MINUS}${text}` : text;
}

/** As `fixed`, with a plus sign on a value that is not negative: `+0.297`. */
export function signed(x: number, digits: number): string {
  const text = fixed(x, digits);
  return text.startsWith(MINUS) ? text : `+${text}`;
}

/** A share as a whole percentage, without the sign: `69` for 0.69. */
export function percent(share: number, digits = 0): string {
  return fixed(share * 100, digits);
}
