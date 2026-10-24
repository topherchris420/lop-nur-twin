# FLY-41934d77344bb32aa8cb730f: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/5 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Adaptation to repeated looms: repeating a looming stimulus every 10 s on a fixed schedule, against the same stimuli every 90 s on the same schedule.

**Caveat.** This controller's responsiveness falls only after an escape, so the protocol measures habituation that follows responses; a presentation that falls due while the fly is still in the air is skipped and counted (airborne_presentations), never delayed.

**Question (host-written).** In the digital fly simulator, how does repeating a looming stimulus every 10 s on a fixed schedule change fraction of the presentations shown to the standing fly that it answered by an escape, against the same stimuli every 90 s on the same schedule on matched seeds?

**Hypothesis (host-written).** Repeating a looming stimulus every 10 s on a fixed schedule will decrease repeat_escape_probability by at least 0.13 fraction on average over 13 matched seeds drawn after preregistration, compared with the same stimuli every 90 s on the same schedule, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Repeating the stimuli every 10 s lowers the fraction answered by an escape, compared with the same stimuli every 90 s. — competing: [scripted] Responsiveness recovers within 10 s, so the interval leaves the escape probability unchanged.

## Seeds

13 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2576043091, 3605484836, 3368567384, 4083759572, 3371729195, 449878822, 837128733, 2426992800, 3206680130, 3652425686, 18908138, 1006037251, 664662144.

## Primary metric: repeat_escape_probability (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2576043091 | 0.750 | 0.417 | -0.333 | expected | `001dc00b88df` |
| 3605484836 | 0.750 | 0.417 | -0.333 | expected | `8a67d58ff63f` |
| 3368567384 | 0.500 | 0.417 | -0.083 | expected | `cdcc19afb6d7` |
| 4083759572 | 0.583 | 0.417 | -0.167 | expected | `7ff94003ddd5` |
| 3371729195 | 0.500 | 0.417 | -0.083 | expected | `cd0423900c66` |
| 449878822 | 0.500 | 0.250 | -0.250 | expected | `35e97900569a` |
| 837128733 | 0.667 | 0.500 | -0.167 | expected | `58b1a9496265` |
| 2426992800 | 0.667 | 0.333 | -0.333 | expected | `caae11167608` |
| 3206680130 | 0.500 | 0.250 | -0.250 | expected | `c65e0e016f6f` |
| 3652425686 | 0.667 | 0.417 | -0.250 | expected | `2f236eab2582` |
| 18908138 | 0.583 | 0.333 | -0.250 | expected | `8b9dfc3605cd` |
| 1006037251 | 0.583 | 0.417 | -0.167 | expected | `028fee152ea6` |
| 664662144 | 0.667 | 0.500 | -0.167 | expected | `b5041446dfcc` |

13 of 13 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 1.22e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.609, mean treatment 0.391, mean paired difference **-0.218** (minimum effect 0.13 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 26: observed 26.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 13.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.13: observed -0.2179 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0001 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0005-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| repeat_escape_probability | 0.609 | 0.391 | fraction |
| late_escape_probability | 0.590 | 0.385 | fraction |
| presentations | 12.000 | 12.000 | count |
| airborne_presentations | 0.000 | 0.000 | count |
| repeat_size_at_escape_deg | 46.121 | 49.542 | deg |

## Provenance

- Plan `41934d77344bb32aa8cb730f2ee86397bda97c0be111b45f01e22d0383d8ff52`; fly `digital-fly/5 reduced-order-fsm/v1`, identity `aeefc422fb7ee9ac538fe71c558eefcf8aacb8bf84fcf56b45b9085e6e296fa7`, source `0f6eef0366d07c5e8abedbad54bb5eaf3b922b10a7c2ff0447b1bf9ca16b25d7`
- Preregistered as V3D-EXP-0005 at 2026-10-24T16:11:51.070Z (receipt `3bb9d60cb29bd1fa3e9b48084c47e388fb89288439b81f4940f56b26eebc8d2b`)
- Authorized at 2026-10-24T16:11:51.084Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `563b9718d0eeb229967fd50edb294c1b4c0b0f041fe3043943614866ebf30062`
- Record `95641ccfb314e085ad75ad184a0346ac71cc799a85a2e3e07f4217bf0baa2576`, run `FR-ad81ca0874ddc541e2871ee1`, 2026-10-24T16:11:51.085Z to 2026-10-24T16:12:15.926Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 14381.25 fly-seconds, then again for the determinism guard
- Code: commit `f8cdf135f830bdfecce08f1fd1a38d992767c365`
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
