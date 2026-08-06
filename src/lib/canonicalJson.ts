/**
 * Canonical JSON, the input format every hash in the release manifest is taken
 * over.
 *
 * A hash nobody can reproduce is decoration, and the thing that makes a hash
 * irreproducible is almost never the algorithm — it is the serialisation.
 * `JSON.stringify` preserves insertion order, so the same model data reordered
 * by an innocuous refactor produces a different digest and the audit trail
 * quietly stops meaning anything.
 *
 * So: object keys sorted recursively, `undefined` dropped, array order
 * preserved (order *is* meaning in the layout — a runway runs from `from` to
 * `to`, and the ledger is already sorted by record id), and anything that
 * cannot be hashed reproducibly refused outright rather than coerced.
 *
 * This lives in `src/lib/` rather than beside the generator so it can be tested
 * without running a build. It imports nothing, including no crypto: hashing is
 * the caller's job, and keeping `node:crypto` out of `src/` keeps this module
 * usable from anywhere.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export function canonicalize(value: unknown): Json {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const out: { [key: string]: Json } = {};
    for (const [key, entryValue] of entries) out[key] = canonicalize(entryValue);
    return out;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      // `JSON.stringify(NaN)` is `null`, which would silently hash a broken
      // model to the same digest as one with a legitimate null in that slot.
      throw new Error("Refusing to hash a non-finite number; the model data is invalid");
    }
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  throw new Error(`Refusing to hash unsupported value of type ${typeof value}`);
}

/** The exact bytes a digest is taken over. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
