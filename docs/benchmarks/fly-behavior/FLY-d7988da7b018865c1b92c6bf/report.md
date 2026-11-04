# FLY-d7988da7b018865c1b92c6bf: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/9 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Noisy sensing: sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions), against noiseless sensing.

**Caveat.** Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.

**Question (host-written).** In the digital fly simulator, how does sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against noiseless sensing on matched seeds?

**Hypothesis (host-written).** Sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) will increase escape_ttc_s by at least 0.24 s on average over 9 matched seeds drawn after preregistration, compared with noiseless sensing, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Sensory noise of 0.4 makes the fly escape earlier in the approach, with more time to collision: noisy size and expansion estimates cross the escape threshold early. — competing: [scripted] Noise averages out over the approach and leaves the time to collision at the escape unchanged.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 5594260, 2519698237, 18507096, 381210636, 1338954478, 2352154782, 4239934495, 699922701, 419348610.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 5594260 | 0.092 | 0.290 | 0.198 | expected | `4e7148d7e6bd` |
| 2519698237 | 0.088 | 0.262 | 0.173 | expected | `9914ea57bf3c` |
| 18507096 | 0.080 | 0.233 | 0.153 | expected | `25d360232589` |
| 381210636 | 0.090 | 0.332 | 0.242 | expected | `14c1bb928bdc` |
| 1338954478 | 0.087 | 0.360 | 0.273 | expected | `415a14e59781` |
| 2352154782 | 0.085 | 0.478 | 0.393 | expected | `6d65832d3d55` |
| 4239934495 | 0.083 | 0.313 | 0.230 | expected | `6d03e4f2e6c7` |
| 699922701 | 0.085 | 0.425 | 0.340 | expected | `98e3c6c103d7` |
| 419348610 | 0.095 | 0.407 | 0.312 | expected | `cc9397073fc9` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.087, mean treatment 0.344, mean paired difference **0.257** (minimum effect 0.24 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 36: observed 36.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.24: observed 0.2572 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0004-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.005 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.005 | 0.000 | 1/m |
| collision_episodes | 0.111 | 0.000 | count |
| near_miss_fraction | 0.050 | 0.018 | fraction |
| flown_m | 21.834 | 20.867 | m |
| saccades_per_flight_s | 0.519 | 0.512 | 1/s |
| contact_s | 0.001 | 0.000 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.087 | 0.344 | s |
| escape_latency_s | 0.913 | 0.656 | s |
| size_at_escape_deg | 55.509 | 26.177 | deg |
| short_mode_fraction | 0.148 | 0.241 | fraction |

## Provenance

- Plan `d7988da7b018865c1b92c6bfb86a50ec8980a797b87fb3cdef594da25c2b80bf`; fly `digital-fly/9 reduced-order-fsm/v1`, identity `5d8d3589513b67c3b784c7fcc76029b36d3478bb885568e6c79666e2bac6ec7b`, source `3a440f60616f2e78515dcf03a3cc689b54316140fb08d659c5310f63a4a83500`
- Preregistered as V3D-EXP-0004 at 2026-11-04T14:48:36.796Z (receipt `33a8d8f6e3e2a9acd08f0907414f0d0cf3f09d977fb07e5c8fb903951a456d86`)
- Authorized at 2026-11-04T14:48:36.913Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `e63843d72b7cd34fa679fff6a7ad1a1e998af0aa6c2eab2ca386cab3c7138c25`
- Record `92ccd408bc14a4039331fdf3620b7ffe9642c668ed9ed709a82b41b9e882f13e`, run `FR-d25a1624896a13c456762508`, 2026-11-04T14:48:36.916Z to 2026-11-04T14:49:13.998Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2402.46 fly-seconds, then again for the determinism guard
- Code: commit `e458f7cb34904d85127779a3700c26b376ab4a80`
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
