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
  question: string;
  hypothesis: string;
  competing: string;
}

/**
 * One scripted demonstration per protocol. The thresholds are the script's
 * choices, not a model's, each at or above the host's minimum effect for its
 * metric (FLY_METRICS). They were not sized from pilots: that, with the
 * protocol redesigns, is later work, and pilots must run on seeds that are
 * then discarded. Some of these designs cannot discriminate as designed; each
 * protocol's caveat (FLY_PROTOCOLS) says which and why.
 */
const EXAMPLES: Record<FlyProtocolId, Example> = {
  obstacle_avoidance: {
    treatment: { kind: "obstacle_avoidance", avoid_ttc_s: 0.45 },
    // Cruise only: the avoidance rule does not act during a landing approach.
    metric: "cruise_collision_episodes_per_m",
    direction: "decrease",
    minimumEffect: 0.1,
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
      approach_speed_m_s: 1,
      control: "receding",
    },
    metric: "escape_probability",
    direction: "increase",
    minimumEffect: 0.3,
    question:
      "[scripted] Does an approaching sphere make the simulated fly escape where the same sphere receding does not?",
    hypothesis:
      "[scripted] A sphere approaching at 1 m/s raises the escape probability over the same sphere receding along the same line.",
    competing:
      "[scripted] Any moving object in view triggers the escape proxy, approaching or not.",
  },
  noisy_sensing: {
    treatment: { kind: "noisy_sensing", noise: 0.4 },
    metric: "collision_episodes_per_m",
    direction: "increase",
    minimumEffect: 0.05,
    question:
      "[scripted] Does sensory noise make the simulated fly collide more often in clutter?",
    hypothesis:
      "[scripted] Relative sensory noise of 0.4 raises collision episodes per metre flown.",
    competing:
      "[scripted] Noise on distance estimates averages out over a fan of rays and leaves the collision rate unchanged.",
  },
  adaptation: {
    treatment: { kind: "adaptation", isi_s: 4 },
    metric: "late_escape_probability",
    direction: "decrease",
    minimumEffect: 0.2,
    question:
      "[scripted] Does the simulated fly's escape response habituate when the looming stimulus repeats quickly?",
    hypothesis:
      "[scripted] Repeating the stimulus every 4 s lowers the escape probability over the later presentations, compared with every 120 s.",
    competing:
      "[scripted] The stimulus stays above the escape threshold however often it repeats.",
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
      seed_count: overrides.seedCount ?? 12,
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
