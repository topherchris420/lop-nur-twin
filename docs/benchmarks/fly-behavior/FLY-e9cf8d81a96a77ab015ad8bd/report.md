# FLY-e9cf8d81a96a77ab015ad8bd: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Visual threat: looming dose series: a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s).

**Caveat.** Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.

**Question (host-written).** In the digital fly simulator, how does a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s) on matched seeds?

**Hypothesis (host-written).** A sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) will decrease escape_ttc_s by at least 0.28 s on average over 9 matched seeds drawn after preregistration, compared with the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] At l/v = 40 ms the fly escapes with less time to collision than at l/v = 160 ms, as an angular-size threshold predicts. — competing: [scripted] The escape proxy fires at a fixed time before collision whatever the approach speed.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 336898920, 1327241138, 1769705119, 1296026556, 1232789114, 1764433287, 409377989, 1310529699, 1077301349.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 336898920 | 0.385 | 0.095 | -0.290 | expected | `68a96b695ae1` |
| 1327241138 | 0.378 | 0.087 | -0.292 | expected | `5ce5b30856d5` |
| 1769705119 | 0.385 | 0.095 | -0.290 | expected | `093ff53dbc15` |
| 1296026556 | 0.385 | 0.095 | -0.290 | expected | `408fae9e68cd` |
| 1232789114 | 0.385 | 0.095 | -0.290 | expected | `272533d01656` |
| 1764433287 | 0.385 | 0.095 | -0.290 | expected | `693816b777a5` |
| 409377989 | 0.385 | 0.095 | -0.290 | expected | `832925888a76` |
| 1310529699 | 0.385 | 0.092 | -0.293 | expected | `5a3de572bb64` |
| 1077301349 | 0.358 | 0.095 | -0.263 | expected | `c87b045073f6` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.381, mean treatment 0.094, mean paired difference **-0.288** (minimum effect 0.28 s).

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

Registry run `V3D-EXP-0057-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| escape_probability | 1.000 | 0.981 | fraction |
| escape_ttc_s | 0.381 | 0.094 | s |
| escape_latency_s | 3.619 | 0.906 | s |
| size_at_escape_deg | 49.983 | 50.818 | deg |
| short_mode_fraction | 0.000 | 0.019 | fraction |

## Provenance

- Plan `e9cf8d81a96a77ab015ad8bd441943e8792381b22f1c2d0e22ac23c1ace8ffc3`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `c684a7f0002390bee7e62d529bc459479c35e45465749ad174bd99aca71a5f8a`, source `a96a496c4c00acead32e208158faf7889c31027b8dccde781059a4eb4481f70b`
- Preregistered as V3D-EXP-0057 at 2026-10-27T04:09:47.727Z (receipt `7a447f1038abfe69ad015f7c0019d117557f8ca3d68e7c26185a9f9c7bc6ed36`)
- Authorized at 2026-10-27T04:09:47.838Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `cbf12c7d89ef489930fb2c850ba6610b9e26cb3981f0162fb134de7787ec08ee`
- Record `fbad1c1c6b85cc29f13894f50d69da52f0dd3ca6876ecc2ae732986b04d30c43`, run `FR-e3658b8c03dfba1d29107311`, 2026-10-27T04:09:47.843Z to 2026-10-27T04:09:50.458Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 395.28 fly-seconds, then again for the determinism guard
- Code: commit `352fafda07d29c0d7f4f412073dc129fc5ac7a63`
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
