# FLY-dee8b400e86279578ef374f6: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Visual threat: looming dose series: a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s).

**Caveat.** Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.

**Question (host-written).** In the digital fly simulator, how does a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s) on matched seeds?

**Hypothesis (host-written).** A sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) will decrease escape_ttc_s by at least 0.28 s on average over 9 matched seeds drawn after preregistration, compared with the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] At l/v = 40 ms the fly escapes with less time to collision than at l/v = 160 ms, as an angular-size threshold predicts. — competing: [scripted] The escape proxy fires at a fixed time before collision whatever the approach speed.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3153817453, 2559578670, 1696829088, 45779788, 2155240156, 167652876, 3620147476, 3370226695, 2432262627.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3153817453 | 0.385 | 0.095 | -0.290 | expected | `e843a5dfe0a0` |
| 2559578670 | 0.385 | 0.095 | -0.290 | expected | `faa0dcd8e388` |
| 1696829088 | 0.385 | 0.095 | -0.290 | expected | `a04ba81a342a` |
| 45779788 | 0.375 | 0.087 | -0.288 | expected | `5858cd700c69` |
| 2155240156 | 0.373 | 0.082 | -0.292 | expected | `657cfb9ebdf1` |
| 167652876 | 0.385 | 0.095 | -0.290 | expected | `09c1bf28aed8` |
| 3620147476 | 0.367 | 0.082 | -0.285 | expected | `0002b8be89eb` |
| 3370226695 | 0.342 | 0.067 | -0.275 | expected | `3fb6b9cb4b66` |
| 2432262627 | 0.382 | 0.088 | -0.293 | expected | `6a0414c201ba` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.375, mean treatment 0.087, mean paired difference **-0.288** (minimum effect 0.28 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.28: observed -0.2881 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0021-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.375 | 0.087 | s |
| escape_latency_s | 3.625 | 0.913 | s |
| size_at_escape_deg | 50.861 | 55.769 | deg |
| short_mode_fraction | 0.000 | 0.148 | fraction |

## Provenance

- Plan `dee8b400e86279578ef374f645cbf424e38e2f232b7d1a0cc98163bab6fc64b0`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `44a4d99fc81cf563bb4ff40377cff7d1ae9881d95c6cf3b17851e5804539805d`, source `b794ba087d2c9dbb0d589758d6d2e0a89d958b3f2b626d50ab3388266513a682`
- Preregistered as V3D-EXP-0021 at 2026-10-26T05:42:33.936Z (receipt `13db75a1f9838926c74362ac9a0dbf43807df1688e93b0465f7b7df444b9314f`)
- Authorized at 2026-10-26T05:42:34.019Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `03e068ba0d3c3f973faf4ccb55685871a95839ad74a8d6cea11f9c634c981d30`
- Record `c5e184c931ec6aa52ac816898819dbba8e96ed164b7af39e894c3291a8f720d4`, run `FR-fe7b3209bb7087d0215c7077`, 2026-10-26T05:42:34.022Z to 2026-10-26T05:42:36.774Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 395.28 fly-seconds, then again for the determinism guard
- Code: commit `6ea1990ebc33011e02ad26083bebb719dc837d1b`
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
