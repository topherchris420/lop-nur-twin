/**
 * What the self-model keeps of its experience, in three stores kept apart:
 *
 * - **Short-term history** (`Period`): the last `historyPeriods` decision
 *   periods, each with what the fly did, what it expected, what its sense
 *   reported and the belief it held before. An inquiry re-weighs these back
 *   to where a change began. The oldest is dropped as each new one comes.
 * - **Learned action-response beliefs** live in the estimator (estimator.ts):
 *   the current Gaussian over the nine beliefs. They are not episodes; they
 *   are what the episodes taught.
 * - **Episodic memory** (`Episode`): one record per concluded inquiry: what
 *   was observed, what the fly did, what it predicted, what happened, which
 *   explanation won and with what posterior, the beliefs before and after,
 *   and the simulation's version, seed and time. At most `episodesKept`; when
 *   full, the least informative record (the smallest change to a belief,
 *   weighted by how sure the conclusion was; the oldest first among equals)
 *   is forgotten.
 *
 * Episodes in which the fly concluded that it had changed itself are what it
 * can recall (inquiry.ts): their settled beliefs become hypotheses the next
 * time something changes, so the same change, met again, is recognized from
 * less evidence. Nothing here is a model of a fly's memory systems.
 */
import type { Belief } from "./estimator.js";
import { GAINS, INNATE, SELF, type PeriodContext, type PeriodKind } from "./forward.js";
import { EP } from "./params.js";

export const EXPLANATIONS = ["none", "self", "external", "both", "sensor"] as const;
export type Explanation = (typeof EXPLANATIONS)[number];

export interface Period {
  /** The period's index and when it ended (s). */
  k: number;
  t: number;
  context: PeriodContext;
  /** What the sense reported: forward, left (m) and turn (rad). */
  y: [number, number, number];
  noiseScale: number;
  /** The belief held before this period taught anything. */
  prior: Belief;
  predicted: [number, number, number];
  sd: [number, number, number];
  nis: number;
  /** The command moved the fly (walking or flying at some speed). */
  moving: boolean;
}

export interface Episode {
  id: number;
  simulation: { fly: string; echo: string; seed: number | null };
  /** When the change was first noticed, where the evidence was taken from, and when the inquiry concluded (s). */
  noticed: number;
  since: number;
  concluded: number;
  /** The decision period it concluded in. */
  period: number;
  observed: { periods: number; mean: [number, number, number] };
  action: {
    kinds: Record<PeriodKind, number>;
    /** Mean commanded leg speed (cm/s) and yaw rate (rad/s) over the evidence. */
    legCommandCmS: number;
    turnCommand: number;
  };
  predicted: { mean: [number, number, number] };
  outcome: { meanInnovation: [number, number, number]; meanNis: number };
  explanation: Explanation;
  /** The hypothesis that won: an explanation, the innate body, or a recalled episode. */
  candidate: string;
  resolved: boolean;
  posterior: Record<string, number>;
  before: number[];
  after: number[];
  /** The beliefs when the next inquiry opened, after this episode's learning had run on; null until then. */
  settled: number[] | null;
  reliability: { posterior: number; spreads: number[] };
  recalled: number;
}

export interface BeliefChange {
  t: number;
  what: string;
  from: number;
  to: number;
  why: string;
}

/** The short-term history, bounded. */
export function remember(history: Period[], p: Period): void {
  history.push(p);
  if (history.length > EP.historyPeriods)
    history.splice(0, history.length - EP.historyPeriods);
}

/** How much an episode changed the fly's beliefs, weighted by how sure it was. */
export function salience(e: Episode): number {
  let change = 0;
  for (let i = 0; i < e.before.length; i++)
    change += Math.abs(e.after[i]! - e.before[i]!);
  return change * e.reliability.posterior + 0.5 * e.recalled;
}

/** Add an episode; when full, forget the least salient (the oldest first among equals). */
export function rememberEpisode(episodes: Episode[], e: Episode): void {
  episodes.push(e);
  while (episodes.length > EP.episodesKept) {
    let worst = 0;
    for (let i = 1; i < episodes.length - 1; i++)
      if (salience(episodes[i]!) < salience(episodes[worst]!)) worst = i;
    episodes.splice(worst, 1);
  }
}

/** The self-beliefs an episode left the fly with: settled if it has settled, else as concluded. */
export const settledSelf = (e: Episode): number[] =>
  SELF.map((i) => (e.settled ?? e.after)[i]!);

const INNATE_SELF = SELF.map((i) => INNATE[i]!);

/** Whether two sets of self-beliefs are the same experience (gains within `recallDistance`, biases within it in rad/s). */
export function sameSelf(a: readonly number[], b: readonly number[]): boolean {
  return SELF.every((_, j) => Math.abs(a[j]! - b[j]!) < EP.recallDistance);
}

/**
 * The remembered self-changes the fly could be meeting again: distinct, not
 * what it believes now, most recalled and most recent first; at most six.
 */
export function recallable(
  episodes: readonly Episode[],
  current: readonly number[],
): Episode[] {
  const now = SELF.map((i) => current[i]!);
  const out: Episode[] = [];
  const ordered = [...episodes]
    .filter((e) => e.explanation === "self" && e.resolved)
    .sort((a, b) => b.recalled - a.recalled || b.concluded - a.concluded || b.id - a.id);
  for (const e of ordered) {
    const self = settledSelf(e);
    // The innate body is always a hypothesis of its own (inquiry.ts), and the present one is "none".
    if (sameSelf(self, now) || sameSelf(self, INNATE_SELF)) continue;
    if (out.some((o) => sameSelf(settledSelf(o), self))) continue;
    out.push(e);
    if (out.length >= 6) break;
  }
  return out;
}

/** Whether the fly's self-beliefs are far enough from its innate body to consider a return to it. */
export function awayFromInnate(x: readonly number[]): boolean {
  return (
    GAINS.some((i) => Math.abs(x[i]! - 1) >= EP.recallDistance) ||
    [2, 5].some((i) => Math.abs(x[i]!) >= EP.recallDistance)
  );
}

/** Add to the bounded log of belief revisions. */
export function logBelief(log: BeliefChange[], c: BeliefChange): void {
  log.push(c);
  if (log.length > EP.beliefLogSize) log.splice(0, log.length - EP.beliefLogSize);
}
