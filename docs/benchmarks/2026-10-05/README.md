# Jev and Glide on the same seeds: 5 October 2026 (UTC)

Two live models in the player's seat, asked the same question from the same
observations: TypeSafe's Jev (`jev-1.13.0`) and Fastino's Glide (`glide`),
with a seeded random policy as the floor. The experiment was declared and
committed before it ran (`tools/experiments/glide-jev-comparison.json`,
definition hash `f16d1ec31051870b`) and measured at commit `e097b1f`.

Seeds 42 and 43, 60 s each, team deathmatch, the default mercy seat rules,
precision control and places navigation — the settings of the first Glide
benchmark earlier that evening. One dev server in a cloud container, rendering
stubbed to matrices, arms run one after another. All six episodes kept pace
with real time; none was flagged as lagged, and no page logged an error.

## Every episode

| Arm    | Seed | Kills / deaths | Rounds / hits | Decisions | Mean round trip | Metres moved | Time in a sight line |
| :----- | ---: | :------------- | :------------ | --------: | --------------: | -----------: | -------------------: |
| jev    |   42 | 3 / 0          | 4 / 3         |       254 |          192 ms |          120 |                33.7% |
| jev    |   43 | 2 / 0          | 3 / 2         |       247 |          205 ms |          166 |                29.0% |
| glide  |   42 | 1 / 0          | 3 / 3         |        57 |        1,027 ms |           43 |                50.1% |
| glide  |   43 | 4 / 0          | 14 / 7        |        58 |        1,009 ms |           69 |                57.6% |
| random |   42 | 0 / 0          | 44 / 0        |       265 |           14 ms |          161 |                88.2% |
| random |   43 | 0 / 1          | 31 / 0        |       243 |           11 ms |          122 |                87.5% |

## Arm totals

| Measure                                | Jev             | Glide           |
| :------------------------------------- | :-------------- | :-------------- |
| kills per minute (primary)             | 2.49            | 2.49            |
| kills / deaths                         | 5 / 0           | 5 / 0           |
| rounds / hits                          | 7 / 5           | 17 / 10         |
| damage taken                           | none            | about 78 points |
| decisions accepted                     | 501, ~250 a min | 115, ~57 a min  |
| round trip p50 / p95                   | 197 / 266 ms    | 830 / 3,137 ms  |
| server → provider p50 / p95            | 146 / 208 ms    | 797 / 3,086 ms  |
| timeouts                               | 0               | 0               |
| answers that met a changed world       | 7 (1.4%)        | 23 (20.0%)      |
| refused at execution as stale (strict) | 47 (9.4%)       | 19 (16.5%)      |
| metres moved                           | 286             | 112             |
| time in an enemy's sight line (mean)   | 31.3%           | 53.9%           |
| cost                                   | unknown         | unknown         |

Neither provider's price is configured in `config/pricing.json`, so cost is
unknown for both, not zero.

## The hypothesis failed

The declaration predicted that Jev's kills per minute would be at least
Glide's on each seed, and that the prediction fails if Glide out-kills Jev on
either. Glide out-killed Jev on seed 43, four to two. Over both seeds the two
arms are tied at five kills each.

The mechanism the hypothesis rested on did show. Glide decided about a quarter
as often as Jev, and a fifth of its answers arrived after something it had been
shown had changed, against one in seventy of Jev's. Deciding less often did not
cost it kills here.

## What each chose

They played differently. Jev declined to fire in 489 of 501 decisions and
named a target in 21; it walked under its own movement choices in about a third
of decisions, and every one of its 57 place choices was the first place listed,
which the evaluation flags as a possible position bias. Glide held still with
the movement axis every time, moving only by place choices (17, all the first
place); it named a target in 19 of 115 decisions and fired or aimed in 26. It
fired more rounds, spent more of its life in sight lines, and took damage on
both seeds where Jev took none.

## How far this goes

Two seeds of one minute each is a smoke test, not a ranking. The same seeds
do not replay the same match: frame pacing diverges the worlds within seconds.
The first Glide benchmark on these seeds, forty minutes earlier, recorded nine
kills and six upstream timeouts; this run recorded five kills and none. Both
seats fought under the default mercy rules with the precision controller doing
the aiming, so these figures describe each model's choices together with that
controller and those rules. A claim about either model needs the 10- or
30-seed presets and `"seat": "even"`.

A first run of the same declaration lost its Jev arm: edits to the working
tree during the arm remounted the page twice before the match went live, and
the arm timed out. Its partial evaluation is not reported. The whole
declaration was then run again, all three arms, with nothing edited while it
ran; that run is the one archived here.

## Reproduce

Start the dev server with `TYPESAFE_API_KEY` and `FASTINO_API_KEY` in its
environment, then:

```sh
JEV_LIVE_TEST=1 FASTINO_LIVE_TEST=1 node tools/experiment.mjs \
  tools/experiments/glide-jev-comparison.json --require-live

# Re-evaluate the archived, compressed decision records without playing:
node tools/experiment.mjs --evaluate docs/benchmarks/2026-10-05/glide-jev-comparison
```

The directory holds the declaration as run, every episode report, the
evaluation, the CSV, and each episode's decision records and trace, gzipped.
