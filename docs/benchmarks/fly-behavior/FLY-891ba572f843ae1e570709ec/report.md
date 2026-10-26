# FLY-891ba572f843ae1e570709ec: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Light preference: a point light of relative intensity 2 above one quadrant of the arena, against no point light (ambient only).

**Question (host-written).** In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds?

**Hypothesis (host-written).** A point light of relative intensity 2 above one quadrant of the arena will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with no point light (ambient only), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] With a point light on, the fly's mean horizontal distance to the point below it falls. — competing: [scripted] The phototaxis term is too weak against the fly's other drives to move where it spends its time.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1260627507, 989593268, 1211230315, 3051909413, 2136697771, 3703247060, 250654193, 4081990605, 1843508768, 1523538967, 1236230830, 928347600.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1260627507 | 1.408 | 0.981 | -0.427 | expected | `a6bfe131fd0f` |
| 989593268 | 1.557 | 1.640 | 0.083 | opposite | `dafffc36cc37` |
| 1211230315 | 1.530 | 2.050 | 0.520 | opposite | `3334288686e6` |
| 3051909413 | 1.408 | 0.738 | -0.670 | expected | `3e20177b8ebc` |
| 2136697771 | 1.648 | 1.959 | 0.311 | opposite | `bfb231440db4` |
| 3703247060 | 1.263 | 1.253 | -0.009 | expected | `f8130ba43ccf` |
| 250654193 | 1.901 | 1.867 | -0.034 | expected | `21c62c4022a9` |
| 4081990605 | 1.466 | 1.470 | 0.004 | opposite | `92ef3636274e` |
| 1843508768 | 1.656 | 1.701 | 0.045 | opposite | `fd876d5b7168` |
| 1523538967 | 0.851 | 1.203 | 0.352 | opposite | `95819ac0653c` |
| 1236230830 | 1.286 | 1.118 | -0.168 | expected | `31a85401d603` |
| 928347600 | 1.262 | 1.113 | -0.149 | expected | `321b77b236ef` |

6 of 12 untied seeds in the expected direction (decrease), 6 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.6128 for the expected direction, p = 0.6128 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.436, mean treatment 1.424, mean paired difference **-0.012** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.0120 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.6128 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.6128 — does not hold

Success criteria not all met (S1, S2) and no failure criterion triggered.

Registry run `V3D-EXP-0020-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| mean_light_distance_m | 1.436 | 1.424 | m |
| time_near_light | 0.059 | 0.142 | fraction |
| active_fraction | 0.143 | 0.215 | fraction |

## Provenance

- Plan `891ba572f843ae1e570709ece530c8a04cce1cfef6a308aeaf8c2a201ec6025e`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `44a4d99fc81cf563bb4ff40377cff7d1ae9881d95c6cf3b17851e5804539805d`, source `b794ba087d2c9dbb0d589758d6d2e0a89d958b3f2b626d50ab3388266513a682`
- Preregistered as V3D-EXP-0020 at 2026-10-26T05:41:50.860Z (receipt `a38d902b86b23e40b174f96ef23f4e2d4c68e03d99a72a2f6d4affb0bdf47c54`)
- Authorized at 2026-10-26T05:41:50.950Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `5bb7ea8dab4c45a092e01afa71329a459b40502b7bff0f7db5b572ce033ff5a2`
- Record `3a50e2ee715e3b0ade53c02009745943be1ac51f8838bbc31061ab123e9a2235`, run `FR-83b5d4f146eb8aeeb3357c38`, 2026-10-26T05:41:50.953Z to 2026-10-26T05:42:04.614Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2880 fly-seconds, then again for the determinism guard
- Code: commit `6ea1990ebc33011e02ad26083bebb719dc837d1b`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
