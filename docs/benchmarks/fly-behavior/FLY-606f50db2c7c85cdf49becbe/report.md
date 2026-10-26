# FLY-606f50db2c7c85cdf49becbe: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-02: self versus external causation: the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's), against the full ECHO self-model under the same hidden conditions.

**Caveat.** A sense that reads a motion that is not there cannot be told from a push by any sense this fly has; it is measured apart and left out of the accuracy.

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) change fraction of hidden changes (onsets, and the ends of changes to the body or the surroundings) the fly explained with the right cause; a temporary obstacle is answered right by any explanation but its own body; a misleading sense is left out, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) will decrease attribution_accuracy by at least 0.34 fraction on average over 10 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] A motion-gated rule (a change met while moving is its own, one met standing is the world's) explains fewer hidden held-out changes correctly than the full self-model. — competing: [scripted] Whether the fly was moving when a change began is all the evidence there is, so the rule does as well as the self-model.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2192118163, 2410488333, 907843113, 1197022093, 3640936060, 3639282049, 3610121335, 2096434705, 1836948369, 1895029287.

## Primary metric: attribution_accuracy (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2192118163 | 0.833 | 0.333 | -0.500 | expected | `eec8868f3b24` |
| 2410488333 | 0.714 | 0.143 | -0.571 | expected | `6875d95b3d0d` |
| 907843113 | 0.571 | 0.571 | 0.000 | tie | `98e8b172d1b9` |
| 1197022093 | 1.000 | 0.250 | -0.750 | expected | `f6c2722a0186` |
| 3640936060 | 1.000 | 0.333 | -0.667 | expected | `5f6d41a34f8c` |
| 3639282049 | 1.000 | 0.600 | -0.400 | expected | `9286a764eaf0` |
| 3610121335 | 0.833 | 0.000 | -0.833 | expected | `f3f68b3fccb0` |
| 2096434705 | 1.000 | 0.000 | -1.000 | expected | `a32007dcfb8b` |
| 1836948369 | 1.000 | 0.429 | -0.571 | expected | `d243ceaec4bf` |
| 1895029287 | 0.500 | 0.333 | -0.167 | expected | `5b86e2dd9853` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.845, mean treatment 0.299, mean paired difference **-0.546** (minimum effect 0.34 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.34: observed -0.5460 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0008-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| attribution_accuracy | 0.845 | 0.299 | fraction |
| false_self_attribution | 0.000 | 0.869 | fraction |
| attribution_brier | 0.139 | 0.711 | score |
| attribution_path_error | 0.139 | 0.203 | fraction |
| missed_changes | 0.100 | 0.100 | count |
| misleading_sense_blamed_self | 0.000 | 1.000 | fraction |
| attribution_coverage_90 | 0.894 | 0.813 | fraction |

## Provenance

- Plan `606f50db2c7c85cdf49becbe39aa58d38f626a2ec3926e94b373751a260d8fd3`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `309bc659d993b7c1affb6353a5aac0e434e9fc502d8d9477013d3af7296aaf38`, source `b9abf944d6d246ff622184e4b0d29ccdf4e3966665643958ab4585d67f4b0aff`
- Preregistered as V3D-EXP-0008 at 2026-10-26T00:35:38.253Z (receipt `cf454163d745b4e2fe1984984a41b78136da7d5e9212a5339deb297f83d4ffb6`)
- Authorized at 2026-10-26T00:35:38.284Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `c87f76239d27886cad06d3ddb84cb06dd8c528564e62186b5c77a2d50e1bb9cf`
- Record `1fd45be0a851ba808fa54765148957234417e1fedab76911331167d199f2d29e`, run `FR-8af0210f32208bae25284e73`, 2026-10-26T00:35:38.285Z to 2026-10-26T00:35:56.523Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 3200 fly-seconds, then again for the determinism guard
- Code: commit `06ff901fae549bb121d80c9b61e0f5c6b61faf77`
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
