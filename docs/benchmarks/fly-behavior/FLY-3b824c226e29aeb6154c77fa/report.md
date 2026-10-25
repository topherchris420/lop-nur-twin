# FLY-3b824c226e29aeb6154c77fa: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Adaptation to repeated looms: repeating a looming stimulus every 10 s on a fixed schedule, against the same stimuli every 90 s on the same schedule.

**Caveat.** This controller's responsiveness falls only after an escape, so the protocol measures habituation that follows responses; a presentation that falls due while the fly is still in the air is skipped and counted (airborne_presentations), never delayed.

**Question (host-written).** In the digital fly simulator, how does repeating a looming stimulus every 10 s on a fixed schedule change fraction of the presentations shown to the standing fly that it answered by an escape, against the same stimuli every 90 s on the same schedule on matched seeds?

**Hypothesis (host-written).** Repeating a looming stimulus every 10 s on a fixed schedule will decrease repeat_escape_probability by at least 0.13 fraction on average over 13 matched seeds drawn after preregistration, compared with the same stimuli every 90 s on the same schedule, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Repeating the stimuli every 10 s lowers the fraction answered by an escape, compared with the same stimuli every 90 s. — competing: [scripted] Responsiveness recovers within 10 s, so the interval leaves the escape probability unchanged.

## Seeds

13 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1790005426, 2117303785, 1096443579, 4279869587, 504601940, 4090514237, 1114913874, 4227408981, 319907617, 761334826, 3730563230, 1307006263, 95066670.

## Primary metric: repeat_escape_probability (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1790005426 | 0.750 | 0.417 | -0.333 | expected | `7f063f854325` |
| 2117303785 | 0.583 | 0.333 | -0.250 | expected | `a543ab7f57ca` |
| 1096443579 | 0.583 | 0.417 | -0.167 | expected | `f6357f45ae3d` |
| 4279869587 | 0.583 | 0.417 | -0.167 | expected | `eeb5892b1bfd` |
| 504601940 | 0.583 | 0.500 | -0.083 | expected | `71f8cbdd3e3b` |
| 4090514237 | 0.417 | 0.250 | -0.167 | expected | `e46717bcbfbf` |
| 1114913874 | 0.333 | 0.250 | -0.083 | expected | `bf93fba39320` |
| 4227408981 | 0.417 | 0.333 | -0.083 | expected | `0e998fad446a` |
| 319907617 | 0.833 | 0.667 | -0.167 | expected | `02b794afbd01` |
| 761334826 | 0.500 | 0.333 | -0.167 | expected | `67f4b7eca4ef` |
| 3730563230 | 0.750 | 0.500 | -0.250 | expected | `6d4d7f1ebb75` |
| 1307006263 | 0.750 | 0.417 | -0.333 | expected | `99fc81cf706b` |
| 95066670 | 0.667 | 0.333 | -0.333 | expected | `f545d5bd7b1f` |

13 of 13 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 1.22e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.596, mean treatment 0.397, mean paired difference **-0.199** (minimum effect 0.13 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 26: observed 26.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 13.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.13: observed -0.1987 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0001 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0008-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| repeat_escape_probability | 0.596 | 0.397 | fraction |
| late_escape_probability | 0.628 | 0.372 | fraction |
| presentations | 12.000 | 12.000 | count |
| airborne_presentations | 0.000 | 0.000 | count |
| repeat_size_at_escape_deg | 46.281 | 49.029 | deg |

## Provenance

- Plan `3b824c226e29aeb6154c77fab3e9a31f95606139e92d900c7562a2ac7b5f85be`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0008 at 2026-10-25T17:30:00.759Z (receipt `40638ef746596cdc928261318f134de8bc686859e426ac9a361d4922b05804b2`)
- Authorized at 2026-10-25T17:30:00.772Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `e81367458600b615288a4c805577fca93380d002a29ed389ac39862fc46b4b1c`
- Record `900a7dd0a9af4874e83643e5fcdef1272e52063324f383f0dfd7f60285acc4b0`, run `FR-1dd6c70bafcc6313ff7c81d1`, 2026-10-25T17:30:00.773Z to 2026-10-25T17:30:27.815Z
- Simulated on node 24.22.1 (V8 13.6.233.17-node.58): 14381.25 fly-seconds, then again for the determinism guard
- Code: commit `a71066264ba3ff3a6949316bdc0f0bcee92c5520`
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
