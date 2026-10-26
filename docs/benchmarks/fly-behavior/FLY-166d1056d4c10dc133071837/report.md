# FLY-166d1056d4c10dc133071837: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Obstacle avoidance: turning away from surfaces whose time to contact falls below 0.45 s, against avoidance off (avoidTtcS = 0).

**Question (host-written).** In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds?

**Hypothesis (host-written).** Turning away from surfaces whose time to contact falls below 0.45 s will decrease cruise_collision_episodes_per_m by at least 0.12 1/m on average over 10 matched seeds drawn after preregistration, compared with avoidance off (avoidTtcS = 0), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown. — competing: [scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 494189570, 220326228, 569384506, 4286322594, 852420236, 794650779, 3810252172, 3092663708, 1593478421, 65331547.

## Primary metric: cruise_collision_episodes_per_m (1/m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 494189570 | 0.457 | 0.000 | -0.457 | expected | `29241cbd7543` |
| 220326228 | 0.043 | 0.000 | -0.043 | expected | `768b9391750a` |
| 569384506 | 0.000 | 0.000 | 0.000 | tie | `3ae00c10f344` |
| 4286322594 | 0.132 | 0.042 | -0.090 | expected | `6325ebf74340` |
| 852420236 | 0.106 | 0.000 | -0.106 | expected | `f11a00aeb54a` |
| 794650779 | 0.136 | 0.000 | -0.136 | expected | `ae5bd16218aa` |
| 3810252172 | 0.102 | 0.000 | -0.102 | expected | `b444494a9845` |
| 3092663708 | 0.102 | 0.000 | -0.102 | expected | `46916199d96c` |
| 1593478421 | 0.049 | 0.000 | -0.049 | expected | `8404a91f305b` |
| 65331547 | 0.123 | 0.000 | -0.123 | expected | `bc68508826e8` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.125, mean treatment 0.004, mean paired difference **-0.121** (minimum effect 0.12 1/m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.12: observed -0.1208 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0001-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.125 | 0.004 | 1/m |
| cruise_collision_episodes_per_m | 0.125 | 0.004 | 1/m |
| collision_episodes | 2.500 | 0.100 | count |
| near_miss_fraction | 0.147 | 0.035 | fraction |
| flown_m | 20.914 | 21.165 | m |
| saccades_per_flight_s | 0.504 | 0.555 | 1/s |
| contact_s | 0.012 | 0.001 | s |

## Provenance

- Plan `166d1056d4c10dc1330718376b183a9c0691f77003313bb5b750cda90521d5ff`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `309bc659d993b7c1affb6353a5aac0e434e9fc502d8d9477013d3af7296aaf38`, source `b9abf944d6d246ff622184e4b0d29ccdf4e3966665643958ab4585d67f4b0aff`
- Preregistered as V3D-EXP-0001 at 2026-10-26T00:32:00.387Z (receipt `817b66841203031eb23a8472bed632310a5fd09a56986dfb71e6e28b0e56ff6c`)
- Authorized at 2026-10-26T00:32:00.416Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `5318d213499320267da0e46fd136b20f8500a9b25b75e44d04af86496c9d7614`
- Record `8ccce64cfd7645ad514f443663f59cad959c0d496f8dd3e1c774fa96e0ebb0cb`, run `FR-c48233e712bffc473a030bc8`, 2026-10-26T00:32:00.420Z to 2026-10-26T00:32:18.724Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2400 fly-seconds, then again for the determinism guard
- Code: commit `06ff901fae549bb121d80c9b61e0f5c6b61faf77`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
