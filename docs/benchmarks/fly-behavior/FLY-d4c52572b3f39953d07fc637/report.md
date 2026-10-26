# FLY-d4c52572b3f39953d07fc637: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-01: recognizing a bodily impairment: the ECHO controller with no self-model (the reduced-order controller alone), against the full ECHO self-model under the same hidden conditions.

**Caveat.** Compensation is of abstract movement gains in the reduced-order simulator, not validated motor control; a strong impairment cannot be fully compensated within the body's 4 cm/s. Identification (the identification error) is measured apart from compensation (the path errors).

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with no self-model (the reduced-order controller alone) change mean path error of steady walking from the hidden impairment's onset to the end of the run, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with no self-model (the reduced-order controller alone) will increase impaired_path_error by at least 0.19 fraction on average over 9 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Without its self-model, the fly's walking strays further from its intended path after a hidden impairment, from held-out conditions, than with it. — competing: [scripted] The reduced-order controller's own feedback (turning back from edges, its tether) keeps its path as close to its intentions as a self-model would.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3970198273, 379089925, 2006743648, 1436834276, 780551830, 3930120552, 280423192, 1371271823, 2440839759.

## Primary metric: impaired_path_error (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3970198273 | 0.049 | 0.433 | 0.385 | expected | `c1d6bc91a82a` |
| 379089925 | 0.006 | 0.617 | 0.611 | expected | `d0a4db224332` |
| 2006743648 | 0.025 | 0.553 | 0.527 | expected | `da072ae9b829` |
| 1436834276 | 0.008 | 0.066 | 0.058 | expected | `8acf05f570a5` |
| 780551830 | 0.005 | 0.245 | 0.240 | expected | `561bb38509d4` |
| 3930120552 | 0.011 | 0.269 | 0.259 | expected | `e13328d874d6` |
| 280423192 | 0.035 | 0.630 | 0.595 | expected | `a90e081c782d` |
| 1371271823 | 0.010 | 0.304 | 0.294 | expected | `ce0599096fb3` |
| 2440839759 | 0.004 | 0.069 | 0.065 | expected | `ae56ad0fbb22` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.017, mean treatment 0.354, mean paired difference **0.337** (minimum effect 0.19 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.19: observed 0.3371 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0034-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| impaired_path_error | 0.017 | 0.354 | fraction |
| late_path_error | 0.011 | 0.356 | fraction |
| baseline_path_error | 0.013 | 0.001 | fraction |
| detection_latency_s | 1.206 | — | s |
| attribution_latency_s | 3.150 | — | s |
| identification_error | 0.013 | — | fraction |
| false_alarms_per_min | 0.000 | — | 1/min |
| impaired_walked_m | 1.388 | 1.261 | m |
| coverage_90 | 0.907 | — | fraction |

## Provenance

- Plan `d4c52572b3f39953d07fc6377bf06ecc55c90e7927c811389e5f037081d97731`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `ff9c46c2a17247b1e4327a4763992d16722b4f6ef0c5ea58c211d1ee192cf514`, source `359ee8a2b23084a3726b5b2bab6e7ee39eb27578e0956b6dd6b66e6489bf34c8`
- Preregistered as V3D-EXP-0034 at 2026-10-26T13:09:03.141Z (receipt `54034c32c08dfa3f454c289197e116f35f572b11011f7f81e990b61518340fce`)
- Authorized at 2026-10-26T13:09:03.168Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `55178b0dd2d9f7d1513a201073ebc6a57f5c02139fe8c2f6e0469f6e40710df2`
- Record `9d46a8adfe6bef88fa4b3f5545062090c20d95580138bdc256cb884e585a0b7f`, run `FR-fddadb55e004fc02cda9a1bd`, 2026-10-26T13:09:03.169Z to 2026-10-26T13:09:07.558Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2160 fly-seconds, then again for the determinism guard
- Code: commit `27af8430b03ffd5284d3609788b39b359c1aa099`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Compensation is of abstract movement gains in the reduced-order simulator, not validated motor control; a strong impairment cannot be fully compensated within the body's 4 cm/s. Identification (the identification error) is measured apart from compensation (the path errors).
- The ECHO self-model is a computational model of the fly's own sensorimotor gains, built over the reduced-order body. Its compensation acts on abstract movement gains of that body; it is not validated biological motor control, and FlyBody's physics does not run.
- The perturbations are the experimenter's models of an impairment, a push, a turning surface, a sensor fault and an obstacle, applied by the simulator. The fly is never given their labels, causes or schedule; it meets only their consequences through its self-motion sense, its touch and its legs' stepping.
- The conditions are the held-out evaluation set, in an arena the self-model was not developed in; its constants were chosen on the development set alone and frozen before evaluation.
- A measurement of prediction, attribution or retention describes a functional self-model in a simulator. It is not evidence of awareness or subjective experience.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
