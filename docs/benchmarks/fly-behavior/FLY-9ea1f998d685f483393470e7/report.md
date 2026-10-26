# FLY-9ea1f998d685f483393470e7: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Light preference: a point light of relative intensity 2 above one quadrant of the arena, against no point light (ambient only).

**Question (host-written).** In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds?

**Hypothesis (host-written).** A point light of relative intensity 2 above one quadrant of the arena will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with no point light (ambient only), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] With a point light on, the fly's mean horizontal distance to the point below it falls. — competing: [scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3166907952, 4292150623, 567416262, 4201682718, 3140904031, 1077145882, 1049217918, 908857333, 3184893549, 452912691, 3668589309, 4241891769.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3166907952 | 1.402 | 1.695 | 0.292 | opposite | `541ad750b6fe` |
| 4292150623 | 1.623 | 0.996 | -0.626 | expected | `7300e432a718` |
| 567416262 | 1.490 | 1.545 | 0.055 | opposite | `7b4e28f2981b` |
| 4201682718 | 1.356 | 1.472 | 0.115 | opposite | `681174f40588` |
| 3140904031 | 1.114 | 0.670 | -0.444 | expected | `90456bd034da` |
| 1077145882 | 1.205 | 1.106 | -0.099 | expected | `b0aaa8525dc0` |
| 1049217918 | 1.932 | 2.249 | 0.317 | opposite | `34b349e8519b` |
| 908857333 | 1.329 | 1.033 | -0.296 | expected | `bdadf7833af0` |
| 3184893549 | 1.801 | 1.998 | 0.197 | opposite | `cb6b81121533` |
| 452912691 | 1.158 | 1.199 | 0.041 | opposite | `39dfd8489625` |
| 3668589309 | 1.799 | 2.141 | 0.342 | opposite | `70b2ea025e0e` |
| 4241891769 | 1.288 | 0.543 | -0.745 | expected | `b57033d948c7` |

5 of 12 untied seeds in the expected direction (decrease), 7 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.8062 for the expected direction, p = 0.3872 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.458, mean treatment 1.387, mean paired difference **-0.071** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.0708 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.8062 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.3872 — does not hold

Success criteria not all met (S1, S2) and no failure criterion triggered.

Registry run `V3D-EXP-0029-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| mean_light_distance_m | 1.458 | 1.387 | m |
| time_near_light | 0.017 | 0.236 | fraction |
| active_fraction | 0.158 | 0.356 | fraction |

## Provenance

- Plan `9ea1f998d685f483393470e70f20bf26dffabfdebdab6105a9f42a8fef0ce39e`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `ff9c46c2a17247b1e4327a4763992d16722b4f6ef0c5ea58c211d1ee192cf514`, source `359ee8a2b23084a3726b5b2bab6e7ee39eb27578e0956b6dd6b66e6489bf34c8`
- Preregistered as V3D-EXP-0029 at 2026-10-26T13:07:25.152Z (receipt `3a8b28b584a24b5d71ba3b86e782ca3d7d17d69df4a69c0af0e0718b09b36280`)
- Authorized at 2026-10-26T13:07:25.172Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `f05e03e6815419b8076b7c9ad80d0d861544216f25cc1a96b4acac361c6a39a5`
- Record `ce6af95f4679fbe71a3b6c32b6f1eaa17f809a57cef8829c42b3fc28e1b85b2d`, run `FR-364e6173c4a68ac577c35013`, 2026-10-26T13:07:25.173Z to 2026-10-26T13:07:28.381Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2880 fly-seconds, then again for the determinism guard
- Code: commit `27af8430b03ffd5284d3609788b39b359c1aa099`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
