# FLY-3f2f1b7cbc14f0f27c52421a: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/3 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Noisy sensing: relative sensory noise of 0.4, against noiseless sensing.

**Caveat.** As designed it cannot discriminate on its clutter metrics: with avoidance on, collisions are near zero in both arms, so the control sits at its floor or the seeds tie.

**Question (host-written).** In the digital fly simulator, how does relative sensory noise of 0.4 change collision episodes per metre flown in pillar clutter, against noiseless sensing on matched seeds?

**Hypothesis (host-written).** Relative sensory noise of 0.4 will increase collision_episodes_per_m by at least 0.05 1/m on average over 12 matched seeds drawn after preregistration, compared with noiseless sensing, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Relative sensory noise of 0.4 raises collision episodes per metre flown. — competing: [scripted] Noise on distance estimates averages out over a fan of rays and leaves the collision rate unchanged.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 1801322543, 2125320687, 399623117, 1727263716, 2548461076, 4017229377, 955008948, 2807568432, 3028253826, 3991766647, 1384861008, 2845906872.

## Primary metric: collision_episodes_per_m (1/m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 1801322543 | 0.000 | 0.000 | 0.000 | tie | `1e8f57b2dd52` |
| 2125320687 | 0.000 | 0.000 | 0.000 | tie | `497a810c3991` |
| 399623117 | 0.000 | 0.000 | 0.000 | tie | `ff35404c9119` |
| 1727263716 | 0.000 | 0.000 | 0.000 | tie | `fea17d80ef2c` |
| 2548461076 | 0.000 | 0.000 | 0.000 | tie | `4705aa03cff2` |
| 4017229377 | 0.000 | 0.000 | 0.000 | tie | `058589e8b3da` |
| 955008948 | 0.000 | 0.000 | 0.000 | tie | `bb0d16da1062` |
| 2807568432 | 0.000 | 0.000 | 0.000 | tie | `e15d011d0a67` |
| 3028253826 | 0.000 | 0.000 | 0.000 | tie | `64724283596b` |
| 3991766647 | 0.000 | 0.000 | 0.000 | tie | `80ba29d71081` |
| 1384861008 | 0.000 | 0.000 | 0.000 | tie | `b3ecd5f83aaf` |
| 2845906872 | 0.000 | 0.000 | 0.000 | tie | `2268bf96c988` |

0 of 0 untied seeds in the expected direction (increase), 0 opposite, 12 tied, 0 undefined. Exact one-sided sign test: p = 1.0000 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.000, mean treatment 0.000, mean paired difference **0.000** (minimum effect 0.05 1/m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 48: observed 48.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 0.0000 — does not hold
- **G4** untied_pairs >= 6: observed 0.0000 — does not hold
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.05: observed 0.0000 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 1.0000 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

Evidence-sufficiency guard(s) not met: G3, G4. No conclusion drawn.

Registry run `V3D-EXP-0010-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| collision_episodes | 0.000 | 0.000 | count |
| flown_m | 10.864 | 11.062 | m |
| saccades_per_flight_s | 0.536 | 0.581 | 1/s |
| contact_s | 0.000 | 0.000 | s |
| escape_probability | 0.903 | 0.833 | fraction |
| escape_latency_s | 0.908 | 0.731 | s |
| escape_lead_s | 0.012 | 0.189 | s |
| size_at_escape_deg | 50.510 | 23.730 | deg |
| short_mode_fraction | 0.069 | 0.388 | fraction |

## Provenance

- Plan `3f2f1b7cbc14f0f27c52421a7e492561d7dcf99c8ae8f47fb238ab854de3129d`; fly `digital-fly/3 reduced-order-fsm/v1`, identity `7b78efef2d070ed356391eb8f81d736720c2bc6f7e1eba805b30572b483845de`, source `3b221211c38cbbdba6fce0480406056979e03e623b8dc5837b79fca196070b77`
- Preregistered as V3D-EXP-0010 at 2026-10-23T21:07:43.659Z (receipt `113230b16a9cdd09409d231aa453d6757a3c4caba1f25772ae7faf8862ed493a`)
- Authorized at 2026-10-23T21:07:43.672Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `9a3dc95f878cfc26fb45a0e10d8a19ca70687564049b6510a12a8ee1e9224a70`
- Record `2b6844683e20d275508e5e726f624131569717100a25bf1fe7325dd7261f0875`, run `FR-3fcdc752d5d40d7d47e4984e`, 2026-10-23T21:07:43.673Z to 2026-10-23T21:07:48.232Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 1759.68 fly-seconds, then again for the determinism guard
- Code: commit `063c8a5fabe9f18af7ebce6d6829ad0ca6e66c18`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- As designed it cannot discriminate on its clutter metrics: with avoidance on, collisions are near zero in both arms, so the control sits at its floor or the seeds tie.
- Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
