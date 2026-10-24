# FLY-ad8cfe5c4e05da8fd32306fe: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/4 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Noisy sensing: sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions), against noiseless sensing.

**Caveat.** Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.

**Question (host-written).** In the digital fly simulator, how does sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against noiseless sensing on matched seeds?

**Hypothesis (host-written).** Sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) will increase escape_ttc_s by at least 0.23 s on average over 9 matched seeds drawn after preregistration, compared with noiseless sensing, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Sensory noise of 0.4 makes the fly escape earlier in the approach, with more time to collision: noisy size and expansion estimates cross the escape threshold early. — competing: [scripted] Noise averages out over the approach and leaves the time to collision at the escape unchanged.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1477158663, 155820187, 115785137, 3970685995, 1862163225, 1527505546, 4285616353, 618491350, 3495403663.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1477158663 | 0.095 | 0.480 | 0.385 | expected | `7e3f901a94b4` |
| 155820187 | 0.095 | 0.433 | 0.338 | expected | `5d0a01e2ed6d` |
| 115785137 | 0.093 | 0.342 | 0.248 | expected | `ded501793355` |
| 3970685995 | 0.095 | 0.405 | 0.310 | expected | `b4d18df7def9` |
| 1862163225 | 0.083 | 0.403 | 0.320 | expected | `cd70b4023c3b` |
| 1527505546 | 0.095 | 0.355 | 0.260 | expected | `22be02e9462e` |
| 4285616353 | 0.095 | 0.460 | 0.365 | expected | `85790cf54e02` |
| 618491350 | 0.087 | 0.430 | 0.343 | expected | `471976223fed` |
| 3495403663 | 0.095 | 0.440 | 0.345 | expected | `72c0259431cb` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.093, mean treatment 0.416, mean paired difference **0.324** (minimum effect 0.23 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 36: observed 36.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.23: observed 0.3239 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0016-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| collision_episodes | 0.000 | 0.000 | count |
| near_miss_fraction | 0.058 | 0.015 | fraction |
| flown_m | 20.498 | 19.817 | m |
| saccades_per_flight_s | 0.587 | 0.588 | 1/s |
| contact_s | 0.000 | 0.000 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.093 | 0.416 | s |
| escape_latency_s | 0.907 | 0.584 | s |
| size_at_escape_deg | 51.408 | 15.971 | deg |
| short_mode_fraction | 0.037 | 0.204 | fraction |

## Provenance

- Plan `ad8cfe5c4e05da8fd32306fe134c24eec1cdff4204fdd45f917726f7eccb8490`; fly `digital-fly/4 reduced-order-fsm/v1`, identity `02776ebf688fc2989a8fe4f6871b30825e567d27ea64b5aecfd3ecf2760b448c`, source `69a28d5897711f339ac6fe76bbd486a76310346b93b62093ce8874c12331380e`
- Preregistered as V3D-EXP-0016 at 2026-10-24T02:51:21.633Z (receipt `65f14a5d8723c45c173abac02f0963f978eb50e641756a38d28b9ae4990232fa`)
- Authorized at 2026-10-24T02:51:21.654Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `a523c88dae24532b081b30b3f93fc13e6aacb7643ff55169f163bfb68b8dcd0a`
- Record `c57409ee815c308934ce4e8f62be675f176394c6d4093af914c45a44b5967454`, run `FR-7abe27d475454346c3808d9d`, 2026-10-24T02:51:21.655Z to 2026-10-24T02:51:39.735Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2402.46 fly-seconds, then again for the determinism guard
- Code: commit `c0f72973e32a0e9924a909da2a70b480994879e6`
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
