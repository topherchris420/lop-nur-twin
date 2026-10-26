# FLY-61d0813bd62b4fa2757c5bd9: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-03: learning retained through time: the full ECHO self-model reset to an innate one 5 s before a remembered change returns, against the full ECHO self-model with its memory intact, on the same schedule.

**Caveat.** Retained learning is measured, not identity: a reset self-model in the same body is still the same simulated fly, and a restored checkpoint is the self-model alone (docs/PROJECT_ECHO.md).

**Question (host-written).** In the digital fly simulator, how does the full ECHO self-model reset to an innate one 5 s before a remembered change returns change time from that return to the fly's concluding that it changed itself (undefined without one), against the full ECHO self-model with its memory intact, on the same schedule on matched seeds?

**Hypothesis (host-written).** The full ECHO self-model reset to an innate one 5 s before a remembered change returns will increase reexposure_latency_s by at least 4 s on average over 16 matched seeds drawn after preregistration, compared with the full ECHO self-model with its memory intact, on the same schedule, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] A self-model reset to an innate one before a remembered held-out impairment returns takes longer to conclude that it changed itself than one with its memory intact. — competing: [scripted] Learning an impairment from scratch is as fast as recognizing it, so memory does not shorten the time to conclude.

## Seeds

16 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3471538121, 363214744, 1891374763, 2817962075, 239347713, 1236667317, 1849459913, 731628759, 456079597, 3129665393, 2175505743, 1384507932, 2191116095, 2080142151, 3239444314, 4273026861.

## Primary metric: reexposure_latency_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3471538121 | 12.550 | — | — | undefined | `20bc61e0913a` |
| 363214744 | 6.950 | 4.300 | -2.650 | opposite | `ca1ccdc02d78` |
| 1891374763 | 2.200 | 2.200 | 0.000 | tie | `b647e99b6b4c` |
| 2817962075 | 2.200 | 2.200 | 0.000 | tie | `02a794478d23` |
| 239347713 | 4.850 | 5.050 | 0.200 | expected | `06bf145602b3` |
| 1236667317 | 1.750 | 2.200 | 0.450 | expected | `c236fa2e5bcd` |
| 1849459913 | 1.650 | 2.200 | 0.550 | expected | `4534f360ef46` |
| 731628759 | 1.000 | 3.100 | 2.100 | expected | `f1f8dbdd9324` |
| 456079597 | 0.750 | 2.150 | 1.400 | expected | `2aab05a5c8e3` |
| 3129665393 | 2.000 | 4.500 | 2.500 | expected | `db6483b07f0a` |
| 2175505743 | 3.050 | 3.350 | 0.300 | expected | `cdca51f8e9a3` |
| 1384507932 | 4.700 | 5.400 | 0.700 | expected | `1614f8dec417` |
| 2191116095 | 9.800 | 9.800 | 0.000 | tie | `72961b217bf7` |
| 2080142151 | 2.150 | 4.950 | 2.800 | expected | `1854e73ef921` |
| 3239444314 | 2.850 | 2.850 | 0.000 | tie | `3da723d7b3fc` |
| 4273026861 | 4.350 | 4.350 | 0.000 | tie | `fa5a41661f96` |

9 of 10 untied seeds in the expected direction (increase), 1 opposite, 5 tied, 1 undefined. Exact one-sided sign test: p = 0.0107 for the expected direction, p = 0.9990 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 3.350, mean treatment 3.907, mean paired difference **0.557** (minimum effect 4 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 32: observed 32.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 10.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 4: observed 0.5567 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0107 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9990 — does not hold

Success criteria not all met (S1) and no failure criterion triggered.

Registry run `V3D-EXP-0009-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| reexposure_path_error | 0.067 | 0.065 | fraction |
| reexposure_latency_s | 3.925 | 3.907 | s |
| first_exposure_path_error | 0.078 | 0.078 | fraction |
| first_exposure_latency_s | 2.873 | 2.873 | s |
| unfamiliar_path_error | 0.160 | 0.183 | fraction |
| recalls | 1.125 | 0.063 | count |
| false_recalls | 0.063 | 0.000 | count |

## Provenance

- Plan `61d0813bd62b4fa2757c5bd998534e250267bd756e0a2c8e0fe38cec347c26e8`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `309bc659d993b7c1affb6353a5aac0e434e9fc502d8d9477013d3af7296aaf38`, source `b9abf944d6d246ff622184e4b0d29ccdf4e3966665643958ab4585d67f4b0aff`
- Preregistered as V3D-EXP-0009 at 2026-10-26T00:36:15.450Z (receipt `5811a3edecd3d682206e3e7d91cddfb932b2ca41d49295bdf29f56f09d1a2aa2`)
- Authorized at 2026-10-26T00:36:15.479Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `ddd65d048183903ccc48f50863f426302e13ce518296750b0e4080282d89a62a`
- Record `df85d63924dd6bcdfe4748b57aa371a6834434a4b0d0e4be855666e175773ed3`, run `FR-747fd56c44adc2d3fa4897af`, 2026-10-26T00:36:15.480Z to 2026-10-26T00:36:54.209Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 7840 fly-seconds, then again for the determinism guard
- Code: commit `06ff901fae549bb121d80c9b61e0f5c6b61faf77`
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
