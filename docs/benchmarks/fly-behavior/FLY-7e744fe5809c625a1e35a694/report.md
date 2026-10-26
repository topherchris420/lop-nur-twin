# FLY-7e744fe5809c625a1e35a694: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-02: self versus external causation: the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's), against the full ECHO self-model under the same hidden conditions.

**Caveat.** A sense that reads a motion that is not there cannot be told from a push by any sense this fly has; it is measured apart and left out of the accuracy.

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) change fraction of hidden changes (onsets, and the ends of changes to the body or the surroundings) the fly explained with the right cause; a temporary obstacle is answered right by any explanation but its own body; a misleading sense is left out, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) will decrease attribution_accuracy by at least 0.34 fraction on average over 10 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] A motion-gated rule (a change met while moving is its own, one met standing is the world's) explains fewer hidden held-out changes correctly than the full self-model. — competing: [scripted] Whether the fly was moving when a change began is all the evidence there is, so the rule does as well as the self-model.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3175250271, 2336953909, 1851569324, 3614017154, 3880694584, 3379974488, 3516416849, 1828727956, 541053539, 1407013548.

## Primary metric: attribution_accuracy (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3175250271 | 0.750 | 0.250 | -0.500 | expected | `9db4fa9ab45c` |
| 2336953909 | 1.000 | 0.400 | -0.600 | expected | `5379caa44a21` |
| 1851569324 | 0.429 | 0.143 | -0.286 | expected | `ee0876b21634` |
| 3614017154 | 0.800 | 0.200 | -0.600 | expected | `196c58ca06f6` |
| 3880694584 | 1.000 | 0.400 | -0.600 | expected | `4e6a52d91228` |
| 3379974488 | 1.000 | 0.500 | -0.500 | expected | `d3b21db7f324` |
| 3516416849 | 0.429 | 0.286 | -0.143 | expected | `7b2c658a6a7a` |
| 1828727956 | 0.833 | 0.500 | -0.333 | expected | `0ac95741666a` |
| 541053539 | 0.600 | 0.200 | -0.400 | expected | `390553df5520` |
| 1407013548 | 1.000 | 0.750 | -0.250 | expected | `e825d10b5675` |

10 of 10 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 9.77e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.784, mean treatment 0.363, mean paired difference **-0.421** (minimum effect 0.34 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 10.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.34: observed -0.4212 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0010 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0044-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| attribution_accuracy | 0.784 | 0.363 | fraction |
| false_self_attribution | 0.037 | 0.713 | fraction |
| attribution_brier | 0.199 | 0.686 | score |
| attribution_path_error | 0.135 | 0.172 | fraction |
| missed_changes | 0.400 | 0.300 | count |
| misleading_sense_blamed_self | 0.000 | 1.000 | fraction |
| attribution_coverage_90 | 0.899 | 0.846 | fraction |

## Provenance

- Plan `7e744fe5809c625a1e35a6948f4b7e305b74e7c410fbdbcc4aaf846c1c21b354`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `e2eb5e95c355777d19a210820fb203fc9ef47608031b98fa85882280e85cfdca`, source `daad49019246c38c2673cd442ecaae50eba95994635676bdc333b5563cebfb78`
- Preregistered as V3D-EXP-0044 at 2026-10-26T20:16:47.247Z (receipt `9a58db7859abf06a71f236cafaa4de4308bf30c460d165252ce2502ee5f06f14`)
- Authorized at 2026-10-26T20:16:47.275Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `24c41ae6bcf93be8e29432c0cf10abacd0222eca2f50769becfdcae190cafbcc`
- Record `97458aec84cfd7997f93ba04ba33186873ab852e1e0c88bd08662270ffa98556`, run `FR-574787d3cd07f601cda14b24`, 2026-10-26T20:16:47.277Z to 2026-10-26T20:16:56.345Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 3200 fly-seconds, then again for the determinism guard
- Code: commit `379fb9debfbd203f99d6c76ac80097706945dd2d`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- A sense that reads a motion that is not there cannot be told from a push by any sense this fly has; it is measured apart and left out of the accuracy.
- The ECHO self-model is a computational model of the fly's own sensorimotor gains, built over the reduced-order body. Its compensation acts on abstract movement gains of that body; it is not validated biological motor control, and FlyBody's physics does not run.
- The perturbations are the experimenter's models of an impairment, a push, a turning surface, a sensor fault and an obstacle, applied by the simulator. The fly is never given their labels, causes or schedule; it meets only their consequences through its self-motion sense, its touch and its legs' stepping.
- The conditions are the held-out evaluation set, in an arena the self-model was not developed in; its constants were chosen on the development set alone and frozen before evaluation.
- A measurement of prediction, attribution or retention describes a functional self-model in a simulator. It is not evidence of awareness or subjective experience.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
