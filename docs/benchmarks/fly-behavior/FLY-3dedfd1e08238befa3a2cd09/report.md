# FLY-3dedfd1e08238befa3a2cd09: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-01: recognizing a bodily impairment: the ECHO controller with no self-model (the reduced-order controller alone), against the full ECHO self-model under the same hidden conditions.

**Caveat.** Compensation is of abstract movement gains in the reduced-order simulator, not validated motor control; a strong impairment cannot be fully compensated within the body's 4 cm/s. Identification (the identification error) is measured apart from compensation (the path errors).

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with no self-model (the reduced-order controller alone) change mean path error of steady walking from the hidden impairment's onset to the end of the run, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with no self-model (the reduced-order controller alone) will increase impaired_path_error by at least 0.19 fraction on average over 9 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Without its self-model, the fly's walking strays further from its intended path after a hidden impairment, from held-out conditions, than with it. — competing: [scripted] The reduced-order controller's own feedback (turning back from edges, its tether) keeps its path as close to its intentions as a self-model would.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2403134820, 2121783305, 3984351416, 2944668238, 567608652, 1140565683, 2915547318, 3694735735, 251666926.

## Primary metric: impaired_path_error (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2403134820 | 0.309 | 0.542 | 0.233 | expected | `55e9c488032f` |
| 2121783305 | 0.149 | 0.426 | 0.277 | expected | `7b015ce1ce21` |
| 3984351416 | 0.009 | 0.036 | 0.027 | expected | `d400e3793a8e` |
| 2944668238 | 0.007 | 0.533 | 0.526 | expected | `a019c718f4b6` |
| 567608652 | 0.092 | 0.573 | 0.481 | expected | `e0f47045f23b` |
| 1140565683 | 0.014 | 0.077 | 0.063 | expected | `4456866ff4e9` |
| 2915547318 | 0.008 | 0.206 | 0.198 | expected | `1479d54744a7` |
| 3694735735 | 0.023 | 0.323 | 0.300 | expected | `833855b2f57a` |
| 251666926 | 0.049 | 0.616 | 0.567 | expected | `52905e43732b` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.073, mean treatment 0.370, mean paired difference **0.297** (minimum effect 0.19 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.19: observed 0.2968 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0061-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| impaired_path_error | 0.073 | 0.370 | fraction |
| late_path_error | 0.073 | 0.370 | fraction |
| baseline_path_error | 0.013 | 0.001 | fraction |
| detection_latency_s | 1.328 | — | s |
| attribution_latency_s | 5.189 | — | s |
| identification_error | 0.012 | — | fraction |
| false_alarms_per_min | 0.000 | — | 1/min |
| impaired_walked_m | 1.322 | 1.129 | m |
| coverage_90 | 0.905 | — | fraction |

## Provenance

- Plan `3dedfd1e08238befa3a2cd0967c1d8e9f291fffa278109afaad0b4cb651ca276`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `c684a7f0002390bee7e62d529bc459479c35e45465749ad174bd99aca71a5f8a`, source `a96a496c4c00acead32e208158faf7889c31027b8dccde781059a4eb4481f70b`
- Preregistered as V3D-EXP-0061 at 2026-10-27T04:15:46.041Z (receipt `bf4954fa3ae0c33a89e1014f3173a74be52ee6a271c4a350a7ca291e9891bca8`)
- Authorized at 2026-10-27T04:15:46.172Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `8730e5e6e3818a01e8859b3000659fcbbb8904d23da294a49333c02e874da00d`
- Record `506e939f8c036df90ee413ced289e2c73cd1750e23a444d3fb98cad67b596a4c`, run `FR-053afd4ca05528fee582ba29`, 2026-10-27T04:15:46.177Z to 2026-10-27T04:16:05.366Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2160 fly-seconds, then again for the determinism guard
- Code: commit `352fafda07d29c0d7f4f412073dc129fc5ac7a63`
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
