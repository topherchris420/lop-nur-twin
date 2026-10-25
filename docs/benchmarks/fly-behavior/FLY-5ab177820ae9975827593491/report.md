# FLY-5ab177820ae9975827593491: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Light preference: a point light of relative intensity 2 above one quadrant of the arena, against no point light (ambient only).

**Question (host-written).** In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds?

**Hypothesis (host-written).** A point light of relative intensity 2 above one quadrant of the arena will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with no point light (ambient only), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] With a point light on, the fly's mean horizontal distance to the point below it falls. — competing: [scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 4150212689, 208816277, 3808544215, 3670991412, 3254012451, 286682298, 2719009323, 3957708201, 2907331987, 2002205190, 2554240766, 2365383840.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 4150212689 | 1.139 | 0.995 | -0.143 | expected | `83e60225863e` |
| 208816277 | 1.410 | 1.045 | -0.364 | expected | `76a950d958bf` |
| 3808544215 | 1.213 | 1.218 | 0.005 | opposite | `4e91bc9f94bc` |
| 3670991412 | 1.705 | 1.668 | -0.037 | expected | `1f685ed63c42` |
| 3254012451 | 1.593 | 1.226 | -0.368 | expected | `4432af957d2d` |
| 286682298 | 2.414 | 2.198 | -0.216 | expected | `774b20912080` |
| 2719009323 | 1.710 | 1.548 | -0.162 | expected | `9beb220072f2` |
| 3957708201 | 1.861 | 1.746 | -0.115 | expected | `8dc73dc23a1b` |
| 2907331987 | 1.376 | 1.550 | 0.174 | opposite | `892ec345368e` |
| 2002205190 | 1.563 | 2.202 | 0.639 | opposite | `05c46e69c670` |
| 2554240766 | 1.706 | 1.718 | 0.012 | opposite | `e237cdcfc056` |
| 2365383840 | 1.466 | 1.654 | 0.188 | opposite | `33c9937be41c` |

7 of 12 untied seeds in the expected direction (decrease), 5 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.3872 for the expected direction, p = 0.8062 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.596, mean treatment 1.564, mean paired difference **-0.032** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.0323 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.3872 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.8062 — does not hold

Success criteria not all met (S1, S2) and no failure criterion triggered.

Registry run `V3D-EXP-0005-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| mean_light_distance_m | 1.596 | 1.564 | m |
| time_near_light | 0.000 | 0.067 | fraction |
| active_fraction | 0.163 | 0.271 | fraction |

## Provenance

- Plan `5ab177820ae997582759349132b6f841fa1f073989f0faeb9c6792784f68d784`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `7032c32c68a11620b6dca563137872b5cdeaef39ec651b4a8a187e74461a6ca2`, source `00fb736cbacd1a73e05be653ccd063921b3b8348f54e91f207fce7e34fc3d2cb`
- Preregistered as V3D-EXP-0005 at 2026-10-25T17:29:13.653Z (receipt `0653b63966617afba903513b062b0a7b4f9e4c147942790dc099b30d1ec9e812`)
- Authorized at 2026-10-25T17:29:13.667Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `ffaf1baeed8a94b4b5b087ae468bc1afb13f5b7b645e392f787169c9ead68e50`
- Record `3d5b94177c22111b62652177f04930b47041af50d438fbe656f1784ca6d83137`, run `FR-b5afd0e1ebc566489dde15a5`, 2026-10-25T17:29:13.668Z to 2026-10-25T17:29:20.130Z
- Simulated on node 24.22.1 (V8 13.6.233.17-node.58): 2880 fly-seconds, then again for the determinism guard
- Code: commit `a71066264ba3ff3a6949316bdc0f0bcee92c5520`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
