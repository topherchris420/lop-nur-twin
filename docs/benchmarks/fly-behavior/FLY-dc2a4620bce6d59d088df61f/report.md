# FLY-dc2a4620bce6d59d088df61f: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-01: recognizing a bodily impairment: the ECHO controller with no self-model (the reduced-order controller alone), against the full ECHO self-model under the same hidden conditions.

**Caveat.** Compensation is of abstract movement gains in the reduced-order simulator, not validated motor control; a strong impairment cannot be fully compensated within the body's 4 cm/s. Identification (the identification error) is measured apart from compensation (the path errors).

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with no self-model (the reduced-order controller alone) change mean path error of steady walking from the hidden impairment's onset to the end of the run, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with no self-model (the reduced-order controller alone) will increase impaired_path_error by at least 0.19 fraction on average over 9 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Without its self-model, the fly's walking strays further from its intended path after a hidden impairment, from held-out conditions, than with it. — competing: [scripted] The reduced-order controller's own feedback (turning back from edges, its tether) keeps its path as close to its intentions as a self-model would.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2590894770, 1965573247, 2882177716, 569104170, 3054612182, 1158972951, 3969320173, 1713541383, 4155064807.

## Primary metric: impaired_path_error (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2590894770 | 0.016 | 0.432 | 0.416 | expected | `01cb21c4b9be` |
| 1965573247 | 0.018 | 0.027 | 0.009 | expected | `52d5cff0c8c2` |
| 2882177716 | 0.012 | 0.071 | 0.058 | expected | `8a8cfbe68c0d` |
| 569104170 | 0.124 | 0.362 | 0.238 | expected | `476f9aac3976` |
| 3054612182 | 0.028 | 0.464 | 0.437 | expected | `44ae5949e455` |
| 1158972951 | 0.013 | 0.077 | 0.063 | expected | `9159175a4051` |
| 3969320173 | 0.061 | 0.459 | 0.398 | expected | `efab63cd3d01` |
| 1713541383 | 0.009 | 0.566 | 0.557 | expected | `a0e02f062ff4` |
| 4155064807 | 0.246 | 0.486 | 0.240 | expected | `339da3e4e263` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.059, mean treatment 0.327, mean paired difference **0.268** (minimum effect 0.19 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.19: observed 0.2684 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0052-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| impaired_path_error | 0.059 | 0.327 | fraction |
| late_path_error | 0.069 | 0.328 | fraction |
| baseline_path_error | 0.018 | 0.002 | fraction |
| detection_latency_s | 4.667 | — | s |
| attribution_latency_s | 2.119 | — | s |
| identification_error | 0.016 | — | fraction |
| false_alarms_per_min | 0.818 | — | 1/min |
| impaired_walked_m | 1.265 | 1.021 | m |
| coverage_90 | 0.905 | — | fraction |

## Provenance

- Plan `dc2a4620bce6d59d088df61f9f40dee399515d1cb4973bf89163064001fd1ccd`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `8d86753f0ca7a7395da5a6b7f3902bd120428b515dc616340ef12e9ae0489eed`, source `86708015e47c271602b7856459ea1d6ff513ea0f1df0bb8587c3f192a417f022`
- Preregistered as V3D-EXP-0052 at 2026-10-26T23:27:44.509Z (receipt `117796b0e8b38e974e5fee3b8a9ad01c79c120de9c3944b12c099cd654011f35`)
- Authorized at 2026-10-26T23:27:44.539Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `1950c58002089bca5cc776aa0629512462127b9dae79514b57f643942e573ba1`
- Record `2ccb8a3f2ab4a0254b96fc645e7fd5f9dc1858779e3ffcb05f1f06c1e0483f73`, run `FR-bd01cf67544ff671a9d6dc59`, 2026-10-26T23:27:44.540Z to 2026-10-26T23:27:49.270Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2160 fly-seconds, then again for the determinism guard
- Code: commit `fb76ce5c5fc61f279bc5980bd1ea22863c0cdb8d`
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
