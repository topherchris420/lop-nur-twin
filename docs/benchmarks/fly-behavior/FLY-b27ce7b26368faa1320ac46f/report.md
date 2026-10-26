# FLY-b27ce7b26368faa1320ac46f: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Visual threat: looming dose series: a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s).

**Caveat.** Escape probability cannot carry the dose-response here: the proxy's size term alone reaches the threshold before the sphere stops, so the fly escapes from nearly every looming stimulus, and a control at an l/v of 40 ms or more sits at its ceiling. The timing (escape_ttc_s) carries it.

**Question (host-written).** In the digital fly simulator, how does a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s) on matched seeds?

**Hypothesis (host-written).** A sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) will decrease escape_ttc_s by at least 0.28 s on average over 9 matched seeds drawn after preregistration, compared with the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] At l/v = 40 ms the fly escapes with less time to collision than at l/v = 160 ms, as an angular-size threshold predicts. — competing: [scripted] The escape proxy fires at a fixed time before collision whatever the approach speed.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2583833466, 4059898208, 2095319749, 3801097272, 521533135, 608410846, 2986230767, 3669155395, 1258701475.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2583833466 | 0.385 | 0.093 | -0.292 | expected | `51e229c9412a` |
| 4059898208 | 0.385 | 0.095 | -0.290 | expected | `adbb3a466d2d` |
| 2095319749 | 0.385 | 0.092 | -0.293 | expected | `f4d5786814d8` |
| 3801097272 | 0.343 | 0.083 | -0.260 | expected | `9f50db8505b3` |
| 521533135 | 0.385 | 0.095 | -0.290 | expected | `fd94dfec5f42` |
| 608410846 | 0.385 | 0.095 | -0.290 | expected | `c93fe4e54edf` |
| 2986230767 | 0.385 | 0.095 | -0.290 | expected | `97bc3c8dd946` |
| 3669155395 | 0.385 | 0.095 | -0.290 | expected | `66c1af310362` |
| 1258701475 | 0.375 | 0.087 | -0.288 | expected | `54f83e9d4ff7` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.379, mean treatment 0.092, mean paired difference **-0.287** (minimum effect 0.28 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.28: observed -0.2871 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0030-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| escape_probability | 1.000 | 0.981 | fraction |
| escape_ttc_s | 0.379 | 0.092 | s |
| escape_latency_s | 3.621 | 0.908 | s |
| size_at_escape_deg | 50.359 | 51.829 | deg |
| short_mode_fraction | 0.000 | 0.041 | fraction |

## Provenance

- Plan `b27ce7b26368faa1320ac46f001acef53e094b54be2d217d09507d9fd20590d4`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `ff9c46c2a17247b1e4327a4763992d16722b4f6ef0c5ea58c211d1ee192cf514`, source `359ee8a2b23084a3726b5b2bab6e7ee39eb27578e0956b6dd6b66e6489bf34c8`
- Preregistered as V3D-EXP-0030 at 2026-10-26T13:07:35.356Z (receipt `aa6962fd5b9a7c5ed912c611694db8ec7e32cdb370ad2626edae57b7708c1f4e`)
- Authorized at 2026-10-26T13:07:35.377Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `b04bdc0575715574e7240e5ef2041f5e133e20cb8fb0d30bf5fdee0ade31806e`
- Record `27b9b430dbb80c002cde2c251adfe35bde92c9b99d7b9d4b3b04a0734adf930a`, run `FR-96ae53740a5a16cfc68411c3`, 2026-10-26T13:07:35.379Z to 2026-10-26T13:07:35.995Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 395.28 fly-seconds, then again for the determinism guard
- Code: commit `27af8430b03ffd5284d3609788b39b359c1aa099`
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
