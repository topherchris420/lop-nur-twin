/**
 * The runner on short runs of the real protocol (its conditions, controllers and
 * subjects; only the duration shortened): determinism, paired fairness, the
 * baseline-equivalence of the controllers that carry plasticity without acting,
 * and honest records of timeouts and errors.
 */
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../rain/sha256.js";
import { parseProtocol, unitsOf, type Protocol, type Unit } from "./protocol.js";
import source from "./protocols/plasticity-locomotor-v1.json" with { type: "json" };
import { behaviouralPart, runUnit, subjectOf, type Clock } from "./runner.js";

const short: Protocol = parseProtocol({ ...source, durationS: 900, lateFromS: 450, blockS: 300 });
const real = parseProtocol(source);

let t = 0;
const clock: Clock = { wallMs: () => (t += 1), cpuMs: () => null };
const run = (u: Unit, p = short) => runUnit(p, "dev", u, clock);

describe("the runner", () => {
  it("is deterministic: the same unit gives the same behavioural record", () => {
    const u: Unit = { seed: 9201, condition: "weak-legs", controller: "plasticity-active" };
    const a = run(u),
      b = run(u);
    expect(a.status).toBe("complete");
    expect(canonicalJson(behaviouralPart(a))).toBe(canonicalJson(behaviouralPart(b)));
    expect(a.blocks).toHaveLength(3);
  }, 120_000);

  it("pairs: every controller of a unit meets the same environment, and other seeds another", () => {
    const env = (seed: number, controller: Unit["controller"], condition = "weak-legs") =>
      run({ seed, condition, controller }).environmentDigest;
    const e = env(9202, "organism");
    expect(env(9202, "plasticity-active")).toBe(e);
    expect(env(9202, "fixed-slow")).toBe(e);
    expect(env(9203, "organism")).not.toBe(e);
    expect(env(9202, "organism", "unimpaired")).not.toBe(e);
  }, 180_000);

  it("finds shadow and disabled plasticity identical to the baseline, and active different", () => {
    const of = (controller: Unit["controller"]) =>
      behaviouralPart(run({ seed: 9204, condition: "weak-legs", controller }));
    const base = of("organism");
    for (const c of ["plasticity-shadow", "plasticity-disabled"] as const) {
      const r = of(c);
      expect(r.bodyHash).toBe(base.bodyHash);
      expect(r.behaviour).toEqual(base.behaviour);
    }
    const active = of("plasticity-active");
    expect(active.plasticity!.adaptations).toBeGreaterThan(0);
    expect(active.bodyHash).not.toBe(base.bodyHash);
  }, 180_000);

  it("records a run over its wall limit as a timeout, with no behaviour", () => {
    const slow: Clock = { wallMs: () => (t += 1e6), cpuMs: () => null };
    const r = runUnit(short, "dev", { seed: 9205, condition: "unimpaired", controller: "organism" }, slow);
    expect(r.status).toBe("timeout");
    expect(r.error).toMatch(/over 900 s of wall time/);
    expect(r.ticks).toBe(1000);
    expect(Object.values(r.behaviour).every((v) => v === null)).toBe(true);
    expect(r.bodyHash).toBeNull();
  });

  it("records a failure as an error, never as a result", () => {
    const r = run({ seed: 9205, condition: "no-such-condition", controller: "organism" });
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/unknown condition/);
    expect(r.behaviour.fedJ).toBeNull();
  });

  it("names every subject research-eimb-…, never an original", () => {
    for (const u of unitsOf(real, "heldout").slice(0, 50))
      expect(subjectOf(real, "heldout", u)).toMatch(/^research-eimb-plasticity-locomotor-v1-heldout-\d+-/);
  });
});
