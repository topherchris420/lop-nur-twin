# glide-jev-direct-v1

```text
BLACKSITE EVALUATION

Environment
  commit:      f8f7cce1e5aff4f026afc946a913bcd16bd1059a
  experiment:  glide-jev-direct-v1  (definition 24e6b8f6401f2c55)
  status:      COMPLETE
  question:    Without the aiming controller, when each model turns the view itself in fixed steps, how do Jev (TypeSafe) and Glide (Fastino) compare in kills, survival and accuracy?
  primary:     kills_per_minute — Eliminations credited to the seat per minute of match time.
  decisions:   engage-disengage/v1 — Beneficial: the seat survived the window and dealt more damage than it took. Harmful: it died in the window. Otherwise neutral.
  episodes:    10 seeds × 120 s per arm, mode tdm, outcome window 5 s

Arm                   Kills per minute              Success           Exposure  Latency p50 Cost      Decisions
jev                   0.05 [-0.06, 0.16] (n=10)     3.0% (n=542)      27.8%     212 ms      n/a       4657
glide                 0.05 [-0.06, 0.16] (n=10)     6.6% (n=366)      67.1%     791 ms      n/a       758
random                0.00 [0.00, 0.00] (n=10)      0.0% (n=254)      48.0%     16 ms       $0        5091

jev calibration — provider-probability, probability on the weapon axis, against engage-disengage/v1 success (adequacy: exploratory)
  confidence    n      mean p   empirical success   95% interval
  0.00–0.49     23     0.44     8.7%                [2.4%, 26.8%]  (n < 30)
  0.50–0.59     17     0.54     0.0%                [0.0%, 18.4%]  (n < 30)
  0.60–0.69     38     0.65     7.9%                [2.7%, 20.8%]
  0.70–0.79     81     0.75     3.7%                [1.3%, 10.3%]
  0.80–0.89     138    0.85     5.8%                [3.0%, 11.0%]
  0.90–1.00     245    0.94     0.0%                [0.0%, 1.5%]
  Brier 0.6985 (base-rate predictor 0.0286) · ECE 0.8036 · n=542
glide calibration — provider-probability, probability on the weapon axis, against engage-disengage/v1 success (adequacy: exploratory)
  confidence    n      mean p   empirical success   95% interval
  0.00–0.49     56     0.46     7.1%                [2.8%, 17.0%]
  0.50–0.59     67     0.55     7.5%                [3.2%, 16.3%]
  0.60–0.69     73     0.65     4.1%                [1.4%, 11.4%]
  0.70–0.79     104    0.75     1.9%                [0.5%, 6.7%]
  0.80–0.89     37     0.83     5.4%                [1.5%, 17.7%]
  0.90–1.00     29     0.94     27.6%               [14.7%, 45.7%]  (n < 30)
  Brier 0.4424 (base-rate predictor 0.0613) · ECE 0.6060 · n=366
random calibration: not available — random states no probability or confidence; none is filled in

Paired differences on kills_per_minute (arm − reference, by seed)
  jev − random                                 0.050 [-0.063, 0.163] over 10 seeds
  glide − random                               0.050 [-0.063, 0.163] over 10 seeds
  Paired by seed, not by trajectory: the same seed starts the same match, but frame pacing is not deterministic and the worlds diverge within seconds.

Warnings
  - [warning] action-concentration: jev chose weapon=NO_FIRE in 99.1% of 4657 decisions where the weapon axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] option-position-bias: jev chose slot 0 of the go axis in 99.8% of 592 decisions with two or more slots offered; a position-blind chooser would pick it 41.4% of the time.
      possible causes: model preference for what slot 0 is (nearest cover, nearest enemy); option-order bias: preference for the first option shown; an environment where the first-listed option really is best; controller dominance: the choice matters little either way
      run: npm run experiment:shuffle-options
  - [info] cost-unknown: jev calls a paid model but its cost is unknown: no price for it in the pricing configuration, or token counts were not reported.
      possible causes: config/pricing.json has no sourced price for this model
      run: fill config/pricing.json with a cited price and re-run the evaluation (no new episodes needed)
  - [warning] action-concentration: glide chose move=HOLD in 95.6% of 758 decisions where the move axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] option-position-bias: glide chose slot 0 of the go axis in 87.9% of 99 decisions with two or more slots offered; a position-blind chooser would pick it 40.2% of the time.
      possible causes: model preference for what slot 0 is (nearest cover, nearest enemy); option-order bias: preference for the first option shown; an environment where the first-listed option really is best; controller dominance: the choice matters little either way
      run: npm run experiment:shuffle-options
  - [info] cost-unknown: glide calls a paid model but its cost is unknown: no price for it in the pricing configuration, or token counts were not reported.
      possible causes: config/pricing.json has no sourced price for this model
      run: fill config/pricing.json with a cited price and re-run the evaluation (no new episodes needed)
  - [warning] model-irrelevance: On kills_per_minute, jev is not distinguishable from random (random choices through the same controllers): paired difference 0.050 with a 95% interval [-0.063, 0.163] over 10 seeds.
      possible causes: the deterministic controller solves most of the task; the metric does not depend on the choices the brain makes; too few seeds to separate them
      run: node tools/experiment.mjs tools/experiments/controller-ablation.json
  - [warning] model-irrelevance: On kills_per_minute, glide is not distinguishable from random (random choices through the same controllers): paired difference 0.050 with a 95% interval [-0.063, 0.163] over 10 seeds.
      possible causes: the deterministic controller solves most of the task; the metric does not depend on the choices the brain makes; too few seeds to separate them
      run: node tools/experiment.mjs tools/experiments/controller-ablation.json

Artifacts
  experiment definition: definition.json
  jev: 30 files (jev.json, jev.seed42.eval.json.gz, …)
  glide: 30 files (glide.json, glide.seed42.eval.json.gz, …)
  random: 30 files (random.json, random.seed42.eval.json.gz, …)

Note: Episodes are the unit of every interval. Episodes on the same seed start the same match but diverge: frame pacing is not deterministic.
Note: Decision-level pools overlap in time; their n overstates independent evidence.
Note: Outcome contract engage-disengage/v1: Beneficial: the seat survived the window and dealt more damage than it took. Harmful: it died in the window. Otherwise neutral.
```
