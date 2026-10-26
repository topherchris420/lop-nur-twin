# FLY-3de0b0f0737c7c89d79801ec: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Controller comparison: controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5), against controller configuration A (the default parameters).

**Question (host-written).** In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds?

**Hypothesis (host-written).** Controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with controller configuration A (the default parameters), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light. — competing: [scripted] Steering gain matters less than how often the fly flies, which both configurations share.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1628540719, 183907798, 2268296319, 996553591, 3317110692, 4179686255, 899718325, 2349994759, 686203288, 3507149658, 1268689872, 156107361.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1628540719 | 1.362 | 1.362 | 0.000 | tie | `27ecc0e41851` |
| 183907798 | 1.440 | 1.440 | 0.000 | tie | `cb8ef413a0ff` |
| 2268296319 | 1.586 | 1.567 | -0.019 | expected | `63246ea23642` |
| 996553591 | 1.158 | 1.086 | -0.072 | expected | `e24642f1d159` |
| 3317110692 | 2.163 | 2.163 | 0.000 | tie | `73d200ba15f9` |
| 4179686255 | 1.907 | 1.650 | -0.256 | expected | `0f2f7f0179e0` |
| 899718325 | 1.650 | 1.650 | 0.000 | tie | `1a71f4f79b12` |
| 2349994759 | 1.634 | 1.634 | 0.000 | tie | `f71f130c78d9` |
| 686203288 | 1.400 | 1.364 | -0.036 | expected | `5b3a48848465` |
| 3507149658 | 1.564 | 1.564 | 0.000 | tie | `6364a19ec441` |
| 1268689872 | 1.578 | 1.578 | 0.000 | tie | `c8113eb408f1` |
| 156107361 | 1.375 | 0.989 | -0.385 | expected | `eb089b56579e` |

5 of 5 untied seeds in the expected direction (decrease), 0 opposite, 7 tied, 0 undefined. Exact one-sided sign test: p = 0.0313 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.568, mean treatment 1.504, mean paired difference **-0.064** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 72: observed 72.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 5.0000 — does not hold
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.0640 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0313 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

Evidence-sufficiency guard(s) not met: G4. No conclusion drawn.

Registry run `V3D-EXP-0006-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.008 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.008 | 1/m |
| collision_episodes | 0.000 | 0.167 | count |
| near_miss_fraction | 0.051 | 0.083 | fraction |
| flown_m | 20.668 | 19.774 | m |
| saccades_per_flight_s | 0.533 | 0.549 | 1/s |
| contact_s | 0.000 | 0.001 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.092 | 0.092 | s |
| escape_latency_s | 0.908 | 0.908 | s |
| size_at_escape_deg | 52.239 | 52.239 | deg |
| short_mode_fraction | 0.056 | 0.056 | fraction |
| mean_light_distance_m | 1.568 | 1.504 | m |
| time_near_light | 0.023 | 0.077 | fraction |
| active_fraction | 0.254 | 0.254 | fraction |

## Provenance

- Plan `3de0b0f0737c7c89d79801ec24cb62e7d2e2aefbe0754a3eb673cf217888f1c5`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `309bc659d993b7c1affb6353a5aac0e434e9fc502d8d9477013d3af7296aaf38`, source `b9abf944d6d246ff622184e4b0d29ccdf4e3966665643958ab4585d67f4b0aff`
- Preregistered as V3D-EXP-0006 at 2026-10-26T00:34:25.931Z (receipt `d314c353fdc8acdef7fb936e37b78d34c0053bf944ddff651bb1ede890a27a9a`)
- Authorized at 2026-10-26T00:34:25.955Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `9c83fcb4ba6f6f4f269ed7ff7ac51d9bb7c1cfd3de364c93c0aeed75fe799759`
- Record `127581fb6aea8f1d57ed820ce63a03a1fc68dc8153ecd5ca92e30caf84f18828`, run `FR-ef21e20488ef76aa7c384055`, 2026-10-26T00:34:25.955Z to 2026-10-26T00:34:52.873Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 6083.28 fly-seconds, then again for the determinism guard
- Code: commit `06ff901fae549bb121d80c9b61e0f5c6b61faf77`
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
