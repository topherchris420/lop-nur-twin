# FLY-b34650c99144db55653d2e09: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/5 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Obstacle avoidance: turning away from surfaces whose time to contact falls below 0.45 s, against avoidance off (avoidTtcS = 0).

**Question (host-written).** In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds?

**Hypothesis (host-written).** Turning away from surfaces whose time to contact falls below 0.45 s will decrease cruise_collision_episodes_per_m by at least 0.12 1/m on average over 10 matched seeds drawn after preregistration, compared with avoidance off (avoidTtcS = 0), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown. — competing: [scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 915098089, 1194660522, 1292725664, 916163187, 851158335, 2967923258, 4153710011, 2280318712, 1625320717, 4183016921.

## Primary metric: cruise_collision_episodes_per_m (1/m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 915098089 | 0.055 | 0.000 | -0.055 | expected | `80fc66313649` |
| 1194660522 | 0.000 | 0.000 | 0.000 | tie | `b32c2bf3c062` |
| 1292725664 | 0.061 | 0.000 | -0.061 | expected | `69a37e3cbd00` |
| 916163187 | 0.046 | 0.000 | -0.046 | expected | `ebb2d2f66cfc` |
| 851158335 | 0.046 | 0.000 | -0.046 | expected | `261aed8202ab` |
| 2967923258 | 0.122 | 0.000 | -0.122 | expected | `40c60bc83430` |
| 4153710011 | 0.052 | 0.000 | -0.052 | expected | `93b14f76c555` |
| 2280318712 | 0.077 | 0.000 | -0.077 | expected | `4e85f37e0c44` |
| 1625320717 | 0.285 | 0.000 | -0.285 | expected | `511847af9717` |
| 4183016921 | 0.096 | 0.050 | -0.046 | expected | `027ceec39c94` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.084, mean treatment 0.005, mean paired difference **-0.079** (minimum effect 0.12 1/m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.12: observed -0.0789 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

Success criteria not all met (S1) and no failure criterion triggered.

Registry run `V3D-EXP-0001-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.084 | 0.005 | 1/m |
| cruise_collision_episodes_per_m | 0.084 | 0.005 | 1/m |
| collision_episodes | 1.800 | 0.100 | count |
| near_miss_fraction | 0.095 | 0.037 | fraction |
| flown_m | 20.149 | 19.274 | m |
| saccades_per_flight_s | 0.526 | 0.568 | 1/s |
| contact_s | 0.009 | 0.001 | s |

## Provenance

- Plan `b34650c99144db55653d2e09385e16504bf836e8e2d39bd633b62e2d7b2a787a`; fly `digital-fly/5 reduced-order-fsm/v1`, identity `aeefc422fb7ee9ac538fe71c558eefcf8aacb8bf84fcf56b45b9085e6e296fa7`, source `0f6eef0366d07c5e8abedbad54bb5eaf3b922b10a7c2ff0447b1bf9ca16b25d7`
- Preregistered as V3D-EXP-0001 at 2026-10-24T16:10:42.977Z (receipt `2075468ee89a0255617454dc746e794989b77a54b947dc141cbf106d2a06858b`)
- Authorized at 2026-10-24T16:10:43.000Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `014ccecc0895700db605646c2098a69ad58c00eb031b3bc9e6d728e7258efeff`
- Record `d400764018025ea94fb87edb14c44c3c2edffe9b5b5a6a5f7955fe9b66457e50`, run `FR-d5bb07829bd5651691a7e529`, 2026-10-24T16:10:43.004Z to 2026-10-24T16:10:57.484Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2400 fly-seconds, then again for the determinism guard
- Code: commit `f8cdf135f830bdfecce08f1fd1a38d992767c365`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
