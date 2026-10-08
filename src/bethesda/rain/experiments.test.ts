import { describe, expect, it } from "vitest";
import proposal from "./fixtures/demo-proposal.json" with { type: "json" };
import {
  EXPERIMENT_BOUNDS,
  LOCATION_IDS,
  METRIC_IDS,
  SCENARIO_IDS,
  SCENARIO_LOCATIONS,
} from "./contracts";
import {
  EXPECTED_PLACE,
  SCENARIO_KIND,
  compileFor,
  protocolOf,
  validateExperiment,
  verifyDefinition,
} from "./experiments";
import { OPTIONS, proposalFrom } from "./session";

const base = () => structuredClone(proposal) as Record<string, unknown>;
const rejects = (mutate: (p: Record<string, unknown>) => void) => {
  const p = base();
  mutate(p);
  return validateExperiment(p).ok === false;
};

describe("supported scenarios resolve through the city's own compiler", () => {
  it.each(SCENARIO_IDS.flatMap((s) => SCENARIO_LOCATIONS[s].map((l) => [s, l] as const)))(
    "%s at %s compiles to one event of the expected family at the mapped place",
    (scenario, location) => {
      const c = compileFor(scenario, location);
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      expect(c.event.kind).toBe(SCENARIO_KIND[scenario]);
      expect(c.event.place).toBe(EXPECTED_PLACE[location]);
    },
  );
  it("offers every supported pair to R.A.I.N. once, and each option validates", () => {
    const pairs = OPTIONS.filter((o) => o.template).map(
      (o) => `${o.template!.scenario}@${o.template!.location}`,
    );
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs.length).toBe(
      SCENARIO_IDS.reduce((n, s) => n + SCENARIO_LOCATIONS[s].length, 0),
    );
    for (const o of OPTIONS.filter((x) => x.template)) {
      const p = proposalFrom(o.id, {
        question: "q",
        meetingId: null,
        origin: "human",
        decision: null,
      });
      expect(validateExperiment(p).ok).toBe(true);
    }
  });
});

