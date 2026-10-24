# FLY-475b6ede398666ba31444cd0: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/4 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Obstacle avoidance: turning away from surfaces whose time to contact falls below 0.45 s, against avoidance off (avoidTtcS = 0).

**Question (host-written).** In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds?

**Hypothesis (host-written).** Turning away from surfaces whose time to contact falls below 0.45 s will decrease cruise_collision_episodes_per_m by at least 0.12 1/m on average over 10 matched seeds drawn after preregistration, compared with avoidance off (avoidTtcS = 0), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown. — competing: [scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 4274943385, 52268190, 1826518934, 1794433502, 2585397268, 418030777, 1265804811, 3812356604, 2596307944, 3395247601.

## Primary metric: cruise_collision_episodes_per_m (1/m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 4274943385 | 0.113 | 0.060 | -0.052 | expected | `52c6b81032ad` |
| 52268190 | 0.147 | 0.000 | -0.147 | expected | `9d55771eee76` |
| 1826518934 | 0.200 | 0.000 | -0.200 | expected | `6ac2024a0e8b` |
| 1794433502 | 0.117 | 0.000 | -0.117 | expected | `987e02c34c54` |
| 2585397268 | 0.059 | 0.000 | -0.059 | expected | `98a0e223246e` |
| 418030777 | 0.181 | 0.000 | -0.181 | expected | `ed31e9e59be0` |
| 1265804811 | 0.056 | 0.000 | -0.056 | expected | `9ac008ec0abe` |
| 3812356604 | 0.117 | 0.000 | -0.117 | expected | `356e309473fd` |
| 2596307944 | 0.156 | 0.000 | -0.156 | expected | `b06567835a7c` |
| 3395247601 | 0.109 | 0.000 | -0.109 | expected | `c427058dc9e3` |

10 of 10 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 9.77e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.125, mean treatment 0.006, mean paired difference **-0.119** (minimum effect 0.12 1/m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 10.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.12: observed -0.1194 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.0010 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

Success criteria not all met (S1) and no failure criterion triggered.

Registry run `V3D-EXP-0013-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.125 | 0.006 | 1/m |
| cruise_collision_episodes_per_m | 0.125 | 0.006 | 1/m |
| collision_episodes | 2.500 | 0.100 | count |
| near_miss_fraction | 0.134 | 0.052 | fraction |
| flown_m | 19.540 | 19.109 | m |
| saccades_per_flight_s | 0.550 | 0.568 | 1/s |
| contact_s | 0.013 | 0.001 | s |

## Provenance

- Plan `475b6ede398666ba31444cd0f9c14f18fa0e48dfaaac88affdf3ad50abbbc78c`; fly `digital-fly/4 reduced-order-fsm/v1`, identity `02776ebf688fc2989a8fe4f6871b30825e567d27ea64b5aecfd3ecf2760b448c`, source `69a28d5897711f339ac6fe76bbd486a76310346b93b62093ce8874c12331380e`
- Preregistered as V3D-EXP-0013 at 2026-10-24T02:49:59.845Z (receipt `2a235843354ff999e31a189fd05eb5177caaef22c65bd33857fc8d51ccd5b532`)
- Authorized at 2026-10-24T02:49:59.921Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `5ff55ef2ae53b13849a9faab1bed5557563eec107fd4e1107ef5166f03d302ad`
- Record `338af4151901d06ad6d6c4e464430a58db380e0b3c9cd3dcdb1b6bb572f0be5e`, run `FR-846d25d777fd9bbc7d76f730`, 2026-10-24T02:49:59.955Z to 2026-10-24T02:50:21.072Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2400 fly-seconds, then again for the determinism guard
- Code: commit `c0f72973e32a0e9924a909da2a70b480994879e6`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
