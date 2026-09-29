import { canonicalize } from "../../lib/canonicalJson.js";

/**
 * Stable hashes for traces: 64-bit FNV-1a over canonical JSON. Shared by the
 * browser (observation hashes) and the server (question hashes), so it imports
 * its one sibling with a `.js` specifier and no alias.
 */

/** 64-bit FNV-1a as two 32-bit halves, hex. Stable across runtimes. */
export function fnv1a64(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c ^ (h1 >>> 7), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function canonicalHash(value: unknown): string {
  return fnv1a64(JSON.stringify(canonicalize(value)));
}
