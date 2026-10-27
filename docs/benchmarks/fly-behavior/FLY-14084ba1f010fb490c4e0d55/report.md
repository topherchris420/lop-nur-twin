# FLY-14084ba1f010fb490c4e0d55: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** ECHO-04: attention, a workspace and a model of it: the ECHO controller with workspace disabled (each process acts on its own, nothing is broadcast, and so no attention schema), against the full ECHO self-model, with its workspace and its model of its own attention, under the same hidden conditions.

**Caveat.** The workspace, its broadcast and the attention schema are functional analogues of indicator properties (GWT-1 to GWT-4 and AST-1 of Butlin, Long et al. 2023) in a few lines of arithmetic: a result here says what they do for this simulated fly, never that it is aware of anything. The block's urge rates are set high so that urges meet the fly's inquiries often enough to measure; in the development runs the attention schema rarely changed what the fly did. Its pilot found no seed count that passes with 0.9 probability, so the demonstration runs under-powered at the host's largest seed count and minimum effect.

**Question (host-written).** In the digital fly simulator, how does the ECHO controller with workspace disabled (each process acts on its own, nothing is broadcast, and so no attention schema) change time from the hidden impairment's onset to the fly's first concluding that it changed itself; a fly that never does counts the rest of the run (undefined without a self-model), against the full ECHO self-model, with its workspace and its model of its own attention, under the same hidden conditions on matched seeds?

**Hypothesis (host-written).** The ECHO controller with workspace disabled (each process acts on its own, nothing is broadcast, and so no attention schema) will increase busy_attribution_latency_s by at least 30 s on average over 16 matched seeds drawn after preregistration, compared with the full ECHO self-model, with its workspace and its model of its own attention, under the same hidden conditions, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Without its workspace, a fly that often takes off and grooms takes longer to conclude that it changed itself after a hidden held-out impairment than with it. — competing: [scripted] Its inquiry gets the evidence it needs whenever the fly walks, whatever else the fly does, so a workspace changes nothing.

## Seeds

16 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 219312988, 154088924, 3998814995, 2428346525, 2931571752, 1703743273, 385883071, 2650963109, 3383027115, 3443059251, 131578279, 3240045113, 1619810568, 329675212, 2936799593, 304337392.

## Primary metric: busy_attribution_latency_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 219312988 | 3.200 | 3.200 | 0.000 | tie | `913703721bdb` |
| 154088924 | 4.300 | 4.300 | 0.000 | tie | `347369ef2ce8` |
| 3998814995 | 8.450 | 8.450 | 0.000 | tie | `5bedc2563034` |
| 2428346525 | 5.700 | 5.700 | 0.000 | tie | `76ed6afb927d` |
| 2931571752 | 81.450 | 81.450 | 0.000 | tie | `c00d17f2083d` |
| 1703743273 | 2.700 | 2.700 | 0.000 | tie | `b86e11892824` |
| 385883071 | 5.500 | 5.500 | 0.000 | tie | `8f5cc0804b6b` |
| 2650963109 | 3.200 | 3.200 | 0.000 | tie | `ae6f74b3ca53` |
| 3383027115 | 15.600 | 15.600 | 0.000 | tie | `fff5670cb81b` |
| 3443059251 | 18.700 | 18.750 | 0.050 | expected | `4eaeefed3623` |
| 131578279 | 15.450 | 15.450 | 0.000 | tie | `7fdfa8c6b23e` |
| 3240045113 | 18.500 | 18.400 | -0.100 | opposite | `ff6b34ac97c4` |
| 1619810568 | 83.350 | 71.850 | -11.500 | opposite | `0524a488fe5e` |
| 329675212 | 4.300 | 4.300 | 0.000 | tie | `fa6c6e0ff7fa` |
| 2936799593 | 11.750 | 12.550 | 0.800 | expected | `8cf750e6f99b` |
| 304337392 | 10.050 | 9.800 | -0.250 | opposite | `2e883421e3c3` |

2 of 5 untied seeds in the expected direction (increase), 3 opposite, 11 tied, 0 undefined. Exact one-sided sign test: p = 0.8125 for the expected direction, p = 0.5000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 18.263, mean treatment 17.575, mean paired difference **-0.688** (minimum effect 30 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 32: observed 32.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 5.0000 — does not hold
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 30: observed -0.6875 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.8125 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.5000 — does not hold

Evidence-sufficiency guard(s) not met: G4. No conclusion drawn.

Registry run `V3D-EXP-0064-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| busy_attribution_latency_s | 18.263 | 17.575 | s |
| busy_identification_error | 0.027 | 0.040 | fraction |
| busy_impaired_path_error | 0.030 | 0.084 | fraction |

## Provenance

- Plan `14084ba1f010fb490c4e0d55da78b24c29e7d80f50e48b95edcbf75c475e1a37`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `c684a7f0002390bee7e62d529bc459479c35e45465749ad174bd99aca71a5f8a`, source `a96a496c4c00acead32e208158faf7889c31027b8dccde781059a4eb4481f70b`
- Preregistered as V3D-EXP-0064 at 2026-10-27T04:22:12.852Z (receipt `db907b521c4336203f807c4997347db40e4dff153a029d92d637afb225b3b14f`)
- Authorized at 2026-10-27T04:22:13.005Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `618d97f4e36e8a727db1e9702284f35386ab92d0c2d50b5fb543ecd3fdfba7b8`
- Record `b0b0e289383eb7a8724432a600e6ab0b7867408e988c6511e75e2ec21c1d23cf`, run `FR-ac4c89b4ce8a21b5a12d3181`, 2026-10-27T04:22:13.011Z to 2026-10-27T04:23:00.876Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 3840 fly-seconds, then again for the determinism guard
- Code: commit `352fafda07d29c0d7f4f412073dc129fc5ac7a63`
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
