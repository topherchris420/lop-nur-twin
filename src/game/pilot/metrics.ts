import { AXES, AXIS_ACTIONS, type Axis, type ControlFrame } from "./contract";
import type { HitRegion } from "../core/types";

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

/** Mean, median, 95th percentile and count of a sample set; nulls with no samples. */
export interface Distribution {
  count: number;
  mean: number | null;
  p50: number | null;
  p95: number | null;
}

/**
 * How well the seat shoots. Every figure is counted from the simulation — the
 * rounds `WeaponRuntime` fired, the damage the resolver applied and the region
 * it applied it to — or measured geometrically from the real aim direction.
 */
export interface ShootingMetrics {
  headshots: number;
  /** Hits on the chest or neck boxes. */
  upperChestHits: number;
  shotsPerKill: number | null;
  damagePerShot: number | null;
  /**
   * Angle from the aim to the chest of the nearest visible enemy within 10° of
   * the crosshair, at the instant each round left. The same measurement for
   * every controller; shots with no such enemy are not sampled.
   */
  shotErrorDeg: Distribution;
  /** The same measurement every third step while such an enemy is in view. */
  aimErrorDeg: Distribution;
  /** Distance to that enemy at each sampled shot, metres. */
  engagementRangeM: Distribution;
  /** Share of alive time spent at least 90% aimed down the sights. */
  adsFraction: number | null;
}

/**
 * The precision controller's own record. Null for controllers that have none —
 * a direct brain or a human — rather than zero.
 */
export interface MotorMetrics {
  /** Angle from the crosshair to the chosen aim point while tracking it, after acquisition. */
  trackingErrorDeg: Distribution;
  /** Choice of a target → crosshair first inside the chosen region, seconds. */
  acquisitionS: Distribution;
  /** Choice of a target → first hit on that target, seconds. */
  timeToFirstHitS: Distribution;
  targetsBound: number;
  targetSwitches: number;
  /** Bindings released because the target left sight. */
  targetLosses: number;
  releases: Record<string, number>;
  /** Steps where fire intent stood and the weapon could have released a round. */
  triggerOpportunities: number;
  /** …of which the fire gate held the trigger. */
  gateSuppressed: number;
  gateSuppressedFraction: number | null;
  /** Recoil counter-rotation queued per compensated shot, degrees. */
  recoilCompensationDeg: Distribution;
  /** Decision accepted → first step executing it, milliseconds of wall time. */
  executionLatencyMs: Distribution;
}

export interface EpisodeMetrics {
  /** Who was in the seat and how their aim reached the view. */
  brain: string;
  control: string;
  profile: string;
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
  shooting: ShootingMetrics;
  motor: MotorMetrics | null;
  /** Sim seconds during which a fallback brain, not the primary, was in control. */
  fallbackSeconds: number;
  /** Raw samples, for pooling percentiles across episodes. Stripped from reports. */
  raw?: RawSamples;
}

export interface RawSamples {
  shotError: number[];
  aimError: number[];
  range: number[];
  tracking: number[];
  acquisition: number[];
  firstHit: number[];
  recoil: number[];
  execution: number[];
}

export function distribution(samples: readonly number[]): Distribution {
  if (samples.length === 0) return { count: 0, mean: null, p50: null, p95: null };
  let sum = 0;
  for (const value of samples) sum += value;
  return {
    count: samples.length,
    mean: sum / samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
  };
}

function emptyRaw(): RawSamples {
  return {
    shotError: [],
    aimError: [],
    range: [],
    tracking: [],
    acquisition: [],
    firstHit: [],
    recoil: [],
    execution: [],
  };
}

