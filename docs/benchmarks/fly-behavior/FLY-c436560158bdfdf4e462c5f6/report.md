# FLY-c436560158bdfdf4e462c5f6: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/3 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Light preference: a point light of relative intensity 2 above one quadrant of the arena, against no point light (ambient only).

**Question (host-written).** In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds?

**Hypothesis (host-written).** A point light of relative intensity 2 above one quadrant of the arena will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with no point light (ambient only), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] With a point light on, the fly's mean horizontal distance to the point below it falls. — competing: [scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 274819754, 2057493380, 2078753291, 373849455, 4179025977, 1028575322, 85040353, 2970540063, 911422894, 3962354036, 2730468069, 3018751169.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 274819754 | 1.395 | 1.305 | -0.090 | expected | `5ada12eb3829` |
| 2057493380 | 1.751 | 2.033 | 0.282 | opposite | `d32fe54ad540` |
| 2078753291 | 2.437 | 2.723 | 0.286 | opposite | `8687105505c0` |
| 373849455 | 1.166 | 0.582 | -0.584 | expected | `d67d96685452` |
| 4179025977 | 1.182 | 0.730 | -0.453 | expected | `6381f4d7184d` |
| 1028575322 | 1.593 | 1.598 | 0.005 | opposite | `243eb615ec88` |
| 85040353 | 1.258 | 0.565 | -0.693 | expected | `49d8bcbc2348` |
| 2970540063 | 1.512 | 1.496 | -0.016 | expected | `422b598913c3` |
| 911422894 | 1.737 | 1.735 | -0.002 | expected | `02418d6efe21` |
| 3962354036 | 1.411 | 1.468 | 0.057 | opposite | `a7bdfb2606ea` |
| 2730468069 | 1.363 | 1.943 | 0.580 | opposite | `036756cbe33c` |
| 3018751169 | 1.981 | 1.623 | -0.358 | expected | `267d0505a65b` |

7 of 12 untied seeds in the expected direction (decrease), 5 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.3872 for the expected direction, p = 0.8062 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.565, mean treatment 1.483, mean paired difference **-0.082** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.0822 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.3872 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.8062 — does not hold

Success criteria not all met (S1, S2) and no failure criterion triggered.

Registry run `V3D-EXP-0008-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| mean_light_distance_m | 1.565 | 1.483 | m |
| time_near_light | 0.016 | 0.225 | fraction |
| active_fraction | 0.215 | 0.315 | fraction |

## Provenance

- Plan `c436560158bdfdf4e462c5f6b5cc584d66047e3b7906fda7e4ffd570fd4a9ead`; fly `digital-fly/3 reduced-order-fsm/v1`, identity `7b78efef2d070ed356391eb8f81d736720c2bc6f7e1eba805b30572b483845de`, source `3b221211c38cbbdba6fce0480406056979e03e623b8dc5837b79fca196070b77`
- Preregistered as V3D-EXP-0008 at 2026-10-23T21:07:34.718Z (receipt `9adad4e59cf95bf553d2570dab20c9e55a273d263147eb3b444138616e3161ff`)
- Authorized at 2026-10-23T21:07:34.728Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `755ddff3a6b23efa5b327eb6ba263714a76fab466243aef64a0828c28361234c`
- Record `9d2ff14673272a2a72342d97c9e59ec72858416ce45f9bda65c3b35689b40231`, run `FR-0263f6729dc86b7fa61f8d10`, 2026-10-23T21:07:34.730Z to 2026-10-23T21:07:37.233Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2880 fly-seconds, then again for the determinism guard
- Code: commit `063c8a5fabe9f18af7ebce6d6829ad0ca6e66c18`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
