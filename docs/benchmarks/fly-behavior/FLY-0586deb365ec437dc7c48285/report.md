# FLY-0586deb365ec437dc7c48285: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Adaptation to repeated looms: repeating a looming stimulus every 10 s on a fixed schedule, against the same stimuli every 90 s on the same schedule.

**Caveat.** This controller's responsiveness falls only after an escape, so the protocol measures habituation that follows responses; a presentation that falls due while the fly is still in the air is skipped and counted (airborne_presentations), never delayed.

**Question (host-written).** In the digital fly simulator, how does repeating a looming stimulus every 10 s on a fixed schedule change fraction of the presentations shown to the standing fly that it answered by an escape, against the same stimuli every 90 s on the same schedule on matched seeds?

**Hypothesis (host-written).** Repeating a looming stimulus every 10 s on a fixed schedule will decrease repeat_escape_probability by at least 0.13 fraction on average over 13 matched seeds drawn after preregistration, compared with the same stimuli every 90 s on the same schedule, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Repeating the stimuli every 10 s lowers the fraction answered by an escape, compared with the same stimuli every 90 s. — competing: [scripted] Responsiveness recovers within 10 s, so the interval leaves the escape probability unchanged.

## Seeds

13 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3178799094, 819131252, 1511848844, 672968455, 744648987, 183848288, 1868516263, 3330815147, 2541632804, 197559720, 389360755, 2349772424, 3777539270.

## Primary metric: repeat_escape_probability (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3178799094 | 0.750 | 0.500 | -0.250 | expected | `db20f85b3429` |
| 819131252 | 0.500 | 0.333 | -0.167 | expected | `7c9fbe87e63a` |
| 1511848844 | 0.667 | 0.500 | -0.167 | expected | `3aaf37e9a1d9` |
| 672968455 | 0.750 | 0.417 | -0.333 | expected | `3ff5a6c6ca4b` |
| 744648987 | 0.500 | 0.333 | -0.167 | expected | `21e1b1fe1fb9` |
| 183848288 | 0.667 | 0.500 | -0.167 | expected | `467ccebb1511` |
| 1868516263 | 0.500 | 0.417 | -0.083 | expected | `6358602a82eb` |
| 3330815147 | 0.750 | 0.417 | -0.333 | expected | `c4559ff8b1c7` |
| 2541632804 | 0.250 | 0.250 | 0.000 | tie | `d3ea47fe77fa` |
| 197559720 | 0.583 | 0.167 | -0.417 | expected | `ce387286656c` |
| 389360755 | 0.833 | 0.500 | -0.333 | expected | `a6d5a2d62529` |
| 2349772424 | 0.583 | 0.333 | -0.250 | expected | `e0437832f93e` |
| 3777539270 | 0.667 | 0.333 | -0.333 | expected | `ba6f27486256` |

12 of 12 untied seeds in the expected direction (decrease), 0 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 2.44e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.615, mean treatment 0.385, mean paired difference **-0.231** (minimum effect 0.13 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 26: observed 26.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.13: observed -0.2308 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0002 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0032-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| repeat_escape_probability | 0.615 | 0.385 | fraction |
| late_escape_probability | 0.667 | 0.385 | fraction |
| presentations | 12.000 | 12.000 | count |
| airborne_presentations | 0.000 | 0.000 | count |
| repeat_size_at_escape_deg | 46.026 | 48.472 | deg |

## Provenance

- Plan `0586deb365ec437dc7c482851134daa8904a316068fedae15b6519ce230b59b6`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `ff9c46c2a17247b1e4327a4763992d16722b4f6ef0c5ea58c211d1ee192cf514`, source `359ee8a2b23084a3726b5b2bab6e7ee39eb27578e0956b6dd6b66e6489bf34c8`
- Preregistered as V3D-EXP-0032 at 2026-10-26T13:07:59.872Z (receipt `b9fed0ddfa80eee95d03168387e54707c595a0850a06d820b28028570439b335`)
- Authorized at 2026-10-26T13:07:59.895Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `75b667e3cde676a8469fa3f3711c9d89b9717efaba37f373ad55667fdea0c7d8`
- Record `6c4c4261664db233f5896f3f13e3f45babb18502c15da0ed50d13c104ec7e021`, run `FR-aff763cb3e3b9992f08d2b8d`, 2026-10-26T13:07:59.897Z to 2026-10-26T13:08:14.040Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 14381.25 fly-seconds, then again for the determinism guard
- Code: commit `27af8430b03ffd5284d3609788b39b359c1aa099`
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
