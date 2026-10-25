# FLY-a1e90fba74191fc20d2b25ba: FAILED (not supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-01: recognition of bodily impairment: experimental ECHO self-model (no_learning), against the same motor probe with its self-model disabled.

**Caveat.** Scripted motor excitation and idealized local odometry in reduced-order walking. Causal inference can remain ambiguous; no biological motor-control, consciousness or durable identity claim.

**Question (host-written).** In the digital fly simulator, how does experimental ECHO self-model (no_learning) change mean absolute target movement error after adaptation, against the same motor probe with its self-model disabled on matched seeds?

**Hypothesis (host-written).** Experimental ECHO self-model (no_learning) will decrease echo_impairment_tracking_error_cms by at least 0.1 cm/s on average over 8 matched seeds drawn after preregistration, compared with the same motor probe with its self-model disabled, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] The adaptive self-model improves the specified held-out simulator metric. — competing: [scripted] The baseline performs equally well or better; the mechanism adds no measurable value.

## Seeds

8 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2622861999, 2556491565, 3186635130, 2359684495, 78748380, 1569972106, 2074559928, 1684361341.

## Primary metric: echo_impairment_tracking_error_cms (cm/s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2622861999 | 0.430 | 0.430 | 0.000 | opposite | `a48b882c4a88` |
| 2556491565 | 0.433 | 0.433 | 0.000 | opposite | `761108eec411` |
| 3186635130 | 0.428 | 0.428 | 0.000 | opposite | `054d67e9dde7` |
| 2359684495 | 0.430 | 0.430 | 0.000 | opposite | `066c490fbcff` |
| 78748380 | 0.428 | 0.428 | 0.000 | opposite | `fd9dc98a8cc9` |
| 1569972106 | 0.429 | 0.429 | 0.000 | opposite | `74d9e67d363e` |
| 2074559928 | 0.433 | 0.433 | 0.000 | opposite | `306c361de497` |
| 1684361341 | 0.428 | 0.428 | 0.000 | opposite | `da703d980cc7` |

0 of 8 untied seeds in the expected direction (decrease), 8 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 1.0000 for the expected direction, p = 0.0039 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.430, mean treatment 0.430, mean paired difference **0.000** (minimum effect 0.1 cm/s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 16: observed 16.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed 0.0000 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 1.0000 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.0039 — holds

Failure criterion triggered: F1. The hypothesis is not supported.

Registry run `V3D-EXP-0004-RUN-0001`: status **failed**, verdict **not_supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| echo_impairment_tracking_error_cms | 0.430 | 0.430 | cm/s |
| echo_impairment_prediction_error_cms | — | 0.423 | cm/s |
| echo_impairment_attribution_accuracy | 0.642 | 0.000 | fraction |
| echo_impairment_false_self_attribution | 0.000 | 0.000 | fraction |
| echo_impairment_interval_coverage | — | 0.974 | fraction |
| echo_impairment_detection_latency_s | — | — | s |
| echo_impairment_recovery_latency_s | — | — | s |
| echo_impairment_recall_error_cms | 0.000 | 0.000 | cm/s |
| echo_impairment_recalls | 0.000 | 0.000 | count |
| echo_impairment_adapted_actions | 0.000 | 2.625 | count |
| echo_impairment_checkpoint_verified | 1.000 | 1.000 | fraction |

## Provenance

- Plan `a1e90fba74191fc20d2b25ba33eefd857f0a710d2a35a7f8d7eeb54c2ad6a5b5`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0004 at 2026-10-25T17:21:42.955Z (receipt `d810d3afed0c32246396ecece1e5838a750598e5a08e20efb8004856ac596d36`)
- Authorized at 2026-10-25T17:21:42.966Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `7bf9c7c14b67f3712646ce6735cf9dc6f54378302f60df63b6b5d20b08424a06`
- Record `b5cf20589726f7963b4588933382735f94534d538ef9a601b9976547b3089f66`, run `FR-53b337356e547fe188df6e1f`, 2026-10-25T17:21:42.966Z to 2026-10-25T17:21:49.397Z
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
