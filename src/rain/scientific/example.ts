import { NUMERICAL_DESIGN, type NumericalDesign } from "./contracts.js";
/** Original host demonstration, explicitly scripted; never labelled a Qwen proposal. */
export function oscillatorExample(): NumericalDesign {
  return {
    schema: NUMERICAL_DESIGN,
    question:
      "Does periodic driving increase displacement against an otherwise matched free oscillator?",
    hypothesis: "Periodic driving increases RMS displacement.",
    competing_hypothesis:
      "Periodic driving does not increase RMS displacement over this window.",
    parameters: {
      mass: { value: 1, unit: "kg" },
      damping: { value: 0.4, unit: "kg/s" },
      stiffness: { value: 4, unit: "N/m" },
      force_amplitude: { value: 1, unit: "N" },
      angular_frequency: { value: 1.8, unit: "rad/s" },
      initial_displacement: { value: 0, unit: "m" },
      initial_velocity: { value: 0, unit: "m/s" },
      duration: { value: 10, unit: "s" },
      timestep: { value: 0.01, unit: "s" },
      sample_every_steps: 10,
    },
    analysis: {
      method: "matched_rms_displacement",
      expected_direction: "increase",
      minimum_effect_m: 0.01,
      max_reference_error_m: 0.000001,
      max_reference_velocity_error_m_per_s: 0.000001,
    },
    budget: { max_steps: 2000, max_samples: 1001 },
    provenance: {
      generation: "scripted",
      decision_sha256: null,
      source_ids: [],
      parent_record_sha256: null,
    },
  };
}
