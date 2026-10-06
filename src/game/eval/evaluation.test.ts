import { describe, expect, it } from "vitest";
import {
  buildEvaluation,
  validateEvaluation,
  EVALUATION_SCHEMA,
  type ArmRun,
  type BuildInput,
} from "./evaluation";
import {
  experimentHash,
  parseExperiment,
  EXPERIMENT_SCHEMA,
  type ExperimentSpec,
} from "./experimentSpec";
import { episodesCsv, renderText } from "./report";
import { episode, legal, outcome, record } from "./testing/fixtures";

function spec(overrides: Record<string, unknown> = {}): ExperimentSpec {
  const parsed = parseExperiment({
    schema: EXPERIMENT_SCHEMA,
    id: "synthetic-cover",
    question: "Does the synthetic chooser pick hidden places?",
    hypothesis: "Synthetic data, for testing the evaluator only.",
    independentVariable: "brain",
    primaryMetric: "success_rate",
    secondaryMetrics: ["exposure_fraction_next_window"],
    decisionType: "cover-selection/v1",
    seeds: [42, 43, 44],
    duration: 60,
    arms: [
      { id: "jev", brain: "jev", control: "precision", navigation: "places" },
      { id: "random", brain: "random", control: "precision", navigation: "places" },
    ],
    ...overrides,
  });
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.spec;
}

/** A synthetic place choice with a stated probability and a chosen outcome. */
function choice(p: number | null, hidden: boolean) {
  return record({
    source: p === null ? "random" : "jev",
    legal: legal({ places: 3 }),
    frame: { go: "PLACE_1" },
    confidence:
      p === null
        ? { source: "none", perAxis: {} }
        : {
            source: "provider-probability",
            perAxis: { go: { probability: p, confidence: p } },
          },
    execution: {
      actionStart: 0,
      actionEnd: 0.4,
      endReason: "replaced",
      targetBound: null,
      placeBound: true,
      placeKind: "cover",
    },
    outcome: outcome({ exposedSamples: hidden ? 0 : 15 }),
  });
}

function armRun(id: string, brain: "jev" | "random", withP: boolean): ArmRun {
  const s = spec();
  return {
    arm: s.arms.find((a) => a.id === id)!,
    query: `brain=${brain}`,
    origin: "http://localhost:5173",
    build: "synthetic",
    pending: null,
    episodes: [42, 43, 44].map((seed) =>
      episode(
        seed,
        Array.from({ length: 20 }, (_, i) =>
          choice(withP ? 0.55 + (i % 5) * 0.1 : null, i % 5 >= 2),
        ),
      ),
    ),
  };
}

function input(arms: ArmRun[], s = spec()): BuildInput {
  return {
    spec: s,
    specHash: experimentHash(s),
    definitionPath: "tools/experiments/synthetic.json",
    arms,
    pricing: null,
    environment: { gitCommit: "synthetic", gitDirty: false },
    provenance: { runId: "synthetic" },
    generatedAt: "2026-09-29T00:00:00.000Z",
  };
}

