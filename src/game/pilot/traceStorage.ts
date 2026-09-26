/**
 * The one trace a browser keeps, for `/play?brain=replay&trace=last`.
 *
 * Local storage is a per-viewer convenience, never the record of a run: the
 * downloadable JSONL is. Every access is guarded, because storage can be
 * blocked, full or absent (private windows, embedded previews), and replay then
 * simply reports that no trace is loaded.
 */

export const TRACE_STORAGE_KEY = "blacksite.jev.trace.last";
/** Local storage holds a few megabytes; a larger trace is download-only. */
const MAX_STORED_TRACE_CHARS = 3_500_000;

export function storeTraceLocally(jsonl: string): boolean {
  if (jsonl.length === 0 || jsonl.length > MAX_STORED_TRACE_CHARS) return false;
  try {
    window.localStorage.setItem(TRACE_STORAGE_KEY, jsonl);
    return true;
  } catch {
    return false;
  }
}

export function readStoredTrace(): string | null {
  try {
    return window.localStorage.getItem(TRACE_STORAGE_KEY);
  } catch {
    return null;
  }
}
