# FLY-9db369934b71bd4252a21c9e: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Obstacle avoidance: turning away from surfaces whose time to contact falls below 0.45 s, against avoidance off (avoidTtcS = 0).

**Question (host-written).** In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds?

**Hypothesis (host-written).** Turning away from surfaces whose time to contact falls below 0.45 s will decrease cruise_collision_episodes_per_m by at least 0.12 1/m on average over 10 matched seeds drawn after preregistration, compared with avoidance off (avoidTtcS = 0), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown. — competing: [scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 229599088, 3889082778, 1903672416, 3685689086, 366172749, 4054053591, 2591316917, 3253955374, 435616086, 751007771.

## Primary metric: cruise_collision_episodes_per_m (1/m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 229599088 | 0.102 | 0.000 | -0.102 | expected | `1feb244e5ca2` |
| 3889082778 | 0.275 | 0.000 | -0.275 | expected | `716ef3ec34c3` |
| 1903672416 | 0.175 | 0.000 | -0.175 | expected | `09baf96bb48c` |
| 3685689086 | 0.055 | 0.000 | -0.055 | expected | `617bc262b1e5` |
| 366172749 | 0.124 | 0.000 | -0.124 | expected | `d6fbe8be000c` |
| 4054053591 | 0.275 | 0.000 | -0.275 | expected | `c77d8b644bb6` |
| 2591316917 | 0.276 | 0.000 | -0.276 | expected | `73c815b6592c` |
| 3253955374 | 0.109 | 0.000 | -0.109 | expected | `a0b933b06eeb` |
| 435616086 | 0.275 | 0.000 | -0.275 | expected | `c1efdde61d6a` |
| 751007771 | 0.193 | 0.000 | -0.193 | expected | `f6bbc4b45eb4` |

10 of 10 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 9.77e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.186, mean treatment 0.000, mean paired difference **-0.186** (minimum effect 0.12 1/m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 10.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.12: observed -0.1859 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0010 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0046-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.186 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.186 | 0.000 | 1/m |
| collision_episodes | 3.700 | 0.000 | count |
| near_miss_fraction | 0.179 | 0.030 | fraction |
| flown_m | 19.573 | 19.549 | m |
| saccades_per_flight_s | 0.542 | 0.572 | 1/s |
| contact_s | 0.018 | 0.000 | s |

## Provenance

- Plan `9db369934b71bd4252a21c9e2a9dee7689e7875cad2a4c378955b9f3064f40c4`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `8d86753f0ca7a7395da5a6b7f3902bd120428b515dc616340ef12e9ae0489eed`, source `86708015e47c271602b7856459ea1d6ff513ea0f1df0bb8587c3f192a417f022`
- Preregistered as V3D-EXP-0046 at 2026-10-26T23:25:42.047Z (receipt `7b21610f1a36d8823a32d2a103159d2ec87f33d8cf0756444d334be615b61c60`)
- Authorized at 2026-10-26T23:25:42.082Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `a9a301b5cc7dae9ffc48a4791c9f9f4f644e59f5b4096b6bd7d2e1bfc55cc4a1`
- Record `449e1b611f8b0e14f5b0d98177b27654b8ff6e05a6f1c3bd26e1c2a4e89ec3b7`, run `FR-8075bf15fe565e4ecfcca9e9`, 2026-10-26T23:25:42.100Z to 2026-10-26T23:25:50.493Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2400 fly-seconds, then again for the determinism guard
- Code: commit `fb76ce5c5fc61f279bc5980bd1ea22863c0cdb8d`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
