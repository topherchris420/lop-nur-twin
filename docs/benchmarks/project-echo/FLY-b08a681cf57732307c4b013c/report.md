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

8 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1335137948, 3418596010, 464321247, 2483464944, 429575863, 3488844847, 1604846408, 3093820523.

## Primary metric: echo_impairment_tracking_error_cms (cm/s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1335137948 | 0.427 | 0.192 | -0.234 | expected | `e352f5d795d5` |
| 3418596010 | 0.429 | 0.194 | -0.235 | expected | `dfe29633f3a6` |
| 464321247 | 0.432 | 0.196 | -0.236 | expected | `0a5b664bb82d` |
| 2483464944 | 0.426 | 0.190 | -0.236 | expected | `18d1e09b8199` |
| 429575863 | 0.428 | 0.195 | -0.232 | expected | `2e21b7c28ac5` |
| 3488844847 | 0.434 | 0.196 | -0.237 | expected | `1b786b0d14f1` |
| 1604846408 | 0.432 | 0.189 | -0.243 | expected | `93d8e7ba4b97` |
| 3093820523 | 0.430 | 0.194 | -0.236 | expected | `496d2f356ba9` |

8 of 8 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0039 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.430, mean treatment 0.193, mean paired difference **-0.236** (minimum effect 0.1 cm/s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 16: observed 16.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 8.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.2363 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0039 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0001-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| echo_impairment_tracking_error_cms | 0.430 | 0.193 | cm/s |
| echo_impairment_prediction_error_cms | — | 0.031 | cm/s |
| echo_impairment_attribution_accuracy | 0.643 | 0.986 | fraction |
| echo_impairment_false_self_attribution | 0.000 | 0.000 | fraction |
| echo_impairment_interval_coverage | — | 0.956 | fraction |
| echo_impairment_detection_latency_s | — | 0.344 | s |
| echo_impairment_recovery_latency_s | — | 1.180 | s |
| echo_impairment_recall_error_cms | 0.000 | 0.000 | cm/s |
| echo_impairment_recalls | 0.000 | 2.531 | count |
| echo_impairment_adapted_actions | 0.000 | 164.688 | count |
| echo_impairment_checkpoint_verified | 1.000 | 1.000 | fraction |

## Provenance

- Plan `b08a681cf57732307c4b013c8453727e26e519f5948b55aa6150669033a5175f`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0001 at 2026-10-25T17:19:45.716Z (receipt `a02528125968c3eb2e42fbf795837e830924c409192fa8762debc21085659720`)
- Authorized at 2026-10-25T17:19:45.772Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `d78a2d658aca8ea61033b214d1ed07db89370fbda703cbb386729c6f7b338a66`
- Record `dd3c33c4d922fd6078fda88b28ad6e93682e996c1741729ecc9ba33d00e738b7`, run `FR-e3dd7f4120998e0a5dc66a27`, 2026-10-25T17:19:45.780Z to 2026-10-25T17:19:57.490Z
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
