# glide-jev-comparison-v1

```text
BLACKSITE EVALUATION

Environment
  commit:      e097b1fbc005f5e664cd43af8bb106d4b6b3f755
  experiment:  glide-jev-comparison-v1  (definition f16d1ec31051870b)
  status:      COMPLETE
  question:    Asked the same question from the same observation, with the same options, controllers and scoring, how do Jev (TypeSafe) and Glide (Fastino) differ in what they choose, how often they decide, and what the seat achieves?
  primary:     kills_per_minute — Eliminations credited to the seat per minute of match time.
  episodes:    2 seeds × 60 s per arm, mode tdm, outcome window 5 s

Arm                   Kills per minute              Success           Exposure  Latency p50 Cost      Decisions
jev                   2.49 (n=2)                    n/a               31.3%     196 ms      n/a       501
glide                 2.49 (n=2)                    n/a               53.9%     830 ms      n/a       115
random                0.00 (n=2)                    n/a               87.9%     11 ms       $0        508

jev calibration: not available — the experiment declares no decision type to score against
glide calibration: not available — the experiment declares no decision type to score against
random calibration: not available — the experiment declares no decision type to score against

Paired differences on kills_per_minute (arm − reference, by seed)
  jev − random                                 2.494 (no interval) over 2 seeds
  glide − random                               2.493 (no interval) over 2 seeds
  Paired by seed, not by trajectory: the same seed starts the same match, but frame pacing is not deterministic and the worlds diverge within seconds.

Warnings
  - [info] insufficient-seeds: 2 seeds per arm. Treat every difference as exploratory; use a 10-seed development set or a 30-seed evaluation set before claiming one.
      possible causes: a quick check, by design
      run: set "seeds": { "preset": "dev" } or { "preset": "eval" }
  - [warning] action-concentration: jev chose weapon=NO_FIRE in 97.6% of 501 decisions where the weapon axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] option-position-bias: jev chose slot 0 of the go axis in 100.0% of 57 decisions with two or more slots offered; a position-blind chooser would pick it 38.2% of the time.
      possible causes: model preference for what slot 0 is (nearest cover, nearest enemy); option-order bias: preference for the first option shown; an environment where the first-listed option really is best; controller dominance: the choice matters little either way
      run: npm run experiment:shuffle-options
  - [info] cost-unknown: jev calls a paid model but its cost is unknown: no price for it in the pricing configuration, or token counts were not reported.
      possible causes: config/pricing.json has no sourced price for this model
      run: fill config/pricing.json with a cited price and re-run the evaluation (no new episodes needed)
  - [warning] action-concentration: glide chose move=HOLD in 100.0% of 115 decisions where the move axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [info] cost-unknown: glide calls a paid model but its cost is unknown: no price for it in the pricing configuration, or token counts were not reported.
      possible causes: config/pricing.json has no sourced price for this model
      run: fill config/pricing.json with a cited price and re-run the evaluation (no new episodes needed)
  - [warning] low-opponent-hit-rate: Enemies fired 264 rounds while holding a sight line to random's seat and hit it 5 times (1.9%, threshold 2%).
      possible causes: bot aim is tuned for another range than the seat fights at; rounds counted were aimed at someone else in the same line (the proxy over-counts)
      run: rerun with "seat": "even" and compare

Artifacts
  experiment definition: definition.json
  jev: 6 files (jev.json, jev.seed42.eval.json.gz, …)
  glide: 6 files (glide.json, glide.seed42.eval.json.gz, …)
  random: 6 files (random.json, random.seed42.eval.json.gz, …)

Note: Episodes are the unit of every interval. Episodes on the same seed start the same match but diverge: frame pacing is not deterministic.
Note: Decision-level pools overlap in time; their n overstates independent evidence.
```
