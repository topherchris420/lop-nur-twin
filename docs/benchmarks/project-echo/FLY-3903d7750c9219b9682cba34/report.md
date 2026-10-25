# FLY-3903d7750c9219b9682cba34: FAILED (not supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-03: retained learning through time: experimental ECHO self-model (no_uncertainty), against self-model reset at re-exposure.

**Caveat.** Scripted motor excitation and idealized local odometry in reduced-order walking. Causal inference can remain ambiguous; no biological motor-control, consciousness or durable identity claim.

**Question (host-written).** In the digital fly simulator, how does experimental ECHO self-model (no_uncertainty) change early movement error on re-exposure, with retained versus reset self-model, against self-model reset at re-exposure on matched seeds?

**Hypothesis (host-written).** Experimental ECHO self-model (no_uncertainty) will decrease echo_memory_recall_error_cms by at least 0.05 cm/s on average over 8 matched seeds drawn after preregistration, compared with self-model reset at re-exposure, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] The adaptive self-model improves the specified held-out simulator metric. — competing: [scripted] The baseline performs equally well or better; the mechanism adds no measurable value.

## Seeds

8 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3321858947, 2380317545, 75847437, 174503479, 1791307521, 2290893536, 905676953, 181790013.

## Primary metric: echo_memory_recall_error_cms (cm/s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3321858947 | 0.325 | 0.340 | 0.014 | opposite | `efcc9e15c804` |
| 2380317545 | 0.329 | 0.331 | 0.002 | opposite | `c25e0b6597a8` |
| 75847437 | 0.327 | 0.337 | 0.010 | opposite | `60568857c6aa` |
| 174503479 | 0.331 | 0.328 | -0.003 | expected | `bdc633fc2e13` |
| 1791307521 | 0.326 | 0.329 | 0.003 | opposite | `5baedd07efa0` |
| 2290893536 | 0.329 | 0.332 | 0.003 | opposite | `b6a9ade6c4eb` |
| 905676953 | 0.327 | 0.337 | 0.010 | opposite | `8e1c36b685e2` |
| 181790013 | 0.323 | 0.323 | 0.001 | opposite | `23632b91a808` |

1 of 8 untied seeds in the expected direction (decrease), 7 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.9961 for the expected direction, p = 0.0352 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.327, mean treatment 0.332, mean paired difference **0.005** (minimum effect 0.05 cm/s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 16: observed 16.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.05: observed 0.0051 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.9961 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.0352 — holds

Failure criterion triggered: F1. The hypothesis is not supported.

Registry run `V3D-EXP-0012-RUN-0001`: status **failed**, verdict **not_supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| echo_memory_tracking_error_cms | 0.193 | 0.193 | cm/s |
| echo_memory_prediction_error_cms | 0.031 | 0.031 | cm/s |
| echo_memory_attribution_accuracy | 1.000 | 1.000 | fraction |
| echo_memory_false_self_attribution | 0.000 | 0.000 | fraction |
| echo_memory_interval_coverage | 0.968 | 0.919 | fraction |
| echo_memory_detection_latency_s | 0.348 | 0.327 | s |
| echo_memory_recovery_latency_s | 1.189 | 1.148 | s |
| echo_memory_recall_error_cms | 0.327 | 0.332 | cm/s |
| echo_memory_recalls | 1.031 | 5.656 | count |
| echo_memory_adapted_actions | 151.094 | 330.625 | count |
| echo_memory_checkpoint_verified | 1.000 | 1.000 | fraction |

## Provenance

- Plan `3903d7750c9219b9682cba34250841027e200b0b19230e8a25c1ecd0de1ce78a`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0012 at 2026-10-25T17:24:16.607Z (receipt `9a933522c3356b18c1a8415313c48f170e31432c007f3fbe621e7c49279e1628`)
- Authorized at 2026-10-25T17:24:16.619Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `0ba5a1a0922f0afb3306f20850f84bf141b99611882df39148b3ab4382fd88eb`
- Record `9d076dfd607e24badb23a62845b469e97776ce1e86f04ba8e04551b3accd01f5`, run `FR-333d5bb9f0a2b909af82f741`, 2026-10-25T17:24:16.620Z to 2026-10-25T17:24:33.769Z
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
