# FLY-d9af02acb9ff9cdfb90a3256: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Adaptation to repeated looms: repeating a looming stimulus every 10 s on a fixed schedule, against the same stimuli every 90 s on the same schedule.

**Caveat.** This controller's responsiveness falls only after an escape, so the protocol measures habituation that follows responses; a presentation that falls due while the fly is still in the air is skipped and counted (airborne_presentations), never delayed.

**Question (host-written).** In the digital fly simulator, how does repeating a looming stimulus every 10 s on a fixed schedule change fraction of the presentations shown to the standing fly that it answered by an escape, against the same stimuli every 90 s on the same schedule on matched seeds?

**Hypothesis (host-written).** Repeating a looming stimulus every 10 s on a fixed schedule will decrease repeat_escape_probability by at least 0.13 fraction on average over 13 matched seeds drawn after preregistration, compared with the same stimuli every 90 s on the same schedule, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Repeating the stimuli every 10 s lowers the fraction answered by an escape, compared with the same stimuli every 90 s. — competing: [scripted] Responsiveness recovers within 10 s, so the interval leaves the escape probability unchanged.

## Seeds

13 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 4292923277, 1618038939, 466776296, 1951519664, 370556364, 378433922, 3018780138, 1223838023, 2465713759, 3999961781, 617586521, 1163580360, 1676260343.

## Primary metric: repeat_escape_probability (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 4292923277 | 0.583 | 0.417 | -0.167 | expected | `82eac2519c4c` |
| 1618038939 | 0.500 | 0.417 | -0.083 | expected | `01fb080c3037` |
| 466776296 | 0.417 | 0.333 | -0.083 | expected | `fbd9b71e90cb` |
| 1951519664 | 0.667 | 0.417 | -0.250 | expected | `ad06cbd67d4c` |
| 370556364 | 0.750 | 0.417 | -0.333 | expected | `14e0b94b8886` |
| 378433922 | 0.583 | 0.333 | -0.250 | expected | `e1ab15e11298` |
| 3018780138 | 0.417 | 0.333 | -0.083 | expected | `34b5e3dc6410` |
| 1223838023 | 0.500 | 0.250 | -0.250 | expected | `a39ae8ed33cf` |
| 2465713759 | 0.750 | 0.500 | -0.250 | expected | `03bf536f26f5` |
| 3999961781 | 0.667 | 0.333 | -0.333 | expected | `cadc6b0d5c63` |
| 617586521 | 0.833 | 0.500 | -0.333 | expected | `00a327114191` |
| 1163580360 | 0.500 | 0.417 | -0.083 | expected | `bff48eee02d8` |
| 1676260343 | 0.750 | 0.500 | -0.250 | expected | `7ff564e3b704` |

13 of 13 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 1.22e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.609, mean treatment 0.397, mean paired difference **-0.212** (minimum effect 0.13 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 26: observed 26.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 13.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.13: observed -0.2115 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0001 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0005-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| repeat_escape_probability | 0.609 | 0.397 | fraction |
| late_escape_probability | 0.628 | 0.359 | fraction |
| presentations | 12.000 | 12.000 | count |
| airborne_presentations | 0.000 | 0.000 | count |
| repeat_size_at_escape_deg | 46.224 | 48.814 | deg |

## Provenance

- Plan `d9af02acb9ff9cdfb90a3256c1e90bedf9aab29c919856e34b816d3c648e1b5b`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `309bc659d993b7c1affb6353a5aac0e434e9fc502d8d9477013d3af7296aaf38`, source `b9abf944d6d246ff622184e4b0d29ccdf4e3966665643958ab4585d67f4b0aff`
- Preregistered as V3D-EXP-0005 at 2026-10-26T00:33:24.786Z (receipt `3722cb8377668f8f753f5e527e03276d991dddf59535a27d585faa6f218888d6`)
- Authorized at 2026-10-26T00:33:24.817Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `133fb68e997bfd1d1d8a62a80bdf63a432d79df5be6fa25b062a8f07a6422579`
- Record `098800b2b0ffaf8880e3f6aa8dc548946f81c3443790c4f9d7b65cf07feef3cc`, run `FR-34da86dd7e7fc0c9b50ced84`, 2026-10-26T00:33:24.819Z to 2026-10-26T00:33:54.924Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 14381.25 fly-seconds, then again for the determinism guard
- Code: commit `06ff901fae549bb121d80c9b61e0f5c6b61faf77`
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
