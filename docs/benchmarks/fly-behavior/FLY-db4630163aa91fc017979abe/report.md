# FLY-db4630163aa91fc017979abe: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Visual threat: looming dose series: a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s).

**Caveat.** Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.

**Question (host-written).** In the digital fly simulator, how does a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s) on matched seeds?

**Hypothesis (host-written).** A sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) will decrease escape_ttc_s by at least 0.28 s on average over 9 matched seeds drawn after preregistration, compared with the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] At l/v = 40 ms the fly escapes with less time to collision than at l/v = 160 ms, as an angular-size threshold predicts. — competing: [scripted] The escape proxy fires at a fixed time before collision whatever the approach speed.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2948401232, 3198125007, 2992174932, 380432319, 3127652558, 3127077079, 2473089349, 3194023996, 2567778900.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2948401232 | 0.385 | 0.093 | -0.292 | expected | `acaefe050f72` |
| 3198125007 | 0.385 | 0.095 | -0.290 | expected | `216b707b64fd` |
| 2992174932 | 0.372 | 0.085 | -0.287 | expected | `ef44bc51c1d2` |
| 380432319 | 0.368 | 0.085 | -0.283 | expected | `30476c3a550a` |
| 3127652558 | 0.373 | 0.087 | -0.287 | expected | `a3e098001c9c` |
| 3127077079 | 0.363 | 0.083 | -0.280 | expected | `11a6bee7e45d` |
| 2473089349 | 0.385 | 0.095 | -0.290 | expected | `62ce084c5d36` |
| 3194023996 | 0.385 | 0.095 | -0.290 | expected | `926d79326bf3` |
| 2567778900 | 0.385 | 0.095 | -0.290 | expected | `65d994658674` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.378, mean treatment 0.090, mean paired difference **-0.288** (minimum effect 0.28 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.28: observed -0.2876 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0003-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.378 | 0.090 | s |
| escape_latency_s | 3.622 | 0.910 | s |
| size_at_escape_deg | 50.481 | 52.897 | deg |
| short_mode_fraction | 0.000 | 0.074 | fraction |

## Provenance

- Plan `db4630163aa91fc017979abe2116011f868607667d27c35e024f6e817dd80a00`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `8fa862d0a358e1d8f3c36ea20bcc47f293ef42c1413ff1db2c9a6ebf3f086911`, source `e838b010f63674a8e7c6364631eff58473fbb0ef96fbd5d0e69b399a4303c485`
- Preregistered as V3D-EXP-0003 at 2026-10-25T19:48:38.605Z (receipt `daa0af66c9924df0075bc32d0a2c66d8bb30082fdbf3ce4113930e80d6d2cea0`)
- Authorized at 2026-10-25T19:48:38.616Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `d24ca3635e6bde6430efe8fbe1ba3787c3769b79c6a2c29eb56b818246edd8b9`
- Record `c82bfc4b411b71646c4853095904c338a1927769627dee584cf645edf661658d`, run `FR-094bb65a1a82f4a5393ffd83`, 2026-10-25T19:48:38.616Z to 2026-10-25T19:48:39.136Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 395.28 fly-seconds, then again for the determinism guard
- Code: commit `94539a4a3edb9ffa588d4e7f5e864c55e293d80a`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.
- Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
