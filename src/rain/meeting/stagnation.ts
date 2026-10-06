/**
 * Epistemic failsafe for a model meeting: dead-end and stagnation detection,
 * and bounded, deterministic recovery.
 *
 * A port of R.A.I.N.'s `stagnation_monitor.py` and
 * `utilities/meeting_recovery.py` (james_library, MIT), without the Circuit
 * Breaker branch, which called a formal-logic plugin the runtime does not
 * carry. Similarity is a scheduling signal, not evidence that a hypothesis is
 * false: the controller gives the panel a round to respond before escalating,
 * and a third unresolved flag asks for the final summary instead of a verdict.
 *
 * Shared with the server: imports siblings only.
 */
import { sequenceRatio } from "./difflib.js";

export interface MonitorVerdict {
  isDeadEnd: boolean;
  isStagnant: boolean;
}

const normalize = (text: string) =>
  text.toLowerCase().split(/\s+/).filter(Boolean).join(" ");

/**
 * A dead end is declared when the current response is at least `threshold`
 * similar to any of the last `windowSize` responses for `consecutiveHits`
 * consecutive turns.
 */
export class DeadEndDetector {
  private readonly window: string[] = [];
  private streak = 0;
  private readonly windowSize: number;
  private readonly threshold: number;
  private readonly consecutiveHits: number;
  constructor(windowSize = 3, threshold = 0.95, consecutiveHits = 3) {
    this.windowSize = windowSize;
    this.threshold = threshold;
    this.consecutiveHits = consecutiveHits;
  }
  check(response: string): boolean {
    const normalized = normalize(response);
    if (this.window.length) {
      const maxSim = Math.max(
        ...this.window.map((prev) => sequenceRatio(normalized, prev)),
      );
      this.streak = maxSim >= this.threshold ? this.streak + 1 : 0;
    } else this.streak = 0;
    this.window.push(normalized);
    if (this.window.length > this.windowSize) this.window.shift();
    return this.streak >= this.consecutiveHits;
  }
  reset(): void {
    this.window.length = 0;
    this.streak = 0;
  }
}

/**
 * Novelty is `1 - max similarity to recent turns`. When the variance of the
 * novelty window drops below `varianceThreshold` and the mean novelty is below
 * `meanThreshold`, stagnation is declared.
 */
export class StagnationDetector {
  private readonly history: string[] = [];
  private readonly scores: number[] = [];
  private readonly windowSize: number;
  private readonly varianceThreshold: number;
  private readonly meanThreshold: number;
  constructor(windowSize = 5, varianceThreshold = 0.01, meanThreshold = 0.15) {
    this.windowSize = windowSize;
    this.varianceThreshold = varianceThreshold;
    this.meanThreshold = meanThreshold;
  }
  check(response: string): boolean {
    const normalized = normalize(response);
    const score = this.history.length
      ? 1.0 - Math.max(...this.history.map((prev) => sequenceRatio(normalized, prev)))
      : 1.0;
    this.history.push(normalized);
    if (this.history.length > this.windowSize + 1) this.history.shift();
    this.scores.push(score);
    if (this.scores.length > this.windowSize) this.scores.shift();
    if (this.scores.length < this.windowSize) return false;
    const mean = this.scores.reduce((a, b) => a + b, 0) / this.scores.length;
    const variance =
      this.scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / this.scores.length;
    return variance < this.varianceThreshold && mean < this.meanThreshold;
  }
  reset(): void {
    this.history.length = 0;
    this.scores.length = 0;
  }
}

export class StagnationMonitor {
  private readonly deadEnd = new DeadEndDetector();
  private readonly stagnation = new StagnationDetector();
  check(response: string): MonitorVerdict {
    const isDeadEnd = this.deadEnd.check(response);
    const isStagnant = this.stagnation.check(response);
    return { isDeadEnd, isStagnant };
  }
  reset(): void {
    this.deadEnd.reset();
    this.stagnation.reset();
  }
}

export type RecoveryAction = "evidence" | "alternative" | "wrap_up";
export interface RecoveryDecision {
  action: RecoveryAction;
  reason: "dead_end" | "stagnation";
  prompt: string;
}

const RECOVERY_STEPS: [RecoveryAction, string][] = [
  [
    "evidence",
    "Revisit one repeated claim. Identify the specific supporting evidence or the missing measurement. Separate quoted source material from inference, and preserve supported findings. Do not invent citations or treat repetition as disproof.",
  ],
  [
    "alternative",
    "The evidence check has not resolved the repetition. Propose one falsifiable alternative and a measurement that would distinguish it from the current hypothesis. State what remains unknown; do not discard verified evidence.",
  ],
  [
    "wrap_up",
    "Two recovery attempts have not resolved the repetition. Begin the final summary: preserve supported findings, disagreements, unresolved questions, and the next test or source needed. Do not declare consensus or a discovery from repetition.",
  ],
];

/**
 * Escalate once per panel round; reset after sustained varied discussion.
 * `cooldownTurns` complete turns pass after an action before another may
 * fire; `recoveryTurns` consecutive unflagged turns reset escalation. A
 * wrap-up decision is terminal until `reset()`.
 */
export class MeetingRecoveryController {
  private step = 0;
  private cooldownRemaining = 0;
  private clearTurns = 0;
  private readonly cooldownTurns: number;
  private readonly recoveryTurns: number;
  constructor(cooldownTurns = 4, recoveryTurns = 4) {
    this.cooldownTurns = cooldownTurns;
    this.recoveryTurns = recoveryTurns;
    if (!Number.isInteger(cooldownTurns) || cooldownTurns < 1)
      throw new Error("cooldownTurns must be a positive integer");
    if (!Number.isInteger(recoveryTurns) || recoveryTurns < 1)
      throw new Error("recoveryTurns must be a positive integer");
  }
  reset(): void {
    this.step = 0;
    this.cooldownRemaining = 0;
    this.clearTurns = 0;
  }
  observe(verdict: MonitorVerdict, isWrapUp = false): RecoveryDecision | null {
    if (isWrapUp || this.step === RECOVERY_STEPS.length) return null;
    const flagged = verdict.isDeadEnd || verdict.isStagnant;
    this.clearTurns = flagged ? 0 : this.clearTurns + 1;
    if (this.clearTurns >= this.recoveryTurns) {
      this.reset();
      return null;
    }
    if (this.cooldownRemaining) {
      this.cooldownRemaining -= 1;
      return null;
    }
    if (!flagged) return null;
    const [action, instruction] = RECOVERY_STEPS[this.step]!;
    this.step += 1;
    this.cooldownRemaining = this.cooldownTurns;
    const reason = verdict.isDeadEnd ? "dead_end" : "stagnation";
    return {
      action,
      reason,
      prompt: `SYSTEM OVERRIDE: Adaptive recovery (${action}; ${reason}). ${instruction}`,
    };
  }
}
