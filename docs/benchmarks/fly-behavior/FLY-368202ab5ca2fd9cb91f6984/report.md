# FLY-368202ab5ca2fd9cb91f6984: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Adaptation to repeated looms: repeating a looming stimulus every 10 s on a fixed schedule, against the same stimuli every 90 s on the same schedule.

**Caveat.** This controller's responsiveness falls only after an escape, so the protocol measures habituation that follows responses; a presentation that falls due while the fly is still in the air is skipped and counted (airborne_presentations), never delayed.

**Question (host-written).** In the digital fly simulator, how does repeating a looming stimulus every 10 s on a fixed schedule change fraction of the presentations shown to the standing fly that it answered by an escape, against the same stimuli every 90 s on the same schedule on matched seeds?

**Hypothesis (host-written).** Repeating a looming stimulus every 10 s on a fixed schedule will decrease repeat_escape_probability by at least 0.13 fraction on average over 13 matched seeds drawn after preregistration, compared with the same stimuli every 90 s on the same schedule, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Repeating the stimuli every 10 s lowers the fraction answered by an escape, compared with the same stimuli every 90 s. — competing: [scripted] Responsiveness recovers within 10 s, so the interval leaves the escape probability unchanged.

## Seeds

13 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 788743878, 3474240980, 2273420502, 889029284, 3752150855, 3728851796, 3909385342, 1848982542, 1375775702, 2005673456, 1561150184, 1131839267, 2551301684.

## Primary metric: repeat_escape_probability (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 788743878 | 0.583 | 0.333 | -0.250 | expected | `699971fed892` |
| 3474240980 | 0.667 | 0.500 | -0.167 | expected | `633d445f7cad` |
| 2273420502 | 0.667 | 0.333 | -0.333 | expected | `08e9f49951bd` |
| 889029284 | 0.500 | 0.333 | -0.167 | expected | `d7e440bc160a` |
| 3752150855 | 0.500 | 0.500 | 0.000 | tie | `b2a65aa6f5f1` |
| 3728851796 | 0.333 | 0.250 | -0.083 | expected | `fa5d8a8604bd` |
| 3909385342 | 0.583 | 0.333 | -0.250 | expected | `853df2ca6917` |
| 1848982542 | 0.500 | 0.500 | 0.000 | tie | `971c9772d1cd` |
| 1375775702 | 0.417 | 0.250 | -0.167 | expected | `0f8e1de9b657` |
| 2005673456 | 0.500 | 0.333 | -0.167 | expected | `595e647ccaa1` |
| 1561150184 | 0.583 | 0.333 | -0.250 | expected | `e1e85c62c9fb` |
| 1131839267 | 0.667 | 0.417 | -0.250 | expected | `ba13d8c55ddd` |
| 2551301684 | 0.667 | 0.417 | -0.250 | expected | `6d1dd1583a65` |

11 of 11 untied seeds in the expected direction (decrease), 0 opposite, 2 tied, 0 undefined. Exact one-sided sign test: p = 4.88e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.551, mean treatment 0.372, mean paired difference **-0.179** (minimum effect 0.13 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 26: observed 26.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 11.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.13: observed -0.1795 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0005 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0005-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| repeat_escape_probability | 0.551 | 0.372 | fraction |
| late_escape_probability | 0.513 | 0.346 | fraction |
| presentations | 12.000 | 12.000 | count |
| airborne_presentations | 0.000 | 0.000 | count |
| repeat_size_at_escape_deg | 46.144 | 48.852 | deg |

## Provenance

- Plan `368202ab5ca2fd9cb91f698474227eff1540c59e3b484a9ebd223b90eeb49aef`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `8fa862d0a358e1d8f3c36ea20bcc47f293ef42c1413ff1db2c9a6ebf3f086911`, source `e838b010f63674a8e7c6364631eff58473fbb0ef96fbd5d0e69b399a4303c485`
- Preregistered as V3D-EXP-0005 at 2026-10-25T19:48:56.458Z (receipt `b8af4e5b15209d4e3a7e16f8ec9fa0de6e04163342243475a4ba72af0d0e6d34`)
- Authorized at 2026-10-25T19:48:56.472Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `e5388f11a2a189ff1f6e374cf8c497b15ce0dc8d3a4dfcbfc15f3f028fb8e5d5`
- Record `dead939fab15c09c17520c25dfb8ac912b711daae67dac8a82b780dc36cd7926`, run `FR-c0ca26fb57c45ae249374fcb`, 2026-10-25T19:48:56.473Z to 2026-10-25T19:49:10.918Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 14381.25 fly-seconds, then again for the determinism guard
- Code: commit `94539a4a3edb9ffa588d4e7f5e864c55e293d80a`
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
