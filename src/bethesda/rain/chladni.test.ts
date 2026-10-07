import { describe, expect, it } from "vitest";
import {
  F_MAX,
  F_MIN,
  STILL,
  buildFigure,
  energyAt,
  hashText,
  modeOf,
  partnerOf,
  plateModes,
  respond,
  seat,
  shapeAt,
  signature,
  strobeRate,
  STROBE_HZ,
} from "./chladni";

const grid = (n: number, f: (x: number, y: number) => number) => {
  const out: number[] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) out.push(f(-1 + (2 * i) / n, -1 + (2 * j) / n));
  return out;
};

describe("the plate's modes, as the Vers3Dynamics studio defines them", () => {
  it("are sorted by frequency, inside the window, and split into sum and difference figures", () => {
    const modes = plateModes();
    expect(modes.length).toBeGreaterThan(100);
    for (let i = 1; i < modes.length; i++)
      expect(modes[i]!.f).toBeGreaterThanOrEqual(modes[i - 1]!.f);
    for (const m of modes) {
      expect(m.f).toBeGreaterThanOrEqual(F_MIN * 0.6);
      expect(m.f).toBeLessThanOrEqual(F_MAX * 1.1);
      expect(m.sign).toBe(m.m > m.n ? 1 : m.m < m.n ? -1 : 0);
    }
    // The pair splits: the difference figure rings below the sum figure.
    expect(modeOf(1, 4).f).toBeLessThan(modeOf(4, 1).f);
    expect(modeOf(1, 4).label).toBe("(1,4)−");
    expect(modeOf(4, 1).label).toBe("(1,4)+");
    expect(modeOf(2, 2).f).toBe(80);
  });
  it("draw the sum figure symmetric across the diagonal and the difference figure silent on it", () => {
    const sum = modeOf(3, 1),
      diff = modeOf(1, 3);
    for (const [x, y] of [
      [0.3, -0.7],
      [-0.55, 0.2],
      [0.9, 0.1],
    ] as const) {
      expect(shapeAt(sum, x, y)).toBeCloseTo(shapeAt(sum, y, x), 12);
      expect(shapeAt(diff, x, y)).toBeCloseTo(-shapeAt(diff, y, x), 12);
      expect(shapeAt(diff, x, x)).toBeCloseTo(0, 12);
    }
    expect(partnerOf(sum)).toBe(diff);
    expect(partnerOf(modeOf(2, 2))).toBeNull();
  });
  it("count Chladni's nodal lines: (m,n) with m = n has m lines each way", () => {
    // Along an edge, cos(2u) for (2,2) changes sign twice.
    const mode = modeOf(2, 2);
    let crossings = 0,
      last = shapeAt(mode, -1, -0.999);
    for (let i = 1; i <= 400; i++) {
      const v = shapeAt(mode, -1 + (2 * i) / 400, -0.999);
      if (Math.sign(v) !== Math.sign(last)) crossings++;
      last = v;
    }
    expect(crossings).toBe(2);
  });
});

describe("the driven response", () => {
  it("answers a resonance with that mode, and barely answers between resonances", () => {
    const mode = modeOf(2, 3);
    const at = seat(mode);
    const on = respond(mode.f, at);
    expect(on.terms[0]!.mode).toBe(mode);
    expect(on.terms[0]!.mag).toBeGreaterThan(0.5);
    const between = respond((modeOf(3, 3).f + modeOf(2, 4).f) / 2, { x: 0.45, y: -0.3 });
    expect(between.strength).toBeLessThan(on.strength);
  });
  it("is silent for a mode driven on its own nodal line", () => {
    // A difference figure is still along the diagonal.
    const r = respond(modeOf(1, 3).f, { x: 0.3, y: 0.3 });
    expect(r.terms.find((t) => t.mode === modeOf(1, 3))).toBeUndefined();
  });
  it("normalises every partial so four times its mean energy is a pure mode's peak, and keeps its loudness apart", () => {
    const fig = buildFigure(
      [
        { f: modeOf(4, 2).f, a: 1 },
        { f: modeOf(1, 3).f, a: 0.45 },
        { f: modeOf(2, 3).f, a: 0.45 },
      ],
      { x: 0.45, y: -0.3 },
    );
    expect(fig.weights).toEqual([1, 0.45, 0.45]);
    for (const p of [0, 1, 2]) {
      const e = grid(64, (x, y) => energyAt(fig, x, y, p));
      const mean = e.reduce((a, b) => a + b, 0) / e.length;
      expect(mean).toBeGreaterThan(0.22);
      expect(mean).toBeLessThan(0.26);
      expect(Math.max(...e)).toBeLessThanOrEqual(2.2);
    }
  });
  it("draws a single partial exactly as the studio's normalised figure", () => {
    const mode = modeOf(2, 2);
    const fig = buildFigure([{ f: mode.f, a: 0.3 }], seat(mode));
    // On resonance the mode dominates: energy follows its shape squared, with peak ≈ 1.
    expect(energyAt(fig, 0.5, 0.1)).toBeLessThan(0.02);
    expect(energyAt(fig, 0, 0)).toBeGreaterThan(0.8);
    expect(fig.weights).toEqual([1]);
  });
  it("keeps the term budget, grouped by partial", () => {
    const fig = buildFigure(
      [
        { f: modeOf(4, 2).f, a: 1 },
        { f: 187, a: 1 },
        { f: modeOf(2, 3).f, a: 1 },
      ],
      { x: 0.45, y: -0.3 },
      12,
    );
    expect(fig.terms.length).toBeLessThanOrEqual(12);
    const order = fig.terms.map((t) => t.partial);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(fig.frequencies).toHaveLength(3);
  });
  it("leaves an undriven plate still", () => {
    expect(buildFigure([], { x: 0, y: 0 })).toBe(STILL);
    expect(buildFigure([{ f: 100, a: 0 }], { x: 0, y: 0 })).toBe(STILL);
    expect(energyAt(STILL, 0.2, 0.4)).toBe(0);
  });
});

describe("the word signature and the stroboscope", () => {
  it("is a deterministic hash: the same text, in any case or spacing, gives the same figure", () => {
    expect(hashText("TIDE")).toBe(hashText("TIDE"));
    const a = signature("Does a Metro closure  disperse pedestrians?");
    const b = signature("does a metro closure disperse pedestrians?");
    expect(a).toEqual(b);
    expect(a!.mode.f).toBeGreaterThanOrEqual(150);
    expect(a!.mode.f).toBeLessThanOrEqual(1400);
    expect(signature("   ")).toBeNull();
    expect(signature("BX-0123456789ab", true)!.mode.sign).not.toBe(0);
  });
  it("slows the lead partial to the studio's rate and keeps the others in ratio", () => {
    expect(strobeRate(200, 200)).toBe(STROBE_HZ);
    expect(strobeRate(400, 200)).toBeCloseTo(2 * STROBE_HZ, 12);
    expect(strobeRate(10_000, 200)).toBeCloseTo(4 * STROBE_HZ, 12);
  });
});
