# FLY-1b960a0c37619b1c2807e19f: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/9 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.
>
> Not admitted by the registry: Fly admission refused: commit e458f7cb3490 does not hold the fly's code here: fly source src/bethesda/fly/senses.ts does not exist

**Protocol.** ECHO-01: recognizing a bodily impairment: the ECHO controller with no self-model (the reduced-order controller alone), against the full ECHO self-model under the same hidden conditions.

**Caveat.** Compensation is of abstract movement gains in the reduced-order simulator, not validated motor control; a strong impairment cannot be fully compensated within the body's 4 cm/s. Identification (the identification error) is measured apart from compensation (the path errors).

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with no self-model (the reduced-order controller alone) change mean path error of steady walking from the hidden impairment's onset to the end of the run, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with no self-model (the reduced-order controller alone) will increase impaired_path_error by at least 0.19 fraction on average over 9 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Without its self-model, the fly's walking strays further from its intended path after a hidden impairment, from held-out conditions, than with it. — competing: [scripted] The reduced-order controller's own feedback (turning back from edges, its tether) keeps its path as close to its intentions as a self-model would.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1639256781, 2993303505, 1172057280, 3083891712, 1586130615, 3744538762, 829849416, 3846242583, 3513805656.

## Primary metric: impaired_path_error (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1639256781 | 0.284 | 0.608 | 0.324 | expected | `c5fdab1cfc06` |
| 2993303505 | 0.267 | 0.578 | 0.310 | expected | `ddb3fee6303b` |
| 1172057280 | 0.026 | 0.441 | 0.415 | expected | `7011c55346f7` |
| 3083891712 | 0.016 | 0.254 | 0.238 | expected | `29101fe34f9d` |
| 1586130615 | 0.014 | 0.581 | 0.568 | expected | `05addf883835` |
| 3744538762 | 0.050 | 0.469 | 0.418 | expected | `822e681a799b` |
| 829849416 | 0.010 | 0.648 | 0.638 | expected | `2eed94ade660` |
| 3846242583 | 0.007 | 0.075 | 0.068 | expected | `c5ea260a1d62` |
| 3513805656 | 0.102 | 0.609 | 0.507 | expected | `edf86a057ab1` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.086, mean treatment 0.474, mean paired difference **0.387** (minimum effect 0.19 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.19: observed 0.3873 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Not admitted by the registry: no registry run.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| impaired_path_error | 0.086 | 0.474 | fraction |
| late_path_error | 0.096 | 0.473 | fraction |
| baseline_path_error | 0.014 | 0.001 | fraction |
| detection_latency_s | 0.517 | — | s |
| attribution_latency_s | 3.678 | — | s |
| identification_error | 0.015 | — | fraction |
| false_alarms_per_min | 0.000 | — | 1/min |
| impaired_walked_m | 1.266 | 1.035 | m |
| coverage_90 | 0.906 | — | fraction |

## Provenance

- Plan `1b960a0c37619b1c2807e19f8c7b12b3f176421079be1c4bfd3db18ccdee987b`; fly `digital-fly/9 reduced-order-fsm/v1`, identity `5d8d3589513b67c3b784c7fcc76029b36d3478bb885568e6c79666e2bac6ec7b`, source `3a440f60616f2e78515dcf03a3cc689b54316140fb08d659c5310f63a4a83500`
- Preregistered as V3D-EXP-0007 at 2026-11-04T14:55:31.430Z (receipt `5acc2fb481becf97213d5a3dac12d416bafda895b26564ca80c3b859710e697e`)
- Authorized at 2026-11-04T14:55:31.555Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `26172d9fe9d38d5a47bf082c931a9be90cb95efbaac5d639f8d56144927f2247`
- Record `c17f976e8aa52dc144d5ba0d09dd3792ecdd29bb576dc9c9872b94308f4acfac`, run `FR-1e65186b1f7334ef2a7e3c6b`, 2026-11-04T14:55:31.557Z to 2026-11-04T14:55:51.723Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2160 fly-seconds, then again for the determinism guard
- Code: commit `e458f7cb34904d85127779a3700c26b376ab4a80`
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
