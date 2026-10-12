import {
  CIVILIZATION_DESIGN,
  type CivilizationDesign,
  type CivilizationTreatment,
  type CivilizationMetricId,
} from "./contracts.js";

/** Host demonstration designs, explicitly scripted; never labelled a model proposal. */
export function civilizationExample(
  overrides: {
    treatment?: CivilizationTreatment;
    metric?: CivilizationMetricId;
    direction?: "increase" | "decrease";
    minimumEffect?: number;
    seeds?: number[];
    turns?: number;
  } = {},
): CivilizationDesign {
  const seeds = overrides.seeds ?? [1, 2, 3, 4, 5, 6];
  return {
    schema: CIVILIZATION_DESIGN,
    question:
      "[scripted] Do remembered grievances drive cycles of war among the simulated Mediterranean powers?",
    hypothesis:
      "[scripted] Withholding agents' memory of how others treated them reduces the number of wars declared.",
    competing_hypothesis:
      "[scripted] Memory does not change how often the simulated powers go to war.",
    parameters: {
      scenario: "mediterranean-264bc",
      seeds,
      turns: overrides.turns ?? 40,
      treatment: overrides.treatment ?? { kind: "withhold_memory" },
    },
    analysis: {
      method: "matched_seed_paired_delta",
      metric: overrides.metric ?? "wars_declared",
      expected_direction: overrides.direction ?? "decrease",
      minimum_effect: overrides.minimumEffect ?? 1,
      minimum_consistent_seeds: Math.ceil((seeds.length * 2) / 3),
    },
    budget: { max_simulated_turns: 2 * seeds.length * (overrides.turns ?? 40) },
    provenance: {
      generation: "scripted",
      decision_sha256: null,
      source_ids: [],
      parent_record_sha256: null,
    },
  };
}