function push(list: number[], value: number): void {
  if (list.length < MAX_SAMPLES && Number.isFinite(value)) list.push(value);
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
  brain = "human";
  control = "direct";
  profile = "standard";
  headshots = 0;
  upperChestHits = 0;
  adsSeconds = 0;
  aliveSeconds = 0;
  fallbackSeconds = 0;
  /** True once a precision controller has run this episode. */
  motorActive = false;
  targetsBound = 0;
  targetSwitches = 0;
  targetLosses = 0;
  releases: Record<string, number> = {};
  triggerOpportunities = 0;
  gateSuppressed = 0;
  private raw = emptyRaw();
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

  get killsAtStart(): number {
    return this.baseKills;
  }

  get deathsAtStart(): number {
    return this.baseDeaths;
  }

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
    this.headshots = 0;
    this.upperChestHits = 0;
    this.adsSeconds = 0;
    this.aliveSeconds = 0;
    this.fallbackSeconds = 0;
    this.motorActive = false;
    this.targetsBound = 0;
    this.targetSwitches = 0;
    this.targetLosses = 0;
    this.releases = {};
    this.triggerOpportunities = 0;
    this.gateSuppressed = 0;
    this.raw = emptyRaw();
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

  onHit(amount: number, region: HitRegion | null = null): void {
    this.hits += 1;
    this.damageDealt += amount;
    if (region === "head") this.headshots += 1;
    else if (region === "chest" || region === "neck") this.upperChestHits += 1;
  }

  /** Once per step alive: how aimed the weapon is, and who is in control. */
  stepState(dt: number, adsProgress: number, fallback: boolean): void {
    this.aliveSeconds += dt;
    if (adsProgress >= 0.9) this.adsSeconds += dt;
    if (fallback) this.fallbackSeconds += dt;
  }

  onShotAudit(errorDeg: number, rangeM: number): void {
    push(this.raw.shotError, errorDeg);
    push(this.raw.range, rangeM);
  }

  onAimAudit(errorDeg: number): void {
    push(this.raw.aimError, errorDeg);
  }

  onTracking(errorDeg: number): void {
    this.motorActive = true;
    push(this.raw.tracking, errorDeg);
  }

  onBind(switched: boolean): void {
    this.motorActive = true;
    this.targetsBound += 1;
    if (switched) this.targetSwitches += 1;
  }

  onRelease(reason: string): void {
    this.releases[reason] = (this.releases[reason] ?? 0) + 1;
    if (reason === "lost_sight") this.targetLosses += 1;
  }

  onAcquired(seconds: number): void {
    push(this.raw.acquisition, seconds);
  }

  onFirstHit(seconds: number): void {
    push(this.raw.firstHit, seconds);
  }

  onTriggerOpportunity(fired: boolean): void {
    this.motorActive = true;
    this.triggerOpportunities += 1;
    if (!fired) this.gateSuppressed += 1;
  }

  onRecoilCompensation(degrees: number): void {
    push(this.raw.recoil, degrees);
  }

  onExecutionLatency(ms: number): void {
    push(this.raw.execution, ms);
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
    const episodeKills = kills - this.baseKills;
    return {
      brain: this.brain,
      control: this.control,
      profile: this.profile,
      simSeconds: this.simSeconds,
      wallSeconds: Math.max(0, (wallNow - this.startWall) / 1000),
      kills: episodeKills,
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
      shooting: shootingOf(
        {
          shots: this.shotsFired,
          kills: episodeKills,
          damage: this.damageDealt,
          headshots: this.headshots,
          upperChestHits: this.upperChestHits,
          adsSeconds: this.adsSeconds,
          aliveSeconds: this.aliveSeconds,
        },
        this.raw,
      ),
      motor: this.motorActive
        ? motorOf(
            {
              targetsBound: this.targetsBound,
              targetSwitches: this.targetSwitches,
              targetLosses: this.targetLosses,
              releases: { ...this.releases },
              triggerOpportunities: this.triggerOpportunities,
              gateSuppressed: this.gateSuppressed,
            },
            this.raw,
          )
        : null,
      fallbackSeconds: this.fallbackSeconds,
      raw: JSON.parse(JSON.stringify(this.raw)) as RawSamples,
    };
  }
}

interface ShootingCounts {
  shots: number;
  kills: number;
  damage: number;
  headshots: number;
  upperChestHits: number;
  adsSeconds: number;
  aliveSeconds: number;
}

