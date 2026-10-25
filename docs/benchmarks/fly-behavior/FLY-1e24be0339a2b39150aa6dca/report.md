# FLY-1e24be0339a2b39150aa6dca: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Noisy sensing: sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions), against noiseless sensing.

**Caveat.** Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.

**Question (host-written).** In the digital fly simulator, how does sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against noiseless sensing on matched seeds?

**Hypothesis (host-written).** Sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) will increase escape_ttc_s by at least 0.24 s on average over 9 matched seeds drawn after preregistration, compared with noiseless sensing, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Sensory noise of 0.4 makes the fly escape earlier in the approach, with more time to collision: noisy size and expansion estimates cross the escape threshold early. — competing: [scripted] Noise averages out over the approach and leaves the time to collision at the escape unchanged.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3097357474, 3049503162, 19037854, 2979626225, 3331128557, 1866846295, 4106560388, 1469747497, 745298719.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3097357474 | 0.095 | 0.552 | 0.457 | expected | `880643a9a7dd` |
| 3049503162 | 0.092 | 0.272 | 0.180 | expected | `0370d6086a57` |
| 19037854 | 0.095 | 0.412 | 0.317 | expected | `9834d27ddeee` |
| 2979626225 | 0.095 | 0.433 | 0.338 | expected | `1d5aef01e880` |
| 3331128557 | 0.093 | 0.350 | 0.257 | expected | `251ebc3b0757` |
| 1866846295 | 0.095 | 0.458 | 0.363 | expected | `b5be148b14e0` |
| 4106560388 | 0.087 | 0.243 | 0.157 | expected | `79b73dbd22b9` |
| 1469747497 | 0.095 | 0.227 | 0.132 | expected | `c492533c0873` |
| 745298719 | 0.095 | 0.527 | 0.432 | expected | `94af58f47a36` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.094, mean treatment 0.386, mean paired difference **0.292** (minimum effect 0.24 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 36: observed 36.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.24: observed 0.2924 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0004-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| collision_episodes | 0.000 | 0.000 | count |
| near_miss_fraction | 0.047 | 0.014 | fraction |
| flown_m | 18.251 | 19.523 | m |
| saccades_per_flight_s | 0.585 | 0.594 | 1/s |
| contact_s | 0.000 | 0.000 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.094 | 0.386 | s |
| escape_latency_s | 0.906 | 0.614 | s |
| size_at_escape_deg | 51.053 | 19.286 | deg |
| short_mode_fraction | 0.019 | 0.278 | fraction |

## Provenance

- Plan `1e24be0339a2b39150aa6dca94bb46ceb988aa9b90cdfb27327b2f4be05d2bd9`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `8fa862d0a358e1d8f3c36ea20bcc47f293ef42c1413ff1db2c9a6ebf3f086911`, source `e838b010f63674a8e7c6364631eff58473fbb0ef96fbd5d0e69b399a4303c485`
- Preregistered as V3D-EXP-0004 at 2026-10-25T19:48:40.144Z (receipt `587c2fc084d10156e6cc05a085ebd895b7f20917df26f1074a4b3d031e28fcc6`)
- Authorized at 2026-10-25T19:48:40.156Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `3ea6f9a5309a13c9cb92c3933ef05ffb9865c3ed8c154ffe29fa49fc48cecfe4`
- Record `29944b847fdea856f78680eafa62910753d6f4baddd3afc895b997993de44762`, run `FR-0cce09f4710081a018aafe7e`, 2026-10-25T19:48:40.157Z to 2026-10-25T19:48:47.935Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2402.46 fly-seconds, then again for the determinism guard
- Code: commit `94539a4a3edb9ffa588d4e7f5e864c55e293d80a`
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
