# FLY-f6f39e7b576079212dbb5922: INCONCLUSIVE (insufficient evidence)

> Simulated observations of the digital fly (digital-fly/3 reduced-order-fsm/v1), a reduced-order controller that simulates no neurons, in a closed arena. Not evidence about Drosophila.
>
> Authorized by the demonstration script (Scripted.DemoOperator), not by a person: a demonstration of the pipeline, not a reviewed experiment.

**Protocol.** Visual threat: a sphere of 4 cm radius approaching the standing fly at 1 m/s, against the same sphere receding along the same line at the same speed.

**Caveat.** An implementation check of the escape proxy's expansion gate, not a test of threat discrimination: the proxy's drive is zero unless the stimulus expands, so the receding or held control cannot escape by construction, and guard G3 holds a control pinned at zero inconclusive.

**Question (host-written).** In the digital fly simulator, how does a sphere of 4 cm radius approaching the standing fly at 1 m/s change fraction of single-stimulus trials answered by an escape takeoff, against the same sphere receding along the same line at the same speed on matched seeds?

**Hypothesis (host-written).** A sphere of 4 cm radius approaching the standing fly at 1 m/s will increase escape_probability by at least 0.3 fraction on average over 12 matched seeds drawn after preregistration, compared with the same sphere receding along the same line at the same speed, and an exact one-sided sign test on the seeds that differ will find the increase at alpha 0.05.

**Design words (scripted).** [scripted] A sphere approaching at 1 m/s raises the escape probability over the same sphere receding along the same line. — competing: [scripted] Any moving object in view triggers the escape proxy, approaching or not.

## Seeds

12 seeds, drawn by the host after preregistration as SHA-256(receipt digest ‖ nonce ‖ counter): 2825129695, 3516183451, 105800105, 833629099, 3545243397, 4086644816, 3960666097, 1561841838, 2107566656, 1351986685, 199176249, 961592115.

## Primary metric: escape_probability (fraction)

| seed | control | treatment | difference | direction | treatment final state |
| ---: | ---: | ---: | ---: | :--- | :--- |
| 2825129695 | 0.000 | 1.000 | 1.000 | expected | `d2f7a2d1039a` |
| 3516183451 | 0.000 | 1.000 | 1.000 | expected | `add2be3014f2` |
| 105800105 | 0.000 | 1.000 | 1.000 | expected | `a8ff40550f4b` |
| 833629099 | 0.000 | 1.000 | 1.000 | expected | `bb86710a0be3` |
| 3545243397 | 0.000 | 1.000 | 1.000 | expected | `5749e0fac53a` |
| 4086644816 | 0.000 | 1.000 | 1.000 | expected | `9f8f3d71e673` |
| 3960666097 | 0.000 | 1.000 | 1.000 | expected | `554eac90f713` |
| 1561841838 | 0.000 | 0.833 | 0.833 | expected | `692a70405980` |
| 2107566656 | 0.000 | 1.000 | 1.000 | expected | `578b1b001f0b` |
| 1351986685 | 0.000 | 1.000 | 1.000 | expected | `66473c03e550` |
| 199176249 | 0.000 | 1.000 | 1.000 | expected | `5a9a72f946c0` |
| 961592115 | 0.000 | 1.000 | 1.000 | expected | `8fd1d68c80f3` |

12 of 12 untied seeds in the expected direction (increase), 0 opposite, 0 tied, 0 undefined. Exact one-sided sign test: p = 2.44e-4 for the expected direction, p = 1.0000 for the opposite (alpha 0.05, at least 6 untied seeds). Mean control 0.000, mean treatment 0.986, mean paired difference **0.986** (minimum effect 0.3 fraction).

The fly's gate refused 0 commands (control 0, treatment 0).

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** runs_completed >= 24: observed 24.0000 — holds
- **G2** determinism_check >= 1: observed 1.0000 — holds
- **G3** control_informative >= 1: observed 0.0000 — does not hold
- **G4** untied_pairs >= 6: observed 12.0000 — holds
- **G5** gate_refusals <= 0: observed 0.0000 — holds
- **S1** mean_paired_delta >= 0.3: observed 0.9861 — holds
- **S2** sign_test_p_expected <= 0.05: observed 0.0002 — holds
- **F1** sign_test_p_opposite <= 0.05: observed 1.0000 — does not hold

Evidence-sufficiency guard(s) not met: G3. No conclusion drawn.

Registry run `V3D-EXP-0009-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Every measurement (mean over seeds where defined; not preregistered as tests)

| metric | control | treatment | unit |
| :--- | ---: | ---: | :--- |
| escape_probability | 0.000 | 0.986 | fraction |
| escape_latency_s | — | 0.908 | s |
| escape_lead_s | — | 0.012 | s |
| size_at_escape_deg | — | 50.510 | deg |
| short_mode_fraction | — | 0.069 | fraction |

## Provenance

- Plan `f6f39e7b576079212dbb5922be13e772ac984d3ae83e23713248e152a0de7a3a`; fly `digital-fly/3 reduced-order-fsm/v1`, identity `7b78efef2d070ed356391eb8f81d736720c2bc6f7e1eba805b30572b483845de`, source `3b221211c38cbbdba6fce0480406056979e03e623b8dc5837b79fca196070b77`
- Preregistered as V3D-EXP-0009 at 2026-10-23T21:07:41.232Z (receipt `142d885a1fd4fc7e96bb2de88205459941d48cbfbb7f32e84feb8029fb4abfb8`)
- Authorized at 2026-10-23T21:07:41.241Z by the demonstration script (Scripted.DemoOperator), not a person; nonce `770b53546fda5fb45edccecdcfb0cad4fdb5183382669998978e3a556052e5bd`
- Record `42b2f9a56f93ad7d1a2ad8145456718322646dd8064b84ee80399f5d6f0a55a8`, run `FR-effe89c952cd5470f778d310`, 2026-10-23T21:07:41.241Z to 2026-10-23T21:07:41.679Z
- Simulated on node 24.19.0 (V8 13.6.233.17-node.51): 319.68 fly-seconds, then again for the determinism guard
- Code: commit `063c8a5fabe9f18af7ebce6d6829ad0ca6e66c18`
- Design written by the host's demonstration script (flyExample.ts); no model or person wrote it

## Limitations

- The digital fly's controller is a reduced-order state machine. It simulates no neurons; its links to Virtual Fly Brain terms are labels, not mechanisms.
- Model parameters were chosen for this simulator, not measured or fitted; a result describes the simulator with these values.
- Flight is kinematic: no aerodynamics and no MuJoCo physics run in these experiments.
- The arena is a box with primitive obstacles and a relative light proxy (not lux); odour, temperature, humidity, airflow and food are not simulated.
- An implementation check of the escape proxy's expansion gate, not a test of threat discrimination: the proxy's drive is zero unless the stimulus expands, so the receding or held control cannot escape by construction, and guard G3 holds a control pinned at zero inconclusive.
- Looming stimuli are visual objects only: the fly sees them but cannot touch them, and escape is a giant-fiber proxy, not a modelled neuron.
- Re-simulation is exact on the JavaScript engine that made a record; Math functions differ in their last bits between engines, so on another engine a record is reported as not re-simulable rather than checked.
- A result characterizes the simulator and is never empirical evidence about Drosophila.
