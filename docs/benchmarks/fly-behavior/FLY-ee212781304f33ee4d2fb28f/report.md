# FLY-ee212781304f33ee4d2fb28f: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Controller comparison: controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5), against controller configuration A (the default parameters).

**Question (host-written).** In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds?

**Hypothesis (host-written).** Controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with controller configuration A (the default parameters), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light. — competing: [scripted] Steering gain matters less than how often the fly flies, which both configurations share.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2036293469, 1454189473, 1386441426, 1646002315, 851624458, 3009012462, 1059182829, 755211349, 3969919902, 1683809974, 205533895, 500790317.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2036293469 | 1.561 | 1.561 | 0.000 | tie | `12040d1ae8e8` |
| 1454189473 | 1.551 | 0.995 | -0.557 | expected | `3b8171c3a49f` |
| 1386441426 | 0.940 | 0.796 | -0.145 | expected | `926574f0046e` |
| 1646002315 | 1.303 | 1.303 | -0.000 | expected | `b97b3e3664db` |
| 851624458 | 1.712 | 1.712 | -0.000 | expected | `7bf4761f919d` |
| 3009012462 | 2.030 | 1.508 | -0.522 | expected | `52cf423fc53f` |
| 1059182829 | 1.734 | 0.767 | -0.966 | expected | `58069d37da55` |
| 755211349 | 0.966 | 0.951 | -0.015 | expected | `969ab5d25b12` |
| 3969919902 | 1.958 | 1.958 | 0.000 | tie | `d1ede24c4b90` |
| 1683809974 | 0.696 | 0.581 | -0.115 | expected | `c7b86866fffb` |
| 205533895 | 1.849 | 1.849 | 0.000 | tie | `4217a4ccba6c` |
| 500790317 | 0.912 | 0.810 | -0.102 | expected | `547a62baf74b` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 3 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.434, mean treatment 1.233, mean paired difference **-0.202** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 72: observed 72.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.2019 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0006-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.007 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.007 | 1/m |
| collision_episodes | 0.000 | 0.167 | count |
| near_miss_fraction | 0.048 | 0.068 | fraction |
| flown_m | 19.946 | 19.955 | m |
| saccades_per_flight_s | 0.570 | 0.583 | 1/s |
| contact_s | 0.000 | 0.001 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.089 | 0.089 | s |
| escape_latency_s | 0.911 | 0.911 | s |
| size_at_escape_deg | 54.365 | 54.365 | deg |
| short_mode_fraction | 0.111 | 0.111 | fraction |
| mean_light_distance_m | 1.434 | 1.233 | m |
| time_near_light | 0.194 | 0.295 | fraction |
| active_fraction | 0.326 | 0.329 | fraction |

## Provenance

- Plan `ee212781304f33ee4d2fb28f8f3f34fbfd813e0ff8440baedf9ec0743e88f659`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `8fa862d0a358e1d8f3c36ea20bcc47f293ef42c1413ff1db2c9a6ebf3f086911`, source `e838b010f63674a8e7c6364631eff58473fbb0ef96fbd5d0e69b399a4303c485`
- Preregistered as V3D-EXP-0006 at 2026-10-25T19:49:26.076Z (receipt `f26004b428f9389f8fdf0f8ecb7fb18c21494698f2810375e32badaa1e5eac15`)
- Authorized at 2026-10-25T19:49:26.094Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `e6fb73ed9216f986df7523e3ae8c97ff118b7736eabd5ed60423474b13b7d1a3`
- Record `e21f3345455519eb9a4cb991bd5d1453990ac86e34b10783d2bb1bf2d25b38f2`, run `FR-940c464937a69326257daf85`, 2026-10-25T19:49:26.095Z to 2026-10-25T19:49:40.531Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 6083.28 fly-seconds, then again for the determinism guard
- Code: commit `94539a4a3edb9ffa588d4e7f5e864c55e293d80a`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
