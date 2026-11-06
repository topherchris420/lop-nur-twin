# Research claims register

Every prominent claim this repository makes, in one place, with what kind of
evidence stands behind it and where that evidence is kept. A claim here is only
as strong as the record it links to: this page summarises those records and
does not replace them. Numbers are copied from the linked records, except
where an entry says it computed something itself, and then it says how.

As of 2026-11-05. A result recorded later belongs in its own record first and
here second.

## How to read an entry

**Evidence classes**, from strongest to weakest as tests of a claim:

| Class                           | What it means here                                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Registered**                  | A R.A.I.N. experiment or a frozen protocol: criteria fixed and committed before the run, seeds drawn by the host after preregistration, re-simulated before admission. |
| **Held-out**                    | Run once on seeds, conditions or observations set aside before any result existed, under a rule fixed in advance. A held-out set that has been used is spent.          |
| **Seeded study**                | A deterministic study on declared seeds, reported whatever it showed, but not preregistered (some were designed after a pilot, and say so).                            |
| **Development**                 | Seen while the thing was built or tuned. It can suggest, never establish.                                                                                              |
| **Observation of the original** | A record of the deployed individual itself (its chain, journal, witness, ledger and replays). There is no control: nothing may be done to it to make one.              |
| **Scripted demonstration**      | A run with a scripted designer or operator. It shows the machinery works, not that a hypothesis holds.                                                                 |

**Outcomes** are the records' own words: _supported_, _inconclusive_, _negative_
(the hypothesis failed its test), _not shown_ (no detectable effect, which is not
evidence of none) or _passed_/_failed_ for an engineering gate. Intervals are 95%
unless stated.

Three boundaries hold for every entry:

- **The originals are observed, never experimented on.** Results about "flies"
  are about research subjects built from seeds, unless the entry says _original_.
- **The connectome research is not the deployed flies.** Neither ECHO nor Eva runs
  the FAFB or BANC model.
- **No result here is about awareness or experience.** These are functional
  claims about computational models, which are not complete fruit-fly nervous
  systems.

## Summary

