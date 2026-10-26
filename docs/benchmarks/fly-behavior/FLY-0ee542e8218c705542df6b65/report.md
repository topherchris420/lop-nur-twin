# FLY-0ee542e8218c705542df6b65: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-01: recognizing a bodily impairment: the ECHO controller with no self-model (the reduced-order controller alone), against the full ECHO self-model under the same hidden conditions.

**Caveat.** Compensation is of abstract movement gains in the reduced-order simulator, not validated motor control; a strong impairment cannot be fully compensated within the body's 4 cm/s. Identification (the identification error) is measured apart from compensation (the path errors).

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with no self-model (the reduced-order controller alone) change mean path error of steady walking from the hidden impairment's onset to the end of the run, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with no self-model (the reduced-order controller alone) will increase impaired_path_error by at least 0.19 fraction on average over 9 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Without its self-model, the fly's walking strays further from its intended path after a hidden impairment, from held-out conditions, than with it. — competing: [scripted] The reduced-order controller's own feedback (turning back from edges, its tether) keeps its path as close to its intentions as a self-model would.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2339111596, 757469578, 2367635458, 3345864710, 828634440, 3822810245, 3409449922, 3294358872, 3279287960.

## Primary metric: impaired_path_error (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2339111596 | 0.014 | 0.261 | 0.247 | expected | `b814f817d267` |
| 757469578 | 0.013 | 0.254 | 0.241 | expected | `61789d80d9f3` |
| 2367635458 | 0.110 | 0.569 | 0.460 | expected | `1883f6873fad` |
| 3345864710 | 0.011 | 0.025 | 0.014 | expected | `e7583cd92490` |
| 828634440 | 0.037 | 0.456 | 0.419 | expected | `1ad126efd5b8` |
| 3822810245 | 0.014 | 0.095 | 0.081 | expected | `5f797da0d759` |
| 3409449922 | 0.080 | 0.460 | 0.380 | expected | `bf3340c4fd0c` |
| 3294358872 | 0.059 | 0.567 | 0.508 | expected | `24b1fb26a233` |
| 3279287960 | 0.005 | 0.086 | 0.081 | expected | `bc92057adf58` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.038, mean treatment 0.308, mean paired difference **0.270** (minimum effect 0.19 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.19: observed 0.2700 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0025-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| impaired_path_error | 0.038 | 0.308 | fraction |
| late_path_error | 0.045 | 0.309 | fraction |
| baseline_path_error | 0.016 | 0.001 | fraction |
| detection_latency_s | 1.206 | — | s |
| attribution_latency_s | 3.383 | — | s |
| identification_error | 0.007 | — | fraction |
| false_alarms_per_min | 0.000 | — | 1/min |
| impaired_walked_m | 1.346 | 1.073 | m |
| coverage_90 | 0.906 | — | fraction |

## Provenance

- Plan `0ee542e8218c705542df6b65ad521b12bc39610f2c71dc55c131cdb1ef49bca7`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `44a4d99fc81cf563bb4ff40377cff7d1ae9881d95c6cf3b17851e5804539805d`, source `b794ba087d2c9dbb0d589758d6d2e0a89d958b3f2b626d50ab3388266513a682`
- Preregistered as V3D-EXP-0025 at 2026-10-26T05:48:55.005Z (receipt `7b79bd12b3bc9e00543d9b994b14f31be6fab9aefc83222b34b9cd9a5b01a3ed`)
- Authorized at 2026-10-26T05:48:55.105Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `0ef377cc14fdd04de2d5e12f01403d6f9e1fb840cf1d0a408e4a2b95f020350a`
- Record `b0df0c3a0e5c34031953a39d615bf48468c01098e72991cc61b9e97f376434a7`, run `FR-324a30bad784cd62e985604b`, 2026-10-26T05:48:55.107Z to 2026-10-26T05:49:14.479Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2160 fly-seconds, then again for the determinism guard
- Code: commit `6ea1990ebc33011e02ad26083bebb719dc837d1b`
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
