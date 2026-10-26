# FLY-5bf958d069040a1fa02ad4b2: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Adaptation to repeated looms: repeating a looming stimulus every 10 s on a fixed schedule, against the same stimuli every 90 s on the same schedule.

**Caveat.** This controller's responsiveness falls only after an escape, so the protocol measures habituation that follows responses; a presentation that falls due while the fly is still in the air is skipped and counted (airborne_presentations), never delayed.

**Question (host-written).** In the digital fly simulator, how does repeating a looming stimulus every 10 s on a fixed schedule change fraction of the presentations shown to the standing fly that it answered by an escape, against the same stimuli every 90 s on the same schedule on matched seeds?

**Hypothesis (host-written).** Repeating a looming stimulus every 10 s on a fixed schedule will decrease repeat_escape_probability by at least 0.13 fraction on average over 13 matched seeds drawn after preregistration, compared with the same stimuli every 90 s on the same schedule, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Repeating the stimuli every 10 s lowers the fraction answered by an escape, compared with the same stimuli every 90 s. — competing: [scripted] Responsiveness recovers within 10 s, so the interval leaves the escape probability unchanged.

## Seeds

13 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2246162201, 1134059324, 2005309486, 4109634466, 1165706169, 3966684227, 2846109995, 640855360, 3464130185, 3777529832, 916517447, 3913274246, 3838602517.

## Primary metric: repeat_escape_probability (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2246162201 | 0.750 | 0.417 | -0.333 | expected | `8e1e2e9ed59a` |
| 1134059324 | 0.750 | 0.500 | -0.250 | expected | `5a538096fc3a` |
| 2005309486 | 0.417 | 0.250 | -0.167 | expected | `22a5a9c192cc` |
| 4109634466 | 0.417 | 0.333 | -0.083 | expected | `a1ab69e19f9b` |
| 1165706169 | 0.583 | 0.417 | -0.167 | expected | `bb070665c320` |
| 3966684227 | 0.583 | 0.333 | -0.250 | expected | `47e11b5829d7` |
| 2846109995 | 0.667 | 0.417 | -0.250 | expected | `dcea778eaca9` |
| 640855360 | 0.667 | 0.417 | -0.250 | expected | `d694c7ab3003` |
| 3464130185 | 0.417 | 0.333 | -0.083 | expected | `f120ddfc532d` |
| 3777529832 | 0.667 | 0.500 | -0.167 | expected | `39c3efe1acb5` |
| 916517447 | 0.667 | 0.417 | -0.250 | expected | `de7dc9a828dd` |
| 3913274246 | 0.750 | 0.417 | -0.333 | expected | `8d555f386fe9` |
| 3838602517 | 0.917 | 0.583 | -0.333 | expected | `b2d4de4adc75` |

13 of 13 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 1.22e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.635, mean treatment 0.410, mean paired difference **-0.224** (minimum effect 0.13 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 26: observed 26.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 13.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.13: observed -0.2244 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0001 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0023-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| repeat_escape_probability | 0.635 | 0.410 | fraction |
| late_escape_probability | 0.590 | 0.308 | fraction |
| presentations | 12.000 | 12.000 | count |
| airborne_presentations | 0.000 | 0.000 | count |
| repeat_size_at_escape_deg | 46.442 | 49.459 | deg |

## Provenance

- Plan `5bf958d069040a1fa02ad4b2f61581a49ae00905b75de30e7fc2fe6273f91fcc`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `44a4d99fc81cf563bb4ff40377cff7d1ae9881d95c6cf3b17851e5804539805d`, source `b794ba087d2c9dbb0d589758d6d2e0a89d958b3f2b626d50ab3388266513a682`
- Preregistered as V3D-EXP-0023 at 2026-10-26T05:44:20.470Z (receipt `cc1bda2d01b796ef82953a0e118122a073f407d743e8b5ecd9770697fabe3350`)
- Authorized at 2026-10-26T05:44:20.551Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `8a6225e1b3a45238d5e4d82143522c729533bf6611ca6c442c3467f4adf7a3e6`
- Record `8417380e5f5f69984ec4795457f91dee8929f21833de6d6b1614aca8ae5c7714`, run `FR-78a565c13c302e96a9493fe6`, 2026-10-26T05:44:20.555Z to 2026-10-26T05:45:22.559Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 14381.25 fly-seconds, then again for the determinism guard
- Code: commit `6ea1990ebc33011e02ad26083bebb719dc837d1b`
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