describe("blacksite-evaluation/v1", () => {
  const built = buildEvaluation(
    input([armRun("jev", "jev", true), armRun("random", "random", false)]),
  );

  it("validates against its own schema check", () => {
    expect(built.schema).toBe(EVALUATION_SCHEMA);
    expect(validateEvaluation(JSON.parse(JSON.stringify(built))).ok).toBe(true);
    expect(validateEvaluation({ schema: "other" }).ok).toBe(false);
    expect(validateEvaluation({ ...built, arms: [{ id: "x" }] }).ok).toBe(false);
  });

  it("is deterministic for the same inputs", () => {
    const again = buildEvaluation(
      input([armRun("jev", "jev", true), armRun("random", "random", false)]),
    );
    expect(JSON.stringify(again)).toBe(JSON.stringify(built));
  });

  it("keeps every episode, its seed, run id and artifacts", () => {
    const arm = built.arms[0]!;
    expect(arm.episodes.map((e) => e.seed)).toEqual([42, 43, 44]);
    expect(arm.episodes[0]!.artifacts.report).toBe("synthetic/42.json");
    expect(built.experiment.definitionHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("scores decisions under the declared contract", () => {
    const dm = built.arms[0]!.decisionMetrics!;
    expect(dm.contract).toBe("cover-selection/v1");
    expect(dm.matched).toBe(60);
    // 3 of every 5 synthetic choices were hidden.
    expect(dm.successRate).toBeCloseTo(0.6, 10);
    expect(dm.successInterval).not.toBeNull();
  });

  it("calibrates a brain that states probabilities, and refuses to for one that does not", () => {
    const jev = built.arms[0]!.calibration;
    expect(jev.available).toBe(true);
    if (jev.available) {
      expect(jev.source).toBe("provider-probability");
      expect(jev.axis).toBe("go");
      expect(jev.n).toBe(60);
      expect(jev.brier).not.toBeNull();
    }
    const random = built.arms[1]!.calibration;
    expect(random.available).toBe(false);
    if (!random.available) expect(random.reason).toMatch(/states no probability/);
  });

  it("pairs arms by seed against the reference arm", () => {
    const primary = built.comparisons.filter((c) => c.metric === "success_rate");
    expect(primary).toHaveLength(1);
    expect(primary[0]!.reference).toBe("jev");
    expect(primary[0]!.difference.n).toBe(3);
  });

  it("marks an unrun live arm pending and never fills its numbers", () => {
    const pending: ArmRun = {
      ...armRun("jev", "jev", true),
      episodes: [],
      pending: "JEV_LIVE_TEST is not set",
    };
    const e = buildEvaluation(input([pending, armRun("random", "random", false)]));
    expect(e.status).toBe("partial");
    expect(e.arms[0]!.status).toBe("pending");
    expect(e.arms[0]!.aggregate["success_rate"]!.n).toBe(0);
    expect(e.arms[0]!.aggregate["success_rate"]!.mean).toBeNull();
    const text = renderText(e);
    expect(text).toContain("PENDING — JEV_LIVE_TEST is not set");
    expect(e.notes.join(" ")).toMatch(/No figure for it is a measurement/);
  });

  it("renders the report and a per-episode CSV from the file alone", () => {
    const text = renderText(built);
    expect(text).toContain("BLACKSITE EVALUATION");
    expect(text).toContain("jev calibration — provider-probability");
    expect(text).toContain("random calibration: not available");
    const csv = episodesCsv(built).trim().split("\n");
    expect(csv).toHaveLength(1 + 6);
    expect(csv[0]).toContain("success_rate");
  });

  it("contrasts a script with random although the script also has a policy", () => {
    const s = spec({
      contributionFactors: ["brain", "control"],
      arms: [
        {
          id: "script-precision",
          brain: "script",
          policy: "marksman",
          control: "precision",
        },
        { id: "random-precision", brain: "random", control: "precision" },
        { id: "script-direct", brain: "script", policy: "marksman", control: "direct" },
        { id: "random-direct", brain: "random", control: "direct" },
      ],
    });
    const runs: ArmRun[] = s.arms.map((arm) => ({
      arm,
      query: "",
      origin: "",
      build: null,
      pending: null,
      episodes: [42, 43, 44].map((seed) => episode(seed, [choice(null, true)])),
    }));
    const e = buildEvaluation(input(runs, s));
    expect(e.contribution!.contrasts).toHaveLength(4);
    expect(e.contribution!.interactions).toHaveLength(1);
  });

  it("reads a latency sweep as a slope with an interval, not a verdict", () => {
    const s = spec({
      independentVariable: "latency",
      arms: [{ id: "script", brain: "script", policy: "marksman", control: "precision" }],
      sweep: { param: "latencyMs", values: [0, 500, 1000] },
    });
    const runs: ArmRun[] = s.arms.map((arm, k) => ({
      arm,
      query: "",
      origin: "",
      build: null,
      pending: null,
      episodes: [42, 43, 44].map((seed) =>
        episode(
          seed,
          Array.from({ length: 10 }, (_, i) => choice(null, i < 8 - 3 * k + (seed % 2))),
        ),
      ),
    }));
    const e = buildEvaluation(input(runs, s));
    expect(e.sweeps).toHaveLength(1);
    const sweep = e.sweeps[0]!;
    expect(sweep.points.map((p) => p.value)).toEqual([0, 500, 1000]);
    expect(sweep.slopePer100ms!.estimate).toBeLessThan(0);
    expect(sweep.reading).toMatch(/per 100 ms|No detectable/);
  });
});

describe("a contract that splits its decisions", () => {
  const inView = {
    legal: legal({ enemies: 1 }),
    context: { ...record().context, visibleEnemies: 1 },
  };
  const fight = (dealt: number, taken: number) =>
    record({
      ...inView,
      frame: { weapon: "FIRE", target: "TARGET_0" },
      outcome: outcome({ damageDealt: dealt, damageTaken: taken }),
    });
  const breakOff = (taken: number) =>
    record({
      ...inView,
      frame: { weapon: "NO_FIRE" },
      outcome: outcome({ damageTaken: taken }),
    });
  const evaluated = (decisionType: string) => {
    const s = spec({ decisionType });
    const run: ArmRun = {
      arm: s.arms[0]!,
      query: "brain=jev",
      origin: "http://localhost:5173",
      build: "synthetic",
      pending: null,
      episodes: [episode(42, [fight(50, 10), fight(0, 30), breakOff(0), breakOff(30)])],
    };
    return buildEvaluation(input([run], s));
  };

  it("is reported per side as well as pooled", () => {
    const built = evaluated("engage-disengage/v2");
    const dm = built.arms[0]!.decisionMetrics!;
    expect(dm.classes).toEqual({ beneficial: 2, neutral: 1, harmful: 1 });
    expect(dm.bySide).toEqual({
      DISENGAGE: { n: 2, successRate: 0.5, harmfulRate: 0.5 },
      ENGAGE: { n: 2, successRate: 0.5, harmfulRate: 0 },
    });
    expect(renderText(built)).toContain(
      "jev by side — DISENGAGE success 50.0%, harm 50.0% (n=2) · ENGAGE success 50.0%, harm 0.0% (n=2)",
    );
  });

  it("counts each event once over windows that share no time", () => {
    const s = spec({ decisionType: "engage-disengage/v2" });
    // Windows [0,5) [1,6) [5,10) [10,15): the second shares time with the first and
    // third, so the windows that share none are the first, third and fourth.
    const timed = (start: number, r: ReturnType<typeof fight>) => ({
      ...r,
      execution: { ...r.execution, actionStart: start },
    });
    const run: ArmRun = {
      arm: s.arms[0]!,
      query: "brain=jev",
      origin: "http://localhost:5173",
      build: "synthetic",
      pending: null,
      episodes: [
        episode(42, [
          timed(0, fight(50, 10)),
          timed(1, fight(0, 30)),
          timed(5, breakOff(30)),
          timed(10, breakOff(0)),
        ]),
      ],
    };
    const dm = buildEvaluation(input([run], s)).arms[0]!.decisionMetrics!;
    expect(dm.scored).toBe(4);
    expect(dm.disjoint).toMatchObject({ n: 3, harmfulRate: 1 / 3 });
    expect(dm.disjoint!.successRate).toBeCloseTo(2 / 3, 10);
  });

  it("is not invented for a contract without sides", () => {
    const dm = evaluated("engage-disengage/v1").arms[0]!.decisionMetrics!;
    expect(dm.bySide).toBeNull();
    // v1 scores the clean break-off by the fight it did not have.
    expect(dm.classes).toEqual({ beneficial: 1, neutral: 3, harmful: 0 });
  });
});
