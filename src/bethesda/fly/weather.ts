/**
 * Bethesda's wind as the fly meets it: a seeded function of the city's seed
 * and the city's clock. It holds no state, so the wind at a moment is the same
 * whenever and however often it is asked for: in the browser city and in the
 * headless life, after a restore, and however the fly's advance is split. The
 * city never reads it; it reads from the city only when a storm blows.
 *
 * The wind at 10 m takes a regime (calm, breezy or windy) for each half-hour
 * block, blending into the next block's over the last ten minutes; while the
 * city has a storm it rises to the storm regime over a minute and falls back
 * over the storm's last minute. Within a regime its speed fluctuates smoothly
 * about the regime's mean, the direction it comes from wanders about the
 * prevailing one, and gusts come and go: a gust multiplies the speed, rising
 * over a second or three and dying away over several. Near the ground it is
 * weaker by a power law of height, in the lee of a building weaker still, and
 * slower again where it meets a wall (`BethesdaFlyWorld.wind`).
 *
 * Every number here is a model choice for this simulator, not measured
 * Bethesda weather and not fitted, and the process is a sketch of urban wind,
 * not a model of the atmosphere: no turbulence finer than a gust, no flow
 * round buildings beyond the lee, no vertical wind and no rain.
 */

/** The wind's regimes: mean speed at 10 m, gusts per minute and the mean gust factor (model). */
export const WIND_REGIMES = {
  calm: { speedMS: 0.6, gustsPerMin: 0.2, gustFactor: 1.4 },
  breezy: { speedMS: 2.5, gustsPerMin: 0.8, gustFactor: 1.5 },
  windy: { speedMS: 5.5, gustsPerMin: 1.6, gustFactor: 1.7 },
  storm: { speedMS: 9, gustsPerMin: 3, gustFactor: 1.9 },
} as const;
export type WindRegime = keyof typeof WIND_REGIMES;

export const WEATHER_MODEL = {
  /** A regime holds for blocks of this length (s)... */
  blockS: 30 * 60,
  /** ...blending into the next block's over this last part of each (s). */
  blendS: 10 * 60,
  /** How often each regime is drawn for a block, outside a storm. */
  regimeWeights: { calm: 0.3, breezy: 0.45, windy: 0.25 },
  /** A storm's wind rises over its first, and falls over its last, this long (s). */
  stormRampS: 60,
  /** Smooth fluctuations of the speed: share of the regime's mean, at two time scales (s). */
  slowShare: 0.25,
  slowS: 90,
  fastShare: 0.1,
  fastS: 12,
  /** The prevailing direction the wind comes from: west-north-west (compass degrees). */
  prevailingFromDeg: 290,
  /** The direction wanders about it by up to about this much (rad), at two time scales (s). */
  slowTurnRad: 0.7,
  slowTurnS: 30 * 60,
  fastTurnRad: 0.15,
  fastTurnS: 60,
  /** Gusts are drawn per slot of this length (s); one may start in each. */
  gustSlotS: 10,
  /** A gust rises over this many seconds, then dies away over these many. */
  gustRiseS: [1, 3],
  gustDecayS: [4, 10],
  /** A gust is blowing while the speed is at least this share above the gustless one. */
  gustingShare: 0.05,
  /** The wind at height h is the 10 m wind × (max(h, floor) / 10)^exponent (an urban power law). */
  heightExponent: 0.35,
  heightFloorM: 0.25,
  /** In a building's lee the wind keeps this share right behind the wall, all of it this far away (m). */
  shelterKeep: 0.25,
  shelterM: 12,
  /** Meeting a wall the wind keeps `shelterKeep` at the wall, all of it this far in front (m). */
  windwardM: 3,
} as const;

/** A storm in the city: when its wind starts and stops, in city seconds. */
export interface StormWindow {
  from: number;
  to: number;
}

/** The wind at 10 m at one moment. */
export interface WindNow {
  /** The regime that dominates now (a storm while its wind is more than half up). */
  regime: WindRegime;
  /** Speed at 10 m (m/s), the gust included. */
  speedMS: number;
  /** The compass direction it comes from (radians, clockwise from north). */
  from: number;
  /** Whether a gust is blowing. */
  gusting: boolean;
}

