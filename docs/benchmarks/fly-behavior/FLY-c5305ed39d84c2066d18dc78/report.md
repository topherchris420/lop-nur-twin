# FLY-c5305ed39d84c2066d18dc78: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Obstacle avoidance: turning away from surfaces whose time to contact falls below 0.45 s, against avoidance off (avoidTtcS = 0).

**Question (host-written).** In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds?

**Hypothesis (host-written).** Turning away from surfaces whose time to contact falls below 0.45 s will decrease cruise_collision_episodes_per_m by at least 0.12 1/m on average over 10 matched seeds drawn after preregistration, compared with avoidance off (avoidTtcS = 0), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown. — competing: [scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1849555437, 4290901145, 1188488300, 162480335, 2371083424, 1387040359, 3620480921, 2428733121, 1480611806, 1435964354.

## Primary metric: cruise_collision_episodes_per_m (1/m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1849555437 | 0.000 | 0.000 | 0.000 | tie | `ac3f4fa622ae` |
| 4290901145 | 0.529 | 0.000 | -0.529 | expected | `d83e7f23aea8` |
| 1188488300 | 0.047 | 0.000 | -0.047 | expected | `cd2bb4ffb3e8` |
| 162480335 | 0.091 | 0.000 | -0.091 | expected | `0ea2050e15cd` |
| 2371083424 | 0.000 | 0.000 | 0.000 | tie | `db204f734b76` |
| 1387040359 | 0.142 | 0.000 | -0.142 | expected | `75b4f7daad87` |
| 3620480921 | 0.208 | 0.000 | -0.208 | expected | `fa85d6f54434` |
| 2428733121 | 0.000 | 0.000 | 0.000 | tie | `3068f2ce7b9f` |
| 1480611806 | 0.103 | 0.000 | -0.103 | expected | `922f188103d9` |
| 1435964354 | 0.301 | 0.000 | -0.301 | expected | `0a330153f58b` |

7 of 7 untied seeds in the expected direction (decrease), 0 opposite, 3 tied, 0 undefined. Exact one-sided sign test: p = 0.0078 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.142, mean treatment 0.000, mean paired difference **-0.142** (minimum effect 0.12 1/m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 7.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.12: observed -0.1422 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0078 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0037-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.147 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.142 | 0.000 | 1/m |
| collision_episodes | 2.900 | 0.000 | count |
| near_miss_fraction | 0.132 | 0.041 | fraction |
| flown_m | 19.635 | 19.452 | m |
| saccades_per_flight_s | 0.543 | 0.592 | 1/s |
| contact_s | 0.015 | 0.000 | s |

## Provenance

- Plan `c5305ed39d84c2066d18dc788907ae87a5bb39701382b5cdb6fda72455a0a41b`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `e2eb5e95c355777d19a210820fb203fc9ef47608031b98fa85882280e85cfdca`, source `daad49019246c38c2673cd442ecaae50eba95994635676bdc333b5563cebfb78`
- Preregistered as V3D-EXP-0037 at 2026-10-26T20:14:32.439Z (receipt `7ec2435035d89dd78403b69645882d15f5d5f4ce5f78cd0719e8a465dfd017c9`)
- Authorized at 2026-10-26T20:14:32.467Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `3f31afd26609655813955457adf4b0a05599350bfcfa3cd6178829d9249eb12b`
- Record `2270329c14d0a6491319f6144ef7b07b81e262fc0907641064761d5df3cc3b6d`, run `FR-b95037a2acaf171704706c19`, 2026-10-26T20:14:32.478Z to 2026-10-26T20:14:40.746Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2400 fly-seconds, then again for the determinism guard
- Code: commit `379fb9debfbd203f99d6c76ac80097706945dd2d`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
