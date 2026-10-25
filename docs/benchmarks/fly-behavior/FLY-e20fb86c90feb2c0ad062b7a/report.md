# FLY-e20fb86c90feb2c0ad062b7a: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Noisy sensing: sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions), against noiseless sensing.

**Caveat.** Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.

**Question (host-written).** In the digital fly simulator, how does sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against noiseless sensing on matched seeds?

**Hypothesis (host-written).** Sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) will increase escape_ttc_s by at least 0.24 s on average over 9 matched seeds drawn after preregistration, compared with noiseless sensing, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Sensory noise of 0.4 makes the fly escape earlier in the approach, with more time to collision: noisy size and expansion estimates cross the escape threshold early. — competing: [scripted] Noise averages out over the approach and leaves the time to collision at the escape unchanged.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3964926255, 1541996175, 3023192448, 642078127, 2443358334, 326679296, 1790095895, 1521974134, 353631831.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3964926255 | 0.083 | 0.451 | 0.368 | expected | `22d153073a4d` |
| 1541996175 | 0.095 | 0.448 | 0.353 | expected | `66cd42c2f494` |
| 3023192448 | 0.085 | 0.357 | 0.272 | expected | `eda7c1ecb257` |
| 642078127 | 0.095 | 0.405 | 0.310 | expected | `0c411cad7370` |
| 2443358334 | 0.083 | 0.227 | 0.143 | expected | `84190690a0f6` |
| 326679296 | 0.073 | 0.340 | 0.267 | expected | `878dd5de7944` |
| 1790095895 | 0.095 | 0.538 | 0.443 | expected | `2fcb447292a3` |
| 1521974134 | 0.095 | 0.405 | 0.310 | expected | `db4a33d7a399` |
| 353631831 | 0.083 | 0.425 | 0.342 | expected | `45337070f5d6` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.088, mean treatment 0.400, mean paired difference **0.312** (minimum effect 0.24 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 36: observed 36.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.24: observed 0.3120 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0007-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.011 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.011 | 0.000 | 1/m |
| collision_episodes | 0.222 | 0.000 | count |
| near_miss_fraction | 0.045 | 0.023 | fraction |
| flown_m | 19.376 | 18.976 | m |
| saccades_per_flight_s | 0.570 | 0.562 | 1/s |
| contact_s | 0.001 | 0.000 | s |
| escape_probability | 1.000 | 0.963 | fraction |
| escape_ttc_s | 0.088 | 0.400 | s |
| escape_latency_s | 0.912 | 0.600 | s |
| size_at_escape_deg | 54.269 | 18.647 | deg |
| short_mode_fraction | 0.111 | 0.185 | fraction |

## Provenance

- Plan `e20fb86c90feb2c0ad062b7a5c356cacd4aa497162d4096fe8dcab4d691536d6`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0007 at 2026-10-25T17:29:29.727Z (receipt `3ec0dbdad035858cc8e0cee27ddd7e77004db770822af0df4991242f00f4f7e7`)
- Authorized at 2026-10-25T17:29:29.748Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `3e1ee880ccdd5fac2ead829e7b4b65c87e9fb8b11715a84c05b16455910669b6`
- Record `89372f97411bb91068d78eff4578d7453330b16094a031f331d149db02e421c0`, run `FR-12a2327ba450872ffed63848`, 2026-10-25T17:29:29.749Z to 2026-10-25T17:29:44.680Z
- Simulated on node 24.22.1 (V8 13.6.233.17-node.58): 2402.46 fly-seconds, then again for the determinism guard
- Code: commit `a71066264ba3ff3a6949316bdc0f0bcee92c5520`
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
