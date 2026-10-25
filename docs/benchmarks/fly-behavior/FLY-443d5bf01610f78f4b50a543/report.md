# FLY-443d5bf01610f78f4b50a543: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Visual threat: looming dose series: a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s).

**Caveat.** Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.

**Question (host-written).** In the digital fly simulator, how does a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s) on matched seeds?

**Hypothesis (host-written).** A sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) will decrease escape_ttc_s by at least 0.28 s on average over 9 matched seeds drawn after preregistration, compared with the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] At l/v = 40 ms the fly escapes with less time to collision than at l/v = 160 ms, as an angular-size threshold predicts. — competing: [scripted] The escape proxy fires at a fixed time before collision whatever the approach speed.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3670984879, 2390625461, 2987464597, 3492900840, 1445787703, 963807457, 4086722663, 701354659, 2945120370.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3670984879 | 0.385 | 0.095 | -0.290 | expected | `1078c98c06ac` |
| 2390625461 | 0.373 | 0.087 | -0.287 | expected | `57e40daf0c36` |
| 2987464597 | 0.365 | 0.083 | -0.282 | expected | `e6dbca1409b7` |
| 3492900840 | 0.365 | 0.078 | -0.287 | expected | `8cc07760c8bb` |
| 1445787703 | 0.385 | 0.093 | -0.292 | expected | `acaa2ce99fe1` |
| 963807457 | 0.385 | 0.095 | -0.290 | expected | `610348cc8488` |
| 4086722663 | 0.350 | 0.070 | -0.280 | expected | `c7ed7e7e7dbf` |
| 701354659 | 0.370 | 0.085 | -0.285 | expected | `08ec42a3a488` |
| 2945120370 | 0.377 | 0.080 | -0.297 | expected | `0f809c75d528` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.373, mean treatment 0.085, mean paired difference **-0.288** (minimum effect 0.28 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.28: observed -0.2876 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0006-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.373 | 0.085 | s |
| escape_latency_s | 3.627 | 0.915 | s |
| size_at_escape_deg | 51.477 | 57.104 | deg |
| short_mode_fraction | 0.000 | 0.185 | fraction |

## Provenance

- Plan `443d5bf01610f78f4b50a543e1a48b941a7652620b581205421b802e07a7a3db`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0006 at 2026-10-25T17:29:26.934Z (receipt `77d121017f567dbbe6be4b77d836d14c53c7e725f5128806bf9effb8eca155a3`)
- Authorized at 2026-10-25T17:29:26.964Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `0b7e9666f1354948dbb8f84e403cf973eb07922972f70c9fdebe25fa208dc209`
- Record `3602164099d919944902c47663eadfb1d4550cc4b05ee51526e59e8775030ae4`, run `FR-6a1ec7a60fb3d0144769b10b`, 2026-10-25T17:29:26.965Z to 2026-10-25T17:29:27.988Z
- Simulated on node 24.22.1 (V8 13.6.233.17-node.58): 395.28 fly-seconds, then again for the determinism guard
- Code: commit `a71066264ba3ff3a6949316bdc0f0bcee92c5520`
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