function shootingOf(c: ShootingCounts, raw: RawSamples): ShootingMetrics {
  return {
    headshots: c.headshots,
    upperChestHits: c.upperChestHits,
    shotsPerKill: c.kills > 0 ? c.shots / c.kills : null,
    damagePerShot: c.shots > 0 ? c.damage / c.shots : null,
    shotErrorDeg: distribution(raw.shotError),
    aimErrorDeg: distribution(raw.aimError),
    engagementRangeM: distribution(raw.range),
    adsFraction: c.aliveSeconds > 0 ? c.adsSeconds / c.aliveSeconds : null,
  };
}

interface MotorCounts {
  targetsBound: number;
  targetSwitches: number;
  targetLosses: number;
  releases: Record<string, number>;
  triggerOpportunities: number;
  gateSuppressed: number;
}

function motorOf(c: MotorCounts, raw: RawSamples): MotorMetrics {
  return {
    trackingErrorDeg: distribution(raw.tracking),
    acquisitionS: distribution(raw.acquisition),
    timeToFirstHitS: distribution(raw.firstHit),
    targetsBound: c.targetsBound,
    targetSwitches: c.targetSwitches,
    targetLosses: c.targetLosses,
    releases: c.releases,
    triggerOpportunities: c.triggerOpportunities,
    gateSuppressed: c.gateSuppressed,
    gateSuppressedFraction:
      c.triggerOpportunities > 0 ? c.gateSuppressed / c.triggerOpportunities : null,
    recoilCompensationDeg: distribution(raw.recoil),
    executionLatencyMs: distribution(raw.execution),
  };
}

export interface AggregateMetrics {
  brain: string;
  control: string;
  profile: string;
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
  shooting: ShootingMetrics;
  motor: MotorMetrics | null;
  fallbackSeconds: number;
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
  const raw = emptyRaw();
  const shooting = {
    shots: 0,
    kills: 0,
    damage: 0,
    headshots: 0,
    upperChestHits: 0,
    adsSeconds: 0,
    aliveSeconds: 0,
  };
  let motor: MotorCounts | null = null;
  let fallbackSeconds = 0;
  const labels = {
    brain: new Set<string>(),
    control: new Set<string>(),
    profile: new Set<string>(),
  };
  for (const episode of episodes) {
    labels.brain.add(episode.brain);
    labels.control.add(episode.control);
    labels.profile.add(episode.profile);
    fallbackSeconds += episode.fallbackSeconds;
    shooting.headshots += episode.shooting.headshots;
    shooting.upperChestHits += episode.shooting.upperChestHits;
    const alive = episode.lifeSeconds.reduce((a, b) => a + b, 0);
    shooting.aliveSeconds += alive;
    shooting.adsSeconds += (episode.shooting.adsFraction ?? 0) * alive;
    if (episode.raw) {
      for (const key of Object.keys(raw) as (keyof RawSamples)[]) {
        for (const value of episode.raw[key]) push(raw[key], value);
      }
    }
    if (episode.motor) {
      motor ??= {
        targetsBound: 0,
        targetSwitches: 0,
        targetLosses: 0,
        releases: {},
        triggerOpportunities: 0,
        gateSuppressed: 0,
      };
      motor.targetsBound += episode.motor.targetsBound;
      motor.targetSwitches += episode.motor.targetSwitches;
      motor.targetLosses += episode.motor.targetLosses;
      motor.triggerOpportunities += episode.motor.triggerOpportunities;
      motor.gateSuppressed += episode.motor.gateSuppressed;
      for (const [reason, n] of Object.entries(episode.motor.releases)) {
        motor.releases[reason] = (motor.releases[reason] ?? 0) + n;
      }
    }
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
  shooting.shots = shots;
  shooting.kills = kills;
  shooting.damage = dealt;
  const label = (set: Set<string>): string =>
    set.size === 0 ? "none" : [...set].sort().join("+");
  return {
    brain: label(labels.brain),
    control: label(labels.control),
    profile: label(labels.profile),
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
    shooting: shootingOf(shooting, raw),
    motor: motor ? motorOf(motor, raw) : null,
    fallbackSeconds,
  };
}
