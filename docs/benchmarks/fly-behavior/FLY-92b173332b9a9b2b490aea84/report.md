# FLY-92b173332b9a9b2b490aea84: FAILED (not supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Light preference: a point light of relative intensity 2 above one quadrant of the arena, against no point light (ambient only).

**Question (host-written).** In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds?

**Hypothesis (host-written).** A point light of relative intensity 2 above one quadrant of the arena will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with no point light (ambient only), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] With a point light on, the fly's mean horizontal distance to the point below it falls. — competing: [scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1900043356, 1802316925, 340575949, 4140759840, 2646250851, 2971225974, 3542953859, 1170410185, 2151242096, 3150565417, 203415662, 2861850868.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1900043356 | 1.726 | 1.890 | 0.164 | opposite | `2c839c38fc54` |
| 1802316925 | 1.544 | 1.632 | 0.088 | opposite | `353085ba4721` |
| 340575949 | 2.291 | 1.838 | -0.453 | expected | `5d40f45dc8cc` |
| 4140759840 | 1.198 | 1.349 | 0.151 | opposite | `37182bd10f2a` |
| 2646250851 | 1.275 | 1.627 | 0.352 | opposite | `4234595429ee` |
| 2971225974 | 1.912 | 2.160 | 0.249 | opposite | `44bfe2bd4ddb` |
| 3542953859 | 1.468 | 1.702 | 0.234 | opposite | `8b94b751b995` |
| 1170410185 | 1.285 | 1.382 | 0.097 | opposite | `a1c37b761e1f` |
| 2151242096 | 1.394 | 1.457 | 0.063 | opposite | `ce84ab381f93` |
| 3150565417 | 1.261 | 1.459 | 0.198 | opposite | `ede8e7ddb52c` |
| 203415662 | 1.047 | 0.982 | -0.065 | expected | `fa72095eea0a` |
| 2861850868 | 1.333 | 1.346 | 0.013 | opposite | `08253d7906c2` |

2 of 12 untied seeds in the expected direction (decrease), 10 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.9968 for the expected direction, p = 0.0193 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.478, mean treatment 1.569, mean paired difference **0.091** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed 0.0908 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.9968 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.0193 — holds

Failure criterion triggered: F1. The hypothesis is not supported.

Registry run `V3D-EXP-0002-RUN-0001`: status **failed**, verdict **not_supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| mean_light_distance_m | 1.478 | 1.569 | m |
| time_near_light | 0.080 | 0.063 | fraction |
| active_fraction | 0.173 | 0.310 | fraction |

## Provenance

- Plan `92b173332b9a9b2b490aea84b05e27643f7faaaf173fa06b59a04ae591b3beb8`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `309bc659d993b7c1affb6353a5aac0e434e9fc502d8d9477013d3af7296aaf38`, source `b9abf944d6d246ff622184e4b0d29ccdf4e3966665643958ab4585d67f4b0aff`
- Preregistered as V3D-EXP-0002 at 2026-10-26T00:32:36.549Z (receipt `7a7db6a1711371761cadce1b8a852c49b43668d5d45e5928b74ba29ed2b2be87`)
- Authorized at 2026-10-26T00:32:36.568Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `888fc747d1e265df772a08bb0ca5ac94ce0df5461b02b4fafe02e8264b1508f8`
- Record `2cf76e11dfee2843cf4eaf851371fb808bc94d504f9b1ec796820711ec8693ca`, run `FR-6b9d82945a5b0281343c81e1`, 2026-10-26T00:32:36.568Z to 2026-10-26T00:32:43.426Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2880 fly-seconds, then again for the determinism guard
- Code: commit `06ff901fae549bb121d80c9b61e0f5c6b61faf77`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
