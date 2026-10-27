# FLY-bceceeca92ad000d30821761: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Obstacle avoidance: turning away from surfaces whose time to contact falls below 0.45 s, against avoidance off (avoidTtcS = 0).

**Question (host-written).** In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds?

**Hypothesis (host-written).** Turning away from surfaces whose time to contact falls below 0.45 s will decrease cruise_collision_episodes_per_m by at least 0.12 1/m on average over 10 matched seeds drawn after preregistration, compared with avoidance off (avoidTtcS = 0), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown. — competing: [scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1012619799, 1487612848, 2609848606, 2472022321, 3098492659, 3184870199, 1792861686, 2016846943, 4112421622, 1152704355.

## Primary metric: cruise_collision_episodes_per_m (1/m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1012619799 | 0.041 | 0.000 | -0.041 | expected | `e5d2b6f5085a` |
| 1487612848 | 0.165 | 0.000 | -0.165 | expected | `bbc03f912041` |
| 2609848606 | 0.047 | 0.000 | -0.047 | expected | `2688e8b77348` |
| 2472022321 | 0.234 | 0.000 | -0.234 | expected | `474989a06d0d` |
| 3098492659 | 0.196 | 0.000 | -0.196 | expected | `5a2eb8d3a155` |
| 3184870199 | 0.042 | 0.000 | -0.042 | expected | `836efccd9642` |
| 1792861686 | 0.195 | 0.000 | -0.195 | expected | `44d08cfbae10` |
| 2016846943 | 0.146 | 0.000 | -0.146 | expected | `d792866154ab` |
| 4112421622 | 0.169 | 0.000 | -0.169 | expected | `711311d9a571` |
| 1152704355 | 0.181 | 0.000 | -0.181 | expected | `de78cea5b34d` |

10 of 10 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 9.77e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.142, mean treatment 0.000, mean paired difference **-0.142** (minimum effect 0.12 1/m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 10.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.12: observed -0.1416 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0010 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0055-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.142 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.142 | 0.000 | 1/m |
| collision_episodes | 3.100 | 0.000 | count |
| near_miss_fraction | 0.147 | 0.037 | fraction |
| flown_m | 22.215 | 21.146 | m |
| saccades_per_flight_s | 0.451 | 0.479 | 1/s |
| contact_s | 0.015 | 0.000 | s |

## Provenance

- Plan `bceceeca92ad000d30821761d4af4528dce6e3a0a091dd08dcd28af82706cfbb`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `c684a7f0002390bee7e62d529bc459479c35e45465749ad174bd99aca71a5f8a`, source `a96a496c4c00acead32e208158faf7889c31027b8dccde781059a4eb4481f70b`
- Preregistered as V3D-EXP-0055 at 2026-10-27T04:07:37.084Z (receipt `cf90de40f06791f98b897af885d81167bf764ba1fda0c72790363f0e1a2a66fd`)
- Authorized at 2026-10-27T04:07:37.201Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `d1beb764a9ca9f24c549c9103f8f4dd98b6d76b53d7297b18e01c18a6cadcbec`
- Record `3ce68cdce4f234e614f0b561c68584ee796236002f5e4fb0b76eeb026d404735`, run `FR-9afdcad9c10f81d31e77c6e6`, 2026-10-27T04:07:37.239Z to 2026-10-27T04:08:12.651Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2400 fly-seconds, then again for the determinism guard
- Code: commit `352fafda07d29c0d7f4f412073dc129fc5ac7a63`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
