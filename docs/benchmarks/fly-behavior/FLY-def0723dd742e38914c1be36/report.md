# FLY-def0723dd742e38914c1be36: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Controller comparison: controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5), against controller configuration A (the default parameters).

**Question (host-written).** In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds?

**Hypothesis (host-written).** Controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with controller configuration A (the default parameters), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light. — competing: [scripted] Steering gain matters less than how often the fly flies, which both configurations share.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3486603639, 2407045644, 221385034, 1241036997, 244758759, 3589973445, 3770848625, 3195362233, 1672328776, 2130421058, 4043723367, 652805890.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3486603639 | 1.522 | 1.545 | 0.023 | opposite | `d28de4e9482c` |
| 2407045644 | 1.159 | 1.137 | -0.022 | expected | `4577aba68910` |
| 221385034 | 0.761 | 0.624 | -0.137 | expected | `d8308f749188` |
| 1241036997 | 1.908 | 1.908 | 0.000 | tie | `f43d04ab6fd8` |
| 244758759 | 1.364 | 1.274 | -0.089 | expected | `28bb433308e4` |
| 3589973445 | 0.787 | 0.570 | -0.218 | expected | `0507c7b3979b` |
| 3770848625 | 1.689 | 1.689 | 0.000 | tie | `96f5f852dcc5` |
| 3195362233 | 2.087 | 1.310 | -0.778 | expected | `e000d36ce877` |
| 1672328776 | 0.667 | 0.404 | -0.263 | expected | `3ddf6d50190d` |
| 2130421058 | 1.498 | 1.498 | 0.000 | tie | `1125197ca1a5` |
| 4043723367 | 2.038 | 2.001 | -0.037 | expected | `9fe57311682d` |
| 652805890 | 1.735 | 1.525 | -0.210 | expected | `45809f7dea9b` |

8 of 9 untied seeds in the expected direction (decrease), 1 opposite, 3 tied, 0 undefined. Exact one-sided sign test: p = 0.0195 for the expected direction, p = 0.9980 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.435, mean treatment 1.290, mean paired difference **-0.144** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 72: observed 72.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.1442 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0195 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9980 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0006-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.011 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.011 | 1/m |
| collision_episodes | 0.000 | 0.250 | count |
| near_miss_fraction | 0.045 | 0.079 | fraction |
| flown_m | 19.386 | 20.649 | m |
| saccades_per_flight_s | 0.545 | 0.558 | 1/s |
| contact_s | 0.000 | 0.001 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.090 | 0.090 | s |
| escape_latency_s | 0.910 | 0.910 | s |
| size_at_escape_deg | 53.161 | 53.161 | deg |
| short_mode_fraction | 0.083 | 0.083 | fraction |
| mean_light_distance_m | 1.435 | 1.290 | m |
| time_near_light | 0.224 | 0.249 | fraction |
| active_fraction | 0.313 | 0.329 | fraction |

## Provenance

- Plan `def0723dd742e38914c1be36451bf16e16adc3e4cf781572fb13707448bfd85f`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `247197565afacdeda5b29bdca1a24744fd547120e39f1a35621689f2e9c90905`, source `d77a3a3961b0700f93c794a7dd8e0f3d3a9c0fd68661cfc324711c1ebf407c6c`
- Preregistered as V3D-EXP-0006 at 2026-10-24T21:24:06.159Z (receipt `ba929f323a688b37fd35ae2310b76777dac0575d1aa86fd9b1a1335b1ade7c81`)
- Authorized at 2026-10-24T21:24:06.179Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `775610771838440475382e58ccdb1a3c99d6a5ec2754df190cccb6efebbf22e6`
- Record `a1934681b82260de5ab0af1885c7dd1a6f6b0887a7c92d27e53f53cf8587af92`, run `FR-d8f03a7154582e4f6f69d3ca`, 2026-10-24T21:24:06.180Z to 2026-10-24T21:24:34.720Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 6083.28 fly-seconds, then again for the determinism guard
- Code: commit `74216e15e42796df5684c31d82522e7234054d76`
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
