# FLY-de3fff8bd8f36e1d2ced4bb0: FAILED (not supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-03: retained learning through time: experimental ECHO self-model (no_memory), against self-model reset at re-exposure.

**Caveat.** Scripted motor excitation and idealized local odometry in reduced-order walking. Causal inference can remain ambiguous; no biological motor-control, consciousness or durable identity claim.

**Question (host-written).** In the digital fly simulator, how does experimental ECHO self-model (no_memory) change early movement error on re-exposure, with retained versus reset self-model, against self-model reset at re-exposure on matched seeds?

**Hypothesis (host-written).** Experimental ECHO self-model (no_memory) will decrease echo_memory_recall_error_cms by at least 0.05 cm/s on average over 8 matched seeds drawn after preregistration, compared with self-model reset at re-exposure, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] The adaptive self-model improves the specified held-out simulator metric. — competing: [scripted] The baseline performs equally well or better; the mechanism adds no measurable value.

## Seeds

8 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 144289752, 2343669197, 2919251879, 3485204992, 2354133626, 3669270383, 3581745151, 2741875506.

## Primary metric: echo_memory_recall_error_cms (cm/s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 144289752 | 0.323 | 0.372 | 0.049 | opposite | `65b597d0c957` |
| 2343669197 | 0.325 | 0.368 | 0.043 | opposite | `294114361c0e` |
| 2919251879 | 0.326 | 0.378 | 0.051 | opposite | `61f3e7cb10bc` |
| 3485204992 | 0.322 | 0.364 | 0.042 | opposite | `df6fcca63e28` |
| 2354133626 | 0.323 | 0.361 | 0.037 | opposite | `9238f0e09ec5` |
| 3669270383 | 0.330 | 0.370 | 0.040 | opposite | `8a88a9ed2475` |
| 3581745151 | 0.322 | 0.365 | 0.043 | opposite | `3e6ac8721792` |
| 2741875506 | 0.320 | 0.365 | 0.045 | opposite | `f920c560d36e` |

0 of 8 untied seeds in the expected direction (decrease), 8 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 1.0000 for the expected direction, p = 0.0039 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.324, mean treatment 0.368, mean paired difference **0.044** (minimum effect 0.05 cm/s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 16: observed 16.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.05: observed 0.0437 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 1.0000 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.0039 — holds

Failure criterion triggered: F1. The hypothesis is not supported.

Registry run `V3D-EXP-0011-RUN-0001`: status **failed**, verdict **not_supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| echo_memory_tracking_error_cms | 0.192 | 0.192 | cm/s |
| echo_memory_prediction_error_cms | 0.029 | 0.029 | cm/s |
| echo_memory_attribution_accuracy | 0.996 | 0.996 | fraction |
| echo_memory_false_self_attribution | 0.000 | 0.000 | fraction |
| echo_memory_interval_coverage | 0.967 | 0.961 | fraction |
| echo_memory_detection_latency_s | 0.364 | 0.364 | s |
| echo_memory_recovery_latency_s | 1.173 | 1.256 | s |
| echo_memory_recall_error_cms | 0.324 | 0.368 | cm/s |
| echo_memory_recalls | 0.813 | 0.000 | count |
| echo_memory_adapted_actions | 152.656 | 318.938 | count |
| echo_memory_checkpoint_verified | 1.000 | 1.000 | fraction |

## Provenance

- Plan `de3fff8bd8f36e1d2ced4bb0313fd01d3a4d9ec461162db59d4faa6cbdba2d36`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0011 at 2026-10-25T17:23:48.851Z (receipt `b470866c206938a0e3ab61fdd5ac683bd48e9b2cc8c7afc1603f6b27e0430a74`)
- Authorized at 2026-10-25T17:23:48.874Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `c4549a4ec9c2481d9b583fbaeb0d4e3b64c1bde1897a803cc91db4d0b50c2031`
- Record `071f8e6fcbab8ad6ec6638a54ea9748907e15208b70564bb0c3c8b12f23146bd`, run `FR-c6b6240d16eca81de777c041`, 2026-10-25T17:23:48.875Z to 2026-10-25T17:24:02.186Z
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
