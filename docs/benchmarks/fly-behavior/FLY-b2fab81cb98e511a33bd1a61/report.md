# FLY-b2fab81cb98e511a33bd1a61: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Obstacle avoidance: turning away from surfaces whose time to contact falls below 0.45 s, against avoidance off (avoidTtcS = 0).

**Question (host-written).** In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds?

**Hypothesis (host-written).** Turning away from surfaces whose time to contact falls below 0.45 s will decrease cruise_collision_episodes_per_m by at least 0.12 1/m on average over 10 matched seeds drawn after preregistration, compared with avoidance off (avoidTtcS = 0), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown. — competing: [scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 411214530, 446816014, 3825647857, 3915298638, 1853735678, 3847179266, 248501780, 1770616963, 3592502, 3928289207.

## Primary metric: cruise_collision_episodes_per_m (1/m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 411214530 | 0.198 | 0.000 | -0.198 | expected | `ce217e3ac36f` |
| 446816014 | 0.138 | 0.040 | -0.098 | expected | `4a59675be3ee` |
| 3825647857 | 0.129 | 0.000 | -0.129 | expected | `32ca19d8a39e` |
| 3915298638 | 0.439 | 0.000 | -0.439 | expected | `c22a19093960` |
| 1853735678 | 0.223 | 0.000 | -0.223 | expected | `4ddadf55a402` |
| 3847179266 | 0.175 | 0.000 | -0.175 | expected | `8f79643c33dc` |
| 248501780 | 0.102 | 0.000 | -0.102 | expected | `891ef9597b80` |
| 1770616963 | 0.248 | 0.000 | -0.248 | expected | `8fa90c36d584` |
| 3592502 | 0.351 | 0.000 | -0.351 | expected | `f24e1dbcf1c5` |
| 3928289207 | 0.098 | 0.000 | -0.098 | expected | `bd077a5fc3c0` |

10 of 10 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 9.77e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.210, mean treatment 0.004, mean paired difference **-0.206** (minimum effect 0.12 1/m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 10.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.12: observed -0.2061 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0010 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0001-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.216 | 0.004 | 1/m |
| cruise_collision_episodes_per_m | 0.210 | 0.004 | 1/m |
| collision_episodes | 4.200 | 0.100 | count |
| near_miss_fraction | 0.189 | 0.055 | fraction |
| flown_m | 19.965 | 20.712 | m |
| saccades_per_flight_s | 0.487 | 0.553 | 1/s |
| contact_s | 0.021 | 0.001 | s |

## Provenance

- Plan `b2fab81cb98e511a33bd1a619e3bb35767cd1692968e0f899fdb3d3d1d1055e8`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `247197565afacdeda5b29bdca1a24744fd547120e39f1a35621689f2e9c90905`, source `d77a3a3961b0700f93c794a7dd8e0f3d3a9c0fd68661cfc324711c1ebf407c6c`
- Preregistered as V3D-EXP-0001 at 2026-10-24T21:21:45.135Z (receipt `bb2222868a247d0ef50f2035517b4ffcf419636f9513cee615098d5bf8a5f733`)
- Authorized at 2026-10-24T21:21:45.162Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `04350dd09620aee3b8dc0aefc4f1e5e4827fe01c5c7f4e91b086183462b910dd`
- Record `f78dd46d5c8afc1bd61b77d54a93c219e5d03e8bb2145a78c187f4f5fc043400`, run `FR-89450c158a6b90839417cf56`, 2026-10-24T21:21:45.167Z to 2026-10-24T21:22:02.388Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2400 fly-seconds, then again for the determinism guard
- Code: commit `74216e15e42796df5684c31d82522e7234054d76`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
