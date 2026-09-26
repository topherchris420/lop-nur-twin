import { AXES, AXIS_ACTIONS, type Axis, type ControlFrame } from "./contract";

/**
 * Per-episode statistics for whoever is controlling the player.
 *
 * Every number here is counted from something the simulation already did —
 * a round the weapon runtime fired, damage the resolver applied, a death the
 * match director recorded, metres the controller actually moved — never from
 * what a brain intended. The benchmark reads these and nothing else, and the
 * aggregation helpers report only what was measured: a statistic with no
 * samples is `null`, never zero.
 */

export interface LatencySummary {
  count: number;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface DecisionCounters {
  requested: number;
  accepted: number;
  fallback: number;
  timeouts: number;
  stale: number;
  duplicates: number;
  invalid: number;
  errors: number;
  rateLimited: number;
  unavailable: number;
  aborted: number;
}

export interface EpisodeMetrics {
  simSeconds: number;
  wallSeconds: number;
  kills: number;
  deaths: number;
  shotsFired: number;
  hits: number;
  /** Hits divided by shots, or null when nothing was fired. */
  accuracy: number | null;
  damageDealt: number;
  damageTaken: number;
  /** Seconds alive per life, including the life in progress. */
  lifeSeconds: number[];
  meanSurvivalS: number | null;
  distanceM: number;
  decisions: DecisionCounters;
  actions: Record<Axis, Record<string, number>>;
  latency: LatencySummary;
  serverLatency: LatencySummary;
  /** TypeSafe's reported confidence per axis, only when it reported one. */
  confidence: Record<Axis, LatencySummary>;
  models: string[];
}

export function emptyCounters(): DecisionCounters {
  return {
    requested: 0,
    accepted: 0,
    fallback: 0,
    timeouts: 0,
    stale: 0,
    duplicates: 0,
    invalid: 0,
    errors: 0,
    rateLimited: 0,
    unavailable: 0,
    aborted: 0,
  };
}

function emptySamples(): Record<Axis, number[]> {
  return Object.fromEntries(AXES.map((axis) => [axis, []])) as unknown as Record<
    Axis,
    number[]
  >;
}

function emptyHistogram(): Record<Axis, Record<string, number>> {
  const out = {} as Record<Axis, Record<string, number>>;
  for (const axis of AXES) {
    out[axis] = Object.fromEntries(AXIS_ACTIONS[axis].map((action) => [action, 0]));
  }
  return out;
}

/** Nearest-rank percentile over a copy; `null` when there are no samples. */
export function percentile(samples: readonly number[], p: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1]!;
}

