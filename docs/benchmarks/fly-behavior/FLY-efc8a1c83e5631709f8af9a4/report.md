# FLY-efc8a1c83e5631709f8af9a4: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-01: recognizing a bodily impairment: the ECHO controller with no self-model (the reduced-order controller alone), against the full ECHO self-model under the same hidden conditions.

**Caveat.** Compensation is of abstract movement gains in the reduced-order simulator, not validated motor control; a strong impairment cannot be fully compensated within the body's 4 cm/s. Identification (the identification error) is measured apart from compensation (the path errors).

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with no self-model (the reduced-order controller alone) change mean path error of steady walking from the hidden impairment's onset to the end of the run, against the full ECHO self-model under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with no self-model (the reduced-order controller alone) will increase impaired_path_error by at least 0.19 fraction on average over 9 matched seeds drawn after preregistration, compared with the full ECHO self-model under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Without its self-model, the fly's walking strays further from its intended path after a hidden impairment, from held-out conditions, than with it. — competing: [scripted] The reduced-order controller's own feedback (turning back from edges, its tether) keeps its path as close to its intentions as a self-model would.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 492040161, 1221275482, 1704699338, 3101383083, 122540931, 471819801, 557275932, 2816505730, 4072299449.

## Primary metric: impaired_path_error (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 492040161 | 0.199 | 0.588 | 0.390 | expected | `09dcd6a4d2a3` |
| 1221275482 | 0.044 | 0.324 | 0.280 | expected | `2a564a52fcbf` |
| 1704699338 | 0.176 | 0.601 | 0.425 | expected | `8910be80a8b1` |
| 3101383083 | 0.074 | 0.491 | 0.417 | expected | `2f09254f89b6` |
| 122540931 | 0.090 | 0.362 | 0.272 | expected | `4b71cfa530e9` |
| 471819801 | 0.006 | 0.036 | 0.030 | expected | `607c109d3816` |
| 557275932 | 0.005 | 0.081 | 0.076 | expected | `1352aedb6303` |
| 2816505730 | 0.032 | 0.371 | 0.339 | expected | `056ec54d846b` |
| 4072299449 | 0.012 | 0.253 | 0.241 | expected | `72911c4f4e6d` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.071, mean treatment 0.345, mean paired difference **0.274** (minimum effect 0.19 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 18: observed 18.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.19: observed 0.2743 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0007-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| impaired_path_error | 0.071 | 0.345 | fraction |
| late_path_error | 0.045 | 0.345 | fraction |
| baseline_path_error | 0.015 | 0.002 | fraction |
| detection_latency_s | 0.922 | — | s |
| attribution_latency_s | 2.928 | — | s |
| identification_error | 0.008 | — | fraction |
| false_alarms_per_min | 0.000 | — | 1/min |
| impaired_walked_m | 1.367 | 1.063 | m |
| coverage_90 | 0.907 | — | fraction |

## Provenance

- Plan `efc8a1c83e5631709f8af9a4ee8085f7528baccd2101a7f6232852e54f45a67b`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `309bc659d993b7c1affb6353a5aac0e434e9fc502d8d9477013d3af7296aaf38`, source `b9abf944d6d246ff622184e4b0d29ccdf4e3966665643958ab4585d67f4b0aff`
- Preregistered as V3D-EXP-0007 at 2026-10-26T00:35:20.117Z (receipt `401805811135e730bcd1528fcc786feb04b767010ec2a2217139c01045f2c8a4`)
- Authorized at 2026-10-26T00:35:20.143Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `76e01d441f032cd524658b04e7f1b3ed9c9de353d34d0b664b6c257869e028da`
- Record `3257540c6f25cf6b9c02528871a2e2686fb8daa0ca6a0085e6518169e7131b48`, run `FR-ec1e104b0a8870109c170db7`, 2026-10-26T00:35:20.144Z to 2026-10-26T00:35:28.760Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2160 fly-seconds, then again for the determinism guard
- Code: commit `06ff901fae549bb121d80c9b61e0f5c6b61faf77`
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
