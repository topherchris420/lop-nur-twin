# ECHO: biological fidelity without biological mortality

This is an **opt-in research extension**, not a live rollout or a complete
implementation of a biological fly. The original individual is protected.
No production service, deployment configuration, garden renderer, state file,
checkpoint, or identity is changed by the evaluation commands below.

## Audit and implementation gap

Audited source: `d25e1f3b9e40c5ded3f8ce1f435365d5c6c80592`, before this extension.
The public read-only witness at `https://129-213-139-78.sslip.io/v1/now`
reported `live` at `2026-10-27T14:00:43.276Z`: individual
`04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921`,
epoch 9, tick 855931 (85593.1 simulated seconds), checkpoint 290 at tick
854842, controller `echo`, `digital-fly/8`, `echo-self-model/v3`.
That observation is a dated sample, not a claim about the current service.
No private Oracle filesystem or service configuration was inspected.

| Area           | Existing implementation                                                                                                                 | Gap and disposition                                                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active control | ECHO v3 wraps the reduced-order controller; predictive self-motion, attention, inquiry and bounded episodic stores                      | Reuse the exact `SelfModel` implementation in a research adapter; preserve the existing adapter in the smaller migration                                                   |
| Nervous system | Circuit-informed escape/grooming functions; a separate published mushroom-body rate model; VFB anatomy reference                        | Compose MB learning and ECHO through existing sensory and motor interfaces; whole-connectome neural dynamics remain unimplemented                                          |
| Physiology     | Mode-dependent expenditure, carbohydrate reserve, food absorption; hunger changes behavior                                              | Add recoverable ATP-availability, hydration, fatigue, sleep-pressure, stress and passive temperature proxies; explicitly artificial maintenance                            |
| Learning       | Spatial bookkeeping, cue-dependent KC→MBON weights, reward prediction errors, ECHO model revision                                       | Preserve existing learning; archive conclusions and trial summaries; indefinite skill acquisition and sleep-dependent synaptic consolidation are not established           |
| Persistence    | Full graph snapshots, RNG positions, SHA-256 seals, atomic publication, linked headers, single-writer epoch fence, restore verification | Reuse `LifeStore`; add extension-specific recovery, archival and migration tests                                                                                           |
| Time           | Continuous runner; bounded batch sizes; city replay recording eventually fills                                                          | No 41-hour lifespan cutoff was found. The documented 40.7-hour figure concerns record/checkpoint growth; recording capacity is not organism lifetime                       |
| Deployment     | Documented Oracle A1 Arm VM, one local writer, systemd restart, backups, separate read-only observer                                    | Leave all operations unchanged; no independent off-machine storage or global writer fencing was verified                                                                   |
| Physics        | Reduced-order body; separate open-loop FlyBody/MuJoCo benchmark                                                                         | Existing readiness gate is blocked. Old traces concern fly/4, and include tracking failures. No embodied-neural or biological validation claim follows from this extension |
| Experiments    | ECHO ablations, individuality studies, mushroom-body studies and behavioral calibration                                                 | Add a finite, prespecified four-arm study and endurance report; report failures and inconclusive evidence                                                                  |

The source audit covered the fly body, senses, controller, neural command
gate, circuit proxies, navigation, mushroom-body model, ECHO modules,
headless city, snapshot/continuity/store, observer, runner, service units,
upgrade paths, existing experiment reports and locomotion readiness gate.
Existing reports remain historical records, not revalidated results for the
new controller composition. See `PROJECT_ECHO.md`, `DIGITAL_FLY.md`,
`INDIVIDUAL_CONTINUITY.md`, `BETHESDA_CONTINUOUS_LIFE.md`, and
`FLY_PRIORITIES.md` for their methods and qualifications.

## Two deliberately separate stages

