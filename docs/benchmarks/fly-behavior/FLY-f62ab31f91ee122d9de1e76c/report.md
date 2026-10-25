# FLY-f62ab31f91ee122d9de1e76c: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-01: recognizing a bodily impairment: the ECHO controller with no self-model (the reduced-order controller alone), against the full ECHO self-model under the same hidden conditions.

**Caveat.** Compensation is of abstract movement gains in the reduced-order simulator, not validated motor control; a strong impairment cannot be fully compensated within the body's 4 cm/s. Identification (the identification error) is measured apart from compensation (the path errors).

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with no self-model (the reduced-order controller alone) change mean path error of steady walking from the hidden impairment's onset to the end of the run, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with no self-model (the reduced-order controller alone) will increase impaired_path_error by at least 0.19 fraction on average over 9 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Without its self-model, the fly's walking strays further from its intended path after a hidden impairment, from held-out conditions, than with it. — competing: [scripted] The reduced-order controller's own feedback (turning back from edges, its tether) keeps its path as close to its intentions as a self-model would.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 4070689876, 2500416460, 3250167124, 3985361544, 2423867114, 959326030, 2868179429, 1608955149, 238167919.

## Primary metric: impaired_path_error (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 4070689876 | 0.014 | 0.307 | 0.293 | expected | `f48650fca04b` |
| 2500416460 | 0.015 | 0.029 | 0.014 | expected | `3d309939cc4d` |
| 3250167124 | 0.160 | 0.479 | 0.319 | expected | `086385ed8c7e` |
| 3985361544 | 0.052 | 0.568 | 0.517 | expected | `344345d68f6a` |
| 2423867114 | 0.029 | 0.342 | 0.314 | expected | `7e4bfa97df5f` |
| 959326030 | 0.011 | 0.504 | 0.494 | expected | `603d7d490d07` |
| 2868179429 | 0.007 | 0.272 | 0.265 | expected | `0300c8163e14` |
| 1608955149 | 0.035 | 0.504 | 0.469 | expected | `cc899b4e9f2a` |
| 238167919 | 0.007 | 0.583 | 0.576 | expected | `0cb69e7fc336` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.036, mean treatment 0.399, mean paired difference **0.362** (minimum effect 0.19 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.19: observed 0.3623 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0007-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| impaired_path_error | 0.036 | 0.399 | fraction |
| late_path_error | 0.035 | 0.400 | fraction |
| baseline_path_error | 0.014 | 0.002 | fraction |
| detection_latency_s | 3.144 | — | s |
| attribution_latency_s | 4.811 | — | s |
| identification_error | 0.007 | — | fraction |
| false_alarms_per_min | 0.000 | — | 1/min |
| impaired_walked_m | 1.178 | 0.950 | m |
| coverage_90 | 0.905 | — | fraction |

## Provenance

- Plan `f62ab31f91ee122d9de1e76c877f9f2ee2a84f4ce60af4bf2c6c35c7b22982e7`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `8fa862d0a358e1d8f3c36ea20bcc47f293ef42c1413ff1db2c9a6ebf3f086911`, source `e838b010f63674a8e7c6364631eff58473fbb0ef96fbd5d0e69b399a4303c485`
- Preregistered as V3D-EXP-0007 at 2026-10-25T19:50:33.444Z (receipt `4b87408bafe98d2a847a7479b19175befd1af1733bf8ff22a172b8dd14ff80ad`)
- Authorized at 2026-10-25T19:50:33.461Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `ce14cfe8c3bf05c5ab7bb72a4413464a53009c354900fc25f4c6ab74118234c7`
- Record `9361d3653cd1836c93146e9e574b1add553e0e7f72287528e8baa075525b3be6`, run `FR-8ac8c49ef172b3ad1c33ad61`, 2026-10-25T19:50:33.464Z to 2026-10-25T19:50:38.524Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2160 fly-seconds, then again for the determinism guard
- Code: commit `10ac28871a37a973b6f6907be886fb9ea2a328ca`
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
