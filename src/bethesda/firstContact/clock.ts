/**
 * Clocks: how each individual's own time relates to UTC and to an encounter.
 *
 * Eva and ECHO keep different clocks, and an interaction is only meaningful
 * once both are placed on one timeline:
 *
 * - **Eva's** state is stamped in unix seconds. Her contract steps in whole
 *   five-second ticks from her birth (`updated_at = born_at + 5 × ticks`), and
 *   the server answers with its own UTC clock (`server_time`).
 * - **ECHO's** observation is stamped with its own simulated seconds
 *   (`simulatedSeconds = tick × 0.1`) and the UTC time the runner wrote it
 *   (`observedUtc`). Its clock waits while a checkpoint is made, and an
 *   outage is a gap with no catch-up ticks, so it falls behind UTC.
 *
 * Nothing here assumes a clock runs at the rate of UTC: `fitClock` measures
 * it from samples and names every gap. The `EncounterClock` is the research
 * subjects' shared timeline: each subject keeps its own clock (its age at
 * contact differs), and the clock refuses to call an exchange synchronized
 * unless both subjects' clocks advanced exactly as far as the timeline did.
 */

/** Eva's step (s): her contract publishes states in whole steps of this. */
export const GARDEN_STEP_S = 5;
/** ECHO's tick (s): `simulatedSeconds = tick × LIFE_TICK_S`. */
export const LIFE_TICK_S = 0.1;

export interface ClockCheck {
  consistent: boolean;
  /** How far the stamped time is from the one its own counter implies (s). */
  discrepancyS: number;
  detail: string;
}

/** Eva: does `updated_at` sit exactly `5 × ticks` after `born_at`? */
export function checkGardenClock(o: {
  bornAt: number;
  updatedAt: number;
  ticks: number;
}): ClockCheck {
  const implied = o.bornAt + GARDEN_STEP_S * o.ticks;
  const d = o.updatedAt - implied;
  // Unix seconds near 1.8e9 carry about 2e-7 s of float error.
  const consistent = Math.abs(d) < 1e-3;
  return {
    consistent,
    discrepancyS: d,
    detail: consistent
      ? `updated_at = born_at + ${GARDEN_STEP_S} s × ${o.ticks} ticks`
      : `updated_at is ${d.toFixed(3)} s from born_at + ${GARDEN_STEP_S} s × ticks`,
  };
}

/** ECHO: is `simulatedSeconds` exactly `tick × 0.1`? */
export function checkLifeClock(o: {
  tick: number;
  simulatedSeconds: number;
}): ClockCheck {
  const implied = o.tick * LIFE_TICK_S;
  const d = o.simulatedSeconds - implied;
  const consistent = Math.abs(d) < 1e-6 * Math.max(1, implied);
  return {
    consistent,
    discrepancyS: d,
    detail: consistent
      ? `simulatedSeconds = ${o.tick} ticks × ${LIFE_TICK_S} s`
      : `simulatedSeconds is ${d.toFixed(6)} s from tick × ${LIFE_TICK_S} s`,
  };
}

/** One reading of an individual's clock: its own time beside UTC (both seconds). */
export interface ClockSample {
  utcS: number;
  ownS: number;
}

export interface ClockGap {
  fromUtcS: number;
  toUtcS: number;
  utcAdvanceS: number;
  ownAdvanceS: number;
}

export interface ClockFit {
  /** Samples used (strictly increasing UTC). */
  n: number;
  /** Own seconds per UTC second over the samples, gaps excluded; null with fewer than two. */
  rate: number | null;
  /** Own time minus UTC at the newest sample (s); null without samples. */
  offsetS: number | null;
  /** The share of UTC time, between the first and last sample, in which the clock advanced. */
  runningShare: number | null;
  /** Intervals where the clock fell behind UTC by more than the tolerance. */
  gaps: ClockGap[];
  /** Samples whose own time went backwards: never interpolated across. */
  reversals: number;
}

/**
 * Measures a clock from readings. An interval in which the own clock fell
 * behind UTC by more than `toleranceS` (plus `quantumS`, the clock's own step,
 * since a stepped clock lags by up to one step) is a gap; the rate is
 * measured over the intervals that are not gaps.
 */
