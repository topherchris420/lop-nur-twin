# controller-ablation-v1

```text
BLACKSITE EVALUATION

Environment
  commit:      e9c405ed731d4c186126e6c1300483ce23c45ce0
  experiment:  controller-ablation-v1  (definition 51e20adc3796a0c7)
  status:      PARTIAL
  question:    How much of the seat's damage output comes from the choices, and how much from the aiming controller?
  primary:     damage_dealt_per_minute — Damage the resolver applied from the seat per minute.
  episodes:    3 seeds × 120 s per arm, mode tdm, outcome window 5 s

Arm                   Damage dealt / min            Success           Exposure  Latency p50 Cost      Decisions
skirmisher-precision  1268.53 [227.71, 2309.35] (n=3) n/a               27.1%     6 ms        $0        1525
skirmisher-degraded   1187.87 [506.96, 1868.77] (n=3) n/a               29.3%     7 ms        $0        1474
skirmisher-direct     196.14 [-276.16, 668.44] (n=3) n/a               48.5%     8 ms        $0        1520
random-precision      21.08 [-27.95, 70.12] (n=3)   n/a               67.4%     13 ms       $0        1550
random-degraded       32.52 [-43.74, 108.78] (n=3)  n/a               48.1%     9 ms        $0        1566
random-direct         0.00 [0.00, 0.00] (n=3)       n/a               52.9%     8 ms        $0        1536
jev-precision         PENDING — arm jev-precision calls a paid jev API; set JEV_LIVE_TEST=1 to confirm
jev-degraded          PENDING — arm jev-degraded calls a paid jev API; set JEV_LIVE_TEST=1 to confirm
jev-direct            PENDING — arm jev-direct calls a paid jev API; set JEV_LIVE_TEST=1 to confirm

skirmisher-precision calibration: not available — the experiment declares no decision type to score against
skirmisher-degraded calibration: not available — the experiment declares no decision type to score against
skirmisher-direct calibration: not available — the experiment declares no decision type to score against
random-precision calibration: not available — the experiment declares no decision type to score against
random-degraded calibration: not available — the experiment declares no decision type to score against
random-direct calibration: not available — the experiment declares no decision type to score against

Paired differences on damage_dealt_per_minute (arm − reference, by seed)
  skirmisher-precision − random-precision      1247.446 [241.057, 2253.835] over 3 seeds
  skirmisher-degraded − random-precision       1166.782 [466.191, 1867.373] over 3 seeds
  skirmisher-direct − random-precision         175.056 [-345.458, 695.571] over 3 seeds
  random-degraded − random-precision           11.434 [-15.821, 38.689] over 3 seeds
  random-direct − random-precision             -21.085 [-70.120, 27.950] over 3 seeds
  Paired by seed, not by trajectory: the same seed starts the same match, but frame pacing is not deterministic and the worlds diverge within seconds.

Contribution (matched ablations; descriptive, not a decomposition)
  motor: standard → degraded  -80.664 [-1081.382, 920.054] (n=3; skirmisher-precision → skirmisher-degraded)
  control: direct → precision  1072.390 [-386.004, 2530.784] (n=3; skirmisher-direct → skirmisher-precision)
  brain: random → script:skirmisher  1247.446 [241.057, 2253.835] (n=3; random-precision → skirmisher-precision)
  motor: standard → degraded  11.434 [-15.821, 38.689] (n=3; random-precision → random-degraded)
  brain: random → script:skirmisher  1155.348 [443.955, 1866.741] (n=3; random-degraded → skirmisher-degraded)
  brain: random → script:skirmisher  196.141 [-276.156, 668.439] (n=3; random-direct → skirmisher-direct)
  control: direct → precision  21.085 [-27.950, 70.120] (n=3; random-direct → random-precision)
  interaction brain × control: 1051.305 (n=3)
  interaction brain × motor: 92.098 (n=3)
  Each contrast is the paired, by-seed difference between two arms that differ in one factor only, at the other factors' stated levels. It is descriptive for this design and this environment. Effects interact, so they are not shares of a whole and do not sum to one.

Warnings
  - [info] insufficient-seeds: 3 seeds per arm. Treat every difference as exploratory; use a 10-seed development set or a 30-seed evaluation set before claiming one.
      possible causes: a quick check, by design
      run: set "seeds": { "preset": "dev" } or { "preset": "eval" }
  - [warning] action-concentration: skirmisher-precision chose move=HOLD in 100.0% of 1525 decisions where the move axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] action-concentration: skirmisher-precision chose target=TARGET_0 in 98.5% of 194 decisions where the target axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] option-position-bias: skirmisher-precision chose slot 0 of the target axis in 92.7% of 41 decisions with two or more slots offered; a position-blind chooser would pick it 42.1% of the time.
      possible causes: model preference for what slot 0 is (nearest cover, nearest enemy); option-order bias: preference for the first option shown; an environment where the first-listed option really is best; controller dominance: the choice matters little either way
      run: npm run experiment:shuffle-options
  - [warning] action-concentration: skirmisher-degraded chose move=HOLD in 100.0% of 1474 decisions where the move axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] action-concentration: skirmisher-degraded chose target=TARGET_0 in 98.6% of 215 decisions where the target axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] option-position-bias: skirmisher-degraded chose slot 0 of the target axis in 94.7% of 57 decisions with two or more slots offered; a position-blind chooser would pick it 48.1% of the time.
      possible causes: model preference for what slot 0 is (nearest cover, nearest enemy); option-order bias: preference for the first option shown; an environment where the first-listed option really is best; controller dominance: the choice matters little either way
      run: npm run experiment:shuffle-options
  - [warning] action-concentration: skirmisher-direct chose move=HOLD in 100.0% of 1520 decisions where the move axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] model-irrelevance: On damage_dealt_per_minute, skirmisher-direct is not distinguishable from random-direct (random choices through the same controllers): paired difference 196.141 with a 95% interval [-276.156, 668.439] over 3 seeds.
      possible causes: the deterministic controller solves most of the task; the metric does not depend on the choices the brain makes; too few seeds to separate them
      run: node tools/experiment.mjs tools/experiments/controller-ablation.json

Artifacts
  experiment definition: definition.json
  skirmisher-precision: 9 files (skirmisher-precision.json, skirmisher-precision.seed42.eval.json.gz, …)
  skirmisher-degraded: 9 files (skirmisher-degraded.json, skirmisher-degraded.seed42.eval.json.gz, …)
  skirmisher-direct: 9 files (skirmisher-direct.json, skirmisher-direct.seed42.eval.json.gz, …)
  random-precision: 9 files (random-precision.json, random-precision.seed42.eval.json.gz, …)
  random-degraded: 9 files (random-degraded.json, random-degraded.seed42.eval.json.gz, …)
  random-direct: 9 files (random-direct.json, random-direct.seed42.eval.json.gz, …)
  jev-precision: 0 files ()
  jev-degraded: 0 files ()
  jev-direct: 0 files ()

Note: Episodes are the unit of every interval. Episodes on the same seed start the same match but diverge: frame pacing is not deterministic.
Note: Decision-level pools overlap in time; their n overstates independent evidence.
Note: Arm jev-precision is pending: arm jev-precision calls a paid jev API; set JEV_LIVE_TEST=1 to confirm. No figure for it is a measurement.
Note: Arm jev-degraded is pending: arm jev-degraded calls a paid jev API; set JEV_LIVE_TEST=1 to confirm. No figure for it is a measurement.
Note: Arm jev-direct is pending: arm jev-direct calls a paid jev API; set JEV_LIVE_TEST=1 to confirm. No figure for it is a measurement.
```
