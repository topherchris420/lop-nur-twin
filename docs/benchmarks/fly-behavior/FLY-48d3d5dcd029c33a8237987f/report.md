# FLY-48d3d5dcd029c33a8237987f: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-02: self versus external causation: the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's), against the full ECHO self-model under the same hidden conditions.

**Caveat.** A sense that reads a motion that is not there cannot be told from a push by any sense this fly has; it is measured apart and left out of the accuracy.

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) change fraction of hidden changes (onsets, and the ends of changes to the body or the surroundings) the fly explained with the right cause; a temporary obstacle is answered right by any explanation but its own body; a misleading sense is left out, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) will decrease attribution_accuracy by at least 0.34 fraction on average over 10 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] A motion-gated rule (a change met while moving is its own, one met standing is the world's) explains fewer hidden held-out changes correctly than the full self-model. — competing: [scripted] Whether the fly was moving when a change began is all the evidence there is, so the rule does as well as the self-model.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2690654981, 3020851871, 2195561203, 142965984, 2328665152, 142572910, 930605076, 1919255337, 2382450842, 3296125249.

## Primary metric: attribution_accuracy (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2690654981 | 0.800 | 0.000 | -0.800 | expected | `ba0e05565ff9` |
| 3020851871 | 0.857 | 0.714 | -0.143 | expected | `e56bad39fe6d` |
| 2195561203 | 1.000 | 0.500 | -0.500 | expected | `4982e6000355` |
| 142965984 | 1.000 | 0.000 | -1.000 | expected | `5c3184b258f8` |
| 2328665152 | 0.500 | 0.500 | 0.000 | tie | `417b583aab8c` |
| 142572910 | 1.000 | 0.500 | -0.500 | expected | `432a418f7b6f` |
| 930605076 | 0.600 | 0.200 | -0.400 | expected | `e2afbb58fbb0` |
| 1919255337 | 0.500 | 0.500 | 0.000 | tie | `5bc45b072d07` |
| 2382450842 | 1.000 | 0.667 | -0.333 | expected | `22087c4e2a14` |
| 3296125249 | 1.000 | 0.143 | -0.857 | expected | `b3fb64104a97` |

8 of 8 untied seeds in the expected direction (decrease), 0 opposite, 2 tied, 0 undefined. Exact one-sided sign test: p = 0.0039 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.826, mean treatment 0.372, mean paired difference **-0.453** (minimum effect 0.34 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.34: observed -0.4533 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0039 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0035-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| attribution_accuracy | 0.826 | 0.372 | fraction |
| false_self_attribution | 0.000 | 0.972 | fraction |
| attribution_brier | 0.160 | 0.627 | score |
| attribution_path_error | 0.085 | 0.111 | fraction |
| missed_changes | 0.100 | 0.200 | count |
| misleading_sense_blamed_self | 0.000 | 1.000 | fraction |
| attribution_coverage_90 | 0.895 | 0.838 | fraction |

## Provenance

- Plan `48d3d5dcd029c33a8237987fa9ab86128793c47d43f812628291e1313108a8f2`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `ff9c46c2a17247b1e4327a4763992d16722b4f6ef0c5ea58c211d1ee192cf514`, source `359ee8a2b23084a3726b5b2bab6e7ee39eb27578e0956b6dd6b66e6489bf34c8`
- Preregistered as V3D-EXP-0035 at 2026-10-26T13:09:15.652Z (receipt `a02af686f390b655119da608bf114c2661e94a7fad4a3bd907d67530c0fe7247`)
- Authorized at 2026-10-26T13:09:15.676Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `0c5069c66a81eaaa54e86aecaa4e835e4defdf7c75eb714aff1c7bf76ee4a1eb`
- Record `9e5247f243eab247ec44ebb2358b77ef9ab10a04b5ac93490da618193e2b5fbf`, run `FR-16f1f8ecb1587715d05d503a`, 2026-10-26T13:09:15.678Z to 2026-10-26T13:09:24.476Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 3200 fly-seconds, then again for the determinism guard
- Code: commit `27af8430b03ffd5284d3609788b39b359c1aa099`
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
