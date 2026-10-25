# FLY-972e82373614988d68350921: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Controller comparison: controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5), against controller configuration A (the default parameters).

**Question (host-written).** In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds?

**Hypothesis (host-written).** Controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with controller configuration A (the default parameters), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light. — competing: [scripted] Steering gain matters less than how often the fly flies, which both configurations share.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 551149192, 1544869376, 4264139562, 3029083634, 3348980494, 1171502562, 723295677, 3204892743, 2749215646, 2193617039, 3720249724, 630664659.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 551149192 | 1.690 | 1.167 | -0.523 | expected | `0451cab9f23b` |
| 1544869376 | 2.375 | 1.151 | -1.223 | expected | `a13c223c80bf` |
| 4264139562 | 1.162 | 1.158 | -0.005 | expected | `864815615315` |
| 3029083634 | 1.469 | 1.468 | -0.001 | expected | `0177b8438dad` |
| 3348980494 | 1.805 | 1.574 | -0.232 | expected | `7c4e9ce44352` |
| 1171502562 | 2.273 | 0.702 | -1.570 | expected | `b11b2d474afb` |
| 723295677 | 1.871 | 1.879 | 0.008 | opposite | `a5c7e7cf04f1` |
| 3204892743 | 1.415 | 1.415 | 0.000 | tie | `2a48eb638636` |
| 2749215646 | 0.894 | 0.672 | -0.221 | expected | `805709938353` |
| 2193617039 | 2.374 | 0.426 | -1.948 | expected | `c69730d4ba45` |
| 3720249724 | 0.508 | 0.351 | -0.158 | expected | `12c2ff494e6f` |
| 630664659 | 2.005 | 2.017 | 0.011 | opposite | `42812dcdf023` |

9 of 11 untied seeds in the expected direction (decrease), 2 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 0.0327 for the expected direction, p = 0.9941 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.654, mean treatment 1.165, mean paired difference **-0.489** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 72: observed 72.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 11.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.4885 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0327 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9941 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0009-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.010 | 0.012 | 1/m |
| cruise_collision_episodes_per_m | 0.010 | 0.012 | 1/m |
| collision_episodes | 0.167 | 0.250 | count |
| near_miss_fraction | 0.060 | 0.073 | fraction |
| flown_m | 18.591 | 19.343 | m |
| saccades_per_flight_s | 0.570 | 0.551 | 1/s |
| contact_s | 0.001 | 0.001 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.089 | 0.089 | s |
| escape_latency_s | 0.911 | 0.911 | s |
| size_at_escape_deg | 53.798 | 53.798 | deg |
| short_mode_fraction | 0.097 | 0.097 | fraction |
| mean_light_distance_m | 1.654 | 1.165 | m |
| time_near_light | 0.144 | 0.330 | fraction |
| active_fraction | 0.302 | 0.308 | fraction |

## Provenance

- Plan `972e82373614988d683509212f8373be4dc34bed8e5069d789bf0961c5f6b9a3`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0009 at 2026-10-25T17:30:53.535Z (receipt `e48e91efb7bb413adf9576a6349a802b1f796df07055f9f4e15428fab8ee1346`)
- Authorized at 2026-10-25T17:30:53.555Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `161390c8f26e5625671bc88c7b4b277e3e21d9c4070b8cdb465235950e97a1bc`
- Record `a740d41893f3037155283b7b469a06365e74b519acc71e6b434b94d5152167a3`, run `FR-05d01fbdadd0a0623d7f1287`, 2026-10-25T17:30:53.556Z to 2026-10-25T17:31:17.628Z
- Simulated on node 24.22.1 (V8 13.6.233.17-node.58): 6083.28 fly-seconds, then again for the determinism guard
- Code: commit `a71066264ba3ff3a6949316bdc0f0bcee92c5520`
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
