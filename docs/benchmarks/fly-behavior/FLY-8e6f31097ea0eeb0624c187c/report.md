# FLY-8e6f31097ea0eeb0624c187c: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Adaptation to repeated looms: repeating a looming stimulus every 10 s on a fixed schedule, against the same stimuli every 90 s on the same schedule.

**Caveat.** This controller's responsiveness falls only after an escape, so the protocol measures habituation that follows responses; a presentation that falls due while the fly is still in the air is skipped and counted (airborne_presentations), never delayed.

**Question (host-written).** In the digital fly simulator, how does repeating a looming stimulus every 10 s on a fixed schedule change fraction of the presentations shown to the standing fly that it answered by an escape, against the same stimuli every 90 s on the same schedule on matched seeds?

**Hypothesis (host-written).** Repeating a looming stimulus every 10 s on a fixed schedule will decrease repeat_escape_probability by at least 0.13 fraction on average over 13 matched seeds drawn after preregistration, compared with the same stimuli every 90 s on the same schedule, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Repeating the stimuli every 10 s lowers the fraction answered by an escape, compared with the same stimuli every 90 s. — competing: [scripted] Responsiveness recovers within 10 s, so the interval leaves the escape probability unchanged.

## Seeds

13 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1661076333, 746318242, 3358740799, 2458748596, 3986703540, 928439260, 1727688330, 1119435446, 2932097524, 626283578, 1273687789, 7807448, 3085450522.

## Primary metric: repeat_escape_probability (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1661076333 | 0.583 | 0.250 | -0.333 | expected | `fe35523696aa` |
| 746318242 | 0.667 | 0.417 | -0.250 | expected | `beef52387388` |
| 3358740799 | 0.583 | 0.417 | -0.167 | expected | `b501a0e0ee9d` |
| 2458748596 | 0.500 | 0.417 | -0.083 | expected | `cfc5b4a6c1c1` |
| 3986703540 | 0.500 | 0.417 | -0.083 | expected | `b03d72212084` |
| 928439260 | 0.500 | 0.333 | -0.167 | expected | `b40602b16988` |
| 1727688330 | 0.667 | 0.417 | -0.250 | expected | `ddf6fb4b778f` |
| 1119435446 | 0.750 | 0.417 | -0.333 | expected | `c68346df42e4` |
| 2932097524 | 0.250 | 0.167 | -0.083 | expected | `7be74422438f` |
| 626283578 | 0.500 | 0.333 | -0.167 | expected | `50c512d855a2` |
| 1273687789 | 0.500 | 0.333 | -0.167 | expected | `6950433dd70e` |
| 7807448 | 0.250 | 0.167 | -0.083 | expected | `454d213569ca` |
| 3085450522 | 0.583 | 0.333 | -0.250 | expected | `004749bccc4e` |

13 of 13 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 1.22e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.526, mean treatment 0.340, mean paired difference **-0.186** (minimum effect 0.13 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 26: observed 26.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 13.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.13: observed -0.1859 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0001 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0005-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| repeat_escape_probability | 0.526 | 0.340 | fraction |
| late_escape_probability | 0.615 | 0.346 | fraction |
| presentations | 12.000 | 12.000 | count |
| airborne_presentations | 0.000 | 0.000 | count |
| repeat_size_at_escape_deg | 46.383 | 49.057 | deg |

## Provenance

- Plan `8e6f31097ea0eeb0624c187ce8b51b12545c45cdc5010a0a2b781034f5b817ba`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `247197565afacdeda5b29bdca1a24744fd547120e39f1a35621689f2e9c90905`, source `d77a3a3961b0700f93c794a7dd8e0f3d3a9c0fd68661cfc324711c1ebf407c6c`
- Preregistered as V3D-EXP-0005 at 2026-10-24T21:23:07.956Z (receipt `4a65525568f97e6174e36c8d809596d671ffef03ad3f8307684ded356c96528c`)
- Authorized at 2026-10-24T21:23:07.975Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `ad5bd61c5fbb5c9bd92b2f4b76198766a8dca41312205d6b7a7da8c01b65bde5`
- Record `7ff2e03bee8c5f7ba2e40ed8c1b25c8421bb830753cf5f742f572a1b0eacdf71`, run `FR-48654f9bd55f5664d717dcc2`, 2026-10-24T21:23:07.976Z to 2026-10-24T21:23:37.147Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 14381.25 fly-seconds, then again for the determinism guard
- Code: commit `74216e15e42796df5684c31d82522e7234054d76`
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
