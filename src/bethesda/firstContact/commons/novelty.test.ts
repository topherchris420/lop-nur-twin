import { describe, expect, it } from "vitest";
import type { SurfaceChemistry } from "../socialSensing";
import { NOVELTY_PARAMS, NoveltyCompartment, noveltyCalibration } from "./novelty";

const A: SurfaceChemistry = [0.8, 0.1, 0.1, 0.2];
const B: SurfaceChemistry = [0.1, 0.8, 0.2, 0.1];

describe("the α′3 novelty compartment against Hattori et al. 2017", () => {
  // Seeds 1-3 chose `depressionPerS`; 4-8 were first run in this test.
  const series = new Map<number, ReturnType<typeof noveltyCalibration>>();
  const of = (seed: number) => {
    if (!series.has(seed)) series.set(seed, noveltyCalibration(seed, A, B));
    return series.get(seed)!;
  };

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`meets the paper's decline, specificity and recovery (seed ${seed})`, () => {
      const c = of(seed);
      const [first, , ...rest] = c.responses;
      // "a robust response to the first presentation of a novel odor"
      expect(first).toBeGreaterThan(0.99);
      // "MBON activity declines more than 80% within three to seven repetitions"
      expect(Math.min(...rest) / first!).toBeLessThan(0.2);
      // Specific: a different chemistry still evokes a near-novel response.
      expect(c.other).toBeGreaterThan(0.9);
      // "still observed after 20 min of recovery"
      expect(c.afterRecovery).toBeLessThan(0.85);
      // "returns to levels observed with a novel odor after 1 hr": within the
      // spread a never-met chemistry evokes after the same series.
      expect(c.afterHour).toBeGreaterThan(0.93);
    }, 20_000);
  }

  it("suppresses the second exposure by over 50% on average over individuals", () => {
    // "Over 50% suppression is apparent by the second exposure to odor": a
    // statement about the mean of the flies imaged. Asserted on the mean of
    // seeds 4-8. Individually, seed 4 does not meet it (second response
    // 0.634 on first run: receptor noise moved its active set); seeds 5-8
    // do. The mean (0.477 on first run) passes narrowly. Not retuned.
    const second = [4, 5, 6, 7, 8].map((s) => of(s).responses[1]!);
    expect(second.reduce((a, b) => a + b, 0) / second.length).toBeLessThan(0.5);
    expect(second.filter((v) => v < 0.5)).toHaveLength(4);
  }, 60_000);

  it("wires each individual differently, so similar chemistries generalize differently", () => {
    const near: SurfaceChemistry = [0.7, 0.15, 0.1, 0.25];
    const after = [11, 12, 13, 14].map((seed) => {
      const m = new NoveltyCompartment(seed);
      for (let k = 0; k < 200; k++) m.sense(A, k * 0.005, 0.005);
      return m.probe(near, 1);
    });
    expect(new Set(after.map((v) => v.toFixed(3))).size).toBeGreaterThan(1);
  });

  it("cannot tell two bodies with the same chemistry apart", () => {
    const m = new NoveltyCompartment(21);
    for (let k = 0; k < 200; k++) m.sense(A, k * 0.005, 0.005);
    // Whoever carries it, the same chemistry is the same to the compartment.
    const copy: SurfaceChemistry = [...A];
    expect(m.probe(copy, 1)).toBe(m.probe(A, 1));
    // One second of contact: familiar, while a different chemistry is not.
    expect(m.probe(copy, 1)).toBeLessThan(0.6);
    expect(m.probe(B, 1)).toBeGreaterThan(0.9);
  });

  it("holds nothing but synaptic weights, and a probe changes none of them", () => {
    const m = new NoveltyCompartment(31);
    for (let k = 0; k < 50; k++) m.sense(A, k * 0.005, 0.005);
    const before = JSON.stringify(m.snapshot());
    m.probe(B, 0.3);
    expect(JSON.stringify(m.snapshot())).toBe(before);
    expect(Object.keys(m.snapshot()).sort()).toEqual([
      "lastT",
      "noise",
      "plastic",
      "seed",
      "tastes",
      "version",
      "weights",
    ]);
  });

  it("restores to the same memory and the same future", () => {
    const m = new NoveltyCompartment(41);
    for (let k = 0; k < 120; k++) m.sense(k % 2 ? A : B, k * 0.005, 0.005);
    const r = NoveltyCompartment.restore(structuredClone(m.snapshot()));
    for (let k = 120; k < 300; k++) {
      const t = 100 + k * 0.005;
      expect(r.sense(A, t, 0.005)).toEqual(m.sense(A, t, 0.005));
    }
  });

  it("is lesioned cleanly: frozen synapses never change, a fly that cannot taste senses nothing", () => {
    const frozen = new NoveltyCompartment(51, { plastic: false });
    const rs = Array.from(
      { length: 400 },
      (_, k) => frozen.sense(A, k * 0.005, 0.005).novelty!,
    );
    expect(Math.min(...rs)).toBe(1);
    const agustatory = new NoveltyCompartment(51, { tastes: false });
    expect(agustatory.sense(A, 0, 0.005)).toEqual({ novelty: null, active: 0 });
    expect(agustatory.meanWeight).toBe(1);
  });

  it("refuses time running backwards and corrupt snapshots", () => {
    const m = new NoveltyCompartment(61);
    m.sense(A, 10, 0.005);
    expect(() => m.sense(A, 9, 0.005)).toThrow(/backwards/);
    const s = m.snapshot();
    expect(() =>
      NoveltyCompartment.restore({ ...s, weights: s.weights.slice(1) }),
    ).toThrow();
    expect(() =>
      NoveltyCompartment.restore({ ...s, weights: s.weights.map((w, i) => (i ? w : 2)) }),
    ).toThrow();
  });

  it("cites every published parameter with a DOI and a quote", () => {
    for (const [name, p] of Object.entries(NOVELTY_PARAMS)) {
      if (p.class === "published") expect(p.sources?.length, name).toBeGreaterThan(0);
      for (const s of "sources" in p ? p.sources : []) {
        expect(s.doi, name).toMatch(/^10\.\d{4,}\//);
        expect(s.quote.length, name).toBeGreaterThan(20);
      }
    }
  });
});
