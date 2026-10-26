# FLY-037df20ebfb1d368b5c7ae81: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Light preference: a point light of relative intensity 2 above one quadrant of the arena, against no point light (ambient only).

**Question (host-written).** In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds?

**Hypothesis (host-written).** A point light of relative intensity 2 above one quadrant of the arena will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with no point light (ambient only), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] With a point light on, the fly's mean horizontal distance to the point below it falls. — competing: [scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 780781491, 919739367, 2922706419, 2190642701, 2744952135, 888160096, 2265139756, 39858136, 3401862762, 1614400690, 4275421493, 4107060571.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 780781491 | 1.611 | 0.719 | -0.892 | expected | `74f302b2fb41` |
| 919739367 | 1.439 | 1.395 | -0.045 | expected | `1316f0b4042e` |
| 2922706419 | 1.574 | 1.349 | -0.225 | expected | `c30e4eaf1ed8` |
| 2190642701 | 1.813 | 1.671 | -0.142 | expected | `b1b383e2c15e` |
| 2744952135 | 1.325 | 1.292 | -0.033 | expected | `e34ee21cd03e` |
| 888160096 | 1.176 | 0.602 | -0.574 | expected | `8c4e79782a68` |
| 2265139756 | 1.792 | 2.007 | 0.215 | opposite | `867cf9c2b0b7` |
| 39858136 | 1.652 | 1.502 | -0.150 | expected | `fd05fc607ec5` |
| 3401862762 | 1.490 | 1.532 | 0.042 | opposite | `061f93479b08` |
| 1614400690 | 1.471 | 1.354 | -0.117 | expected | `57b0cd480add` |
| 4275421493 | 1.357 | 0.837 | -0.520 | expected | `1909eab5cff1` |
| 4107060571 | 1.572 | 0.978 | -0.593 | expected | `1c16b3a17545` |

10 of 12 untied seeds in the expected direction (decrease), 2 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0193 for the expected direction, p = 0.9968 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.523, mean treatment 1.270, mean paired difference **-0.253** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.2528 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0193 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9968 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0047-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| mean_light_distance_m | 1.523 | 1.270 | m |
| time_near_light | 0.024 | 0.253 | fraction |
| active_fraction | 0.232 | 0.322 | fraction |

## Provenance

- Plan `037df20ebfb1d368b5c7ae81027b64f00865d4a8f26e4570926dabb30dc6cefa`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `8d86753f0ca7a7395da5a6b7f3902bd120428b515dc616340ef12e9ae0489eed`, source `86708015e47c271602b7856459ea1d6ff513ea0f1df0bb8587c3f192a417f022`
- Preregistered as V3D-EXP-0047 at 2026-10-26T23:26:03.039Z (receipt `14a056006075fceaf772210c7fcc0a20c1f33da03508b80d55e92ec8d3b0c52e`)
- Authorized at 2026-10-26T23:26:03.064Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `5d5bc976c700e19c57228ec9841fc917c474b938523001d0b075d81719a184c7`
- Record `06ee4f986ccdbff9d41a1c73eef61558378264f5bccf9853bcd38def17aadd59`, run `FR-adf0ea8a0880549c9c0e37e1`, 2026-10-26T23:26:03.066Z to 2026-10-26T23:26:06.365Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2880 fly-seconds, then again for the determinism guard
- Code: commit `fb76ce5c5fc61f279bc5980bd1ea22863c0cdb8d`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
