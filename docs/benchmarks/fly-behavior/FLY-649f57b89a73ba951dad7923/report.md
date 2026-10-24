# FLY-649f57b89a73ba951dad7923: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Visual threat: looming dose series: a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s).

**Caveat.** Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.

**Question (host-written).** In the digital fly simulator, how does a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s) on matched seeds?

**Hypothesis (host-written).** A sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) will decrease escape_ttc_s by at least 0.28 s on average over 9 matched seeds drawn after preregistration, compared with the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] At l/v = 40 ms the fly escapes with less time to collision than at l/v = 160 ms, as an angular-size threshold predicts. — competing: [scripted] The escape proxy fires at a fixed time before collision whatever the approach speed.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 869173833, 76907559, 3661908676, 2674174399, 1419660399, 18844894, 2926544044, 3047220515, 1734658202.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 869173833 | 0.385 | 0.090 | -0.295 | expected | `53e750277fa5` |
| 76907559 | 0.385 | 0.095 | -0.290 | expected | `7dd88516d338` |
| 3661908676 | 0.365 | 0.083 | -0.282 | expected | `101b0e3c6a7a` |
| 2674174399 | 0.385 | 0.095 | -0.290 | expected | `bcc38b1e10ee` |
| 1419660399 | 0.385 | 0.095 | -0.290 | expected | `d7affce641fd` |
| 18844894 | 0.385 | 0.092 | -0.293 | expected | `994241ae5214` |
| 2926544044 | 0.385 | 0.095 | -0.290 | expected | `44b7d5996032` |
| 3047220515 | 0.385 | 0.095 | -0.290 | expected | `5d8869a2c5f1` |
| 1734658202 | 0.380 | 0.088 | -0.292 | expected | `e8f2941fbb7c` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.382, mean treatment 0.092, mean paired difference **-0.290** (minimum effect 0.28 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.28: observed -0.2902 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0003-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.382 | 0.092 | s |
| escape_latency_s | 3.618 | 0.908 | s |
| size_at_escape_deg | 49.661 | 52.047 | deg |
| short_mode_fraction | 0.000 | 0.056 | fraction |

## Provenance

- Plan `649f57b89a73ba951dad792329f9d270236be9864e2cd2d2452070a5447a03da`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `247197565afacdeda5b29bdca1a24744fd547120e39f1a35621689f2e9c90905`, source `d77a3a3961b0700f93c794a7dd8e0f3d3a9c0fd68661cfc324711c1ebf407c6c`
- Preregistered as V3D-EXP-0003 at 2026-10-24T21:22:32.310Z (receipt `ae60bd5e21cfbf2834ba39d5322168a4d83d3f45d6a46dcdf739b4d993199c3e`)
- Authorized at 2026-10-24T21:22:32.328Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `12a548b4fbd611284f5a89adc403e849012907f7b95ff062fea08c8e198d6b29`
- Record `95c79f6237f52964f9ee78e1bf8b482db57a81c993c9d00f8d568160eb21b3e8`, run `FR-999affb554997cf686884c1b`, 2026-10-24T21:22:32.329Z to 2026-10-24T21:22:33.333Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 395.28 fly-seconds, then again for the determinism guard
- Code: commit `74216e15e42796df5684c31d82522e7234054d76`
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
