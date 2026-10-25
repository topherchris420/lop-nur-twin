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

8 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3629936517, 1060277639, 3450228159, 216482802, 3751279189, 3733561619, 2575170943, 349709026.

## Primary metric: echo_memory_recall_error_cms (cm/s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3629936517 | 0.328 | 0.347 | 0.019 | opposite | `4666f7d80fa1` |
| 1060277639 | 0.319 | 0.349 | 0.030 | opposite | `b0922a7f8858` |
| 3450228159 | 0.324 | 0.355 | 0.032 | opposite | `57c6ca478254` |
| 216482802 | 0.328 | 0.358 | 0.030 | opposite | `ea4a9f0d22ca` |
| 3751279189 | 0.327 | 0.356 | 0.030 | opposite | `53cdce960f60` |
| 3733561619 | 0.328 | 0.371 | 0.043 | opposite | `fc6546801feb` |
| 2575170943 | 0.322 | 0.348 | 0.027 | opposite | `5aec307646f6` |
| 349709026 | 0.327 | 0.346 | 0.019 | opposite | `ac6d8bb87ff1` |

0 of 8 untied seeds in the expected direction (decrease), 8 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 1.0000 for the expected direction, p = 0.0039 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.325, mean treatment 0.354, mean paired difference **0.029** (minimum effect 0.05 cm/s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 16: observed 16.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.05: observed 0.0285 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 1.0000 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.0039 — holds

Failure criterion triggered: F1. The hypothesis is not supported.

Registry run `V3D-EXP-0003-RUN-0001`: status **failed**, verdict **not_supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| echo_memory_tracking_error_cms | 0.193 | 0.193 | cm/s |
| echo_memory_prediction_error_cms | 0.030 | 0.030 | cm/s |
| echo_memory_attribution_accuracy | 0.986 | 0.986 | fraction |
| echo_memory_false_self_attribution | 0.000 | 0.000 | fraction |
| echo_memory_interval_coverage | 0.968 | 0.960 | fraction |
| echo_memory_detection_latency_s | 0.350 | 0.350 | s |
| echo_memory_recovery_latency_s | 1.181 | 1.181 | s |
| echo_memory_recall_error_cms | 0.325 | 0.354 | cm/s |
| echo_memory_recalls | 1.000 | 5.219 | count |
| echo_memory_adapted_actions | 155.219 | 332.250 | count |
| echo_memory_checkpoint_verified | 1.000 | 1.000 | fraction |

## Provenance

- Plan `50a5a3909ff0d2049a50efe00dbf903e2ba58b79a21b90f2b10f8df43028ddc7`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0003 at 2026-10-25T17:20:52.597Z (receipt `2d3b02dd3434e91b08e290497057031f8942c62582ca5897014c577e8ce28663`)
- Authorized at 2026-10-25T17:20:52.625Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `bfb7d0783209c8f1f5ca27000d57d5f67a7ffa002b2bd242eb43ba36ec55fefd`
- Record `dd5e142d5fcf63486f3dbd7ba9b206308ed58d204b08f00a26527ccff8765def`, run `FR-db2eafa9c9330d9d19404fef`, 2026-10-25T17:20:52.631Z to 2026-10-25T17:21:18.279Z
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
