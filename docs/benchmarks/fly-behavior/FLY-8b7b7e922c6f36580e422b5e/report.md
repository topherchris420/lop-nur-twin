# FLY-8b7b7e922c6f36580e422b5e: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Noisy sensing: sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions), against noiseless sensing.

**Caveat.** Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.

**Question (host-written).** In the digital fly simulator, how does sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against noiseless sensing on matched seeds?

**Hypothesis (host-written).** Sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) will increase escape_ttc_s by at least 0.24 s on average over 9 matched seeds drawn after preregistration, compared with noiseless sensing, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Sensory noise of 0.4 makes the fly escape earlier in the approach, with more time to collision: noisy size and expansion estimates cross the escape threshold early. — competing: [scripted] Noise averages out over the approach and leaves the time to collision at the escape unchanged.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2273928868, 2582642156, 256347587, 217776916, 4007796417, 3463442476, 2677536206, 1289386609, 1481492637.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2273928868 | 0.088 | 0.458 | 0.370 | expected | `6c2285bb192c` |
| 2582642156 | 0.093 | 0.427 | 0.333 | expected | `dcb7d5d27e3f` |
| 256347587 | 0.085 | 0.392 | 0.307 | expected | `7ae05cc3902a` |
| 217776916 | 0.095 | 0.388 | 0.293 | expected | `df7ea18759fb` |
| 4007796417 | 0.088 | 0.392 | 0.303 | expected | `39e8cedec71b` |
| 3463442476 | 0.085 | 0.427 | 0.342 | expected | `303a1302c07c` |
| 2677536206 | 0.083 | 0.497 | 0.414 | expected | `1c5d963a3a5a` |
| 1289386609 | 0.093 | 0.432 | 0.338 | expected | `66601438beeb` |
| 1481492637 | 0.085 | 0.272 | 0.187 | expected | `3f42aa06b72b` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.089, mean treatment 0.409, mean paired difference **0.321** (minimum effect 0.24 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 36: observed 36.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.24: observed 0.3208 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0049-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| collision_episodes | 0.000 | 0.000 | count |
| near_miss_fraction | 0.043 | 0.013 | fraction |
| flown_m | 19.159 | 17.570 | m |
| saccades_per_flight_s | 0.565 | 0.552 | 1/s |
| contact_s | 0.000 | 0.000 | s |
| escape_probability | 1.000 | 0.981 | fraction |
| escape_ttc_s | 0.089 | 0.409 | s |
| escape_latency_s | 0.911 | 0.591 | s |
| size_at_escape_deg | 54.503 | 20.205 | deg |
| short_mode_fraction | 0.111 | 0.185 | fraction |

## Provenance

- Plan `8b7b7e922c6f36580e422b5e2a058fdbd28c21082b7b107c9ad0cc3cf2af0009`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `8d86753f0ca7a7395da5a6b7f3902bd120428b515dc616340ef12e9ae0489eed`, source `86708015e47c271602b7856459ea1d6ff513ea0f1df0bb8587c3f192a417f022`
- Preregistered as V3D-EXP-0049 at 2026-10-26T23:26:19.997Z (receipt `07a298dd0fbfd5682063832f309267d4667b0176c3012c84f0ea9895f93bef89`)
- Authorized at 2026-10-26T23:26:20.027Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `98168d1194cdd26a3831ff4e870777ba8b2fa4ec319206ab7a6c0a3332b2d809`
- Record `5552f256f47aa38f9411207689f5752e8b9a461e8ac51661e91e2028d9eea9d9`, run `FR-460d771c2db59d51b96e5ff0`, 2026-10-26T23:26:20.028Z to 2026-10-26T23:26:27.611Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2402.46 fly-seconds, then again for the determinism guard
- Code: commit `fb76ce5c5fc61f279bc5980bd1ea22863c0cdb8d`
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
