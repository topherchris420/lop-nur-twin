# FLY-6b046ef977b6e4f11f6e2bbf: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/4 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Light preference: a point light of relative intensity 2 above one quadrant of the arena, against no point light (ambient only).

**Question (host-written).** In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds?

**Hypothesis (host-written).** A point light of relative intensity 2 above one quadrant of the arena will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with no point light (ambient only), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] With a point light on, the fly's mean horizontal distance to the point below it falls. — competing: [scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 113247615, 2085976274, 3570308851, 3946645561, 885509919, 1562764701, 2842834130, 4091728263, 1845322161, 2922364332, 666061252, 1524730902.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 113247615 | 1.257 | 0.493 | -0.765 | expected | `84a0e35c94fb` |
| 2085976274 | 1.739 | 1.609 | -0.130 | expected | `f3af917c2748` |
| 3570308851 | 2.109 | 1.150 | -0.960 | expected | `060705a2c038` |
| 3946645561 | 1.478 | 1.537 | 0.059 | opposite | `8edd51c04755` |
| 885509919 | 1.401 | 1.856 | 0.455 | opposite | `2f9106c48cca` |
| 1562764701 | 1.583 | 1.635 | 0.053 | opposite | `94f471d9d6f4` |
| 2842834130 | 1.602 | 2.057 | 0.455 | opposite | `302089dba7ef` |
| 4091728263 | 1.223 | 1.074 | -0.149 | expected | `ef8ecc22c656` |
| 1845322161 | 1.758 | 0.579 | -1.179 | expected | `1aae91c312a7` |
| 2922364332 | 1.192 | 0.559 | -0.633 | expected | `ad48206b0a0e` |
| 666061252 | 1.134 | 1.424 | 0.290 | opposite | `e0b35ad4b3e5` |
| 1524730902 | 1.812 | 1.039 | -0.773 | expected | `e70540ccb67a` |

7 of 12 untied seeds in the expected direction (decrease), 5 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.3872 for the expected direction, p = 0.8062 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.524, mean treatment 1.251, mean paired difference **-0.273** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.2732 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.3872 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.8062 — does not hold

Success criteria not all met (S2) and no failure criterion triggered.

Registry run `V3D-EXP-0014-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| mean_light_distance_m | 1.524 | 1.251 | m |
| time_near_light | 0.019 | 0.330 | fraction |
| active_fraction | 0.185 | 0.367 | fraction |

## Provenance

- Plan `6b046ef977b6e4f11f6e2bbfadd62e868d5ff9151a7570628ec8782f08f11c99`; fly `digital-fly/4 reduced-order-fsm/v1`, identity `02776ebf688fc2989a8fe4f6871b30825e567d27ea64b5aecfd3ecf2760b448c`, source `69a28d5897711f339ac6fe76bbd486a76310346b93b62093ce8874c12331380e`
- Preregistered as V3D-EXP-0014 at 2026-10-24T02:50:49.301Z (receipt `e7a111f13a2101c2bd63c3537c5ca632223e28496f11c242d386fa2d9d17338a`)
- Authorized at 2026-10-24T02:50:49.322Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `36adb82b5634c7165ab96af21affc4e00cd850e49570d6ac985030692584cbf8`
- Record `921436c7444dc9b20b570a5fcc21b9888ab888362f3c860127f15aca90589df2`, run `FR-078b637182980e75dbac8b9a`, 2026-10-24T02:50:49.324Z to 2026-10-24T02:50:59.005Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2880 fly-seconds, then again for the determinism guard
- Code: commit `c0f72973e32a0e9924a909da2a70b480994879e6`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
