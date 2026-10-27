# FLY-2bb48a2439b0abbf09ff258e: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Adaptation to repeated looms: repeating a looming stimulus every 10 s on a fixed schedule, against the same stimuli every 90 s on the same schedule.

**Caveat.** This controller's responsiveness falls only after an escape, so the protocol measures habituation that follows responses; a presentation that falls due while the fly is still in the air is skipped and counted (airborne_presentations), never delayed.

**Question (host-written).** In the digital fly simulator, how does repeating a looming stimulus every 10 s on a fixed schedule change fraction of the presentations shown to the standing fly that it answered by an escape, against the same stimuli every 90 s on the same schedule on matched seeds?

**Hypothesis (host-written).** Repeating a looming stimulus every 10 s on a fixed schedule will decrease repeat_escape_probability by at least 0.13 fraction on average over 13 matched seeds drawn after preregistration, compared with the same stimuli every 90 s on the same schedule, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Repeating the stimuli every 10 s lowers the fraction answered by an escape, compared with the same stimuli every 90 s. — competing: [scripted] Responsiveness recovers within 10 s, so the interval leaves the escape probability unchanged.

## Seeds

13 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1220243220, 3697967819, 3875023894, 4141201604, 1211362307, 3537087296, 1301260461, 149706701, 735736762, 1342903004, 447175897, 3234587934, 3012349222.

## Primary metric: repeat_escape_probability (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1220243220 | 0.500 | 0.417 | -0.083 | expected | `284589840ce9` |
| 3697967819 | 0.500 | 0.417 | -0.083 | expected | `dbb6038abd94` |
| 3875023894 | 0.667 | 0.417 | -0.250 | expected | `cec343306bef` |
| 4141201604 | 0.667 | 0.333 | -0.333 | expected | `022eeafb2d81` |
| 1211362307 | 0.333 | 0.333 | 0.000 | tie | `e3907574145a` |
| 3537087296 | 0.667 | 0.500 | -0.167 | expected | `a7dd0ff71b27` |
| 1301260461 | 0.500 | 0.250 | -0.250 | expected | `3a4ca64d84e1` |
| 149706701 | 0.750 | 0.500 | -0.250 | expected | `b659820392cf` |
| 735736762 | 0.583 | 0.333 | -0.250 | expected | `2e579fe83d5a` |
| 1342903004 | 0.583 | 0.333 | -0.250 | expected | `30b5ef5ce89b` |
| 447175897 | 0.667 | 0.500 | -0.167 | expected | `dd3601f9dbf9` |
| 3234587934 | 0.583 | 0.417 | -0.167 | expected | `50c56bedda21` |
| 3012349222 | 0.583 | 0.417 | -0.167 | expected | `f4dc01ac7fb9` |

12 of 12 untied seeds in the expected direction (decrease), 0 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 2.44e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.583, mean treatment 0.397, mean paired difference **-0.186** (minimum effect 0.13 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 26: observed 26.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.13: observed -0.1859 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0002 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0059-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| repeat_escape_probability | 0.583 | 0.397 | fraction |
| late_escape_probability | 0.590 | 0.346 | fraction |
| presentations | 12.000 | 12.000 | count |
| airborne_presentations | 0.000 | 0.000 | count |
| repeat_size_at_escape_deg | 46.536 | 49.387 | deg |

## Provenance

- Plan `2bb48a2439b0abbf09ff258e53599d1d524e2156cfcba0b3c2b3f376e56ecd77`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `c684a7f0002390bee7e62d529bc459479c35e45465749ad174bd99aca71a5f8a`, source `a96a496c4c00acead32e208158faf7889c31027b8dccde781059a4eb4481f70b`
- Preregistered as V3D-EXP-0059 at 2026-10-27T04:11:29.400Z (receipt `e550577805779acba336f842baa4f258e16b36de6cca32cf861631ed74c9d32a`)
- Authorized at 2026-10-27T04:11:29.517Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `10fe5bf22732de54c7a61b17d82151cb3391cad9f99144db13b9ec40da6c0253`
- Record `ae94c39ceddc1e33da2115c8268de55da84bc46955cc88f0a7b56fe407e07edd`, run `FR-56de6c3d07798340ccc11295`, 2026-10-27T04:11:29.522Z to 2026-10-27T04:12:26.420Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 14381.25 fly-seconds, then again for the determinism guard
- Code: commit `352fafda07d29c0d7f4f412073dc129fc5ac7a63`
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
