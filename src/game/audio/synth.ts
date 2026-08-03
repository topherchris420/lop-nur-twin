import { mulberry32 } from "@/lib/noise";

/**
 * The DSP toolbox.
 *
 * Everything the game hears is built here from oscillators, noise buffers we
 * fill ourselves, biquads, waveshapers and convolvers whose impulse responses
 * are generated at runtime. There are no binary assets anywhere in the audio
 * system and nothing is fetched.
 *
 * Two rules make the rest of the engine possible:
 *
 * 1. **Every function takes a `BaseAudioContext`.** Realtime playback and the
 *    `OfflineAudioContext` renders used by `__offline.ts` run the exact same
 *    code, so what the probe measures is what the player hears.
 * 2. **Every function takes an absolute `when` and returns the time it ends.**
 *    Nothing reads `ctx.currentTime`; the caller owns scheduling. That is what
 *    lets the engine push a shot 0.28 s into the future for a 96 m arrival
 *    delay without any node touching a clock.
 *
 * Randomness flows through `mulberry32`, seeded by the caller, so a given
 * (weapon, variant) always renders sample-identical audio.
 */

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

export type Rand = () => number;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Random number in `[lo, hi)` from a seeded stream. */
export function range(rand: Rand, lo: number, hi: number): number {
  return lo + (hi - lo) * rand();
}

/** Symmetric jitter: `v * (1 +/- amount)`. */
export function jitter(rand: Rand, v: number, amount: number): number {
  return v * (1 + (rand() * 2 - 1) * amount);
}

/** FNV-1a, so string ids can seed `mulberry32` deterministically. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mixSeeds(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  return h >>> 0;
}

export function seededRand(...parts: readonly (string | number)[]): Rand {
  let seed = 0x9e3779b9;
  for (const part of parts) {
    seed = mixSeeds(seed, typeof part === "string" ? hashString(part) : part | 0);
  }
  return mulberry32(seed >>> 0);
}

/** Decibels to linear gain. */
export function db(value: number): number {
  return Math.pow(10, value / 20);
}

/* ------------------------------------------------------------------ */
/* Node helpers                                                        */
/* ------------------------------------------------------------------ */

export function gainNode(ctx: BaseAudioContext, value = 1): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

export function biquad(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  freq: number,
  q = 0.7071,
  gainDb = 0,
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = clamp(freq, 10, ctx.sampleRate * 0.5 - 100);
  f.Q.value = q;
  f.gain.value = gainDb;
  return f;
}

/** Connect a list of nodes head-to-tail and return the tail. */
export function connectChain(nodes: readonly AudioNode[]): AudioNode {
  const first = nodes[0];
  if (!first) throw new Error("connectChain needs at least one node");
  let prev = first;
  for (let i = 1; i < nodes.length; i += 1) {
    const next = nodes[i]!;
    prev.connect(next);
    prev = next;
  }
  return prev;
}

