# FLY-b08a681cf57732307c4b013c: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-01: recognition of bodily impairment: experimental ECHO self-model (full), against the same motor probe with its self-model disabled.

**Caveat.** Scripted motor excitation and idealized local odometry in reduced-order walking. Causal inference can remain ambiguous; no biological motor-control, consciousness or durable identity claim.

**Question (host-written).** In the digital fly simulator, how does experimental ECHO self-model (full) change mean absolute target movement error after adaptation, against the same motor probe with its self-model disabled on matched seeds?

**Hypothesis (host-written).** Experimental ECHO self-model (full) will decrease echo_impairment_tracking_error_cms by at least 0.1 cm/s on average over 8 matched seeds drawn after preregistration, compared with the same motor probe with its self-model disabled, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] The adaptive self-model improves the specified held-out simulator metric. — competing: [scripted] The baseline performs equally well or better; the mechanism adds no measurable value.

## Seeds

8 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3021431613, 674450439, 4011404373, 1093699101, 1131144179, 3593820018, 802166378, 127178382.

## Primary metric: echo_impairment_tracking_error_cms (cm/s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3021431613 | 0.425 | 0.189 | -0.236 | expected | `04d0690c4a6d` |
| 674450439 | 0.433 | 0.191 | -0.241 | expected | `b46306e7dc58` |
| 4011404373 | 0.430 | 0.194 | -0.236 | expected | `954b3b54ff86` |
| 1093699101 | 0.424 | 0.192 | -0.232 | expected | `3e9f26e49cc2` |
| 1131144179 | 0.428 | 0.195 | -0.233 | expected | `733c11a62c87` |
| 3593820018 | 0.427 | 0.192 | -0.234 | expected | `159a753f4bed` |
| 802166378 | 0.431 | 0.193 | -0.237 | expected | `d822c5466966` |
| 127178382 | 0.427 | 0.191 | -0.236 | expected | `fd38c20e87e6` |

8 of 8 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0039 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.428, mean treatment 0.192, mean paired difference **-0.236** (minimum effect 0.1 cm/s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 16: observed 16.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.2358 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0039 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0001-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| echo_impairment_tracking_error_cms | 0.428 | 0.192 | cm/s |
| echo_impairment_prediction_error_cms | — | 0.027 | cm/s |
| echo_impairment_attribution_accuracy | 0.640 | 1.000 | fraction |
| echo_impairment_false_self_attribution | 0.000 | 0.000 | fraction |
| echo_impairment_interval_coverage | — | 0.955 | fraction |
| echo_impairment_detection_latency_s | — | 0.359 | s |
| echo_impairment_recovery_latency_s | — | 1.180 | s |
| echo_impairment_recall_error_cms | 0.000 | 0.000 | cm/s |
| echo_impairment_recalls | 0.000 | 2.500 | count |
| echo_impairment_adapted_actions | 0.000 | 160.094 | count |
| echo_impairment_checkpoint_verified | 1.000 | 1.000 | fraction |

## Provenance

- Plan `b08a681cf57732307c4b013c8453727e26e519f5948b55aa6150669033a5175f`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0001 at 2026-10-25T17:27:20.637Z (receipt `28177814983f6e1a9354634ba01014b8fb1d2ca3de4e486bd42bf6403941a88e`)
- Authorized at 2026-10-25T17:27:20.684Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `d3b0cbe25f7193023d9f748381abb8f16f4ce6af4790ea3c3ecd88cd04ac5119`
- Record `3a09664ae8b5a09d5620b1b777ef9444f384602a5cba5dadbabfa2d227c80132`, run `FR-dc7bfb9eebf0fd066d1ac3d3`, 2026-10-25T17:27:20.688Z to 2026-10-25T17:27:29.108Z
- Simulated on node 24.22.1 (V8 13.6.233.17-node.58): 768 fly-seconds, then again for the determinism guard
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
