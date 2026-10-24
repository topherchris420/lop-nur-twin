# FLY-8231970a7703d0b40d496d7f: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/4 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Adaptation to repeated looms: repeating a looming stimulus every 10 s on a fixed schedule, against the same stimuli every 90 s on the same schedule.

**Caveat.** This controller's responsiveness falls only after an escape, so the protocol measures habituation that follows responses; a presentation that falls due while the fly is still in the air is skipped and counted (airborne_presentations), never delayed.

**Question (host-written).** In the digital fly simulator, how does repeating a looming stimulus every 10 s on a fixed schedule change fraction of the presentations shown to the standing fly that it answered by an escape, against the same stimuli every 90 s on the same schedule on matched seeds?

**Hypothesis (host-written).** Repeating a looming stimulus every 10 s on a fixed schedule will decrease repeat_escape_probability by at least 0.13 fraction on average over 13 matched seeds drawn after preregistration, compared with the same stimuli every 90 s on the same schedule, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Repeating the stimuli every 10 s lowers the fraction answered by an escape, compared with the same stimuli every 90 s. — competing: [scripted] Responsiveness recovers within 10 s, so the interval leaves the escape probability unchanged.

## Seeds

13 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1650121176, 3942353281, 1047888603, 1919343834, 150292520, 3680854182, 3081916941, 2910574399, 1719363516, 1442272752, 4017972720, 489495374, 1610921373.

## Primary metric: repeat_escape_probability (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1650121176 | 0.417 | 0.250 | -0.167 | expected | `0c04388a76d9` |
| 3942353281 | 0.333 | 0.250 | -0.083 | expected | `5823531d330e` |
| 1047888603 | 0.500 | 0.250 | -0.250 | expected | `343dbbdec513` |
| 1919343834 | 0.417 | 0.333 | -0.083 | expected | `d9571be1ba5f` |
| 150292520 | 0.583 | 0.417 | -0.167 | expected | `31a8349c2e2e` |
| 3680854182 | 0.750 | 0.417 | -0.333 | expected | `c56c6f947d4c` |
| 3081916941 | 0.417 | 0.333 | -0.083 | expected | `61ae2dba547d` |
| 2910574399 | 0.583 | 0.417 | -0.167 | expected | `02c04e0bc9e4` |
| 1719363516 | 0.417 | 0.333 | -0.083 | expected | `357f3ec664ac` |
| 1442272752 | 0.667 | 0.417 | -0.250 | expected | `2c935c3d3b04` |
| 4017972720 | 0.500 | 0.250 | -0.250 | expected | `afd5135ac7df` |
| 489495374 | 0.500 | 0.333 | -0.167 | expected | `ca52b5e66de7` |
| 1610921373 | 0.667 | 0.500 | -0.167 | expected | `eb4c9cae16fe` |

13 of 13 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 1.22e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.519, mean treatment 0.346, mean paired difference **-0.173** (minimum effect 0.13 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 26: observed 26.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 13.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.13: observed -0.1731 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0001 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0017-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| repeat_escape_probability | 0.519 | 0.346 | fraction |
| late_escape_probability | 0.538 | 0.308 | fraction |
| presentations | 12.000 | 12.000 | count |
| airborne_presentations | 0.000 | 0.000 | count |
| repeat_size_at_escape_deg | 46.153 | 48.559 | deg |

## Provenance

- Plan `8231970a7703d0b40d496d7f5d941f7cda23eaa47356d86e026bbe8191909fbf`; fly `digital-fly/4 reduced-order-fsm/v1`, identity `02776ebf688fc2989a8fe4f6871b30825e567d27ea64b5aecfd3ecf2760b448c`, source `69a28d5897711f339ac6fe76bbd486a76310346b93b62093ce8874c12331380e`
- Preregistered as V3D-EXP-0017 at 2026-10-24T02:52:04.172Z (receipt `5afad420f4cdb444460020b096daeb53f1a0e78b3fae961caa2324936b7a63ed`)
- Authorized at 2026-10-24T02:52:04.222Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `eeede678121186a21922a7b47e3f1d843684d5038fb01d145640ccc06f2610d9`
- Record `eebc7c7a9778555d2749c7d960e23636cc505d26ef62fd6d0c4096f0752fff8d`, run `FR-31aa5b173ab831cef237bf09`, 2026-10-24T02:52:04.225Z to 2026-10-24T02:52:38.458Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 14381.25 fly-seconds, then again for the determinism guard
- Code: commit `c0f72973e32a0e9924a909da2a70b480994879e6`
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
