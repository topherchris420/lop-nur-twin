# FLY-d1e0887ba2138a4a8483b82e: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/4 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Controller comparison: controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5), against controller configuration A (the default parameters).

**Question (host-written).** In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds?

**Hypothesis (host-written).** Controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with controller configuration A (the default parameters), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light. — competing: [scripted] Steering gain matters less than how often the fly flies, which both configurations share.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 3189159471, 1059507498, 2927650211, 1880447198, 3903870992, 785255387, 3599739018, 1262360690, 543589803, 3938790355, 1978086752, 3967145363.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 3189159471 | 1.305 | 1.305 | 0.000 | tie | `d23de6af3e78` |
| 1059507498 | 0.826 | 1.049 | 0.223 | opposite | `b03acf2d9f3d` |
| 2927650211 | 1.565 | 1.565 | 0.000 | tie | `4294f43d2a08` |
| 1880447198 | 0.286 | 0.251 | -0.035 | expected | `879db53bfd24` |
| 3903870992 | 0.784 | 0.740 | -0.045 | expected | `3a2c207241ef` |
| 785255387 | 0.446 | 0.399 | -0.047 | expected | `58e18dfde169` |
| 3599739018 | 0.662 | 0.482 | -0.180 | expected | `cb4547ca73d8` |
| 1262360690 | 1.375 | 1.374 | -0.001 | expected | `4a4b134dc902` |
| 543589803 | 0.606 | 0.751 | 0.145 | opposite | `1be8bac8c7af` |
| 3938790355 | 1.051 | 0.739 | -0.312 | expected | `24f6012f6e66` |
| 1978086752 | 0.961 | 0.666 | -0.295 | expected | `895dbbeef5b6` |
| 3967145363 | 1.902 | 1.381 | -0.521 | expected | `630c294f9fe2` |

8 of 10 untied seeds in the expected direction (decrease), 2 opposite, 2 tied, 0 undefined. Exact one-sided sign test: p = 0.0547 for the expected direction, p = 0.9893 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.981, mean treatment 0.892, mean paired difference **-0.089** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 72: observed 72.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 10.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.0890 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0547 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.9893 — does not hold

Success criteria not all met (S1, S2) and no failure criterion triggered.

Registry run `V3D-EXP-0018-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| collision_episodes | 0.000 | 0.000 | count |
| near_miss_fraction | 0.043 | 0.038 | fraction |
| flown_m | 22.049 | 21.390 | m |
| saccades_per_flight_s | 0.526 | 0.512 | 1/s |
| contact_s | 0.000 | 0.000 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.090 | 0.090 | s |
| escape_latency_s | 0.910 | 0.910 | s |
| size_at_escape_deg | 53.603 | 53.603 | deg |
| short_mode_fraction | 0.097 | 0.097 | fraction |
| mean_light_distance_m | 0.981 | 0.892 | m |
| time_near_light | 0.495 | 0.540 | fraction |
| active_fraction | 0.369 | 0.376 | fraction |

## Provenance

- Plan `d1e0887ba2138a4a8483b82e25916319582c6d334ad84bcc7b68f9558abf2d34`; fly `digital-fly/4 reduced-order-fsm/v1`, identity `02776ebf688fc2989a8fe4f6871b30825e567d27ea64b5aecfd3ecf2760b448c`, source `69a28d5897711f339ac6fe76bbd486a76310346b93b62093ce8874c12331380e`
- Preregistered as V3D-EXP-0018 at 2026-10-24T02:53:17.562Z (receipt `fdc8dc8da85fa7a2661ac5dad75d4a8eb7f176a2b06deb74fbbd3e28c0e0e9b0`)
- Authorized at 2026-10-24T02:53:17.603Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `ea41af8330154db86483f3d8b6c132e6c37495e71b02cb6e16abdf5b1704f729`
- Record `768d313bea5e0bd911a0aaa2ae5008b29f5a345c910b99b1482f420ed7dc7ae2`, run `FR-0d07804dbe1eb797172ea8c3`, 2026-10-24T02:53:17.606Z to 2026-10-24T02:53:50.847Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 6083.28 fly-seconds, then again for the determinism guard
- Code: commit `c0f72973e32a0e9924a909da2a70b480994879e6`
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
