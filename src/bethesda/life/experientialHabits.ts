/**
 * A small, deliberately bounded form of experience-dependent behavior.
 *
 * This is a candidate addition for THE EXISTING ECHO ORGANISM, never an
 * alternative fly. Two conservative walking-pace strategies are evaluated in
 * calm/windy contexts from the fly's own subsequent movement and reserve.
 * Selection changes only permitted walking speed, never reflexes, motor mode,
 * feeding, flight, landing, body gate, or state history.
 *
 * No AI, language, neural imitation, or claim of open-ended learning. There
 * are no random draws or unbounded memories. Every variable is checkpointed.
 */
import type { BodySnapshot, DecisionInput, MotorCommand } from "../fly/neural.js";

export const HABIT_VERSION = "echo-experiential-habits/v1";
export const HABIT_SCHEMA = "echo-habit-state/v1";
export const HABIT_ARMS = [0.85, 1] as const;
export type HabitContext = "sheltered" | "breezy";

export interface HabitEvidence {
  trials: number;
  meanProgressCmS: number;
  meanReserveCostPerS: number;
  /** Conservative, model-specific utility, not a measure of intelligence. */
  meanUtility: number;
}

export interface HabitPending {
  context: HabitContext;
  arm: 0 | 1;
  t: number;
  position: [number, number];
  reserve: number;
}

export interface HabitState {
  schema: typeof HABIT_SCHEMA;
  enabled: boolean;
  experiences: number;
  decisions: number;
  adjustments: number;
  evidence: Record<HabitContext, [HabitEvidence, HabitEvidence]>;
  pending: HabitPending | null;
}

const empty = (): HabitEvidence => ({
  trials: 0,
  meanProgressCmS: 0,
  meanReserveCostPerS: 0,
  meanUtility: 0,
});
const evidence = (): [HabitEvidence, HabitEvidence] => [empty(), empty()];
const finite = (x: number): boolean => Number.isFinite(x);

/** All changes remain within the command the existing organism already approved. */
export class ExperientialHabits {
  readonly state: HabitState = {
    schema: HABIT_SCHEMA,
    enabled: true,
    experiences: 0,
    decisions: 0,
    adjustments: 0,
    evidence: { sheltered: evidence(), breezy: evidence() },
    pending: null,
  };

  private learn(body: BodySnapshot): void {
    const p = this.state.pending;
    this.state.pending = null;
    if (!p || body.mode !== "walk") return;
    const dt = body.t - p.t;
    if (!(finite(dt) && dt > 0 && dt <= 1)) return;
    const dx = body.p[0] - p.position[0];
    const dz = body.p[2] - p.position[1];
    if (!finite(dx) || !finite(dz)) return;
    const progress = Math.min(40, (100 * Math.hypot(dx, dz)) / dt);
    const reserveCost = Math.min(1, Math.max(0, (p.reserve - body.reserve) / dt));
    // A transparent utility: real displacement per elapsed simulated second,
    // with a small reserve-cost penalty. Never use the neural model as reward.
    const utility = progress - 2 * reserveCost;
    const e = this.state.evidence[p.context][p.arm];
    const n = e.trials + 1;
    e.meanProgressCmS += (progress - e.meanProgressCmS) / n;
    e.meanReserveCostPerS += (reserveCost - e.meanReserveCostPerS) / n;
    e.meanUtility += (utility - e.meanUtility) / n;
    e.trials = n;
    this.state.experiences++;
  }

  /**
   * The original OrganismAdapter decides FIRST. Observe the actual movement
   * resulting from the previous decision, then make an optional conservative
   * change to this decision's walking speed. Mode and all other fields stay.
   */
  decide(input: DecisionInput, command: MotorCommand): MotorCommand {
    this.learn(input.body);
    if (
      !this.state.enabled ||
      command.mode !== "walk" ||
      input.body.mode !== "walk" ||
      input.body.edge ||
      input.body.onFood !== null ||
      input.frame.looming !== null ||
      command.walkSpeed === undefined ||
      !finite(command.walkSpeed) ||
      command.walkSpeed <= 0
    ) return command;
    const context: HabitContext =
      input.frame.airflow >= 0.2 ? "breezy" : "sheltered";
    const [a, b] = this.state.evidence[context];
    // Forced exploration on only the first few *qualifying* observations.
    // Thereafter prefer the measured outcome, with a periodic bounded probe
    // so a changed environment can still revise the preference.
    const arm: 0 | 1 = a.trials < 3
      ? 0
      : b.trials < 3
        ? 1
        : this.state.decisions % 32 === 0
          ? (a.trials <= b.trials ? 0 : 1)
          : a.meanUtility > b.meanUtility
            ? 0
            : 1;
    this.state.decisions++;
    this.state.pending = {
      context,
      arm,
      t: input.body.t,
      position: [input.body.p[0], input.body.p[2]],
      reserve: input.body.reserve,
    };
    const requested = command.walkSpeed * HABIT_ARMS[arm];
    const speed = Math.min(command.walkSpeed, Math.max(0, requested));
    if (speed < command.walkSpeed) this.state.adjustments++;
    return { ...command, walkSpeed: speed };
  }
}
