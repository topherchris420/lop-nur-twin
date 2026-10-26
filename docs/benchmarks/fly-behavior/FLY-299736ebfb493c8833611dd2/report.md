# FLY-299736ebfb493c8833611dd2: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Noisy sensing: sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions), against noiseless sensing.

**Caveat.** Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.

**Question (host-written).** In the digital fly simulator, how does sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against noiseless sensing on matched seeds?

**Hypothesis (host-written).** Sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) will increase escape_ttc_s by at least 0.24 s on average over 9 matched seeds drawn after preregistration, compared with noiseless sensing, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Sensory noise of 0.4 makes the fly escape earlier in the approach, with more time to collision: noisy size and expansion estimates cross the escape threshold early. — competing: [scripted] Noise averages out over the approach and leaves the time to collision at the escape unchanged.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3068444793, 2417398564, 130272005, 3576805899, 2913892395, 1799252344, 2020985580, 4008561260, 3797752452.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3068444793 | 0.088 | 0.353 | 0.265 | expected | `7ef04502b5c8` |
| 2417398564 | 0.095 | 0.408 | 0.313 | expected | `b2c40bdd4f78` |
| 130272005 | 0.095 | 0.463 | 0.368 | expected | `e6742da0c5d5` |
| 3576805899 | 0.083 | 0.360 | 0.277 | expected | `93d1773e8d83` |
| 2913892395 | 0.078 | 0.297 | 0.218 | expected | `7268b9cbf564` |
| 1799252344 | 0.095 | 0.458 | 0.363 | expected | `456c865c08d0` |
| 2020985580 | 0.095 | 0.425 | 0.330 | expected | `82facc65c2fb` |
| 4008561260 | 0.092 | 0.343 | 0.252 | expected | `8491b9ad0331` |
| 3797752452 | 0.077 | 0.238 | 0.162 | expected | `6ad14ae41e08` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.089, mean treatment 0.372, mean paired difference **0.283** (minimum effect 0.24 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 36: observed 36.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.24: observed 0.2831 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0022-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| collision_episodes | 0.000 | 0.000 | count |
| near_miss_fraction | 0.044 | 0.014 | fraction |
| flown_m | 20.949 | 20.541 | m |
| saccades_per_flight_s | 0.533 | 0.523 | 1/s |
| contact_s | 0.000 | 0.000 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.089 | 0.372 | s |
| escape_latency_s | 0.911 | 0.628 | s |
| size_at_escape_deg | 54.764 | 23.652 | deg |
| short_mode_fraction | 0.130 | 0.241 | fraction |

## Provenance

- Plan `299736ebfb493c8833611dd2d06ac8d52a79ff0174b6074d721a51382bb82e80`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `44a4d99fc81cf563bb4ff40377cff7d1ae9881d95c6cf3b17851e5804539805d`, source `b794ba087d2c9dbb0d589758d6d2e0a89d958b3f2b626d50ab3388266513a682`
- Preregistered as V3D-EXP-0022 at 2026-10-26T05:42:54.476Z (receipt `fb9fc3a18df998131f702a84f70a614976be3166d7f7ba4d6c54165d72596936`)
- Authorized at 2026-10-26T05:42:54.565Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `7fd5433dad4654074898830ce8a0cc1bd5f83982e12896e266ccf3b1294a1b76`
- Record `7279323e5637991dbd77951f6aeda8658360a73f896a226e5afe855919d50cbc`, run `FR-a6863573cdb5acdfb3db621f`, 2026-10-26T05:42:54.611Z to 2026-10-26T05:43:29.862Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2402.46 fly-seconds, then again for the determinism guard
- Code: commit `6ea1990ebc33011e02ad26083bebb719dc837d1b`
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
