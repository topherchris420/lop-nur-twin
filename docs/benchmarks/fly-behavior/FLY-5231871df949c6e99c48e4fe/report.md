# FLY-5231871df949c6e99c48e4fe: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/9 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-04: attention, a workspace and a model of it: the ECHO controller with workspace disabled (each process acts on its own, nothing is broadcast, and so no attention schema), against the full ECHO self-model, with its workspace and its model of its own attention, under the same hidden conditions.

**Caveat.** The workspace, its broadcast and the attention schema are functional analogues of indicator properties (GWT-1 to GWT-4 and AST-1 of Butlin, Long et al. 2023) in a few lines of arithmetic: a result here says what they do for this simulated fly, never that it is aware of anything. The block's urge rates are set high so that urges meet the fly's inquiries often enough to measure; in the development runs the attention schema rarely changed what the fly did. Its pilot found no seed count that passes with 0.9 probability, so the demonstration runs under-powered at the host's largest seed count and minimum effect.

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with workspace disabled (each process acts on its own, nothing is broadcast, and so no attention schema) change time from the hidden impairment's onset to the fly's first concluding that it changed itself; a fly that never does counts the rest of the run (undefined without a self-model), against the full ECHO self-model, with its workspace and its model of its own attention, under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with workspace disabled (each process acts on its own, nothing is broadcast, and so no attention schema) will increase busy_attribution_latency_s by at least 30 s on average over 16 matched seeds drawn after preregistration, compared with the full ECHO self-model, with its workspace and its model of its own attention, under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Without its workspace, a fly that often takes off and grooms takes longer to conclude that it changed itself after a hidden held-out impairment than with it. — competing: [scripted] Its inquiry gets the evidence it needs whenever the fly walks, whatever else the fly does, so a workspace changes nothing.

## Seeds

16 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2476011013, 4010696436, 3823808214, 1072064404, 2403329205, 1833309983, 689607816, 3378140501, 777431224, 1019523516, 2074205312, 3067763666, 2602553151, 2582423778, 229028341, 2308322034.

## Primary metric: busy_attribution_latency_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2476011013 | 14.050 | 14.050 | 0.000 | tie | `2bcade36c9df` |
| 4010696436 | 16.300 | 16.300 | 0.000 | tie | `095f3a54e146` |
| 3823808214 | 5.150 | 5.150 | 0.000 | tie | `ab496e0cd6d9` |
| 1072064404 | 20.350 | 20.350 | 0.000 | tie | `9e326d5773bd` |
| 2403329205 | 18.650 | 18.650 | 0.000 | tie | `0badd5f02ca6` |
| 1833309983 | 13.100 | 13.100 | 0.000 | tie | `dffdb21fbbf0` |
| 689607816 | 6.550 | 6.550 | 0.000 | tie | `d69500a032fd` |
| 3378140501 | 3.100 | 8.000 | 4.900 | expected | `5236d4db4896` |
| 777431224 | 87.100 | 87.100 | 0.000 | tie | `c14986a63d6f` |
| 1019523516 | 23.600 | 25.450 | 1.850 | expected | `24a4c19f0cd2` |
| 2074205312 | 7.550 | 7.550 | 0.000 | tie | `63eb8f8eed0f` |
| 3067763666 | 16.600 | 16.650 | 0.050 | expected | `d83a6df18126` |
| 2602553151 | 6.450 | 6.450 | 0.000 | tie | `64e5ae798bdb` |
| 2582423778 | 6.550 | 6.550 | 0.000 | tie | `9b2a81abf03f` |
| 229028341 | 10.800 | 15.650 | 4.850 | expected | `60f8ef640d0c` |
| 2308322034 | 18.650 | 18.650 | 0.000 | tie | `0798eb822995` |

4 of 4 untied seeds in the expected direction (increase), 0 opposite, 12 tied, 0 undefined. Exact one-sided sign test: p = 0.0625 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 17.159, mean treatment 17.887, mean paired difference **0.728** (minimum effect 30 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 32: observed 32.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 4.0000 — does not hold
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 30: observed 0.7281 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0625 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

Evidence-sufficiency guard(s) not met: G4. No conclusion drawn.

Registry run `V3D-EXP-0010-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| busy_attribution_latency_s | 17.159 | 17.887 | s |
| busy_identification_error | 0.021 | 0.024 | fraction |
| busy_impaired_path_error | 0.135 | 0.103 | fraction |

## Provenance

- Plan `5231871df949c6e99c48e4fefe31bdfaabb00caa139a52df8096a328d0ddbe30`; fly `digital-fly/9 reduced-order-fsm/v1`, identity `5d8d3589513b67c3b784c7fcc76029b36d3478bb885568e6c79666e2bac6ec7b`, source `3a440f60616f2e78515dcf03a3cc689b54316140fb08d659c5310f63a4a83500`
- Preregistered as V3D-EXP-0010 at 2026-11-04T20:37:19.586Z (receipt `027b81e91b7e6429c2f616aaa9f8ce0baa37844bd3ea2ffda92793cf0d93b0f8`)
- Authorized at 2026-11-04T20:37:19.620Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `16e63204f4f6a299fae2864b782d2d21fa74b420d1962e2146b0a7714030c517`
- Record `958a3faa4d60e9f87b54e7add4c504b554d637d57dbf46531dfe7acd1d0a1ea3`, run `FR-098941c2d7e4e87eae4879bf`, 2026-11-04T20:37:19.622Z to 2026-11-04T20:37:34.021Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 3840 fly-seconds, then again for the determinism guard
- Code: commit `e458f7cb34904d85127779a3700c26b376ab4a80`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- The workspace, its broadcast and the attention schema are functional analogues of indicator properties (GWT-1 to GWT-4 and AST-1 of Butlin, Long et al. 2023) in a few lines of arithmetic: a result here says what they do for this simulated fly, never that it is aware of anything. The block's urge rates are set high so that urges meet the fly's inquiries often enough to measure; in the development runs the attention schema rarely changed what the fly did. Its pilot found no seed count that passes with 0.9 probability, so the demonstration runs under-powered at the host's largest seed count and minimum effect.
- The ECHO self-model is a computational model of the fly's own sensorimotor gains, built over the reduced-order body. Its compensation acts on abstract movement gains of that body; it is not validated biological motor control, and FlyBody's physics does not run.
- The perturbations are the experimenter's models of an impairment, a push, a turning surface, a sensor fault and an obstacle, applied by the simulator. The fly is never given their labels, causes or schedule; it meets only their consequences through its self-motion sense, its touch and its legs' stepping.
- The conditions are the held-out evaluation set, in an arena the self-model was not developed in; its constants were chosen on the development set alone and frozen before evaluation.
- A measurement of prediction, attribution or retention describes a functional self-model in a simulator. It is not evidence of awareness or subjective experience.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
