# FLY-7f388e66ef215b708823ee62: FAILED (not supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-02: self versus external causation: experimental ECHO self-model (no_learning), against the same motor probe with its self-model disabled.

**Caveat.** Scripted motor excitation and idealized local odometry in reduced-order walking. Causal inference can remain ambiguous; no biological motor-control, consciousness or durable identity claim.

**Question (host-written).** In the digital fly simulator, how does experimental ECHO self-model (no_learning) change fraction of correct causal hypotheses after adaptation; ambiguous counts incorrect, against the same motor probe with its self-model disabled on matched seeds?

**Hypothesis (host-written).** Experimental ECHO self-model (no_learning) will increase echo_causation_attribution_accuracy by at least 0.1 fraction on average over 8 matched seeds drawn after preregistration, compared with the same motor probe with its self-model disabled, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] The adaptive self-model improves the specified held-out simulator metric. — competing: [scripted] The baseline performs equally well or better; the mechanism adds no measurable value.

## Seeds

8 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1878344521, 2967455176, 2431693578, 1634238489, 4151924054, 288144035, 638353400, 3874895743.

## Primary metric: echo_causation_attribution_accuracy (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1878344521 | 0.140 | 0.000 | -0.140 | opposite | `694156f2edb1` |
| 2967455176 | 0.145 | 0.000 | -0.145 | opposite | `9bd1c1756015` |
| 2431693578 | 0.145 | 0.000 | -0.145 | opposite | `5a5816a819ca` |
| 1634238489 | 0.145 | 0.000 | -0.145 | opposite | `7702c326ce93` |
| 4151924054 | 0.140 | 0.000 | -0.140 | opposite | `f6c5f7acb09d` |
| 288144035 | 0.140 | 0.000 | -0.140 | opposite | `5a6719085ad8` |
| 638353400 | 0.145 | 0.000 | -0.145 | opposite | `530541db8d21` |
| 3874895743 | 0.145 | 0.000 | -0.145 | opposite | `28ef52e63c76` |

0 of 8 untied seeds in the expected direction (increase), 8 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 1.0000 for the expected direction, p = 0.0039 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.143, mean treatment 0.000, mean paired difference **-0.143** (minimum effect 0.1 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 16: observed 16.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.1: observed -0.1435 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 1.0000 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.0039 — holds

Failure criterion triggered: F1. The hypothesis is not supported.

Registry run `V3D-EXP-0007-RUN-0001`: status **failed**, verdict **not_supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| echo_causation_tracking_error_cms | 0.529 | 0.564 | cm/s |
| echo_causation_prediction_error_cms | — | 0.493 | cm/s |
| echo_causation_attribution_accuracy | 0.143 | 0.000 | fraction |
| echo_causation_false_self_attribution | 0.411 | 0.000 | fraction |
| echo_causation_interval_coverage | — | 0.972 | fraction |
| echo_causation_detection_latency_s | — | — | s |
| echo_causation_recovery_latency_s | — | — | s |
| echo_causation_recall_error_cms | 0.000 | 0.000 | cm/s |
| echo_causation_recalls | 0.000 | 0.000 | count |
| echo_causation_adapted_actions | 0.000 | 18.625 | count |
| echo_causation_checkpoint_verified | 1.000 | 1.000 | fraction |

## Provenance

- Plan `7f388e66ef215b708823ee62de9e8b17a03da285688226fa56cafaa3443763e9`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0007 at 2026-10-25T17:22:24.220Z (receipt `73fda52eca5c0066036068274bdbc780321c918b4b1586281728a8511dec2b88`)
- Authorized at 2026-10-25T17:22:24.234Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `6a366bc8a31d45e1c3abcfd5a121b38907e5c67f456e9d02a8ffa7564f6acb62`
- Record `c0b8791c52fb64116519d96d5e3be4feb314fe25b3daa8fe9700989a8c71ffc5`, run `FR-244d1533011aaa1d0a7fdd51`, 2026-10-25T17:22:24.235Z to 2026-10-25T17:22:31.980Z
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
