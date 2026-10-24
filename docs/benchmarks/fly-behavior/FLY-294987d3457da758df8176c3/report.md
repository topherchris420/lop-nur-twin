# FLY-294987d3457da758df8176c3: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Noisy sensing: sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions), against noiseless sensing.

**Caveat.** Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.

**Question (host-written).** In the digital fly simulator, how does sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against noiseless sensing on matched seeds?

**Hypothesis (host-written).** Sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) will increase escape_ttc_s by at least 0.24 s on average over 9 matched seeds drawn after preregistration, compared with noiseless sensing, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Sensory noise of 0.4 makes the fly escape earlier in the approach, with more time to collision: noisy size and expansion estimates cross the escape threshold early. — competing: [scripted] Noise averages out over the approach and leaves the time to collision at the escape unchanged.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 260473573, 1574970586, 858415233, 1645077131, 1570590418, 332019507, 3614750165, 1867948719, 1501939790.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 260473573 | 0.085 | 0.353 | 0.268 | expected | `62c1024ae98d` |
| 1574970586 | 0.095 | 0.392 | 0.297 | expected | `2c03fd2e8e6d` |
| 858415233 | 0.095 | 0.350 | 0.255 | expected | `5ad0ab4c1620` |
| 1645077131 | 0.095 | 0.343 | 0.248 | expected | `2980e2eaf41b` |
| 1570590418 | 0.088 | 0.457 | 0.368 | expected | `42dea60349f6` |
| 332019507 | 0.085 | 0.402 | 0.317 | expected | `24537addcdb2` |
| 3614750165 | 0.095 | 0.453 | 0.358 | expected | `8aedf327d557` |
| 1867948719 | 0.095 | 0.452 | 0.357 | expected | `03bd55f6b655` |
| 1501939790 | 0.087 | 0.383 | 0.297 | expected | `2172e672b223` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.091, mean treatment 0.398, mean paired difference **0.307** (minimum effect 0.24 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 36: observed 36.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.24: observed 0.3072 — holds
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
| near_miss_fraction | 0.033 | 0.025 | fraction |
| flown_m | 19.690 | 19.520 | m |
| saccades_per_flight_s | 0.544 | 0.559 | 1/s |
| contact_s | 0.000 | 0.000 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.091 | 0.398 | s |
| escape_latency_s | 0.909 | 0.602 | s |
| size_at_escape_deg | 52.780 | 19.414 | deg |
| short_mode_fraction | 0.074 | 0.185 | fraction |

## Provenance

- Plan `294987d3457da758df8176c34e5e7223cc8d81a6386578d0bc86865a8d391e04`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `247197565afacdeda5b29bdca1a24744fd547120e39f1a35621689f2e9c90905`, source `d77a3a3961b0700f93c794a7dd8e0f3d3a9c0fd68661cfc324711c1ebf407c6c`
- Preregistered as V3D-EXP-0004 at 2026-10-24T21:22:34.859Z (receipt `62736ab5e00f3269cbbaad65750f1163b2e144cccb685078e86c62df5931045e`)
- Authorized at 2026-10-24T21:22:34.878Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `7159fbfd92e636d8210ce43bc2b4ec6ebc10e6dad9a9848f5b99ace360ec1e76`
- Record `f9b29120322af844d89a9205f9e43ad610a2644de69d9cbddd92e86e609ce6ec`, run `FR-11b4c8d0805aad4096ad54a5`, 2026-10-24T21:22:34.879Z to 2026-10-24T21:22:51.713Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2402.46 fly-seconds, then again for the determinism guard
- Code: commit `74216e15e42796df5684c31d82522e7234054d76`
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
