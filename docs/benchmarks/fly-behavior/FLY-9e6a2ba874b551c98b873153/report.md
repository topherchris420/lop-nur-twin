# FLY-9e6a2ba874b551c98b873153: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-03: learning retained through time: the full ECHO self-model reset to an innate one 5 s before a remembered change returns, against the full ECHO self-model with its memory intact, on the same schedule.

**Caveat.** Retained learning is measured, not identity: a reset self-model in the same body is still the same simulated fly, and a restored checkpoint is the self-model alone (docs/PROJECT_ECHO.md).

**Question (host-written).** In the digital fly simulator, how does the full ECHO self-model reset to an innate one 5 s before a remembered change returns change time from that return to the fly's concluding that it changed itself (undefined without one), against the full ECHO self-model with its memory intact, on the same schedule on matched seeds?

**Hypothesis (host-written).** The full ECHO self-model reset to an innate one 5 s before a remembered change returns will increase reexposure_latency_s by at least 4 s on average over 16 matched seeds drawn after preregistration, compared with the full ECHO self-model with its memory intact, on the same schedule, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] A self-model reset to an innate one before a remembered held-out impairment returns takes longer to conclude that it changed itself than one with its memory intact. — competing: [scripted] Learning an impairment from scratch is as fast as recognizing it, so memory does not shorten the time to conclude.

## Seeds

16 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2921541048, 1664940972, 502386678, 1198988295, 1373715283, 3841567238, 1818435834, 2602242721, 1199489419, 333415810, 922197195, 3621089908, 3587243242, 3601874719, 3364530891, 3164223748.

## Primary metric: reexposure_latency_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2921541048 | 2.350 | 2.350 | 0.000 | tie | `c72788fe432e` |
| 1664940972 | 2.300 | 2.300 | 0.000 | tie | `3138bdbc9dea` |
| 502386678 | 2.150 | 3.450 | 1.300 | expected | `e529f3ae9d37` |
| 1198988295 | 2.100 | 2.100 | 0.000 | tie | `b700479c7935` |
| 1373715283 | 1.850 | 1.850 | 0.000 | tie | `0cc09fd1805d` |
| 3841567238 | 1.800 | 2.100 | 0.300 | expected | `02c4066b357f` |
| 1818435834 | 1.700 | 2.500 | 0.800 | expected | `9c09c4323f57` |
| 2602242721 | 2.200 | 2.200 | 0.000 | tie | `39e1095a50e4` |
| 1199489419 | 2.550 | 3.200 | 0.650 | expected | `52397b3d1cee` |
| 333415810 | 2.200 | 2.400 | 0.200 | expected | `f4b9e82585b7` |
| 922197195 | 5.350 | 6.350 | 1.000 | expected | `0de590fc610d` |
| 3621089908 | 2.900 | 2.200 | -0.700 | opposite | `2541c3f03c69` |
| 3587243242 | 1.850 | 3.900 | 2.050 | expected | `eceb86129345` |
| 3601874719 | 2.250 | 2.250 | 0.000 | tie | `26dcd458bdc6` |
| 3364530891 | 1.900 | 2.050 | 0.150 | expected | `efcf5e7f18c6` |
| 3164223748 | 5.250 | 6.050 | 0.800 | expected | `ac3ee9f96af8` |

9 of 10 untied seeds in the expected direction (increase), 1 opposite, 6 tied, 0 undefined. Exact one-sided sign test: p = 0.0107 for the expected direction, p = 0.9990 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 2.544, mean treatment 2.953, mean paired difference **0.409** (minimum effect 4 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 32: observed 32.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 10.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 4: observed 0.4094 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0107 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9990 — does not hold

Success criteria not all met (S1) and no failure criterion triggered.

Registry run `V3D-EXP-0054-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| reexposure_path_error | 0.062 | 0.060 | fraction |
| reexposure_latency_s | 2.544 | 2.953 | s |
| first_exposure_path_error | 0.098 | 0.098 | fraction |
| first_exposure_latency_s | 2.994 | 2.994 | s |
| unfamiliar_path_error | 0.165 | 0.185 | fraction |
| recalls | 1.000 | 0.063 | count |
| false_recalls | 0.063 | 0.063 | count |

## Provenance

- Plan `9e6a2ba874b551c98b8731538d6eb48d9e17b7748f5c86b38a3f14f2f62939d2`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `8d86753f0ca7a7395da5a6b7f3902bd120428b515dc616340ef12e9ae0489eed`, source `86708015e47c271602b7856459ea1d6ff513ea0f1df0bb8587c3f192a417f022`
- Preregistered as V3D-EXP-0054 at 2026-10-26T23:28:23.727Z (receipt `a34240b5759eaa477ab9b0b54418d901cf65f510b43cfffd8380e8b1d7eeb9fb`)
- Authorized at 2026-10-26T23:28:23.757Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `d5e1f1f8d9da7db3fa34ff43d15f7c0d0788a3bb6ce66aec49807e51dd30c048`
- Record `a2a9f308fddc603caa77266c1346c15b9aa9840eaec046ca390ea09df9508bba`, run `FR-18f6fdfce494ad15e7c91070`, 2026-10-26T23:28:23.760Z to 2026-10-26T23:28:45.680Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 7840 fly-seconds, then again for the determinism guard
- Code: commit `fb76ce5c5fc61f279bc5980bd1ea22863c0cdb8d`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Retained learning is measured, not identity: a reset self-model in the same body is still the same simulated fly, and a restored checkpoint is the self-model alone (docs/PROJECT_ECHO.md).
- The ECHO self-model is a computational model of the fly's own sensorimotor gains, built over the reduced-order body. Its compensation acts on abstract movement gains of that body; it is not validated biological motor control, and FlyBody's physics does not run.
- The perturbations are the experimenter's models of an impairment, a push, a turning surface, a sensor fault and an obstacle, applied by the simulator. The fly is never given their labels, causes or schedule; it meets only their consequences through its self-motion sense, its touch and its legs' stepping.
- The conditions are the held-out evaluation set, in an arena the self-model was not developed in; its constants were chosen on the development set alone and frozen before evaluation.
- A measurement of prediction, attribution or retention describes a functional self-model in a simulator. It is not evidence of awareness or subjective experience.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