/** Disconnect a whole set of nodes; used when a voice is retired or stolen. */
export function disconnectAll(nodes: readonly AudioNode[]): void {
  for (const n of nodes) {
    try {
      n.disconnect();
    } catch {
      /* already detached */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Envelopes                                                           */
/* ------------------------------------------------------------------ */

export interface EnvSpec {
  peak: number;
  /** Seconds from silence to peak. 2-4 ms is a gunshot transient. */
  attack: number;
  /** Seconds held at peak before the decay starts. */
  hold?: number;
  /** Seconds from peak back to the floor. */
  decay: number;
  /** Exponential floor; also the level at which the envelope is cut to zero. */
  floor?: number;
  shape?: "exp" | "lin";
}

const MIN_GAIN = 1e-5;

/**
 * Schedule a percussive envelope on a gain param and return the end time.
 * Exponential ramps cannot touch zero, so the decay lands on `floor` and is
 * then hard-zeroed — inaudible, and it keeps the param graph finite.
 */
export function scheduleEnv(param: AudioParam, when: number, spec: EnvSpec): number {
  const floor = Math.max(MIN_GAIN, spec.floor ?? MIN_GAIN);
  const peak = Math.max(floor * 2, spec.peak);
  const hold = spec.hold ?? 0;
  const attackEnd = when + Math.max(0.0002, spec.attack);
  const decayStart = attackEnd + hold;
  const end = decayStart + Math.max(0.002, spec.decay);
  param.setValueAtTime(floor, when);
  param.linearRampToValueAtTime(peak, attackEnd);
  if (hold > 0) param.setValueAtTime(peak, decayStart);
  if ((spec.shape ?? "exp") === "exp") {
    param.exponentialRampToValueAtTime(floor, end);
  } else {
    param.linearRampToValueAtTime(floor, end);
  }
  param.setValueAtTime(0, end);
  return end;
}

/** Exponential glide between two positive values (frequency, playbackRate). */
export function glide(
  param: AudioParam,
  when: number,
  from: number,
  to: number,
  seconds: number,
): void {
  param.setValueAtTime(Math.max(1e-3, from), when);
  param.exponentialRampToValueAtTime(Math.max(1e-3, to), when + Math.max(0.001, seconds));
}

/* ------------------------------------------------------------------ */
/* Noise                                                               */
/* ------------------------------------------------------------------ */

export type NoiseKind = "white" | "pink" | "brown";

interface NoiseCache {
  readonly buffers: Map<string, AudioBuffer>;
  readonly irs: Map<string, AudioBuffer>;
  readonly curves: Map<string, Float32Array>;
}

const caches = new WeakMap<BaseAudioContext, NoiseCache>();

function cacheFor(ctx: BaseAudioContext): NoiseCache {
  let c = caches.get(ctx);
  if (!c) {
    c = { buffers: new Map(), irs: new Map(), curves: new Map() };
    caches.set(ctx, c);
  }
  return c;
}

function fillWhite(out: Float32Array, rand: Rand): void {
  for (let i = 0; i < out.length; i += 1) out[i] = rand() * 2 - 1;
}

/** Paul Kellett's economical pink filter — flat-ish -3 dB/octave. */
function fillPink(out: Float32Array, rand: Rand): void {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < out.length; i += 1) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
}

/** Leaky integrator — -6 dB/octave, the bed under desert wind. */
function fillBrown(out: Float32Array, rand: Rand): void {
  let last = 0;
  for (let i = 0; i < out.length; i += 1) {
    const w = rand() * 2 - 1;
    last = (last + 0.021 * w) / 1.021;
    out[i] = last * 3.6;
  }
}

function normalise(out: Float32Array, target: number): void {
  let peak = 0;
  for (let i = 0; i < out.length; i += 1) {
    const a = Math.abs(out[i]!);
    if (a > peak) peak = a;
  }
  if (peak < 1e-9) return;
  const k = target / peak;
  for (let i = 0; i < out.length; i += 1) out[i] = out[i]! * k;
}

/**
 * Cached stereo noise. Channels use different seeds so the two sides are
 * decorrelated, which is what makes a wind bed or a reverb tail feel wide.
 */
export function noiseBuffer(
  ctx: BaseAudioContext,
  kind: NoiseKind,
  seconds = 2.5,
  seed = 0x51ee,
): AudioBuffer {
  const cache = cacheFor(ctx).buffers;
  const key = `${kind}:${seconds}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const frames = Math.max(256, Math.round(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, frames, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    const rand = mulberry32(mixSeeds(seed, ch * 7919 + hashString(kind)));
    if (kind === "white") fillWhite(data, rand);
    else if (kind === "pink") fillPink(data, rand);
    else fillBrown(data, rand);
    normalise(data, 0.92);
  }
  cache.set(key, buffer);
  return buffer;
}

export interface NoiseSourceOptions {
  kind?: NoiseKind;
  /** Playback rate; sweeping it is how doppler is faked on noise. */
  rate?: number;
  loop?: boolean;
  /** Deterministic read offset into the cached buffer. */
  rand?: Rand;
  seconds?: number;
}

/**
 * A looping read head into the shared noise buffer at a seeded offset, so two
 * bursts from the same buffer never phase-cancel into an obvious "sample".
 */
export function noiseSource(
  ctx: BaseAudioContext,
  options: NoiseSourceOptions = {},
): AudioBufferSourceNode {
  const buffer = noiseBuffer(ctx, options.kind ?? "white", options.seconds ?? 2.5);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = options.loop ?? true;
  src.playbackRate.value = options.rate ?? 1;
  return src;
}

/** Deterministic read offset in seconds for a noise source. */
export function noiseOffset(rand: Rand | undefined, buffer: AudioBuffer): number {
  return (rand ? rand() : 0) * Math.max(0, buffer.duration - 0.35);
}

/* ------------------------------------------------------------------ */
/* Waveshaping                                                         */
/* ------------------------------------------------------------------ */

export type ShaperKind = "soft" | "tanh" | "asym" | "fold" | "limit";

/**
 * Curve tables for `WaveShaperNode`. `limit` is the master safety clipper: it
 * is linear below ~0.4 and asymptotes to `ceiling`, so however many gunshots
 * land on the same frame the bus cannot leave 0 dBFS.
 */
export function shaperCurve(
  ctx: BaseAudioContext,
  kind: ShaperKind,
  amount = 1,
  samples = 2048,
): Float32Array {
  const cache = cacheFor(ctx).curves;
  const key = `${kind}:${amount}:${samples}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const curve = new Float32Array(samples);
  const k = Math.max(0.001, amount);
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    let y: number;
    switch (kind) {
      case "soft":
        y = (x * (1 + k)) / (1 + k * Math.abs(x));
        break;
      case "tanh":
        y = Math.tanh(x * k) / Math.tanh(k);
        break;
      case "asym": {
        const drive = x >= 0 ? k : k * 0.55;
        y = Math.tanh(x * drive) / Math.tanh(k);
        break;
      }
      case "fold": {
        const t = x * k;
        y = Math.sin(t * Math.PI * 0.5) * (1 / (1 + Math.abs(t) * 0.15));
        break;
      }
      case "limit":
      default: {
        const ceiling = 0.95;
        y = (ceiling * x) / Math.cbrt(1 + Math.abs(x) * Math.abs(x) * Math.abs(x));
        break;
      }
    }
    curve[i] = clamp(y, -1, 1);
  }
  cache.set(key, curve);
  return curve;
}

export function waveshaper(
  ctx: BaseAudioContext,
  kind: ShaperKind,
  amount = 1,
  oversample: OverSampleType = "2x",
): WaveShaperNode {
  const node = ctx.createWaveShaper();
  const curve = shaperCurve(ctx, kind, amount);
  // Copy so the cached table is never handed to (and retained by) a node.
  const owned = new Float32Array(curve.length);
  owned.set(curve);
  node.curve = owned;
  node.oversample = oversample;
  return node;
}

/* ------------------------------------------------------------------ */
/* Resonant body                                                       */
/* ------------------------------------------------------------------ */

export interface Mode {
  hz: number;
  q: number;
  gain: number;
}

export interface ResonatorBank {
  input: GainNode;
  output: GainNode;
  nodes: AudioNode[];
}

/**
 * A parallel bandpass bank. Feed it noise and it becomes the receiver of a
 * rifle, the skin of an oil drum or a shell casing, depending on the modes.
 */
export function resonatorBank(
  ctx: BaseAudioContext,
  modes: readonly Mode[],
  outputGain = 1,
): ResonatorBank {
  const input = gainNode(ctx, 1);
  const output = gainNode(ctx, outputGain);
  const nodes: AudioNode[] = [input, output];
  for (const mode of modes) {
    const bp = biquad(ctx, "bandpass", mode.hz, mode.q);
    const g = gainNode(ctx, mode.gain);
    input.connect(bp);
    bp.connect(g);
    g.connect(output);
    nodes.push(bp, g);
  }
  return { input, output, nodes };
}

/**
 * Struck metal: a sum of exponentially decaying sinusoids. Cheaper and far
 * more controllable than filtering noise when you want a *pitch* — casings,
 * ricochet whines, hangar wall ring.
 */
export function modeRing(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  modes: readonly Mode[],
  options: { decay: number; attack?: number; detune?: number; rand?: Rand } = { decay: 0.3 },
): number {
  let end = when;
  const attack = options.attack ?? 0.0015;
  for (const mode of modes) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const detune = options.detune ?? 0;
    const r = options.rand ? options.rand() * 2 - 1 : 0;
    osc.frequency.value = clamp(mode.hz * (1 + r * detune), 20, ctx.sampleRate * 0.45);
    const g = gainNode(ctx, 0);
    // High modes die first, exactly like a real struck body.
    const decay = options.decay * Math.pow(600 / Math.max(120, mode.hz), 0.35) * (0.7 + mode.q / 30);
    const stop = scheduleEnv(g.gain, when, { peak: mode.gain, attack, decay });
    osc.connect(g);
    g.connect(dest);
    osc.start(when);
    osc.stop(stop + 0.01);
    if (stop > end) end = stop;
  }
  return end;
}

