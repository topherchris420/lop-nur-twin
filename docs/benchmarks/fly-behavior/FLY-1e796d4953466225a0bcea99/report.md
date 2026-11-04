# FLY-1e796d4953466225a0bcea99: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/9 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-03: learning retained through time: the full ECHO self-model reset to an innate one 5 s before a remembered change returns, against the full ECHO self-model with its memory intact, on the same schedule.

**Caveat.** Retained learning is measured, not identity: a reset self-model in the same body is still the same simulated fly, and a restored checkpoint is the self-model alone (docs/PROJECT_ECHO.md).

**Question (host-written).** In the digital fly simulator, how does the full ECHO self-model reset to an innate one 5 s before a remembered change returns change time from that return to the fly's concluding that it changed itself (undefined without one), against the full ECHO self-model with its memory intact, on the same schedule on matched seeds?

**Hypothesis (host-written).** The full ECHO self-model reset to an innate one 5 s before a remembered change returns will increase reexposure_latency_s by at least 3 s on average over 16 matched seeds drawn after preregistration, compared with the full ECHO self-model with its memory intact, on the same schedule, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] A self-model reset to an innate one before a remembered held-out impairment returns takes longer to conclude that it changed itself than one with its memory intact. — competing: [scripted] Learning an impairment from scratch is as fast as recognizing it, so memory does not shorten the time to conclude.

## Seeds

16 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 908152067, 420345384, 3109002592, 2479350022, 2650144260, 1728376095, 1464507556, 4169544788, 3359866848, 3633808801, 678500982, 731158948, 2563303662, 3509199153, 346372639, 1423451212.

## Primary metric: reexposure_latency_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 908152067 | 3.200 | 3.050 | -0.150 | opposite | `21dcdf807f9c` |
| 420345384 | 2.200 | 3.200 | 1.000 | expected | `d243078b1add` |
| 3109002592 | 3.200 | 3.200 | 0.000 | tie | `1ff753f42b79` |
| 2479350022 | 4.050 | 4.100 | 0.050 | expected | `24b3795b00ea` |
| 2650144260 | 9.750 | 10.050 | 0.300 | expected | `2bcfd193d8a2` |
| 1728376095 | 9.300 | 9.300 | 0.000 | tie | `d5456b68e3f0` |
| 1464507556 | 7.950 | 7.950 | 0.000 | tie | `fd1921094e1f` |
| 4169544788 | 3.250 | 5.550 | 2.300 | expected | `d5f5d7f872c1` |
| 3359866848 | 5.000 | 5.000 | 0.000 | tie | `78aca46b8468` |
| 3633808801 | 6.850 | 6.050 | -0.800 | opposite | `72c7239c9ca2` |
| 678500982 | 3.200 | 4.200 | 1.000 | expected | `4ec1762ba565` |
| 731158948 | 4.950 | 5.800 | 0.850 | expected | `03a9e0723c14` |
| 2563303662 | 2.350 | 3.200 | 0.850 | expected | `fed2cb66e9b9` |
| 3509199153 | 4.300 | 4.950 | 0.650 | expected | `8deed1c16e46` |
| 346372639 | 3.000 | 3.200 | 0.200 | expected | `7a3510659e95` |
| 1423451212 | 3.150 | 4.300 | 1.150 | expected | `d167aa4f2d88` |

10 of 12 untied seeds in the expected direction (increase), 2 opposite, 4 tied, 0 undefined. Exact one-sided sign test: p = 0.0193 for the expected direction, p = 0.9968 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 4.731, mean treatment 5.194, mean paired difference **0.463** (minimum effect 3 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 32: observed 32.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 3: observed 0.4625 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0193 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9968 — does not hold

Success criteria not all met (S1) and no failure criterion triggered.

Registry run `V3D-EXP-0009-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| reexposure_path_error | 0.092 | 0.095 | fraction |
| reexposure_latency_s | 4.731 | 5.194 | s |
| first_exposure_path_error | 0.096 | 0.096 | fraction |
| first_exposure_latency_s | 6.609 | 6.609 | s |
| unfamiliar_path_error | 0.132 | 0.111 | fraction |
| recalls | 1.063 | 0.063 | count |
| false_recalls | 0.188 | 0.063 | count |

## Provenance

- Plan `1e796d4953466225a0bcea9914cbdc62bd957a3b596bc12e6efff9fd269e476c`; fly `digital-fly/9 reduced-order-fsm/v1`, identity `5d8d3589513b67c3b784c7fcc76029b36d3478bb885568e6c79666e2bac6ec7b`, source `3a440f60616f2e78515dcf03a3cc689b54316140fb08d659c5310f63a4a83500`
- Preregistered as V3D-EXP-0009 at 2026-11-04T20:35:58.857Z (receipt `15d1b1c7558777779e5ef9d70566749879a1f3fa406d7e1e63f770098f6e21c9`)
- Authorized at 2026-11-04T20:35:58.932Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `1ada09d5d06bc35b40a82aef5303037921e30e0de6c9ff1bff4edecdc184e757`
- Record `3ed74639348b6fdde1b62b47982c3ac84c568564cc64cb6087baaeb68c2a3900`, run `FR-4b451a24168104f6e12bab7e`, 2026-11-04T20:35:58.934Z to 2026-11-04T20:36:35.169Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 7840 fly-seconds, then again for the determinism guard
- Code: commit `e458f7cb34904d85127779a3700c26b376ab4a80`
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