describe("deterministic validation", () => {
  it("accepts a valid bounded experiment and derives everything else itself", () => {
    const v = validateExperiment(base());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const d = v.value.definition;
    expect(d.scenario.event.kind).toBe("metro-closure");
    expect(d.scenario.place).toBe("Bethesda Metro (Red Line) entrance");
    expect(d.criteria.rule).toBe("rain-criteria/v1");
    expect(d.criteria.failure[0]).toMatchObject({
      metric: "primary_delta_mean",
      op: "<=",
      value: 0,
    });
    expect(v.value.experimentId).toBe(`BX-${v.value.definitionSha256.slice(0, 12)}`);
    expect(v.checks.every((c) => c.ok)).toBe(true);
    const shown = protocolOf(d);
    expect(shown.failure).toContain("F1");
    expect(shown.treatment).toContain("injected at tick 300");
  });
  it("is deterministic: the same proposal is the same definition", () => {
    const a = validateExperiment(base()),
      b = validateExperiment(base());
    expect(a.ok && b.ok && a.value.definitionSha256 === b.value.definitionSha256).toBe(
      true,
    );
  });
  it.each([
    [
      "an unsupported scenario",
      (p: Record<string, unknown>) => (p.scenario = "earthquake"),
    ],
    ["an unsupported place", (p: Record<string, unknown>) => (p.location = "paris")],
    [
      "a real place the scenario does not support",
      (p: Record<string, unknown>) => (p.location = "bethesda_row"),
    ],
    [
      "an unknown metric",
      (p: Record<string, unknown>) => (p.primary_metric = "happiness"),
    ],
    ["no seeds", (p: Record<string, unknown>) => (p.seeds = [])],
    ["duplicate seeds", (p: Record<string, unknown>) => (p.seeds = [1, 1])],
    ["too many seeds", (p: Record<string, unknown>) => (p.seeds = [1, 2, 3, 4, 5, 6])],
    ["a negative seed", (p: Record<string, unknown>) => (p.seeds = [-1])],
    ["a fractional seed", (p: Record<string, unknown>) => (p.seeds = [1.5])],
    ["a seed beyond 32 bits", (p: Record<string, unknown>) => (p.seeds = [2 ** 32])],
    [
      "a window too long",
      (p: Record<string, unknown>) => (p.observation_window_ticks = 6000),
    ],
    [
      "a window off the sample grid",
      (p: Record<string, unknown>) => (p.observation_window_ticks = 1250),
    ],
    ["a warm-up too short", (p: Record<string, unknown>) => (p.warmup_ticks = 0)],
    [
      "a run over the tick budget",
      (p: Record<string, unknown>) => {
        p.seeds = [1, 2, 3, 4, 5];
        p.observation_window_ticks = 3000;
        p.warmup_ticks = 1200;
      },
    ],
    ["a zero minimum effect", (p: Record<string, unknown>) => (p.minimum_effect = 0)],
    [
      "an absurd minimum effect",
      (p: Record<string, unknown>) => (p.minimum_effect = 1e9),
    ],
    [
      "a non-finite effect",
      (p: Record<string, unknown>) => (p.minimum_effect = Number.NaN),
    ],
    ["another comparison", (p: Record<string, unknown>) => (p.comparison = "none")],
    [
      "an unknown direction",
      (p: Record<string, unknown>) => (p.expected_direction = "sideways"),
    ],
    [
      "the retired schema, without a mathematical basis",
      (p: Record<string, unknown>) => {
        p.schema = "rain-bethesda-experiment/v1";
        delete p.mathematical_basis;
      },
    ],
    [
      "an unknown schema",
      (p: Record<string, unknown>) => (p.schema = "rain-bethesda-experiment/v3"),
    ],
    ["smuggled coordinates", (p: Record<string, unknown>) => (p.point = { x: 0, z: 0 })],
    [
      "smuggled code",
      (p: Record<string, unknown>) => (p.script = "sim.agents.length = 0"),
    ],
    [
      "a smuggled world mutation",
      (p: Record<string, unknown>) =>
        (p.commands = [{ type: "move", tick: 0, dx: 900, dz: 0 }]),
    ],
    [
      "a smuggled URL",
      (p: Record<string, unknown>) => (p.callback = "https://evil.example"),
    ],
    [
      "a fixture claiming a R.A.I.N. decision",
      (p: Record<string, unknown>) =>
        (p.rain_decision = { decision_id: "abcd-1234", envelope_hash: "e".repeat(64) }),
    ],
    [
      "a R.A.I.N. proposal without its decision",
      (p: Record<string, unknown>) => (p.origin = "rain"),
    ],
    [
      "an over-long question",
      (p: Record<string, unknown>) => (p.question = "x".repeat(501)),
    ],
    [
      "a hidden-direction hypothesis",
      (p: Record<string, unknown>) => (p.hypothesis = "a\u202eb"),
    ],
  ])("rejects %s", (_label, mutate) => {
    expect(rejects(mutate)).toBe(true);
  });
  it("names exactly what failed", () => {
    const p = base();
    p.scenario = "earthquake";
    const v = validateExperiment(p);
    expect(v.ok).toBe(false);
    expect(v.checks[0]!.ok).toBe(false);
    expect(v.checks[0]!.detail).toMatch(/scenario/);
  });
  it("covers the declared vocabulary", () => {
    expect(LOCATION_IDS.length).toBeGreaterThan(0);
    expect(METRIC_IDS.length).toBe(7);
    expect(EXPERIMENT_BOUNDS.sampleInterval).toBe(100);
  });
});

describe("definition integrity", () => {
  it("detects a changed definition and refuses another build's versions", () => {
    const v = validateExperiment(base());
    if (!v.ok) throw new Error("fixture must validate");
    const { definition, definitionSha256 } = v.value;
    expect(verifyDefinition(definition, definitionSha256)).toEqual([]);
    const seeds = structuredClone(definition);
    seeds.seeds = [101, 202, 304];
    expect(verifyDefinition(seeds, definitionSha256).join()).toMatch(/SHA-256/);
    const moved = structuredClone(definition);
    moved.scenario.event.point = { x: 0, z: 0 };
    expect(verifyDefinition(moved, definitionSha256).length).toBeGreaterThan(0);
    const older = structuredClone(definition);
    older.versions.sim = "bethesda-city/2" as never;
    expect(verifyDefinition(older, definitionSha256).join()).toMatch(/version/);
  });
});
