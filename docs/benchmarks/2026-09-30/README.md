# Place clearance: 30 September 2026 (UTC)

An offline scripted-policy experiment, declared before gameplay changes.
No TypeSafe or other model API was called. Definition hash: `38ff2f8b387b8ae5`.
Three 45-second domination episodes per arm, seeds 42–44, even seat rules,
precision control, rendered matrices only. All twelve episodes kept pace
with real time; none was flagged as lagged.

The question: does checking a standing body's walk instead of a thin center
ray reduce blocked navigation without trading away engagement?

The baseline offered objective centres without checking the route, tested
only a waist-height center ray for other places, and called places hidden
from a crouched eye. The candidate checks standing clearance, body width,
terrain and a maximum 128 m route; concealment tests the standing eye.
When all live feelers are blocked the navigator stops pressing movement.

## Every seed

| Seat              | Seed | Blocked / ended, before → after | Arrived, before → after | Kills/deaths, before → after | Metres, before → after |
| :---------------- | ---: | :------------------------------ | :---------------------- | :--------------------------- | :--------------------- |
| skirmisher-places |   42 | 9/9 → 0/5                       | 0 → 5                   | 4/0 → 10/1                   | 105.8 → 111.3          |
| skirmisher-places |   43 | 4/6 → 0/5                       | 1 → 5                   | 14/0 → 14/0                  | 140.0 → 91.2           |
| skirmisher-places |   44 | 0/5 → 0/6                       | 4 → 6                   | 11/0 → 12/0                  | 186.4 → 108.1          |
| skirmisher-steps  |   42 | n/a → n/a                       | n/a → n/a               | 8/0 → 12/0                   | 170.6 → 173.0          |
| skirmisher-steps  |   43 | n/a → n/a                       | n/a → n/a               | 14/0 → 17/0                  | 163.5 → 170.2          |
| skirmisher-steps  |   44 | n/a → n/a                       | n/a → n/a               | 13/0 → 8/0                   | 167.5 → 177.8          |

The declared primary metric is the **mean episode share** of ended travels
released as blocked: 55.6% before, 0% after. This differs from pooling all
releases (13/20 before, 0/16 after). Replacements, timeouts and clears remain
in the denominator; active trips and resets on death are not ended samples.
One baseline trip started before the benchmark counters reset, so the number
of releases can exceed the number of choices during that episode.

All sixteen candidate ended trips arrived. This supports the narrower claim
that offered destinations are more executable in these episodes. It does not
establish stronger tactical play: places exposure averaged 46.6% before and
46.4% after; distance fell, and the candidate lost a life on seed 42. The
unchanged steps arm's kills and exposure also moved substantially. Browser
pacing diverges trajectories even on matched seeds, and three short seeds are
exploratory evidence, not a model ranking or a general performance guarantee.

**No candidate objective trips were chosen in this run.** Obstructed or distant
objective centres are withheld rather than silently walked toward. The
objective observation still reports the goal, but navigating around structures
requires steps control or future route planning. Fewer blocked trips is not
proof of improved objective completion.

A preliminary candidate run completed its places arm but its steps arm failed
to start; that incomplete run is not the table above. The final candidate was
served from a frozen checkout to isolate it from edits and reloads.

## Reproduce the source and evaluate the evidence

The exact source commits are included in `place-clearance-source.bundle`,
which requires the repository's existing base `aa9dd47`. This keeps the measured
local revisions available even when the review branch is published through
GitHub's API with different commit metadata.

```sh
git bundle verify docs/benchmarks/2026-09-30/place-clearance-source.bundle
git fetch docs/benchmarks/2026-09-30/place-clearance-source.bundle codex/shared-tactical-places:reproduce/place-clearance
git worktree add /tmp/lop-before 4c280931086033812f556042eaf07f1eb7b27aea
git worktree add /tmp/lop-after 37060b2582fe25ac38ac086103480760c2a049c0
# Install dependencies and serve each checkout on a different port.
# Run the declaration from that checkout against its own server, sequentially:
node tools/experiment.mjs tools/experiments/place-clearance.json --origin http://localhost:5173

# Re-evaluate the archived, compressed decision records without playing:
node tools/experiment.mjs --evaluate docs/benchmarks/2026-09-30/place-clearance-before
node tools/experiment.mjs --evaluate docs/benchmarks/2026-09-30/place-clearance-after
node tools/experiment.mjs --compare docs/benchmarks/2026-09-30/place-clearance-before/evaluation.json docs/benchmarks/2026-09-30/place-clearance-after/evaluation.json
```

The directories include the declaration, every episode report, evaluation,
CSV, and gzipped decision records and traces. The source bundle also preserves
the declaration commit before any gameplay change.
