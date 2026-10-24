# FLY-f36e9ded3ddd7ae75a4aedd0: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/6 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Adaptation to repeated looms: repeating a looming stimulus every 10 s on a fixed schedule, against the same stimuli every 90 s on the same schedule.

**Caveat.** This controller's responsiveness falls only after an escape, so the protocol measures habituation that follows responses; a presentation that falls due while the fly is still in the air is skipped and counted (airborne_presentations), never delayed.

**Question (host-written).** In the digital fly simulator, how does repeating a looming stimulus every 10 s on a fixed schedule change fraction of the presentations shown to the standing fly that it answered by an escape, against the same stimuli every 90 s on the same schedule on matched seeds?

**Hypothesis (host-written).** Repeating a looming stimulus every 10 s on a fixed schedule will decrease repeat_escape_probability by at least 0.13 fraction on average over 13 matched seeds drawn after preregistration, compared with the same stimuli every 90 s on the same schedule, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Repeating the stimuli every 10 s lowers the fraction answered by an escape, compared with the same stimuli every 90 s. — competing: [scripted] Responsiveness recovers within 10 s, so the interval leaves the escape probability unchanged.

## Seeds

13 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3904329866, 2153998109, 298300885, 2907864184, 435249301, 4164827072, 332448023, 3983443137, 2242132993, 956803240, 870212926, 2456809623, 743708427.

## Primary metric: repeat_escape_probability (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3904329866 | 0.083 | 0.083 | 0.000 | tie | `5bae3229f14c` |
| 2153998109 | 0.417 | 0.333 | -0.083 | expected | `ce0cba1e4020` |
| 298300885 | 0.583 | 0.417 | -0.167 | expected | `1aac5fdfac32` |
| 2907864184 | 0.500 | 0.250 | -0.250 | expected | `258360c21518` |
| 435249301 | 0.417 | 0.417 | 0.000 | tie | `a689eb6465dc` |
| 4164827072 | 0.583 | 0.333 | -0.250 | expected | `14942d537531` |
| 332448023 | 0.667 | 0.250 | -0.417 | expected | `4117b4922157` |
| 3983443137 | 0.667 | 0.500 | -0.167 | expected | `4b6c3be0a36e` |
| 2242132993 | 0.583 | 0.333 | -0.250 | expected | `b7a98f6f933e` |
| 956803240 | 0.500 | 0.250 | -0.250 | expected | `23327448ea8b` |
| 870212926 | 0.583 | 0.333 | -0.250 | expected | `c7eddef69403` |
| 2456809623 | 0.417 | 0.250 | -0.167 | expected | `582cce6ccffc` |
| 743708427 | 0.583 | 0.333 | -0.250 | expected | `03f7bd095cb2` |

11 of 11 untied seeds in the expected direction (decrease), 0 opposite, 2 tied, 0 undefined. Exact one-sided sign test: p = 4.88e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.506, mean treatment 0.314, mean paired difference **-0.192** (minimum effect 0.13 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 26: observed 26.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 11.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.13: observed -0.1923 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0005 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0005-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| repeat_escape_probability | 0.506 | 0.314 | fraction |
| late_escape_probability | 0.551 | 0.333 | fraction |
| presentations | 12.000 | 12.000 | count |
| airborne_presentations | 0.000 | 0.000 | count |
| repeat_size_at_escape_deg | 46.126 | 48.257 | deg |

## Provenance

- Plan `f36e9ded3ddd7ae75a4aedd0292dc9d5a5ef0389c87f462819b1782e631ae938`; fly `digital-fly/6 reduced-order-fsm/v1`, identity `ad5cea56d67036ecf47acddc8bcad249ff0eea83de3593c3b9850b524eb4f46d`, source `167ae70ac8ff41678590d70cf73640164392e6c73b9b1613b5f075575b715d87`
- Preregistered as V3D-EXP-0005 at 2026-10-24T19:26:00.403Z (receipt `a4210dd96bb3c1ed3bbb06752e2727aea7f72e5eb4c0d7f6ebab1d4247278af5`)
- Authorized at 2026-10-24T19:26:00.418Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `232105589d876be6873ae3c8c0786c607b5cf68781c6f1d82988f9796da81e59`
- Record `e16f444d0165503ee2b2caaba37b3f9607268047515a3f237c8b5ad2deeaea65`, run `FR-b37f7a2412ae8f263ce2055d`, 2026-10-24T19:26:00.419Z to 2026-10-24T19:26:28.260Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 14381.25 fly-seconds, then again for the determinism guard
- Code: commit `300a2aa64e7d8771297c525e8b7159a56e84aeb6`
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
