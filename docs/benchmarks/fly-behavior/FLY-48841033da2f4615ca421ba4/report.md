# FLY-48841033da2f4615ca421ba4: PASSED (supported)

> Simulated observations of the digital fly (digital-fly/2 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.

**Protocol.** Visual threat: a 4 cm sphere approaching the standing fly at 1 m/s, against the same sphere receding along the same line at the same speed; seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12.

**Question (host-written).** In the digital fly simulator, how does a 4 cm sphere approaching the standing fly at 1 m/s change fraction of single-stimulus trials answered by an escape takeoff, against the same sphere receding along the same line at the same speed on matched seeds?

**Hypothesis (host-written).** A 4 cm sphere approaching the standing fly at 1 m/s will increase escape_probability by at least 0.3 fraction on average over matched seeds, compared with the same sphere receding along the same line at the same speed, in the expected direction in at least 8 of 12 seeds.

**Design words (scripted).** [scripted] A sphere approaching at 1 m/s raises the escape probability over the same sphere receding along the same line. — competing: [scripted] Any moving object in view triggers the escape proxy, approaching or not.

## Primary metric: escape_probability (fraction)

| seed | control | treatment | difference | treatment final state |
| ---: | ---: | ---: | ---: | :--- |
| 1 | 0.000 | 1.000 | 1.000 | `15168daf9003` |
| 2 | 0.000 | 1.000 | 1.000 | `ccefc42a7646` |
| 3 | 0.000 | 0.833 | 0.833 | `c225ce556810` |
| 4 | 0.000 | 0.833 | 0.833 | `b7a95ec72c9d` |
| 5 | 0.000 | 1.000 | 1.000 | `809dfe093e21` |
| 6 | 0.000 | 1.000 | 1.000 | `55ebb57ad8b2` |
| 7 | 0.000 | 0.833 | 0.833 | `cafa0ce7f9fd` |
| 8 | 0.000 | 1.000 | 1.000 | `98ccc63e28ee` |
| 9 | 0.000 | 0.833 | 0.833 | `f9960a3451a8` |
| 10 | 0.000 | 1.000 | 1.000 | `ab3e46a00b99` |
| 11 | 0.000 | 1.000 | 1.000 | `717cd95fef9a` |
| 12 | 0.000 | 0.833 | 0.833 | `a57d2a7b5e53` |

Mean control 0.000, mean treatment 0.931, mean paired difference **0.931**; 12 of 12 seeds in the expected direction, 0 opposite, 0 unchanged.

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.000 — holds
- **G2** determinism_check >= 1: observed 1.000 — holds
- **S1** mean_paired_delta >= 0.3: observed 0.931 — holds
- **S2** seeds_expected_direction >= 8: observed 12.000 — holds
- **F1** mean_paired_delta <= 0: observed 0.931 — does not hold

Registry run `V3D-EXP-0003-RUN-0001`: status **passed**, verdict **supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| escape_probability | 0.000 | 0.931 | fraction |
| escape_latency_s | — | 0.907 | s |
| escape_lead_s | — | 0.013 | s |
| size_at_escape_deg | — | 50.284 | deg |
| short_mode_fraction | — | 0.047 | fraction |

## Provenance

- Plan digest `48841033da2f4615ca421ba453bdb70024b6877f624308c0a5141203cf57d9a7`, fly `digital-fly/2 reduced-order-fsm/v1` with parameter table `c1374e61ce7a9d2e89b12759ab33401b9b6ea8074e21404390d9810078642daa`
- Record `d22e3df814cd9db72eb107e393ab37e997fcaa144b4ffe6a85333dd84f3aae83`, run `FR-cae65c8663b20f2287a66625`; authorized by Scripted.DemoOperator (local operator attestation; identity not verified)
- 319.68 fly-seconds simulated, then simulated again for the determinism guard
- Producing commit `b8400fdf3f676d6ee9e090760921eff7c419df22` with uncommitted changes
- Design written by a script (no model involved)

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
