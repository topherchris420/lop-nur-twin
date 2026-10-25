# FLY-5b39598d8379490a0479222e: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-01: recognition of bodily impairment: experimental ECHO self-model (no_memory), against the same motor probe with its self-model disabled.

**Caveat.** Scripted motor excitation and idealized local odometry in reduced-order walking. Causal inference can remain ambiguous; no biological motor-control, consciousness or durable identity claim.

**Question (host-written).** In the digital fly simulator, how does experimental ECHO self-model (no_memory) change mean absolute target movement error after adaptation, against the same motor probe with its self-model disabled on matched seeds?

**Hypothesis (host-written).** Experimental ECHO self-model (no_memory) will decrease echo_impairment_tracking_error_cms by at least 0.1 cm/s on average over 8 matched seeds drawn after preregistration, compared with the same motor probe with its self-model disabled, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] The adaptive self-model improves the specified held-out simulator metric. — competing: [scripted] The baseline performs equally well or better; the mechanism adds no measurable value.

## Seeds

8 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 949155222, 3797432845, 354667334, 3812378578, 3735602983, 3220861798, 138841991, 4166788614.

## Primary metric: echo_impairment_tracking_error_cms (cm/s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 949155222 | 0.436 | 0.191 | -0.245 | expected | `482049675291` |
| 3797432845 | 0.427 | 0.192 | -0.235 | expected | `c7d80f556429` |
| 354667334 | 0.427 | 0.196 | -0.231 | expected | `2751e02d22a3` |
| 3812378578 | 0.432 | 0.191 | -0.241 | expected | `0cce8cff552b` |
| 3735602983 | 0.426 | 0.188 | -0.239 | expected | `6da81321c189` |
| 3220861798 | 0.430 | 0.188 | -0.242 | expected | `94f073514d75` |
| 138841991 | 0.428 | 0.194 | -0.234 | expected | `177a3464528f` |
| 4166788614 | 0.434 | 0.193 | -0.242 | expected | `ec213e861f96` |

8 of 8 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0039 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.430, mean treatment 0.192, mean paired difference **-0.238** (minimum effect 0.1 cm/s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 16: observed 16.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.2385 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0039 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0005-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| echo_impairment_tracking_error_cms | 0.430 | 0.192 | cm/s |
| echo_impairment_prediction_error_cms | — | 0.030 | cm/s |
| echo_impairment_attribution_accuracy | 0.640 | 1.000 | fraction |
| echo_impairment_false_self_attribution | 0.000 | 0.000 | fraction |
| echo_impairment_interval_coverage | — | 0.953 | fraction |
| echo_impairment_detection_latency_s | — | 0.358 | s |
| echo_impairment_recovery_latency_s | — | 1.247 | s |
| echo_impairment_recall_error_cms | 0.000 | 0.000 | cm/s |
| echo_impairment_recalls | 0.000 | 0.000 | count |
| echo_impairment_adapted_actions | 0.000 | 167.063 | count |
| echo_impairment_checkpoint_verified | 1.000 | 1.000 | fraction |

## Provenance

- Plan `5b39598d8379490a0479222ec27764955cc868f469eafb87b7f13480e95280cc`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0005 at 2026-10-25T17:21:56.261Z (receipt `3db2a0e42c71e41597c7e0ed8d8983b3ef98e9b3962d6e263b208af5ddb788e3`)
- Authorized at 2026-10-25T17:21:56.273Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `23641bb5e407c7eefb37995af8eab2523aa860f0732777185edabf2016a5ff52`
- Record `8c3a031e7375c7a6355ad34d398ec4023508a16fa0d5e7754a4d2a54f17694d8`, run `FR-ea2b9aff845dc648471a649c`, 2026-10-25T17:21:56.274Z to 2026-10-25T17:22:02.689Z
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
