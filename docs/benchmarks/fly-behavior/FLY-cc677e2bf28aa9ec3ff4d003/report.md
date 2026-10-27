# FLY-cc677e2bf28aa9ec3ff4d003: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/8 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Noisy sensing: sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions), against noiseless sensing.

**Caveat.** Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.

**Question (host-written).** In the digital fly simulator, how does sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) change mean time to collision at the escape decision, over escapes: how long the sphere's centre would still have taken to reach the fly at its approach speed (negative once it would have passed), against noiseless sensing on matched seeds?

**Hypothesis (host-written).** Sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) will increase escape_ttc_s by at least 0.24 s on average over 9 matched seeds drawn after preregistration, compared with noiseless sensing, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] Sensory noise of 0.4 makes the fly escape earlier in the approach, with more time to collision: noisy size and expansion estimates cross the escape threshold early. — competing: [scripted] Noise averages out over the approach and leaves the time to collision at the escape unchanged.

## Seeds

9 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2895357539, 1821802137, 2457456049, 1793087516, 3336883271, 402661867, 2704476975, 2291649109, 2707487673.

## Primary metric: escape_ttc_s (s)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2895357539 | 0.095 | 0.457 | 0.362 | expected | `e79c2828be39` |
| 1821802137 | 0.095 | 0.367 | 0.272 | expected | `d797aca8fbda` |
| 2457456049 | 0.083 | 0.365 | 0.282 | expected | `fbc20fc6f34c` |
| 1793087516 | 0.072 | 0.287 | 0.215 | expected | `d351ba6bd5bf` |
| 3336883271 | 0.095 | 0.423 | 0.328 | expected | `30b22d784519` |
| 402661867 | 0.095 | 0.298 | 0.203 | expected | `b437dfb75e3d` |
| 2704476975 | 0.095 | 0.395 | 0.300 | expected | `9ec3c832de0f` |
| 2291649109 | 0.095 | 0.433 | 0.338 | expected | `3b19c96dc0f5` |
| 2707487673 | 0.088 | 0.320 | 0.232 | expected | `3a9d369ed18a` |

9 of 9 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 0.0020 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.090, mean treatment 0.372, mean paired difference **0.281** (minimum effect 0.24 s).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 36: observed 36.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 9.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.24: observed 0.2813 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0020 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

All 2 success criteria held and no failure criterion triggered.

Registry run `V3D-EXP-0058-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.005 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.005 | 0.000 | 1/m |
| collision_episodes | 0.111 | 0.000 | count |
| near_miss_fraction | 0.045 | 0.012 | fraction |
| flown_m | 19.871 | 20.720 | m |
| saccades_per_flight_s | 0.570 | 0.574 | 1/s |
| contact_s | 0.001 | 0.000 | s |
| escape_probability | 1.000 | 0.981 | fraction |
| escape_ttc_s | 0.090 | 0.372 | s |
| escape_latency_s | 0.910 | 0.628 | s |
| size_at_escape_deg | 52.780 | 18.520 | deg |
| short_mode_fraction | 0.074 | 0.207 | fraction |

## Provenance

- Plan `cc677e2bf28aa9ec3ff4d003a14ef447231bd94bab38d463c97acb59e2ccda14`; fly `digital-fly/8 reduced-order-fsm/v1`, identity `c684a7f0002390bee7e62d529bc459479c35e45465749ad174bd99aca71a5f8a`, source `a96a496c4c00acead32e208158faf7889c31027b8dccde781059a4eb4481f70b`
- Preregistered as V3D-EXP-0058 at 2026-10-27T04:10:09.524Z (receipt `314a3c9600275546ee7ce458652847bbe6e0afca0c0828eaece1e1ff5d00843f`)
- Authorized at 2026-10-27T04:10:09.644Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `8199045b508319341fc170a5fe8a831159de885d365e845a06608620b67b092e`
- Record `970ddb989cd7ee61ba19e8d862e18bde9d69b82db460eb2092b0732c2e5d0160`, run `FR-bc97da1b84e2acc3370c5e2e`, 2026-10-27T04:10:09.649Z to 2026-10-27T04:10:41.156Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 2402.46 fly-seconds, then again for the determinism guard
- Code: commit `352fafda07d29c0d7f4f412073dc129fc5ac7a63`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Collisions stay near zero in both arms with avoidance on, so the collision metrics cannot discriminate. Near misses fall with noise, but in the pilot by less than the host's minimum effect for them, which the more variable avoidance-off arm of obstacle avoidance sets; the escape timing discriminates.
- Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
