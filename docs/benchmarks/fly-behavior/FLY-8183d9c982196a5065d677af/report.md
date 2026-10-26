# FLY-8183d9c982196a5065d677af: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-01: recognizing a bodily impairment: the ECHO controller with no self-model (the reduced-order controller alone), against the full ECHO self-model under the same hidden conditions.

**Caveat.** Compensation is of abstract movement gains in the reduced-order simulator, not validated motor control; a strong impairment cannot be fully compensated within the body's 4 cm/s. Identification (the identification error) is measured apart from compensation (the path errors).

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with no self-model (the reduced-order controller alone) change mean path error of steady walking from the hidden impairment's onset to the end of the run, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with no self-model (the reduced-order controller alone) will increase impaired_path_error by at least 0.19 fraction on average over 9 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Without its self-model, the fly's walking strays further from its intended path after a hidden impairment, from held-out conditions, than with it. — competing: [scripted] The reduced-order controller's own feedback (turning back from edges, its tether) keeps its path as close to its intentions as a self-model would.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3393620589, 791859871, 3816276701, 1522660329, 2434902501, 1404895389, 338548759, 1642108566, 3608601040.

## Primary metric: impaired_path_error (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3393620589 | 0.011 | 0.031 | 0.020 | expected | `73ee70ea0619` |
| 791859871 | 0.008 | 0.061 | 0.053 | expected | `cb0e180e72bc` |
| 3816276701 | 0.019 | 0.614 | 0.595 | expected | `ae751a541cce` |
| 1522660329 | 0.010 | 0.285 | 0.275 | expected | `d85f92f76342` |
| 2434902501 | 0.008 | 0.072 | 0.063 | expected | `a7ae9334e02f` |
| 1404895389 | 0.053 | 0.309 | 0.256 | expected | `b2236dcc4367` |
| 338548759 | 0.088 | 0.380 | 0.292 | expected | `377a353ef520` |
| 1642108566 | 0.005 | 0.295 | 0.290 | expected | `5d6c707ad724` |
| 3608601040 | 0.052 | 0.562 | 0.510 | expected | `619e488a7100` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.028, mean treatment 0.290, mean paired difference **0.262** (minimum effect 0.19 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.19: observed 0.2616 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0043-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| impaired_path_error | 0.028 | 0.290 | fraction |
| late_path_error | 0.019 | 0.293 | fraction |
| baseline_path_error | 0.015 | 0.001 | fraction |
| detection_latency_s | 1.756 | — | s |
| attribution_latency_s | 3.778 | — | s |
| identification_error | 0.014 | — | fraction |
| false_alarms_per_min | 0.000 | — | 1/min |
| impaired_walked_m | 1.224 | 1.133 | m |
| coverage_90 | 0.907 | — | fraction |

## Provenance

- Plan `8183d9c982196a5065d677af696983b2f203669f6edf851ac50b42c57c696d24`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `e2eb5e95c355777d19a210820fb203fc9ef47608031b98fa85882280e85cfdca`, source `daad49019246c38c2673cd442ecaae50eba95994635676bdc333b5563cebfb78`
- Preregistered as V3D-EXP-0043 at 2026-10-26T20:16:34.267Z (receipt `26dabacbe2d06c5cf7438bc1243c40eb229775528b9fee9db45060f4042af84c`)
- Authorized at 2026-10-26T20:16:34.296Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `7b5aa2acabb04f885b055e88d8892f249db01486c4a34582414e9dedeb64d825`
- Record `75cd1fd65b054ee02f76a1fb2d254984288efd1b3573112d8491cba016ae0435`, run `FR-1058edc56234c7b60dc69460`, 2026-10-26T20:16:34.297Z to 2026-10-26T20:16:38.695Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2160 fly-seconds, then again for the determinism guard
- Code: commit `379fb9debfbd203f99d6c76ac80097706945dd2d`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Compensation is of abstract movement gains in the reduced-order simulator, not validated motor control; a strong impairment cannot be fully compensated within the body's 4 cm/s. Identification (the identification error) is measured apart from compensation (the path errors).
- The ECHO self-model is a computational model of the fly's own sensorimotor gains, built over the reduced-order body. Its compensation acts on abstract movement gains of that body; it is not validated biological motor control, and FlyBody's physics does not run.
- The perturbations are the experimenter's models of an impairment, a push, a turning surface, a sensor fault and an obstacle, applied by the simulator. The fly is never given their labels, causes or schedule; it meets only their consequences through its self-motion sense, its touch and its legs' stepping.
- The conditions are the held-out evaluation set, in an arena the self-model was not developed in; its constants were chosen on the development set alone and frozen before evaluation.
- A measurement of prediction, attribution or retention describes a functional self-model in a simulator. It is not evidence of awareness or subjective experience.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
