# FLY-ae19ee6988dea30cb0c59c63: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Visual threat: looming dose series: a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s).

**Caveat.** Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.

**Question (host-written).** In the digital fly simulator, how does a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s) on matched seeds?

**Hypothesis (host-written).** A sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) will decrease escape_ttc_s by at least 0.28 s on average over 9 matched seeds drawn after preregistration, compared with the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] At l/v = 40 ms the fly escapes with less time to collision than at l/v = 160 ms, as an angular-size threshold predicts. — competing: [scripted] The escape proxy fires at a fixed time before collision whatever the approach speed.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 932782969, 672496185, 1005596133, 54151654, 1007545950, 4266349324, 3915679034, 1467920358, 3129508818.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 932782969 | 0.342 | 0.073 | -0.268 | expected | `8c0692637025` |
| 672496185 | 0.373 | 0.087 | -0.287 | expected | `e93c0381e450` |
| 1005596133 | 0.385 | 0.095 | -0.290 | expected | `47574e2f86df` |
| 54151654 | 0.385 | 0.095 | -0.290 | expected | `f7168c2c8e91` |
| 1007545950 | 0.385 | 0.090 | -0.295 | expected | `e61093a78ad0` |
| 4266349324 | 0.358 | 0.095 | -0.263 | expected | `63b40115acaa` |
| 3915679034 | 0.385 | 0.095 | -0.290 | expected | `7eaf92db1aed` |
| 1467920358 | 0.385 | 0.087 | -0.298 | expected | `cedbf61258b8` |
| 3129508818 | 0.378 | 0.080 | -0.298 | expected | `8508a1cb1bcc` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.375, mean treatment 0.089, mean paired difference **-0.287** (minimum effect 0.28 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.28: observed -0.2867 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0039-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| escape_probability | 1.000 | 0.981 | fraction |
| escape_ttc_s | 0.375 | 0.089 | s |
| escape_latency_s | 3.625 | 0.911 | s |
| size_at_escape_deg | 51.292 | 54.764 | deg |
| short_mode_fraction | 0.000 | 0.130 | fraction |

## Provenance

- Plan `ae19ee6988dea30cb0c59c63890f945875c38aafe7c078db44157bb809daeacb`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `e2eb5e95c355777d19a210820fb203fc9ef47608031b98fa85882280e85cfdca`, source `daad49019246c38c2673cd442ecaae50eba95994635676bdc333b5563cebfb78`
- Preregistered as V3D-EXP-0039 at 2026-10-26T20:15:04.517Z (receipt `2e2ea5e05b861d834e745d608f372f3ea88ef7c3e007445ace14294b983c4df0`)
- Authorized at 2026-10-26T20:15:04.543Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `f4cdcade0f4eff4b5224aa5afa806be08006779a5be19a4c29384d2d97bbda6e`
- Record `dbe69a3957fc523328ae911f18a7dfdb2ca61ae3b377a8e34d781fd2851bc2f5`, run `FR-a653f0b1a6952e5c4b79e603`, 2026-10-26T20:15:04.544Z to 2026-10-26T20:15:05.204Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 395.28 fly-seconds, then again for the determinism guard
- Code: commit `379fb9debfbd203f99d6c76ac80097706945dd2d`
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
