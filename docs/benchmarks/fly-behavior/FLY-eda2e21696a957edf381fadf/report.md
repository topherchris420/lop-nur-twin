# FLY-eda2e21696a957edf381fadf: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/9 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.
>
> Development record: run from uncommitted or unknown code, so it was not admitted and is not evidence.

**Protocol.** ECHO-02: self versus external causation: the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's), against the full ECHO self-model under the same hidden conditions.

**Caveat.** A sense that reads a motion that is not there cannot be told from a push by any sense this fly has; it is measured apart and left out of the accuracy.

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) change fraction of hidden changes (onsets, and the ends of changes to the body or the surroundings) the fly explained with the right cause; a temporary obstacle is answered right by any explanation but its own body; a misleading sense is left out, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) will decrease attribution_accuracy by at least 0.36 fraction on average over 12 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] A motion-gated rule (a change met while moving is its own, one met standing is the world's) explains fewer hidden held-out changes correctly than the full self-model. — competing: [scripted] Whether the fly was moving when a change began is all the evidence there is, so the rule does as well as the self-model.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 617850007, 205272566, 3630933296, 3606223602, 2143278674, 3255710369, 4294389576, 1067578388, 3365170108, 3815703598, 266118565, 2282720937.

## Primary metric: attribution_accuracy (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 617850007 | 1.000 | 0.571 | -0.429 | expected | `b47006e8a203` |
| 205272566 | 1.000 | 1.000 | 0.000 | tie | `64cc5c76c2d6` |
| 3630933296 | 1.000 | 0.667 | -0.333 | expected | `21827230906f` |
| 3606223602 | 1.000 | 0.333 | -0.667 | expected | `a3a1410fe8aa` |
| 2143278674 | 1.000 | 0.333 | -0.667 | expected | `abde84bc5910` |
| 3255710369 | 1.000 | 0.429 | -0.571 | expected | `5b0968be00d3` |
| 4294389576 | 0.571 | 0.000 | -0.571 | expected | `7540c3cbe6c3` |
| 1067578388 | 1.000 | 0.667 | -0.333 | expected | `d97e59009798` |
| 3365170108 | 0.714 | 0.286 | -0.429 | expected | `822ac0c9cdab` |
| 3815703598 | 1.000 | 0.167 | -0.833 | expected | `de865194dd09` |
| 266118565 | 1.000 | 0.714 | -0.286 | expected | `2e7a3c64de44` |
| 2282720937 | 1.000 | 0.833 | -0.167 | expected | `fc6978c90f91` |

11 of 11 untied seeds in the expected direction (decrease), 0 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 4.88e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.940, mean treatment 0.500, mean paired difference **-0.440** (minimum effect 0.36 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 11.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.36: observed -0.4405 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0005 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Not admitted by the registry: no registry run.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| attribution_accuracy | 0.940 | 0.500 | fraction |
| false_self_attribution | 0.111 | 0.741 | fraction |
| attribution_brier | 0.056 | 0.548 | score |
| attribution_path_error | 0.095 | 0.136 | fraction |
| missed_changes | 0.417 | 0.500 | count |
| misleading_sense_blamed_self | 0.000 | 0.500 | fraction |
| attribution_coverage_90 | 0.894 | 0.847 | fraction |

## Provenance

- Plan `eda2e21696a957edf381fadfb6e3ba088b817ea1a4e83e519ac5d17e5b1f937a`; fly `digital-fly/9 reduced-order-fsm/v1`, identity `5d8d3589513b67c3b784c7fcc76029b36d3478bb885568e6c79666e2bac6ec7b`, source `3a440f60616f2e78515dcf03a3cc689b54316140fb08d659c5310f63a4a83500`
- Preregistered as V3D-EXP-0008 at 2026-11-04T20:35:09.617Z (receipt `12f6f60c6ce0be019057aa5e329a93e04d18a8448abed0705d1e2d5cc09c0041`)
- Authorized at 2026-11-04T20:35:09.870Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `19da682058e000a5a47d899726ca45e1348b2aa7fd849d6f1b2c26df0fd8d903`
- Record `af0624ace88d8cea77d9bd3e7fb56fe47dc830b37f354a88607186bd6a9feeb2`, run `FR-968534c27ac4269c002b31e4`, 2026-11-04T20:35:09.877Z to 2026-11-04T20:35:57.824Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 3840 fly-seconds, then again for the determinism guard
- Code: commit unknown, tree state unknown
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
