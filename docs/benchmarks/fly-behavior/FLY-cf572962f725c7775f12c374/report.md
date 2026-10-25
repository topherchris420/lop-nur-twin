# FLY-cf572962f725c7775f12c374: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-02: self versus external causation: experimental ECHO self-model (full), against the same motor probe with its self-model disabled.

**Caveat.** Scripted motor excitation and idealized local odometry in reduced-order walking. Causal inference can remain ambiguous; no biological motor-control, consciousness or durable identity claim.

**Question (host-written).** In the digital fly simulator, how does experimental ECHO self-model (full) change fraction of correct causal hypotheses after adaptation; ambiguous counts incorrect, against the same motor probe with its self-model disabled on matched seeds?

**Hypothesis (host-written).** Experimental ECHO self-model (full) will increase echo_causation_attribution_accuracy by at least 0.1 fraction on average over 8 matched seeds drawn after preregistration, compared with the same motor probe with its self-model disabled, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] The adaptive self-model improves the specified held-out simulator metric. — competing: [scripted] The baseline performs equally well or better; the mechanism adds no measurable value.

## Seeds

8 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1326929657, 2633601587, 2897739561, 2340595456, 3554231260, 276474109, 1765909036, 3541273468.

## Primary metric: echo_causation_attribution_accuracy (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1326929657 | 0.145 | 0.833 | 0.688 | expected | `3e97ee09b695` |
| 2633601587 | 0.140 | 0.783 | 0.643 | expected | `4c7bf53a2c11` |
| 2897739561 | 0.140 | 0.824 | 0.683 | expected | `0fb3309b0b76` |
| 2340595456 | 0.145 | 0.833 | 0.688 | expected | `4ba5c1352e89` |
| 3554231260 | 0.145 | 0.833 | 0.688 | expected | `260362f3e31d` |
| 276474109 | 0.140 | 0.826 | 0.686 | expected | `288ecf3f9127` |
| 1765909036 | 0.145 | 0.833 | 0.688 | expected | `a19515177921` |
| 3541273468 | 0.145 | 0.833 | 0.688 | expected | `4800676a21f1` |

8 of 8 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0039 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.143, mean treatment 0.825, mean paired difference **0.682** (minimum effect 0.1 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 16: observed 16.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.1: observed 0.6815 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0039 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0002-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| echo_causation_tracking_error_cms | 0.521 | 0.461 | cm/s |
| echo_causation_prediction_error_cms | — | 0.160 | cm/s |
| echo_causation_attribution_accuracy | 0.143 | 0.825 | fraction |
| echo_causation_false_self_attribution | 0.408 | 0.000 | fraction |
| echo_causation_interval_coverage | — | 0.960 | fraction |
| echo_causation_detection_latency_s | — | 0.418 | s |
| echo_causation_recovery_latency_s | — | 0.839 | s |
| echo_causation_recall_error_cms | 0.000 | 0.000 | cm/s |
| echo_causation_recalls | 0.000 | 1.563 | count |
| echo_causation_adapted_actions | 0.000 | 157.500 | count |
| echo_causation_checkpoint_verified | 1.000 | 1.000 | fraction |

## Provenance

- Plan `cf572962f725c7775f12c3748a284ac34bcb4cb498ebde02314fbcf38df4b7e2`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0002 at 2026-10-25T17:27:37.083Z (receipt `6e3f28d86f158e9b7a988834c139e283829a8d39f8e17bdbe0b01d2e0d35515e`)
- Authorized at 2026-10-25T17:27:37.104Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `7becafbd6a5633ad505c027725ee84cf6cb82bb3a39e82fc53b724ad93c7a206`
- Record `73e3c9e0d323952541cd08cc0ebb80b95ce21102f2e1e7ea0eecf301ccd6171a`, run `FR-fa7bfaa270e2359cb004d06d`, 2026-10-25T17:27:37.104Z to 2026-10-25T17:27:47.224Z
- Simulated on node 24.22.1 (V8 13.6.233.17-node.58): 1152 fly-seconds, then again for the determinism guard
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
