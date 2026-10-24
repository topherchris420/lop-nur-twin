# FLY-2d2d5d7c59055ac04db0918e: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/6 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Obstacle avoidance: turning away from surfaces whose time to contact falls below 0.45 s, against avoidance off (avoidTtcS = 0).

**Question (host-written).** In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds?

**Hypothesis (host-written).** Turning away from surfaces whose time to contact falls below 0.45 s will decrease cruise_collision_episodes_per_m by at least 0.12 1/m on average over 10 matched seeds drawn after preregistration, compared with avoidance off (avoidTtcS = 0), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown. — competing: [scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1478288518, 3668085644, 3751760681, 698469426, 344562778, 3101939558, 155919308, 2385777882, 3645080606, 3778356451.

## Primary metric: cruise_collision_episodes_per_m (1/m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1478288518 | 0.193 | 0.000 | -0.193 | expected | `5f7f0f5bc657` |
| 3668085644 | 0.249 | 0.000 | -0.249 | expected | `c1739a66cfa5` |
| 3751760681 | 0.155 | 0.038 | -0.117 | expected | `cae83c2de848` |
| 698469426 | 0.146 | 0.000 | -0.146 | expected | `59b5c2cb1ed8` |
| 344562778 | 0.090 | 0.000 | -0.090 | expected | `77faa24067d3` |
| 3101939558 | 0.047 | 0.000 | -0.047 | expected | `f7848cebe64e` |
| 155919308 | 0.047 | 0.000 | -0.047 | expected | `e00f342493cd` |
| 2385777882 | 0.164 | 0.000 | -0.164 | expected | `509a645c09f2` |
| 3645080606 | 0.453 | 0.000 | -0.453 | expected | `687a14d35cef` |
| 3778356451 | 0.000 | 0.000 | 0.000 | tie | `a42c6cad70d5` |

9 of 9 untied seeds in the expected direction (decrease), 0 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.154, mean treatment 0.004, mean paired difference **-0.151** (minimum effect 0.12 1/m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.12: observed -0.1506 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0001-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.154 | 0.004 | 1/m |
| cruise_collision_episodes_per_m | 0.154 | 0.004 | 1/m |
| collision_episodes | 3.100 | 0.100 | count |
| near_miss_fraction | 0.128 | 0.044 | fraction |
| flown_m | 20.390 | 20.614 | m |
| saccades_per_flight_s | 0.524 | 0.561 | 1/s |
| contact_s | 0.015 | 0.001 | s |

## Provenance

- Plan `2d2d5d7c59055ac04db0918e4a49dfde9aa28b75e78a6973d32ab7031f371ca7`; fly `digital-fly/6 reduced-order-fsm/v1`, identity `ad5cea56d67036ecf47acddc8bcad249ff0eea83de3593c3b9850b524eb4f46d`, source `167ae70ac8ff41678590d70cf73640164392e6c73b9b1613b5f075575b715d87`
- Preregistered as V3D-EXP-0001 at 2026-10-24T19:24:38.467Z (receipt `2d270b8963407c9e2bf0e70b9b1f509d9990e5979f3c0e3853fb0a710a66a8aa`)
- Authorized at 2026-10-24T19:24:38.489Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `1613f677c45f77a130a9ebcb2a2fea8ecf2c1dd1a44bd6d13c5d7b0b140aa668`
- Record `6d1e8bbd521a2eded765cf0a49659c03b904d0829fa04f01bf84a466156943e1`, run `FR-2a0e2123c5f38da72ebb29ab`, 2026-10-24T19:24:38.494Z to 2026-10-24T19:24:54.930Z
- Simulated on node 22.22.0 (V8 12.4.254.21-node.33): 2400 fly-seconds, then again for the determinism guard
- Code: commit `300a2aa64e7d8771297c525e8b7159a56e84aeb6`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
