# FLY-5c56d509b90d57a223a43b8f: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Light preference: a point light of relative intensity 2 above one quadrant of the arena, against no point light (ambient only).

**Question (host-written).** In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds?

**Hypothesis (host-written).** A point light of relative intensity 2 above one quadrant of the arena will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with no point light (ambient only), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] With a point light on, the fly's mean horizontal distance to the point below it falls. — competing: [scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 873157543, 3428348870, 2522703069, 4104330494, 1465404359, 2153690317, 2888176133, 396013537, 3300958204, 3993578345, 915144370, 3257107573.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 873157543 | 1.275 | 1.032 | -0.244 | expected | `14fa6c8c6949` |
| 3428348870 | 1.480 | 2.692 | 1.212 | opposite | `b74d0caaabd1` |
| 2522703069 | 1.472 | 0.839 | -0.633 | expected | `96bbcc23cb08` |
| 4104330494 | 1.685 | 0.724 | -0.961 | expected | `b2fccb8e1ba2` |
| 1465404359 | 1.282 | 0.742 | -0.541 | expected | `c1aa2d2f33c7` |
| 2153690317 | 1.913 | 1.721 | -0.193 | expected | `5bfe5f6f0ba7` |
| 2888176133 | 1.613 | 1.870 | 0.258 | opposite | `af54ed46e4ea` |
| 396013537 | 1.097 | 0.751 | -0.346 | expected | `4a3212ba8287` |
| 3300958204 | 1.793 | 2.316 | 0.523 | opposite | `839e8d0ff47e` |
| 3993578345 | 1.399 | 1.194 | -0.205 | expected | `5e42ec27e028` |
| 915144370 | 2.200 | 1.852 | -0.348 | expected | `cb902efa0c83` |
| 3257107573 | 1.906 | 1.982 | 0.075 | opposite | `d33a3409c328` |

8 of 12 untied seeds in the expected direction (decrease), 4 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.1938 for the expected direction, p = 0.9270 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.593, mean treatment 1.476, mean paired difference **-0.117** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.1168 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.1938 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.9270 — does not hold

Success criteria not all met (S2) and no failure criterion triggered.

Registry run `V3D-EXP-0038-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| mean_light_distance_m | 1.593 | 1.476 | m |
| time_near_light | 0.000 | 0.273 | fraction |
| active_fraction | 0.189 | 0.390 | fraction |

## Provenance

- Plan `5c56d509b90d57a223a43b8f12cfdeaeee452272383c69dfb2499aade54bf462`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `e2eb5e95c355777d19a210820fb203fc9ef47608031b98fa85882280e85cfdca`, source `daad49019246c38c2673cd442ecaae50eba95994635676bdc333b5563cebfb78`
- Preregistered as V3D-EXP-0038 at 2026-10-26T20:14:53.319Z (receipt `adc03d65743722a6c14b91315d0a629937ad2d561499501b1b068a905bc0c0a9`)
- Authorized at 2026-10-26T20:14:53.345Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `969de7cc26eff4faec413f29dd47880fefa4a247382c769138d26c65a11c84bd`
- Record `67bef95ef49583cd2bc5b5ea3b8d967b6581ba9843d82fd5d762f2692a17fd0f`, run `FR-2a685e522f9623905286abe7`, 2026-10-26T20:14:53.346Z to 2026-10-26T20:14:56.746Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2880 fly-seconds, then again for the determinism guard
- Code: commit `379fb9debfbd203f99d6c76ac80097706945dd2d`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