export function fitClock(
  samples: readonly ClockSample[],
  { toleranceS = 0.5, quantumS = 0 }: { toleranceS?: number; quantumS?: number } = {},
): ClockFit {
  const s = samples
    .filter((x) => Number.isFinite(x.utcS) && Number.isFinite(x.ownS))
    .slice()
    .sort((a, b) => a.utcS - b.utcS)
    .filter((x, i, a) => i === 0 || x.utcS > a[i - 1]!.utcS);
  const gaps: ClockGap[] = [];
  let reversals = 0,
    utcRun = 0,
    ownRun = 0,
    running = 0;
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!,
      b = s[i]!;
    const du = b.utcS - a.utcS,
      dOwn = b.ownS - a.ownS;
    if (dOwn < 0) {
      reversals++;
      continue;
    }
    if (du - dOwn > toleranceS + quantumS) {
      gaps.push({ fromUtcS: a.utcS, toUtcS: b.utcS, utcAdvanceS: du, ownAdvanceS: dOwn });
      running += dOwn;
      continue;
    }
    utcRun += du;
    ownRun += dOwn;
    running += Math.min(du, dOwn);
  }
  const last = s.at(-1);
  const span = s.length > 1 ? last!.utcS - s[0]!.utcS : 0;
  return {
    n: s.length,
    rate: utcRun > 0 ? ownRun / utcRun : null,
    offsetS: last ? last.ownS - last.utcS : null,
    runningShare: span > 0 ? Math.min(1, running / span) : null,
    gaps,
    reversals,
  };
}

// ------------------------------------------------------------- the encounter

/** A research subject's clock as the encounter clock sees it. */
export interface SubjectClock {
  id: string;
  /** The subject's own clock (s) at encounter time 0: its age when contact began. */
  ownAtContactS: number;
  /** Reads the subject's own clock now (s). */
  read(): number;
  /** Advances the subject by `dt` of its own seconds. */
  advance(dt: number): void;
}

export interface SyncRecord {
  tau: number;
  /** Own clock minus where the timeline says it should be (s), per subject. */
  skewS: [number, number];
  synchronized: boolean;
}

/**
 * The shared timeline of an encounter. Encounter time τ starts at 0 when
 * contact begins; a subject whose own clock read `ownAtContactS` then should
 * read `ownAtContactS + τ` later. `step` advances both by the same Δτ and
 * reports each one's skew: a subject advances in whole physics steps, so a
 * skew within `toleranceS` is synchronized and anything more is not.
 */
export class EncounterClock {
  readonly subjects: readonly [SubjectClock, SubjectClock];
  readonly stepS: number;
  readonly toleranceS: number;
  private steps = 0;
  private lastSync: SyncRecord;

  constructor(
    subjects: readonly [SubjectClock, SubjectClock],
    { stepS, toleranceS }: { stepS: number; toleranceS: number },
  ) {
    if (!(stepS > 0 && stepS <= 1))
      throw new Error("the encounter step must be in (0, 1] s");
    if (!(toleranceS >= 0 && toleranceS < stepS))
      throw new Error("the sync tolerance must be at least 0 and under one step");
    if (subjects[0].id === subjects[1].id)
      throw new Error("an encounter needs two different subjects");
    this.subjects = subjects;
    this.stepS = stepS;
    this.toleranceS = toleranceS;
    this.lastSync = this.measure();
  }

  /** Encounter time now (s): whole steps, never accumulated floating error. */
  get tau(): number {
    return this.steps * this.stepS;
  }

  /** Where subject `i`'s own clock should read at encounter time `tau`. */
  ownAt(i: 0 | 1, tau = this.tau): number {
    return this.subjects[i].ownAtContactS + tau;
  }

  /** Encounter time at subject `i`'s own time `own`. */
  tauAt(i: 0 | 1, own: number): number {
    return own - this.subjects[i].ownAtContactS;
  }

  get sync(): SyncRecord {
    return this.lastSync;
  }

  private measure(): SyncRecord {
    const tau = this.tau;
    const skew: [number, number] = [
      this.subjects[0].read() - this.ownAt(0, tau),
      this.subjects[1].read() - this.ownAt(1, tau),
    ];
    return {
      tau,
      skewS: skew,
      synchronized: skew.every((k) => Math.abs(k) <= this.toleranceS),
    };
  }

  /** Advances both subjects to the next encounter step and checks them. */
  step(): SyncRecord {
    const next = (this.steps + 1) * this.stepS;
    for (const i of [0, 1] as const) {
      const behind = this.ownAt(i, next) - this.subjects[i].read();
      if (behind > 0) this.subjects[i].advance(behind);
    }
    this.steps++;
    this.lastSync = this.measure();
    return this.lastSync;
  }
}
