# FLY-4f0d5f100e1051bcfe2c8424: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-02: self versus external causation: the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's), against the full ECHO self-model under the same hidden conditions.

**Caveat.** A sense that reads a motion that is not there cannot be told from a push by any sense this fly has; it is measured apart and left out of the accuracy.

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) change fraction of hidden changes (onsets, and the ends of changes to the body or the surroundings) the fly explained with the right cause; a temporary obstacle is answered right by any explanation but its own body; a misleading sense is left out, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) will decrease attribution_accuracy by at least 0.34 fraction on average over 10 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] A motion-gated rule (a change met while moving is its own, one met standing is the world's) explains fewer hidden held-out changes correctly than the full self-model. — competing: [scripted] Whether the fly was moving when a change began is all the evidence there is, so the rule does as well as the self-model.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3625041436, 3830503456, 598306648, 1804462102, 1165377750, 2664304932, 836105326, 964093693, 822612151, 1565398831.

## Primary metric: attribution_accuracy (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3625041436 | 1.000 | 1.000 | 0.000 | tie | `9824de8d8998` |
| 3830503456 | 0.400 | 0.200 | -0.200 | expected | `a0a9dca0ae65` |
| 598306648 | 0.833 | 0.833 | 0.000 | tie | `c304e3e1f303` |
| 1804462102 | 1.000 | 0.500 | -0.500 | expected | `21071b293686` |
| 1165377750 | 1.000 | 1.000 | 0.000 | tie | `a94b6eb04539` |
| 2664304932 | 0.875 | 0.500 | -0.375 | expected | `477a66d56066` |
| 836105326 | 1.000 | 0.000 | -1.000 | expected | `f2cdc9590c38` |
| 964093693 | 0.800 | 0.800 | 0.000 | tie | `6c4fee30fc08` |
| 822612151 | 1.000 | 0.000 | -1.000 | expected | `c1f394f06c20` |
| 1565398831 | 1.000 | 0.833 | -0.167 | expected | `c104de2ddd33` |

6 of 6 untied seeds in the expected direction (decrease), 0 opposite, 4 tied, 0 undefined. Exact one-sided sign test: p = 0.0156 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.891, mean treatment 0.567, mean paired difference **-0.324** (minimum effect 0.34 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 6.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.34: observed -0.3242 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0156 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

Success criteria not all met (S1) and no failure criterion triggered.

Registry run `V3D-EXP-0008-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| attribution_accuracy | 0.891 | 0.567 | fraction |
| false_self_attribution | 0.000 | 1.000 | fraction |
| attribution_brier | 0.094 | 0.483 | score |
| attribution_path_error | 0.066 | 0.092 | fraction |
| missed_changes | 0.600 | 0.500 | count |
| misleading_sense_blamed_self | 0.000 | 1.000 | fraction |
| attribution_coverage_90 | 0.899 | 0.847 | fraction |

## Provenance

- Plan `4f0d5f100e1051bcfe2c8424a5cc41c680c93a71c58d214a107f1edc69b26e7b`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `8fa862d0a358e1d8f3c36ea20bcc47f293ef42c1413ff1db2c9a6ebf3f086911`, source `e838b010f63674a8e7c6364631eff58473fbb0ef96fbd5d0e69b399a4303c485`
- Preregistered as V3D-EXP-0008 at 2026-10-25T19:50:43.973Z (receipt `2c587f984eddf86016e0ed14f489b9fc6bf975048d124bd581dbf215a2420ef4`)
- Authorized at 2026-10-25T19:50:43.987Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `e600ceb5aa698028240fbe190b62564b11478a53d13ded6f549529ddf595ffea`
- Record `adbd286e52553aef672c64c9b2af17bf5f6938f005bf223a7f79c230cff8fd93`, run `FR-bfadb467aa394c4d84e79ffc`, 2026-10-25T19:50:43.988Z to 2026-10-25T19:50:53.706Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 3200 fly-seconds, then again for the determinism guard
- Code: commit `10ac28871a37a973b6f6907be886fb9ea2a328ca`
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
