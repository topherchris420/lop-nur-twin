# FLY-84b29ed8f32ccc535cf08b6e: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Noisy sensing: sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions), against noiseless sensing.

**Caveat.** Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.

**Question (host-written).** In the digital fly simulator, how does sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against noiseless sensing on matched seeds?

**Hypothesis (host-written).** Sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) will increase escape_ttc_s by at least 0.24 s on average over 9 matched seeds drawn after preregistration, compared with noiseless sensing, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Sensory noise of 0.4 makes the fly escape earlier in the approach, with more time to collision: noisy size and expansion estimates cross the escape threshold early. — competing: [scripted] Noise averages out over the approach and leaves the time to collision at the escape unchanged.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2677449026, 223272909, 3658133530, 3303025184, 2542984982, 3836009262, 3542608730, 1462656346, 345828706.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2677449026 | 0.083 | 0.368 | 0.285 | expected | `bb021ee9ac4a` |
| 223272909 | 0.085 | 0.267 | 0.182 | expected | `7be22597a71e` |
| 3658133530 | 0.095 | 0.427 | 0.332 | expected | `f0a398d59f80` |
| 3303025184 | 0.085 | 0.323 | 0.238 | expected | `4fc777afad60` |
| 2542984982 | 0.095 | 0.455 | 0.360 | expected | `bf7622af8f83` |
| 3836009262 | 0.093 | 0.395 | 0.302 | expected | `81e23310699e` |
| 3542608730 | 0.095 | 0.418 | 0.323 | expected | `f9b24a7d7f4a` |
| 1462656346 | 0.095 | 0.288 | 0.193 | expected | `2f0c490e267a` |
| 345828706 | 0.095 | 0.288 | 0.193 | expected | `5a33fdf2b1a6` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.091, mean treatment 0.359, mean paired difference **0.268** (minimum effect 0.24 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 36: observed 36.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.24: observed 0.2676 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0004-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.006 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.006 | 0.000 | 1/m |
| collision_episodes | 0.111 | 0.000 | count |
| near_miss_fraction | 0.064 | 0.017 | fraction |
| flown_m | 19.388 | 20.005 | m |
| saccades_per_flight_s | 0.576 | 0.547 | 1/s |
| contact_s | 0.001 | 0.000 | s |
| escape_probability | 1.000 | 0.981 | fraction |
| escape_ttc_s | 0.091 | 0.359 | s |
| escape_latency_s | 0.909 | 0.641 | s |
| size_at_escape_deg | 52.153 | 19.331 | deg |
| short_mode_fraction | 0.056 | 0.263 | fraction |

## Provenance

- Plan `84b29ed8f32ccc535cf08b6edf0a610c062ea1fc40d2fcf7b93cda7e2caa5576`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `309bc659d993b7c1affb6353a5aac0e434e9fc502d8d9477013d3af7296aaf38`, source `b9abf944d6d246ff622184e4b0d29ccdf4e3966665643958ab4585d67f4b0aff`
- Preregistered as V3D-EXP-0004 at 2026-10-26T00:32:53.752Z (receipt `c328280c0a3b4da51557f91c57e6affbdb9c91511a4ae166688e970256ee7b90`)
- Authorized at 2026-10-26T00:32:53.788Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `5f1afdc6d72f40289a01bfa214766187c6c52d9e0a550fc67535c96a4fa8735e`
- Record `377ac2ee9d7cb2a94aad4f114ccccfd0738fae4f08b57e379563e57364f1ab4b`, run `FR-576b7b394d9a47893ce7b08d`, 2026-10-26T00:32:53.789Z to 2026-10-26T00:33:08.867Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2402.46 fly-seconds, then again for the determinism guard
- Code: commit `06ff901fae549bb121d80c9b61e0f5c6b61faf77`
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
