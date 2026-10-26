# FLY-65c74ea9be437939b76eea51: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Visual threat: looming dose series: a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s).

**Caveat.** Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.

**Question (host-written).** In the digital fly simulator, how does a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s) on matched seeds?

**Hypothesis (host-written).** A sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) will decrease escape_ttc_s by at least 0.28 s on average over 9 matched seeds drawn after preregistration, compared with the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] At l/v = 40 ms the fly escapes with less time to collision than at l/v = 160 ms, as an angular-size threshold predicts. — competing: [scripted] The escape proxy fires at a fixed time before collision whatever the approach speed.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3159430525, 391841676, 500851089, 2068739636, 2146982284, 3331993802, 2069390414, 827750841, 377421672.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3159430525 | 0.385 | 0.095 | -0.290 | expected | `86770dabd065` |
| 391841676 | 0.385 | 0.095 | -0.290 | expected | `9f1176804ea5` |
| 500851089 | 0.385 | 0.095 | -0.290 | expected | `c4f9f3b47824` |
| 2068739636 | 0.385 | 0.095 | -0.290 | expected | `9d5707f880f2` |
| 2146982284 | 0.385 | 0.095 | -0.290 | expected | `7042aaa48d10` |
| 3331993802 | 0.385 | 0.095 | -0.290 | expected | `7ae268f15c60` |
| 2069390414 | 0.372 | 0.085 | -0.287 | expected | `541c3c126a94` |
| 827750841 | 0.385 | 0.095 | -0.290 | expected | `12319576b003` |
| 377421672 | 0.385 | 0.095 | -0.290 | expected | `d68b7191aa86` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.384, mean treatment 0.094, mean paired difference **-0.290** (minimum effect 0.28 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.28: observed -0.2896 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0048-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.384 | 0.094 | s |
| escape_latency_s | 3.616 | 0.906 | s |
| size_at_escape_deg | 49.375 | 50.547 | deg |
| short_mode_fraction | 0.000 | 0.019 | fraction |

## Provenance

- Plan `65c74ea9be437939b76eea51e337396f6c150bda74201c4c485ea06dbbead144`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `8d86753f0ca7a7395da5a6b7f3902bd120428b515dc616340ef12e9ae0489eed`, source `86708015e47c271602b7856459ea1d6ff513ea0f1df0bb8587c3f192a417f022`
- Preregistered as V3D-EXP-0048 at 2026-10-26T23:26:14.226Z (receipt `390b1e618a1c3e5699c607f7b7f0e643354e96d71ac2b53877562e2313317beb`)
- Authorized at 2026-10-26T23:26:14.252Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `a86763623f722e4b5e7d6f3bbc1d52ad678f4e2698a13460f0419f91ff0fef43`
- Record `ddf90f823391f3296db5aad73c072630130ba9bfb8829f9a2d2ce0a5eb1531f0`, run `FR-92089fc0d268eb2186b63743`, 2026-10-26T23:26:14.254Z to 2026-10-26T23:26:14.912Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 395.28 fly-seconds, then again for the determinism guard
- Code: commit `fb76ce5c5fc61f279bc5980bd1ea22863c0cdb8d`
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
