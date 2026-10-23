# FLY-f51180d4bb06123a30f4c289: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/2 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.

**Protocol.** Adaptation to repeated looms: repeating a looming stimulus every 4 s, against the same stimulus every 120 s; seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12.

**Question (host-written).** In the digital fly simulator, how does repeating a looming stimulus every 4 s change fraction of the second half of repeated presentations answered by an escape, against the same stimulus every 120 s on matched seeds?

**Hypothesis (host-written).** Repeating a looming stimulus every 4 s will decrease late_escape_probability by at least 0.2 fraction on average over matched seeds, compared with the same stimulus every 120 s, in the expected direction in at least 8 of 12 seeds.

**Design words (scripted).** [scripted] Repeating the stimulus every 4 s lowers the escape probability over the later presentations, compared with every 120 s. — competing: [scripted] The stimulus stays above the escape threshold however often it repeats.

## Primary metric: late_escape_probability (fraction)

| seed | control | treatment | difference | treatment final state |
| ---: | ---: | ---: | ---: | :--- |
| 1 | 1.000 | 0.667 | -0.333 | `28e575bc1a00` |
| 2 | 1.000 | 1.000 | 0.000 | `83cbc7d2bb8c` |
| 3 | 1.000 | 1.000 | 0.000 | `eae4f5ed5d40` |
| 4 | 1.000 | 0.667 | -0.333 | `2f8de5c77589` |
| 5 | 1.000 | 0.667 | -0.333 | `2beb0397c46a` |
| 6 | 1.000 | 0.333 | -0.667 | `72accc42f3d9` |
| 7 | 1.000 | 1.000 | 0.000 | `2670ee6f539a` |
| 8 | 1.000 | 0.333 | -0.667 | `a4ba5d0b879a` |
| 9 | 1.000 | 0.667 | -0.333 | `9f0e4910aa25` |
| 10 | 1.000 | 1.000 | 0.000 | `804f8ed53f6d` |
| 11 | 1.000 | 1.000 | 0.000 | `789d3892b2a3` |
| 12 | 1.000 | 0.667 | -0.333 | `b044e21df456` |

Mean control 1.000, mean treatment 0.750, mean paired difference **-0.250**; 7 of 12 seeds in the expected direction, 0 opposite, 5 unchanged.

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.000 — holds
- **G2** determinism_check >= 1: observed 1.000 — holds
- **S1** mean_paired_delta <= -0.2: observed -0.250 — holds
- **S2** seeds_expected_direction >= 8: observed 7.000 — does not hold
- **F1** mean_paired_delta >= 0: observed -0.250 — does not hold

Registry run `V3D-EXP-0005-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| repeat_escape_probability | 1.000 | 0.875 | fraction |
| late_escape_probability | 1.000 | 0.750 | fraction |
| presentations | 6.000 | 6.000 | count |
| mean_isi_s | 120.000 | 12.642 | s |
| repeat_size_at_escape_deg | 48.442 | 57.349 | deg |

## Provenance

- Plan digest `f51180d4bb06123a30f4c2891239d1b5870eb5e984574aa109d6c0186e39f176`, fly `digital-fly/2 reduced-order-fsm/v1` with parameter table `c1374e61ce7a9d2e89b12759ab33401b9b6ea8074e21404390d9810078642daa`
- Record `17b02fa0411bd915adb6f2f07a218b055cbe69c84f6ae0883cf03c55439d80ce`, run `FR-1fdc77df1befc8697b8ebd35`; authorized by Scripted.DemoOperator (local operator attestation; identity not verified)
- 8033.975 fly-seconds simulated, then simulated again for the determinism guard
- Producing commit `b8400fdf3f676d6ee9e090760921eff7c419df22` with uncommitted changes
- Design written by a script (no model involved)

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