/** One of the wind's seeded draws, in [0, 1): a hash of the seed, a stream and an index (murmur3's finalizer). */
function draw(seed: number, stream: number, i: number): number {
  const mix = (h: number) => {
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const a = mix((seed ^ Math.imul(stream + 1, 0x9e3779b1)) >>> 0);
  return mix((a ^ Math.imul(i | 0, 0x27d4eb2f)) >>> 0) / 4294967296;
}

const smooth = (u: number) => u * u * (3 - 2 * u);

/** Smooth noise in [−1, 1] of time `t` (s) at scale `period`, from one stream of draws. */
function wander(seed: number, stream: number, t: number, period: number): number {
  const x = t / period;
  const k = Math.floor(x);
  const a = draw(seed, stream, k) * 2 - 1,
    b = draw(seed, stream, k + 1) * 2 - 1;
  return a + (b - a) * smooth(x - k);
}

/** The draws' streams. */
const S = {
  regime: 1,
  slow: 2,
  fast: 3,
  slowTurn: 4,
  fastTurn: 5,
  gust: 6,
  gustAt: 7,
  gustRise: 8,
  gustDecay: 9,
  gustPeak: 10,
} as const;

interface Mix {
  speedMS: number;
  gustsPerMin: number;
  gustFactor: number;
}

function regimeOf(seed: number, block: number): WindRegime {
  const w = WEATHER_MODEL.regimeWeights;
  const u = draw(seed, S.regime, block);
  return u < w.calm ? "calm" : u < w.calm + w.breezy ? "breezy" : "windy";
}

function lerp(a: Mix, b: Mix, u: number): Mix {
  return {
    speedMS: a.speedMS + (b.speedMS - a.speedMS) * u,
    gustsPerMin: a.gustsPerMin + (b.gustsPerMin - a.gustsPerMin) * u,
    gustFactor: a.gustFactor + (b.gustFactor - a.gustFactor) * u,
  };
}

/** How far up a storm's wind is at `t`, 0 to 1. */
export function stormShare(t: number, storms: readonly StormWindow[]): number {
  const ramp = WEATHER_MODEL.stormRampS;
  let w = 0;
  for (const s of storms) {
    if (t <= s.from || t >= s.to) continue;
    const up = smooth(Math.min(1, (t - s.from) / ramp));
    const down = smooth(Math.min(1, (s.to - t) / ramp));
    w = Math.max(w, Math.min(up, down));
  }
  return w;
}

/** The regime's mean speed, gust rate and gust factor at `t`, blended between blocks and into a storm. */
function regimeAt(
  seed: number,
  t: number,
  storms: readonly StormWindow[],
): { mix: Mix; regime: WindRegime } {
  const m = WEATHER_MODEL;
  const block = Math.floor(t / m.blockS);
  const into = t - block * m.blockS;
  const here = regimeOf(seed, block);
  const u =
    into > m.blockS - m.blendS ? smooth((into - (m.blockS - m.blendS)) / m.blendS) : 0;
  const next = u > 0 ? regimeOf(seed, block + 1) : here;
  const calm = lerp(WIND_REGIMES[here], WIND_REGIMES[next], u);
  const w = stormShare(t, storms);
  return {
    mix: w > 0 ? lerp(calm, WIND_REGIMES.storm, w) : calm,
    regime: w > 0.5 ? "storm" : u > 0.5 ? next : here,
  };
}

/** The share a gust adds to the speed at `t`: the largest of the gusts blowing then. */
function gustAt(seed: number, t: number, storms: readonly StormWindow[]): number {
  const m = WEATHER_MODEL;
  const slot = m.gustSlotS;
  const longest = m.gustRiseS[1] + m.gustDecayS[1];
  let add = 0;
  for (let k = Math.floor((t - longest - slot) / slot); k <= Math.floor(t / slot); k++) {
    const t0 = k * slot;
    const { mix } = regimeAt(seed, t0, storms);
    if (draw(seed, S.gust, k) >= (mix.gustsPerMin * slot) / 60) continue;
    const start = t0 + draw(seed, S.gustAt, k) * slot;
    const rise =
      m.gustRiseS[0] + draw(seed, S.gustRise, k) * (m.gustRiseS[1] - m.gustRiseS[0]);
    const decay =
      m.gustDecayS[0] + draw(seed, S.gustDecay, k) * (m.gustDecayS[1] - m.gustDecayS[0]);
    const peak = (mix.gustFactor - 1) * (0.6 + 0.8 * draw(seed, S.gustPeak, k));
    const u = t - start;
    if (u <= 0 || u >= rise + decay) continue;
    const shape =
      u < rise ? smooth(u / rise) : 0.5 * (1 + Math.cos((Math.PI * (u - rise)) / decay));
    add = Math.max(add, peak * shape);
  }
  return add;
}

/** The wind at 10 m at city time `t` (s), for a city with seed `seed` and these storms. */
export function windAt(
  seed: number,
  t: number,
  storms: readonly StormWindow[] = [],
): WindNow {
  const m = WEATHER_MODEL;
  const { mix, regime } = regimeAt(seed, t, storms);
  const vary =
    1 +
    m.slowShare * wander(seed, S.slow, t, m.slowS) +
    m.fastShare * wander(seed, S.fast, t, m.fastS);
  const gust = gustAt(seed, t, storms);
  const from =
    (m.prevailingFromDeg * Math.PI) / 180 +
    m.slowTurnRad * wander(seed, S.slowTurn, t, m.slowTurnS) +
    m.fastTurnRad * wander(seed, S.fastTurn, t, m.fastTurnS);
  return {
    regime,
    speedMS: Math.max(0, mix.speedMS * vary) * (1 + gust),
    from: Math.atan2(Math.sin(from), Math.cos(from)),
    gusting: gust >= m.gustingShare,
  };
}

/** The world velocity (m/s; x east, z south) of a wind of `speed` from compass bearing `from`. */
export function windVelocity(speed: number, from: number): [number, number] {
  // A compass bearing β points along (sin β, −cos β); the wind blows the other way.
  return [-Math.sin(from) * speed, Math.cos(from) * speed];
}

/** The share of the 10 m wind at `h` metres above the ground. */
export function heightShare(h: number): number {
  const m = WEATHER_MODEL;
  return Math.pow(Math.max(h, m.heightFloorM) / 10, m.heightExponent);
}

/**
 * The share of the wind left at a point with a wall `lee` metres upwind of
 * it and one `windward` metres downwind (Infinity: none): the lee's shelter
 * times the slowing where the wind meets a wall.
 */
export function shelterShare(lee: number, windward = Infinity): number {
  const m = WEATHER_MODEL;
  const share = (d: number, reach: number) =>
    d >= reach ? 1 : m.shelterKeep + (1 - m.shelterKeep) * Math.max(0, d / reach);
  return share(lee, m.shelterM) * share(windward, m.windwardM);
}