**Maintenance continuation** (`life/immortal/continuation.ts`) adds a
`Physiology` object to a restored, verified headless life. The original
controller, body, city, memories, self-model and random streams stay intact.
The candidate keeps the original birth, immutable genesis and individual ID;
its parent is the exact source checkpoint and its tick does not advance.
The migration verifies the complete original graph digest before adding
anything. A new checkpoint records the addition and the real pause interval.
Its restore and subsequent trajectory are tested. There is no command that
commits this candidate to production, and the production runner does not
select its new version. This stage supplies maintenance; it does **not** add
new neural learning or fatigue-based motor control to the original adapter.

**Research composition** (`life/immortal/life.ts`) has a distinct life kind,
`echo-immortal-research`. It therefore cannot open the original store as a
research individual. Research births use host-drawn nonces. A copied fly must
use `twinCheckpoint`, which records a new individual and parentage; the same
seed never establishes identity. A research life can use the existing yard
or a separate Bethesda home. Bethesda construction uses a new optional
`researchAdapter` injection into `CityFly` and `HeadlessBethesdaLife`; an
ordinary constructor still makes the original controller and state graph.
The new factory is not exposed in the production CLI or URL parameters.

The research adapter contains one existing motor controller: the
`MushroomBodyController` when associative learning is enabled, otherwise the
`ReducedOrderController`. ECHO's existing `SelfModel` mediates its intentions.
All commands still pass `validateCommand`. The physiology service may supply
explicitly metered reserve energy; the decision maker never writes position,
heading, velocity, collision state, or a landing outcome.

## Configuration

All three `ResearchFlags` default to false. To create a new research life:

```ts
const genesis = researchGenesis(1201);
genesis.flags = {
  immortality: true,
  associativeLearning: true,
  predictiveSelfModel: true,
};
const life = IMMORTAL_RESEARCH_LIFE.build(genesis);
```

`immortality` enables protective maintenance, rest requests and fatigue-based
walking modulation. With it off, tissue variables can be inspected but do
not alter commands or supply energy. The existing body still has no death
transition. `associativeLearning` selects the existing MB circuit, and
`predictiveSelfModel` selects ECHO v3. Controller combinations are research
conditions, never silently substituted for the deployed fly. The yard's
`startReserve` is explicit; a Bethesda research home's starting reserve
retains `CITY_START_RESERVE`, matching its existing construction.

The maintenance-only candidate always has immortality enabled, with its
addition explicitly recorded. It cannot be toggled off through the existing
production runner. A later reversal requires its own reviewed continuation;
removing a field or accepting an older schema is not a rollback mechanism.

## Physiological specification

Every new numerical value is classified `model`, with units, in
`PHYSIOLOGY_PARAMS`. None is presented as a measured Drosophila parameter.
The existing energy model retains its published/model provenance.

| Variable         | Update and effect                                                                                                 | Biological status                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Reserve, J       | Existing body draws metabolic power and absorbs food; maintenance supply is added separately                      | Existing tissue-scale energy abstraction, not a molecular pathway                         |
| ATP availability | First-order relaxation to a target from reserve fraction and activity, 10 s time constant                         | Dimensionless proxy; no ATP molecule count or oxidative phosphorylation simulation        |
| Water            | Exponential activity-dependent loss; artificial supply in protection                                              | Fractional reservoir, not measured insect water kinetics                                  |
| Muscle fatigue   | Rises with activity; decays in rest or artificial repair; reduces commanded walking speed in research composition | Tissue proxy, not muscle fibre excitation–contraction dynamics                            |
| Sleep pressure   | Rises with activity; decreases during body rest; hysteresis requests rest                                         | Inspired by sleep homeostasis; behavioral rest is not validated biological sleep          |
| Stress           | Tracks energetic insufficiency; relaxes during protection                                                         | A numerical regulatory state, not a feeling                                               |
| Temperature      | Passive relaxation to an assumed constant 25°C bath                                                               | Ectothermic proxy, not active thermoregulation, weather sensing or a temperature receptor |
| Maintenance      | Age-independent external service supplies up to 0.004 J/s and repairs tissue; cumulative supply is metered        | Explicitly artificial; real flies do not obtain energy or water from software             |

Normalized variables use exponential relaxation, avoiding the instability of
large explicit-Euler steps. Updates are validated and limited to at most one
second; the embodied runner uses 0.1 s. Invalid or nonfinite state raises an
error, without inventing a repaired individual.

