# FLY-20e99c4a88e5b2cd7863a7ba: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-03: learning retained through time: the full ECHO self-model reset to an innate one 5 s before a remembered change returns, against the full ECHO self-model with its memory intact, on the same schedule.

**Caveat.** Retained learning is measured, not identity: a reset self-model in the same body is still the same simulated fly, and a restored checkpoint is the self-model alone (docs/PROJECT_ECHO.md).

**Question (host-written).** In the digital fly simulator, how does the full ECHO self-model reset to an innate one 5 s before a remembered change returns change time from that return to the fly's concluding that it changed itself (undefined without one), against the full ECHO self-model with its memory intact, on the same schedule on matched seeds?

**Hypothesis (host-written).** The full ECHO self-model reset to an innate one 5 s before a remembered change returns will increase reexposure_latency_s by at least 4 s on average over 16 matched seeds drawn after preregistration, compared with the full ECHO self-model with its memory intact, on the same schedule, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] A self-model reset to an innate one before a remembered held-out impairment returns takes longer to conclude that it changed itself than one with its memory intact. — competing: [scripted] Learning an impairment from scratch is as fast as recognizing it, so memory does not shorten the time to conclude.

## Seeds

16 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3250389418, 3195116322, 1049146562, 237749343, 1117855807, 2965858723, 4116659785, 1555703004, 2320671105, 1384642203, 199009933, 3594087268, 2493806068, 4222456402, 1683711630, 150098462.

## Primary metric: reexposure_latency_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3250389418 | 6.900 | — | — | undefined | `201ac0ee4633` |
| 3195116322 | 2.300 | 2.600 | 0.300 | expected | `cc4a8d067ec0` |
| 1049146562 | 2.200 | 2.200 | 0.000 | tie | `bb9a6ce99e83` |
| 237749343 | 22.500 | 22.750 | 0.250 | expected | `ef89a41b9168` |
| 1117855807 | 2.300 | 2.300 | 0.000 | tie | `5f08a8e32df5` |
| 2965858723 | 2.150 | 2.300 | 0.150 | expected | `765d7dcc8702` |
| 4116659785 | 2.200 | 2.600 | 0.400 | expected | `2718b8f45d74` |
| 1555703004 | 1.150 | 2.100 | 0.950 | expected | `cd8ca65eac82` |
| 2320671105 | — | — | — | undefined | `0bcf33da74ee` |
| 1384642203 | 2.100 | 2.100 | 0.000 | tie | `e75c14fbc0d2` |
| 199009933 | 2.000 | 2.150 | 0.150 | expected | `d3b42b0e0354` |
| 3594087268 | 1.700 | — | — | undefined | `45d296e324b3` |
| 2493806068 | 3.150 | 3.700 | 0.550 | expected | `9da0eead76f9` |
| 4222456402 | 2.300 | 2.500 | 0.200 | expected | `064210483a80` |
| 1683711630 | 3.100 | 3.100 | 0.000 | tie | `67583cc8ec2b` |
| 150098462 | 0.350 | 2.100 | 1.750 | expected | `2484eba4d2ad` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 4 tied, 3 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 3.677, mean treatment 4.038, mean paired difference **0.362** (minimum effect 4 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 32: observed 32.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 4: observed 0.3615 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

Success criteria not all met (S1) and no failure criterion triggered.

Registry run `V3D-EXP-0027-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| reexposure_path_error | 0.061 | 0.050 | fraction |
| reexposure_latency_s | 3.760 | 4.038 | s |
| first_exposure_path_error | 0.078 | 0.078 | fraction |
| first_exposure_latency_s | 4.269 | 4.269 | s |
| unfamiliar_path_error | 0.110 | 0.092 | fraction |
| recalls | 0.875 | 0.000 | count |
| false_recalls | 0.000 | 0.000 | count |

## Provenance

- Plan `20e99c4a88e5b2cd7863a7ba7c3d9ad4a10971b3adb449320b5d03ab895c15cb`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `44a4d99fc81cf563bb4ff40377cff7d1ae9881d95c6cf3b17851e5804539805d`, source `b794ba087d2c9dbb0d589758d6d2e0a89d958b3f2b626d50ab3388266513a682`
- Preregistered as V3D-EXP-0027 at 2026-10-26T05:51:20.060Z (receipt `a14acad20b51af93a3fbe0cc9006a763d2f4a20b416b7225cdc1dd9f3a3a1ae7`)
- Authorized at 2026-10-26T05:51:20.154Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `4ea1ae781678f40f4691a8024df7e8c6149ed0025fc4fc29a8ac145e62189bf4`
- Record `3f131b58408611ec6309b5a260873668b23a13ebd69895a470fed2f504e615a4`, run `FR-fc29f7310669f614d65b7a52`, 2026-10-26T05:51:20.157Z to 2026-10-26T05:52:44.677Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 7840 fly-seconds, then again for the determinism guard
- Code: commit `6ea1990ebc33011e02ad26083bebb719dc837d1b`
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
