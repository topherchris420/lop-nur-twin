# FLY-5dd05900c2cf5f775e72c6e0: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/7 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Controller comparison: controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5), against controller configuration A (the default parameters).

**Question (host-written).** In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds?

**Hypothesis (host-written).** Controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) will decrease mean_light_distance_m by at least 0.1 m on average over 12 matched seeds drawn after preregistration, compared with controller configuration A (the default parameters), and an exact one-sided sign test on the seeds that differ will find the decrease at alpha 0.05.

**Design words (scripted).** [scripted] Configuration B (phototaxisGain 1.5, avoidTtcS 0.3) lowers the mean distance to the light. — competing: [scripted] Steering gain matters less than how often the fly flies, which both configurations share.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 16388472, 134119494, 4190784097, 1295870988, 1199436059, 3648634255, 3936190897, 3465349893, 3363401238, 4116323576, 3459978200, 2542275821.

## Primary metric: mean_light_distance_m (m)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 16388472 | 2.710 | 2.710 | 0.000 | tie | `d47df9205f6e` |
| 134119494 | 1.437 | 1.024 | -0.412 | expected | `63c9fe72e691` |
| 4190784097 | 1.239 | 1.260 | 0.021 | opposite | `df1fc37f7688` |
| 1295870988 | 1.787 | 1.740 | -0.047 | expected | `751768c9919b` |
| 1199436059 | 1.737 | 1.726 | -0.011 | expected | `4cd588d082dc` |
| 3648634255 | 1.359 | 1.367 | 0.009 | opposite | `c355c31e6bd5` |
| 3936190897 | 0.460 | 0.479 | 0.019 | opposite | `f5e097876b25` |
| 3465349893 | 1.236 | 1.091 | -0.145 | expected | `961181297a48` |
| 3363401238 | 1.402 | 1.402 | 0.000 | tie | `13c935e11f97` |
| 4116323576 | 0.945 | 0.899 | -0.046 | expected | `c9f2becb2fe2` |
| 3459978200 | 0.426 | 0.258 | -0.168 | expected | `2a1a8704d705` |
| 2542275821 | 1.244 | 1.588 | 0.344 | opposite | `c761c35f647e` |

6 of 10 untied seeds in the expected direction (decrease), 4 opposite, 2 tied, 0 undefined. Exact one-sided sign test: p = 0.3770 for the expected direction, p = 0.8281 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 1.332, mean treatment 1.296, mean paired difference **-0.036** (minimum effect 0.1 m).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 72: observed 72.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 1.0000 — holds
- **G4** untied_pairs >= 6: observed 10.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta <= -0.1: observed -0.0362 — does not hold
- **S2** sign_test_p_expected <= 0.05: observed 0.3770 — does not hold
- **F1** sign_test_p_opposite <= 0.05: observed 0.8281 — does not hold

Success criteria not all met (S1, S2) and no failure criterion triggered.

Registry run `V3D-EXP-0024-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| collision_episodes_per_m | 0.000 | 0.012 | 1/m |
| cruise_collision_episodes_per_m | 0.000 | 0.012 | 1/m |
| collision_episodes | 0.000 | 0.250 | count |
| near_miss_fraction | 0.039 | 0.060 | fraction |
| flown_m | 19.574 | 20.617 | m |
| saccades_per_flight_s | 0.555 | 0.561 | 1/s |
| contact_s | 0.000 | 0.001 | s |
| escape_probability | 1.000 | 1.000 | fraction |
| escape_ttc_s | 0.092 | 0.092 | s |
| escape_latency_s | 0.908 | 0.908 | s |
| size_at_escape_deg | 51.849 | 51.849 | deg |
| short_mode_fraction | 0.056 | 0.056 | fraction |
| mean_light_distance_m | 1.332 | 1.296 | m |
| time_near_light | 0.267 | 0.281 | fraction |
| active_fraction | 0.289 | 0.292 | fraction |

## Provenance

- Plan `5dd05900c2cf5f775e72c6e0e193193855662d1ace17a9c9517a677ab39a64e4`; fly `digital-fly/7 reduced-order-fsm/v1`, identity `44a4d99fc81cf563bb4ff40377cff7d1ae9881d95c6cf3b17851e5804539805d`, source `b794ba087d2c9dbb0d589758d6d2e0a89d958b3f2b626d50ab3388266513a682`
- Preregistered as V3D-EXP-0024 at 2026-10-26T05:46:40.589Z (receipt `0029346f887579ba6d8c892bd8af3cd31d34226b5f514c9d352fe87005ec5c06`)
- Authorized at 2026-10-26T05:46:40.688Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `b132d7f0d17244ca975046824dee12faed357162bdcfa9e524641baa3b6dba6b`
- Record `d4d53de824f472a5842a0a8b7a9ae66ec5c350e4aad21d4581c6b3d8a24148db`, run `FR-c2f92f56e012aaebe85b93c0`, 2026-10-26T05:46:40.691Z to 2026-10-26T05:47:40.883Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 6083.28 fly-seconds, then again for the determinism guard
- Code: commit `6ea1990ebc33011e02ad26083bebb719dc837d1b`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- Light level also scales this controller's spontaneous walking and takeoff rates, so a lit arena makes the fly move more as well as steer toward the light.
- Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
