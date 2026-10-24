import {
  FLY_DESIGN,
  type FlyDesign,
  type FlyMetricId,
  type FlyProtocolId,
  type FlyTreatment,
} from "./contracts.js";

interface Example {
  treatment: FlyTreatment;
  metric: FlyMetricId;
  direction: "increase" | "decrease";
  minimumEffect: number;
  seedCount: number;
  question: string;
  hypothesis: string;
  competing: string;
}

/**
 * One scripted demonstration per protocol. The treatment, metric and
 * direction are the script's choices, not a model's. For the four redesigned
 * protocols the minimum effect and the seed count are the pilot's
 * (docs/benchmarks/fly-pilots/<protocol>.json, `sized`): the seed count is
 * the smallest that passes G3, G4 and the sign test with margin under the
 * pilot's outcomes, and the minimum effect the pilot's mean paired difference
 * less 1.645 standard errors at that seed count, rounded down (or the host's
 * minimum effect for the metric, if larger). Pilots run on
 * the public pilot seeds, which the host never draws for an archived run, and
 * fly.test.ts checks these numbers against the pilot files. Light preference
 * and controller comparison were not redesigned; their thresholds are still
 * the script's, at or above the host's minimum effect for the metric.
 */
const EXAMPLES: Record<FlyProtocolId, Example> = {
  obstacle_avoidance: {
    treatment: { kind: "obstacle_avoidance", avoid_ttc_s: 0.45 },
    // Cruise only: the avoidance rule does not act during a landing approach.
    metric: "cruise_collision_episodes_per_m",
    direction: "decrease",
    minimumEffect: 0.12, // PILOT-SIZED: docs/benchmarks/fly-pilots/obstacle_avoidance.json
    seedCount: 10, // PILOT-SIZED: docs/benchmarks/fly-pilots/obstacle_avoidance.json
    question:
      "[scripted] Does the simulated fly's time-to-contact avoidance rule reduce collisions in pillar clutter?",
    hypothesis:
      "[scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown.",
    competing:
      "[scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.",
  },
  light_preference: {
    treatment: { kind: "light_preference", light_intensity: 2 },
    metric: "mean_light_distance_m",
    direction: "decrease",
    minimumEffect: 0.1,
    seedCount: 12,
    question:
      "[scripted] Does a point light draw the simulated fly toward the quadrant below it?",
    hypothesis:
      "[scripted] With a point light on, the fly's mean horizontal distance to the point below it falls.",
    competing:
      "[scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.",
  },
  visual_threat: {
    treatment: {
      kind: "visual_threat",
      control_l_over_v_ms: 160,
      treatment_l_over_v_ms: 40,
    },
    metric: "escape_ttc_s",
    direction: "decrease",
    minimumEffect: 0.28, // PILOT-SIZED: docs/benchmarks/fly-pilots/visual_threat.json
    seedCount: 9, // PILOT-SIZED: docs/benchmarks/fly-pilots/visual_threat.json
    question:
      "[scripted] Does a faster looming approach (smaller l/v) make the simulated fly escape later, closer to collision?",
    hypothesis:
      "[scripted] At l/v = 40 ms the fly escapes with less time to collision than at l/v = 160 ms, as an angular-size threshold predicts.",
    competing:
      "[scripted] The escape proxy fires at a fixed time before collision whatever the approach speed.",
  },
  noisy_sensing: {
    treatment: { kind: "noisy_sensing", noise: 0.4 },
    metric: "escape_ttc_s",
    direction: "increase",
    minimumEffect: 0.24, // PILOT-SIZED: docs/benchmarks/fly-pilots/noisy_sensing.json
    seedCount: 9, // PILOT-SIZED: docs/benchmarks/fly-pilots/noisy_sensing.json
    question:
      "[scripted] Does sensory noise change when the simulated fly escapes from a looming stimulus?",
    hypothesis:
      "[scripted] Sensory noise of 0.4 makes the fly escape earlier in the approach, with more time to collision: noisy size and expansion estimates cross the escape threshold early.",
    competing:
      "[scripted] Noise averages out over the approach and leaves the time to collision at the escape unchanged.",
  },
  adaptation: {
    treatment: { kind: "adaptation", isi_s: 10 },
    metric: "repeat_escape_probability",
    direction: "decrease",
    minimumEffect: 0.13, // PILOT-SIZED: docs/benchmarks/fly-pilots/adaptation.json
    seedCount: 13, // PILOT-SIZED: docs/benchmarks/fly-pilots/adaptation.json
    question:
      "[scripted] Does the simulated fly's escape response habituate when the looming stimulus repeats every 10 s on a fixed schedule?",
    hypothesis:
      "[scripted] Repeating the stimuli every 10 s lowers the fraction answered by an escape, compared with the same stimuli every 90 s.",
    competing:
      "[scripted] Responsiveness recovers within 10 s, so the interval leaves the escape probability unchanged.",
  },
  controller_comparison: {
    treatment: {
      kind: "controller_comparison",
      baseline: {},
      treatment: { phototaxisGain: 1.5, avoidTtcS: 0.3 },
    },
    metric: "mean_light_distance_m",
    direction: "decrease",
    minimumEffect: 0.1,
    seedCount: 12,
    question:
      "[scripted] Does a controller with stronger phototaxis and later avoidance stay closer to the light than the default?",
    hypothesis:
      "[scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light.",
    competing:
      "[scripted] Steering gain matters less than how often the fly flies, which both configurations share.",
  },
};

/**
 * Host demonstration designs, explicitly scripted: never labelled a model
 * proposal or a person's design, and run only by the demonstration script.
 */
export function flyExample(
  protocol: FlyProtocolId,
  overrides: {
    treatment?: FlyTreatment;
    metric?: FlyMetricId;
    direction?: "increase" | "decrease";
    minimumEffect?: number;
    seedCount?: number;
    maxSimulatedSeconds?: number;
  } = {},
): FlyDesign {
  const e = EXAMPLES[protocol];
  return {
    schema: FLY_DESIGN,
    question: e.question,
    hypothesis: e.hypothesis,
    competing_hypothesis: e.competing,
    // How many seeds, never which: the host draws them after preregistration.
    parameters: {
      seed_count: overrides.seedCount ?? e.seedCount,
      treatment: structuredClone(overrides.treatment ?? e.treatment),
    },
    analysis: {
      method: "matched_seed_sign_test",
      metric: overrides.metric ?? e.metric,
      expected_direction: overrides.direction ?? e.direction,
      minimum_effect: overrides.minimumEffect ?? e.minimumEffect,
    },
    budget: { max_simulated_seconds: overrides.maxSimulatedSeconds ?? 16000 },
    provenance: {
      generation: "scripted",
      decision_sha256: null,
      source_ids: [],
      parent_record_sha256: null,
    },
  };
}
