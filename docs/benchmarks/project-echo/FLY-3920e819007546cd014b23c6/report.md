# FLY-3920e819007546cd014b23c6: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-01: recognition of bodily impairment: experimental ECHO self-model (no_uncertainty), against the same motor probe with its self-model disabled.

**Caveat.** Scripted motor excitation and idealized local odometry in reduced-order walking. Causal inference can remain ambiguous; no biological motor-control, consciousness or durable identity claim.

**Question (host-written).** In the digital fly simulator, how does experimental ECHO self-model (no_uncertainty) change mean absolute target movement error after adaptation, against the same motor probe with its self-model disabled on matched seeds?

**Hypothesis (host-written).** Experimental ECHO self-model (no_uncertainty) will decrease echo_impairment_tracking_error_cms by at least 0.1 cm/s on average over 8 matched seeds drawn after preregistration, compared with the same motor probe with its self-model disabled, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] The adaptive self-model improves the specified held-out simulator metric. — competing: [scripted] The baseline performs equally well or better; the mechanism adds no measurable value.

## Seeds

8 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 319912974, 3166554706, 3998617784, 463441116, 483765749, 3900707987, 611829059, 941951754.

## Primary metric: echo_impairment_tracking_error_cms (cm/s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 319912974 | 0.430 | 0.194 | -0.237 | expected | `afe3c15d6aef` |
| 3166554706 | 0.431 | 0.196 | -0.235 | expected | `674e5f918991` |
| 3998617784 | 0.427 | 0.190 | -0.237 | expected | `c26b9401efc7` |
| 463441116 | 0.431 | 0.197 | -0.235 | expected | `9449f152e409` |
| 483765749 | 0.434 | 0.193 | -0.241 | expected | `41bcd9fbaa89` |
| 3900707987 | 0.429 | 0.192 | -0.237 | expected | `16658a5485a3` |
| 611829059 | 0.428 | 0.192 | -0.236 | expected | `f945d96108a1` |
| 941951754 | 0.431 | 0.190 | -0.241 | expected | `55f3b1cd97df` |

8 of 8 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0039 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.430, mean treatment 0.193, mean paired difference **-0.237** (minimum effect 0.1 cm/s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 16: observed 16.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.2373 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0039 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0006-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| echo_impairment_tracking_error_cms | 0.430 | 0.193 | cm/s |
| echo_impairment_prediction_error_cms | — | 0.028 | cm/s |
| echo_impairment_attribution_accuracy | 0.645 | 0.997 | fraction |
| echo_impairment_false_self_attribution | 0.000 | 0.000 | fraction |
| echo_impairment_interval_coverage | — | 0.932 | fraction |
| echo_impairment_detection_latency_s | — | 0.319 | s |
| echo_impairment_recovery_latency_s | — | 1.155 | s |
| echo_impairment_recall_error_cms | 0.000 | 0.000 | cm/s |
| echo_impairment_recalls | 0.000 | 2.594 | count |
| echo_impairment_adapted_actions | 0.000 | 169.656 | count |
| echo_impairment_checkpoint_verified | 1.000 | 1.000 | fraction |

## Provenance

- Plan `3920e819007546cd014b23c6e1cab0edfd77b781eb7f7eb3346436f228b19d7c`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0006 at 2026-10-25T17:22:08.690Z (receipt `3194c0f6c1bbda84f8bf8bef33baaa12bd076323c88db4838b2e249aed2b6d38`)
- Authorized at 2026-10-25T17:22:08.699Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `c55267801c53a6efed5a35c46281b097f96563abe04c84da0a83be96030d37f0`
- Record `88a6bc9be4ee843f8fd9a067889599b51ecaf29a63b8a3165375481177e32ced`, run `FR-398b7b4e29651d155685b03d`, 2026-10-25T17:22:08.700Z to 2026-10-25T17:22:16.061Z
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
