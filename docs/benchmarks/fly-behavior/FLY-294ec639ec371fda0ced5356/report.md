# FLY-294ec639ec371fda0ced5356: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/9 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Controller comparison: controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5), against controller configuration A (the default parameters).

**Question (host-written).** In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds?

**Hypothesis (host-written).** Controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with controller configuration A (the default parameters), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light. — competing: [scripted] Steering gain matters less than how often the fly flies, which both configurations share.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 185415991, 1316161350, 976786322, 1301152942, 3157043681, 3142057184, 3936798410, 260310627, 198139068, 1296584788, 3927858430, 2556737258.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 185415991 | 1.613 | 1.613 | 0.000 | tie | `264e0e1c274a` |
| 1316161350 | 0.908 | 0.891 | -0.017 | expected | `35baf0a03439` |
| 976786322 | 1.533 | 1.065 | -0.468 | expected | `f66dec744329` |
| 1301152942 | 0.766 | 0.556 | -0.210 | expected | `ca5e2803c102` |
| 3157043681 | 1.375 | 0.939 | -0.436 | expected | `c22979a01048` |
| 3142057184 | 1.285 | 1.079 | -0.206 | expected | `01c780a639e0` |
| 3936798410 | 1.393 | 1.343 | -0.050 | expected | `5ed54643bda4` |
| 260310627 | 1.300 | 0.912 | -0.388 | expected | `e04abae376b3` |
| 198139068 | 1.096 | 0.662 | -0.434 | expected | `366198f7b50d` |
| 1296584788 | 0.632 | 0.321 | -0.311 | expected | `1c0060bf5b89` |
| 3927858430 | 1.565 | 1.563 | -0.002 | expected | `3f173557221d` |
| 2556737258 | 0.799 | 0.783 | -0.017 | expected | `e9822083fe99` |

11 of 11 untied seeds in the expected direction (decrease), 0 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 4.88e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.189, mean treatment 0.977, mean paired difference **-0.211** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 72: observed 72.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 11.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.2115 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0005 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0006-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.013 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.013 | 1/m |
| collision_episodes | 0.000 | 0.250 | count |
| near_miss_fraction | 0.044 | 0.066 | fraction |
| flown_m | 19.784 | 20.466 | m |
| saccades_per_flight_s | 0.505 | 0.519 | 1/s |
| contact_s | 0.000 | 0.001 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.091 | 0.091 | s |
| escape_latency_s | 0.909 | 0.909 | s |
| size_at_escape_deg | 52.291 | 52.291 | deg |
| short_mode_fraction | 0.042 | 0.042 | fraction |
| mean_light_distance_m | 1.189 | 0.977 | m |
| time_near_light | 0.290 | 0.462 | fraction |
| active_fraction | 0.315 | 0.315 | fraction |

## Provenance

- Plan `294ec639ec371fda0ced5356d9f1c1bcd19658c098358fe2e3c42d59eda92d11`; fly `digital-fly/9 reduced-order-fsm/v1`, identity `5d8d3589513b67c3b784c7fcc76029b36d3478bb885568e6c79666e2bac6ec7b`, source `3a440f60616f2e78515dcf03a3cc689b54316140fb08d659c5310f63a4a83500`
- Preregistered as V3D-EXP-0006 at 2026-11-04T14:52:56.866Z (receipt `e18fcf9dcb6e0be19cea06a5050cf8ec7b2132054879f170fdfe53fffc1014c0`)
- Authorized at 2026-11-04T14:52:56.992Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `50fded11c3653080c456e68789910c985f420ba3e8c0d6682158569b5444660e`
- Record `5e8f32d2c5fca2bd3743d52d8238a2c191cdee188df8154e15b7f1b1bdcedae6`, run `FR-a4ae80ab3329d66fe183580b`, 2026-11-04T14:52:56.994Z to 2026-11-04T14:53:55.546Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 6083.28 fly-seconds, then again for the determinism guard
- Code: commit `e458f7cb34904d85127779a3700c26b376ab4a80`
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
