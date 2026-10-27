# FLY-b91f00f331c06a0ad3884ba5: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Controller comparison: controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5), against controller configuration A (the default parameters).

**Question (host-written).** In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds?

**Hypothesis (host-written).** Controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with controller configuration A (the default parameters), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light. — competing: [scripted] Steering gain matters less than how often the fly flies, which both configurations share.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 379133866, 3508164491, 2510798789, 1274342525, 3730297846, 2493124184, 874778132, 3902988655, 3622448414, 3665105794, 4198805225, 3834871558.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 379133866 | 1.578 | 0.792 | -0.785 | expected | `b52ae1c5c26e` |
| 3508164491 | 1.923 | 1.704 | -0.219 | expected | `3562df85a50d` |
| 2510798789 | 0.930 | 0.913 | -0.017 | expected | `60eaf017ee2d` |
| 1274342525 | 1.637 | 1.637 | -0.000 | expected | `92195e9614af` |
| 3730297846 | 1.638 | 1.577 | -0.061 | expected | `0ed7992a36d6` |
| 2493124184 | 1.771 | 1.771 | 0.000 | tie | `847e664ce8eb` |
| 874778132 | 1.655 | 1.112 | -0.544 | expected | `9cfdabc0961f` |
| 3902988655 | 0.653 | 0.537 | -0.116 | expected | `14ac861e4a87` |
| 3622448414 | 1.389 | 1.398 | 0.008 | opposite | `4a94390f19e1` |
| 3665105794 | 1.626 | 1.568 | -0.057 | expected | `e6df2fad5269` |
| 4198805225 | 2.295 | 2.227 | -0.068 | expected | `18069b588e41` |
| 3834871558 | 1.835 | 1.838 | 0.003 | opposite | `688281c6b42a` |

9 of 11 untied seeds in the expected direction (decrease), 2 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 0.0327 for the expected direction, p = 0.9941 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.578, mean treatment 1.423, mean paired difference **-0.155** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 72: observed 72.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 11.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.1547 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0327 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9941 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0051-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.013 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.013 | 1/m |
| collision_episodes | 0.000 | 0.250 | count |
| near_miss_fraction | 0.033 | 0.058 | fraction |
| flown_m | 19.392 | 18.921 | m |
| saccades_per_flight_s | 0.564 | 0.578 | 1/s |
| contact_s | 0.000 | 0.001 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.090 | 0.090 | s |
| escape_latency_s | 0.910 | 0.910 | s |
| size_at_escape_deg | 53.249 | 53.249 | deg |
| short_mode_fraction | 0.083 | 0.083 | fraction |
| mean_light_distance_m | 1.578 | 1.423 | m |
| time_near_light | 0.121 | 0.221 | fraction |
| active_fraction | 0.317 | 0.317 | fraction |

## Provenance

- Plan `b91f00f331c06a0ad3884ba565cb8251f918a874a6c2f2acf6da1f0706b62321`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `8d86753f0ca7a7395da5a6b7f3902bd120428b515dc616340ef12e9ae0489eed`, source `86708015e47c271602b7856459ea1d6ff513ea0f1df0bb8587c3f192a417f022`
- Preregistered as V3D-EXP-0051 at 2026-10-26T23:27:12.643Z (receipt `0aed138f0a31080cd84e417822753b800be41cb7c6eb3ee9f1dc3eabf4b678d1`)
- Authorized at 2026-10-26T23:27:12.672Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `9948ec0fc671cc5d429ffb8654a008ffac884228330719f27e94f2dea590d54b`
- Record `67a33d8d61a187dc43af3ff7ac0484c5797e433d7c8864d991d05ad15bdc5b83`, run `FR-aa61fc292ec582dfe92fb48a`, 2026-10-26T23:27:12.675Z to 2026-10-26T23:27:26.228Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 6083.28 fly-seconds, then again for the determinism guard
- Code: commit `fb76ce5c5fc61f279bc5980bd1ea22863c0cdb8d`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
