import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  armQuery,
  experimentHash,
  liveGate,
  parseExperiment,
  EXPERIMENT_SCHEMA,
} from "./experimentSpec";

const ROOT = join(__dirname, "..", "..", "..");

const valid = {
  schema: EXPERIMENT_SCHEMA,
  id: "cover-selection-v1",
  question: "Does the decision system choose locations that reduce exposure?",
  hypothesis:
    "A brain that reads the hidden flag chooses hidden places more than random does.",
  independentVariable: "brain",
  primaryMetric: "exposure_fraction_next_window",
  secondaryMetrics: ["damage_taken_next_window"],
  decisionType: "cover-selection/v1",
  outcomeWindowS: 5,
  seeds: [42, 43, 44],
  duration: 120,
  seat: "even",
  arms: [
    {
      id: "skirmisher",
      brain: "script",
      policy: "skirmisher",
      control: "precision",
      navigation: "places",
    },
    { id: "random", brain: "random", control: "precision", navigation: "places" },
  ],
};

describe("experiment contracts", () => {
  it("accepts a complete declaration and fills defaults", () => {
    const parsed = parseExperiment(valid);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.spec.mode).toBe("tdm");
    expect(parsed.spec.calibrationField).toBe("probability");
    // The top-level seat applies to every arm that does not set its own.
    expect(parsed.spec.arms.every((a) => a.seat === "even")).toBe(true);
  });

  it("refuses a run with no primary metric, or one that is not registered", () => {
    const { primaryMetric: _omit, ...missing } = valid;
    void _omit;
    const a = parseExperiment(missing);
    expect(a.ok).toBe(false);
    const b = parseExperiment({ ...valid, primaryMetric: "vibes" });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.join(" ")).toMatch(/registered metric/);
  });

  it("refuses a decision metric without a declared decision type", () => {
    const parsed = parseExperiment({ ...valid, decisionType: null });
    expect(parsed.ok).toBe(false);
  });

  it("refuses the primary metric listed again as secondary", () => {
    const parsed = parseExperiment({
      ...valid,
      secondaryMetrics: ["exposure_fraction_next_window"],
    });
    expect(parsed.ok).toBe(false);
  });

  it("refuses misspelled fields rather than ignoring them", () => {
    const parsed = parseExperiment({ ...valid, primaryMetirc: "accuracy" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]).toMatch(/unknown field/);
  });

  it("refuses a missing hypothesis, duplicate seeds and duplicate arms", () => {
    expect(parseExperiment({ ...valid, hypothesis: "" }).ok).toBe(false);
    expect(parseExperiment({ ...valid, seeds: [1, 1] }).ok).toBe(false);
    expect(parseExperiment({ ...valid, arms: [valid.arms[0], valid.arms[0]] }).ok).toBe(
      false,
    );
  });

  it("refuses altering a remote model's latency, directly or by sweep", () => {
    const direct = parseExperiment({
      ...valid,
      arms: [{ id: "jev", brain: "jev", control: "precision", latencyMs: 250 }],
    });
    expect(direct.ok).toBe(false);
    const swept = parseExperiment({
      ...valid,
      arms: [{ id: "llm", brain: "llm", control: "precision" }],
      sweep: { param: "latencyMs", values: [0, 250] },
    });
    expect(swept.ok).toBe(false);
  });

  it("expands a latency sweep into one arm per value", () => {
    const parsed = parseExperiment({
      ...valid,
      independentVariable: "latency",
      arms: [valid.arms[0]],
      sweep: { param: "latencyMs", values: [0, 250, 500] },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.spec.arms.map((a) => [a.id, a.latencyMs])).toEqual([
      ["skirmisher@lat0", 0],
      ["skirmisher@lat250", 250],
      ["skirmisher@lat500", 500],
    ]);
  });

  it("refuses an outcome window the seat would not run as declared", () => {
    // `?outcomeWindow=` is read as an integer; 2.5 would silently run as 5.
    const half = parseExperiment({ ...valid, outcomeWindowS: 2.5 });
    expect(half.ok).toBe(false);
    if (!half.ok) expect(half.errors.join(" ")).toMatch(/outcomeWindowS: whole seconds/);
    expect(parseExperiment({ ...valid, outcomeWindowS: 0 }).ok).toBe(false);
    expect(parseExperiment({ ...valid, outcomeWindowS: 31 }).ok).toBe(false);
    const whole = parseExperiment({ ...valid, outcomeWindowS: 3 });
    expect(whole.ok && whole.spec.outcomeWindowS).toBe(3);
  });

  it("refuses a cadence below the host's floor, directly or by sweep", () => {
    // negotiate() never runs faster than the host's 100 ms, so 50 would run as
    // 100 while the reports said 50.
    const direct = parseExperiment({
      ...valid,
      arms: [{ ...valid.arms[0], cadenceMs: 50 }],
    });
    expect(direct.ok).toBe(false);
    if (!direct.ok) expect(direct.errors.join(" ")).toMatch(/cadenceMs: .*\[100, 2000\]/);
    const swept = parseExperiment({
      ...valid,
      independentVariable: "cadence",
      arms: [valid.arms[0]],
      sweep: { param: "cadenceMs", values: [99, 200] },
    });
    expect(swept.ok).toBe(false);
    expect(
      parseExperiment({ ...valid, arms: [{ ...valid.arms[0], cadenceMs: 100 }] }).ok,
    ).toBe(true);
  });

  it("expands seed presets", () => {
    const parsed = parseExperiment({ ...valid, seeds: { preset: "dev", base: 100 } });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.spec.seeds).toHaveLength(10);
      expect(parsed.spec.seeds[0]).toBe(100);
      expect(parsed.spec.seedPreset).toBe("dev");
    }
  });

  it("hashes the definition, so a changed metric is a different experiment", () => {
    const a = parseExperiment(valid);
    const b = parseExperiment({
      ...valid,
      primaryMetric: "death_rate_next_window",
      secondaryMetrics: [],
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(experimentHash(a.spec)).toMatch(/^[0-9a-f]{16}$/);
    const again = parseExperiment(JSON.parse(JSON.stringify(valid)));
    expect(again.ok && experimentHash(again.spec)).toBe(experimentHash(a.spec));
    expect(experimentHash(a.spec)).not.toBe(experimentHash(b.spec));
  });

  it("builds the /play query an arm runs under", () => {
    expect(
      armQuery({
        id: "x",
        brain: "script",
        policy: "marksman",
        control: "precision",
        navigation: "places",
        latencyMs: 250,
        stale: "observe",
      }),
    ).toBe(
      "brain=script&jevControl=precision&policy=marksman&jevNav=places&latency=250&stale=observe",
    );
  });
});

