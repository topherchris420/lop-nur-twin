# R.A.I.N. experimental discovery report

Question: How do different simulated urban disruptions alter collective movement patterns, and under which conditions does the same intervention produce different behavioral outcomes?

Model: scripted-discovery-test-double. Charter: 9d59a5d09899549aabbf46a254f35e9748f79846a4e69b55d8adca506330d3a9.

SCRIPTED INTEGRATION DEMONSTRATION. Design proposals and critiques came from a deterministic test fixture, not Qwen inference. Measurements below are actual simulator outputs. This verifies the discovery execution and lineage pipeline, not autonomous model reasoning.

Session ending: Research draft ready for human review

All measurements below come from the Bethesda simulator. They are not observations of real people. Hypotheses and critiques are designer interpretations. Results use descriptive paired-seed criteria, not statistical significance tests. History includes earlier sessions when present.

## ND-33f6ad39e49c05a1c4eed727-1-b76a2eea

Question (scripted): [scripted fixture] Does a simulated fire change nearby watching behavior?
Hypothesis (scripted): [scripted fixture] A fire increases mean watching count by at least 0.01 relative to no event.
Operational hypothesis (host): The intervention will increase watching by at least 0.01 count on average, with every paired seed in the expected direction.
Protocol: fire at bethesda_row; {"pedestrians":40,"vehicles":8,"buses":2,"intensity":1,"duration_ticks":300}; warm-up 100 ticks; observation 300 ticks.
Primary metric: watching; unit: count.
Purpose: exploratory; parent: none; motivating evidence: none.
Run: BX-d86316f79e28-Rmv2krau11; registry: V3D-EXP-0001-RUN-0001; replay: passed; verdict: supported.
Artifact: records/BX-d86316f79e28-Rmv2krau11.json

| Seed | Control | Treatment | Treatment − control |
|---|---:|---:|---:|
| 1908397192 | 0 | 5 | 5 |
| 939373070 | 0 | 4.33 | 4.33 |
| 3203012601 | 0 | 3.33 | 3.33 |

Measurements: {"seeds_completed":3,"matched_t0_seeds":3,"cohort_min":4,"primary_delta_mean":4.22,"primary_delta_min":3.33,"primary_delta_max":5,"seeds_in_expected_direction":3,"control_primary_mean":0,"treatment_primary_mean":4.22,"delta_mean_cohort_mean_distance_m":3.72,"delta_mean_cohort_indoors":0,"delta_mean_pedestrians_near":0,"delta_mean_leaving":0.78,"delta_mean_sheltering":0,"delta_mean_watching":4.22,"delta_mean_vehicles_held":0}

Critique (scripted, not evidence): {"assessment":"proceed","confounds":[],"comparison_validity":"[scripted fixture] Paired initial states, only event presence differs.","circularity":"[scripted fixture] This tests simulator rules; it does not validate them against reality.","evidence_limits":["Descriptive small seed panel; no real-world claims."],"disagreements":[],"learned":"[scripted fixture] Simulator reported mean delta 4.22; preregistered verdict supported.","distinguished":"[scripted fixture] Directional paired differences can be compared descriptively.","failed_assumptions":[],"uncertainty":["Population dependence remains untested."],"next_question":"Does a denser population alter the same disruption's movement response?","replicate":true}

## ND-380da1099b48d6f64dde7557-2-b76a2eea

Question (scripted): [scripted fixture] Does a denser simulated population change the response to the same fire?
Hypothesis (scripted): [scripted fixture] A fire increases mean watching count by at least 0.01 relative to no event.
Operational hypothesis (host): The intervention will increase watching by at least 0.01 count on average, with every paired seed in the expected direction.
Protocol: fire at bethesda_row; {"pedestrians":60,"vehicles":8,"buses":2,"intensity":1,"duration_ticks":300}; warm-up 100 ticks; observation 300 ticks.
Primary metric: watching; unit: count.
Purpose: exploratory; parent: ND-33f6ad39e49c05a1c4eed727-1-b76a2eea; motivating evidence: BX-d86316f79e28-Rmv2krau11.
Run: BX-2f0f9ad47d7c-Rmv2krfg52; registry: V3D-EXP-0002-RUN-0001; replay: passed; verdict: supported.
Artifact: records/BX-2f0f9ad47d7c-Rmv2krfg52.json

| Seed | Control | Treatment | Treatment − control |
|---|---:|---:|---:|
| 1994692712 | 0 | 12.67 | 12.67 |
| 3596206292 | 0 | 7 | 7 |
| 623302106 | 0 | 7.33 | 7.33 |

Measurements: {"seeds_completed":3,"matched_t0_seeds":3,"cohort_min":8,"primary_delta_mean":9,"primary_delta_min":7,"primary_delta_max":12.67,"seeds_in_expected_direction":3,"control_primary_mean":0,"treatment_primary_mean":9,"delta_mean_cohort_mean_distance_m":1.96,"delta_mean_cohort_indoors":0,"delta_mean_pedestrians_near":0,"delta_mean_leaving":1.33,"delta_mean_sheltering":0,"delta_mean_watching":9,"delta_mean_vehicles_held":0}

Critique (scripted, not evidence): {"assessment":"proceed","confounds":[],"comparison_validity":"[scripted fixture] Paired initial states, only event presence differs.","circularity":"[scripted fixture] This tests simulator rules; it does not validate them against reality.","evidence_limits":["Descriptive small seed panel; no real-world claims."],"disagreements":[],"learned":"[scripted fixture] Simulator reported mean delta 9; preregistered verdict supported.","distinguished":"[scripted fixture] Directional paired differences can be compared descriptively.","failed_assumptions":[],"uncertainty":["Population dependence remains untested."],"next_question":"Does a denser population alter the same disruption's movement response?","replicate":true}

## Reproduction and limits

The immutable discovery journal preserves requests, responses, validation failures, competing hypotheses, approved envelope, preregistration, seeds, replay checks, critiques and parent references. Replay the sealed records using the same producing repository revision. No finding overwrites earlier findings. An independent critic call uses the same underlying model and is not an independent scientific replication. Novelty is relative to the local protocol history and legacy catalogue, not the scientific literature. The priority score is a deterministic heuristic, not measured information gain. No biosignals, real urban measurements or external-world experiments are supported.
