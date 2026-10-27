# FLY-22561208a33de5702fad7bf2: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Controller comparison: controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5), against controller configuration A (the default parameters).

**Question (host-written).** In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds?

**Hypothesis (host-written).** Controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with controller configuration A (the default parameters), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light. — competing: [scripted] Steering gain matters less than how often the fly flies, which both configurations share.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 4213951082, 965785367, 170857609, 2712639325, 364523541, 1275013774, 3089098840, 2893551011, 1503715567, 3461145244, 1219718085, 3965915940.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 4213951082 | 0.987 | 0.791 | -0.195 | expected | `2a1a8bbbe56b` |
| 965785367 | 1.822 | 1.822 | 0.000 | tie | `5746cae8a2be` |
| 170857609 | 1.090 | 0.845 | -0.245 | expected | `e4ad7b92e420` |
| 2712639325 | 0.806 | 0.538 | -0.268 | expected | `79bf6f37519f` |
| 364523541 | 1.591 | 1.594 | 0.003 | opposite | `07797a47ff6d` |
| 1275013774 | 0.787 | 0.787 | 0.000 | opposite | `2fbf9d67f6f5` |
| 3089098840 | 2.427 | 2.427 | 0.000 | tie | `354d00cbec47` |
| 2893551011 | 1.558 | 1.436 | -0.122 | expected | `5a99dcbd5a4c` |
| 1503715567 | 1.398 | 1.159 | -0.239 | expected | `b042a64cd4da` |
| 3461145244 | 0.830 | 0.714 | -0.116 | expected | `cb074d0143df` |
| 1219718085 | 1.566 | 1.363 | -0.202 | expected | `27a254ec811e` |
| 3965915940 | 1.935 | 1.935 | 0.000 | tie | `03d8c7307c95` |

7 of 9 untied seeds in the expected direction (decrease), 2 opposite, 3 tied, 0 undefined. Exact one-sided sign test: p = 0.0898 for the expected direction, p = 0.9805 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.400, mean treatment 1.284, mean paired difference **-0.115** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 72: observed 72.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.1154 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0898 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.9805 — does not hold

Success criteria not all met (S2) and no failure criterion triggered.

Registry run `V3D-EXP-0060-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.007 | 0.004 | 1/m |
| cruise_collision_episodes_per_m | 0.007 | 0.004 | 1/m |
| collision_episodes | 0.167 | 0.083 | count |
| near_miss_fraction | 0.042 | 0.064 | fraction |
| flown_m | 21.456 | 20.590 | m |
| saccades_per_flight_s | 0.553 | 0.558 | 1/s |
| contact_s | 0.001 | 0.000 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.092 | 0.092 | s |
| escape_latency_s | 0.908 | 0.908 | s |
| size_at_escape_deg | 52.682 | 52.682 | deg |
| short_mode_fraction | 0.069 | 0.069 | fraction |
| mean_light_distance_m | 1.400 | 1.284 | m |
| time_near_light | 0.235 | 0.277 | fraction |
| active_fraction | 0.285 | 0.298 | fraction |

## Provenance

- Plan `22561208a33de5702fad7bf239a18c2f594992d0b045285d7fdfd83f039139df`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `c684a7f0002390bee7e62d529bc459479c35e45465749ad174bd99aca71a5f8a`, source `a96a496c4c00acead32e208158faf7889c31027b8dccde781059a4eb4481f70b`
- Preregistered as V3D-EXP-0060 at 2026-10-27T04:13:39.436Z (receipt `c70b7de68fef62eb6af4bd22ca47141d785bf458584035bae462bff7d875579a`)
- Authorized at 2026-10-27T04:13:39.570Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `cccddd361d46012d99e5009d0e5149e88bab93a2d4aa3f64965e619e74d2d02f`
- Record `8ca519346d09fb62a773c0d2ba311822e04bf4b1078ec6b26aa6f36287251bdd`, run `FR-8423f04dab8dfc7ba77e4f53`, 2026-10-27T04:13:39.574Z to 2026-10-27T04:14:34.655Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 6083.28 fly-seconds, then again for the determinism guard
- Code: commit `352fafda07d29c0d7f4f412073dc129fc5ac7a63`
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
