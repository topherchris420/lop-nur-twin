# FLY-41ffa3b7d8759418c23b6f11: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/6 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Visual threat: looming dose series: a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s).

**Caveat.** Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.

**Question (host-written).** In the digital fly simulator, how does a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s) on matched seeds?

**Hypothesis (host-written).** A sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) will decrease escape_ttc_s by at least 0.28 s on average over 9 matched seeds drawn after preregistration, compared with the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] At l/v = 40 ms the fly escapes with less time to collision than at l/v = 160 ms, as an angular-size threshold predicts. — competing: [scripted] The escape proxy fires at a fixed time before collision whatever the approach speed.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 519597720, 3937410818, 3552527746, 205007100, 2086384737, 1462005598, 3173449129, 1021003763, 3489488681.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 519597720 | 0.383 | 0.088 | -0.295 | expected | `bb652ed2f3b5` |
| 3937410818 | 0.385 | 0.095 | -0.290 | expected | `9a64889f60e2` |
| 3552527746 | 0.385 | 0.090 | -0.295 | expected | `da99a6b9c689` |
| 205007100 | 0.385 | 0.095 | -0.290 | expected | `c1d5cf56acd5` |
| 2086384737 | 0.385 | 0.095 | -0.290 | expected | `2a8e2fc356e9` |
| 1462005598 | 0.385 | 0.095 | -0.290 | expected | `2f557c7a9e4b` |
| 3173449129 | 0.373 | 0.087 | -0.287 | expected | `c4df6389d6b4` |
| 1021003763 | 0.382 | 0.088 | -0.293 | expected | `e3a618856289` |
| 3489488681 | 0.372 | 0.085 | -0.287 | expected | `d567e70b6b4e` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.382, mean treatment 0.091, mean paired difference **-0.291** (minimum effect 0.28 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.28: observed -0.2907 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0003-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.382 | 0.091 | s |
| escape_latency_s | 3.618 | 0.909 | s |
| size_at_escape_deg | 49.675 | 53.264 | deg |
| short_mode_fraction | 0.000 | 0.093 | fraction |

## Provenance

- Plan `41ffa3b7d8759418c23b6f1114a30c7e02a5c614b2e5ed5ef6effe3f2df71d3e`; fly `digital-fly/6 reduced-order-fsm/v1`, identity `ad5cea56d67036ecf47acddc8bcad249ff0eea83de3593c3b9850b524eb4f46d`, source `167ae70ac8ff41678590d70cf73640164392e6c73b9b1613b5f075575b715d87`
- Preregistered as V3D-EXP-0003 at 2026-10-24T19:25:25.938Z (receipt `03c0022fa13a8de3b048c4b0d192dadb09436f86fa51f810847b808c0a0ca88f`)
- Authorized at 2026-10-24T19:25:25.954Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `b9aa772ddd6e07e99c7a88d596f1e95c665d696ac371816b069920535da97136`
- Record `299ad23c5e8fb26ddd60346efeb6feeb07c82f010b1f7c2590008dc63b6b7cba`, run `FR-213aef8d90d744f3c95e3de7`, 2026-10-24T19:25:25.954Z to 2026-10-24T19:25:27.005Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 395.28 fly-seconds, then again for the determinism guard
- Code: commit `300a2aa64e7d8771297c525e8b7159a56e84aeb6`
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
