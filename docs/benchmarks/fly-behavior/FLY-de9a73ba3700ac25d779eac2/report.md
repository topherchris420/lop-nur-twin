# FLY-de9a73ba3700ac25d779eac2: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/5 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Visual threat: looming dose series: a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s).

**Caveat.** Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.

**Question (host-written).** In the digital fly simulator, how does a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s) on matched seeds?

**Hypothesis (host-written).** A sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) will decrease escape_ttc_s by at least 0.28 s on average over 9 matched seeds drawn after preregistration, compared with the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] At l/v = 40 ms the fly escapes with less time to collision than at l/v = 160 ms, as an angular-size threshold predicts. — competing: [scripted] The escape proxy fires at a fixed time before collision whatever the approach speed.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 456004218, 3654196673, 1183413675, 2765494705, 3792642067, 596896220, 216401547, 550367281, 740776463.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 456004218 | 0.385 | 0.095 | -0.290 | expected | `4e20926af028` |
| 3654196673 | 0.385 | 0.092 | -0.293 | expected | `a19aa8233889` |
| 1183413675 | 0.385 | 0.095 | -0.290 | expected | `c9d8942f66c4` |
| 2765494705 | 0.385 | 0.092 | -0.293 | expected | `53be04d02868` |
| 3792642067 | 0.385 | 0.095 | -0.290 | expected | `442f82bb4b94` |
| 596896220 | 0.385 | 0.093 | -0.292 | expected | `ab584c737b74` |
| 216401547 | 0.385 | 0.095 | -0.290 | expected | `a25b9f3c35c5` |
| 550367281 | 0.385 | 0.095 | -0.290 | expected | `8787ed0ca753` |
| 740776463 | 0.385 | 0.090 | -0.295 | expected | `83982cec7750` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.385, mean treatment 0.094, mean paired difference **-0.291** (minimum effect 0.28 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.28: observed -0.2915 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0003-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.385 | 0.094 | s |
| escape_latency_s | 3.615 | 0.906 | s |
| size_at_escape_deg | 49.112 | 50.947 | deg |
| short_mode_fraction | 0.000 | 0.019 | fraction |

## Provenance

- Plan `de9a73ba3700ac25d779eac27fdead37670b2ca66b0a37393166d28ec8115d90`; fly `digital-fly/5 reduced-order-fsm/v1`, identity `aeefc422fb7ee9ac538fe71c558eefcf8aacb8bf84fcf56b45b9085e6e296fa7`, source `0f6eef0366d07c5e8abedbad54bb5eaf3b922b10a7c2ff0447b1bf9ca16b25d7`
- Preregistered as V3D-EXP-0003 at 2026-10-24T16:11:23.443Z (receipt `1cba89091d35919ecf97a067e1df4aafa6f884bd51029d47733f4413625ba4bb`)
- Authorized at 2026-10-24T16:11:23.456Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `e3f89e31f7c4c9eb3922db2f2a14fe614a0d9343291b3d4b9d6add589d5accd8`
- Record `2b7bf192004d43db4862768b12f1a25aa478d3ee0d3ec4450c6468d9bfb28c8a`, run `FR-e522d66a82642f83a0fd84f5`, 2026-10-24T16:11:23.456Z to 2026-10-24T16:11:24.254Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 395.28 fly-seconds, then again for the determinism guard
- Code: commit `f8cdf135f830bdfecce08f1fd1a38d992767c365`
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
