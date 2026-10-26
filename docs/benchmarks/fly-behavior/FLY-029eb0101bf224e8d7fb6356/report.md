# FLY-029eb0101bf224e8d7fb6356: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Visual threat: looming dose series: a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s).

**Caveat.** Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.

**Question (host-written).** In the digital fly simulator, how does a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s) on matched seeds?

**Hypothesis (host-written).** A sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) will decrease escape_ttc_s by at least 0.28 s on average over 9 matched seeds drawn after preregistration, compared with the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] At l/v = 40 ms the fly escapes with less time to collision than at l/v = 160 ms, as an angular-size threshold predicts. — competing: [scripted] The escape proxy fires at a fixed time before collision whatever the approach speed.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1813749872, 2120871272, 2753311501, 1683193223, 3459534589, 1937105983, 2525472444, 3317314358, 3455485493.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1813749872 | 0.385 | 0.095 | -0.290 | expected | `f16592cd7dcc` |
| 2120871272 | 0.385 | 0.095 | -0.290 | expected | `27c61eb54fb1` |
| 2753311501 | 0.385 | 0.095 | -0.290 | expected | `637f1ee52fc0` |
| 1683193223 | 0.385 | 0.095 | -0.290 | expected | `a5383e78f1b5` |
| 3459534589 | 0.362 | 0.077 | -0.285 | expected | `b22fae363b1c` |
| 1937105983 | 0.385 | 0.090 | -0.295 | expected | `ef96fd667a76` |
| 2525472444 | 0.367 | 0.085 | -0.282 | expected | `647770a811c4` |
| 3317314358 | 0.385 | 0.095 | -0.290 | expected | `b5ab1d9af9e5` |
| 3455485493 | 0.373 | 0.087 | -0.287 | expected | `513bc6b50a3b` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.379, mean treatment 0.090, mean paired difference **-0.289** (minimum effect 0.28 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.28: observed -0.2887 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0003-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.379 | 0.090 | s |
| escape_latency_s | 3.621 | 0.910 | s |
| size_at_escape_deg | 50.187 | 53.264 | deg |
| short_mode_fraction | 0.000 | 0.093 | fraction |

## Provenance

- Plan `029eb0101bf224e8d7fb6356b3d1c1cc88865d7ea09d07eeb43cf483cc88a958`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `309bc659d993b7c1affb6353a5aac0e434e9fc502d8d9477013d3af7296aaf38`, source `b9abf944d6d246ff622184e4b0d29ccdf4e3966665643958ab4585d67f4b0aff`
- Preregistered as V3D-EXP-0003 at 2026-10-26T00:32:50.822Z (receipt `253830d2bd080e272e722ff3d21ee4166aea3b8f3afa78bfc6f56ea7ac5ab168`)
- Authorized at 2026-10-26T00:32:50.844Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `6a8b368014ef46d0762142be1ae459c08638a2890b579ce233e0f7d0b45e9d68`
- Record `aff2733f47fa5260666ad7b97a53907f3e3352beb21d18dc434efbb80544581b`, run `FR-cee21f8a1ccf0a66ae62d3de`, 2026-10-26T00:32:50.845Z to 2026-10-26T00:32:51.903Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 395.28 fly-seconds, then again for the determinism guard
- Code: commit `06ff901fae549bb121d80c9b61e0f5c6b61faf77`
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
