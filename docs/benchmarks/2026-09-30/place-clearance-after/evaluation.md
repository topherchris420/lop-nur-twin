# place-clearance-v1

```text
BLACKSITE EVALUATION

Environment
  commit:      37060b2582fe25ac38ac086103480760c2a049c0
  experiment:  place-clearance-v1  (definition 38ff2f8b387b8ae5)
  status:      COMPLETE
  question:    Does checking a body's walk, rather than a center ray, reduce blocked place navigation without trading away engagement?
  primary:     place_blocked_rate — Share of ended travels released as blocked. Replacements, timeouts and clears remain in the denominator; active travels and resets on death are not ended-travel samples.
  episodes:    3 seeds × 45 s per arm, mode domination, outcome window 5 s

Arm                   Travels stopped by obstruction Success           Exposure  Latency p50 Cost      Decisions
skirmisher-places     0.00 [0.00, 0.00] (n=3)       n/a               46.4%     8 ms        $0        606
skirmisher-steps      n/a                           n/a               47.7%     1 ms        $0        624

skirmisher-places calibration: not available — the experiment declares no decision type to score against
skirmisher-steps calibration: not available — the experiment declares no decision type to score against

Paired differences on place_blocked_rate (arm − reference, by seed)
  skirmisher-places − skirmisher-steps         n/a (no interval) over 0 seeds
  Paired by seed, not by trajectory: the same seed starts the same match, but frame pacing is not deterministic and the worlds diverge within seconds.

Warnings
  - [info] insufficient-seeds: 3 seeds per arm. Treat every difference as exploratory; use a 10-seed development set or a 30-seed evaluation set before claiming one.
      possible causes: a quick check, by design
      run: set "seeds": { "preset": "dev" } or { "preset": "eval" }
  - [warning] action-concentration: skirmisher-places chose move=HOLD in 100.0% of 606 decisions where the move axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] action-concentration: skirmisher-places chose target=TARGET_0 in 96.5% of 114 decisions where the target axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] option-position-bias: skirmisher-places chose slot 0 of the target axis in 87.1% of 31 decisions with two or more slots offered; a position-blind chooser would pick it 41.7% of the time.
      possible causes: model preference for what slot 0 is (nearest cover, nearest enemy); option-order bias: preference for the first option shown; an environment where the first-listed option really is best; controller dominance: the choice matters little either way
      run: npm run experiment:shuffle-options
  - [warning] action-concentration: skirmisher-steps chose target=TARGET_0 in 100.0% of 151 decisions where the target axis offered a choice (threshold 95%).
      possible causes: a policy that does one thing (true of scripted policies); the other options are never worth choosing in this environment; the model ignores the axis
  - [warning] option-position-bias: skirmisher-steps chose slot 0 of the target axis in 100.0% of 39 decisions with two or more slots offered; a position-blind chooser would pick it 42.3% of the time.
      possible causes: model preference for what slot 0 is (nearest cover, nearest enemy); option-order bias: preference for the first option shown; an environment where the first-listed option really is best; controller dominance: the choice matters little either way
      run: npm run experiment:shuffle-options

Artifacts
  experiment definition: definition.json
  skirmisher-places: 9 files (skirmisher-places.json, skirmisher-places.seed42.eval.json.gz, …)
  skirmisher-steps: 9 files (skirmisher-steps.json, skirmisher-steps.seed42.eval.json.gz, …)

Note: Episodes are the unit of every interval. Episodes on the same seed start the same match but diverge: frame pacing is not deterministic.
Note: Decision-level pools overlap in time; their n overstates independent evidence.
```