export function summarize(samples: readonly number[]): LatencySummary {
  if (samples.length === 0) {
    return { count: 0, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  }
  let sum = 0;
  let max = -Infinity;
  for (const value of samples) {
    sum += value;
    max = Math.max(max, value);
  }
  return {
    count: samples.length,
    meanMs: sum / samples.length,
    p50Ms: percentile(samples, 50),
    p95Ms: percentile(samples, 95),
    maxMs: max,
  };
}

const MAX_SAMPLES = 20000;

export class PilotMetrics {
  counters = emptyCounters();
  private histogram = emptyHistogram();
  private latencies: number[] = [];
  private serverLatencies: number[] = [];
  private confidences = emptySamples();
  private models = new Set<string>();
  shotsFired = 0;
  hits = 0;
  damageDealt = 0;
  damageTaken = 0;
  distanceM = 0;
  private simSeconds = 0;
  private lives: number[] = [];
  private currentLife = 0;
  private startWall = 0;
  private baseKills = 0;
  private baseDeaths = 0;

  /** Start a fresh episode from the player's current kill and death counts. */
  reset(kills: number, deaths: number, wallNow: number): void {
    this.counters = emptyCounters();
    this.histogram = emptyHistogram();
    this.latencies = [];
    this.serverLatencies = [];
    this.confidences = emptySamples();
    this.models = new Set();
    this.shotsFired = 0;
    this.hits = 0;
    this.damageDealt = 0;
    this.damageTaken = 0;
    this.distanceM = 0;
    this.simSeconds = 0;
    this.lives = [];
    this.currentLife = 0;
    this.startWall = wallNow;
    this.baseKills = kills;
    this.baseDeaths = deaths;
  }

  /** Once per simulation step while a match is running. */
  step(dt: number, alive: boolean, movedM: number): void {
    this.simSeconds += dt;
    if (alive) {
      this.currentLife += dt;
      // A respawn is a teleport, not a walk; a step that long never happens.
      if (movedM < 5) this.distanceM += movedM;
    }
  }

  onDeath(): void {
    this.lives.push(this.currentLife);
    this.currentLife = 0;
  }

  onShot(): void {
    this.shotsFired += 1;
  }

  onHit(amount: number): void {
    this.hits += 1;
    this.damageDealt += amount;
  }

  onDamageTaken(amount: number): void {
    this.damageTaken += amount;
  }

  onFrame(frame: ControlFrame): void {
    for (const axis of AXES) {
      const bucket = this.histogram[axis];
      bucket[frame[axis]] = (bucket[frame[axis]] ?? 0) + 1;
    }
  }

  onDecisionLatency(
    latencyMs: number,
    serverLatencyMs: number | null,
    model: string | null,
    confidence: Partial<Record<Axis, number>> | null,
  ): void {
    if (this.latencies.length < MAX_SAMPLES) this.latencies.push(latencyMs);
    if (serverLatencyMs !== null && this.serverLatencies.length < MAX_SAMPLES) {
      this.serverLatencies.push(serverLatencyMs);
    }
    if (model) this.models.add(model);
    if (confidence) {
      for (const axis of AXES) {
        const value = confidence[axis];
        if (value !== undefined && this.confidences[axis].length < MAX_SAMPLES) {
          this.confidences[axis].push(value);
        }
      }
    }
  }

  /** Raw latency samples, so a benchmark can pool percentiles across episodes. */
  samples(): { latency: number[]; serverLatency: number[] } {
    return { latency: [...this.latencies], serverLatency: [...this.serverLatencies] };
  }

  snapshot(kills: number, deaths: number, wallNow: number): EpisodeMetrics {
    const lifeSeconds = [...this.lives, this.currentLife].filter((s) => s > 0);
    const survival = lifeSeconds.length
      ? lifeSeconds.reduce((a, b) => a + b, 0) / lifeSeconds.length
      : null;
    const summarizeUnit = (samples: number[]): LatencySummary => summarize(samples);
    return {
      simSeconds: this.simSeconds,
      wallSeconds: Math.max(0, (wallNow - this.startWall) / 1000),
      kills: kills - this.baseKills,
      deaths: deaths - this.baseDeaths,
      shotsFired: this.shotsFired,
      hits: this.hits,
      accuracy: this.shotsFired > 0 ? this.hits / this.shotsFired : null,
      damageDealt: this.damageDealt,
      damageTaken: this.damageTaken,
      lifeSeconds,
      meanSurvivalS: survival,
      distanceM: this.distanceM,
      decisions: { ...this.counters },
      actions: JSON.parse(JSON.stringify(this.histogram)) as Record<
        Axis,
        Record<string, number>
      >,
      latency: summarize(this.latencies),
      serverLatency: summarize(this.serverLatencies),
      confidence: Object.fromEntries(
        AXES.map((axis) => [axis, summarizeUnit(this.confidences[axis])]),
      ) as Record<Axis, LatencySummary>,
      models: [...this.models].sort(),
    };
  }
}

export interface AggregateMetrics {
  episodes: number;
  simSeconds: number;
  kills: number;
  deaths: number;
  /** Kills per death, or null with no deaths (an undefined ratio is not infinity). */
  killDeathRatio: number | null;
  shotsFired: number;
  hits: number;
  accuracy: number | null;
  damageDealt: number;
  damageTaken: number;
  meanSurvivalS: number | null;
  distanceM: number;
  decisions: DecisionCounters;
  actions: Record<Axis, Record<string, number>>;
  latency: LatencySummary;
  serverLatency: LatencySummary;
  models: string[];
}

/**
 * Pool several episodes. Latency percentiles are recomputed over the pooled
 * samples, not averaged across episodes, so `latencySamples` must carry them.
 */
export function aggregateEpisodes(
  episodes: readonly EpisodeMetrics[],
  latencySamples: readonly number[] = [],
  serverLatencySamples: readonly number[] = [],
): AggregateMetrics {
  const decisions = emptyCounters();
  const actions = emptyHistogram();
  const lives: number[] = [];
  const models = new Set<string>();
  let simSeconds = 0;
  let kills = 0;
  let deaths = 0;
  let shots = 0;
  let hits = 0;
  let dealt = 0;
  let taken = 0;
  let distance = 0;
  for (const episode of episodes) {
    simSeconds += episode.simSeconds;
    kills += episode.kills;
    deaths += episode.deaths;
    shots += episode.shotsFired;
    hits += episode.hits;
    dealt += episode.damageDealt;
    taken += episode.damageTaken;
    distance += episode.distanceM;
    lives.push(...episode.lifeSeconds);
    for (const model of episode.models) models.add(model);
    for (const key of Object.keys(decisions) as (keyof DecisionCounters)[]) {
      decisions[key] += episode.decisions[key];
    }
    for (const axis of AXES) {
      for (const [action, count] of Object.entries(episode.actions[axis])) {
        actions[axis][action] = (actions[axis][action] ?? 0) + count;
      }
    }
  }
  return {
    episodes: episodes.length,
    simSeconds,
    kills,
    deaths,
    killDeathRatio: deaths > 0 ? kills / deaths : null,
    shotsFired: shots,
    hits,
    accuracy: shots > 0 ? hits / shots : null,
    damageDealt: dealt,
    damageTaken: taken,
    meanSurvivalS: lives.length ? lives.reduce((a, b) => a + b, 0) / lives.length : null,
    distanceM: distance,
    decisions,
    actions,
    latency: summarize(latencySamples),
    serverLatency: summarize(serverLatencySamples),
    models: [...models].sort(),
  };
}
