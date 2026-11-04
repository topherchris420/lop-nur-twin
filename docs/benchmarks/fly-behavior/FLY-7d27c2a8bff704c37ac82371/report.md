# FLY-7d27c2a8bff704c37ac82371: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/9 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Adaptation to repeated looms: repeating a looming stimulus every 10 s on a fixed schedule, against the same stimuli every 90 s on the same schedule.

**Caveat.** This controller's responsiveness falls only after an escape, so the protocol measures habituation that follows responses; a presentation that falls due while the fly is still in the air is skipped and counted (airborne_presentations), never delayed.

**Question (host-written).** In the digital fly simulator, how does repeating a looming stimulus every 10 s on a fixed schedule change fraction of the presentations shown to the standing fly that it answered by an escape, against the same stimuli every 90 s on the same schedule on matched seeds?

**Hypothesis (host-written).** Repeating a looming stimulus every 10 s on a fixed schedule will decrease repeat_escape_probability by at least 0.13 fraction on average over 13 matched seeds drawn after preregistration, compared with the same stimuli every 90 s on the same schedule, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Repeating the stimuli every 10 s lowers the fraction answered by an escape, compared with the same stimuli every 90 s. — competing: [scripted] Responsiveness recovers within 10 s, so the interval leaves the escape probability unchanged.

## Seeds

13 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 320691186, 697534263, 939021946, 1470863383, 464417447, 888063481, 3244676624, 718487300, 591147678, 83313142, 2981627687, 1402844011, 1673625962.

## Primary metric: repeat_escape_probability (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 320691186 | 0.667 | 0.250 | -0.417 | expected | `33c669f23109` |
| 697534263 | 0.667 | 0.417 | -0.250 | expected | `249b2127656e` |
| 939021946 | 0.333 | 0.250 | -0.083 | expected | `dfe75b8bc182` |
| 1470863383 | 0.500 | 0.333 | -0.167 | expected | `e7386683cfbc` |
| 464417447 | 0.417 | 0.333 | -0.083 | expected | `bb9ec56f3533` |
| 888063481 | 0.583 | 0.417 | -0.167 | expected | `a7835d813af3` |
| 3244676624 | 0.583 | 0.333 | -0.250 | expected | `350fed1931a1` |
| 718487300 | 0.750 | 0.417 | -0.333 | expected | `a641fe1a4f18` |
| 591147678 | 0.750 | 0.417 | -0.333 | expected | `64241f0ad2be` |
| 83313142 | 0.583 | 0.417 | -0.167 | expected | `9259c00b214d` |
| 2981627687 | 0.833 | 0.583 | -0.250 | expected | `154c80cd35ec` |
| 1402844011 | 0.833 | 0.500 | -0.333 | expected | `0d4b70ce6b96` |
| 1673625962 | 0.500 | 0.250 | -0.250 | expected | `5c92d9518cb7` |

13 of 13 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 1.22e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.615, mean treatment 0.378, mean paired difference **-0.237** (minimum effect 0.13 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 26: observed 26.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 13.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.13: observed -0.2372 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0001 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0005-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| repeat_escape_probability | 0.615 | 0.378 | fraction |
| late_escape_probability | 0.654 | 0.321 | fraction |
| presentations | 12.000 | 12.000 | count |
| airborne_presentations | 0.000 | 0.000 | count |
| repeat_size_at_escape_deg | 46.238 | 49.189 | deg |

## Provenance

- Plan `7d27c2a8bff704c37ac82371b2725b303aae9f3d11eb5339707f14cf3f48c132`; fly `digital-fly/9 reduced-order-fsm/v1`, identity `5d8d3589513b67c3b784c7fcc76029b36d3478bb885568e6c79666e2bac6ec7b`, source `3a440f60616f2e78515dcf03a3cc689b54316140fb08d659c5310f63a4a83500`
- Preregistered as V3D-EXP-0005 at 2026-11-04T14:50:27.599Z (receipt `ed7389cd6e5f4520e24a224b9f6599b7d488305e8799728f29299490609a6af8`)
- Authorized at 2026-11-04T14:50:27.712Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `66c21e079aea53f22f8ff0d1d863b54c2cfff1e5d0a383ce25868d301f96ec0b`
- Record `91f5b3fad73f59bd2125a4081fa2836544571d8827632c7d00125796f84ac6d2`, run `FR-0081b49b8bb0f701350fc817`, 2026-11-04T14:50:27.714Z to 2026-11-04T14:51:25.141Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 14381.25 fly-seconds, then again for the determinism guard
- Code: commit `e458f7cb34904d85127779a3700c26b376ab4a80`
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