Protection enters below 8% reserve, very low water/ATP, or extreme
fatigue/stress. It exits only after reserve reaches 35%, water reaches 80%,
ATP reaches 70%, and fatigue/stress fall below 20%. There is no instantaneous
refill. Supply exceeds the existing maximum normal activity cost; tissue
repair can occur during flight so recovery is not contingent on landing at
a special location. A research fly requests rest when safely perched; its
escape reflex retains priority and airborne-to-rest transitions are forbidden.
The body still performs flight, contact and landing through its existing engine.

Maintenance never erases synapses, memories, ECHO beliefs, RNG positions or
identity. No age-dependent decay, aging death, starvation death, lifespan
maximum, reproductive replacement or automatic new birth is introduced.
Persistent learning parameters are not periodically reinitialized.

## Neural interfaces and scientific provenance

Environment → existing delayed receptors → existing controller and MB rate
units → ECHO self-motion model → validated motor commands → existing body →
environment. Physiological feedback changes the research adapter's commands;
physical outcomes enter the existing sensory and prediction-error pathways.

The MB is the repository's implementation of Bennett, Philippides & Nowotny
(2021), DOI `10.1038/s41467-021-22592-4`: 2,000 KC rate units, two MBONs,
two DANs, sparse cue coding and reward-prediction-error plasticity. It
receives recognized landmark cues from existing navigation, not a hidden food
coordinate or synthetic successful trial. It does not become an olfactory
receptor network by being composed with ECHO. Published functions for looming
escape and grooming remain available separately; they are not newly wired
into the composition or mislabeled spiking networks. The core ECHO reads
only `SelfModelView`, preserving its existing sensory boundary.

Resources investigated, with the integration boundary stated explicitly:

