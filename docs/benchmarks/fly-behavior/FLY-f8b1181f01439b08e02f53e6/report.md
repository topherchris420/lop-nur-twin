# FLY-f8b1181f01439b08e02f53e6: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/2 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.

**Protocol.** Light preference: a point light of relative intensity 2 above one quadrant of the arena, against no point light (ambient only); seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12.

**Question (host-written).** In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds?

**Hypothesis (host-written).** A point light of relative intensity 2 above one quadrant of the arena will decrease mean_light_distance_m by at least 0.1 m on average over matched seeds, compared with no point light (ambient only), in the expected direction in at least 8 of 12 seeds.

**Design words (scripted).** [scripted] With a point light on, the fly's mean horizontal distance to the point below it falls. — competing: [scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | treatment final state |
| ---: | ---: | ---: | ---: | :--- |
| 1 | 1.188 | 0.990 | -0.198 | `97cea7424e94` |
| 2 | 1.348 | 0.906 | -0.441 | `9b4142223e2b` |
| 3 | 1.177 | 1.107 | -0.070 | `193fb5e9b6a5` |
| 4 | 0.857 | 1.006 | 0.149 | `69c9b0479db2` |
| 5 | 1.425 | 0.964 | -0.461 | `1f243778fe73` |
| 6 | 1.288 | 1.241 | -0.047 | `5b286ed827fc` |
| 7 | 1.547 | 1.579 | 0.032 | `17f8b5653fe3` |
| 8 | 1.448 | 1.700 | 0.252 | `66a8a0e12b14` |
| 9 | 1.478 | 1.461 | -0.017 | `d45f7f9dc460` |
| 10 | 1.434 | 1.052 | -0.381 | `7828caf1d04c` |
| 11 | 1.544 | 1.106 | -0.438 | `d2f821bb6541` |
| 12 | 1.366 | 0.905 | -0.461 | `71a9a344ddc0` |

Mean control 1.342, mean treatment 1.168, mean paired difference **-0.174**; 9 of 12 seeds in the expected direction, 3 opposite, 0 unchanged.

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.000 — holds
- **G2** determinism_check >= 1: observed 1.000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.174 — holds
- **S2** seeds_expected_direction >= 8: observed 9.000 — holds
- **F1** mean_paired_delta >= 0: observed -0.174 — does not hold

Registry run `V3D-EXP-0002-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| mean_light_distance_m | 1.342 | 1.168 | m |
| time_near_light | 0.075 | 0.382 | fraction |
| active_fraction | 0.204 | 0.286 | fraction |

## Provenance

- Plan digest `f8b1181f01439b08e02f53e6a225fec6e35518e2fe5c2cad5f457c55a4282230`, fly `digital-fly/2 reduced-order-fsm/v1` with parameter table `c1374e61ce7a9d2e89b12759ab33401b9b6ea8074e21404390d9810078642daa`
- Record `dd08ff0c32a77d573dd90173b4c543be2381b33ec2b348f1f0ed3c86f591d560`, run `FR-cd37e283f386faf049a07cd5`; authorized by Scripted.DemoOperator (local operator attestation; identity not verified)
- 2880 fly-seconds simulated, then simulated again for the determinism guard
- Producing commit `b8400fdf3f676d6ee9e090760921eff7c419df22` with uncommitted changes
- Design written by a script (no model involved)

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
