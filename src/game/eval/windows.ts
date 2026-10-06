import type { DecisionRecord } from "./records.js";

/**
 * Outcome windows overlap. A decision's window runs `windowS` seconds — five
 * by default — from when it began executing, and a brain decides every few
 * hundred milliseconds, so the windows of a dozen consecutive decisions share
 * most of their time: one hit, kill or death is counted in the window of every
 * decision that began in the five seconds before it. A row of outcomes is not
 * one outcome per decision.
 *
 * These helpers measure that, and pick a subset in which no two windows share
 * any time, so each event is counted once. The subset is chosen by time alone —
 * never by outcome — so it favours no result.
 */

export interface WindowSpan {
  sequence: number;
  /** Simulation seconds. */
  start: number;
  end: number;
}

/** The windows of executed decisions that have one, in start order. */
export function windowSpans(records: readonly DecisionRecord[]): WindowSpan[] {
  return records
    .filter((r) => r.execution.actionStart !== null && r.outcome !== null)
    .map((r) => ({
      sequence: r.sequence,
      start: r.execution.actionStart!,
      end: r.execution.actionStart! + r.outcome!.elapsedS,
    }))
    .sort((a, b) => a.start - b.start || a.sequence - b.sequence);
}

/** For each window, how many other windows share some of its time. */
export function overlapCounts(spans: readonly WindowSpan[]): Map<number, number> {
  const counts = new Map(spans.map((s) => [s.sequence, 0]));
  for (let i = 0; i < spans.length; i++) {
    const a = spans[i]!;
    // Sorted by start: once a window starts at or after a's end, so do the rest.
    for (let j = i + 1; j < spans.length && spans[j]!.start < a.end; j++) {
      const b = spans[j]!;
      if (b.end > a.start) {
        counts.set(a.sequence, counts.get(a.sequence)! + 1);
        counts.set(b.sequence, counts.get(b.sequence)! + 1);
      }
    }
  }
  return counts;
}

/**
 * A subset of windows that share no time: the earliest window, then the next
 * one that starts at or after it ends, and so on.
 */
export function disjointWindows(spans: readonly WindowSpan[]): Set<number> {
  const kept = new Set<number>();
  let free = -Infinity;
  for (const s of spans) {
    if (s.start < free) continue;
    kept.add(s.sequence);
    free = s.end;
  }
  return kept;
}
