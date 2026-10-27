# FLY-640028f81d6fbb932b86bbb5: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-02: self versus external causation: the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's), against the full ECHO self-model under the same hidden conditions.

**Caveat.** A sense that reads a motion that is not there cannot be told from a push by any sense this fly has; it is measured apart and left out of the accuracy.

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) change fraction of hidden changes (onsets, and the ends of changes to the body or the surroundings) the fly explained with the right cause; a temporary obstacle is answered right by any explanation but its own body; a misleading sense is left out, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with a motion-gated baseline (a change met while moving is its own, one met standing is the world's) will decrease attribution_accuracy by at least 0.34 fraction on average over 10 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] A motion-gated rule (a change met while moving is its own, one met standing is the world's) explains fewer hidden held-out changes correctly than the full self-model. — competing: [scripted] Whether the fly was moving when a change began is all the evidence there is, so the rule does as well as the self-model.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2299062013, 27058504, 1900161578, 2518484023, 1883868555, 934973357, 173680477, 4177528508, 2562051934, 3361614393.

## Primary metric: attribution_accuracy (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2299062013 | 1.000 | 0.167 | -0.833 | expected | `ffdebf4dd1ef` |
| 27058504 | 0.857 | 0.143 | -0.714 | expected | `69af3bd2ca2a` |
| 1900161578 | 0.750 | 0.750 | 0.000 | tie | `745942b2d7ee` |
| 2518484023 | 1.000 | 0.667 | -0.333 | expected | `a10d587e27fa` |
| 1883868555 | 0.833 | 0.167 | -0.667 | expected | `e004002d92e2` |
| 934973357 | 1.000 | 0.600 | -0.400 | expected | `9aea9b4aa30c` |
| 173680477 | 1.000 | 0.667 | -0.333 | expected | `3620171abc35` |
| 4177528508 | 1.000 | 1.000 | 0.000 | tie | `924614012a25` |
| 2562051934 | 1.000 | 0.167 | -0.833 | expected | `4cbf4f7554cd` |
| 3361614393 | 1.000 | 1.000 | 0.000 | tie | `4edcb3abfd9a` |

7 of 7 untied seeds in the expected direction (decrease), 0 opposite, 3 tied, 0 undefined. Exact one-sided sign test: p = 0.0078 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.944, mean treatment 0.533, mean paired difference **-0.411** (minimum effect 0.34 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 7.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.34: observed -0.4114 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0078 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0053-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| attribution_accuracy | 0.944 | 0.533 | fraction |
| false_self_attribution | 0.000 | 0.900 | fraction |
| attribution_brier | 0.059 | 0.557 | score |
| attribution_path_error | 0.068 | 0.127 | fraction |
| missed_changes | 0.900 | 0.900 | count |
| misleading_sense_blamed_self | 0.000 | 1.000 | fraction |
| attribution_coverage_90 | 0.899 | 0.831 | fraction |

## Provenance

- Plan `640028f81d6fbb932b86bbb52f2f9737ea48192b430cd7f31da9987c02ddffe2`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `8d86753f0ca7a7395da5a6b7f3902bd120428b515dc616340ef12e9ae0489eed`, source `86708015e47c271602b7856459ea1d6ff513ea0f1df0bb8587c3f192a417f022`
- Preregistered as V3D-EXP-0053 at 2026-10-26T23:27:58.366Z (receipt `293a2c9fdc24ff0f8822aea1b2f7554a7b02ed4103341d17e97a98f3733f6ff7`)
- Authorized at 2026-10-26T23:27:58.396Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `7d7a52670fbfffdf7d77ea66aa0160cd77065645acefc1e674576181137bb72d`
- Record `626f51f8f1b5bfe42b86a9e649234cefeabb0b1a1144c66c93c7c43edc3b2d7d`, run `FR-b7adca4b457875954578ce22`, 2026-10-26T23:27:58.397Z to 2026-10-26T23:28:08.917Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 3200 fly-seconds, then again for the determinism guard
- Code: commit `fb76ce5c5fc61f279bc5980bd1ea22863c0cdb8d`
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
