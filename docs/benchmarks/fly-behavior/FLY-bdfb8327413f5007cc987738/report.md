# FLY-bdfb8327413f5007cc987738: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-05: a second look at its own conclusions: the ECHO controller with the second look disabled (it commits to a conclusion at once), against the full ECHO self-model, which takes a second look before it commits, under the same hidden conditions.

**Caveat.** The second look was added after ECHO-02's published held-out results showed the fly overconfident on combined causes, so these conditions are not naive for it; its one parameter was set by a principle, never tuned on them (docs/PROJECT_ECHO.md). Its stated confidence is the Bayesian posterior over the fly's own explanations, a functional analogue of metacognitive monitoring (HOT-2), not a report of felt certainty. Its pilot found no seed count that passes with 0.9 probability, so the demonstration runs under-powered at the host's largest seed count and minimum effect.

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with the second look disabled (it commits to a conclusion at once) change mean Brier score of the fly's confidence in each explanation it concluded (0 is perfect), against the full ECHO self-model, which takes a second look before it commits, under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with the second look disabled (it commits to a conclusion at once) will increase attribution_brier by at least 0.2 score on average over 16 matched seeds drawn after preregistration, compared with the full ECHO self-model, which takes a second look before it commits, under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] A fly that commits to a conclusion at once has a higher Brier score on hidden held-out changes than one that takes a second look first. — competing: [scripted] The evidence that made the first answer likely also makes the second look agree, so it only delays the same answers.

## Seeds

16 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2064263237, 4078498803, 1644147564, 3956172442, 3957190556, 2559486845, 630671210, 1206833684, 47811617, 2428455015, 3117406293, 990944272, 1864709961, 3822924554, 1721107659, 1405362339.

## Primary metric: attribution_brier (score)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2064263237 | 0.273 | 0.492 | 0.219 | expected | `71d9ac5d496f` |
| 4078498803 | 0.000 | 0.002 | 0.002 | expected | `a1f3cbb62ac8` |
| 1644147564 | 0.000 | 0.000 | 0.000 | expected | `3980f5eca50c` |
| 3956172442 | 0.001 | 0.003 | 0.002 | expected | `1942cbd436e4` |
| 3957190556 | 0.001 | 0.001 | 0.000 | expected | `3fffda013012` |
| 2559486845 | 0.000 | 0.004 | 0.003 | expected | `da87eb479605` |
| 630671210 | 0.250 | 0.000 | -0.250 | opposite | `10282ef0d628` |
| 1206833684 | 0.000 | 0.000 | -0.000 | opposite | `1e9dce1f93e1` |
| 47811617 | 0.192 | 0.331 | 0.138 | expected | `08a58b98568d` |
| 2428455015 | 0.000 | 0.126 | 0.126 | expected | `f06e69c887ce` |
| 3117406293 | 0.000 | 0.246 | 0.246 | expected | `71d224c15286` |
| 990944272 | 0.001 | 0.000 | -0.001 | opposite | `40a2e56d7e38` |
| 1864709961 | 0.486 | 0.457 | -0.029 | opposite | `0578bdaf3603` |
| 3822924554 | 0.140 | 0.242 | 0.102 | expected | `776163601699` |
| 1721107659 | 0.000 | 0.000 | 0.000 | expected | `fc38570db2aa` |
| 1405362339 | 0.246 | 0.206 | -0.041 | opposite | `487e19226ad2` |

11 of 16 untied seeds in the expected direction (increase), 5 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.1051 for the expected direction, p = 0.9616 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.099, mean treatment 0.132, mean paired difference **0.032** (minimum effect 0.2 score).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 32: observed 32.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 16.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.2: observed 0.0324 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.1051 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.9616 — does not hold

Success criteria not all met (S1, S2) and no failure criterion triggered.

Registry run `V3D-EXP-0065-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| attribution_accuracy | 0.902 | 0.853 | fraction |
| false_self_attribution | 0.045 | 0.023 | fraction |
| attribution_brier | 0.099 | 0.132 | score |
| attribution_path_error | 0.102 | 0.102 | fraction |
| missed_changes | 0.688 | 0.688 | count |
| misleading_sense_blamed_self | 0.000 | 0.000 | fraction |
| attribution_coverage_90 | 0.890 | 0.894 | fraction |

## Provenance

- Plan `bdfb8327413f5007cc987738ef78cf86b6615521e6d8f3b82d232ee23d0a3aab`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `c684a7f0002390bee7e62d529bc459479c35e45465749ad174bd99aca71a5f8a`, source `a96a496c4c00acead32e208158faf7889c31027b8dccde781059a4eb4481f70b`
- Preregistered as V3D-EXP-0065 at 2026-10-27T04:24:05.115Z (receipt `836962c2c5ed68a07a01094719107d2735404938fa25107056276a7070bc3e39`)
- Authorized at 2026-10-27T04:24:05.250Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `764f16c3f6852e88d657ac0c3fa5b0d70a358bc8a97bbfcdd59c0793f0c12d4f`
- Record `7350bde62c6e52c6282c2f278a320df5d8cfaadc36b67bdd170388db23f80ba7`, run `FR-cbd678cf7d4f93262889f402`, 2026-10-27T04:24:05.255Z to 2026-10-27T04:25:11.754Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 5120 fly-seconds, then again for the determinism guard
- Code: commit `352fafda07d29c0d7f4f412073dc129fc5ac7a63`
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
