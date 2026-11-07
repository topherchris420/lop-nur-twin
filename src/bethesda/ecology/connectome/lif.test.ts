/**
 * The reduced-circuit engine gives the spikes the Python backend's engine gives, step
 * for step, on a synthetic network (fixtures/lif-conformance.json, made by
 * the backend's `reduce fixture` command; not a connectome).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../../lib/noise";
import { ReducedCircuit, shuffledWeights, type CircuitFile } from "./lif";

interface Fixture {
  schema: string;
  circuit: CircuitFile;
  steps: number;
  kicks: [number, number[]][];
  spikes: [number, number][];
  counts: number[];
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/lif-conformance.json", import.meta.url), "utf8"),
) as Fixture;

describe("the reduced-circuit engine", () => {
  it("reproduces the Python engine's spikes on the conformance network, step for step", () => {
    expect(fixture.schema).toBe("connectome-lif-conformance/v1");
    const c = new ReducedCircuit(fixture.circuit);
    const kicks = new Map(fixture.kicks);
    const spikes: [number, number][] = [];
    for (let s = 0; s < fixture.steps; s++) {
      c.advance(kicks.get(s) ?? []);
      for (const i of c.lastFired) spikes.push([s, i]);
    }
    expect(spikes.length).toBeGreaterThan(100);
    expect(spikes).toEqual(fixture.spikes);
    expect(Array.from(c.counts)).toEqual(fixture.counts);
  });

  it("costs nothing off input once near rest, and from rest behaves as a fresh circuit", () => {
    // At full strength this random network keeps itself firing; at 30% it falls silent.
    const weights = () =>
      Float64Array.from(
        fixture.circuit.signed_count,
        (k) => k * fixture.circuit.lif.w_syn_mV * 0.3,
      );
    const a = new ReducedCircuit(fixture.circuit, { weights: weights() });
    const rng = mulberry32(3);
    a.run(200, 150, rng);
    expect(a.activeCount).toBeGreaterThan(0);
    a.run(20_000, 0, rng);
    expect(a.atRest()).toBe(true);
    expect(a.activeCount).toBe(0);
    const total = (c: ReducedCircuit) => c.counts.reduce((x, y) => x + y, 0);
    const spikes = total(a);
    a.run(200, 150, mulberry32(9));
    // From rest, the same input gives the same spikes as a fresh circuit.
    const b = new ReducedCircuit(fixture.circuit, { weights: weights() });
    b.run(200, 150, mulberry32(9));
    expect(total(b)).toBeGreaterThan(0);
    expect(total(a) - spikes).toBe(total(b));
  });

  it("reads a trailing-window readout rate, and a shuffled wiring keeps the same weights", () => {
    const c = new ReducedCircuit(fixture.circuit);
    c.run(500, 150, mulberry32(5));
    const r = c.readoutRateHz(500);
    expect(r).toBeCloseTo(c.readoutSpikes / c.readout.length / 0.5, 9);
    const w = shuffledWeights(fixture.circuit, mulberry32(1));
    const sorted = (x: ArrayLike<number>) => Array.from(x).sort((p, q) => p - q);
    expect(sorted(w)).toEqual(
      sorted(fixture.circuit.signed_count.map((k) => k * fixture.circuit.lif.w_syn_mV)),
    );
  });
});