| Resource                 | Source and decision                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FlyWire                  | [Dorkenwald et al. 2024](https://doi.org/10.1038/s41586-024-07558-y) supplies an anatomical wiring resource. [Public-release terms](https://flywire.ai/guidelines) specify CC BY-NC 4.0 for data. No connectome download or redistribution is added to this Apache-2.0 project; topology alone does not provide validated dynamics |
| Virtual Fly Brain        | [Official overview](https://www.virtualflybrain.org/docs/overview/) describes the anatomy/connectomics knowledge base. Reuse the existing imported reference and its attribution; no reference anatomy is described as a simulated nervous system and no new restricted geometry is imported                                       |
| FlyGym / NeuroMechFly v2 | [Wang-Chen et al. 2024](https://doi.org/10.1038/s41592-024-02497-y), [official project](https://github.com/NeLy-EPFL/flygym). A candidate for a later closed-loop physical backend, not a replacement for a failing gait or an installed dependency in this change; any future import needs a per-asset license review             |
| Mushroom body            | [Bennett et al. 2021](https://doi.org/10.1038/s41467-021-22592-4). Reuse the existing independently implemented equations and parameter provenance. No GPL author code is copied                                                                                                                                                   |
| Sleep homeostasis        | [Donlea, Pimentel & Miesenböck 2014](https://ora.ox.ac.uk/objects/uuid:dc804781-2e33-4c9e-94f4-dc8ba4007919). Motivation for a recoverable pressure variable, not numerical calibration or a dFB circuit implementation                                                                                                            |

Selected ion-channel dynamics, calcium signalling, receptor-specific
olfaction, identified visual neurons, a central-complex circuit, neural motor
CPGs and a complete biological nervous system are **unimplemented**. There
are no fabricated channels or calcium counters to satisfy their tests.
Published and existing calibration results do not validate the new tissue
constants or controller composition.

## Memory, experiments and observability

The existing bounded navigation, ECHO episodes and fixed-size KC synapses
are reused. `recent` holds at most 64 records, while `outbox` holds at most
512 unarchived events. Before dropping payloads from working memory,
`checkpointResearch` moves them into the existing sealed checkpoint event
history, verifies restoration, and commits under the existing lease. A
failed commit retains the in-memory outbox and fails closed. A full outbox
applies backpressure before another simulated tick; it never silently deletes
unarchived experience. ECHO conclusion records include the available detailed
episode. MB records are explicitly sampled trial summaries with update
counts, not a claim to retain every neural integration step.

This bounds active experience memory, not total historical storage. Append-only
headers and events accumulate on disk; storage grows approximately with the
number of checkpoints/events. Retaining arbitrary detailed history forever
in a fixed number of bytes is not promised. Off-machine archival, disk-quota
monitoring, scalable header indexing and verified history retrieval remain
operational work. Existing ECHO episode merging/forgetting is unchanged;
sleep-dependent synaptic consolidation and unlimited skill retention are not
newly implemented or claimed.

`ImmortalLife.inspect()` is a read-only instrumentation interface: tick and
simulated age, controller version, tissue condition, reserve, motor mode,
MB/DAN trial summary, ECHO belief vector, recent timeline, cumulative event
counts and pending archival. The identity, lineage and checkpoint health
come from the actual verified checkpoint/store, not an inferred seed. It is
not yet a public garden telemetry extension. No garden visual or public
observer schema is changed, and model variables are labeled as such.

`study.ts` fixes four arms before evaluation: persistent learning; the same
initial genotype with memory reset at phase boundaries; a fixed nonplastic
controller (its heuristic spatial state remains); and independently initialized
learning. The same body continues through acquisition, retention, transfer,
reversal and combined challenge phases. Environmental seeds are shared;
different neural initialization is disclosed for the independent arm.
Training and held-out obstacle/light/wind ranges do not overlap. Food
relocations and interventions are recorded life events; the sensorimotor
disturbance is fixed in genesis and hidden from the decision maker.

Measures include meal-search latency, feeding time, prior-site occupancy,
visited cells, energy expenditure, neural update counts, command rejections
and individual endpoint divergence. The adaptation criterion is a 20%
paired reduction in transfer latency with at least three valid paired meals.
Missing meals remain null; they are not assigned invented success times.
The generated report includes every arm, negative and inconclusive findings.
It does not establish independent validation, skill composition, resistance
to catastrophic forgetting or open-ended learning. Novel chemical odors are
unsupported by the existing scalar odor channel and remain a separate gap.

```sh
npm run echo:immortal:test
npm run echo:immortal:evaluate
npm run echo:immortal:evaluate -- --check
cd fly-physics
python -m fly_physics.readiness
```

Evaluation requires a clean implementation commit. It creates fresh research
individuals only in temporary directories; no production store path is accepted.
Results in `docs/research/echo-immortal/` are generated, never hand edited.
The protocol is prespecified in code, not externally preregistered, and this
repository's own tests are not independent experimental evidence.

## Long duration and operational limits

The generated report separates a full reduced-order organism run at increasing
intervals from a one-year **tissue-only** endurance run. Every reported step
is computed. A separate century-offset test checks short-step precision;
it does not claim that a fly lived a century. No pause creates offline
experiences. The existing production runner records restart gaps.

JavaScript safe integers and floating-point time are finite. A 0.1 s tick
counter has ample range for decades, but microsecond precision in large
absolute timestamps and millisecond/step counters must be requalified before
century-scale use. The research clock refuses unsafe integer overflow;
software precision failure is not described as biological death. A segmented
integer clock and cross-version deterministic replay remain future work.

Checkpoint graph compaction already preserves old headers and events; it does
not provide unlimited disk capacity. A corrupt head stops recovery and needs
a verified backup and explicit loss accounting. It is not silently replaced
with a fresh seed, a different birth, or an earlier checkpoint passed off as
an uninterrupted history. Local fencing cannot prevent two copied stores
running on different machines. Cloud reclamation, disk loss, host failure,
backup failure, code defects, numerical limits, operational funding and
eventual hardware replacement still limit computational existence.
Functional immortality is removal of programmed mortality plus recoverability,
not a guarantee of literal eternal operation.

See [the operational migration plan](ECHO_IMMORTAL_MIGRATION.md) before any
production action.
