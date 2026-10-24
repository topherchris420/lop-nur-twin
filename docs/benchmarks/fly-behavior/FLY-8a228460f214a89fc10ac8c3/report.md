# FLY-8a228460f214a89fc10ac8c3: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/4 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Visual threat: looming dose series: a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s).

**Caveat.** Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.

**Question (host-written).** In the digital fly simulator, how does a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s) on matched seeds?

**Hypothesis (host-written).** A sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) will decrease escape_ttc_s by at least 0.28 s on average over 9 matched seeds drawn after preregistration, compared with the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] At l/v = 40 ms the fly escapes with less time to collision than at l/v = 160 ms, as an angular-size threshold predicts. — competing: [scripted] The escape proxy fires at a fixed time before collision whatever the approach speed.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1753795043, 3840385187, 1451249884, 2278456483, 1452266107, 2446802762, 4068941768, 3193308060, 2684453104.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1753795043 | 0.338 | 0.072 | -0.267 | expected | `0252b0363c14` |
| 3840385187 | 0.385 | 0.095 | -0.290 | expected | `b76f7203fcf5` |
| 1451249884 | 0.385 | 0.095 | -0.290 | expected | `3c3bfb65f853` |
| 2278456483 | 0.362 | 0.083 | -0.278 | expected | `4b120989f769` |
| 1452266107 | 0.382 | 0.085 | -0.297 | expected | `425706990811` |
| 2446802762 | 0.385 | 0.095 | -0.290 | expected | `cf8d3e59db39` |
| 4068941768 | 0.385 | 0.092 | -0.293 | expected | `f153be273a58` |
| 3193308060 | 0.368 | 0.085 | -0.283 | expected | `b973165b83d7` |
| 2684453104 | 0.385 | 0.095 | -0.290 | expected | `32811195afb6` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.375, mean treatment 0.089, mean paired difference **-0.286** (minimum effect 0.28 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.28: observed -0.2865 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0015-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.375 | 0.089 | s |
| escape_latency_s | 3.625 | 0.911 | s |
| size_at_escape_deg | 51.331 | 54.067 | deg |
| short_mode_fraction | 0.000 | 0.093 | fraction |

## Provenance

- Plan `8a228460f214a89fc10ac8c324ec99b912c42e1d1608a81cd25f41df6b60a9c1`; fly `digital-fly/4 reduced-order-fsm/v1`, identity `02776ebf688fc2989a8fe4f6871b30825e567d27ea64b5aecfd3ecf2760b448c`, source `69a28d5897711f339ac6fe76bbd486a76310346b93b62093ce8874c12331380e`
- Preregistered as V3D-EXP-0015 at 2026-10-24T02:51:13.391Z (receipt `c280417d61539ce1de556d8556a6f6a574b54b6fac801967d5dacc69b022b708`)
- Authorized at 2026-10-24T02:51:13.428Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `f87069673bf30f9afc2b5e9e9f3320296d7b2b7819023b5a6cccafe891eb57ff`
- Record `ccb460cbada8fecdc582d7458841d45d08e432eead85c628775d0bb75d3a657e`, run `FR-c1bbd99a8794f47e14d6e5f8`, 2026-10-24T02:51:13.432Z to 2026-10-24T02:51:15.003Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 395.28 fly-seconds, then again for the determinism guard
- Code: commit `c0f72973e32a0e9924a909da2a70b480994879e6`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.
- Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
