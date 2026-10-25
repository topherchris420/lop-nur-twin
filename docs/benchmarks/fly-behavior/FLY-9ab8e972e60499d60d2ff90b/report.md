# FLY-9ab8e972e60499d60d2ff90b: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Light preference: a point light of relative intensity 2 above one quadrant of the arena, against no point light (ambient only).

**Question (host-written).** In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds?

**Hypothesis (host-written).** A point light of relative intensity 2 above one quadrant of the arena will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with no point light (ambient only), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] With a point light on, the fly's mean horizontal distance to the point below it falls. — competing: [scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1677248927, 3468225926, 913531920, 4259592074, 2221109814, 1897188146, 1030803212, 1489284865, 1729639039, 4192122039, 3552570869, 1184250298.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1677248927 | 1.626 | 1.833 | 0.206 | opposite | `8228c2629ca2` |
| 3468225926 | 1.812 | 1.854 | 0.042 | opposite | `c308fbee6530` |
| 913531920 | 1.789 | 2.261 | 0.472 | opposite | `63157a5f6b77` |
| 4259592074 | 1.367 | 1.581 | 0.214 | opposite | `1b37742fe205` |
| 2221109814 | 1.165 | 0.481 | -0.684 | expected | `ea2f66516e3e` |
| 1897188146 | 1.062 | 1.433 | 0.372 | opposite | `e5012729e304` |
| 1030803212 | 1.802 | 1.631 | -0.171 | expected | `aad23992e9a6` |
| 1489284865 | 1.998 | 1.944 | -0.054 | expected | `5bd24e7ea96c` |
| 1729639039 | 1.546 | 1.662 | 0.117 | opposite | `06a3d360787f` |
| 4192122039 | 1.381 | 1.427 | 0.047 | opposite | `8a2b7d9ef769` |
| 3552570869 | 1.414 | 0.852 | -0.562 | expected | `7dedcffceb22` |
| 1184250298 | 1.261 | 0.892 | -0.368 | expected | `1c1a562015e0` |

5 of 12 untied seeds in the expected direction (decrease), 7 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.8062 for the expected direction, p = 0.3872 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.518, mean treatment 1.488, mean paired difference **-0.031** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.0308 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.8062 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.3872 — does not hold

Success criteria not all met (S1, S2) and no failure criterion triggered.

Registry run `V3D-EXP-0002-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| mean_light_distance_m | 1.518 | 1.488 | m |
| time_near_light | 0.005 | 0.163 | fraction |
| active_fraction | 0.213 | 0.338 | fraction |

## Provenance

- Plan `9ab8e972e60499d60d2ff90b20ea73008849e780758e09a97dba96adc3bdd858`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `8fa862d0a358e1d8f3c36ea20bcc47f293ef42c1413ff1db2c9a6ebf3f086911`, source `e838b010f63674a8e7c6364631eff58473fbb0ef96fbd5d0e69b399a4303c485`
- Preregistered as V3D-EXP-0002 at 2026-10-25T19:48:31.795Z (receipt `57b6057a609571c0c60f4ab9262c43b010b038596cb2bac0622842119bba16b3`)
- Authorized at 2026-10-25T19:48:31.806Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `be522b371be2d8c3562abc7c91b41a714e78174f8af741286442441e33b118be`
- Record `4eb2f3b9adc7db1e15f175ebec13b7296db62319e621ae7e7e168edd8d070825`, run `FR-b08350d48b5d10105ff67540`, 2026-10-25T19:48:31.806Z to 2026-10-25T19:48:34.828Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2880 fly-seconds, then again for the determinism guard
- Code: commit `94539a4a3edb9ffa588d4e7f5e864c55e293d80a`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
