# FLY-aff10dec2ec287b28e76c74e: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-03: learning retained through time: the full ECHO self-model reset to an innate one 5 s before a remembered change returns, against the full ECHO self-model with its memory intact, on the same schedule.

**Caveat.** Retained learning is measured, not identity: a reset self-model in the same body is still the same simulated fly, and a restored checkpoint is the self-model alone (docs/PROJECT_ECHO.md).

**Question (host-written).** In the digital fly simulator, how does the full ECHO self-model reset to an innate one 5 s before a remembered change returns change time from that return to the fly's concluding that it changed itself (undefined without one), against the full ECHO self-model with its memory intact, on the same schedule on matched seeds?

**Hypothesis (host-written).** The full ECHO self-model reset to an innate one 5 s before a remembered change returns will increase reexposure_latency_s by at least 3 s on average over 16 matched seeds drawn after preregistration, compared with the full ECHO self-model with its memory intact, on the same schedule, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] A self-model reset to an innate one before a remembered held-out impairment returns takes longer to conclude that it changed itself than one with its memory intact. — competing: [scripted] Learning an impairment from scratch is as fast as recognizing it, so memory does not shorten the time to conclude.

## Seeds

16 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2015156127, 2693947341, 1269747314, 1505585083, 2552535625, 820620292, 1454440031, 1141207836, 3523789566, 4119058477, 2976881166, 3858853739, 103909158, 1479929061, 4209876674, 3759143179.

## Primary metric: reexposure_latency_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2015156127 | 4.800 | 21.400 | 16.600 | expected | `633c0f962ee3` |
| 2693947341 | 2.900 | 4.450 | 1.550 | expected | `a8a87d0c1f7d` |
| 1269747314 | 4.000 | 4.000 | 0.000 | tie | `5ea4941ef7e2` |
| 1505585083 | 3.250 | 3.800 | 0.550 | expected | `d6b868454297` |
| 2552535625 | 1.850 | 2.850 | 1.000 | expected | `0e7c36c4d9c8` |
| 820620292 | 3.200 | 2.500 | -0.700 | opposite | `2d8cfbdcf188` |
| 1454440031 | 3.200 | 3.200 | 0.000 | tie | `e5d419343881` |
| 1141207836 | 3.200 | 3.700 | 0.500 | expected | `732874023562` |
| 3523789566 | 3.250 | 3.250 | 0.000 | tie | `039c65e48bc2` |
| 4119058477 | 7.150 | 10.300 | 3.150 | expected | `4c605426f651` |
| 2976881166 | 2.850 | 2.850 | 0.000 | tie | `ee4f3c84e01f` |
| 3858853739 | 3.150 | 3.200 | 0.050 | expected | `9db18d9da200` |
| 103909158 | 2.300 | 3.050 | 0.750 | expected | `55b9e6091b14` |
| 1479929061 | 2.200 | 3.250 | 1.050 | expected | `c4eb3a786f6c` |
| 4209876674 | 5.100 | 5.850 | 0.750 | expected | `67eff4878367` |
| 3759143179 | 3.400 | 3.700 | 0.300 | expected | `94dc5b798946` |

11 of 12 untied seeds in the expected direction (increase), 1 opposite, 4 tied, 0 undefined. Exact one-sided sign test: p = 0.0032 for the expected direction, p = 0.9998 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 3.487, mean treatment 5.084, mean paired difference **1.597** (minimum effect 3 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 32: observed 32.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 3: observed 1.5969 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0032 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9998 — does not hold

Success criteria not all met (S1) and no failure criterion triggered.

Registry run `V3D-EXP-0063-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| reexposure_path_error | 0.074 | 0.089 | fraction |
| reexposure_latency_s | 3.487 | 5.084 | s |
| first_exposure_path_error | 0.094 | 0.094 | fraction |
| first_exposure_latency_s | 4.347 | 4.347 | s |
| unfamiliar_path_error | 0.133 | 0.154 | fraction |
| recalls | 1.125 | 0.063 | count |
| false_recalls | 0.125 | 0.063 | count |

## Provenance

- Plan `aff10dec2ec287b28e76c74e4cf42e0004d1007cbd90f298fafd9c05f5844a82`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `c684a7f0002390bee7e62d529bc459479c35e45465749ad174bd99aca71a5f8a`, source `a96a496c4c00acead32e208158faf7889c31027b8dccde781059a4eb4481f70b`
- Preregistered as V3D-EXP-0063 at 2026-10-27T04:18:45.731Z (receipt `f839aeec3ffae536bc4565c4da6502e59a487668fa33f732476842b8ac591b5a`)
- Authorized at 2026-10-27T04:18:45.860Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `fdfa703e251aacb2488d9b6477e799c30f23e0c410d01bfe834660e40026fdf1`
- Record `c1e97b3e8412d8b1c7ab52188c9887469d4a4cea51b7955cef986355e7c79478`, run `FR-a2aa0b1c0fd4699ae74fd2e0`, 2026-10-27T04:18:45.865Z to 2026-10-27T04:20:21.408Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 7840 fly-seconds, then again for the determinism guard
- Code: commit `352fafda07d29c0d7f4f412073dc129fc5ac7a63`
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
