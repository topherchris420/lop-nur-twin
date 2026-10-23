# FLY-796670400e2762fd99801223: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/2 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.

**Protocol.** Controller comparison: controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5), against controller configuration A (the default parameters); seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12.

**Question (host-written).** In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds?

**Hypothesis (host-written).** Controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) will decrease mean_light_distance_m by at least 0.1 m on average over matched seeds, compared with controller configuration A (the default parameters), in the expected direction in at least 8 of 12 seeds.

**Design words (scripted).** [scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light. — competing: [scripted] Steering gain matters less than how often the fly flies, which both configurations share.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | treatment final state |
| ---: | ---: | ---: | ---: | :--- |
| 1 | 0.990 | 0.883 | -0.107 | `e4d8cb27ef59` |
| 2 | 0.906 | 0.828 | -0.078 | `2a7b64ce114c` |
| 3 | 1.107 | 1.121 | 0.014 | `f91df4a2b812` |
| 4 | 1.006 | 0.940 | -0.066 | `f2d6f9d12147` |
| 5 | 0.964 | 0.882 | -0.082 | `42b229705881` |
| 6 | 1.241 | 0.698 | -0.542 | `9e6d69c7e27e` |
| 7 | 1.579 | 1.579 | 0.000 | `17f8b5653fe3` |
| 8 | 1.700 | 1.679 | -0.021 | `438b50b89b51` |
| 9 | 1.461 | 1.450 | -0.011 | `0f83137ec78c` |
| 10 | 1.052 | 0.858 | -0.194 | `5adc95246a20` |
| 11 | 1.106 | 1.099 | -0.007 | `c19234ace259` |
| 12 | 0.905 | 0.485 | -0.420 | `d3754d2853e8` |

Mean control 1.168, mean treatment 1.042, mean paired difference **-0.126**; 10 of 12 seeds in the expected direction, 1 opposite, 1 unchanged.

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 72: observed 72.000 — holds
- **G2** determinism_check >= 1: observed 1.000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.126 — holds
- **S2** seeds_expected_direction >= 8: observed 10.000 — holds
- **F1** mean_paired_delta >= 0: observed -0.126 — does not hold

Registry run `V3D-EXP-0006-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| collision_episodes | 0.000 | 0.000 | count |
| flown_m | 10.210 | 9.692 | m |
| saccades_per_flight_s | 0.593 | 0.594 | 1/s |
| contact_s | 0.000 | 0.000 | s |
| escape_probability | 0.931 | 0.931 | fraction |
| escape_latency_s | 0.907 | 0.907 | s |
| escape_lead_s | 0.013 | 0.013 | s |
| size_at_escape_deg | 50.284 | 50.284 | deg |
| short_mode_fraction | 0.047 | 0.047 | fraction |
| mean_light_distance_m | 1.168 | 1.042 | m |
| time_near_light | 0.382 | 0.432 | fraction |
| active_fraction | 0.286 | 0.286 | fraction |

## Provenance

- Plan digest `796670400e2762fd99801223e158d526f68e39f12647027405eba0a70eb3dc5d`, fly `digital-fly/2 reduced-order-fsm/v1` with parameter table `c1374e61ce7a9d2e89b12759ab33401b9b6ea8074e21404390d9810078642daa`
- Record `a2ff31ea4e0157da962d1a1283418a0c7468eedaad2707f5f3b800d34e78e632`, run `FR-ad4a853a4515bf3a3b5f3ee1`; authorized by Scripted.DemoOperator (local operator attestation; identity not verified)
- 4639.68 fly-seconds simulated, then simulated again for the determinism guard
- Producing commit `b8400fdf3f676d6ee9e090760921eff7c419df22` with uncommitted changes
- Design written by a script (no model involved)

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
