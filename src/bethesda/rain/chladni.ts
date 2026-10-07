/**
 * The square Chladni plate, as numbers. Pure: no renderer, no DOM, no clock.
 *
 * Ported from Vers3Dynamics Cymatics (`physics.js`, the resonance model), by
 * ciaochris on Hugging Face: https://huggingface.co/spaces/ciaochris/vers3dynamics-cymatics
 * at revision 9a9c46fb0ff0ae8c51367e8ae5c1ba39892ed112 (physics.js sha256
 * e6857f6283f875f83b85af096aec33fece98d41bfd75185e2d0a8416bbbea3cc), published
 * under the MIT License, reproduced in NOTICE. Only the plate is ported — its
 * modes and their paired sum and difference figures, the Lorentzian response,
 * the energy normalisation, the exciter's seat, the stroboscope and the word
 * signature — with the same constants, so a figure here is the figure the
 * studio draws for the same drive.
 *
 * As the studio says of itself, this is a qualitative model, not a calibrated
 * solver: the tuning is chosen for the eye, and no frequency here is a
 * property of any real plate. In the lab it draws R.A.I.N.'s state and
 * nothing else; see `resonance.ts`.
 *
 * Coordinates are the plate's own: x and y in [-1, 1], free edges all round.
 */

/** Where the plate model comes from, as the Systems Room states it. */
export const CYMATICS_SOURCE = {
  space: "ciaochris/vers3dynamics-cymatics",
  revision: "9a9c46fb0ff0ae8c51367e8ae5c1ba39892ed112",
  license: "MIT",
} as const;

const PI = Math.PI;
const TAU = PI * 2;

/** The audible window the studio works in. */
export const F_MIN = 60;
export const F_MAX = 1600;
/** Hz per unit of m² + n²: chosen for the screen, not for a metal. */
const TUNING = 10;
/** The most modes one partial is answered with, and the cut-off below the strongest. */
export const MAX_TERMS = 16;
const TERM_FLOOR = 0.04;
/** Normalised energy is capped here, as the studio caps it. */
export const ENERGY_CAP = 2.2;
/** The studio's default resonance width, in Hz. */
export const DEFAULT_WIDTH = 2.5;
/** The lead partial swings this often once slowed, as a stroboscope would slow it. */
export const STROBE_HZ = 0.55;
/** Other partials keep their ratio to the lead up to this factor either way. */
export const STROBE_RATIO = 4;
/** The most partials one figure carries, as in the studio. */
export const MAX_PARTIALS = 4;

export interface Point {
  x: number;
  y: number;
}

export interface PlateMode {
  m: number;
  n: number;
  /** +1 the sum figure (m > n), -1 the difference figure (m < n), 0 when m = n. */
  sign: -1 | 0 | 1;
  /** Resonance in the studio's tuning, Hz. */
  f: number;
  /** As the studio names it: `(lo,hi)+`, `(lo,hi)−` or `(m,n)`. */
  label: string;
}

let table: readonly PlateMode[] | null = null;

/** Every plate resonance in the window, lowest first. */
export function plateModes(): readonly PlateMode[] {
  if (table) return table;
  const top = Math.ceil(Math.sqrt((F_MAX * 1.12) / TUNING));
  const list: PlateMode[] = [];
  for (let m = 0; m <= top; m++)
    for (let n = 0; n <= top; n++) {
      if (m + n === 0) continue;
      // Each (m,n) pair splits into a difference and a sum figure, as on a
      // real free plate. The ordered pair names them: m<n is "−", m>n is "+".
      const sign = m > n ? 1 : m < n ? -1 : 0;
      const split = (sign * 0.09) / (1 + 0.35 * (m + n));
      const f = TUNING * (m * m + n * n) * (1 + split);
      if (f < F_MIN * 0.6 || f > F_MAX * 1.1) continue;
      const lo = Math.min(m, n),
        hi = Math.max(m, n);
      list.push({
        m,
        n,
        sign,
        f,
        label: `(${lo},${hi})${sign > 0 ? "+" : sign < 0 ? "−" : ""}`,
      });
    }
  table = Object.freeze(list.sort((p, q) => p.f - q.f));
  return table;
}

/** The mode with these numbers, in this order (so the sign is the order's). */
export function modeOf(m: number, n: number): PlateMode {
  const found = plateModes().find((p) => p.m === m && p.n === n);
  if (!found) throw new Error(`No plate mode (${m},${n}) in the window`);
  return found;
}

/** The other figure of a split pair: (m,n)+ for (m,n)−, and back. Null when m = n. */
export function partnerOf(mode: PlateMode): PlateMode | null {
  return mode.sign === 0 ? null : modeOf(mode.n, mode.m);
}

