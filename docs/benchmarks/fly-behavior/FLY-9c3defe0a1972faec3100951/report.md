# FLY-9c3defe0a1972faec3100951: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Light preference: a point light of relative intensity 2 above one quadrant of the arena, against no point light (ambient only).

**Question (host-written).** In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds?

**Hypothesis (host-written).** A point light of relative intensity 2 above one quadrant of the arena will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with no point light (ambient only), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] With a point light on, the fly's mean horizontal distance to the point below it falls. — competing: [scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3396579386, 3732577911, 1988211009, 2235001800, 1332839280, 159707712, 1779818154, 2527246538, 928455795, 2227471009, 236469496, 59771178.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3396579386 | 1.300 | 0.692 | -0.608 | expected | `8df7f478bab3` |
| 3732577911 | 1.536 | 0.985 | -0.551 | expected | `dda66ba524c1` |
| 1988211009 | 1.642 | 1.594 | -0.048 | expected | `7e5779aa09c4` |
| 2235001800 | 0.950 | 1.585 | 0.635 | opposite | `aae1df48dd0f` |
| 1332839280 | 1.514 | 2.227 | 0.713 | opposite | `bf8c2d8125cf` |
| 159707712 | 2.384 | 1.665 | -0.719 | expected | `0239f739412f` |
| 1779818154 | 1.510 | 1.532 | 0.022 | opposite | `099fdd31d298` |
| 2527246538 | 1.540 | 1.516 | -0.025 | expected | `0e88559fca41` |
| 928455795 | 2.286 | 2.283 | -0.003 | expected | `3b9bdffe9d33` |
| 2227471009 | 1.507 | 1.540 | 0.033 | opposite | `728f82ae0ff0` |
| 236469496 | 1.395 | 1.278 | -0.117 | expected | `824f3d32553a` |
| 59771178 | 1.544 | 1.559 | 0.015 | opposite | `4628168e296d` |

7 of 12 untied seeds in the expected direction (decrease), 5 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.3872 for the expected direction, p = 0.8062 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.592, mean treatment 1.538, mean paired difference **-0.054** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.0545 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.3872 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.8062 — does not hold

Success criteria not all met (S1, S2) and no failure criterion triggered.

Registry run `V3D-EXP-0002-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| mean_light_distance_m | 1.592 | 1.538 | m |
| time_near_light | 0.076 | 0.088 | fraction |
| active_fraction | 0.216 | 0.294 | fraction |

## Provenance

- Plan `9c3defe0a1972faec310095101ca05eb8c5422770b639eae3f16d1fb35b4a9ab`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `247197565afacdeda5b29bdca1a24744fd547120e39f1a35621689f2e9c90905`, source `d77a3a3961b0700f93c794a7dd8e0f3d3a9c0fd68661cfc324711c1ebf407c6c`
- Preregistered as V3D-EXP-0002 at 2026-10-24T21:22:19.047Z (receipt `a43f338e3541959aec06e64027c20fc4e6f7c474096efb5f1d666a1d9f898f35`)
- Authorized at 2026-10-24T21:22:19.063Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `e316b65a91b804268308f6211eea54c47c9adfcbaddea8477b5d07309f29361b`
- Record `f92cac37d06c4f2a64290e86b1071fb23278622910edfd5e4b5d5a9252898060`, run `FR-2081f0f7a9d6b64221dd9e6e`, 2026-10-24T21:22:19.064Z to 2026-10-24T21:22:25.321Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2880 fly-seconds, then again for the determinism guard
- Code: commit `74216e15e42796df5684c31d82522e7234054d76`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
