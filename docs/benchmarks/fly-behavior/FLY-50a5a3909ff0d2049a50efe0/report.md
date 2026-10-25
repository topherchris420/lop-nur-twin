# FLY-50a5a3909ff0d2049a50efe0: FAILED (not supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-03: retained learning through time: experimental ECHO self-model (full), against self-model reset at re-exposure.

**Caveat.** Scripted motor excitation and idealized local odometry in reduced-order walking. Causal inference can remain ambiguous; no biological motor-control, consciousness or durable identity claim.

**Question (host-written).** In the digital fly simulator, how does experimental ECHO self-model (full) change early movement error on re-exposure, with retained versus reset self-model, against self-model reset at re-exposure on matched seeds?

**Hypothesis (host-written).** Experimental ECHO self-model (full) will decrease echo_memory_recall_error_cms by at least 0.05 cm/s on average over 8 matched seeds drawn after preregistration, compared with self-model reset at re-exposure, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] The adaptive self-model improves the specified held-out simulator metric. — competing: [scripted] The baseline performs equally well or better; the mechanism adds no measurable value.

## Seeds

8 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1476260058, 3364868512, 552470488, 291116284, 2146339817, 3154565102, 1660239215, 761574573.

## Primary metric: echo_memory_recall_error_cms (cm/s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1476260058 | 0.323 | 0.350 | 0.027 | opposite | `062a275179f9` |
| 3364868512 | 0.325 | 0.360 | 0.035 | opposite | `6348cec5e49a` |
| 552470488 | 0.320 | 0.362 | 0.043 | opposite | `37dad463bba0` |
| 291116284 | 0.329 | 0.358 | 0.029 | opposite | `afea61137b78` |
| 2146339817 | 0.325 | 0.366 | 0.041 | opposite | `769dc02e00f4` |
| 3154565102 | 0.323 | 0.342 | 0.019 | opposite | `4ffdb85a7ef2` |
| 1660239215 | 0.327 | 0.349 | 0.022 | opposite | `9a089e23b41c` |
| 761574573 | 0.325 | 0.343 | 0.019 | opposite | `a04849554c20` |

0 of 8 untied seeds in the expected direction (decrease), 8 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 1.0000 for the expected direction, p = 0.0039 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.325, mean treatment 0.354, mean paired difference **0.029** (minimum effect 0.05 cm/s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 16: observed 16.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.05: observed 0.0293 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 1.0000 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.0039 — holds

Failure criterion triggered: F1. The hypothesis is not supported.

Registry run `V3D-EXP-0003-RUN-0001`: status **failed**, verdict **not_supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| echo_memory_tracking_error_cms | 0.193 | 0.193 | cm/s |
| echo_memory_prediction_error_cms | 0.029 | 0.029 | cm/s |
| echo_memory_attribution_accuracy | 1.000 | 1.000 | fraction |
| echo_memory_false_self_attribution | 0.000 | 0.000 | fraction |
| echo_memory_interval_coverage | 0.967 | 0.962 | fraction |
| echo_memory_detection_latency_s | 0.353 | 0.353 | s |
| echo_memory_recovery_latency_s | 1.177 | 1.177 | s |
| echo_memory_recall_error_cms | 0.325 | 0.354 | cm/s |
| echo_memory_recalls | 1.000 | 5.094 | count |
| echo_memory_adapted_actions | 153.875 | 333.875 | count |
| echo_memory_checkpoint_verified | 1.000 | 1.000 | fraction |

## Provenance

- Plan `50a5a3909ff0d2049a50efe00dbf903e2ba58b79a21b90f2b10f8df43028ddc7`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0003 at 2026-10-25T17:27:58.923Z (receipt `3948ce32eeb06bf9f1525875eb4540e94d493c77aaf0189120504a008573de25`)
- Authorized at 2026-10-25T17:27:58.942Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `e091c6a7bf7e24bdb9314581b0f32878b4abc0370a2ad158e03fecbbde73156a`
- Record `a6cd2e94a7c16ba6dd9014323e99d1203cf30b883cf5619f75ba9b8f2e7ecad0`, run `FR-25a13c9bd5f41b591ddb564c`, 2026-10-25T17:27:58.942Z to 2026-10-25T17:28:21.831Z
- Simulated on node 24.22.1 (V8 13.6.233.17-node.58): 1536 fly-seconds, then again for the determinism guard
- Code: commit `a71066264ba3ff3a6949316bdc0f0bcee92c5520`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Scripted motor excitation and idealized local odometry in reduced-order walking. Causal inference can remain ambiguous; no biological motor-control, consciousness or durable identity claim.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
