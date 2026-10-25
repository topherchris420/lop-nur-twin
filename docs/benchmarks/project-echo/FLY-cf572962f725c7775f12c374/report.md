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

8 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2832889622, 1950300696, 1847848616, 629427725, 1556482225, 2442466267, 2945185056, 4192913145.

## Primary metric: echo_causation_attribution_accuracy (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2832889622 | 0.140 | 0.779 | 0.638 | expected | `c1d1d5500016` |
| 1950300696 | 0.140 | 0.733 | 0.593 | expected | `47a418a5fca3` |
| 1847848616 | 0.140 | 0.810 | 0.669 | expected | `935abba1227f` |
| 629427725 | 0.145 | 0.757 | 0.612 | expected | `76ba38fedc86` |
| 1556482225 | 0.140 | 0.833 | 0.693 | expected | `ab77282d7ced` |
| 2442466267 | 0.145 | 0.833 | 0.688 | expected | `dff4f096067c` |
| 2945185056 | 0.140 | 0.833 | 0.693 | expected | `5efd22f71e16` |
| 4192913145 | 0.140 | 0.757 | 0.617 | expected | `1a780e399774` |

8 of 8 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0039 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.142, mean treatment 0.792, mean paired difference **0.650** (minimum effect 0.1 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 16: observed 16.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.1: observed 0.6503 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0039 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0002-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| echo_causation_tracking_error_cms | 0.523 | 0.462 | cm/s |
| echo_causation_prediction_error_cms | — | 0.172 | cm/s |
| echo_causation_attribution_accuracy | 0.142 | 0.792 | fraction |
| echo_causation_false_self_attribution | 0.409 | 0.000 | fraction |
| echo_causation_interval_coverage | — | 0.960 | fraction |
| echo_causation_detection_latency_s | — | 0.386 | s |
| echo_causation_recovery_latency_s | — | 0.868 | s |
| echo_causation_recall_error_cms | 0.000 | 0.000 | cm/s |
| echo_causation_recalls | 0.000 | 1.667 | count |
| echo_causation_adapted_actions | 0.000 | 156.833 | count |
| echo_causation_checkpoint_verified | 1.000 | 1.000 | fraction |

## Provenance

- Plan `cf572962f725c7775f12c3748a284ac34bcb4cb498ebde02314fbcf38df4b7e2`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0002 at 2026-10-25T17:20:11.010Z (receipt `79ea3dee0219d05728d6583481568d1065250feb708d94aefad73d5ecd5cf99b`)
- Authorized at 2026-10-25T17:20:11.023Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `b823a1ca7184dd2928f26563b9c8d06995295315ecced80ff70a2670125a60ab`
- Record `78b7512d2fa874f6d1d0b76b43a617c1d13e27336bb8f73105822409cb5e3799`, run `FR-3a6beda3c54500c90aa1ab08`, 2026-10-25T17:20:11.025Z to 2026-10-25T17:20:31.384Z
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
