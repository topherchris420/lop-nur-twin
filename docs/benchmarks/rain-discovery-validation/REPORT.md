# R.A.I.N. experimental discovery report

Question: How do different simulated urban disruptions alter collective movement patterns, and under which conditions does the same intervention produce different behavioral outcomes?

Model: scripted-discovery-test-double. Charter: c12bf16f9acd63caea9ee33d4002f89bec6e22e2d2d4205846ddebe172052095.

SCRIPTED INTEGRATION DEMONSTRATION. Design proposals and critiques came from a deterministic test fixture, not Qwen inference. Measurements below are actual simulator outputs. This verifies the discovery execution and lineage pipeline, not autonomous model reasoning.

Session ending: Completed bounded session

All measurements below come from the Bethesda simulator. They are not observations of real people. Hypotheses and critiques are designer interpretations. Results use descriptive paired-seed criteria, not statistical significance tests. History includes earlier sessions when present.

## ND-33f6ad39e49c05a1c4eed727-1-aec46381

Question (scripted): [scripted fixture] Does a simulated fire change nearby watching behavior?
Hypothesis (scripted): [scripted fixture] A fire increases mean watching count by at least 0.01 relative to no event.
Operational hypothesis (host): The intervention will increase watching by at least 0.01 count on average, with every paired seed in the expected direction.
Protocol: fire at bethesda_row; {"pedestrians":40,"vehicles":8,"buses":2,"intensity":1,"duration_ticks":300}; warm-up 100 ticks; observation 300 ticks.
Primary metric: watching; unit: count.
Purpose: exploratory; parent: none; motivating evidence: none.
Run: BX-86501be0327e-Rmv1ugddl1; registry: V3D-EXP-0001-RUN-0001; replay: passed; verdict: supported.
Artifact: records/BX-86501be0327e-Rmv1ugddl1.json

| Seed       | Control | Treatment | Treatment − control |
| ---------- | ------: | --------: | ------------------: |
| 865942561  |       0 |         2 |                   2 |
| 3488817590 |       0 |         2 |                   2 |
| 334359401  |       0 |      2.67 |                2.67 |

Measurements: {"seeds_completed":3,"matched_t0_seeds":3,"cohort_min":6,"primary_delta_mean":2.22,"primary_delta_min":2,"primary_delta_max":2.67,"seeds_in_expected_direction":3,"control_primary_mean":0,"treatment_primary_mean":2.22,"delta_mean_cohort_mean_distance_m":4.25,"delta_mean_cohort_indoors":0,"delta_mean_pedestrians_near":0,"delta_mean_leaving":1.22,"delta_mean_sheltering":0,"delta_mean_watching":2.22,"delta_mean_vehicles_held":0}

Critique (scripted, not evidence): {"assessment":"proceed","confounds":[],"comparison_validity":"[scripted fixture] Paired initial states, only event presence differs.","circularity":"[scripted fixture] This tests simulator rules; it does not validate them against reality.","evidence_limits":["Descriptive small seed panel; no real-world claims."],"disagreements":[],"learned":"[scripted fixture] Simulator reported mean delta 2.22; preregistered verdict supported.","distinguished":"[scripted fixture] Directional paired differences can be compared descriptively.","failed_assumptions":[],"uncertainty":["Population dependence remains untested."],"next_question":"Does a denser population alter the same disruption's movement response?","replicate":true}

## ND-380da1099b48d6f64dde7557-2-aec46381

Question (scripted): [scripted fixture] Does a denser simulated population change the response to the same fire?
Hypothesis (scripted): [scripted fixture] A fire increases mean watching count by at least 0.01 relative to no event.
Operational hypothesis (host): The intervention will increase watching by at least 0.01 count on average, with every paired seed in the expected direction.
Protocol: fire at bethesda_row; {"pedestrians":60,"vehicles":8,"buses":2,"intensity":1,"duration_ticks":300}; warm-up 100 ticks; observation 300 ticks.
Primary metric: watching; unit: count.
Purpose: exploratory; parent: ND-33f6ad39e49c05a1c4eed727-1-aec46381; motivating evidence: BX-86501be0327e-Rmv1ugddl1.
Run: BX-994fb278fdd6-Rmv1ugfuo2; registry: V3D-EXP-0002-RUN-0001; replay: passed; verdict: supported.
Artifact: records/BX-994fb278fdd6-Rmv1ugfuo2.json

| Seed       | Control | Treatment | Treatment − control |
| ---------- | ------: | --------: | ------------------: |
| 4090587320 |       0 |         7 |                   7 |
| 2181850668 |       0 |      4.67 |                4.67 |
| 2103651828 |       0 |     10.33 |               10.33 |

Measurements: {"seeds_completed":3,"matched_t0_seeds":3,"cohort_min":16,"primary_delta_mean":7.33,"primary_delta_min":4.67,"primary_delta_max":10.33,"seeds_in_expected_direction":3,"control_primary_mean":0,"treatment_primary_mean":7.33,"delta_mean_cohort_mean_distance_m":3.18,"delta_mean_cohort_indoors":0,"delta_mean_pedestrians_near":0,"delta_mean_leaving":1.89,"delta_mean_sheltering":0,"delta_mean_watching":7.33,"delta_mean_vehicles_held":0}

Critique (scripted, not evidence): {"assessment":"proceed","confounds":[],"comparison_validity":"[scripted fixture] Paired initial states, only event presence differs.","circularity":"[scripted fixture] This tests simulator rules; it does not validate them against reality.","evidence_limits":["Descriptive small seed panel; no real-world claims."],"disagreements":[],"learned":"[scripted fixture] Simulator reported mean delta 7.33; preregistered verdict supported.","distinguished":"[scripted fixture] Directional paired differences can be compared descriptively.","failed_assumptions":[],"uncertainty":["Population dependence remains untested."],"next_question":"Does a denser population alter the same disruption's movement response?","replicate":true}

## Reproduction and limits

The immutable discovery journal preserves requests, responses, validation failures, competing hypotheses, approved envelope, preregistration, seeds, replay checks, critiques and parent references. Replay the sealed records using the same producing repository revision. No finding overwrites earlier findings. An independent critic call uses the same underlying model and is not an independent scientific replication. Novelty is relative to the local protocol history and legacy catalogue, not the scientific literature. The priority score is a deterministic heuristic, not measured information gain. No biosignals, real urban measurements or external-world experiments are supported.
