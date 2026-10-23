# FLY-a9125081ec711c7917a769e5: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/2 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.

**Protocol.** Obstacle avoidance: turning away from surfaces whose time to contact falls below 0.45 s, against avoidance off (avoidTtcS = 0); seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12.

**Question (host-written).** In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds?

**Hypothesis (host-written).** Turning away from surfaces whose time to contact falls below 0.45 s will decrease cruise_collision_episodes_per_m by at least 0.1 1/m on average over matched seeds, compared with avoidance off (avoidTtcS = 0), in the expected direction in at least 8 of 12 seeds.

**Design words (scripted).** [scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown. — competing: [scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.

## Primary metric: cruise_collision_episodes_per_m (1/m)

| seed | control | treatment | difference | treatment final state |
| ---: | ---: | ---: | ---: | :--- |
| 1 | 0.000 | 0.000 | 0.000 | `6ee7157ae800` |
| 2 | 0.000 | 0.000 | 0.000 | `49728160dd38` |
| 3 | 0.000 | 0.000 | 0.000 | `978b0cd67ce7` |
| 4 | 0.156 | 0.000 | -0.156 | `a3ab5fb41290` |
| 5 | 0.000 | 0.000 | 0.000 | `7e3d1352c5b0` |
| 6 | 0.000 | 0.000 | 0.000 | `d47ea4e54b57` |
| 7 | 0.084 | 0.000 | -0.084 | `f051ea851a54` |
| 8 | 0.000 | 0.000 | 0.000 | `f155a7088d66` |
| 9 | 0.100 | 0.000 | -0.100 | `0fb3feb80da1` |
| 10 | 0.000 | 0.000 | 0.000 | `4d17e01b02f7` |
| 11 | 0.000 | 0.000 | 0.000 | `a51b30114e47` |
| 12 | 0.000 | 0.000 | 0.000 | `5995b642816b` |

Mean control 0.028, mean treatment 0.000, mean paired difference **-0.028**; 3 of 12 seeds in the expected direction, 0 opposite, 9 unchanged.

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.000 — holds
- **G2** determinism_check >= 1: observed 1.000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.028 — does not hold
- **S2** seeds_expected_direction >= 8: observed 3.000 — does not hold
- **F1** mean_paired_delta >= 0: observed -0.028 — does not hold

Registry run `V3D-EXP-0001-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.028 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.028 | 0.000 | 1/m |
| collision_episodes | 0.250 | 0.000 | count |
| flown_m | 10.270 | 10.210 | m |
| saccades_per_flight_s | 0.560 | 0.593 | 1/s |
| contact_s | 0.537 | 0.000 | s |

## Provenance

- Plan digest `a9125081ec711c7917a769e57b32ab4cdbac9632effa99c869c697b0d1ee56c6`, fly `digital-fly/2 reduced-order-fsm/v1` with parameter table `c1374e61ce7a9d2e89b12759ab33401b9b6ea8074e21404390d9810078642daa`
- Record `b4c4753e9f097fae0206d3aa562352e41e79658c57972eec19d33f1b43f6033b`, run `FR-293a69b603c1e0865010dcfc`; authorized by Scripted.DemoOperator (local operator attestation; identity not verified)
- 1440 fly-seconds simulated, then simulated again for the determinism guard
- Producing commit `b8400fdf3f676d6ee9e090760921eff7c419df22` with uncommitted changes
- Design written by a script (no model involved)

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
