/**
 * The experiment lifecycle, explicit and append-only.
 *
 *   PROPOSED → VALIDATED → AWAITING HUMAN APPROVAL → AUTHORIZED → RUNNING
 *            ↘ REJECTED   ↘ REJECTED                ↘ REJECTED    ↘ COMPLETED
 *                                                                  ↘ INCONCLUSIVE
 *                                                                  ↘ FAILED
 *
 * Every execution needs a human, so VALIDATED always moves on to AWAITING
 * HUMAN APPROVAL; nothing moves from a proposal to RUNNING without an
 * authorization record in between. The three terminal run states keep R.A.I.N.'s
 * central distinction — a failed hypothesis is a result, a failed execution is
 * not:
 *
 *   COMPLETED     ran to the end and the pre-registered criteria decided:
 *                 the hypothesis is SUPPORTED (rain `passed`) or NOT
 *                 SUPPORTED (rain `failed`). A negative result is COMPLETED.
 *   INCONCLUSIVE  ran to the end; a guard was unmet or the criteria did not
 *                 decide (rain `inconclusive`).
 *   FAILED        the run did not complete; the hypothesis was not evaluated
 *                 (rain `error`).
 *   REJECTED      never ran: failed validation, declined, or went stale.
 */
import type { RainRunStatus } from "./contracts";

export const STATES = [
  "PROPOSED",
  "VALIDATED",
  "AWAITING_HUMAN_APPROVAL",
  "AUTHORIZED",
  "RUNNING",
  "COMPLETED",
  "INCONCLUSIVE",
  "FAILED",
  "REJECTED",
] as const;
export type LifecycleState = (typeof STATES)[number];
export const STATE_LABELS: Record<LifecycleState, string> = {
  PROPOSED: "PROPOSED",
  VALIDATED: "VALIDATED",
  AWAITING_HUMAN_APPROVAL: "AWAITING HUMAN APPROVAL",
  AUTHORIZED: "AUTHORIZED",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  INCONCLUSIVE: "INCONCLUSIVE",
  FAILED: "FAILED",
  REJECTED: "REJECTED",
};
const NEXT: Record<LifecycleState, readonly LifecycleState[]> = {
  PROPOSED: ["VALIDATED", "REJECTED"],
  VALIDATED: ["AWAITING_HUMAN_APPROVAL"],
  AWAITING_HUMAN_APPROVAL: ["AUTHORIZED", "REJECTED"],
  AUTHORIZED: ["RUNNING", "REJECTED"],
  RUNNING: ["COMPLETED", "INCONCLUSIVE", "FAILED"],
  COMPLETED: [],
  INCONCLUSIVE: [],
  FAILED: [],
  REJECTED: [],
};
export interface Transition {
  state: LifecycleState;
  /** Wall-clock time of the transition. Recorded, never replayed. */
  at: string;
  detail: string;
}

export class Lifecycle {
  readonly history: Transition[];
  constructor(history?: readonly Transition[]) {
    this.history = history ? structuredClone([...history]) : [];
    if (this.history.length && this.history[0]!.state !== "PROPOSED")
      throw new Error("A lifecycle starts at PROPOSED");
    for (let i = 1; i < this.history.length; i++)
      if (!NEXT[this.history[i - 1]!.state].includes(this.history[i]!.state))
        throw new Error(
          `Illegal recorded transition ${this.history[i - 1]!.state} → ${this.history[i]!.state}`,
        );
  }
  get state(): LifecycleState | null {
    return this.history.at(-1)?.state ?? null;
  }
  can(to: LifecycleState) {
    const from = this.state;
    return from === null ? to === "PROPOSED" : NEXT[from].includes(to);
  }
  /** Throws on any transition the diagram does not draw. */
  to(state: LifecycleState, detail: string, now: Date = new Date()) {
    if (!this.can(state))
      throw new Error(`Illegal transition ${this.state ?? "(none)"} → ${state}`);
    this.history.push({ state, at: now.toISOString(), detail: detail.slice(0, 600) });
    return this;
  }
  reached(state: LifecycleState) {
    return this.history.some((t) => t.state === state);
  }
}

/** The terminal lifecycle state for a R.A.I.N. run status. */
export function terminalFor(status: RainRunStatus): LifecycleState {
  return status === "error"
    ? "FAILED"
    : status === "inconclusive"
      ? "INCONCLUSIVE"
      : "COMPLETED";
}
