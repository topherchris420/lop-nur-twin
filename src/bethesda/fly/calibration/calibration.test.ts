import { describe, expect, it } from "vitest";
import fit from "../../../../docs/benchmarks/fly-calibration/fit.json" with { type: "json" };
import reportJson from "../../../../docs/benchmarks/fly-calibration/report.json" with { type: "json" };
import { mulberry32 } from "../../../lib/noise";
import { CircuitController } from "../circuits/controller";
import { EscapeCircuit } from "../circuits/giantFiber";
import { GroomingCircuit } from "../circuits/grooming";
import { CIRCUIT_PARAMS, resolveCircuitParams } from "../circuits/params";
import { FLY_VERSION } from "../fly";
import type { SenseFrame } from "../senses";
import { agreement, directionAgreement, wilson } from "./compare";
import { durations, runs, summarizeEthograms } from "./ethogram";
import { expectedShortShare, gfPeaks, normalCdf } from "./fit";
import { GROOMING_REFERENCE } from "./groomingReference";
import { OBSERVATIONS, PARADIGMS } from "./observations";
import {
  chamberSession,
  loomingTrial,
  vonReyn2014Loom,
  ZHANG_2020_CHAMBER,
} from "./paradigms";
import { circuitSubject, CIRCUIT, REDUCED_ORDER, V2 } from "./subjects";
import { V2_FIT_TARGETS, V2_PARAMS } from "../circuits/v2/params";
import { V2_MECHANISMS } from "../circuits/v2/controller";
import { roleFor, V2_DESIGN } from "./roles";
import type { CalibrationReport } from "./report";

/** The committed report, read as the type that writes it (its JSON type follows whatever was last generated). */
const report = reportJson as unknown as CalibrationReport;

describe("published observations", () => {
  it("names each once, in a paradigm the calibration rebuilds, with its words or data", () => {
    const ids = OBSERVATIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of OBSERVATIONS) {
      expect(Object.keys(PARADIGMS)).toContain(o.paradigm);
      expect(["held-out", "design", "fit"]).toContain(o.role);
      if (o.value === null) expect(o.sign === 1 || o.sign === -1).toBe(true);
      const s = o.source;
      if ("data" in s) {
        expect(s.citation.doi).toBe(GROOMING_REFERENCE.dataset.doi);
      } else {
        const quotes = Array.isArray(s.quote) ? s.quote : [s.quote];
        expect(quotes.length).toBeGreaterThan(0);
        for (const q of quotes) expect(q.trim().length).toBeGreaterThan(5);
        expect(s.citation.doi).toMatch(/^10\.\d{4,}\//);
      }
    }
  });

  it("calls an observation a fit target exactly when a fitted value names it", () => {
    const named = new Set(
      Object.values(CIRCUIT_PARAMS).flatMap((p) =>
        "fit" in p && p.fit ? [...p.fit] : [],
      ),
    );
    const fitTargets = new Set(
      OBSERVATIONS.filter((o) => o.role === "fit").map((o) => o.id),
    );
    expect([...named].sort()).toEqual([...fitTargets].sort());
  });
});

describe("roles per controller", () => {
  it("makes v2's fit targets development observations it was fitted to, never held out", () => {
    for (const id of Object.values(V2_FIT_TARGETS).flat()) {
      const o = OBSERVATIONS.find((x) => x.id === id);
      expect(o, id).toBeDefined();
      expect(o!.registered).toBeUndefined();
      expect(roleFor(o!, V2.id)).toBe("fit");
      expect(roleFor(o!, `${V2.id}-wall`)).toBe("fit");
    }
    for (const id of V2_DESIGN)
      expect(
        roleFor(
          OBSERVATIONS.find((x) => x.id === id)!,
          V2.id,
        ),
      ).toBe("design");
  });

  it("holds every observation registered before v2 out of nothing v2 could claim", () => {
    for (const o of OBSERVATIONS.filter((x) => !x.registered))
      expect(roleFor(o, V2.id)).not.toBe("held-out");
  });

  it("holds the 2026-11 set out for every controller", () => {
    for (const o of OBSERVATIONS.filter((x) => x.registered))
      for (const s of [REDUCED_ORDER.id, CIRCUIT.id, V2.id, `${V2.id}-flight`])
        expect(roleFor(o, s)).toBe("held-out");
  });
});

