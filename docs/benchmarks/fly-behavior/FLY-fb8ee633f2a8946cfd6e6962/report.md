# FLY-fb8ee633f2a8946cfd6e6962: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/9 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-05: a second look at its own conclusions: the ECHO controller with the second look disabled (it commits to a conclusion at once), against the full ECHO self-model, which takes a second look before it commits, under the same hidden conditions.

**Caveat.** The second look was added after ECHO-02's published held-out results showed the fly overconfident on combined causes, so these conditions are not naive for it; its one parameter was set by a principle, never tuned on them (docs/PROJECT_ECHO.md). Its stated confidence is the Bayesian posterior over the fly's own explanations, a functional analogue of metacognitive monitoring (HOT-2), not a report of felt certainty. Its pilot found no seed count that passes with 0.9 probability, so the demonstration runs under-powered at the host's largest seed count and minimum effect.

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with the second look disabled (it commits to a conclusion at once) change mean Brier score of the fly's confidence in each explanation it concluded (0 is perfect), against the full ECHO self-model, which takes a second look before it commits, under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with the second look disabled (it commits to a conclusion at once) will increase attribution_brier by at least 0.2 score on average over 16 matched seeds drawn after preregistration, compared with the full ECHO self-model, which takes a second look before it commits, under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] A fly that commits to a conclusion at once has a higher Brier score on hidden held-out changes than one that takes a second look first. — competing: [scripted] The evidence that made the first answer likely also makes the second look agree, so it only delays the same answers.

## Seeds

16 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1557687129, 2333939793, 3261183190, 3543110835, 114180467, 2963482489, 3235136982, 2313549978, 3696589476, 2464343618, 4083087275, 3786381297, 4269447374, 3258261988, 2001332716, 3111467240.

## Primary metric: attribution_brier (score)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1557687129 | 0.000 | 0.003 | 0.002 | expected | `fb58df9e7fbe` |
| 2333939793 | 0.000 | 0.001 | 0.001 | expected | `b89e7d6b656e` |
| 3261183190 | 0.316 | 0.596 | 0.279 | expected | `2f5985129ff1` |
| 3543110835 | 0.000 | 0.000 | 0.000 | expected | `0e050fcac46f` |
| 114180467 | 0.540 | 0.515 | -0.025 | opposite | `854554dc97d9` |
| 2963482489 | 0.000 | 0.000 | 0.000 | expected | `0cd0d50a9f7f` |
| 3235136982 | 0.272 | 0.375 | 0.103 | expected | `6be91051e7d9` |
| 2313549978 | 0.240 | 0.242 | 0.002 | expected | `f54606b91cc1` |
| 3696589476 | 0.000 | 0.377 | 0.377 | expected | `2136f3be90f3` |
| 2464343618 | 0.000 | 0.003 | 0.002 | expected | `bcf26476138a` |
| 4083087275 | 0.132 | 0.271 | 0.139 | expected | `30997e45aae6` |
| 3786381297 | 0.000 | 0.002 | 0.001 | expected | `8b7bb0d1d311` |
| 4269447374 | 0.194 | 0.185 | -0.009 | opposite | `de2ade508852` |
| 3258261988 | 0.000 | 0.001 | 0.001 | expected | `e860746b6f01` |
| 2001332716 | 0.000 | 0.001 | 0.000 | expected | `6e247cb6f366` |
| 3111467240 | 0.000 | 0.001 | 0.001 | expected | `3981a413d5b6` |

14 of 16 untied seeds in the expected direction (increase), 2 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0021 for the expected direction, p = 0.9997 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.106, mean treatment 0.161, mean paired difference **0.055** (minimum effect 0.2 score).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 32: observed 32.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 16.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.2: observed 0.0547 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0021 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9997 — does not hold

Success criteria not all met (S1) and no failure criterion triggered.

Registry run `V3D-EXP-0011-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| attribution_accuracy | 0.893 | 0.836 | fraction |
| false_self_attribution | 0.000 | 0.000 | fraction |
| attribution_brier | 0.106 | 0.161 | score |
| attribution_path_error | 0.140 | 0.138 | fraction |
| missed_changes | 0.500 | 0.500 | count |
| misleading_sense_blamed_self | 0.167 | 0.000 | fraction |
| attribution_coverage_90 | 0.894 | 0.899 | fraction |

## Provenance

- Plan `fb8ee633f2a8946cfd6e6962349ba99cda0a76c2bb2da7169aec312f56597d1e`; fly `digital-fly/9 reduced-order-fsm/v1`, identity `5d8d3589513b67c3b784c7fcc76029b36d3478bb885568e6c79666e2bac6ec7b`, source `3a440f60616f2e78515dcf03a3cc689b54316140fb08d659c5310f63a4a83500`
- Preregistered as V3D-EXP-0011 at 2026-11-04T20:38:03.609Z (receipt `c8507ee645520c9fc4b93b61bc24a5fde517525e12e10e13331eef2646848751`)
- Authorized at 2026-11-04T20:38:03.650Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `bbaf17fa4bac819516b03b1224027dd0feccd42586ea81c53660a42c9bc50c73`
- Record `85098ee1e139d6839baa168c075726e48a8972c80103afe9205b1b6bd2f83e38`, run `FR-b9d17b5abb5c7657df2e708f`, 2026-11-04T20:38:03.651Z to 2026-11-04T20:38:20.717Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 5120 fly-seconds, then again for the determinism guard
- Code: commit `e458f7cb34904d85127779a3700c26b376ab4a80`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- The second look was added after ECHO-02's published held-out results showed the fly overconfident on combined causes, so these conditions are not naive for it; its one parameter was set by a principle, never tuned on them (docs/PROJECT_ECHO.md). Its stated confidence is the Bayesian posterior over the fly's own explanations, a functional analogue of metacognitive monitoring (HOT-2), not a report of felt certainty. Its pilot found no seed count that passes with 0.9 probability, so the demonstration runs under-powered at the host's largest seed count and minimum effect.
- The ECHO self-model is a computational model of the fly's own sensorimotor gains, built over the reduced-order body. Its compensation acts on abstract movement gains of that body; it is not validated biological motor control, and FlyBody's physics does not run.
- The perturbations are the experimenter's models of an impairment, a push, a turning surface, a sensor fault and an obstacle, applied by the simulator. The fly is never given their labels, causes or schedule; it meets only their consequences through its self-motion sense, its touch and its legs' stepping.
- The conditions are the held-out evaluation set, in an arena the self-model was not developed in; its constants were chosen on the development set alone and frozen before evaluation.
- A measurement of prediction, attribution or retention describes a functional self-model in a simulator. It is not evidence of awareness or subjective experience.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
