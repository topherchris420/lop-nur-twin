# FLY-a024d61ac13192a8f3f7b9fe: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-02: self versus external causation: experimental ECHO self-model (no_uncertainty), against the same motor probe with its self-model disabled.

**Caveat.** Scripted motor excitation and idealized local odometry in reduced-order walking. Causal inference can remain ambiguous; no biological motor-control, consciousness or durable identity claim.

**Question (host-written).** In the digital fly simulator, how does experimental ECHO self-model (no_uncertainty) change fraction of correct causal hypotheses after adaptation; ambiguous counts incorrect, against the same motor probe with its self-model disabled on matched seeds?

**Hypothesis (host-written).** Experimental ECHO self-model (no_uncertainty) will increase echo_causation_attribution_accuracy by at least 0.1 fraction on average over 8 matched seeds drawn after preregistration, compared with the same motor probe with its self-model disabled, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] The adaptive self-model improves the specified held-out simulator metric. — competing: [scripted] The baseline performs equally well or better; the mechanism adds no measurable value.

## Seeds

8 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3355598588, 2243172822, 2288186603, 2215220493, 53659641, 3675686989, 2956370996, 675923676.

## Primary metric: echo_causation_attribution_accuracy (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3355598588 | 0.145 | 0.833 | 0.688 | expected | `070dfbb82933` |
| 2243172822 | 0.140 | 0.833 | 0.693 | expected | `9c9a76e219a8` |
| 2288186603 | 0.145 | 0.833 | 0.688 | expected | `363ac47e7532` |
| 2215220493 | 0.140 | 0.833 | 0.693 | expected | `49d4acdf2643` |
| 53659641 | 0.140 | 0.833 | 0.693 | expected | `5f76e74a6d52` |
| 3675686989 | 0.140 | 0.833 | 0.693 | expected | `d8391d8f6867` |
| 2956370996 | 0.140 | 0.824 | 0.683 | expected | `3c764daf145b` |
| 675923676 | 0.145 | 0.833 | 0.688 | expected | `fb559db6b093` |

8 of 8 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0039 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.142, mean treatment 0.832, mean paired difference **0.690** (minimum effect 0.1 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 16: observed 16.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.1: observed 0.6899 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0039 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0009-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| echo_causation_tracking_error_cms | 0.520 | 0.433 | cm/s |
| echo_causation_prediction_error_cms | — | 0.175 | cm/s |
| echo_causation_attribution_accuracy | 0.142 | 0.832 | fraction |
| echo_causation_false_self_attribution | 0.410 | 0.000 | fraction |
| echo_causation_interval_coverage | — | 0.858 | fraction |
| echo_causation_detection_latency_s | — | 0.397 | s |
| echo_causation_recovery_latency_s | — | 0.826 | s |
| echo_causation_recall_error_cms | 0.000 | 0.000 | cm/s |
| echo_causation_recalls | 0.000 | 1.542 | count |
| echo_causation_adapted_actions | 0.000 | 150.750 | count |
| echo_causation_checkpoint_verified | 1.000 | 1.000 | fraction |

## Provenance

- Plan `a024d61ac13192a8f3f7b9fe9fb45d45c89f26d368030b11810daf7661ba23c3`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0009 at 2026-10-25T17:22:55.920Z (receipt `cf4c316f6a1e5077f4d84bab906d142b29cb289e429283559b6a755891db7df3`)
- Authorized at 2026-10-25T17:22:55.946Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `f7da9f81fd68e7685d68c06b54ac90502e2c01cf117b1ac67d28cf09d6f87194`
- Record `b23f7df0afcf3b28d3d2e0991d1f89c2ff3d2e1902eaa9766e9c08fefa2f09a1`, run `FR-482fd18b53397274ed58addc`, 2026-10-25T17:22:55.947Z to 2026-10-25T17:23:05.601Z
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