describe("the fit", () => {
  it("is the one fit.json records, and the circuit runs with it", () => {
    expect(CIRCUIT_PARAMS.gfThresholdMv.value).toBe(fit.giantFiber.medianMv);
    expect(CIRCUIT_PARAMS.gfThresholdLnSd.value).toBe(fit.giantFiber.lnSd);
    expect(CIRCUIT_PARAMS.groomDriveDust.value).toBe(fit.grooming.groomDriveDust);
    expect(fit.flyVersion).toBe(FLY_VERSION);
    expect(fit.giantFiber.modesPredicted).toBe(fit.giantFiber.trials);
  });

  it("gives circuit-informed/v2 the values its fit reached", () => {
    const values = (fit as unknown as { v2: { values: Record<string, number> } }).v2
      .values;
    const fitted = Object.entries(V2_PARAMS).filter(([, p]) => p.kind === "fitted");
    expect(fitted.map(([k]) => k).sort()).toEqual(Object.keys(values).sort());
    for (const [k, p] of fitted) expect(p.value, k).toBe(values[k]);
  });

  it("predicts each trial's mode from its peak potential and its own threshold draw", () => {
    const m = CIRCUIT_PARAMS.gfThresholdMv.value,
      s = CIRCUIT_PARAMS.gfThresholdLnSd.value;
    for (const rv of [8, 40]) {
      const peaks = gfPeaks(rv, 6);
      for (const p of peaks) {
        const t = loomingTrial(CIRCUIT, vonReyn2014Loom(rv), p.seed);
        expect(t.jumped).toBe(true);
        expect(t.short).toBe(m * Math.exp(s * p.z) <= p.peakMv);
      }
      const share = expectedShortShare(peaks, m, s);
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
      // A higher threshold never makes short mode commoner.
      expect(expectedShortShare(peaks, m * 2, s)).toBeLessThanOrEqual(share);
    }
  });

  it("uses a normal distribution function accurate to 1e-6", () => {
    for (const [x, p] of [
      [0, 0.5],
      [1, 0.8413447460685429],
      [-1.959963984540054, 0.025],
      [3, 0.9986501019683699],
    ] as const)
      expect(Math.abs(normalCdf(x) - p)).toBeLessThan(1e-6);
  });
});

describe("the report", () => {
  it("was made by this fly and sets every observation beside every controller and ablation", () => {
    expect(report.flyVersion).toBe(FLY_VERSION);
    const subjects = report.subjects.map((s) => s.id);
    expect(subjects).toEqual([REDUCED_ORDER.id, CIRCUIT.id, V2.id]);
    expect(report.ablations.map((a) => a.without)).toEqual([...V2_MECHANISMS]);
    const everyone = [...subjects, ...report.ablations.map((a) => a.id)];
    for (const o of OBSERVATIONS) {
      const rows = report.comparisons.filter((c) => c.observation === o.id);
      expect(rows.length === 1 ? rows[0]!.subject : rows.map((r) => r.subject)).toEqual(
        rows.length === 1 ? "body" : everyone,
      );
      for (const r of rows) expect(r.role).toBe(roleFor(o, r.subject));
    }
  });
});

describe("paradigms", () => {
  it("replay a trial exactly from its seed", () => {
    const a = loomingTrial(CIRCUIT, vonReyn2014Loom(14), 77),
      b = loomingTrial(CIRCUIT, vonReyn2014Loom(14), 77);
    expect(b).toEqual(a);
    const spec = { ...ZHANG_2020_CHAMBER, durationS: 20 };
    expect(chamberSession(CIRCUIT, spec, { dusted: true }, 5)).toEqual(
      chamberSession(CIRCUIT, spec, { dusted: true }, 5),
    );
  });

  it("leave a clean fly's grooming to the reduced-order controller", () => {
    const spec = { ...ZHANG_2020_CHAMBER, durationS: 60 };
    expect(chamberSession(CIRCUIT, spec, { dusted: false }, 9)).toEqual(
      chamberSession(REDUCED_ORDER, spec, { dusted: false }, 9),
    );
  });

  it("let a silenced giant fiber leave every looming takeoff to the long mode", () => {
    const silenced = circuitSubject({}, { silenceGiantFiber: true });
    for (let i = 0; i < 4; i++) {
      const t = loomingTrial(silenced, vonReyn2014Loom(8), 900 + i);
      expect(t.jumped).toBe(true);
      expect(t.short).toBe(false);
    }
  });
});

