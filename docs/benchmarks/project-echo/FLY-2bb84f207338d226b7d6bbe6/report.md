# FLY-2bb84f207338d226b7d6bbe6: FAILED (not supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-03: retained learning through time: experimental ECHO self-model (no_learning), against self-model reset at re-exposure.

**Caveat.** Scripted motor excitation and idealized local odometry in reduced-order walking. Causal inference can remain ambiguous; no biological motor-control, consciousness or durable identity claim.

**Question (host-written).** In the digital fly simulator, how does experimental ECHO self-model (no_learning) change early movement error on re-exposure, with retained versus reset self-model, against self-model reset at re-exposure on matched seeds?

**Hypothesis (host-written).** Experimental ECHO self-model (no_learning) will decrease echo_memory_recall_error_cms by at least 0.05 cm/s on average over 8 matched seeds drawn after preregistration, compared with self-model reset at re-exposure, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] The adaptive self-model improves the specified held-out simulator metric. — competing: [scripted] The baseline performs equally well or better; the mechanism adds no measurable value.

## Seeds

8 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3264667210, 1166128698, 369548491, 1722025816, 3945412491, 1624997904, 1234546184, 2532981924.

## Primary metric: echo_memory_recall_error_cms (cm/s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3264667210 | 0.326 | 0.469 | 0.143 | opposite | `f01ca4979467` |
| 1166128698 | 0.321 | 0.477 | 0.156 | opposite | `776a805e5ecc` |
| 369548491 | 0.319 | 0.461 | 0.141 | opposite | `05f3a2c40c4f` |
| 1722025816 | 0.323 | 0.463 | 0.140 | opposite | `2c6f64381fc8` |
| 3945412491 | 0.326 | 0.480 | 0.154 | opposite | `cc57f77505a5` |
| 1624997904 | 0.323 | 0.460 | 0.137 | opposite | `f7ca47e772fb` |
| 1234546184 | 0.323 | 0.461 | 0.139 | opposite | `eb62d519daed` |
| 2532981924 | 0.324 | 0.462 | 0.138 | opposite | `7222a3ae52a7` |

0 of 8 untied seeds in the expected direction (decrease), 8 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 1.0000 for the expected direction, p = 0.0039 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.323, mean treatment 0.467, mean paired difference **0.143** (minimum effect 0.05 cm/s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 16: observed 16.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.05: observed 0.1435 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 1.0000 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.0039 — holds

Failure criterion triggered: F1. The hypothesis is not supported.

Registry run `V3D-EXP-0010-RUN-0001`: status **failed**, verdict **not_supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| echo_memory_tracking_error_cms | 0.190 | 0.429 | cm/s |
| echo_memory_prediction_error_cms | 0.030 | 0.422 | cm/s |
| echo_memory_attribution_accuracy | 1.000 | 0.000 | fraction |
| echo_memory_false_self_attribution | 0.000 | 0.000 | fraction |
| echo_memory_interval_coverage | 0.967 | 0.974 | fraction |
| echo_memory_detection_latency_s | 0.353 | — | s |
| echo_memory_recovery_latency_s | 1.177 | — | s |
| echo_memory_recall_error_cms | 0.323 | 0.467 | cm/s |
| echo_memory_recalls | 0.906 | 0.000 | count |
| echo_memory_adapted_actions | 157.094 | 3.469 | count |
| echo_memory_checkpoint_verified | 1.000 | 1.000 | fraction |

## Provenance

- Plan `2bb84f207338d226b7d6bbe61d867d46023e4c9bf2dc982317a67ce7a081b192`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0010 at 2026-10-25T17:23:17.272Z (receipt `18e4591f2761bb2b9206cd6a0c9080fa728a7099c6558fe2868251f09fdb2029`)
- Authorized at 2026-10-25T17:23:17.284Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `216caff80b766eefb5f6ed8aba356ff9b88cf3bd5840ee63a0815e9af09b05ba`
- Record `23564a26c3aa9b8325c2b295389ed7823bb25346081b5bb89b7efae3cab5d67f`, run `FR-b0309a536ed0f41bc3907431`, 2026-10-25T17:23:17.284Z to 2026-10-25T17:23:32.563Z
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
