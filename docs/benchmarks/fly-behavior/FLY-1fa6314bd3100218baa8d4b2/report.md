# FLY-1fa6314bd3100218baa8d4b2: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Light preference: a point light of relative intensity 2 above one quadrant of the arena, against no point light (ambient only).

**Question (host-written).** In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds?

**Hypothesis (host-written).** A point light of relative intensity 2 above one quadrant of the arena will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with no point light (ambient only), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] With a point light on, the fly's mean horizontal distance to the point below it falls. — competing: [scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 4165864896, 1762987282, 276610854, 627522384, 2417557962, 2656610500, 2539920483, 2589880268, 595165825, 2912942681, 1034553253, 1081383254.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 4165864896 | 1.559 | 1.375 | -0.184 | expected | `64eae4445a83` |
| 1762987282 | 1.322 | 1.322 | 0.000 | opposite | `b13bd9a8e75b` |
| 276610854 | 1.480 | 0.956 | -0.523 | expected | `cdab34d29d22` |
| 627522384 | 1.928 | 1.583 | -0.345 | expected | `b25edaee0cfb` |
| 2417557962 | 1.604 | 1.406 | -0.198 | expected | `094e5ebbd838` |
| 2656610500 | 1.721 | 1.667 | -0.055 | expected | `5c80e51c70f8` |
| 2539920483 | 1.407 | 1.404 | -0.004 | expected | `fb4b6d3c535b` |
| 2589880268 | 2.680 | 1.303 | -1.377 | expected | `d96b5344ce83` |
| 595165825 | 1.419 | 1.412 | -0.008 | expected | `96a70e05d5c1` |
| 2912942681 | 1.287 | 1.285 | -0.001 | expected | `9d42a6b6768c` |
| 1034553253 | 1.195 | 1.178 | -0.017 | expected | `ef1d8b113e43` |
| 1081383254 | 1.734 | 1.513 | -0.221 | expected | `739e6c5d0018` |

11 of 12 untied seeds in the expected direction (decrease), 1 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0032 for the expected direction, p = 0.9998 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.611, mean treatment 1.367, mean paired difference **-0.244** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.2444 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0032 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9998 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0056-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| mean_light_distance_m | 1.611 | 1.367 | m |
| time_near_light | 0.001 | 0.072 | fraction |
| active_fraction | 0.200 | 0.301 | fraction |

## Provenance

- Plan `1fa6314bd3100218baa8d4b2123acf3a40f0c3bf9fcddb2b63abf19d656686ec`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `c684a7f0002390bee7e62d529bc459479c35e45465749ad174bd99aca71a5f8a`, source `a96a496c4c00acead32e208158faf7889c31027b8dccde781059a4eb4481f70b`
- Preregistered as V3D-EXP-0056 at 2026-10-27T04:09:04.751Z (receipt `778c2d4e41097ee125816c54407f962990c339289c6c424e516e3f08de1f904f`)
- Authorized at 2026-10-27T04:09:04.879Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `9a53b55722a5a12b46f7c190a462a8845a79ff051d4579c4d607aa21b8c1cd0a`
- Record `270f977754437bc56bd5cf3586dded83972518a0fb999421a2b4fa048c83c15b`, run `FR-b5ac42fc020c60696f6456f7`, 2026-10-27T04:09:04.884Z to 2026-10-27T04:09:18.020Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2880 fly-seconds, then again for the determinism guard
- Code: commit `352fafda07d29c0d7f4f412073dc129fc5ac7a63`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
