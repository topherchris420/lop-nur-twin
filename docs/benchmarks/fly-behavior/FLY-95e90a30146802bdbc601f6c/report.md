# FLY-95e90a30146802bdbc601f6c: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Obstacle avoidance: turning away from surfaces whose time to contact falls below 0.45 s, against avoidance off (avoidTtcS = 0).

**Question (host-written).** In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds?

**Hypothesis (host-written).** Turning away from surfaces whose time to contact falls below 0.45 s will decrease cruise_collision_episodes_per_m by at least 0.12 1/m on average over 10 matched seeds drawn after preregistration, compared with avoidance off (avoidTtcS = 0), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown. — competing: [scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2039708556, 668401184, 2178955260, 831271523, 2403358146, 4110276848, 1673405584, 4213628492, 541349247, 2383703199.

## Primary metric: cruise_collision_episodes_per_m (1/m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2039708556 | 0.364 | 0.043 | -0.321 | expected | `c64abf4ecd62` |
| 668401184 | 0.218 | 0.000 | -0.218 | expected | `1f5448cc6252` |
| 2178955260 | 0.127 | 0.000 | -0.127 | expected | `9bc14eb55487` |
| 831271523 | 0.131 | 0.000 | -0.131 | expected | `135e4d9fc136` |
| 2403358146 | 0.061 | 0.000 | -0.061 | expected | `659bc55fa631` |
| 4110276848 | 0.300 | 0.000 | -0.300 | expected | `e8bef4205b28` |
| 1673405584 | 0.201 | 0.000 | -0.201 | expected | `b86876139d67` |
| 4213628492 | 0.044 | 0.000 | -0.044 | expected | `e8721fddaa1d` |
| 541349247 | 0.118 | 0.049 | -0.069 | expected | `ec020c71302b` |
| 2383703199 | 0.061 | 0.000 | -0.061 | expected | `5ecdb8b2b2a1` |

10 of 10 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 9.77e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.162, mean treatment 0.009, mean paired difference **-0.153** (minimum effect 0.12 1/m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 10.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.12: observed -0.1533 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0010 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0028-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.171 | 0.009 | 1/m |
| cruise_collision_episodes_per_m | 0.162 | 0.009 | 1/m |
| collision_episodes | 3.400 | 0.200 | count |
| near_miss_fraction | 0.163 | 0.055 | fraction |
| flown_m | 20.328 | 20.197 | m |
| saccades_per_flight_s | 0.527 | 0.585 | 1/s |
| contact_s | 0.017 | 0.001 | s |

## Provenance

- Plan `95e90a30146802bdbc601f6cb0dfc1e2e580bf3559e4d7ad3dcdc3c8e47ecf2a`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `ff9c46c2a17247b1e4327a4763992d16722b4f6ef0c5ea58c211d1ee192cf514`, source `359ee8a2b23084a3726b5b2bab6e7ee39eb27578e0956b6dd6b66e6489bf34c8`
- Preregistered as V3D-EXP-0028 at 2026-10-26T13:07:04.210Z (receipt `390ba221ad50289031342af7028a8cbd05a53e0c3627267faf2c3ef33452fcaa`)
- Authorized at 2026-10-26T13:07:04.237Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `271b8f0051f85b04f5b7a5db0a1d4b42983c716610c28c36fb8aad2d342a78cb`
- Record `2ecc81ed3813f10411fd0fcec91d8e776ff7766b1d692d59eaf90c871d7b3b02`, run `FR-a64c1f0078fc4e6395c79cda`, 2026-10-26T13:07:04.253Z to 2026-10-26T13:07:12.807Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2400 fly-seconds, then again for the determinism guard
- Code: commit `27af8430b03ffd5284d3609788b39b359c1aa099`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
