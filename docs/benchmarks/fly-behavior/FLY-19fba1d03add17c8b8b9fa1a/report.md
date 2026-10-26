# FLY-19fba1d03add17c8b8b9fa1a: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Adaptation to repeated looms: repeating a looming stimulus every 10 s on a fixed schedule, against the same stimuli every 90 s on the same schedule.

**Caveat.** This controller's responsiveness falls only after an escape, so the protocol measures habituation that follows responses; a presentation that falls due while the fly is still in the air is skipped and counted (airborne_presentations), never delayed.

**Question (host-written).** In the digital fly simulator, how does repeating a looming stimulus every 10 s on a fixed schedule change fraction of the presentations shown to the standing fly that it answered by an escape, against the same stimuli every 90 s on the same schedule on matched seeds?

**Hypothesis (host-written).** Repeating a looming stimulus every 10 s on a fixed schedule will decrease repeat_escape_probability by at least 0.13 fraction on average over 13 matched seeds drawn after preregistration, compared with the same stimuli every 90 s on the same schedule, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Repeating the stimuli every 10 s lowers the fraction answered by an escape, compared with the same stimuli every 90 s. — competing: [scripted] Responsiveness recovers within 10 s, so the interval leaves the escape probability unchanged.

## Seeds

13 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 4112278708, 2116269135, 1003741044, 3226058571, 220972160, 1024340247, 2006023439, 2161700030, 3618152250, 2412698071, 2086622337, 19692008, 1679532901.

## Primary metric: repeat_escape_probability (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 4112278708 | 0.750 | 0.583 | -0.167 | expected | `a75c1188ebb6` |
| 2116269135 | 0.333 | 0.250 | -0.083 | expected | `f575b37af319` |
| 1003741044 | 0.583 | 0.500 | -0.083 | expected | `bb475e9afaa2` |
| 3226058571 | 0.583 | 0.500 | -0.083 | expected | `30be92672b12` |
| 220972160 | 0.583 | 0.333 | -0.250 | expected | `d785849a9a8e` |
| 1024340247 | 0.333 | 0.250 | -0.083 | expected | `29b54de6c087` |
| 2006023439 | 0.583 | 0.333 | -0.250 | expected | `0fa3461fcfe0` |
| 2161700030 | 0.583 | 0.417 | -0.167 | expected | `48dce65548b1` |
| 3618152250 | 0.667 | 0.500 | -0.167 | expected | `ab2f7976bc7c` |
| 2412698071 | 0.833 | 0.500 | -0.333 | expected | `0c5e3bc8a8ab` |
| 2086622337 | 0.583 | 0.417 | -0.167 | expected | `330f28620124` |
| 19692008 | 0.500 | 0.417 | -0.083 | expected | `a67e1fbe3f62` |
| 1679532901 | 0.833 | 0.417 | -0.417 | expected | `647f5b82479a` |

13 of 13 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 1.22e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.596, mean treatment 0.417, mean paired difference **-0.179** (minimum effect 0.13 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 26: observed 26.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 13.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.13: observed -0.1795 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0001 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0041-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| repeat_escape_probability | 0.596 | 0.417 | fraction |
| late_escape_probability | 0.641 | 0.423 | fraction |
| presentations | 12.000 | 12.000 | count |
| airborne_presentations | 0.000 | 0.000 | count |
| repeat_size_at_escape_deg | 46.674 | 49.499 | deg |

## Provenance

- Plan `19fba1d03add17c8b8b9fa1aa3f1162708fa1e3720c2db639d691cce264a0f7f`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `e2eb5e95c355777d19a210820fb203fc9ef47608031b98fa85882280e85cfdca`, source `daad49019246c38c2673cd442ecaae50eba95994635676bdc333b5563cebfb78`
- Preregistered as V3D-EXP-0041 at 2026-10-26T20:15:30.115Z (receipt `10f9e688e0f883a5264ce2fc874db838fe4ff756425c7f395cb6be19a4f765e6`)
- Authorized at 2026-10-26T20:15:30.141Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `d58f7bd451db52643d3586c9dd8e6d34e7da3cc990d0e9b2c9a1b97b94aefe90`
- Record `035a6065b3b1ed579df2f3691d1a241a46c662ee8a62bbe1e108826c21a709a0`, run `FR-d2b894b31708744c20013b13`, 2026-10-26T20:15:30.142Z to 2026-10-26T20:15:44.447Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 14381.25 fly-seconds, then again for the determinism guard
- Code: commit `379fb9debfbd203f99d6c76ac80097706945dd2d`
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
