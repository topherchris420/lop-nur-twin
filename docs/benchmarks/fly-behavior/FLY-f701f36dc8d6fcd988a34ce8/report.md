# FLY-f701f36dc8d6fcd988a34ce8: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Obstacle avoidance: turning away from surfaces whose time to contact falls below 0.45 s, against avoidance off (avoidTtcS = 0).

**Question (host-written).** In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds?

**Hypothesis (host-written).** Turning away from surfaces whose time to contact falls below 0.45 s will decrease cruise_collision_episodes_per_m by at least 0.12 1/m on average over 10 matched seeds drawn after preregistration, compared with avoidance off (avoidTtcS = 0), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Saccading away from surfaces under 0.45 s to contact reduces collision episodes per metre flown. — competing: [scripted] Spontaneous saccades and the arena layout alone set the collision rate; the avoidance rule changes little.

## Seeds

10 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2542723488, 1165515371, 830514007, 663104345, 270724308, 3567587045, 2746116548, 3850096610, 4025671803, 1873243485.

## Primary metric: cruise_collision_episodes_per_m (1/m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2542723488 | 0.318 | 0.000 | -0.318 | expected | `07bed04b5a76` |
| 1165515371 | 0.098 | 0.000 | -0.098 | expected | `7b92f36f4ddf` |
| 830514007 | 0.153 | 0.000 | -0.153 | expected | `38148304c0d6` |
| 663104345 | 0.115 | 0.000 | -0.115 | expected | `645791ff80e1` |
| 270724308 | 0.178 | 0.000 | -0.178 | expected | `da234502abbf` |
| 3567587045 | 0.147 | 0.000 | -0.147 | expected | `fba65c83736a` |
| 2746116548 | 0.369 | 0.000 | -0.369 | expected | `705cf99afa08` |
| 3850096610 | 0.200 | 0.000 | -0.200 | expected | `e75e26fb937c` |
| 4025671803 | 0.103 | 0.000 | -0.103 | expected | `72f21551a281` |
| 1873243485 | 0.170 | 0.000 | -0.170 | expected | `8bfee28eb4f9` |

10 of 10 untied seeds in the expected direction (decrease), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 9.77e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.185, mean treatment 0.000, mean paired difference **-0.185** (minimum effect 0.12 1/m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 20: observed 20.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 10.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.12: observed -0.1850 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0010 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0004-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.185 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.185 | 0.000 | 1/m |
| collision_episodes | 3.600 | 0.000 | count |
| near_miss_fraction | 0.170 | 0.045 | fraction |
| flown_m | 19.725 | 20.458 | m |
| saccades_per_flight_s | 0.516 | 0.538 | 1/s |
| contact_s | 0.018 | 0.000 | s |

## Provenance

- Plan `f701f36dc8d6fcd988a34ce857ac51e748588334da7216eea85b165e694969b5`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0004 at 2026-10-25T17:28:42.704Z (receipt `5af0933e6f497222a754d985030233bfa32c070d7169ab0c375b58dee0b00641`)
- Authorized at 2026-10-25T17:28:42.727Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `9c60b538b41d2ef302b2828507f31e023e1ac0fca34baa7fc8d94608c5a7b9b4`
- Record `c9a57e9fd7c1aea84239bd81c5da2af169718e1245c4e8c51535dd05b080c163`, run `FR-7ee03516e18dfc991ed3fdf1`, 2026-10-25T17:28:42.728Z to 2026-10-25T17:28:57.757Z
- Simulated on node 24.22.1 (V8 13.6.233.17-node.58): 2400 fly-seconds, then again for the determinism guard
- Code: commit `a71066264ba3ff3a6949316bdc0f0bcee92c5520`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
