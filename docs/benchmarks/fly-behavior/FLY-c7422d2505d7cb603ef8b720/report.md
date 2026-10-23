# FLY-c7422d2505d7cb603ef8b720: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/3 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Obstacle avoidance: turning away from surfaces whose time to contact falls below 0.45 s, against avoidance off (avoidTtcS = 0).

**Caveat.** As designed it cannot discriminate: collisions in this clutter are rare even with avoidance off, so most seeds tie and the sign test seldom has enough untied seeds.

**Question (host-written).** In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds?

**Hypothesis (host-written).** Turning away from surfaces whose time to contact falls below 0.45 s will decrease cruise_collision_episodes_per_m by at least 0.1 1/m on average over 12 matched seeds drawn after preregistration, compared with avoidance off (avoidTtcS = 0), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown. — competing: [scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 416455625, 156779583, 3562888684, 3353190563, 3394357790, 1816696631, 3261953052, 3220039032, 1107212317, 673017597, 821107221, 4160657268.

## Primary metric: cruise_collision_episodes_per_m (1/m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 416455625 | 0.147 | 0.000 | -0.147 | expected | `5332a8dafcc7` |
| 156779583 | 0.000 | 0.000 | 0.000 | tie | `0834311b39bf` |
| 3562888684 | 0.000 | 0.000 | 0.000 | tie | `bafef889023b` |
| 3353190563 | 0.000 | 0.000 | 0.000 | tie | `207b249e4ec5` |
| 3394357790 | 0.076 | 0.000 | -0.076 | expected | `727b80bc11a6` |
| 1816696631 | 0.000 | 0.000 | 0.000 | tie | `8448875929f5` |
| 3261953052 | 0.000 | 0.000 | 0.000 | tie | `f3ef08cbe884` |
| 3220039032 | 0.000 | 0.000 | 0.000 | tie | `31774ce32ef7` |
| 1107212317 | 0.000 | 0.000 | 0.000 | tie | `468398fc0bef` |
| 673017597 | 0.000 | 0.000 | 0.000 | tie | `c4c8b2aec6de` |
| 821107221 | 0.000 | 0.000 | 0.000 | tie | `86c10ba8dbdd` |
| 4160657268 | 0.000 | 0.000 | 0.000 | tie | `39ca48c8361c` |

2 of 2 untied seeds in the expected direction (decrease), 0 opposite, 10 tied, 0 undefined. Exact one-sided sign test: p = 0.2500 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.019, mean treatment 0.000, mean paired difference **-0.019** (minimum effect 0.1 1/m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 2.0000 — does not hold
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.0186 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.2500 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

Evidence-sufficiency guard(s) not met: G4. No conclusion drawn.

Registry run `V3D-EXP-0007-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.019 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.019 | 0.000 | 1/m |
| collision_episodes | 0.250 | 0.000 | count |
| flown_m | 10.333 | 9.756 | m |
| saccades_per_flight_s | 0.485 | 0.488 | 1/s |
| contact_s | 0.001 | 0.000 | s |

## Provenance

- Plan `c7422d2505d7cb603ef8b72052a22b944a1ec743a60cc731400140e60ea74f2b`; fly `digital-fly/3 reduced-order-fsm/v1`, identity `7b78efef2d070ed356391eb8f81d736720c2bc6f7e1eba805b30572b483845de`, source `3b221211c38cbbdba6fce0480406056979e03e623b8dc5837b79fca196070b77`
- Preregistered as V3D-EXP-0007 at 2026-10-23T21:07:24.859Z (receipt `e97d5d6e342301e21b943b2c02ffc5688c33ec796e1ee21b67ddb94393514bdb`)
- Authorized at 2026-10-23T21:07:24.874Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `d1d7ecfe17d75f213342a6004e733a7e14497eb7dc17e7bc32d112fcaec4ad3f`
- Record `97d3bba3c5b80c5647ccaf3c85125785f00fb5bfb4c955892fdd4f23ee5da7cf`, run `FR-258c16c4ac08be72ed8c59f2`, 2026-10-23T21:07:24.883Z to 2026-10-23T21:07:29.070Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 1440 fly-seconds, then again for the determinism guard
- Code: commit `063c8a5fabe9f18af7ebce6d6829ad0ca6e66c18`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- As designed it cannot discriminate: collisions in this clutter are rare even with avoidance off, so most seeds tie and the sign test seldom has enough untied seeds.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
