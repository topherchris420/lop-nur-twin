# FLY-7bf2aad0f63bbde9660d940d: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-02: self versus external causation: the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's), against the full ECHO self-model under the same hidden conditions.

**Caveat.** A sense that reads a motion that is not there cannot be told from a push by any sense this fly has; it is measured apart and left out of the accuracy.

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) change fraction of hidden changes (onsets, and the ends of changes to the body or the surroundings) the fly explained with the right cause; a temporary obstacle is answered right by any explanation but its own body; a misleading sense is left out, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) will decrease attribution_accuracy by at least 0.34 fraction on average over 10 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] A motion-gated rule (a change met while moving is its own, one met standing is the world's) explains fewer hidden held-out changes correctly than the full self-model. — competing: [scripted] Whether the fly was moving when a change began is all the evidence there is, so the rule does as well as the self-model.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1917306787, 3031666952, 4158804816, 463799168, 4038511004, 3874680891, 57847846, 3846333076, 1441806485, 1455417354.

## Primary metric: attribution_accuracy (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1917306787 | 0.750 | 0.125 | -0.625 | expected | `1507d93dd81a` |
| 3031666952 | 0.857 | 0.286 | -0.571 | expected | `6e47233c11b5` |
| 4158804816 | 1.000 | 0.750 | -0.250 | expected | `2829e2ab1a27` |
| 463799168 | 0.600 | 0.200 | -0.400 | expected | `d62ae4a6919c` |
| 4038511004 | 0.600 | 0.600 | 0.000 | tie | `cfd67aa7e171` |
| 3874680891 | 1.000 | 0.500 | -0.500 | expected | `31a90d9f21a4` |
| 57847846 | 0.875 | 0.375 | -0.500 | expected | `3df1a31694b8` |
| 3846333076 | 0.667 | 0.000 | -0.667 | expected | `524249ece670` |
| 1441806485 | 0.600 | 0.200 | -0.400 | expected | `e77c60f258f9` |
| 1455417354 | 1.000 | 0.000 | -1.000 | expected | `7dc9f866c918` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.795, mean treatment 0.304, mean paired difference **-0.491** (minimum effect 0.34 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.34: observed -0.4913 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0026-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| attribution_accuracy | 0.795 | 0.304 | fraction |
| false_self_attribution | 0.028 | 0.954 | fraction |
| attribution_brier | 0.207 | 0.731 | score |
| attribution_path_error | 0.110 | 0.149 | fraction |
| missed_changes | 0.300 | 0.300 | count |
| misleading_sense_blamed_self | 0.000 | 1.000 | fraction |
| attribution_coverage_90 | 0.896 | 0.870 | fraction |

## Provenance

- Plan `7bf2aad0f63bbde9660d940de712976837d0cdc4fa006b448f4d8184f3a602b1`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `44a4d99fc81cf563bb4ff40377cff7d1ae9881d95c6cf3b17851e5804539805d`, source `b794ba087d2c9dbb0d589758d6d2e0a89d958b3f2b626d50ab3388266513a682`
- Preregistered as V3D-EXP-0026 at 2026-10-26T05:49:48.469Z (receipt `d39829959701110b8d9715a2b5ba1bb78510fa74a15573b29bd5a3f1653920d1`)
- Authorized at 2026-10-26T05:49:48.565Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `5774780ec9e7b4c8941d8d8747ed8266151065bcbb3b3e569e613867bcda8622`
- Record `0c7ef0355215ede8653f6d78a7a1bf92ea5720c1395156d43a73161b3d7d6504`, run `FR-737aedccba59f426f81723af`, 2026-10-26T05:49:48.568Z to 2026-10-26T05:50:26.561Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 3200 fly-seconds, then again for the determinism guard
- Code: commit `6ea1990ebc33011e02ad26083bebb719dc837d1b`
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