describe("ethograms", () => {
  it("leaves runs that touch either end out of durations", () => {
    const labels = [7, 2, 2, 1, 7, 7, 3, 3, 3, 6];
    const groom = (l: number) => l >= 1 && l <= 5;
    expect(runs(labels, (a, b) => groom(a) === groom(b), groom)).toEqual([3, 3]);
    expect(
      runs(
        [2, 2, 7],
        (a, b) => a === b,
        () => true,
      ),
    ).toEqual([]);
    expect(durations([3, 3], 30).median).toBeCloseTo(0.1, 10);
  });

  it("summarizes simulated and recorded flies the same way", () => {
    const f = new Uint8Array(9000).map((_, k) => (k % 300 < 150 ? 2 : 7));
    const s = summarizeEthograms([f, f], 30, 150);
    expect(s.grooming.mean).toBeCloseTo(0.5, 10);
    expect(s.anterior.mean).toBeCloseTo(0.5, 10);
    expect(s.intervals.count).toBe(2);
    expect(s.episodes.durationS.median).toBeCloseTo(5, 10);
  });
});

describe("comparisons", () => {
  it("says when a paper gives nothing to judge by", () => {
    expect(agreement(0.5, 0.29, null, null)).toBe("no-interval");
    expect(agreement(null, 0.29, null, null)).toBe("not-produced");
    expect(agreement(0.37, 40 / 108, { kind: "proportion", k: 40, n: 108 }, 108)).toBe(
      "inside",
    );
    expect(agreement(0.6, 0.41, { kind: "sd", value: 0.2 }, 44)).toBe("within-spread");
    expect(directionAgreement(-0.2, -1)).toBe("agrees");
    expect(directionAgreement(0.2, -1)).toBe("disagrees");
    const w = wilson(40, 108);
    expect(w.lo).toBeLessThan(40 / 108);
    expect(w.hi).toBeGreaterThan(40 / 108);
  });
});

describe("the circuit models", () => {
  const P = resolveCircuitParams();
  const frame = (t: number, sizeDeg: number, expansionDegS: number): SenseFrame =>
    ({
      t,
      looming:
        sizeDeg > 0
          ? {
              id: "x",
              kind: "stimulus",
              distance: 1,
              sizeDeg,
              expansionDegS,
              bearing: 0,
              elevation: 0,
              drive: 0,
            }
          : null,
    }) as unknown as SenseFrame;

  it("spikes the giant fiber on a fast loom unless it is silenced", () => {
    for (const silenced of [false, true]) {
      const gf = new EscapeCircuit(
        { ...P, gfThresholdMv: 0.5, gfThresholdLnSd: 0 },
        mulberry32(1),
        silenced,
      );
      let spiked = false;
      // A loom at r/v 10 ms from 15°: size and expansion sampled every 10 ms.
      for (let k = 0; k < 12; k++) {
        const tau = 0.06 - k * 0.005;
        const size = (2 * Math.atan(0.01 / Math.max(tau, 0.005)) * 180) / Math.PI;
        const rate = ((2 * 0.01) / (tau * tau + 0.0001)) * (180 / Math.PI);
        spiked ||= gf.sample(frame(k * 0.01, size, rate), 1).spike;
      }
      expect(spiked).toBe(!silenced);
      expect(gf.state.spikes > 0).toBe(!silenced);
    }
  });

  it("grooms the head first and moves its dust to the front legs", () => {
    const g = new GroomingCircuit(P, mulberry32(2), GroomingCircuit.allOver(P));
    const before = { ...g.state.dust };
    const first = g.decide(0);
    expect(first === "eyes" || first === "antennae").toBe(true);
    expect(g.state.bout!.module).toBe("head");
    const moved = before.head - g.state.dust.head;
    expect(moved).toBeCloseTo(before.head * P.dustRemovalRate, 9);
    expect(g.state.dust.front - before.front).toBeCloseTo(moved, 9);
  });

  it("grooms a fly dusted only on its wings at its wings", () => {
    const g = new GroomingCircuit(P, mulberry32(3), { wings: 2 * P.groomDriveDust });
    expect(g.decide(0)).toBe("wings");
  });

  it("is a decision maker the fly's gate checks like any other", () => {
    const c = new CircuitController(mulberry32(4), { seed: 4 });
    expect(c.descriptor.simulatesNeurons).toBe(false);
    expect(c.circuitParams.gfThresholdMv).toBe(CIRCUIT_PARAMS.gfThresholdMv.value);
  });
});
