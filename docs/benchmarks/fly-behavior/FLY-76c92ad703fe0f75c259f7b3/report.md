# FLY-76c92ad703fe0f75c259f7b3: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/6 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Light preference: a point light of relative intensity 2 above one quadrant of the arena, against no point light (ambient only).

**Question (host-written).** In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds?

**Hypothesis (host-written).** A point light of relative intensity 2 above one quadrant of the arena will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with no point light (ambient only), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] With a point light on, the fly's mean horizontal distance to the point below it falls. — competing: [scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 526966025, 1877375629, 2620642602, 655981031, 473082344, 925811485, 1660440956, 442104326, 2965889078, 2854984004, 507512829, 2780915418.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 526966025 | 1.810 | 1.981 | 0.172 | opposite | `a0705bae76fb` |
| 1877375629 | 1.391 | 1.447 | 0.055 | opposite | `9e9f70b3cea7` |
| 2620642602 | 1.114 | 0.875 | -0.239 | expected | `460aedbcacc4` |
| 655981031 | 1.676 | 1.682 | 0.007 | opposite | `88b9253bfed9` |
| 473082344 | 0.798 | 0.774 | -0.024 | expected | `d28e1703c3f9` |
| 925811485 | 1.833 | 1.662 | -0.171 | expected | `505ade807f4a` |
| 1660440956 | 1.318 | 1.484 | 0.166 | opposite | `6ba54189de23` |
| 442104326 | 1.517 | 0.880 | -0.637 | expected | `1fddd9a64bfb` |
| 2965889078 | 1.367 | 0.585 | -0.782 | expected | `a135100a8b10` |
| 2854984004 | 1.490 | 1.539 | 0.049 | opposite | `0f26c8a05678` |
| 507512829 | 1.389 | 1.045 | -0.344 | expected | `9ce1ebdfcdf3` |
| 2780915418 | 1.649 | 1.834 | 0.185 | opposite | `80fa5b155189` |

6 of 12 untied seeds in the expected direction (decrease), 6 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.6128 for the expected direction, p = 0.6128 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.446, mean treatment 1.316, mean paired difference **-0.130** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.1303 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.6128 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.6128 — does not hold

Success criteria not all met (S2) and no failure criterion triggered.

Registry run `V3D-EXP-0002-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| mean_light_distance_m | 1.446 | 1.316 | m |
| time_near_light | 0.080 | 0.290 | fraction |
| active_fraction | 0.189 | 0.311 | fraction |

## Provenance

- Plan `76c92ad703fe0f75c259f7b329dadf94678d2f13994b9be3877ccaa0c4915aeb`; fly `digital-fly/6 reduced-order-fsm/v1`, identity `ad5cea56d67036ecf47acddc8bcad249ff0eea83de3593c3b9850b524eb4f46d`, source `167ae70ac8ff41678590d70cf73640164392e6c73b9b1613b5f075575b715d87`
- Preregistered as V3D-EXP-0002 at 2026-10-24T19:25:12.889Z (receipt `73a7698a29e0d0181c6dc817b0f823d253a5cfe933774a5a4838aa80a49421f7`)
- Authorized at 2026-10-24T19:25:12.907Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `af75cd78e77a754beabedc2a6daed5b49bac28be0f163dd876882f868de5434e`
- Record `f50c0b77b7ef1335b3ff9ccc1c137117bb392115ad37355c5c832fd636fd16eb`, run `FR-2f4a685c4c6371925fae01a7`, 2026-10-24T19:25:12.908Z to 2026-10-24T19:25:19.285Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2880 fly-seconds, then again for the determinism guard
- Code: commit `300a2aa64e7d8771297c525e8b7159a56e84aeb6`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
