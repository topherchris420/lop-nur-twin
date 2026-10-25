# FLY-2447ff44230c0ffc033881c2: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Obstacle avoidance: turning away from surfaces whose time to contact falls below 0.45 s, against avoidance off (avoidTtcS = 0).

**Question (host-written).** In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds?

**Hypothesis (host-written).** Turning away from surfaces whose time to contact falls below 0.45 s will decrease cruise_collision_episodes_per_m by at least 0.12 1/m on average over 10 matched seeds drawn after preregistration, compared with avoidance off (avoidTtcS = 0), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown. — competing: [scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1633391580, 259074889, 3320241529, 2240574492, 682153266, 851653482, 202654776, 649196602, 4030339051, 1265940951.

## Primary metric: cruise_collision_episodes_per_m (1/m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1633391580 | 0.143 | 0.000 | -0.143 | expected | `dc46330be2c2` |
| 259074889 | 0.106 | 0.000 | -0.106 | expected | `5f7c705d0054` |
| 3320241529 | 0.262 | 0.000 | -0.262 | expected | `44afbf5cdd39` |
| 2240574492 | 0.216 | 0.000 | -0.216 | expected | `0542b58f0f39` |
| 682153266 | 0.319 | 0.000 | -0.319 | expected | `7d0b9919f6fc` |
| 851653482 | 0.095 | 0.000 | -0.095 | expected | `cfc7d017455c` |
| 202654776 | 0.187 | 0.000 | -0.187 | expected | `019e54c9b4d2` |
| 649196602 | 0.000 | 0.000 | 0.000 | tie | `a51b77139b1c` |
| 4030339051 | 0.222 | 0.039 | -0.183 | expected | `5cf14aa9b1da` |
| 1265940951 | 0.326 | 0.000 | -0.326 | expected | `ea28a53f2a6c` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.188, mean treatment 0.004, mean paired difference **-0.184** (minimum effect 0.12 1/m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.12: observed -0.1838 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0001-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.193 | 0.004 | 1/m |
| cruise_collision_episodes_per_m | 0.188 | 0.004 | 1/m |
| collision_episodes | 3.700 | 0.100 | count |
| near_miss_fraction | 0.175 | 0.054 | fraction |
| flown_m | 19.356 | 20.207 | m |
| saccades_per_flight_s | 0.489 | 0.530 | 1/s |
| contact_s | 0.018 | 0.001 | s |

## Provenance

- Plan `2447ff44230c0ffc033881c20c007ab736a4c80d4f1184dc00fa77bef433ea76`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `8fa862d0a358e1d8f3c36ea20bcc47f293ef42c1413ff1db2c9a6ebf3f086911`, source `e838b010f63674a8e7c6364631eff58473fbb0ef96fbd5d0e69b399a4303c485`
- Preregistered as V3D-EXP-0001 at 2026-10-25T19:48:15.222Z (receipt `458bb5927030e7b2f29f1174194d6db76872731a6f2e49eeab46fe44a8ed8d02`)
- Authorized at 2026-10-25T19:48:15.240Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `94a02f96a3efb3b29e982963ca82b9456d25c6e80a619e5d07f752c929105e6f`
- Record `81883f23fdc8c95b18e75d78cd29e8976b096ef674f7c85624b11391443bdec5`, run `FR-00d20ef23ed2a61bacd48032`, 2026-10-25T19:48:15.243Z to 2026-10-25T19:48:23.342Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2400 fly-seconds, then again for the determinism guard
- Code: commit `94539a4a3edb9ffa588d4e7f5e864c55e293d80a`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
