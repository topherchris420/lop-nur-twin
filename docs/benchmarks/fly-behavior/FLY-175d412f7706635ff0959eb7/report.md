# FLY-175d412f7706635ff0959eb7: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Controller comparison: controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5), against controller configuration A (the default parameters).

**Question (host-written).** In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds?

**Hypothesis (host-written).** Controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with controller configuration A (the default parameters), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light. — competing: [scripted] Steering gain matters less than how often the fly flies, which both configurations share.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1769325372, 3545131458, 2020888115, 3314644035, 3504487295, 788480849, 4253527758, 1192851023, 3136810926, 1216456428, 2716596155, 771520903.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1769325372 | 1.651 | 0.509 | -1.142 | expected | `c998e37b0521` |
| 3545131458 | 1.145 | 1.022 | -0.122 | expected | `19d81e84434e` |
| 2020888115 | 1.651 | 1.651 | 0.000 | tie | `8b81604f6e5b` |
| 3314644035 | 2.392 | 2.001 | -0.392 | expected | `3ee5f53ddf86` |
| 3504487295 | 1.269 | 1.183 | -0.086 | expected | `6bbc0e79f890` |
| 788480849 | 2.081 | 1.226 | -0.855 | expected | `e75a5a49d861` |
| 4253527758 | 1.335 | 1.335 | 0.000 | tie | `23e15260437e` |
| 1192851023 | 1.525 | 1.393 | -0.131 | expected | `1f642cffb4e1` |
| 3136810926 | 0.987 | 1.082 | 0.096 | opposite | `db05fa5d82c3` |
| 1216456428 | 1.814 | 1.210 | -0.604 | expected | `ed08a3a6a969` |
| 2716596155 | 1.440 | 1.420 | -0.019 | expected | `73e181888f01` |
| 771520903 | 1.462 | 1.273 | -0.189 | expected | `02f102596cf6` |

9 of 10 untied seeds in the expected direction (decrease), 1 opposite, 2 tied, 0 undefined. Exact one-sided sign test: p = 0.0107 for the expected direction, p = 0.9990 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.563, mean treatment 1.276, mean paired difference **-0.287** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 72: observed 72.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 10.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.2871 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0107 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9990 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0033-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.012 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.012 | 1/m |
| collision_episodes | 0.000 | 0.250 | count |
| near_miss_fraction | 0.039 | 0.055 | fraction |
| flown_m | 20.443 | 20.292 | m |
| saccades_per_flight_s | 0.577 | 0.582 | 1/s |
| contact_s | 0.000 | 0.001 | s |
| escape_probability | 0.986 | 0.986 | fraction |
| escape_ttc_s | 0.092 | 0.092 | s |
| escape_latency_s | 0.908 | 0.908 | s |
| size_at_escape_deg | 51.769 | 51.769 | deg |
| short_mode_fraction | 0.042 | 0.042 | fraction |
| mean_light_distance_m | 1.563 | 1.276 | m |
| time_near_light | 0.091 | 0.222 | fraction |
| active_fraction | 0.378 | 0.396 | fraction |

## Provenance

- Plan `175d412f7706635ff0959eb716728f1ae63f64ff2a57344af88f721f0f97a273`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `ff9c46c2a17247b1e4327a4763992d16722b4f6ef0c5ea58c211d1ee192cf514`, source `359ee8a2b23084a3726b5b2bab6e7ee39eb27578e0956b6dd6b66e6489bf34c8`
- Preregistered as V3D-EXP-0033 at 2026-10-26T13:08:32.062Z (receipt `353f1c97c435942c56fd0fbb8ca7398fd1702aa548db41ff39f162ca85da50d8`)
- Authorized at 2026-10-26T13:08:32.087Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `1fe0d8ca6fd74f5b8ad14c403acd716fbbb251ec01351901bd261e67cbbff319`
- Record `eca03bf82ad062c491cb2a0e8cb593fb36424e299a1a2710c63bb488d4b38ccc`, run `FR-eac2865e70195568ca919bbe`, 2026-10-26T13:08:32.088Z to 2026-10-26T13:08:45.596Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 6083.28 fly-seconds, then again for the determinism guard
- Code: commit `27af8430b03ffd5284d3609788b39b359c1aa099`
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
