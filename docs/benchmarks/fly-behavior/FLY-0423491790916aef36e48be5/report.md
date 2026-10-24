# FLY-0423491790916aef36e48be5: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/5 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Noisy sensing: sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions), against noiseless sensing.

**Caveat.** Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.

**Question (host-written).** In the digital fly simulator, how does sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against noiseless sensing on matched seeds?

**Hypothesis (host-written).** Sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) will increase escape_ttc_s by at least 0.23 s on average over 9 matched seeds drawn after preregistration, compared with noiseless sensing, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Sensory noise of 0.4 makes the fly escape earlier in the approach, with more time to collision: noisy size and expansion estimates cross the escape threshold early. — competing: [scripted] Noise averages out over the approach and leaves the time to collision at the escape unchanged.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2235421391, 1947372274, 152616733, 286339229, 367878734, 1474551270, 1284401081, 2988405172, 706785428.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2235421391 | 0.088 | 0.412 | 0.323 | expected | `dca651e7fbf5` |
| 1947372274 | 0.095 | 0.402 | 0.307 | expected | `4794053c4362` |
| 152616733 | 0.092 | 0.398 | 0.307 | expected | `e9d19844dd95` |
| 286339229 | 0.085 | 0.388 | 0.303 | expected | `72b80558e3f1` |
| 367878734 | 0.095 | 0.433 | 0.338 | expected | `83e55ebd71b3` |
| 1474551270 | 0.095 | 0.393 | 0.298 | expected | `864b7a3203e0` |
| 1284401081 | 0.092 | 0.412 | 0.320 | expected | `12bf30aaaa65` |
| 2988405172 | 0.095 | 0.338 | 0.243 | expected | `941e44bc45e7` |
| 706785428 | 0.090 | 0.310 | 0.220 | expected | `3fa6e4751b53` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.092, mean treatment 0.387, mean paired difference **0.296** (minimum effect 0.23 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 36: observed 36.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.23: observed 0.2956 — holds
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
| near_miss_fraction | 0.042 | 0.015 | fraction |
| flown_m | 20.417 | 19.813 | m |
| saccades_per_flight_s | 0.592 | 0.599 | 1/s |
| contact_s | 0.000 | 0.000 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.092 | 0.387 | s |
| escape_latency_s | 0.908 | 0.613 | s |
| size_at_escape_deg | 52.223 | 19.608 | deg |
| short_mode_fraction | 0.037 | 0.130 | fraction |

## Provenance

- Plan `0423491790916aef36e48be562c1d4c50f841b30e326a9fe3ab7796ffe7196d8`; fly `digital-fly/5 reduced-order-fsm/v1`, identity `aeefc422fb7ee9ac538fe71c558eefcf8aacb8bf84fcf56b45b9085e6e296fa7`, source `0f6eef0366d07c5e8abedbad54bb5eaf3b922b10a7c2ff0447b1bf9ca16b25d7`
- Preregistered as V3D-EXP-0004 at 2026-10-24T16:11:25.416Z (receipt `2c4dd87c62f7a9d18cbcf5d8a2926d1b7f2311413ee20dc630b2be12b2548cf9`)
- Authorized at 2026-10-24T16:11:25.432Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `c0921e3de600e2e7234efb57019141471ed812fb342cd479e9ff2ff1c30bca4b`
- Record `06cd1af75cbc387622f81640c3fa3044bae80c67e4bea5a9af0ec106b4bb44a3`, run `FR-21cc4528f506e8650eaf205a`, 2026-10-24T16:11:25.433Z to 2026-10-24T16:11:37.531Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2402.46 fly-seconds, then again for the determinism guard
- Code: commit `f8cdf135f830bdfecce08f1fd1a38d992767c365`
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
