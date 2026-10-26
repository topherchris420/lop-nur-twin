# FLY-3cb8afd0836ced1c4622bb43: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-03: learning retained through time: the full ECHO self-model reset to an innate one 5 s before a remembered change returns, against the full ECHO self-model with its memory intact, on the same schedule.

**Caveat.** Retained learning is measured, not identity: a reset self-model in the same body is still the same simulated fly, and a restored checkpoint is the self-model alone (docs/PROJECT_ECHO.md).

**Question (host-written).** In the digital fly simulator, how does the full ECHO self-model reset to an innate one 5 s before a remembered change returns change time from that return to the fly's concluding that it changed itself (undefined without one), against the full ECHO self-model with its memory intact, on the same schedule on matched seeds?

**Hypothesis (host-written).** The full ECHO self-model reset to an innate one 5 s before a remembered change returns will increase reexposure_latency_s by at least 4 s on average over 16 matched seeds drawn after preregistration, compared with the full ECHO self-model with its memory intact, on the same schedule, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] A self-model reset to an innate one before a remembered held-out impairment returns takes longer to conclude that it changed itself than one with its memory intact. — competing: [scripted] Learning an impairment from scratch is as fast as recognizing it, so memory does not shorten the time to conclude.

## Seeds

16 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2780885278, 37535947, 2105600036, 764908847, 1420750240, 1175195508, 3007500325, 4182849534, 4239464963, 1449742737, 3813742719, 993592188, 2350016021, 3926313097, 3552762279, 1859304774.

## Primary metric: reexposure_latency_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2780885278 | 3.000 | 3.000 | 0.000 | tie | `f0a42005328a` |
| 37535947 | 1.350 | 2.150 | 0.800 | expected | `60a50370a36e` |
| 2105600036 | 2.050 | 2.750 | 0.700 | expected | `5f27b093e4f1` |
| 764908847 | 2.400 | 2.400 | 0.000 | tie | `71940769441b` |
| 1420750240 | 3.250 | 3.650 | 0.400 | expected | `c966c29d0836` |
| 1175195508 | 1.750 | 2.250 | 0.500 | expected | `966a616ced1b` |
| 3007500325 | 3.650 | 4.350 | 0.700 | expected | `2ece7c1f78ef` |
| 4182849534 | 6.350 | 7.050 | 0.700 | expected | `b7bbc9f42f11` |
| 4239464963 | 2.200 | 2.200 | 0.000 | tie | `77ce0d11a24b` |
| 1449742737 | 2.100 | 2.100 | 0.000 | tie | `c038cd20c041` |
| 3813742719 | 2.350 | 2.200 | -0.150 | opposite | `d359e1cf261e` |
| 993592188 | 1.250 | 2.200 | 0.950 | expected | `83f59ed8998b` |
| 2350016021 | 1.750 | 1.750 | 0.000 | tie | `d1d76d2295ea` |
| 3926313097 | 0.250 | 1.600 | 1.350 | expected | `05e68063f4f2` |
| 3552762279 | 1.450 | 2.250 | 0.800 | expected | `eec05190d149` |
| 1859304774 | 1.850 | 2.600 | 0.750 | expected | `e8c95849b13b` |

10 of 11 untied seeds in the expected direction (increase), 1 opposite, 5 tied, 0 undefined. Exact one-sided sign test: p = 0.0059 for the expected direction, p = 0.9995 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 2.312, mean treatment 2.781, mean paired difference **0.469** (minimum effect 4 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 32: observed 32.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 11.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 4: observed 0.4688 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0059 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9995 — does not hold

Success criteria not all met (S1) and no failure criterion triggered.

Registry run `V3D-EXP-0036-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| reexposure_path_error | 0.131 | 0.097 | fraction |
| reexposure_latency_s | 2.312 | 2.781 | s |
| first_exposure_path_error | 0.090 | 0.090 | fraction |
| first_exposure_latency_s | 4.206 | 4.206 | s |
| unfamiliar_path_error | 0.120 | 0.112 | fraction |
| recalls | 1.438 | 0.250 | count |
| false_recalls | 0.313 | 0.188 | count |

## Provenance

- Plan `3cb8afd0836ced1c4622bb4334252d434ed22861120cd5645ea9848b89457cca`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `ff9c46c2a17247b1e4327a4763992d16722b4f6ef0c5ea58c211d1ee192cf514`, source `359ee8a2b23084a3726b5b2bab6e7ee39eb27578e0956b6dd6b66e6489bf34c8`
- Preregistered as V3D-EXP-0036 at 2026-10-26T13:09:37.599Z (receipt `c36ef91b9c7e1e5425aa74567b4536b7130c71e6d552d521852d01d27c106518`)
- Authorized at 2026-10-26T13:09:37.625Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `6ae0826e38b75b18e825bcf2a897c43491691c0085220feb1ad74b71aceb3378`
- Record `5928dea10f12402bbcaa94a51077d3f4dd9f0ea9d5defa2dde92ee0a734b8dab`, run `FR-c2d90b455820d61fb7b3a780`, 2026-10-26T13:09:37.626Z to 2026-10-26T13:09:56.888Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 7840 fly-seconds, then again for the determinism guard
- Code: commit `27af8430b03ffd5284d3609788b39b359c1aa099`
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
