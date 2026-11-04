# FLY-e2a696b1091a029ebd8a9168: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/9 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Visual threat: looming dose series: a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s).

**Caveat.** Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.

**Question (host-written).** In the digital fly simulator, how does a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s) on matched seeds?

**Hypothesis (host-written).** A sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) will decrease escape_ttc_s by at least 0.28 s on average over 9 matched seeds drawn after preregistration, compared with the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] At l/v = 40 ms the fly escapes with less time to collision than at l/v = 160 ms, as an angular-size threshold predicts. — competing: [scripted] The escape proxy fires at a fixed time before collision whatever the approach speed.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1255216349, 2191044148, 475990075, 1531547111, 1906174764, 3423457033, 3033580031, 3581934214, 117827806.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1255216349 | 0.385 | 0.093 | -0.292 | expected | `a2bd54c9ccc6` |
| 2191044148 | 0.350 | 0.073 | -0.277 | expected | `d5aa7baf6098` |
| 475990075 | 0.353 | 0.075 | -0.278 | expected | `1975cbd9f855` |
| 1531547111 | 0.385 | 0.090 | -0.295 | expected | `4dc912d0fbc0` |
| 1906174764 | 0.362 | 0.083 | -0.278 | expected | `b78d6b173817` |
| 3423457033 | 0.385 | 0.092 | -0.293 | expected | `9ecd8681d02d` |
| 3033580031 | 0.385 | 0.090 | -0.295 | expected | `b234baa62a88` |
| 3581934214 | 0.385 | 0.095 | -0.290 | expected | `30d291304a03` |
| 117827806 | 0.385 | 0.095 | -0.290 | expected | `7057125563c3` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.375, mean treatment 0.087, mean paired difference **-0.288** (minimum effect 0.28 s).

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
| escape_ttc_s | 0.375 | 0.087 | s |
| escape_latency_s | 3.625 | 0.913 | s |
| size_at_escape_deg | 51.199 | 54.786 | deg |
| short_mode_fraction | 0.000 | 0.111 | fraction |

## Provenance

- Plan `e2a696b1091a029ebd8a916811762b45f288ae79a37ccd871c845015e50980e7`; fly `digital-fly/9 reduced-order-fsm/v1`, identity `5d8d3589513b67c3b784c7fcc76029b36d3478bb885568e6c79666e2bac6ec7b`, source `3a440f60616f2e78515dcf03a3cc689b54316140fb08d659c5310f63a4a83500`
- Preregistered as V3D-EXP-0003 at 2026-11-04T14:47:53.533Z (receipt `520c097332eeb817b864ee243ab820393cff1bc6038fcb225829fba95bf0e96f`)
- Authorized at 2026-11-04T14:47:53.659Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `af67e632319fbe15262197c59a9187bc5fcccad7361ae54416a9c33e9f88b0a3`
- Record `2ed4097da57d2422d6089adee158a21595e1f5e321806f8b2575ee49cae740a4`, run `FR-7cdba8e851ed7ab4fe95c15f`, 2026-11-04T14:47:53.662Z to 2026-11-04T14:47:56.964Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 395.28 fly-seconds, then again for the determinism guard
- Code: commit `e458f7cb34904d85127779a3700c26b376ab4a80`
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
