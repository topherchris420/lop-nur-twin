# cover-selection-v1

```text
BLACKSITE EVALUATION

Environment
  commit:      e9c405ed731d4c186126e6c1300483ce23c45ce0
  experiment:  cover-selection-v1  (definition 49a9816cbe3ca1f5)
  status:      PARTIAL
  question:    When a decision system chooses between places, does it choose ones that keep the seat out of enemy sight?
  primary:     exposure_fraction_next_window — Mean over the selected decisions of the share of window samples in which some enemy held a sight line to the seat.
  decisions:   cover-selection/v1 — Beneficial: in the window the seat did not die, took no damage, and was in some enemy's sight line in at most 25% of exposure samples (at most a quarter of the time seen). Harmful: it died, or took at least 25 damage (a quarter of full health). Otherwise neutral.
  episodes:    3 seeds × 120 s per arm, mode tdm, outcome window 5 s

Arm                   Exposure in the window after  Success           Exposure  Latency p50 Cost      Decisions
jev                   PENDING — arm jev calls a paid jev API; set JEV_LIVE_TEST=1 to confirm
llm                   PENDING — arm llm calls a paid llm API; set LLM_LIVE_TEST=1 to confirm
skirmisher            0.27 [0.05, 0.49] (n=3)       62.1% (n=29)      20.9%     6 ms        $0        1525
random                0.37 [-0.16, 0.89] (n=3)      55.2% (n=462)     46.9%     11 ms       $0        1494

skirmisher calibration: not available — script states no probability or confidence; none is filled in
random calibration: not available — random states no probability or confidence; none is filled in

Paired differences on exposure_fraction_next_window (arm − reference, by seed)
  skirmisher − random                          -0.096 [-0.794, 0.602] over 3 seeds
  Paired by seed, not by trajectory: the same seed starts the same match, but frame pacing is not deterministic and the worlds diverge within seconds.

Warnings
  - [info] insufficient-seeds: 3 seeds per arm. Treat every difference as exploratory; use a 10-seed development set or a 30-seed evaluation set before claiming one.
      possible causes: a quick check, by design
      run: set "seeds": { "preset": "dev" } or { "preset": "eval" }
  - [warning] action-concentration: skirmisher chose move=HOLD in 100.0% of 1525 decisions where the move axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] action-concentration: skirmisher chose target=TARGET_0 in 98.9% of 186 decisions where the target axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] option-position-bias: skirmisher chose slot 0 of the target axis in 95.7% of 46 decisions with two or more slots offered; a position-blind chooser would pick it 46.4% of the time.
      possible causes: model preference for what slot 0 is (nearest cover, nearest enemy); option-order bias: preference for the first option shown; an environment where the first-listed option really is best; controller dominance: the choice matters little either way
      run: npm run experiment:shuffle-options
  - [warning] model-irrelevance: On exposure_fraction_next_window, skirmisher is not distinguishable from random (random choices through the same controllers): paired difference -0.096 with a 95% interval [-0.794, 0.602] over 3 seeds.
      possible causes: the deterministic controller solves most of the task; the metric does not depend on the choices the brain makes; too few seeds to separate them
      run: node tools/experiment.mjs tools/experiments/controller-ablation.json

Artifacts
  experiment definition: definition.json
  jev: 0 files ()
  llm: 0 files ()
  skirmisher: 9 files (skirmisher.json, skirmisher.seed42.eval.json.gz, …)
  random: 9 files (random.json, random.seed42.eval.json.gz, …)

Note: Episodes are the unit of every interval. Episodes on the same seed start the same match but diverge: frame pacing is not deterministic.
Note: Decision-level pools overlap in time; their n overstates independent evidence.
Note: Outcome contract cover-selection/v1: Beneficial: in the window the seat did not die, took no damage, and was in some enemy's sight line in at most 25% of exposure samples (at most a quarter of the time seen). Harmful: it died, or took at least 25 damage (a quarter of full health). Otherwise neutral.
Note: Arm jev is pending: arm jev calls a paid jev API; set JEV_LIVE_TEST=1 to confirm. No figure for it is a measurement.
Note: Arm llm is pending: arm llm calls a paid llm API; set LLM_LIVE_TEST=1 to confirm. No figure for it is a measurement.
```
