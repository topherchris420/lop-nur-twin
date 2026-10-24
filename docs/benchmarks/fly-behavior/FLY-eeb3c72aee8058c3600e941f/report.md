# FLY-eeb3c72aee8058c3600e941f: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/6 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Controller comparison: controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5), against controller configuration A (the default parameters).

**Question (host-written).** In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds?

**Hypothesis (host-written).** Controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with controller configuration A (the default parameters), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light. — competing: [scripted] Steering gain matters less than how often the fly flies, which both configurations share.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1451400380, 1623821381, 2436408005, 4255369153, 4190700821, 1445256514, 269472706, 3300418475, 877340711, 755130176, 648383653, 490386656.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1451400380 | 1.649 | 1.649 | 0.000 | tie | `457022e60c80` |
| 1623821381 | 1.401 | 1.415 | 0.014 | opposite | `0e2244616dd9` |
| 2436408005 | 1.035 | 1.017 | -0.018 | expected | `7bb477470c79` |
| 4255369153 | 1.759 | 1.755 | -0.004 | expected | `c2a08eed21eb` |
| 4190700821 | 2.472 | 1.894 | -0.578 | expected | `2f8a066faf62` |
| 1445256514 | 1.586 | 1.586 | 0.000 | tie | `16f1ed17fe2d` |
| 269472706 | 0.580 | 0.282 | -0.298 | expected | `d0408d55677e` |
| 3300418475 | 0.679 | 0.700 | 0.021 | opposite | `1ab1d8645313` |
| 877340711 | 2.018 | 2.018 | 0.000 | tie | `e3161cac2dfb` |
| 755130176 | 1.105 | 1.099 | -0.006 | expected | `de5ad0dfb0b2` |
| 648383653 | 1.367 | 1.361 | -0.006 | expected | `0ca189b42b17` |
| 490386656 | 1.429 | 1.399 | -0.031 | expected | `c1344abc97bc` |

7 of 9 untied seeds in the expected direction (decrease), 2 opposite, 3 tied, 0 undefined. Exact one-sided sign test: p = 0.0898 for the expected direction, p = 0.9805 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.423, mean treatment 1.348, mean paired difference **-0.075** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 72: observed 72.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.0755 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0898 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.9805 — does not hold

Success criteria not all met (S1, S2) and no failure criterion triggered.

Registry run `V3D-EXP-0006-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.009 | 0.004 | 1/m |
| cruise_collision_episodes_per_m | 0.009 | 0.004 | 1/m |
| collision_episodes | 0.167 | 0.083 | count |
| near_miss_fraction | 0.042 | 0.072 | fraction |
| flown_m | 19.567 | 19.391 | m |
| saccades_per_flight_s | 0.541 | 0.538 | 1/s |
| contact_s | 0.001 | 0.000 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.089 | 0.089 | s |
| escape_latency_s | 0.911 | 0.911 | s |
| size_at_escape_deg | 53.603 | 53.603 | deg |
| short_mode_fraction | 0.097 | 0.097 | fraction |
| mean_light_distance_m | 1.423 | 1.348 | m |
| time_near_light | 0.222 | 0.243 | fraction |
| active_fraction | 0.321 | 0.318 | fraction |

## Provenance

- Plan `eeb3c72aee8058c3600e941f059c4e58dac0355bf65fe498ff82349a7bb062ca`; fly `digital-fly/6 reduced-order-fsm/v1`, identity `ad5cea56d67036ecf47acddc8bcad249ff0eea83de3593c3b9850b524eb4f46d`, source `167ae70ac8ff41678590d70cf73640164392e6c73b9b1613b5f075575b715d87`
- Preregistered as V3D-EXP-0006 at 2026-10-24T19:26:56.225Z (receipt `317d78a0bc04798d609576bc9e89e8da8f46ea27b20ce87cca3b583353b80bb5`)
- Authorized at 2026-10-24T19:26:56.245Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `212c254981c5642e5ebb187248127996fb554218b4cafe4ca0b5438cb8b17db6`
- Record `a01277e80fa3295a698ef12dd63e8f404ee2eb00ff5352f93de8fcbd62b5e939`, run `FR-91af4c79c227c5a652e720b5`, 2026-10-24T19:26:56.245Z to 2026-10-24T19:27:21.840Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 6083.28 fly-seconds, then again for the determinism guard
- Code: commit `300a2aa64e7d8771297c525e8b7159a56e84aeb6`
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
