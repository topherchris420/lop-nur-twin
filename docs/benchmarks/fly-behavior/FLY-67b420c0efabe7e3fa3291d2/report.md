# FLY-67b420c0efabe7e3fa3291d2: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/9 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Light preference: a point light of relative intensity 2 above one quadrant of the arena, against no point light (ambient only).

**Question (host-written).** In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds?

**Hypothesis (host-written).** A point light of relative intensity 2 above one quadrant of the arena will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with no point light (ambient only), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] With a point light on, the fly's mean horizontal distance to the point below it falls. — competing: [scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1845416963, 544440098, 2366922340, 4276219791, 2040326052, 2378546092, 691366619, 2199579683, 694156024, 1653284560, 106533049, 1841406963.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1845416963 | 2.362 | 2.557 | 0.194 | opposite | `c79d4ba8df97` |
| 544440098 | 1.526 | 1.689 | 0.163 | opposite | `9413009137e8` |
| 2366922340 | 1.498 | 0.790 | -0.708 | expected | `03f8441aa273` |
| 4276219791 | 1.352 | 0.986 | -0.366 | expected | `c5ba07a36743` |
| 2040326052 | 1.700 | 1.689 | -0.011 | expected | `7fbb36db601f` |
| 2378546092 | 0.946 | 0.609 | -0.337 | expected | `17fd9a054266` |
| 691366619 | 1.442 | 0.884 | -0.558 | expected | `4607ea964ae7` |
| 2199579683 | 1.121 | 1.091 | -0.030 | expected | `cd4e2c2d1245` |
| 694156024 | 1.361 | 1.190 | -0.172 | expected | `8bcefbdbc58d` |
| 1653284560 | 1.251 | 0.699 | -0.552 | expected | `d0d50999ec37` |
| 106533049 | 1.463 | 1.523 | 0.060 | opposite | `0559909e78cd` |
| 1841406963 | 1.634 | 1.897 | 0.263 | opposite | `40ea1411caf7` |

8 of 12 untied seeds in the expected direction (decrease), 4 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.1938 for the expected direction, p = 0.9270 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.471, mean treatment 1.300, mean paired difference **-0.171** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.1711 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.1938 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.9270 — does not hold

Success criteria not all met (S2) and no failure criterion triggered.

Registry run `V3D-EXP-0002-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| mean_light_distance_m | 1.471 | 1.300 | m |
| time_near_light | 0.070 | 0.346 | fraction |
| active_fraction | 0.242 | 0.373 | fraction |

## Provenance

- Plan `67b420c0efabe7e3fa3291d217261d04d797f3648a4285b9979d3cbc25525f58`; fly `digital-fly/9 reduced-order-fsm/v1`, identity `5d8d3589513b67c3b784c7fcc76029b36d3478bb885568e6c79666e2bac6ec7b`, source `3a440f60616f2e78515dcf03a3cc689b54316140fb08d659c5310f63a4a83500`
- Preregistered as V3D-EXP-0002 at 2026-11-04T14:46:48.327Z (receipt `635a88dd50fe8e3187ad81dab1ed4cf429963d7712c2e898b86f27b068419b20`)
- Authorized at 2026-11-04T14:46:48.443Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `d634b3f643e0f1080a0b8438d2a375fc3d2ba30d7bbff332e5beeb63289c0938`
- Record `df6f3ed9101afede35df8acc5263a5f29d98f5dd65718ea61c91733a2de94987`, run `FR-1fac8091b56b4bc560b3014d`, 2026-11-04T14:46:48.445Z to 2026-11-04T14:47:03.021Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2880 fly-seconds, then again for the determinism guard
- Code: commit `e458f7cb34904d85127779a3700c26b376ab4a80`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