/* ------------------------------------------------------------------ */
/* Grains: the two primitives every foley layer is made of             */
/* ------------------------------------------------------------------ */

export interface BurstOptions {
  kind?: NoiseKind;
  /** Filter shaping the burst. `none` leaves the noise raw. */
  filter?: BiquadFilterType | "none";
  freq: number;
  /** Sweep the filter to here across the burst — scrapes, whooshes, tails. */
  freqEnd?: number;
  q?: number;
  filterGainDb?: number;
  gain: number;
  attack?: number;
  hold?: number;
  decay?: number;
  shape?: "exp" | "lin";
  /** Playback-rate sweep on the noise itself: doppler without a panner. */
  rate?: number;
  rateEnd?: number;
  /** Optional waveshaper drive stage. */
  drive?: number;
  driveKind?: ShaperKind;
  /** Extra highpass, useful to keep a bright layer out of the sub. */
  highpass?: number;
  rand?: Rand;
}

/**
 * Filtered noise burst — the crack of a rifle, gravel patter, cloth, wind
 * gusts, debris. Returns the time the burst has fully decayed.
 */
export function noiseBurst(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  options: BurstOptions,
): number {
  const src = noiseSource(ctx, { kind: options.kind ?? "white", rand: options.rand });
  const buffer = src.buffer!;
  const attack = options.attack ?? 0.002;
  const decay = options.decay ?? 0.06;
  const g = gainNode(ctx, 0);
  const nodes: AudioNode[] = [src];

  if (options.rate !== undefined || options.rateEnd !== undefined) {
    const from = options.rate ?? 1;
    const to = options.rateEnd ?? from;
    if (to !== from) glide(src.playbackRate, when, from, to, attack + (options.hold ?? 0) + decay);
    else src.playbackRate.value = from;
  }

  let tail: AudioNode = src;
  if (options.highpass !== undefined) {
    const hp = biquad(ctx, "highpass", options.highpass, 0.7);
    tail.connect(hp);
    tail = hp;
    nodes.push(hp);
  }
  if ((options.filter ?? "bandpass") !== "none") {
    const filter = biquad(
      ctx,
      (options.filter ?? "bandpass") as BiquadFilterType,
      options.freq,
      options.q ?? 1.2,
      options.filterGainDb ?? 0,
    );
    if (options.freqEnd !== undefined && options.freqEnd !== options.freq) {
      glide(filter.frequency, when, options.freq, options.freqEnd, attack + (options.hold ?? 0) + decay);
    }
    tail.connect(filter);
    tail = filter;
    nodes.push(filter);
  }
  if (options.drive !== undefined && options.drive > 0) {
    const ws = waveshaper(ctx, options.driveKind ?? "tanh", options.drive, "2x");
    tail.connect(ws);
    tail = ws;
    nodes.push(ws);
  }
  tail.connect(g);
  g.connect(dest);
  nodes.push(g);

  const end = scheduleEnv(g.gain, when, {
    peak: options.gain,
    attack,
    hold: options.hold,
    decay,
    shape: options.shape,
  });
  src.start(when, noiseOffset(options.rand, buffer));
  src.stop(end + 0.02);
  return end;
}

