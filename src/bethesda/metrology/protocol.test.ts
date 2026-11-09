import { describe, expect, it } from "vitest";
import { CONTROLLER_IDS } from "./controllers.js";
import {
  BEHAVIOUR_METRICS,
  METRIC_DIRECTION,
  heldoutSeeds,
  parseProtocol,
  protocolDigest,
  protocolErrors,
  seedsOf,
  unitKey,
  unitsOf,
} from "./protocol.js";
import source from "./protocols/plasticity-locomotor-v1.json" with { type: "json" };

const clone = () => JSON.parse(JSON.stringify(source)) as Record<string, unknown> & typeof source;

describe("the protocol schema", () => {
  it("accepts the committed protocol", () => {
    expect(protocolErrors(source)).toEqual([]);
  });

  it("refuses unknown keys, so nothing rides along unvalidated", () => {
    const p = clone();
    (p as Record<string, unknown>).extra = 1;
    expect(protocolErrors(p).join(" ")).toMatch(/extra/);
    const q = clone();
    (q.analysis as Record<string, unknown>).peek = true;
    expect(protocolErrors(q).join(" ")).toMatch(/peek/);
  });

  it("refuses a missing or wrong field", () => {
    for (const mutate of [
      (p: ReturnType<typeof clone>) => delete (p as Record<string, unknown>).baseline,
      (p: ReturnType<typeof clone>) => (p.schema = "eimb-protocol/v0" as never),
      (p: ReturnType<typeof clone>) => (p.endpoints.confirmatory[0]!.mme = 0),
      (p: ReturnType<typeof clone>) => (p.endpoints.confirmatory[0]!.metric = "walkedM" as never),
      (p: ReturnType<typeof clone>) => (p.conditions[0]!.controllers = ["organism"] as never),
      (p: ReturnType<typeof clone>) => (p.validity.identicalToBaseline = ["plasticity-active"] as never),
      (p: ReturnType<typeof clone>) => (p.splits.dev.seeds = [9201, 9201] as never),
      (p: ReturnType<typeof clone>) => (p.splits.dev.seeds = [9101] as never),
      (p: ReturnType<typeof clone>) => (p.analysis.alpha = 0.5),
      (p: ReturnType<typeof clone>) => (p.durationS = 0),
    ]) {
      const p = clone();
      mutate(p);
      expect(protocolErrors(p).length, JSON.stringify(p).slice(0, 80)).toBeGreaterThan(0);
      expect(() => parseProtocol(p)).toThrow();
    }
  });
});

describe("the frozen design", () => {
  const p = parseProtocol(source);

  it("derives 40 held-out seeds from the digest, disjoint from dev and every spent seed", () => {
    const h = heldoutSeeds(p);
    expect(h).toHaveLength(40);
    expect(new Set(h).size).toBe(40);
    expect(h).toEqual(heldoutSeeds(parseProtocol(clone())));
    const spent = new Set([...p.splits.dev.seeds, ...p.reservedSeeds]);
    expect(h.some((s) => spent.has(s))).toBe(false);
    expect(Math.min(...h)).toBeGreaterThanOrEqual(100_000);
  });

  it("changes every held-out seed when any byte of the protocol changes", () => {
    const q = clone();
    q.endpoints.confirmatory[0]!.mme = 0.129;
    const other = heldoutSeeds(parseProtocol(q));
    expect(protocolDigest(parseProtocol(q))).not.toBe(protocolDigest(p));
    expect(other.filter((s) => heldoutSeeds(p).includes(s))).toEqual([]);
  });

  it("runs the baseline, candidate and simpler control in every condition, and the ablations where validity is checked", () => {
    const units = unitsOf(p, "dev");
    expect(units).toHaveLength(6 * (9 * 3 + 2 * 2));
    expect(new Set(units.map(unitKey)).size).toBe(units.length);
    expect(unitsOf(p, "heldout")).toHaveLength(40 * 31);
    for (const c of p.conditions)
      for (const id of [p.baseline, p.candidate, ...p.controls]) expect(c.controllers).toContain(id);
    for (const id of p.validity.identicalToBaseline)
      expect(units.filter((u) => u.controller === id).map((u) => u.condition).sort()).toEqual(
        seedsOf(p, "dev").flatMap(() => [...p.validity.conditions]).sort(),
      );
  });

  it("decides on metrics with a direction and a positive minimum meaningful effect", () => {
    for (const e of p.endpoints.confirmatory) {
      expect(METRIC_DIRECTION[e.metric]).not.toBe("neutral");
      expect(e.mme).toBeGreaterThan(0);
      expect(e.mmeRule.length).toBeGreaterThan(40);
    }
    for (const g of p.endpoints.guardrails) expect(METRIC_DIRECTION[g.metric]).not.toBe("neutral");
    expect(BEHAVIOUR_METRICS).toContain(p.endpoints.boundary.metric);
    expect([...CONTROLLER_IDS].sort()).toEqual(
      [...new Set(p.conditions.flatMap((c) => c.controllers).concat(p.validity.identicalToBaseline))].sort(),
    );
  });

  it("keeps the 2026-11-07 study's subjects out of this protocol", () => {
    for (const s of [9001, 9008, 9101, 9124]) expect(p.reservedSeeds).toContain(s);
  });
});