/** One mode's displacement at a point, peak-normalised to ±1. */
export function shapeAt(mode: PlateMode, x: number, y: number): number {
  const u = PI * 0.5 * (x + 1),
    v = PI * 0.5 * (y + 1);
  const direct = Math.cos(mode.m * u) * Math.cos(mode.n * v);
  if (mode.sign === 0) return direct;
  return 0.5 * (direct + mode.sign * Math.cos(mode.n * u) * Math.cos(mode.m * v));
}

export interface Term {
  mode: PlateMode;
  re: number;
  im: number;
  mag: number;
}

/**
 * How the plate answers a drive at `f` from an exciter at a point. Each mode
 * answers with w · fΓ / (f_k² − f² + i·fΓ): unit size on resonance, in phase
 * below it, opposed above it; `width` is the full width in Hz.
 */
export function respond(
  f: number,
  exciter: Point,
  width = DEFAULT_WIDTH,
): { terms: Term[]; strength: number } {
  const damping = Math.max(0.2, width) * f;
  const found: Term[] = [];
  let peak = 0;
  for (const mode of plateModes()) {
    const w = shapeAt(mode, exciter.x, exciter.y);
    const detune = mode.f * mode.f - f * f;
    const denom = detune * detune + damping * damping;
    const re = (w * damping * detune) / denom;
    const im = (-w * damping * damping) / denom;
    const mag = Math.hypot(re, im);
    if (mag > peak) peak = mag;
    if (mag > 1e-4) found.push({ mode, re, im, mag });
  }
  found.sort((p, q) => q.mag - p.mag);
  const terms: Term[] = [];
  let power = 0;
  for (const term of found) {
    if (terms.length >= MAX_TERMS || term.mag < peak * TERM_FLOOR) break;
    terms.push(term);
    power += term.mag * term.mag;
  }
  return { terms, strength: Math.min(1, Math.sqrt(power)) };
}

/**
 * A good place to drive a mode: near a preferred point, on one of its
 * antinodes, and where neighbouring resonances are hard to reach — what an
 * experimenter does by hand to coax out a clean figure.
 */
export function seat(mode: PlateMode, prefer: Point = { x: 0.45, y: -0.3 }): Point {
  const damping = 2.5 * mode.f;
  const rivals: { mode: PlateMode; leak: number }[] = [];
  for (const other of plateModes()) {
    if (other === mode || Math.abs(other.f - mode.f) > 60) continue;
    rivals.push({
      mode: other,
      leak: damping / Math.hypot(other.f * other.f - mode.f * mode.f, damping),
    });
  }
  let best = { x: prefer.x, y: prefer.y },
    score = -Infinity;
  for (let iy = 0; iy <= 44; iy++)
    for (let ix = 0; ix <= 44; ix++) {
      const x = -0.88 + (1.76 * ix) / 44,
        y = -0.88 + (1.76 * iy) / 44;
      let leaked = 0;
      for (const rival of rivals) leaked += (shapeAt(rival.mode, x, y) * rival.leak) ** 2;
      const value =
        Math.abs(shapeAt(mode, x, y)) -
        1.2 * Math.sqrt(leaked) -
        0.35 * Math.hypot(x - prefer.x, y - prefer.y);
      if (value > score) {
        score = value;
        best = { x, y };
      }
    }
  return best;
}

/** FNV-1a over the text's UTF-16 code units, as the studio hashes a word. */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Signature {
  mode: PlateMode;
  exciter: Point;
}

/**
 * A text deterministically chooses one resonance and a place to drive it, as
 * the studio's Word tab does. This is a hash, not a property of the text: the
 * same text always returns the same figure and nothing about its meaning does.
 * `split` limits the choice to modes that have a partner figure.
 */
export function signature(text: string, split = false): Signature | null {
  const clean = text.trim().replace(/\s+/g, " ").toUpperCase();
  if (!clean) return null;
  const hash = hashText(clean);
  const second = hashText(clean + "·");
  const pool = plateModes().filter(
    (mode) => mode.f >= 150 && mode.f <= 1400 && (!split || mode.sign !== 0),
  );
  const mode = pool[hash % pool.length]!;
  const radius = 0.25 + 0.5 * ((second & 0xff) / 255);
  const angle = TAU * (((second >>> 8) & 0xfff) / 4096);
  return {
    mode,
    exciter: seat(mode, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }),
  };
}

/** A partial of the drive: a frequency, its relative amplitude and, if its own, where it drives. */
export interface Partial {
  f: number;
  a: number;
  at?: Point;
}