export interface ClickOptions {
  freq?: number;
  q?: number;
  gain: number;
  decay?: number;
  drive?: number;
  rand?: Rand;
}

/**
 * A transient: 0.4 ms of attack and a handful of milliseconds of decay. This
 * is what makes a mechanism read as *metal* rather than as a thud.
 */
export function transientClick(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  options: ClickOptions,
): number {
  return noiseBurst(ctx, dest, when, {
    kind: "white",
    filter: "bandpass",
    freq: options.freq ?? 2800,
    q: options.q ?? 3.2,
    gain: options.gain,
    attack: 0.0004,
    decay: options.decay ?? 0.008,
    drive: options.drive,
    rand: options.rand,
  });
}

export interface SweepOptions {
  from: number;
  to: number;
  seconds: number;
  gain: number;
  type?: OscillatorType;
  attack?: number;
  decay?: number;
  /** Slight detuned partner an octave up, for weight without mud. */
  harmonic?: number;
  rand?: Rand;
}

/** Sine (or saw/triangle) pitch sweep — gunshot body, explosions, kicks. */
export function sineSweep(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  options: SweepOptions,
): number {
  const osc = ctx.createOscillator();
  osc.type = options.type ?? "sine";
  glide(osc.frequency, when, options.from, options.to, options.seconds);
  const g = gainNode(ctx, 0);
  const end = scheduleEnv(g.gain, when, {
    peak: options.gain,
    attack: options.attack ?? 0.004,
    decay: options.decay ?? options.seconds,
  });
  osc.connect(g);
  g.connect(dest);
  osc.start(when);
  osc.stop(end + 0.01);

  if (options.harmonic !== undefined && options.harmonic > 0) {
    const h = ctx.createOscillator();
    h.type = "triangle";
    glide(h.frequency, when, options.from * 2.01, options.to * 1.98, options.seconds * 0.8);
    const hg = gainNode(ctx, 0);
    scheduleEnv(hg.gain, when, {
      peak: options.gain * options.harmonic,
      attack: (options.attack ?? 0.004) * 0.6,
      decay: (options.decay ?? options.seconds) * 0.55,
    });
    h.connect(hg);
    hg.connect(dest);
    h.start(when);
    h.stop(end + 0.01);
  }
  return end;
}

