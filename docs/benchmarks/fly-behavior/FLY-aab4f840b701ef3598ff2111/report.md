# FLY-aab4f840b701ef3598ff2111: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/9 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Obstacle avoidance: turning away from surfaces whose time to contact falls below 0.45 s, against avoidance off (avoidTtcS = 0).

**Question (host-written).** In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds?

**Hypothesis (host-written).** Turning away from surfaces whose time to contact falls below 0.45 s will decrease cruise_collision_episodes_per_m by at least 0.12 1/m on average over 10 matched seeds drawn after preregistration, compared with avoidance off (avoidTtcS = 0), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown. — competing: [scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1638830809, 2308390410, 918896424, 2601138511, 511072302, 660872972, 1638563955, 2298998800, 1551716600, 3531069661.

## Primary metric: cruise_collision_episodes_per_m (1/m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1638830809 | 0.049 | 0.000 | -0.049 | expected | `738c33cbc9f0` |
| 2308390410 | 0.257 | 0.000 | -0.257 | expected | `1ae736ee1242` |
| 918896424 | 0.081 | 0.042 | -0.039 | expected | `cb124bb4d3f9` |
| 2601138511 | 0.050 | 0.000 | -0.050 | expected | `9212a7fcc6c0` |
| 511072302 | 0.000 | 0.000 | 0.000 | tie | `56751d47cf2f` |
| 660872972 | 0.069 | 0.000 | -0.069 | expected | `9a54c04ef0d8` |
| 1638563955 | 0.102 | 0.000 | -0.102 | expected | `832bc51d4700` |
| 2298998800 | 0.116 | 0.000 | -0.116 | expected | `12eb2f4d9426` |
| 1551716600 | 0.232 | 0.000 | -0.232 | expected | `c6ef95158090` |
| 3531069661 | 0.249 | 0.000 | -0.249 | expected | `79afea40621d` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.120, mean treatment 0.004, mean paired difference **-0.116** (minimum effect 0.12 1/m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.12: observed -0.1162 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

Success criteria not all met (S1) and no failure criterion triggered.

Registry run `V3D-EXP-0001-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.120 | 0.004 | 1/m |
| cruise_collision_episodes_per_m | 0.120 | 0.004 | 1/m |
| collision_episodes | 2.300 | 0.100 | count |
| near_miss_fraction | 0.133 | 0.053 | fraction |
| flown_m | 18.768 | 19.238 | m |
| saccades_per_flight_s | 0.493 | 0.516 | 1/s |
| contact_s | 0.011 | 0.001 | s |

## Provenance

- Plan `aab4f840b701ef3598ff211128cee69d3f02359f88c1e9aa3464f01e02bd55d4`; fly `digital-fly/9 reduced-order-fsm/v1`, identity `5d8d3589513b67c3b784c7fcc76029b36d3478bb885568e6c79666e2bac6ec7b`, source `3a440f60616f2e78515dcf03a3cc689b54316140fb08d659c5310f63a4a83500`
- Preregistered as V3D-EXP-0001 at 2026-11-04T14:44:58.446Z (receipt `9dd870552d5f7f4e55d249e30c1963a5cf8aeec403cf484836660aa1f6d11767`)
- Authorized at 2026-11-04T14:44:58.595Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `4b81f6a81913733b3c35bf4db9fa1e800d460f0c0a4170e98991a98d01e95915`
- Record `a2ea499fbebd793cbb133af208b19972ac30916399f635d1b7931bca067a06ae`, run `FR-ff26d31d5fbbc6af08f75d22`, 2026-11-04T14:44:58.637Z to 2026-11-04T14:45:35.601Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2400 fly-seconds, then again for the determinism guard
- Code: commit `e458f7cb34904d85127779a3700c26b376ab4a80`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
