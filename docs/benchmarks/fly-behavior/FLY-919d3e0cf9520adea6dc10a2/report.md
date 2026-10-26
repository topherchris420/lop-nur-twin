# FLY-919d3e0cf9520adea6dc10a2: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-03: learning retained through time: the full ECHO self-model reset to an innate one 5 s before a remembered change returns, against the full ECHO self-model with its memory intact, on the same schedule.

**Caveat.** Retained learning is measured, not identity: a reset self-model in the same body is still the same simulated fly, and a restored checkpoint is the self-model alone (docs/PROJECT_ECHO.md).

**Question (host-written).** In the digital fly simulator, how does the full ECHO self-model reset to an innate one 5 s before a remembered change returns change time from that return to the fly's concluding that it changed itself (undefined without one), against the full ECHO self-model with its memory intact, on the same schedule on matched seeds?

**Hypothesis (host-written).** The full ECHO self-model reset to an innate one 5 s before a remembered change returns will increase reexposure_latency_s by at least 4 s on average over 16 matched seeds drawn after preregistration, compared with the full ECHO self-model with its memory intact, on the same schedule, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] A self-model reset to an innate one before a remembered held-out impairment returns takes longer to conclude that it changed itself than one with its memory intact. — competing: [scripted] Learning an impairment from scratch is as fast as recognizing it, so memory does not shorten the time to conclude.

## Seeds

16 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2622960989, 855462949, 1049190086, 3809496140, 2169035279, 3872977163, 2007941857, 3933273494, 1554815690, 2244663346, 2624145340, 744555629, 1592351939, 3576468789, 3353004357, 1382952055.

## Primary metric: reexposure_latency_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2622960989 | 1.750 | 2.450 | 0.700 | expected | `1ee3f4b31f3f` |
| 855462949 | 6.700 | 2.150 | -4.550 | opposite | `0dafe4e367cf` |
| 1049190086 | 3.600 | 3.950 | 0.350 | expected | `2b90638d3504` |
| 3809496140 | 2.200 | 2.300 | 0.100 | expected | `29cff409546c` |
| 2169035279 | 1.850 | 1.850 | 0.000 | tie | `939d9547a294` |
| 3872977163 | 2.150 | 2.250 | 0.100 | expected | `bdcf2cde1201` |
| 2007941857 | 1.600 | 1.650 | 0.050 | expected | `fe22e3650361` |
| 3933273494 | 1.550 | 2.200 | 0.650 | expected | `150217d87b56` |
| 1554815690 | 1.150 | 2.150 | 1.000 | expected | `044ea62d4701` |
| 2244663346 | 3.600 | 3.600 | 0.000 | tie | `45d8f610a9fe` |
| 2624145340 | 1.700 | 2.300 | 0.600 | expected | `4149e578ddfb` |
| 744555629 | 2.200 | 2.250 | 0.050 | expected | `6ab298c56edf` |
| 1592351939 | 32.300 | — | — | undefined | `12444d3a4577` |
| 3576468789 | 2.200 | 2.200 | 0.000 | tie | `c61fd4bcc183` |
| 3353004357 | 4.100 | 9.300 | 5.200 | expected | `a3a8a0479627` |
| 1382952055 | 2.250 | 2.250 | 0.000 | tie | `3593f03adb64` |

10 of 11 untied seeds in the expected direction (increase), 1 opposite, 4 tied, 1 undefined. Exact one-sided sign test: p = 0.0059 for the expected direction, p = 0.9995 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 2.573, mean treatment 2.857, mean paired difference **0.283** (minimum effect 4 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 32: observed 32.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 11.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 4: observed 0.2833 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0059 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9995 — does not hold

Success criteria not all met (S1) and no failure criterion triggered.

Registry run `V3D-EXP-0045-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| reexposure_path_error | 0.103 | 0.100 | fraction |
| reexposure_latency_s | 4.431 | 2.857 | s |
| first_exposure_path_error | 0.079 | 0.079 | fraction |
| first_exposure_latency_s | 4.287 | 4.287 | s |
| unfamiliar_path_error | 0.115 | 0.116 | fraction |
| recalls | 1.000 | 0.125 | count |
| false_recalls | 0.125 | 0.063 | count |

## Provenance

- Plan `919d3e0cf9520adea6dc10a22c2f93a2e854742c4fcb9e0fb7ed31eb4feabe23`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `e2eb5e95c355777d19a210820fb203fc9ef47608031b98fa85882280e85cfdca`, source `daad49019246c38c2673cd442ecaae50eba95994635676bdc333b5563cebfb78`
- Preregistered as V3D-EXP-0045 at 2026-10-26T20:17:09.704Z (receipt `08f20b78e8d2112428e243ac725d25bf97465247062a263940f7991cd38c32f6`)
- Authorized at 2026-10-26T20:17:09.732Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `94371a7337440bafb937481af44dad84b21464d45d2fa4bf4335d79211d91909`
- Record `ae969e57bde6258f2cff0381069194419c2b20e347b672ee7e3b880a9fa4fbc5`, run `FR-62e5f3d2fce02b5ffd65ee60`, 2026-10-26T20:17:09.734Z to 2026-10-26T20:17:29.105Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 7840 fly-seconds, then again for the determinism guard
- Code: commit `379fb9debfbd203f99d6c76ac80097706945dd2d`
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