/**
 * Scatter `count` micro-bursts across `seconds` with a decaying envelope —
 * gravel underfoot, glass tinkles, explosion debris, belt links.
 */
export function patter(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  options: {
    count: number;
    seconds: number;
    freq: number;
    freqSpread?: number;
    q?: number;
    gain: number;
    decay?: number;
    /** 0 = evenly spaced, 1 = fully random. */
    scatter?: number;
    /** Exponent on the per-grain gain falloff over time. */
    falloff?: number;
    kind?: NoiseKind;
    rand: Rand;
  },
): number {
  const scatter = options.scatter ?? 0.8;
  const falloff = options.falloff ?? 2.2;
  let end = when;
  for (let i = 0; i < options.count; i += 1) {
    const t = (i + (options.rand() - 0.5) * 2 * scatter) / Math.max(1, options.count);
    const at = when + clamp(t, 0, 1.15) * options.seconds;
    const decayScale = Math.pow(1 - clamp(t, 0, 0.98), falloff);
    const stop = noiseBurst(ctx, dest, at, {
      kind: options.kind ?? "white",
      filter: "bandpass",
      freq: jitter(options.rand, options.freq, options.freqSpread ?? 0.55),
      q: options.q ?? 4,
      gain: options.gain * (0.35 + 0.65 * decayScale) * range(options.rand, 0.5, 1),
      attack: 0.0005,
      decay: (options.decay ?? 0.02) * range(options.rand, 0.6, 1.4),
      rand: options.rand,
    });
    if (stop > end) end = stop;
  }
  return end;
}

