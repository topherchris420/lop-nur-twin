# FLY-ea1f81b92313cd532b36b4a8: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-02: self versus external causation: the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's), against the full ECHO self-model under the same hidden conditions.

**Caveat.** A sense that reads a motion that is not there cannot be told from a push by any sense this fly has; it is measured apart and left out of the accuracy.

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) change fraction of hidden changes (onsets, and the ends of changes to the body or the surroundings) the fly explained with the right cause; a temporary obstacle is answered right by any explanation but its own body; a misleading sense is left out, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) will decrease attribution_accuracy by at least 0.36 fraction on average over 12 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] A motion-gated rule (a change met while moving is its own, one met standing is the world's) explains fewer hidden held-out changes correctly than the full self-model. — competing: [scripted] Whether the fly was moving when a change began is all the evidence there is, so the rule does as well as the self-model.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2952864777, 4138813474, 2679135959, 854574473, 998208358, 72518724, 2863045522, 1136348618, 4207491022, 1672810677, 3372732306, 3138342515.

## Primary metric: attribution_accuracy (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2952864777 | 0.833 | 0.500 | -0.333 | expected | `078bc15f3545` |
| 4138813474 | 1.000 | 1.000 | 0.000 | tie | `6a3bf7410751` |
| 2679135959 | 1.000 | 0.333 | -0.667 | expected | `728c9dcac281` |
| 854574473 | 1.000 | 0.800 | -0.200 | expected | `d9310776cc39` |
| 998208358 | 0.667 | 0.333 | -0.333 | expected | `6e4b7df2cda0` |
| 72518724 | 1.000 | 0.400 | -0.600 | expected | `9b97ce4cf713` |
| 2863045522 | 1.000 | 1.000 | 0.000 | tie | `525128a4590b` |
| 1136348618 | 1.000 | 0.800 | -0.200 | expected | `be8b5c4267f4` |
| 4207491022 | 1.000 | 0.400 | -0.600 | expected | `655dfd5de4bd` |
| 1672810677 | 0.857 | 0.714 | -0.143 | expected | `b76f7a555792` |
| 3372732306 | 0.667 | 0.167 | -0.500 | expected | `63e6fe980b04` |
| 3138342515 | 1.000 | 0.000 | -1.000 | expected | `808c1ee7ba8d` |

10 of 10 untied seeds in the expected direction (decrease), 0 opposite, 2 tied, 0 undefined. Exact one-sided sign test: p = 9.77e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.919, mean treatment 0.537, mean paired difference **-0.381** (minimum effect 0.36 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 10.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.36: observed -0.3813 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0010 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0062-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| attribution_accuracy | 0.919 | 0.537 | fraction |
| false_self_attribution | 0.000 | 0.857 | fraction |
| attribution_brier | 0.066 | 0.464 | score |
| attribution_path_error | 0.109 | 0.149 | fraction |
| missed_changes | 0.333 | 0.250 | count |
| misleading_sense_blamed_self | 0.000 | 1.000 | fraction |
| attribution_coverage_90 | 0.890 | 0.862 | fraction |

## Provenance

- Plan `ea1f81b92313cd532b36b4a8ec6ce76ecc3f934ff7f8e214c64aea2dc90050c7`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `c684a7f0002390bee7e62d529bc459479c35e45465749ad174bd99aca71a5f8a`, source `a96a496c4c00acead32e208158faf7889c31027b8dccde781059a4eb4481f70b`
- Preregistered as V3D-EXP-0062 at 2026-10-27T04:16:40.602Z (receipt `bbe9001096b35d7aff6f8ba2550d23bfb839ef0de3b6340ebe207fb81cfa8ec2`)
- Authorized at 2026-10-27T04:16:40.731Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `37b9805c4dc7ca6bf986a48d7a6b5b2ab9824e7fc2dc7dfc33ee2d05bd22476a`
- Record `ecbd56f196d8cc8091101113bb570db7eac9028d25136ddfe33b67d10024311f`, run `FR-ccbc8f7e9b5b521a3bf3a248`, 2026-10-27T04:16:40.735Z to 2026-10-27T04:17:34.994Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 3840 fly-seconds, then again for the determinism guard
- Code: commit `352fafda07d29c0d7f4f412073dc129fc5ac7a63`
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
