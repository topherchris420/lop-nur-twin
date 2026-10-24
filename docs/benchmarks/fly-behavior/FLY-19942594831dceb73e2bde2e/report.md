# FLY-19942594831dceb73e2bde2e: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/6 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Noisy sensing: sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions), against noiseless sensing.

**Caveat.** Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.

**Question (host-written).** In the digital fly simulator, how does sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against noiseless sensing on matched seeds?

**Hypothesis (host-written).** Sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) will increase escape_ttc_s by at least 0.24 s on average over 9 matched seeds drawn after preregistration, compared with noiseless sensing, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Sensory noise of 0.4 makes the fly escape earlier in the approach, with more time to collision: noisy size and expansion estimates cross the escape threshold early. — competing: [scripted] Noise averages out over the approach and leaves the time to collision at the escape unchanged.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2142399234, 437226587, 3511530359, 2139299464, 3467126396, 103608915, 28918298, 1905180293, 2121985753.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2142399234 | 0.095 | 0.403 | 0.308 | expected | `df99d2f315dd` |
| 437226587 | 0.095 | 0.403 | 0.308 | expected | `daae8386ee70` |
| 3511530359 | 0.093 | 0.390 | 0.297 | expected | `75567cbdbed7` |
| 2139299464 | 0.095 | 0.530 | 0.435 | expected | `7805b0455a4a` |
| 3467126396 | 0.085 | 0.405 | 0.320 | expected | `54aaa8864e3b` |
| 103608915 | 0.087 | 0.325 | 0.238 | expected | `7501abc6834f` |
| 28918298 | 0.083 | 0.348 | 0.265 | expected | `74da64e5472a` |
| 1905180293 | 0.095 | 0.422 | 0.327 | expected | `4b41ff837f4c` |
| 2121985753 | 0.095 | 0.365 | 0.270 | expected | `618a01d24070` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.091, mean treatment 0.399, mean paired difference **0.308** (minimum effect 0.24 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 36: observed 36.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.24: observed 0.3076 — holds
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
| near_miss_fraction | 0.037 | 0.014 | fraction |
| flown_m | 21.441 | 21.468 | m |
| saccades_per_flight_s | 0.556 | 0.564 | 1/s |
| contact_s | 0.000 | 0.000 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.091 | 0.399 | s |
| escape_latency_s | 0.909 | 0.601 | s |
| size_at_escape_deg | 52.153 | 17.444 | deg |
| short_mode_fraction | 0.056 | 0.185 | fraction |

## Provenance

- Plan `19942594831dceb73e2bde2ea7fe9fa37f66d0d1c8a7b78917cc4fcc973066be`; fly `digital-fly/6 reduced-order-fsm/v1`, identity `ad5cea56d67036ecf47acddc8bcad249ff0eea83de3593c3b9850b524eb4f46d`, source `167ae70ac8ff41678590d70cf73640164392e6c73b9b1613b5f075575b715d87`
- Preregistered as V3D-EXP-0004 at 2026-10-24T19:25:28.696Z (receipt `cc90681a7d17dcb71f3d54dde60e39c2e36cba4a6bffab94b120dcb9aa753539`)
- Authorized at 2026-10-24T19:25:28.718Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `b11d3af29e12d0347094802e9bd5dc3212c62a753bf4366c2b90790e2f544e81`
- Record `ac15f6af6a89dc1b18b16287774b4e1be8130410c12ccbfaf2324c9c9c25eeae`, run `FR-5a674c1ab9f108947c3f4ac5`, 2026-10-24T19:25:28.719Z to 2026-10-24T19:25:44.244Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2402.46 fly-seconds, then again for the determinism guard
- Code: commit `300a2aa64e7d8771297c525e8b7159a56e84aeb6`
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