/* ------------------------------------------------------------------ */
/* Impulse responses                                                   */
/* ------------------------------------------------------------------ */

export interface IrSpec {
  key: string;
  seconds: number;
  /** Time for the tail to fall 60 dB. */
  rt60: number;
  predelayMs: number;
  /** 0 = pillow, 1 = tiled bathroom. Controls the tail's HF damping. */
  brightness: number;
  /** Early reflections as `[milliseconds, gain]`. */
  early: readonly (readonly [number, number])[];
  /** Inharmonic ringing partials as `[hz, gain, decaySeconds]` — hangar steel. */
  modes?: readonly (readonly [number, number, number])[];
  /** 0 = sparse slap, 1 = dense diffuse field. */
  diffusion: number;
  /** Channel decorrelation, 0..1. */
  stereo: number;
  /** Peak the IR is normalised to; the tail's absolute loudness. */
  level: number;
  seed: number;
}

export type EnvironmentId = "open-desert" | "hangar" | "between-buildings" | "small-room";

/**
 * The four spaces the map actually contains. "Open desert" is the interesting
 * one: almost no diffuse field at all, but very long, very late slap-back off
 * the hangars, which is exactly why a rifle sounds enormous out on the apron.
 */
export const IR_PRESETS: Readonly<Record<EnvironmentId, IrSpec>> = {
  "open-desert": {
    key: "open-desert",
    seconds: 2.2,
    rt60: 0.5,
    predelayMs: 26,
    brightness: 0.34,
    early: [
      [78, 0.34],
      [143, 0.24],
      [212, 0.19],
      [340, 0.13],
      [520, 0.08],
      [790, 0.05],
    ],
    diffusion: 0.22,
    stereo: 0.85,
    level: 0.34,
    seed: 0xdeed,
  },
  hangar: {
    key: "hangar",
    seconds: 2.9,
    rt60: 1.8,
    predelayMs: 17,
    brightness: 0.72,
    early: [
      [11, 0.55],
      [23, 0.44],
      [38, 0.4],
      [61, 0.33],
      [97, 0.27],
      [148, 0.2],
    ],
    modes: [
      [92, 0.16, 1.5],
      [147, 0.12, 1.2],
      [221, 0.1, 1.05],
      [1870, 0.055, 0.75],
      [2960, 0.04, 0.6],
      [4410, 0.03, 0.45],
    ],
    diffusion: 0.94,
    stereo: 0.7,
    level: 0.62,
    seed: 0x4a15,
  },
  "between-buildings": {
    key: "between-buildings",
    seconds: 1.1,
    rt60: 0.4,
    predelayMs: 6,
    brightness: 0.55,
    early: [
      [8, 0.5],
      [15, 0.42],
      [27, 0.36],
      [44, 0.29],
      [69, 0.22],
      [104, 0.16],
      [161, 0.1],
    ],
    diffusion: 0.7,
    stereo: 0.6,
    level: 0.46,
    seed: 0x2b17,
  },
  "small-room": {
    key: "small-room",
    seconds: 0.7,
    rt60: 0.28,
    predelayMs: 3,
    brightness: 0.4,
    early: [
      [4, 0.52],
      [9, 0.44],
      [15, 0.38],
      [24, 0.3],
      [37, 0.2],
    ],
    diffusion: 0.82,
    stereo: 0.4,
    level: 0.4,
    seed: 0x71c3,
  },
};

/**
 * Generate an impulse response: exponentially decaying, progressively damped
 * noise, plus discrete early reflections and optional metallic modes.
 * Normalised so switching spaces does not change the mix level.
 */
