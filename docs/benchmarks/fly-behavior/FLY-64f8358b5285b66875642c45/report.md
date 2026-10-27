# FLY-64f8358b5285b66875642c45: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Adaptation to repeated looms: repeating a looming stimulus every 10 s on a fixed schedule, against the same stimuli every 90 s on the same schedule.

**Caveat.** This controller's responsiveness falls only after an escape, so the protocol measures habituation that follows responses; a presentation that falls due while the fly is still in the air is skipped and counted (airborne_presentations), never delayed.

**Question (host-written).** In the digital fly simulator, how does repeating a looming stimulus every 10 s on a fixed schedule change fraction of the presentations shown to the standing fly that it answered by an escape, against the same stimuli every 90 s on the same schedule on matched seeds?

**Hypothesis (host-written).** Repeating a looming stimulus every 10 s on a fixed schedule will decrease repeat_escape_probability by at least 0.13 fraction on average over 13 matched seeds drawn after preregistration, compared with the same stimuli every 90 s on the same schedule, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Repeating the stimuli every 10 s lowers the fraction answered by an escape, compared with the same stimuli every 90 s. — competing: [scripted] Responsiveness recovers within 10 s, so the interval leaves the escape probability unchanged.

## Seeds

13 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 4125552283, 1537086241, 300251467, 2383756041, 1673782977, 1519494928, 3210726236, 2740078154, 4106829293, 944738855, 3011465892, 901402124, 727292076.

## Primary metric: repeat_escape_probability (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 4125552283 | 0.667 | 0.500 | -0.167 | expected | `fa8695cc366a` |
| 1537086241 | 0.500 | 0.250 | -0.250 | expected | `f62203814d6f` |
| 300251467 | 0.750 | 0.417 | -0.333 | expected | `a3882a390618` |
| 2383756041 | 0.417 | 0.250 | -0.167 | expected | `d3b983a28465` |
| 1673782977 | 0.583 | 0.417 | -0.167 | expected | `8cdd1684d741` |
| 1519494928 | 0.500 | 0.333 | -0.167 | expected | `d0774bb78721` |
| 3210726236 | 0.583 | 0.500 | -0.083 | expected | `938f3c0f0d82` |
| 2740078154 | 0.417 | 0.167 | -0.250 | expected | `cb6762c0e6c8` |
| 4106829293 | 0.667 | 0.500 | -0.167 | expected | `f097ffc2f5ca` |
| 944738855 | 0.833 | 0.500 | -0.333 | expected | `def7816dc923` |
| 3011465892 | 0.750 | 0.500 | -0.250 | expected | `43c6b6eb0ac1` |
| 901402124 | 0.500 | 0.333 | -0.167 | expected | `08cbe3a71832` |
| 727292076 | 0.333 | 0.333 | 0.000 | tie | `48f923d6d084` |

12 of 12 untied seeds in the expected direction (decrease), 0 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 2.44e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.577, mean treatment 0.385, mean paired difference **-0.192** (minimum effect 0.13 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 26: observed 26.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.13: observed -0.1923 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0002 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0050-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| repeat_escape_probability | 0.577 | 0.385 | fraction |
| late_escape_probability | 0.590 | 0.321 | fraction |
| presentations | 12.000 | 12.000 | count |
| airborne_presentations | 0.000 | 0.000 | count |
| repeat_size_at_escape_deg | 46.181 | 48.518 | deg |

## Provenance

- Plan `64f8358b5285b66875642c45f9f740b56fc457fdd6e1628b77c2f449fc376eff`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `8d86753f0ca7a7395da5a6b7f3902bd120428b515dc616340ef12e9ae0489eed`, source `86708015e47c271602b7856459ea1d6ff513ea0f1df0bb8587c3f192a417f022`
- Preregistered as V3D-EXP-0050 at 2026-10-26T23:26:39.732Z (receipt `886c913a26d18e4d6c156fd06f575f79069590e8371e24998ea48ff3707f0c31`)
- Authorized at 2026-10-26T23:26:39.761Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `0d071c0844bd3af2ee8e2bed45e0d2d6ec7f122dd8d49b947a1781a09ede034b`
- Record `ad55d57a51a2e0db602ee64fe5119f3907f3c958b56b552f83d515f7c8ea9b87`, run `FR-65e37351d5e07cc45e319950`, 2026-10-26T23:26:39.763Z to 2026-10-26T23:26:54.008Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 14381.25 fly-seconds, then again for the determinism guard
- Code: commit `fb76ce5c5fc61f279bc5980bd1ea22863c0cdb8d`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- This controller's responsiveness falls only after an escape, so the protocol measures habituation that follows responses; a presentation that falls due while the fly is still in the air is skipped and counted (airborne_presentations), never delayed.
- Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
