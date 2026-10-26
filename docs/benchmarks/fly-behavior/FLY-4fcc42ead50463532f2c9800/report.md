# FLY-4fcc42ead50463532f2c9800: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Noisy sensing: sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions), against noiseless sensing.

**Caveat.** Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.

**Question (host-written).** In the digital fly simulator, how does sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against noiseless sensing on matched seeds?

**Hypothesis (host-written).** Sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) will increase escape_ttc_s by at least 0.24 s on average over 9 matched seeds drawn after preregistration, compared with noiseless sensing, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Sensory noise of 0.4 makes the fly escape earlier in the approach, with more time to collision: noisy size and expansion estimates cross the escape threshold early. — competing: [scripted] Noise averages out over the approach and leaves the time to collision at the escape unchanged.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 776738104, 464192300, 2421033312, 46036678, 1626202117, 3950167991, 2611080350, 3238438369, 1215558091.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 776738104 | 0.088 | 0.322 | 0.233 | expected | `c5b14b9e3f39` |
| 464192300 | 0.095 | 0.368 | 0.273 | expected | `fcc3ecea5519` |
| 2421033312 | 0.095 | 0.488 | 0.393 | expected | `de44edec4596` |
| 46036678 | 0.093 | 0.347 | 0.253 | expected | `396524d3db39` |
| 1626202117 | 0.090 | 0.367 | 0.277 | expected | `37c22b2bf9f1` |
| 3950167991 | 0.095 | 0.377 | 0.282 | expected | `0b1885d71e17` |
| 2611080350 | 0.083 | 0.335 | 0.252 | expected | `d5a15c06578a` |
| 3238438369 | 0.078 | 0.265 | 0.187 | expected | `187057cd7cbb` |
| 1215558091 | 0.095 | 0.393 | 0.298 | expected | `1810cc17e8e1` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.090, mean treatment 0.362, mean paired difference **0.272** (minimum effect 0.24 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 36: observed 36.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.24: observed 0.2720 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0040-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| collision_episodes | 0.000 | 0.000 | count |
| near_miss_fraction | 0.038 | 0.012 | fraction |
| flown_m | 19.203 | 21.027 | m |
| saccades_per_flight_s | 0.546 | 0.565 | 1/s |
| contact_s | 0.000 | 0.000 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.090 | 0.362 | s |
| escape_latency_s | 0.910 | 0.638 | s |
| size_at_escape_deg | 53.180 | 22.640 | deg |
| short_mode_fraction | 0.074 | 0.204 | fraction |

## Provenance

- Plan `4fcc42ead50463532f2c98006ba269065e73cf58c398a3753327f7bcbb9c8fc0`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `e2eb5e95c355777d19a210820fb203fc9ef47608031b98fa85882280e85cfdca`, source `daad49019246c38c2673cd442ecaae50eba95994635676bdc333b5563cebfb78`
- Preregistered as V3D-EXP-0040 at 2026-10-26T20:15:10.153Z (receipt `b681952941c4b334be7860b468f1d6ffc4df5f935274cd0aae7d499c680260a2`)
- Authorized at 2026-10-26T20:15:10.180Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `8f4856558a4ace08b85dffd76ada1cd755ff262548273b7347d6fe15f325ec65`
- Record `f4b7795139043d31a70a88e12405a3cf00c902ef44f968c14e3eb742f5209e0e`, run `FR-a980cda8aeca50367a711b3c`, 2026-10-26T20:15:10.181Z to 2026-10-26T20:15:17.993Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2402.46 fly-seconds, then again for the determinism guard
- Code: commit `379fb9debfbd203f99d6c76ac80097706945dd2d`
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
