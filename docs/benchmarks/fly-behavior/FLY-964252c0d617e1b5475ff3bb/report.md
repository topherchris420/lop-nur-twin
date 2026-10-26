# FLY-964252c0d617e1b5475ff3bb: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Noisy sensing: sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions), against noiseless sensing.

**Caveat.** Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.

**Question (host-written).** In the digital fly simulator, how does sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against noiseless sensing on matched seeds?

**Hypothesis (host-written).** Sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) will increase escape_ttc_s by at least 0.24 s on average over 9 matched seeds drawn after preregistration, compared with noiseless sensing, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Sensory noise of 0.4 makes the fly escape earlier in the approach, with more time to collision: noisy size and expansion estimates cross the escape threshold early. — competing: [scripted] Noise averages out over the approach and leaves the time to collision at the escape unchanged.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2966994371, 1712285627, 240897485, 2594533411, 3727882461, 4263874152, 1437946950, 3581601507, 508236.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2966994371 | 0.095 | 0.343 | 0.248 | expected | `290d673ebf1b` |
| 1712285627 | 0.088 | 0.305 | 0.217 | expected | `1ff29d30e934` |
| 240897485 | 0.095 | 0.440 | 0.345 | expected | `c7e4b18dca45` |
| 2594533411 | 0.095 | 0.382 | 0.287 | expected | `46da03d8811c` |
| 3727882461 | 0.083 | 0.298 | 0.215 | expected | `8b56a242d1dd` |
| 4263874152 | 0.090 | 0.373 | 0.283 | expected | `1a05a176956a` |
| 1437946950 | 0.092 | 0.482 | 0.390 | expected | `41738bbf2c15` |
| 3581601507 | 0.087 | 0.420 | 0.333 | expected | `e9dcffe77299` |
| 508236 | 0.095 | 0.523 | 0.428 | expected | `5ab245ce6e7a` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.091, mean treatment 0.396, mean paired difference **0.305** (minimum effect 0.24 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 36: observed 36.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.24: observed 0.3051 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0031-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.006 | 0.006 | 1/m |
| cruise_collision_episodes_per_m | 0.006 | 0.006 | 1/m |
| collision_episodes | 0.111 | 0.111 | count |
| near_miss_fraction | 0.043 | 0.024 | fraction |
| flown_m | 20.050 | 18.872 | m |
| saccades_per_flight_s | 0.569 | 0.604 | 1/s |
| contact_s | 0.001 | 0.001 | s |
| escape_probability | 0.981 | 0.981 | fraction |
| escape_ttc_s | 0.091 | 0.396 | s |
| escape_latency_s | 0.909 | 0.604 | s |
| size_at_escape_deg | 52.791 | 19.303 | deg |
| short_mode_fraction | 0.074 | 0.207 | fraction |

## Provenance

- Plan `964252c0d617e1b5475ff3bb4f54b3f4a3fc00a640e2a8660a367f5ca96cfbc5`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `ff9c46c2a17247b1e4327a4763992d16722b4f6ef0c5ea58c211d1ee192cf514`, source `359ee8a2b23084a3726b5b2bab6e7ee39eb27578e0956b6dd6b66e6489bf34c8`
- Preregistered as V3D-EXP-0031 at 2026-10-26T13:07:40.419Z (receipt `3d8002ada750eafadd8a776bfd5e6c138ac750535a08d9ffd2f2863679cbf34c`)
- Authorized at 2026-10-26T13:07:40.444Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `ae830b8e3463927a8f1b2588334b26c3366963e05237375d56e23def98a3f0b3`
- Record `a96f4ec2ec339a57ecbd0f599c3c41103269b15819faa773c17daa136d3f0a82`, run `FR-f38ede5fe42fd43d8011a975`, 2026-10-26T13:07:40.445Z to 2026-10-26T13:07:48.219Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2402.46 fly-seconds, then again for the determinism guard
- Code: commit `27af8430b03ffd5284d3609788b39b359c1aa099`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.
- Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
