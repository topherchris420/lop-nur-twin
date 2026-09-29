import type { EntityId } from "../core/types";
import type { DecisionRecord, OutcomeWindow } from "../eval/records";

/**
 * What the world did after each decision: one outcome window per executed
 * decision, `windowS` seconds of simulation from the moment it started.
 *
 * The tracker only accumulates facts the simulation already produced — damage
 * the resolver applied, rounds the weapon runtime fired, the debrief's own
 * sight-line samples, metres the body moved, how the navigator's travel ended.
 * It never judges them; the outcome contracts do that offline
 * (`eval/outcomeContracts.ts`).
 *
 * Windows overlap: a brain deciding five times a second with a five-second
 * window has about twenty-five open at once, and they share most of their
 * outcome. That is recorded as is, and every report that pools them says so.
 *
 * A window ends when its time is up (complete), when the seat dies (complete —
 * the outcome is known: it died), or when the episode ends first (incomplete,
 * and not scored).
 */

interface OpenWindow {
  record: DecisionRecord;
  window: OutcomeWindow;
  startSim: number;
  targetId: EntityId | null;
  /** This decision's place choice started the travel now under way. */
  ownsTravel: boolean;
}

/** More than this many open windows means the cadence is far above design; oldest closes early. */
const MAX_OPEN = 64;

export class OutcomeTracker {
  private open: OpenWindow[] = [];

  constructor(
    public windowS: number,
    /** Metres to the objective now, or null in modes without one. */
    private readonly objectiveDistance: () => number | null = () => null,
  ) {}

  get openCount(): number {
    return this.open.length;
  }

  /** Start a window for a decision that just began executing. */
  begin(
    record: DecisionRecord,
    simTime: number,
    bound: { targetId: EntityId | null; ownsTravel: boolean },
  ): void {
    if (bound.ownsTravel) for (const w of this.open) w.ownsTravel = false;
    const window: OutcomeWindow = {
      windowS: this.windowS,
      elapsedS: 0,
      complete: false,
      damageTaken: 0,
      damageDealt: 0,
      shotsFired: 0,
      hits: 0,
      kills: 0,
      died: false,
      timeToDeathS: null,
      exposureSamples: 0,
      exposedSamples: 0,
      movedM: 0,
      objectiveStartM: this.objectiveDistance(),
      objectiveEndM: null,
      enemyShotsInSight: 0,
      target: bound.targetId === null ? null : { hit: false, killed: false, damage: 0 },
      place: record.execution.placeBound ? { reached: false, endReason: null } : null,
    };
    record.outcome = window;
    this.open.push({
      record,
      window,
      startSim: simTime,
      targetId: bound.targetId,
      ownsTravel: bound.ownsTravel,
    });
    if (this.open.length > MAX_OPEN) this.finish(this.open.shift()!, simTime, false);
  }

  /** Once per simulation step. Closes the windows whose time is up. */
  step(simTime: number, movedM: number): void {
    const keep: OpenWindow[] = [];
    for (const w of this.open) {
      w.window.movedM += movedM;
      if (simTime - w.startSim >= this.windowS) this.finish(w, simTime, true);
      else keep.push(w);
    }
    this.open = keep;
  }

  exposureSample(exposed: boolean): void {
    for (const w of this.open) {
      w.window.exposureSamples += 1;
      if (exposed) w.window.exposedSamples += 1;
    }
  }

  shot(): void {
    for (const w of this.open) w.window.shotsFired += 1;
  }

  enemyShotInSight(): void {
    for (const w of this.open) w.window.enemyShotsInSight += 1;
  }

  damageDealt(
    victimId: EntityId | null,
    amount: number,
    killed: boolean,
    newRound: boolean,
  ): void {
    for (const w of this.open) {
      const o = w.window;
      o.damageDealt += amount;
      if (newRound) o.hits += 1;
      if (killed) o.kills += 1;
      if (o.target && victimId !== null && victimId === w.targetId) {
        o.target.damage += amount;
        o.target.hit = true;
        if (killed) o.target.killed = true;
      }
    }
  }

  damageTaken(amount: number): void {
    for (const w of this.open) w.window.damageTaken += amount;
  }

  /** The travel a decision started has ended, with the navigator's reason. */
  travelEnded(reason: string): void {
    for (const w of this.open) {
      if (!w.ownsTravel || !w.window.place) continue;
      w.window.place.endReason = reason;
      w.window.place.reached = reason === "arrived";
      w.ownsTravel = false;
    }
  }

  /** The seat died: every open window's outcome is known now. */
  death(simTime: number): void {
    for (const w of this.open) {
      w.window.died = true;
      w.window.timeToDeathS = simTime - w.startSim;
      this.finish(w, simTime, true);
    }
    this.open = [];
  }

  /** The episode is over, or being read mid-run: close what is open as incomplete. */
  closeAll(simTime: number): void {
    for (const w of this.open) this.finish(w, simTime, false);
    this.open = [];
  }

  /**
   * A copy of a record's window as it would read if the episode ended now,
   * without closing it — for reading records out while the match runs.
   */
  static provisional(
    record: DecisionRecord,
    simTime: number,
    startSim: number | null,
  ): OutcomeWindow | null {
    const o = record.outcome;
    if (!o || o.complete || startSim === null) return o ? { ...o } : null;
    return { ...o, elapsedS: Math.max(0, simTime - startSim) };
  }

  startOf(record: DecisionRecord): number | null {
    return this.open.find((w) => w.record === record)?.startSim ?? null;
  }

  private finish(w: OpenWindow, simTime: number, complete: boolean): void {
    w.window.elapsedS = Math.min(this.windowS, Math.max(0, simTime - w.startSim));
    w.window.complete = complete;
    w.window.objectiveEndM = this.objectiveDistance();
  }
}