export function impulseResponse(ctx: BaseAudioContext, spec: IrSpec): AudioBuffer {
  const cache = cacheFor(ctx).irs;
  const hit = cache.get(spec.key);
  if (hit) return hit;

  const sr = ctx.sampleRate;
  const frames = Math.max(64, Math.round(sr * spec.seconds));
  const buffer = ctx.createBuffer(2, frames, sr);
  const predelay = Math.round((spec.predelayMs / 1000) * sr);
  const decayK = 6.9078 / Math.max(0.02, spec.rt60);

  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    const rand = mulberry32(mixSeeds(spec.seed, ch * 104729 + 17));
    // Decorrelate the right channel by nudging its predelay and damping.
    const chDelay = predelay + Math.round(ch * spec.stereo * 0.004 * sr);
    const damp = 1 - ch * spec.stereo * 0.06;

    // Diffuse tail: velvet-ish early, dense late, one-pole damped.
    let lp = 0;
    let hp = 0;
    for (let i = 0; i < frames; i += 1) {
      const n = i - chDelay;
      if (n < 0) continue;
      const t = n / sr;
      const envelope = Math.exp(-decayK * t);
      // Density ramps in: sparse reflections first, then a proper tail.
      const density = clamp(spec.diffusion * (0.18 + t * 9), 0.02, 1);
      const spark = rand() < density ? rand() * 2 - 1 : 0;
      let x = spark * envelope;
      // Time-varying damping: the air and the walls eat the top end first.
      const fc = (900 + 11000 * spec.brightness * Math.exp(-t * 1.9)) * damp;
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += a * (x - lp);
      x = lp;
      // Remove the DC/rumble the integrator introduces.
      const ah = 1 - Math.exp((-2 * Math.PI * 70) / sr);
      hp += ah * (x - hp);
      data[i] = x - hp;
    }

    // Discrete early reflections: the geometry you actually localise.
    for (const [ms, gain] of spec.early) {
      const base = chDelay + Math.round((ms / 1000) * sr * (1 + (ch === 1 ? spec.stereo * 0.05 : 0)));
      const sign = rand() < 0.5 ? -1 : 1;
      for (let k = 0; k < 5; k += 1) {
        const idx = base + k;
        if (idx >= frames) break;
        const smear = (1 - k / 5) * (rand() * 0.6 + 0.7);
        data[idx] = data[idx]! + sign * gain * smear * Math.exp(-decayK * (ms / 1000));
      }
    }

    // Structural ring: corrugated steel and roof trusses.
    if (spec.modes) {
      for (const [hz, gain, modeDecay] of spec.modes) {
        const phase = rand() * Math.PI * 2;
        const detune = 1 + (rand() - 0.5) * 0.01 * spec.stereo;
        for (let i = chDelay; i < frames; i += 1) {
          const t = (i - chDelay) / sr;
          data[i] =
            data[i]! + gain * Math.sin(2 * Math.PI * hz * detune * t + phase) * Math.exp(-t / modeDecay);
        }
      }
    }

    normalise(data, spec.level);
  }
  cache.set(spec.key, buffer);
  return buffer;
}

/* ------------------------------------------------------------------ */
/* Convolver pool                                                      */
/* ------------------------------------------------------------------ */

/**
 * One convolver per space, shared by every voice.
 *
 * Convolvers are expensive to build (Chrome partitions the IR into FFT blocks
 * on assignment), so a fresh one per gunshot would stall the audio thread at
 * 700 rpm. Voices instead own a cheap send gain with their own envelope and
 * feed the shared tail — which is also more correct: two shots in the same
 * room share one reverberant field.
 */