/** One mode's share of one partial, scaled so the figure's energy is normalised. */
export interface FigureTerm {
  m: number;
  n: number;
  sign: -1 | 0 | 1;
  re: number;
  im: number;
  /** Which partial it answers; terms are grouped by partial, in order. */
  partial: number;
}

export interface Figure {
  terms: FigureTerm[];
  /** The partials' frequencies, for the stroboscope; one entry per partial. */
  frequencies: number[];
  /** Each partial's amplitude relative to the loudest, 0–1; one entry per partial. */
  weights: number[];
  /** Index of the partial that leads the stroboscope (the strongest answer). */
  lead: number;
  /** How strongly the plate answers the drive, 0–1, as the studio reports it. */
  strength: number;
}

/** A plate nobody drives: no figure, and the sand lies where it was strewn. */
export const STILL: Figure = Object.freeze({
  terms: [],
  frequencies: [],
  weights: [],
  lead: 0,
  strength: 0,
});

const NORM_GRID = 64;

/** Time-averaged squared displacement of one partial's terms at a point, unscaled. */
function rawEnergy(terms: readonly FigureTerm[], partial: number, x: number, y: number) {
  let re = 0,
    im = 0;
  for (const t of terms) {
    if (t.partial !== partial) continue;
    const s = shapeAt({ m: t.m, n: t.n, sign: t.sign, f: 0, label: "" }, x, y);
    re += t.re * s;
    im += t.im * s;
  }
  return re * re + im * im;
}

/**
 * The figure a drive makes. Every partial is answered by the plate on its own,
 * from its own exciter or the figure's; at most `budget` terms are kept across
 * them, which is what a renderer can afford to evaluate per pixel. Each
 * partial is scaled as the studio scales a figure, so four times its mean
 * energy over the plate is the peak of a pure mode and every figure has the
 * same contrast; its loudness relative to the others is kept apart, in
 * `weights`.
 *
 * Where the studio sums a chord's energies into one field, the lab keeps each
 * partial's figure as a layer of its own: with four perspectives sounding,
 * summed energy leaves the sand almost nowhere, and each perspective's figure
 * should stay legible in the composite. A single partial is drawn exactly as
 * the studio draws it.
 */
export function buildFigure(
  partials: readonly Partial[],
  exciter: Point,
  budget = 16,
  width = DEFAULT_WIDTH,
): Figure {
  const used = partials.slice(0, MAX_PARTIALS).filter((p) => p.a > 0 && p.f > 0);
  if (!used.length) return STILL;
  const each = Math.max(1, Math.floor(budget / used.length));
  const loudest = Math.max(...used.map((p) => p.a));
  const terms: FigureTerm[] = [];
  const cells = (NORM_GRID + 1) * (NORM_GRID + 1);
  let totalGain = 0,
    answered = 0,
    lead = 0,
    leadScore = -1;
  used.forEach((p, i) => {
    const response = respond(p.f, p.at ?? exciter, width);
    const own: FigureTerm[] = response.terms.slice(0, each).map((t) => ({
      m: t.mode.m,
      n: t.mode.n,
      sign: t.mode.sign,
      re: t.re,
      im: t.im,
      partial: i,
    }));
    let sum = 0;
    for (let gy = 0; gy <= NORM_GRID; gy++)
      for (let gx = 0; gx <= NORM_GRID; gx++)
        sum += rawEnergy(own, i, -1 + (2 * gx) / NORM_GRID, -1 + (2 * gy) / NORM_GRID);
    const root = sum > 1e-12 ? Math.sqrt(cells / (4 * sum)) : 0;
    for (const t of own) {
      t.re *= root;
      t.im *= root;
      terms.push(t);
    }
    const gain = p.a * p.a;
    totalGain += gain;
    answered += gain * response.strength * response.strength;
    if (p.a * response.strength > leadScore) {
      leadScore = p.a * response.strength;
      lead = i;
    }
  });
  return {
    terms,
    frequencies: used.map((p) => p.f),
    weights: used.map((p) => p.a / loudest),
    lead,
    strength: totalGain > 0 ? Math.sqrt(answered / totalGain) : 0,
  };
}

/** One partial's normalised time-averaged energy at a point, capped as the studio caps it. */
export function energyAt(figure: Figure, x: number, y: number, partial = 0): number {
  return Math.min(rawEnergy(figure.terms, partial, x, y), ENERGY_CAP);
}

/** How fast a partial swings once slowed: the lead at STROBE_HZ, the rest in ratio. */
export function strobeRate(f: number, lead: number): number {
  return STROBE_HZ * Math.min(STROBE_RATIO, Math.max(1 / STROBE_RATIO, f / lead));
}
