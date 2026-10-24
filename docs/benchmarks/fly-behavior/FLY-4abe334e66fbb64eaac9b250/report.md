# FLY-4abe334e66fbb64eaac9b250: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/5 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Light preference: a point light of relative intensity 2 above one quadrant of the arena, against no point light (ambient only).

**Question (host-written).** In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds?

**Hypothesis (host-written).** A point light of relative intensity 2 above one quadrant of the arena will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with no point light (ambient only), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] With a point light on, the fly's mean horizontal distance to the point below it falls. — competing: [scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1301588747, 2272631372, 2828897585, 1265376471, 1107967675, 2672809807, 3248872375, 685766210, 467624615, 2760373293, 2508601355, 4162373057.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1301588747 | 2.228 | 2.492 | 0.263 | opposite | `f0c199e64c47` |
| 2272631372 | 1.235 | 0.576 | -0.660 | expected | `9053b962a365` |
| 2828897585 | 1.314 | 0.653 | -0.661 | expected | `0a135473eb65` |
| 1265376471 | 1.557 | 1.425 | -0.132 | expected | `ae1ed02ad9dd` |
| 1107967675 | 1.041 | 0.490 | -0.551 | expected | `9c341fdfc5f2` |
| 2672809807 | 1.579 | 0.731 | -0.848 | expected | `358e713e6b20` |
| 3248872375 | 1.045 | 0.561 | -0.484 | expected | `cbfc3e293d0f` |
| 685766210 | 1.891 | 1.736 | -0.155 | expected | `bdc10d275a82` |
| 467624615 | 0.859 | 1.204 | 0.345 | opposite | `962ef2f0b9be` |
| 2760373293 | 1.564 | 1.647 | 0.082 | opposite | `40f50ed4e8ec` |
| 2508601355 | 2.214 | 1.862 | -0.352 | expected | `30afade148af` |
| 4162373057 | 1.281 | 0.754 | -0.527 | expected | `211ebdd68c3a` |

9 of 12 untied seeds in the expected direction (decrease), 3 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0730 for the expected direction, p = 0.9807 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.484, mean treatment 1.178, mean paired difference **-0.307** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.3066 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0730 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.9807 — does not hold

Success criteria not all met (S2) and no failure criterion triggered.

Registry run `V3D-EXP-0002-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| mean_light_distance_m | 1.484 | 1.178 | m |
| time_near_light | 0.119 | 0.380 | fraction |
| active_fraction | 0.246 | 0.343 | fraction |

## Provenance

- Plan `4abe334e66fbb64eaac9b2508212fb729b59fe4899aab5186d5ad7ccf220a7b3`; fly `digital-fly/5 reduced-order-fsm/v1`, identity `aeefc422fb7ee9ac538fe71c558eefcf8aacb8bf84fcf56b45b9085e6e296fa7`, source `0f6eef0366d07c5e8abedbad54bb5eaf3b922b10a7c2ff0447b1bf9ca16b25d7`
- Preregistered as V3D-EXP-0002 at 2026-10-24T16:11:12.948Z (receipt `ce8af139b118ecfff735b411259c5bdb9c99fc28896813c10bfac3a68c140134`)
- Authorized at 2026-10-24T16:11:12.960Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `d1e7f9d54f8fa4b53a81fc9e09f198e3551fadc7c828e14f16521a76db1bb464`
- Record `74296d146be7c4afce51f09eed83de9999f9fde15de8e0e92bc2b900d1dbe5f8`, run `FR-0be6470fd21745405af3823c`, 2026-10-24T16:11:12.960Z to 2026-10-24T16:11:17.993Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2880 fly-seconds, then again for the determinism guard
- Code: commit `f8cdf135f830bdfecce08f1fd1a38d992767c365`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