export class ConvolverPool {
  private readonly slots = new Map<string, { input: GainNode; conv: ConvolverNode }>();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly dest: AudioNode,
    private readonly returnGain = 1,
  ) {}

  /** Shared input for a space. Connect a per-voice gain to it. */
  bus(env: EnvironmentId): AudioNode {
    const existing = this.slots.get(env);
    if (existing) return existing.input;
    const spec = IR_PRESETS[env];
    const conv = this.ctx.createConvolver();
    // Normalised. An impulse response built from decaying noise has no
    // particular level, and with normalisation off a long tail multiplies its
    // input by a factor in the hundreds — which is how a send of 0.7 turned an
    // explosion into a peak of 2762 rather than of 1. Normalising makes a send
    // amount mean the same thing in every space.
    conv.normalize = true;
    conv.buffer = impulseResponse(this.ctx, spec);
    const input = gainNode(this.ctx, 1);
    const ret = gainNode(this.ctx, this.returnGain);
    input.connect(conv);
    conv.connect(ret);
    ret.connect(this.dest);
    this.slots.set(env, { input, conv });
    return input;
  }

  /** Pre-build every space so the first shot never pays the FFT setup cost. */
  warm(): void {
    for (const env of Object.keys(IR_PRESETS) as EnvironmentId[]) this.bus(env);
  }

  dispose(): void {
    for (const slot of this.slots.values()) {
      slot.input.disconnect();
      slot.conv.disconnect();
    }
    this.slots.clear();
  }
}

/**
 * A per-voice reverb send with its own envelope. `amount` is the wet level and
 * `spread` how long the excitation feeding the tail lasts.
 */
export function reverbSend(
  ctx: BaseAudioContext,
  pool: ConvolverPool | null,
  env: EnvironmentId,
  when: number,
  amount: number,
  spread = 0.05,
): GainNode | null {
  if (!pool || amount <= 0.0005) return null;
  const send = gainNode(ctx, 0);
  send.connect(pool.bus(env));
  send.gain.setValueAtTime(0, when);
  send.gain.linearRampToValueAtTime(amount, when + 0.004);
  send.gain.setTargetAtTime(0, when + 0.004, Math.max(0.01, spread));
  send.gain.setValueAtTime(0, when + 0.004 + spread * 6);
  return send;
}

/* ------------------------------------------------------------------ */
/* Slap-back                                                           */
/* ------------------------------------------------------------------ */

/**
 * Discrete outdoor echoes off nearby structures. Feed it the summed shot and
 * it returns delayed, filtered, progressively duller copies — the reason a
 * rifle fired between two hangars sounds nothing like one fired on the apron.
 */
export function slapBack(
  ctx: BaseAudioContext,
  source: AudioNode,
  dest: AudioNode,
  taps: readonly (readonly [number, number])[],
  options: { cutoff?: number; cutoffFalloff?: number; rand?: Rand } = {},
): AudioNode[] {
  const nodes: AudioNode[] = [];
  const cutoff = options.cutoff ?? 4200;
  const falloff = options.cutoffFalloff ?? 0.62;
  let i = 0;
  for (const [seconds, gain] of taps) {
    if (seconds <= 0 || gain <= 0.0005) continue;
    const delay = ctx.createDelay(Math.max(0.05, seconds + 0.05));
    delay.delayTime.value = seconds;
    const lp = biquad(ctx, "lowpass", Math.max(280, cutoff * Math.pow(falloff, i)), 0.6);
    const hp = biquad(ctx, "highpass", 110 + i * 40, 0.7);
    const g = gainNode(ctx, gain * (options.rand ? range(options.rand, 0.82, 1.18) : 1));
    source.connect(delay);
    connectChain([delay, lp, hp, g]);
    g.connect(dest);
    nodes.push(delay, lp, hp, g);
    i += 1;
  }
  return nodes;
}

/* ------------------------------------------------------------------ */
/* Modulation                                                          */
/* ------------------------------------------------------------------ */

/**
 * A free-running LFO on an AudioParam. Used for wind, the base hum, tinnitus
 * wobble and the music bed — the things that are always on.
 */
export function lfo(
  ctx: BaseAudioContext,
  target: AudioParam,
  options: { hz: number; depth: number; type?: OscillatorType; when: number; phase?: number },
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = options.type ?? "sine";
  osc.frequency.value = options.hz;
  const depth = gainNode(ctx, options.depth);
  osc.connect(depth);
  depth.connect(target);
  osc.start(options.when + (options.phase ?? 0));
  return osc;
}
