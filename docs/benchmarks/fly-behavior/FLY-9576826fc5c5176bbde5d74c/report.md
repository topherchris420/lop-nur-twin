# FLY-9576826fc5c5176bbde5d74c: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Obstacle avoidance: turning away from surfaces whose time to contact falls below 0.45 s, against avoidance off (avoidTtcS = 0).

**Question (host-written).** In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds?

**Hypothesis (host-written).** Turning away from surfaces whose time to contact falls below 0.45 s will decrease cruise_collision_episodes_per_m by at least 0.12 1/m on average over 10 matched seeds drawn after preregistration, compared with avoidance off (avoidTtcS = 0), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown. — competing: [scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1110146337, 1021951753, 476543326, 2488749612, 2653775979, 1852306693, 3209785474, 4057927299, 2291876239, 716941019.

## Primary metric: cruise_collision_episodes_per_m (1/m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1110146337 | 0.272 | 0.000 | -0.272 | expected | `7535b9c71b37` |
| 1021951753 | 0.243 | 0.000 | -0.243 | expected | `f4a5346beee9` |
| 476543326 | 0.256 | 0.000 | -0.256 | expected | `99311c1ccd77` |
| 2488749612 | 0.321 | 0.000 | -0.321 | expected | `ebe1a74ae42c` |
| 2653775979 | 0.105 | 0.000 | -0.105 | expected | `26e806e8899e` |
| 1852306693 | 0.472 | 0.000 | -0.472 | expected | `0c64ef5e1862` |
| 3209785474 | 0.090 | 0.000 | -0.090 | expected | `5eb0c80c5a98` |
| 4057927299 | 0.474 | 0.000 | -0.474 | expected | `00daa7731960` |
| 2291876239 | 0.134 | 0.000 | -0.134 | expected | `a582f509c265` |
| 716941019 | 0.050 | 0.000 | -0.050 | expected | `f4579663ea9c` |

10 of 10 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 9.77e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.242, mean treatment 0.000, mean paired difference **-0.242** (minimum effect 0.12 1/m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 10.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.12: observed -0.2417 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0010 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0019-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.242 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.242 | 0.000 | 1/m |
| collision_episodes | 4.500 | 0.000 | count |
| near_miss_fraction | 0.195 | 0.045 | fraction |
| flown_m | 19.870 | 20.547 | m |
| saccades_per_flight_s | 0.535 | 0.550 | 1/s |
| contact_s | 0.022 | 0.000 | s |

## Provenance

- Plan `9576826fc5c5176bbde5d74c49411e3ff177ffcab2151077c009eb0b63901de0`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `44a4d99fc81cf563bb4ff40377cff7d1ae9881d95c6cf3b17851e5804539805d`, source `b794ba087d2c9dbb0d589758d6d2e0a89d958b3f2b626d50ab3388266513a682`
- Preregistered as V3D-EXP-0019 at 2026-10-26T05:40:21.823Z (receipt `4a93e10c4be7b63dc73f7a25d65ce9fada903e4a521c29c2aeab431e5da8a2bf`)
- Authorized at 2026-10-26T05:40:21.946Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `2f94ffb7f9f533c524049fef773b03497de75069144fb5faf909412b2fb53fed`
- Record `a8249a5968a82f0844c03f053e4fcde4a9abfea96def33ef427328c81d822417`, run `FR-132d5246c5a2812ead7e843e`, 2026-10-26T05:40:22.039Z to 2026-10-26T05:40:59.946Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2400 fly-seconds, then again for the determinism guard
- Code: commit `6ea1990ebc33011e02ad26083bebb719dc837d1b`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