| #   | Claim                                                                                                                                                         | Class                              | Outcome                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------ |
| 1   | [ECHO's recent history can be recomputed independently](#1-echos-recent-history-can-be-recomputed-independently)                                              | Observation of the original        | 361 of 361 seals, #2,566–#2,927      |
| 2   | [Engine changes reached ECHO without replacing it](#2-engine-changes-reached-echo-without-replacing-it)                                                       | Observation of the original; tests | 4 recorded continuations             |
| 3   | [The old physics trapped flies in buildings; `digital-fly/9` fixes it](#3-the-old-physics-trapped-flies-in-buildings-digital-fly9-fixes-it)                   | Seeded comparison                  | 9 of 12 trapped → 0 of 12            |
| 4   | [The repaired physics let the deployed ECHO out](#4-the-repaired-physics-let-the-deployed-echo-out)                                                           | Observation of the original        | Left; first meal 8 h later           |
| 5   | [The self-model compensates for a hidden impairment (ECHO-01)](#5-the-self-model-compensates-for-a-hidden-impairment-echo-01)                                 | Registered; held-out conditions    | Supported                            |
| 6   | [The self-model attributes hidden changes better than simpler rules (ECHO-02)](#6-the-self-model-attributes-hidden-changes-better-than-simpler-rules-echo-02) | Registered; held-out conditions    | Supported, still overconfident       |
| 7   | [Memory, workspace and second look help the self-model (ECHO-03–05)](#7-memory-workspace-and-second-look-help-the-self-model-echo-0305)                       | Registered                         | Inconclusive (all three)             |
| 8   | [Individuals from one genesis acquire distinct, persistent preferences](#8-individuals-from-one-genesis-acquire-distinct-persistent-preferences)              | Seeded study                       | Supported in the yard                |
| 9   | [Memory helps where food keeps moving](#9-memory-helps-where-food-keeps-moving)                                                                               | Seeded study; held-out             | Negative                             |
| 10  | [A learning circuit makes behaviour depend on the fly's own history](#10-a-learning-circuit-makes-behaviour-depend-on-the-flys-own-history)                   | Seeded study (after a pilot)       | Supported for extinction only        |
| 11  | [A learned search preference transfers and pays](#11-a-learned-search-preference-transfers-and-pays)                                                          | Held-out (sealed); development     | Transfers; benefit not shown         |
| 12  | [Learning when to search widely beats a fixed search](#12-learning-when-to-search-widely-beats-a-fixed-search)                                                | Development                        | Negative: fixed wins                 |
| 13  | [The simulated fly matches published recordings of real flies](#13-the-simulated-fly-matches-published-recordings-of-real-flies)                              | Held-out (sealed observations)     | Narrow pass for v2                   |
| 14  | [Commanded walking survives physical simulation](#14-commanded-walking-survives-physical-simulation)                                                          | Engineering benchmark              | Failed (on `digital-fly/4`)          |
| 15  | [Published connectome predictions reproduce](#15-published-connectome-predictions-reproduce-fafb-v783)                                                        | Registered; dev and held-out seeds | 10 of 12 criteria                    |
| 16  | [Connectome-level learning, discrimination and control](#16-connectome-level-learning-discrimination-and-control)                                             | Registered                         | Mixed; two negatives                 |
| 17  | [Flies in separate worlds perceive and recognise each other](#17-flies-in-separate-worlds-perceive-and-recognise-each-other)                                  | Seeded studies, frozen protocols   | Perception yes; recognition negative |
| 18  | [Research infrastructure results (R.A.I.N., Noeterra)](#18-research-infrastructure-results)                                                                   | Model-assisted; scripted           | Inconclusive; simulator-only         |
| 19  | [Every claim in the Lop Nur twin carries its evidence](#19-every-claim-in-the-lop-nur-twin-carries-its-evidence)                                              | Build-enforced rules               | 37 rules, each tested                |

## Persistence and continuity of the original

### 1. ECHO's recent history can be recomputed independently

- **Claim.** The deployed individual's recorded history, from a given checkpoint
  onward, follows from public code and its own record alone: nothing was altered,
  dropped or added.
- **Implementation.** `src/bethesda/life/replay.ts`;
  `.github/workflows/bethesda-life-replay.yml` restores a backup's checkpoint on a
  GitHub Linux arm64 machine, advances it with the release that made it, and
  requires every later checkpoint's state hash, events, graph digest and seal to
  come out the same.
- **Control.** None is possible for an original. The check is falsifiable: four
  replays of release `bdb7c02`'s chain failed at their first seal, and the cause
  was found (issue 162) and fixed. The adaptation suite's benchmark O2 (0 of 2
  sealed replays) was measured on that chain, before the fix was deployed; it
  stands as recorded for that era, and the suite has not been rerun.
- **Result.** Four consecutive replays, each continuing the last: #2,566 to
  #2,927, 1,083,003 ticks (about 30 simulated hours), 361 of 361 seals, 19 public
  ledger anchors checked and none contradicted.
- **Limitations.** It takes its first checkpoint as given. It shows nothing about
  who computed the chain or when, or about the fly beyond its arithmetic. It is
  only comparable on Linux arm64 with the release's Node. Seals up to #2,554 can
  never be reproduced, and no replay passed between #1,993 and #2,566.
- **Records.** `replays.jsonl` on the `live-fly-ledger` branch;
  [Replaying it](BETHESDA_CONTINUOUS_LIFE.md#replaying-it).

### 2. Engine changes reached ECHO without replacing it

- **Claim.** Four engine changes reached the deployed individual while its birth,
  genesis, checkpoint lineage and learned state were kept byte for byte.
- **Implementation.** `echoUpgrade.ts`, `organismContinuation.ts`,
  `physicsRepair.ts` and their scripts in `scripts/bethesda-life-*.ts`. Each
  appends one checkpoint at the unchanged tick, with one event, and is committed
  only if removing the declared additions reproduces the source graph's SHA-256.
- **Protocol.** Synthetic-life tests; a rehearsal on a copy of a verified backup
  with the producing release; for the physics repair, every cutover command in
  order on a disposable Linux arm64 machine; then the owner's approval.
- **Result.** ECHO v2 (2026-10-27), v3 (checkpoint 270), the organism (checkpoint
  421, 2026-10-28) and the repaired physics (checkpoint 2,555, 2026-11-04). The
  whole chain verifies under each era's exact versions.
- **Limitations.** Byte-for-byte preservation is of state, not of future
  behaviour: under new physics the same state goes on differently, by design.
  Replays cannot cross a continuation; that needs both releases.
- **Records.** [Era table](ECHO_STEWARDSHIP.md#its-history-era-by-era);
  [organism cutover](ECHO_ORGANISM_CONTINUATION.md#the-cutover-as-it-ran);
  [physics cutover](ECHO_COLLISION.md#the-cutover-as-it-ran).

### 3. The old physics trapped flies in buildings; `digital-fly/9` fixes it

- **Claim.** On `digital-fly/8`, a body could pass into a building's walls and not
  out, and that, not the controller, is why trapped flies stopped eating.
- **Implementation.** `sweep`, `move`, `settle` and `keepContact` in
  `src/bethesda/fly/world.ts` (`digital-fly/9`): a surface stops a body going in,
  never one coming out. No controller, learning rule or goal changed.
- **Baseline and control.** The same research flies, on the same new seeds
  (301–312), under the old physics and the new. Flies the defect never reached
  are the internal control.
- **Result.** Trapped: 9 of 12 on the old physics, 0 of 12 on the new (and 0 of 12
  on each of two further seed sets). Mean meals in 96 h: 83.5 → 120.0; fewest
  17 → 83.
- **Uncertainty** (computed for this register from the per-seed records, without
  resampling). The paired difference is +36.5 meals; more in 7 seeds, equal in
  5, fewer in none (exact two-sided sign test on the 7 untied seeds, p = 0.016).
  The 5 ties are the 3 flies the defect never reached (301, 306, 312) and the 2
  it reached only after their last meal (307 at 69 h, 308 at 89 h). Every fly
  trapped before its last meal ate more on the repaired physics.
- **Limitations.** Not preregistered; 12 seeds; one map. A repaired fly can still
  go hungry: 3 of 144 fly-days held no meal.
- **Records.** [`ECHO_COLLISION.md`](ECHO_COLLISION.md#research-flies);
  [`benchmarks/echo-collision/2026-11-03/flies/`](benchmarks/echo-collision/2026-11-03/flies/);
  the survey of every surface, [`survey.ts`](research/echo-collision/survey.ts).

### 4. The repaired physics let the deployed ECHO out

- **Claim.** After its continuation onto `digital-fly/9`, the deployed individual
  left the building it had been inside since 2026-11-01, and fed again.
- **What it is and is not.** Leaving was what the repaired physics allowed: the
  simulator became more correct; the fly did not become more capable. It was
  refused a landing inside, over and over, drifted along a wall and crossed. No
  long-flight goal was held. Programmed maintenance, an artificial energy supply,
  carried it to its first meal; remembered food places stood at 0, so that meal
  was not memory-guided.
- **Result.** `body-left-solid` at tick 7,664,060 (checkpoint 2,563), 2,143
  simulated seconds after the repair; first meal at about 19:27 UTC, about 8 hours
  later, its first since 2026-11-01.
- **Limitations.** One individual, no control. A copy run forward off the VM left
  at the same tick and position, then diverged on another platform.
- **Records.** [The cutover, as it ran](ECHO_COLLISION.md#the-cutover-as-it-ran);
  the journal and witness in
  [`benchmarks/echo-collision/2026-11-04/live/`](benchmarks/echo-collision/2026-11-04/);
  the [figure](media/echo-collision/exit.svg) drawn from them by
  `scripts/echo-exit-figure.ts`.

## The self-model (Project ECHO)

The registered runs are R.A.I.N. demonstrations of `echo-self-model/v3` from
`352fafd`, on held-out conditions in a held-out arena; the evaluation report is a
seeded study of 24 seeds. A rerun on `digital-fly/9` met ECHO-01's and ECHO-02's
criteria but was refused by the registry because git calls failed during the run,
so the registered results below stand. [Results](PROJECT_ECHO.md#results-in-brief).

### 5. The self-model compensates for a hidden impairment (ECHO-01)

- **Hypothesis.** A fly that models its own sensorimotor gains keeps to its path
  after an impairment it is never told about.
- **Baseline.** The same fly without the self-model.
- **Result.** Path error 0.073 with it, 0.370 without (+0.297; 9 of 9 seeds;
  p = 0.002): **supported**. Evaluation report: 0.083 [0.047, 0.125] against
  0.385 [0.303, 0.463], 24 of 24 seeds.
- **Limitations.** Compensation within a reduced-order simulator.
- **Record.** [FLY-3dedfd1e…](benchmarks/fly-behavior/FLY-3dedfd1e08238befa3a2cd09/report.md).

### 6. The self-model attributes hidden changes better than simpler rules (ECHO-02)

- **Hypothesis.** It identifies whether a change came from its body, its
  surroundings or its senses better than a simpler rule.
- **Baseline.** A motion-gated rule; in the report also self-only and
  uncertainty-disabled variants.
- **Result.** 0.919 correct against 0.537 (−0.381; 10 of 10 untied seeds;
  p = 0.001), beyond the pilot-sized minimum effect: **supported**. Report: 0.89
  [0.83, 0.94] against 0.42, 0.34 and 0.32.
- **Limitations.** Overconfident on held-out data (expected calibration error 0.12
  against 0.013 on development data). Its first registered run, on v1, was
  inconclusive.
- **Record.** [FLY-ea1f81b9…](benchmarks/fly-behavior/FLY-ea1f81b92313cd532b36b4a8/report.md).

### 7. Memory, workspace and second look help the self-model (ECHO-03–05)

- **Results.** All three **inconclusive** against their minimum effects. ECHO-03:
  a reset memory concluded 1.60 s later (below a 3 s minimum). ECHO-04: without the
  workspace the busy fly concluded 0.69 s _sooner_ (p = 0.81; 30 s minimum).
  ECHO-05: without the second look the Brier score rose 0.099 → 0.132 (p = 0.105;
  0.2 minimum).
- **Limitations.** ECHO-04 and ECHO-05 were sized by pilots and under-powered; the
  report finds small effects in the expected direction for ECHO-05 (Brier +0.088
  [0.022, 0.163]) and a 1.00 s [0.29, 1.79] workspace effect.
- **Records.** [Results in brief](PROJECT_ECHO.md#results-in-brief).

## Memory, individuality and learning

### 8. Individuals from one genesis acquire distinct, persistent preferences

- **Hypothesis.** Flies built identically come to behave differently because of
  what they lived, and a restore carries that exactly.
- **Baseline.** The same mind with remembered places erased; a never-lived copy.
- **Result.** Preference for the fed site 0.28 [0.14, 0.45], against −0.01
  [−0.05, 0.01] erased and 0 for the copy. Stored, restored and replayed minds were
  byte-identical in 24 of 24.
- **Limitations.** One genesis, one 16 m yard; in 69% of probes the fly reached no
  site in 300 s. Not preregistered.
- **Record.** [Study A](INDIVIDUAL_CONTINUITY.md#study-a-distinct-histories-from-one-genesis).

### 9. Memory helps where food keeps moving

- **Hypothesis.** Remembering food places improves feeding when food relocates.
- **Baseline.** The same lives with memory erased every tick.
- **Result. Negative.** Memory-bearing flies ate 1.2 fewer meals per life [−2.25,
  −0.08] (Study B). In the adaptation suite, benchmark B2 failed in all three runs
  (+0.04 development, −0.13 and −0.58 held out). Latency did not improve with
  experience: no learning to learn.
- **Why.** Stale remembered places accumulate, and the rule that gives one up
  never fires because new food's odour takes over every return flight first
  (Study C).
- **Records.** [Study B](INDIVIDUAL_CONTINUITY.md#study-b-open-ended-adaptation);
  [the adaptation suite](ECHO_ADAPTATION_CONTINUITY.md#the-answer).

### 10. A learning circuit makes behaviour depend on the fly's own history

- **Hypothesis.** A mushroom-body rate model that learns from omitted reward makes
  persistence at an emptied site depend on how often the fly fed there.
- **Baseline.** Fixed bookkeeping (two fruitless returns), a one-return variant,
  and a lesion blocking the omission signal.
- **Result.** Three meals instead of one added +0.96 [0.88, 1] return flights with
  the circuit (more in 23 of 24) and −0.04 with the bookkeeping. The lesion kept
  flies returning (5.46 [4.71, 6.29] more). With moving food the circuit changed
  nothing.
- **Limitations.** Designed after a pilot; one genesis, one yard. The step sizes
  are the model's parameters' arithmetic. The lesion checks the loop, not a fact
  about flies. The deployed organism's circuit had 7 trials and formed no new
  memory of food in the first 14 meals after the repair.
- **Record.** [Study C](INDIVIDUAL_CONTINUITY.md#study-c-learning-from-omission-the-mushroom-body).

### 11. A learned search preference transfers and pays

- **Hypothesis.** A preference acquired from a fly's own meals carries to unseen
  places and helps it find food there.
- **Baseline.** Flies fed with no pattern; the same fly with the preference erased.
- **Result.** Transfers, **on the sealed test** (24 seeds): +0.42 [0.30, 0.53]
  against −0.04 [−0.19, 0.13]. Pays: **not shown** on the sealed test (first meal
  −9 s [−174, 155]; an 8 h stay +0.00 J [−0.17, 0.19]). In the city, in
  development: −1.0 meals [−9.5, +6.4].
- **Limitations.** The city runs used `digital-fly/8`, which could trap flies in
  buildings, and recorded no measure of it; 5 of 24 lives end with 30–36 h without
  a meal. Their "not shown" cannot tell no benefit from a masked one.
- **Record.** [`ECHO_ACQUIRED_BEHAVIOR.md`](ECHO_ACQUIRED_BEHAVIOR.md#limits).

### 12. Learning when to search widely beats a fixed search

- **Hypothesis.** A fly that learns between a default and a wider search does
  better than either fixed setting.
- **Result. Negative, in development.** The learner lost to simply always searching
  widely: −31.0 meals [−47.4, −16.0]. The wider search itself paid (+53.8 meals
  [31.1, 76.8] over the default). This study found the building trap.
- **Limitations.** Development only; every number came after seeing earlier ones.
  The learner chooses between two hand-written settings. Its sealed seeds are
  unused.
- **Record.** [`ECHO_RANGING.md`](ECHO_RANGING.md).

## Comparison with real flies and with physics

### 13. The simulated fly matches published recordings of real flies

- **Hypothesis.** The circuit-informed/v2 controller agrees better with real flies
  than the earlier controllers, on observations it never saw.
- **Protocol.** The 2026-11 held-out set: 16 observations from nine papers, quoted
  verbatim, sealed before v2 was run on its paradigms, with every v2 mechanism
  ablated.
- **Result.** v2 passed the seal's rule **on a narrow base**: within the flies'
  spread on 4 of 6 observations with an interval (2 of 6 for v1 and the
  reduced-order controller); median relative error 0.30 against 0.56 on the other
  ten. Both gains come from one paper and one mechanism; without it, 2 of 6.
- **Limitations.** Summaries, not trajectories. No controller is inside a
  published interval on any row. The set is spent.
- **Record.** [Calibration](DIGITAL_FLY.md#calibration-against-real-flies);
  [report](benchmarks/fly-calibration/README.md).

### 14. Commanded walking survives physical simulation

- **Gate.** Five plans (straight at 1, 2 and 3 cm/s, turning, walking while
  turning) within engineering tolerances in FlyBody's MuJoCo model.
- **Result. Failed**, on `digital-fly/4`: the 2 cm/s plan achieved 0.3791 of its
  forward progress with −20.46° heading drift; turning on the spot about 2°/s
  against 115°/s commanded. Not rerun on the current fly.
- **Limitations.** The tolerances are engineering choices, not biological ones.
  The physics backend never feeds back into the city's fly.
- **Record.** [Priorities](FLY_PRIORITIES.md); [benchmark](benchmarks/fly-physics/README.md).

## Computational neuroscience (research subjects only)

### 15. Published connectome predictions reproduce (FAFB v783)

- **Hypothesis.** Shiu et al. 2024's leaky integrate-and-fire model on FlyWire
  v783 reproduces the paper's sensorimotor predictions.
- **Protocol.** `fly-neural/experiments/shiu2024-v783.json`, committed before any
  full run; dev seeds, then held-out seeds once from a clean commit. The
  integrator matches Brian 2 on the authors' code (MN9 62.1 against 62.5 Hz).
- **Result.** 10 of 12 criteria pass on both seed sets. Water input drives MN9 to
  30.3 Hz, not 40, and the sign-shuffle control causes runaway excitation instead
  of abolishing activity.
- **Limitations.** Two signs, one weight per synapse; no neuromodulation, gap
  junctions or morphology; no ventral nerve cord on FAFB.
- **Record.** [Reproduction](ECHO_CONNECTOME.md#reproducing-shiu-et-al-2024-on-v783).

### 16. Connectome-level learning, discrimination and control

| Question                                                  | Result                                                                                                                    | Outcome                | Record                                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Does BANC v888's pathway leave the brain?                 | 4 of 10 criteria at the published weight; 9 of 10 with it scaled to BANC's density, which fails a control                 | Mixed                  | [BANC](ECHO_CONNECTOME.md#brain-and-cord-banc-v888)                                                                |
| Does a dopamine-gated rule learn odour-specifically?      | Depresses paired and unpaired odours alike; learning index near 0                                                         | Negative               | [Plasticity](ECHO_CONNECTOME.md#plasticity-a-dopamine-gated-rule-on-the-connectome-against-controls)               |
| Does a three-factor rule on a sparse code (v2)?           | 12 of 22 criteria fail; no mechanism shown to matter for specificity                                                      | Negative               | [Plasticity v2](ECHO_ADAPTIVE_INTELLIGENCE.md#odour-specific-learning-plasticity-v2)                               |
| Does a looming readout discriminate threats, held out?    | Recall 0.625; false alarms down only 11%; worse than a time-to-collision rule and than ECHO                               | Negative (4 of 6 fail) | [Threats](ECHO_ADAPTIVE_INTELLIGENCE.md#3-threat-discrimination-limitation-b)                                      |
| Can a connectome forager relocate food and keep it?       | Relocated in 4.5 visits (never without learning); persisted exactly through 12 restores; ECHO's own circuit adapts faster | 11 of 14 criteria pass | [Adaptive life](ECHO_ADAPTIVE_INTELLIGENCE.md#adaptive-life-experiments-a-c-d-e)                                   |
| Can neural readouts drive the body safely in closed loop? | Escapes and feeding 7/7 and 368/368; escaped 6 of 10 threats; 25–45× slower than real time                                | 5 of 6 criteria pass   | [Closed loop](ECHO_ADAPTIVE_INTELLIGENCE.md#6-closed-loop-neural-control-with-a-safety-layer-phase-8-limitation-c) |

All are research subjects in research worlds. A disposable probe fed the
originals' public observations ([neural shadow](ORIGINALS_LIVE_NEURAL_SHADOW.md))
is a counterfactual model output, not recorded neural activity: most of its senses
are unavailable and zero-filled.

## Encounters, infrastructure and the twin

### 17. Flies in separate worlds perceive and recognise each other

- **Encounters** (seeded study, frozen protocol): through the bridge, research
  flies escaped from each other in 43–45% of sessions against 0% alone. A recording
  evoked the same response as a live partner: contingency added nothing measurable.
- **Recognition** (held-out seeds): **negative**. No partner-specific response, no
  change outlasting 300 s, no habituation clearing its criterion; this fly has no
  channel or memory that could support recognition.
- **Record.** [First contact](FIRST_CONTACT.md);
  [results](benchmarks/first-contact/README.md).

### 18. Research infrastructure results

- **A live model-assisted experiment** (operator-approved, Gemma): a two-arm
  oscillator experiment replayed and entered the registry **inconclusive**, its
  analytic accuracy guards failed ([record](rea-research/evaluations/gemma-live/README.md)).
- **Noeterra** (scripted design and authorization): withholding memory of past
  treatment cut mean wars declared from 6.50 to 2.83 over 40 seasons and six
  matched seeds. A result about rule-based simulator agents, not history
  ([report](benchmarks/noeterra-civilization/CV-11b7adb76f31fa3d4307bd0b/report.md)).
- **What is not established:** broad autonomous discovery, or recursive scientific
  improvement ([scientific workflow](RAIN_SCIENTIFIC_INTELLIGENCE.md)).

### 19. Every claim in the Lop Nur twin carries its evidence

- **Claim.** Each of the 45 structures and the pavements is classified observed,
  reported, interpreted or illustrative, and the build refuses a record that breaks
  the classification contract.
- **Implementation.** `src/lib/evidence.ts` derives the ledger (101 records, 12
  sources); `src/lib/evidenceValidation.ts` enforces it in `bun run build`.
- **Test.** `scripts/test-evidence-validation.ts` asserts each of the 37 rules
  still fires.
- **Limitations.** A rule checks consistency with the source register, not that a
  source is right.
- **Record.** [Site model](SITE_MODEL.md); [provenance](DATA_PROVENANCE.md);
  [`/analysis`](https://lop-nur-twin.vercel.app/analysis).

## Weaknesses worth a better experiment

Found while compiling this register; each is a proposal, not a result.

- **The acquired preference's city test (11)** should be rerun on `digital-fly/9`
  with new seeds, now that the trap that may have masked a benefit is gone.
- **Memory in a changing world (9)** is tested only where food relocates faster
  than a stale place can be given up. A world where food sites recur on a schedule
  would test whether memory can pay at all, against the amnesic baseline.
- **ECHO-04 and ECHO-05 (7)** were sized by pilots that predicted effects far below
  their minimum effects. A design powered from the evaluation report's effect
  sizes, on new held-out seeds, would give them a fair test.
- **Real-fly comparison (13)** rests on summaries. Trajectory-level comparison
  against licensed tracking data, split by fly and session, is the
  [fourth priority](FLY_PRIORITIES.md#4-expand-independent-comparison-with-living-flies).
