# FLY-0118dde9b0fc3ea7af37a97d: FAILED (not supported)

> Simulated observations of the digital fly (digital-fly/2 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.

**Protocol.** Noisy sensing: relative sensory noise of 0.4, against noiseless sensing; seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12.

**Question (host-written).** In the digital fly simulator, how does relative sensory noise of 0.4 change collision episodes per metre flown in pillar clutter, against noiseless sensing on matched seeds?

**Hypothesis (host-written).** Relative sensory noise of 0.4 will increase collision_episodes_per_m by at least 0.05 1/m on average over matched seeds, compared with noiseless sensing, in the expected direction in at least 8 of 12 seeds.

**Design words (scripted).** [scripted] Relative sensory noise of 0.4 raises collision episodes per metre flown. — competing: [scripted] Noise on distance estimates averages out over a fan of rays and leaves the collision rate unchanged.

## Primary metric: collision_episodes_per_m (1/m)

| seed | control | treatment | difference | treatment final state |
| ---: | ---: | ---: | ---: | :--- |
| 1 | 0.000 | 0.000 | 0.000 | `09060353dc96` |
| 2 | 0.000 | 0.000 | 0.000 | `3dc014ba5c18` |
| 3 | 0.000 | 0.000 | 0.000 | `a681c455f7ef` |
| 4 | 0.000 | 0.000 | 0.000 | `451793c95727` |
| 5 | 0.000 | 0.000 | 0.000 | `7f0f8f086d36` |
| 6 | 0.000 | 0.000 | 0.000 | `5e29348619b6` |
| 7 | 0.000 | 0.000 | 0.000 | `d173884eca51` |
| 8 | 0.000 | 0.000 | 0.000 | `11ade37b8e67` |
| 9 | 0.000 | 0.000 | 0.000 | `60a8873ac637` |
| 10 | 0.000 | 0.000 | 0.000 | `c942daf7ec4d` |
| 11 | 0.000 | 0.000 | 0.000 | `611d1097bb46` |
| 12 | 0.000 | 0.000 | 0.000 | `3e4e26e33328` |

Mean control 0.000, mean treatment 0.000, mean paired difference **0.000**; 0 of 12 seeds in the expected direction, 0 opposite, 12 unchanged.

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 48: observed 48.000 — holds
- **G2** determinism_check >= 1: observed 1.000 — holds
- **S1** mean_paired_delta >= 0.05: observed 0.000 — does not hold
- **S2** seeds_expected_direction >= 8: observed 0.000 — does not hold
- **F1** mean_paired_delta <= 0: observed 0.000 — holds

Registry run `V3D-EXP-0004-RUN-0001`: status **failed**, verdict **not_supported**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.000 | 1/m |
| collision_episodes | 0.000 | 0.000 | count |
| flown_m | 10.210 | 10.506 | m |
| saccades_per_flight_s | 0.593 | 0.584 | 1/s |
| contact_s | 0.000 | 0.000 | s |
| escape_probability | 0.931 | 0.861 | fraction |
| escape_latency_s | 0.907 | 0.757 | s |
| escape_lead_s | 0.013 | 0.162 | s |
| size_at_escape_deg | 50.284 | 26.397 | deg |
| short_mode_fraction | 0.047 | 0.378 | fraction |

## Provenance

- Plan digest `0118dde9b0fc3ea7af37a97d6b54e424c902c08a20e7b38c460001f71e3c90ad`, fly `digital-fly/2 reduced-order-fsm/v1` with parameter table `c1374e61ce7a9d2e89b12759ab33401b9b6ea8074e21404390d9810078642daa`
- Record `3713867a3a2506b40259a687a62c110629923f1e5f4b9ac94d0950e875685ca0`, run `FR-c89537242c244ed94439aae3`; authorized by Scripted.DemoOperator (local operator attestation; identity not verified)
- 1759.68 fly-seconds simulated, then simulated again for the determinism guard
- Producing commit `b8400fdf3f676d6ee9e090760921eff7c419df22` with uncommitted changes
- Design written by a script (no model involved)

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
