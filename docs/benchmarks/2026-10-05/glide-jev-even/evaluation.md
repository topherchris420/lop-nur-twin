# glide-jev-even-v1

```text
BLACKSITE EVALUATION

Environment
  commit:      f8f7cce1e5aff4f026afc946a913bcd16bd1059a
  experiment:  glide-jev-even-v1  (definition 6321acc9a69514df)
  status:      COMPLETE
  question:    Over ten seeds with no seat assistance, how do Jev (TypeSafe) and Glide (Fastino) compare in survival, kills and when they choose to fight, and is either one's play just the scripted marksman's strategy?
  primary:     deaths_per_minute — Times the seat was eliminated per minute of match time.
  decisions:   engage-disengage/v1 — Beneficial: the seat survived the window and dealt more damage than it took. Harmful: it died in the window. Otherwise neutral.
  episodes:    10 seeds × 120 s per arm, mode tdm, outcome window 5 s

Arm                   Deaths per minute             Success           Exposure  Latency p50 Cost      Decisions
jev                   0.20 [0.02, 0.38] (n=10)      57.8% (n=225)     24.2%     208 ms      n/a       4745
glide                 0.50 [0.26, 0.74] (n=10)      78.5% (n=107)     44.3%     810 ms      n/a       962
marksman              0.00 [0.00, 0.00] (n=10)      98.0% (n=1282)    44.8%     19 ms       $0        5304
random                0.70 [0.35, 1.04] (n=10)      14.8% (n=985)     48.4%     16 ms       $0        5024

jev calibration — provider-probability, probability on the weapon axis, against engage-disengage/v1 success (adequacy: exploratory)
  confidence    n      mean p   empirical success   95% interval
  0.00–0.49     30     0.44     73.3%               [55.6%, 85.8%]
  0.50–0.59     29     0.54     75.9%               [57.9%, 87.8%]  (n < 30)
  0.60–0.69     48     0.64     75.0%               [61.2%, 85.1%]
  0.70–0.79     37     0.75     62.2%               [46.1%, 75.9%]
  0.80–0.89     43     0.85     25.6%               [14.9%, 40.2%]
  0.90–1.00     38     0.92     42.1%               [27.9%, 57.8%]
  Brier 0.3391 (base-rate predictor 0.2440) · ECE 0.3098 · n=225
glide calibration — provider-probability, probability on the weapon axis, against engage-disengage/v1 success (adequacy: insufficient)
  confidence    n      mean p   empirical success   95% interval
  0.00–0.49     22     0.44     81.8%               [61.5%, 92.7%]  (n < 30)
  0.50–0.59     25     0.56     68.0%               [48.4%, 82.8%]  (n < 30)
  0.60–0.69     27     0.65     74.1%               [55.3%, 86.8%]  (n < 30)
  0.70–0.79     16     0.75     87.5%               [64.0%, 96.5%]  (n < 30)
  0.80–0.89     15     0.84     86.7%               [62.1%, 96.3%]  (n < 30)
  0.90–1.00     2      0.95     100.0%              [34.2%, 100.0%]  (n < 30)
  Brier 0.2022 (base-rate predictor 0.1687) · ECE 0.1531 · n=107
marksman calibration: not available — script states no probability or confidence; none is filled in
random calibration: not available — random states no probability or confidence; none is filled in

Paired differences on deaths_per_minute (arm − reference, by seed)
  jev − random                                 -0.499 [-0.738, -0.261] over 10 seeds
  glide − random                               -0.200 [-0.545, 0.145] over 10 seeds
  marksman − random                            -0.699 [-1.044, -0.354] over 10 seeds
  Paired by seed, not by trajectory: the same seed starts the same match, but frame pacing is not deterministic and the worlds diverge within seconds.

Warnings
  - [warning] stationary-dominance: marksman leads every arm on deaths_per_minute while moving 0.0 m per episode (threshold: under 10 m).
      possible causes: the environment rewards holding still (the marksman exploit); opponents cannot reach a still seat at range; a genuine strategy — confirm by running the scripted marksman on the same seeds
      run: node tools/experiment.mjs tools/experiments/exposure.json
  - [warning] action-concentration: jev chose weapon=NO_FIRE in 97.3% of 4745 decisions where the weapon axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] option-position-bias: jev chose slot 0 of the target axis in 95.5% of 67 decisions with two or more slots offered; a position-blind chooser would pick it 42.4% of the time.
      possible causes: model preference for what slot 0 is (nearest cover, nearest enemy); option-order bias: preference for the first option shown; an environment where the first-listed option really is best; controller dominance: the choice matters little either way
      run: npm run experiment:shuffle-options
  - [warning] option-position-bias: jev chose slot 0 of the go axis in 100.0% of 593 decisions with two or more slots offered; a position-blind chooser would pick it 40.3% of the time.
      possible causes: model preference for what slot 0 is (nearest cover, nearest enemy); option-order bias: preference for the first option shown; an environment where the first-listed option really is best; controller dominance: the choice matters little either way
      run: npm run experiment:shuffle-options
  - [info] cost-unknown: jev calls a paid model but its cost is unknown: no price for it in the pricing configuration, or token counts were not reported.
      possible causes: config/pricing.json has no sourced price for this model
      run: fill config/pricing.json with a cited price and re-run the evaluation (no new episodes needed)
  - [warning] option-position-bias: glide chose slot 0 of the target axis in 82.7% of 110 decisions with two or more slots offered; a position-blind chooser would pick it 39.6% of the time.
      possible causes: model preference for what slot 0 is (nearest cover, nearest enemy); option-order bias: preference for the first option shown; an environment where the first-listed option really is best; controller dominance: the choice matters little either way
      run: npm run experiment:shuffle-options
  - [warning] option-position-bias: glide chose slot 0 of the go axis in 92.3% of 169 decisions with two or more slots offered; a position-blind chooser would pick it 40.2% of the time.
      possible causes: model preference for what slot 0 is (nearest cover, nearest enemy); option-order bias: preference for the first option shown; an environment where the first-listed option really is best; controller dominance: the choice matters little either way
      run: npm run experiment:shuffle-options
  - [info] cost-unknown: glide calls a paid model but its cost is unknown: no price for it in the pricing configuration, or token counts were not reported.
      possible causes: config/pricing.json has no sourced price for this model
      run: fill config/pricing.json with a cited price and re-run the evaluation (no new episodes needed)
  - [warning] action-concentration: marksman chose move=HOLD in 100.0% of 5304 decisions where the move axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] action-concentration: marksman chose target=TARGET_0 in 99.2% of 1326 decisions where the target axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] action-concentration: marksman chose go=NONE in 100.0% of 2453 decisions where the go axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] option-position-bias: marksman chose slot 0 of the target axis in 96.9% of 325 decisions with two or more slots offered; a position-blind chooser would pick it 42.2% of the time.
      possible causes: model preference for what slot 0 is (nearest cover, nearest enemy); option-order bias: preference for the first option shown; an environment where the first-listed option really is best; controller dominance: the choice matters little either way
      run: npm run experiment:shuffle-options
  - [warning] impossible-survival: marksman never died in 1201 s of match time while in some enemy's sight line 45% of the time.
      possible causes: opponents are too weak against the seat (seat mercy rules, aim cones tuned for short range); the seat kills first every time — itself a sign the contest is one-sided
      run: rerun the arm with "seat": "even"
  - [warning] low-opponent-hit-rate: Enemies fired 868 rounds while holding a sight line to marksman's seat and hit it 12 times (1.4%, threshold 2%).
      possible causes: bot aim is tuned for another range than the seat fights at; rounds counted were aimed at someone else in the same line (the proxy over-counts)
      run: rerun with "seat": "even" and compare
  - [warning] model-irrelevance: On deaths_per_minute, glide is not distinguishable from random (random choices through the same controllers): paired difference -0.200 with a 95% interval [-0.545, 0.145] over 10 seeds.
      possible causes: the deterministic controller solves most of the task; the metric does not depend on the choices the brain makes; too few seeds to separate them
      run: node tools/experiment.mjs tools/experiments/controller-ablation.json

Artifacts
  experiment definition: definition.json
  jev: 30 files (jev.json, jev.seed42.eval.json.gz, …)
  glide: 30 files (glide.json, glide.seed42.eval.json.gz, …)
  marksman: 30 files (marksman.json, marksman.seed42.eval.json.gz, …)
  random: 30 files (random.json, random.seed42.eval.json.gz, …)

Note: Episodes are the unit of every interval. Episodes on the same seed start the same match but diverge: frame pacing is not deterministic.
Note: Decision-level pools overlap in time; their n overstates independent evidence.
Note: Outcome contract engage-disengage/v1: Beneficial: the seat survived the window and dealt more damage than it took. Harmful: it died in the window. Otherwise neutral.
```
