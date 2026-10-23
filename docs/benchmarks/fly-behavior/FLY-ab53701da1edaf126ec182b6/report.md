# FLY-ab53701da1edaf126ec182b6: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/3 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Adaptation to repeated looms: repeating a looming stimulus nominally every 4 s, against the same stimulus nominally every 120 s.

**Caveat.** The interval is not fixed: each presentation waits for the fly to have stood still, so the delivered interval depends on the fly's response (mean_isi_s reports it) and is longer than the nominal one.

**Question (host-written).** In the digital fly simulator, how does repeating a looming stimulus nominally every 4 s change fraction of the second half of repeated presentations answered by an escape, against the same stimulus nominally every 120 s on matched seeds?

**Hypothesis (host-written).** Repeating a looming stimulus nominally every 4 s will decrease late_escape_probability by at least 0.2 fraction on average over 12 matched seeds drawn after preregistration, compared with the same stimulus nominally every 120 s, and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Repeating the stimulus every 4 s lowers the escape probability over the later presentations, compared with every 120 s. — competing: [scripted] The stimulus stays above the escape threshold however often it repeats.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 13208710, 2316677631, 1006588832, 4153970258, 4180027178, 1656985549, 2513707455, 988291714, 586367307, 3524786734, 4103199761, 2454042905.

## Primary metric: late_escape_probability (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 13208710 | 1.000 | 0.667 | -0.333 | expected | `c6d8aed8a18a` |
| 2316677631 | 1.000 | 0.333 | -0.667 | expected | `a1a805cf538f` |
| 1006588832 | 1.000 | 0.333 | -0.667 | expected | `5867bd8bce5a` |
| 4153970258 | 1.000 | 0.333 | -0.667 | expected | `fbcf9bd414f7` |
| 4180027178 | 1.000 | 0.333 | -0.667 | expected | `62a715036004` |
| 1656985549 | 1.000 | 0.667 | -0.333 | expected | `a7ed2aa50d4b` |
| 2513707455 | 1.000 | 0.333 | -0.667 | expected | `6227ea95795b` |
| 988291714 | 1.000 | 0.333 | -0.667 | expected | `0d8d5b1a58bc` |
| 586367307 | 1.000 | 1.000 | 0.000 | tie | `8f8a6a7530e5` |
| 3524786734 | 1.000 | 0.667 | -0.333 | expected | `39723da8f88c` |
| 4103199761 | 1.000 | 0.333 | -0.667 | expected | `d499e152d3e7` |
| 2454042905 | 1.000 | 0.667 | -0.333 | expected | `d8b9856c9cf2` |

11 of 11 untied seeds in the expected direction (decrease), 0 opposite, 1 tied, 0 undefined. Exact one-sided sign test: p = 4.88e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.000, mean treatment 0.500, mean paired difference **-0.500** (minimum effect 0.2 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 0.0000 — does not hold
- **G4** untied_pairs >= 6: observed 11.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.2: observed -0.5000 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0005 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

Evidence-sufficiency guard(s) not met: G3. No conclusion drawn.

Registry run `V3D-EXP-0011-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| repeat_escape_probability | 1.000 | 0.667 | fraction |
| late_escape_probability | 1.000 | 0.500 | fraction |
| presentations | 6.000 | 6.000 | count |
| mean_isi_s | 120.000 | 9.875 | s |
| repeat_size_at_escape_deg | 48.442 | 56.103 | deg |

## Provenance

- Plan `ab53701da1edaf126ec182b6bff8aa10d5e34f98b4a5b3d496a1c7f620f290a9`; fly `digital-fly/3 reduced-order-fsm/v1`, identity `7b78efef2d070ed356391eb8f81d736720c2bc6f7e1eba805b30572b483845de`, source `3b221211c38cbbdba6fce0480406056979e03e623b8dc5837b79fca196070b77`
- Preregistered as V3D-EXP-0011 at 2026-10-23T21:07:54.460Z (receipt `e80a8b80fe364533d13a4a4aa6b2708df7d46e1d77d639e7e254bc513533fb51`)
- Authorized at 2026-10-23T21:07:54.472Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `9358aa6592ed040b970c2906ac91e66d924566a0d990404c0ebeb7090442ac03`
- Record `c1b80816fc72984f6edb351839f1d23f4a6e49ad9a0978f9194176978dbf58a8`, run `FR-c2560d9d73458ed553b728cf`, 2026-10-23T21:07:54.472Z to 2026-10-23T21:08:01.037Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 7867.97 fly-seconds, then again for the determinism guard
- Code: commit `063c8a5fabe9f18af7ebce6d6829ad0ca6e66c18`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- The interval is not fixed: each presentation waits for the fly to have stood still, so the delivered interval depends on the fly's response (mean_isi_s reports it) and is longer than the nominal one.
- Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
