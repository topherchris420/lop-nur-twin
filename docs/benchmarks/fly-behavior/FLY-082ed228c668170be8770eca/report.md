# FLY-082ed228c668170be8770eca: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Controller comparison: controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5), against controller configuration A (the default parameters).

**Question (host-written).** In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds?

**Hypothesis (host-written).** Controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with controller configuration A (the default parameters), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light. — competing: [scripted] Steering gain matters less than how often the fly flies, which both configurations share.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1603041965, 3010336609, 1326718975, 101117270, 2407476542, 1852985063, 238395841, 654987113, 3773383121, 273118910, 3320879859, 4173523576.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1603041965 | 1.303 | 1.303 | 0.000 | tie | `75215c4564c6` |
| 3010336609 | 1.022 | 1.013 | -0.009 | expected | `2fe30758ccd4` |
| 1326718975 | 1.987 | 1.970 | -0.016 | expected | `ec96a5fc0cb7` |
| 101117270 | 0.933 | 0.866 | -0.067 | expected | `e9a50224ccfd` |
| 2407476542 | 1.301 | 1.162 | -0.138 | expected | `0aa111c186d9` |
| 1852985063 | 2.615 | 2.676 | 0.061 | opposite | `e17eeadb86f0` |
| 238395841 | 0.946 | 1.125 | 0.179 | opposite | `7e2600eb36af` |
| 654987113 | 0.911 | 0.908 | -0.003 | expected | `2e9f625d4e8c` |
| 3773383121 | 1.821 | 1.821 | 0.000 | tie | `597eff178f34` |
| 273118910 | 0.610 | 0.463 | -0.147 | expected | `6f814c222f9b` |
| 3320879859 | 0.862 | 0.486 | -0.376 | expected | `13b543d117da` |
| 4173523576 | 0.578 | 0.383 | -0.195 | expected | `ae305114fc2b` |

8 of 10 untied seeds in the expected direction (decrease), 2 opposite, 2 tied, 0 undefined. Exact one-sided sign test: p = 0.0547 for the expected direction, p = 0.9893 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.241, mean treatment 1.181, mean paired difference **-0.059** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 72: observed 72.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 10.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.0593 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0547 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.9893 — does not hold

Success criteria not all met (S1, S2) and no failure criterion triggered.

Registry run `V3D-EXP-0042-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.009 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.009 | 1/m |
| collision_episodes | 0.000 | 0.167 | count |
| near_miss_fraction | 0.043 | 0.051 | fraction |
| flown_m | 19.814 | 19.369 | m |
| saccades_per_flight_s | 0.564 | 0.527 | 1/s |
| contact_s | 0.000 | 0.001 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.088 | 0.088 | s |
| escape_latency_s | 0.912 | 0.912 | s |
| size_at_escape_deg | 54.808 | 54.808 | deg |
| short_mode_fraction | 0.125 | 0.125 | fraction |
| mean_light_distance_m | 1.241 | 1.181 | m |
| time_near_light | 0.373 | 0.408 | fraction |
| active_fraction | 0.321 | 0.317 | fraction |

## Provenance

- Plan `082ed228c668170be8770ecaba50c7d91314c3dba2a14a8f37b1c6e8405c0343`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `e2eb5e95c355777d19a210820fb203fc9ef47608031b98fa85882280e85cfdca`, source `daad49019246c38c2673cd442ecaae50eba95994635676bdc333b5563cebfb78`
- Preregistered as V3D-EXP-0042 at 2026-10-26T20:16:03.140Z (receipt `1006025d06ccc3078f4dbe43dc96f04dfd2b52183e9c27540207652028d5f618`)
- Authorized at 2026-10-26T20:16:03.169Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `38e7cf63f87730c67ab28356d0ddbc2b679763f32d2bcc88d3489cab89e65c9e`
- Record `e32e53f68029b07205fd6ccc6222074f3fc2dfe7f99ee48f990198407ce8f38a`, run `FR-d95846f825923e700a56faeb`, 2026-10-26T20:16:03.170Z to 2026-10-26T20:16:16.629Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 6083.28 fly-seconds, then again for the determinism guard
- Code: commit `379fb9debfbd203f99d6c76ac80097706945dd2d`
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