describe("paid calls are opt-in", () => {
  const arms = [
    { id: "jev", brain: "jev" as const, control: "precision" as const },
    { id: "llm", brain: "llm" as const, control: "precision" as const },
    { id: "fake", brain: "llm" as const, control: "precision" as const, fakeLlm: true },
    { id: "r", brain: "random" as const, control: "precision" as const },
  ];

  it("refuses Jev and LLM arms without their flags, as ordinary CI runs", () => {
    const errors = liveGate(arms, {});
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/JEV_LIVE_TEST=1/);
    expect(errors[1]).toMatch(/LLM_LIVE_TEST=1/);
  });

  it("requires exactly the value 1", () => {
    expect(liveGate(arms, { JEV_LIVE_TEST: "true", LLM_LIVE_TEST: "yes" })).toHaveLength(
      2,
    );
    expect(liveGate(arms, { JEV_LIVE_TEST: "1", LLM_LIVE_TEST: "1" })).toHaveLength(0);
  });

  it("lets the offline test double run without a flag", () => {
    expect(liveGate([arms[2]!], {})).toEqual([]);
  });

  it("gates Glide on its own flag, not Jev's", () => {
    const glide = [{ id: "g", brain: "glide" as const, control: "precision" as const }];
    expect(liveGate(glide, { JEV_LIVE_TEST: "1" })).toEqual([
      "arm g calls a paid glide API; set FASTINO_LIVE_TEST=1 to confirm",
    ]);
    expect(liveGate(glide, { FASTINO_LIVE_TEST: "1" })).toEqual([]);
  });

  it("never injects latency into Glide: its latency is real", () => {
    const parsed = parseExperiment({
      ...valid,
      arms: [{ id: "g", brain: "glide", control: "precision", latencyMs: 250 }],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join(" ")).toMatch(/latency is real/);
  });
});

describe("the committed experiment files", () => {
  const dir = join(ROOT, "tools", "experiments");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    it(`${file} is a valid declared experiment`, () => {
      const parsed = parseExperiment(JSON.parse(readFileSync(join(dir, file), "utf8")));
      expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    });
  }
});
