# FLY-86a2164db13ac720c8cda2c8: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/3 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Controller comparison: controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5), against controller configuration A (the default parameters).

**Question (host-written).** In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds?

**Hypothesis (host-written).** Controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with controller configuration A (the default parameters), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light. — competing: [scripted] Steering gain matters less than how often the fly flies, which both configurations share.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1502996338, 4163928198, 1329137807, 62708606, 1516795026, 454918285, 156630961, 3472796251, 3562692797, 3086371616, 281907316, 833376628.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1502996338 | 0.613 | 0.610 | -0.003 | expected | `a70e8c495c06` |
| 4163928198 | 0.757 | 0.370 | -0.387 | expected | `4a85bed8b263` |
| 1329137807 | 0.276 | 0.250 | -0.026 | expected | `b2a3bfc24d21` |
| 62708606 | 1.412 | 1.430 | 0.018 | opposite | `c45ac724653f` |
| 1516795026 | 1.941 | 1.445 | -0.496 | expected | `1bd6ef6b6832` |
| 454918285 | 1.794 | 1.780 | -0.013 | expected | `56aa75d99154` |
| 156630961 | 2.069 | 2.069 | 0.000 | tie | `6c61f22c589c` |
| 3472796251 | 1.120 | 1.110 | -0.010 | expected | `ffab99db84be` |
| 3562692797 | 1.308 | 1.308 | -0.001 | expected | `8c106ee67814` |
| 3086371616 | 1.297 | 0.368 | -0.929 | expected | `73b3e95b861c` |
| 281907316 | 1.320 | 1.320 | 0.000 | tie | `61fc0c1eaf5c` |
| 833376628 | 1.608 | 1.608 | 0.000 | tie | `520d62c19b2c` |

8 of 9 untied seeds in the expected direction (decrease), 1 opposite, 3 tied, 0 undefined. Exact one-sided sign test: p = 0.0195 for the expected direction, p = 0.9980 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.293, mean treatment 1.139, mean paired difference **-0.154** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 72: observed 72.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.1539 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0195 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9980 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0012-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| collision_episodes | 0.000 | 0.000 | count |
| flown_m | 11.361 | 11.394 | m |
| saccades_per_flight_s | 0.582 | 0.580 | 1/s |
| contact_s | 0.000 | 0.000 | s |
| escape_probability | 0.958 | 0.958 | fraction |
| escape_latency_s | 0.909 | 0.909 | s |
| escape_lead_s | 0.011 | 0.011 | s |
| size_at_escape_deg | 50.709 | 50.709 | deg |
| short_mode_fraction | 0.089 | 0.089 | fraction |
| mean_light_distance_m | 1.293 | 1.139 | m |
| time_near_light | 0.227 | 0.301 | fraction |
| active_fraction | 0.300 | 0.300 | fraction |

## Provenance

- Plan `86a2164db13ac720c8cda2c8fd3163996de03ef23c954f9f0194e6d94036963d`; fly `digital-fly/3 reduced-order-fsm/v1`, identity `7b78efef2d070ed356391eb8f81d736720c2bc6f7e1eba805b30572b483845de`, source `3b221211c38cbbdba6fce0480406056979e03e623b8dc5837b79fca196070b77`
- Preregistered as V3D-EXP-0012 at 2026-10-23T21:08:09.322Z (receipt `cdda4c3648b046f65c6731e3d34c1fbfd7b5913f8d38271649caa23cb24620be`)
- Authorized at 2026-10-23T21:08:09.336Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `49015a492bdcf845dafe8cc46b0ae0790c3a0396b8a1641b989ef3b5214b65a5`
- Record `b927815f333f7004b8bc8ca03229049c72b2fe9400467f2667a6e24cf44f891a`, run `FR-8029c22908ccbfa51c8d896d`, 2026-10-23T21:08:09.337Z to 2026-10-23T21:08:16.552Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 4639.68 fly-seconds, then again for the determinism guard
- Code: commit `063c8a5fabe9f18af7ebce6d6829ad0ca6e66c18`
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
