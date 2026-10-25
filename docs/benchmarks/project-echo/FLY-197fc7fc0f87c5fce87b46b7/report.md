# FLY-197fc7fc0f87c5fce87b46b7: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-02: self versus external causation: experimental ECHO self-model (no_memory), against the same motor probe with its self-model disabled.

**Caveat.** Scripted motor excitation and idealized local odometry in reduced-order walking. Causal inference can remain ambiguous; no biological motor-control, consciousness or durable identity claim.

**Question (host-written).** In the digital fly simulator, how does experimental ECHO self-model (no_memory) change fraction of correct causal hypotheses after adaptation; ambiguous counts incorrect, against the same motor probe with its self-model disabled on matched seeds?

**Hypothesis (host-written).** Experimental ECHO self-model (no_memory) will increase echo_causation_attribution_accuracy by at least 0.1 fraction on average over 8 matched seeds drawn after preregistration, compared with the same motor probe with its self-model disabled, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] The adaptive self-model improves the specified held-out simulator metric. — competing: [scripted] The baseline performs equally well or better; the mechanism adds no measurable value.

## Seeds

8 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 4294419891, 3586069567, 1078096797, 1021521109, 1394929558, 61829022, 2424072243, 312313812.

## Primary metric: echo_causation_attribution_accuracy (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 4294419891 | 0.140 | 0.819 | 0.679 | expected | `55386858b03d` |
| 3586069567 | 0.140 | 0.824 | 0.683 | expected | `df8687ea5658` |
| 1078096797 | 0.140 | 0.833 | 0.693 | expected | `10879cd8713b` |
| 1021521109 | 0.140 | 0.776 | 0.636 | expected | `ed40c4eb5c28` |
| 1394929558 | 0.145 | 0.833 | 0.688 | expected | `901934dbf105` |
| 61829022 | 0.140 | 0.781 | 0.640 | expected | `8b5b539d9f72` |
| 2424072243 | 0.140 | 0.757 | 0.617 | expected | `57b63af8ba34` |
| 312313812 | 0.140 | 0.795 | 0.655 | expected | `a6bcbe73717c` |

8 of 8 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0039 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.141, mean treatment 0.802, mean paired difference **0.661** (minimum effect 0.1 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 16: observed 16.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.1: observed 0.6613 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0039 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0008-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| echo_causation_tracking_error_cms | 0.531 | 0.467 | cm/s |
| echo_causation_prediction_error_cms | — | 0.161 | cm/s |
| echo_causation_attribution_accuracy | 0.141 | 0.802 | fraction |
| echo_causation_false_self_attribution | 0.411 | 0.001 | fraction |
| echo_causation_interval_coverage | — | 0.958 | fraction |
| echo_causation_detection_latency_s | — | 0.410 | s |
| echo_causation_recovery_latency_s | — | 0.904 | s |
| echo_causation_recall_error_cms | 0.000 | 0.000 | cm/s |
| echo_causation_recalls | 0.000 | 0.000 | count |
| echo_causation_adapted_actions | 0.000 | 153.083 | count |
| echo_causation_checkpoint_verified | 1.000 | 1.000 | fraction |

## Provenance

- Plan `197fc7fc0f87c5fce87b46b7a9af0149aa8e63a7f6cf57bf45e18f470425b928`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0008 at 2026-10-25T17:22:41.039Z (receipt `9822e915f8f07963f0b2fbf7e7d8f3234283756a9520eb59b6867c8c6df694d8`)
- Authorized at 2026-10-25T17:22:41.052Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `086e3c8d8fc15ad9e19a6d849050f0e2c51d98dc3843c02bf7a704e80b38f390`
- Record `5d5750c47a609a8a3008c9ab335b8af50ba7bcd89ffebf25c72910cf8d83319b`, run `FR-a24ec79fb63d2b57e82b5ff3`, 2026-10-25T17:22:41.053Z to 2026-10-25T17:22:48.399Z
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
