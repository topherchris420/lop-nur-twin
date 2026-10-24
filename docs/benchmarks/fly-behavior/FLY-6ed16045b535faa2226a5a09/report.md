# FLY-6ed16045b535faa2226a5a09: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/5 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Controller comparison: controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5), against controller configuration A (the default parameters).

**Question (host-written).** In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds?

**Hypothesis (host-written).** Controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with controller configuration A (the default parameters), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light. — competing: [scripted] Steering gain matters less than how often the fly flies, which both configurations share.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2748751719, 2657448686, 945366343, 68543236, 1342686073, 3749788805, 2903195184, 2504785754, 1678790384, 2969613281, 3175930312, 565611207.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2748751719 | 0.666 | 0.515 | -0.151 | expected | `cd0f896b71aa` |
| 2657448686 | 0.929 | 0.858 | -0.072 | expected | `b06f98355420` |
| 945366343 | 1.585 | 1.609 | 0.024 | opposite | `653a91da7a87` |
| 68543236 | 0.887 | 0.757 | -0.130 | expected | `4dd76b0b6907` |
| 1342686073 | 1.393 | 0.644 | -0.749 | expected | `33195af13a0d` |
| 3749788805 | 2.267 | 2.267 | 0.000 | tie | `333de4756a74` |
| 2903195184 | 1.262 | 1.267 | 0.005 | opposite | `c167a5ca2dfe` |
| 2504785754 | 0.553 | 0.496 | -0.057 | expected | `207332536e2b` |
| 1678790384 | 1.655 | 0.437 | -1.219 | expected | `d421a64092eb` |
| 2969613281 | 1.357 | 1.038 | -0.320 | expected | `70318506912e` |
| 3175930312 | 1.096 | 0.981 | -0.115 | expected | `3aa0a9314668` |
| 565611207 | 1.514 | 1.339 | -0.175 | expected | `fdd46ad5b452` |

9 of 11 untied seeds in the expected direction (decrease), 2 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 0.0327 for the expected direction, p = 0.9941 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.264, mean treatment 1.017, mean paired difference **-0.246** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 72: observed 72.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 11.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.2465 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0327 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 0.9941 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0006-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| collision_episodes | 0.000 | 0.000 | count |
| near_miss_fraction | 0.032 | 0.052 | fraction |
| flown_m | 19.219 | 19.340 | m |
| saccades_per_flight_s | 0.559 | 0.561 | 1/s |
| contact_s | 0.000 | 0.000 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.090 | 0.090 | s |
| escape_latency_s | 0.910 | 0.910 | s |
| size_at_escape_deg | 53.045 | 53.045 | deg |
| short_mode_fraction | 0.083 | 0.083 | fraction |
| mean_light_distance_m | 1.264 | 1.017 | m |
| time_near_light | 0.255 | 0.502 | fraction |
| active_fraction | 0.392 | 0.402 | fraction |

## Provenance

- Plan `6ed16045b535faa2226a5a096769415809c99941c632c68b51d103f50ff0101b`; fly `digital-fly/5 reduced-order-fsm/v1`, identity `aeefc422fb7ee9ac538fe71c558eefcf8aacb8bf84fcf56b45b9085e6e296fa7`, source `0f6eef0366d07c5e8abedbad54bb5eaf3b922b10a7c2ff0447b1bf9ca16b25d7`
- Preregistered as V3D-EXP-0006 at 2026-10-24T16:12:41.006Z (receipt `d2962fdbe6d91485496d5ced6d662c010424de541a98268f1e7a1ac85f9eca98`)
- Authorized at 2026-10-24T16:12:41.023Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `ebdd19b28416b5810714ccb49684eb68cc2488479d0a00ccec666f9ef9a5f80c`
- Record `c0152ba7b1515e58346677a69f7f26d80f12e666d521514a2281d0422e6eeaef`, run `FR-cdd8377c918f742145b5cc55`, 2026-10-24T16:12:41.024Z to 2026-10-24T16:13:04.196Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 6083.28 fly-seconds, then again for the determinism guard
- Code: commit `f8cdf135f830bdfecce08f1fd1a38d992767c365`
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
