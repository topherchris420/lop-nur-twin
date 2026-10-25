# FLY-3285f03c6180b224ef22cf97: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-03: learning retained through time: the full ECHO self-model reset to an innate one 5 s before a remembered change returns, against the full ECHO self-model with its memory intact, on the same schedule.

**Caveat.** Retained learning is measured, not identity: a reset self-model in the same body is still the same simulated fly, and a restored checkpoint is the self-model alone (docs/PROJECT_ECHO.md).

**Question (host-written).** In the digital fly simulator, how does the full ECHO self-model reset to an innate one 5 s before a remembered change returns change time from that return to the fly's concluding that it changed itself (undefined without one), against the full ECHO self-model with its memory intact, on the same schedule on matched seeds?

**Hypothesis (host-written).** The full ECHO self-model reset to an innate one 5 s before a remembered change returns will increase reexposure_latency_s by at least 4 s on average over 16 matched seeds drawn after preregistration, compared with the full ECHO self-model with its memory intact, on the same schedule, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] A self-model reset to an innate one before a remembered held-out impairment returns takes longer to conclude that it changed itself than one with its memory intact. — competing: [scripted] Learning an impairment from scratch is as fast as recognizing it, so memory does not shorten the time to conclude.

## Seeds

16 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 923755277, 3373419334, 2676449029, 2611668565, 953778235, 549725896, 3613897609, 3740552946, 242153232, 1343652633, 661785800, 1356557929, 2871335023, 201346362, 1465166761, 200919264.

## Primary metric: reexposure_latency_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 923755277 | 1.900 | 2.850 | 0.950 | expected | `f3c0963b1730` |
| 3373419334 | 2.500 | 2.650 | 0.150 | expected | `7c3233d194b0` |
| 2676449029 | 1.450 | 2.300 | 0.850 | expected | `6d0add36ac4e` |
| 2611668565 | 1.350 | 2.200 | 0.850 | expected | `402f1a3023f1` |
| 953778235 | 1.950 | 1.900 | -0.050 | opposite | `b06c9b742245` |
| 549725896 | 3.250 | 3.550 | 0.300 | expected | `99d631f47705` |
| 3613897609 | 6.200 | 7.600 | 1.400 | expected | `8c144d2d194b` |
| 3740552946 | 32.900 | — | — | undefined | `13b229c1fb81` |
| 242153232 | — | — | — | undefined | `4d03f7550b4d` |
| 1343652633 | 4.600 | 5.400 | 0.800 | expected | `39f1cd79f261` |
| 661785800 | 2.000 | 2.000 | 0.000 | tie | `28321a265a82` |
| 1356557929 | 1.850 | 2.100 | 0.250 | expected | `2bfbc70c4bed` |
| 2871335023 | 1.950 | 2.050 | 0.100 | expected | `4f89a143258d` |
| 201346362 | 2.050 | 2.050 | 0.000 | tie | `522836e00c6c` |
| 1465166761 | 2.250 | 8.100 | 5.850 | expected | `393256680849` |
| 200919264 | 1.950 | 1.950 | 0.000 | tie | `a140a9965e59` |

10 of 11 untied seeds in the expected direction (increase), 1 opposite, 3 tied, 2 undefined. Exact one-sided sign test: p = 0.0059 for the expected direction, p = 0.9995 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 2.518, mean treatment 3.336, mean paired difference **0.818** (minimum effect 4 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 32: observed 32.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 11.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 4: observed 0.8179 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0059 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9995 — does not hold

Success criteria not all met (S1) and no failure criterion triggered.

Registry run `V3D-EXP-0009-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| reexposure_path_error | 0.145 | 0.131 | fraction |
| reexposure_latency_s | 4.543 | 3.336 | s |
| first_exposure_path_error | 0.089 | 0.089 | fraction |
| first_exposure_latency_s | 3.534 | 3.534 | s |
| unfamiliar_path_error | 0.222 | 0.185 | fraction |
| recalls | 1.000 | 0.125 | count |
| false_recalls | 0.063 | 0.000 | count |

## Provenance

- Plan `3285f03c6180b224ef22cf978747f05bfd7a18e2713d4ce389fe673ab0bcddc2`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `8fa862d0a358e1d8f3c36ea20bcc47f293ef42c1413ff1db2c9a6ebf3f086911`, source `e838b010f63674a8e7c6364631eff58473fbb0ef96fbd5d0e69b399a4303c485`
- Preregistered as V3D-EXP-0009 at 2026-10-25T19:51:03.726Z (receipt `9602f300c64ae8e3ca9b68d8605c4c046a453424506ed8f7e7d10756ff85aa36`)
- Authorized at 2026-10-25T19:51:03.741Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `80c99ede99ad5d114fd2d72b551f80fd7ff63391bce7daeaf6e68884cfb93c0b`
- Record `c0d2bddf1226f337a6db0e42c40875b5af3a5b0fa3a46c748926d468d40bd725`, run `FR-f1d3146d21981902fecae6a1`, 2026-10-25T19:51:03.741Z to 2026-10-25T19:51:23.961Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 7840 fly-seconds, then again for the determinism guard
- Code: commit `10ac28871a37a973b6f6907be886fb9ea2a328ca`
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
