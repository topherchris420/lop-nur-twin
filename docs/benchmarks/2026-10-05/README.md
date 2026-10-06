# Jev and Glide: 5 October 2026 (UTC)

Two live models in the player's seat, asked the same question from the same
observations: TypeSafe's Jev (`jev-1.13.0`) and Fastino's Glide (`glide`).
Three declared experiments, each committed before it ran:

| Experiment                                      | Seeds × length | Seat rules | Aiming                 | Prediction                           | Outcome |
| :---------------------------------------------- | :------------- | :--------- | :--------------------- | :----------------------------------- | :------ |
| [`glide-jev-even`](glide-jev-even/)             | 10 × 120 s     | even       | precision controller   | Glide dies more than Jev             | held    |
| [`glide-jev-direct`](glide-jev-direct/)         | 10 × 120 s     | even       | each model aims itself | Jev out-kills Glide                  | failed  |
| [`glide-jev-comparison`](glide-jev-comparison/) | 2 × 60 s       | mercy      | precision controller   | Jev kills at least Glide's, per seed | failed  |

What the ten-seed runs support:

- **With the aiming controller, Glide died more and Jev survived better.**
  Glide's deaths per minute exceeded Jev's by 0.30 (95% interval 0.12 to 0.48)
  and were higher on 7 of 10 seeds. Kills did not separate: Glide 37, Jev 28,
  a difference whose interval spans zero.
- **Without it, neither model could fight.** Each scored one kill in twenty
  minutes, indistinguishable from the random policy's none.
- **Neither model's play is the marksman's, and both lose to it badly.** The
  hand-written hold-still-and-shoot script scored 267 kills without dying under
  the same rules, and the evaluation flags that the environment still rewards
  standing still at range. That is a finding about the game.
- **The play styles differ consistently.** Jev decided five to six times as
  often, moved far more and spent less time in enemy sight lines in both
  experiments. Glide mostly held still, fired about as many rounds as Jev with
  the controller's help but hit with more of them, and was exposed for longer.

All three runs used team deathmatch, places navigation and one cloud
container with rendering stubbed to matrices. The two ten-seed experiments are
exploratory at n=10 per arm. A ranking claim would need the 30-seed preset.

## Ten seeds, even rules, with the aiming controller

`tools/experiments/glide-jev-even.json`, definition `6321acc9a69514df`,
measured at commit `f8f7cce`. Seeds 42–51, 120 s each, even seat rules, so the
seat takes and deals damage exactly as a bot does. Precision control: the
model names a target and an aim region, and a local controller aims and
holds the trigger. The scripted marksman is there to test whether either
model's result is just the hold-still strategy; the random policy is the floor.

### Arm totals (20 minutes of match per arm)

| Measure                                 | Jev               | Glide             | Marksman        | Random            |
| :-------------------------------------- | :---------------- | :---------------- | :-------------- | :---------------- |
| deaths per minute (primary), mean [95%] | 0.20 [0.02, 0.38] | 0.50 [0.26, 0.74] | 0.00            | 0.70 [0.35, 1.04] |
| kills / deaths                          | 28 / 4            | 37 / 10           | 267 / 0         | 2 / 14            |
| rounds / hits                           | 129 / 58          | 131 / 109         | 1,292 / 609     | 555 / 15          |
| decisions accepted                      | 4,744             | 960               | 5,303           | 5,023             |
| round trip p50 / p95                    | 208 / 286 ms      | 810 / 3,315 ms    | 19 / 41 ms      | 16 / 36 ms        |
| server → provider p50 / p95             | 149 / 205 ms      | 748 / 3,235 ms    | none            | none              |
| upstream timeouts                       | 0                 | 6                 | 0               | 0                 |
| answers that met a changed world        | 194 (4.1%)        | 196 (20.4%)       | 0               | 0                 |
| refused at execution as stale           | 517 (10.9%)       | 176 (18.3%)       | 0               | 0                 |
| engage-disengage success                | 57.8% (n=225)     | 78.5% (n=107)     | 98.0% (n=1,282) | 14.8% (n=985)     |
| time in an enemy's sight line (mean)    | 24.2%             | 44.3%             | 44.8%           | 48.4%             |
| metres moved                            | 3,080             | 1,120             | 0               | 2,952             |

Engage-disengage success is `engage-disengage/v1`, scored offline: a decision
taken with an enemy in view succeeds when the seat survives the next five
seconds and deals more damage than it takes. Its n counts overlapping
windows, so it overstates the independent evidence.

### Paired by seed, Glide minus Jev

| Metric                      | Mean difference [95% interval] | Glide higher / lower / equal |
| :-------------------------- | :----------------------------- | :--------------------------- |
| deaths per minute (primary) | +0.30 [+0.12, +0.48]           | 7 / 1 / 2                    |
| kills per minute            | +0.45 [−0.87, +1.77]           | 5 / 5 / 0                    |
| time in a sight line        | +20.1 points [+3.6, +36.7]     | 7 / 3 / 0                    |
| metres moved                | −196 [−240, −152]              | 0 / 10 / 0                   |

**The prediction held.** It said Glide would die more because it spent more
time exposed and decided more slowly, and would fail if Glide's mean deaths
per minute were no higher than Jev's. Glide's was higher, and the paired
interval excludes zero. Exposure moved the same way.

**Kills did not separate.** Glide's 37 against Jev's 28 is a paired
difference whose interval runs from about −0.9 to +1.8 kills a minute; the
seeds split five and five.

**They fight differently.** Jev declined to fire in 97% of its decisions and
walked 3 km across the ten episodes. Glide chose to hold still on the
movement axis in 88% of its decisions and walked about a third as far. It hit
with 109 of its 131 rounds against Jev's 58 of 129, and its decisions with an
enemy in view succeeded more often (78.5% against 57.8%). Both chose the first-listed place or target far more often than a
position-blind chooser would; the evaluation flags this as a possible
option-order bias that `npm run experiment:shuffle-options` can test.

**The marksman is not either model, and it wins outright.** It never moved,
never chose a place, fired at the first-listed target, and recorded 267 kills
and no deaths. The evaluation raises its stationary-dominance and
impossible-survival warnings even under even rules: at the ranges Blacksite's
bots fight at, holding still and shooting is still overwhelmingly effective.
Neither model plays that strategy, so neither model's score is the strategy's.

### Calibration: probabilities of a choice, not of an outcome

Both providers return a probability for every offered option. The evaluation
compares the probability each gave its chosen weapon option with whether the
decision succeeded under `engage-disengage/v1`.

- **Jev:** success fell as its stated probability rose: 73–76% below 0.70,
  26–42% at 0.80 and above. Brier 0.339, against 0.244 for always predicting
  the base rate.
- **Glide:** 68–88% across bins (and one bin of two decisions at 100%), with
  fewer than 30 decisions in every bin,
  so the evaluation rates it insufficient. Brier 0.202 against 0.169.

Neither probability predicts this outcome better than the base rate. That is
expected rather than damning: each is a probability over which option to
choose, not a forecast of the fight. A mismatch is a finding about using it as
an outcome proxy as much as about the model.

### Every episode

| Arm      | Seed | Kills / deaths | Rounds / hits | Decisions | Mean round trip | Metres moved | Time in a sight line |
| :------- | ---: | :------------- | :------------ | --------: | --------------: | -----------: | -------------------: |
| jev      |   42 | 3 / 0          | 21 / 7        |       507 |          187 ms |          326 |                27.5% |
| jev      |   43 | 1 / 0          | 5 / 2         |       498 |          201 ms |          370 |                24.0% |
| jev      |   44 | 1 / 0          | 5 / 2         |       489 |          210 ms |          299 |                11.7% |
| jev      |   45 | 0 / 1          | 0 / 0         |       468 |          211 ms |          338 |                27.5% |
| jev      |   46 | 4 / 0          | 23 / 10       |       476 |          220 ms |          288 |                21.1% |
| jev      |   47 | 0 / 0          | 0 / 0         |       484 |          217 ms |          350 |                17.9% |
| jev      |   48 | 2 / 1          | 14 / 7        |       451 |          218 ms |          256 |                40.6% |
| jev      |   49 | 3 / 0          | 18 / 7        |       463 |          231 ms |          336 |                12.5% |
| jev      |   50 | 6 / 1          | 25 / 12       |       450 |          220 ms |          253 |                26.2% |
| jev      |   51 | 8 / 1          | 18 / 11       |       458 |          220 ms |          265 |                33.2% |
| glide    |   42 | 3 / 0          | 9 / 7         |        65 |        1,109 ms |           88 |                37.9% |
| glide    |   43 | 0 / 1          | 3 / 2         |        85 |        1,312 ms |           95 |                22.5% |
| glide    |   44 | 3 / 1          | 9 / 9         |       114 |          975 ms |          198 |                35.7% |
| glide    |   45 | 3 / 1          | 10 / 10       |       103 |        1,063 ms |          137 |                35.9% |
| glide    |   46 | 4 / 1          | 16 / 14       |        91 |        1,221 ms |          104 |                53.5% |
| glide    |   47 | 8 / 1          | 28 / 19       |       108 |        1,044 ms |          105 |                70.9% |
| glide    |   48 | 1 / 1          | 3 / 3         |       105 |        1,069 ms |           95 |                39.8% |
| glide    |   49 | 7 / 0          | 28 / 22       |        95 |        1,235 ms |           59 |                75.7% |
| glide    |   50 | 6 / 2          | 21 / 19       |        99 |        1,070 ms |          114 |                41.7% |
| glide    |   51 | 2 / 2          | 4 / 4         |        95 |        1,121 ms |          124 |                29.5% |
| marksman |   42 | 27 / 0         | 108 / 60      |       527 |           17 ms |            0 |                36.3% |
| marksman |   43 | 29 / 0         | 132 / 64      |       526 |           17 ms |            0 |                47.0% |
| marksman |   44 | 19 / 0         | 96 / 40       |       525 |            8 ms |            0 |                50.1% |
| marksman |   45 | 28 / 0         | 121 / 62      |       535 |           17 ms |            0 |                47.9% |
| marksman |   46 | 30 / 0         | 155 / 70      |       531 |           21 ms |            0 |                42.7% |
| marksman |   47 | 24 / 0         | 95 / 49       |       534 |           12 ms |            0 |                33.9% |
| marksman |   48 | 24 / 0         | 147 / 56      |       532 |           17 ms |            0 |                46.1% |
| marksman |   49 | 27 / 0         | 117 / 68      |       532 |           17 ms |            0 |                40.8% |
| marksman |   50 | 33 / 0         | 192 / 73      |       532 |           20 ms |            0 |                53.9% |
| marksman |   51 | 26 / 0         | 129 / 67      |       529 |           20 ms |            0 |                49.2% |
| random   |   42 | 0 / 1          | 69 / 0        |       507 |           13 ms |          279 |                26.8% |
| random   |   43 | 0 / 2          | 64 / 3        |       485 |           11 ms |          262 |                40.6% |
| random   |   44 | 0 / 0          | 38 / 2        |       531 |           20 ms |          309 |                57.3% |
| random   |   45 | 0 / 2          | 62 / 0        |       485 |           19 ms |          297 |                61.3% |
| random   |   46 | 1 / 0          | 37 / 4        |       539 |           22 ms |          285 |                73.4% |
| random   |   47 | 0 / 1          | 42 / 0        |       508 |           14 ms |          332 |                32.4% |
| random   |   48 | 0 / 3          | 77 / 1        |       467 |           23 ms |          291 |                56.5% |
| random   |   49 | 1 / 1          | 41 / 3        |       514 |           13 ms |          292 |                56.5% |
| random   |   50 | 0 / 2          | 53 / 2        |       491 |           14 ms |          324 |                34.7% |
| random   |   51 | 0 / 2          | 72 / 0        |       496 |           12 ms |          281 |                44.3% |

## Ten seeds, even rules, each model aiming for itself

`tools/experiments/glide-jev-direct.json`, definition `24e6b8f6401f2c55`,
measured at commit `f8f7cce`. The same seeds, length, rules and navigation as
above, with only the control interface changed: the model turns the view in
fixed steps and pulls the trigger itself, and nothing aims for it.

### Arm totals (20 minutes of match per arm)

| Measure                                | Jev                | Glide                  | Random       |
| :------------------------------------- | :----------------- | :--------------------- | :----------- |
| kills per minute (primary), mean [95%] | 0.05 [−0.06, 0.16] | 0.05 [−0.06, 0.16]     | 0.00         |
| kills / deaths                         | 1 / 8              | 1 / 13                 | 0 / 10       |
| rounds / hits                          | 107 / 2            | 438 / 5                | 552 / 0      |
| decisions accepted                     | 4,656              | 758                    | 5,090        |
| round trip p50 / p95 (max)             | 212 / 285 ms (936) | 791 / 3,833 ms (5,759) | 16 / 38 ms   |
| server → provider p50 / p95            | 148 / 205 ms       | 722 / 3,757 ms         | none         |
| upstream timeouts                      | 0                  | 0                      | 0            |
| answers that met a changed world       | 207 (4.4%)         | 271 (35.8%)            | 0            |
| refused at execution as stale          | 443 (9.5%)         | 81 (10.7%)             | 0            |
| engage-disengage success               | 3.0% (n=542)       | 6.6% (n=366)           | 0.0% (n=254) |
| time in an enemy's sight line (mean)   | 27.8%              | 67.1%                  | 48.0%        |
| metres moved                           | 3,008              | 598                    | 3,036        |

### Paired by seed, Glide minus Jev

| Metric                     | Mean difference [95% interval] | Glide higher / lower / equal |
| :------------------------- | :----------------------------- | :--------------------------- |
| kills per minute (primary) | +0.00 [−0.17, +0.17]           | 1 / 1 / 8                    |
| deaths per minute          | +0.25 [−0.29, +0.79]           | 7 / 3 / 0                    |
| time in a sight line       | +39.4 points [+25.9, +52.9]    | 10 / 0 / 0                   |
| metres moved               | −241 [−315, −167]              | 1 / 9 / 0                    |

**The prediction failed.** It said Jev's faster decisions would let it correct
its aim more often and out-kill Glide, and would fail if Glide's mean kills
per minute were at least Jev's. Each made one kill in twenty minutes; they are
equal, and neither is distinguishable from random.

**Neither model can aim in fixed steps.** Jev almost never fired (99% of
decisions held fire) and turned in 13% of them. Glide aimed down the sights
often and fired 438 rounds for 5 hits, turning in 74% of its decisions. With
the controller, the same models scored 28 and 37 kills on the same seeds: in
Blacksite the controller does nearly all of the shooting, and a precision
result is the model's choice of whom to fight plus that controller's aim.

Glide was in an enemy's sight line for longer on every seed and died more on
seven of ten, but the deaths difference is not distinguishable from zero at
ten seeds. A third of Glide's answers met a changed world, the most of any
run, because under direct control the view keeps turning while it decides.

### Every episode

| Arm    | Seed | Kills / deaths | Rounds / hits | Decisions | Mean round trip | Metres moved | Time in a sight line |
| :----- | ---: | :------------- | :------------ | --------: | --------------: | -----------: | -------------------: |
| jev    |   42 | 0 / 2          | 0 / 0         |       463 |          198 ms |           79 |                20.0% |
| jev    |   43 | 0 / 2          | 0 / 0         |       435 |          215 ms |          215 |                53.5% |
| jev    |   44 | 0 / 1          | 15 / 0        |       452 |          226 ms |          361 |                37.3% |
| jev    |   45 | 0 / 0          | 0 / 0         |       469 |          228 ms |          362 |                20.8% |
| jev    |   46 | 0 / 0          | 0 / 0         |       477 |          220 ms |          331 |                24.1% |
| jev    |   47 | 0 / 0          | 0 / 0         |       479 |          220 ms |          363 |                19.3% |
| jev    |   48 | 0 / 0          | 0 / 0         |       487 |          214 ms |          370 |                18.9% |
| jev    |   49 | 1 / 1          | 81 / 2        |       464 |          214 ms |          249 |                29.1% |
| jev    |   50 | 0 / 0          | 0 / 0         |       497 |          204 ms |          379 |                16.2% |
| jev    |   51 | 0 / 2          | 11 / 0        |       433 |          221 ms |          297 |                38.6% |
| glide  |   42 | 0 / 1          | 0 / 0         |        91 |        1,203 ms |          103 |                25.4% |
| glide  |   43 | 0 / 0          | 142 / 1       |        95 |        1,242 ms |            3 |                94.6% |
| glide  |   44 | 0 / 1          | 49 / 0        |        74 |        1,486 ms |           67 |                84.3% |
| glide  |   45 | 0 / 1          | 25 / 0        |        64 |        1,755 ms |           38 |                96.2% |
| glide  |   46 | 0 / 1          | 5 / 0         |        76 |        1,479 ms |          110 |                45.2% |
| glide  |   47 | 0 / 3          | 15 / 0        |        53 |        1,868 ms |           53 |                66.9% |
| glide  |   48 | 1 / 1          | 40 / 2        |        70 |        1,595 ms |           48 |                63.6% |
| glide  |   49 | 0 / 3          | 39 / 0        |        76 |        1,324 ms |           54 |                72.5% |
| glide  |   50 | 0 / 1          | 30 / 0        |        60 |        1,846 ms |           99 |                59.9% |
| glide  |   51 | 0 / 1          | 93 / 2        |        99 |        1,086 ms |           23 |                62.8% |
| random |   42 | 0 / 3          | 73 / 0        |       463 |           19 ms |          282 |                36.4% |
| random |   43 | 0 / 1          | 55 / 0        |       508 |           14 ms |          296 |                82.3% |
| random |   44 | 0 / 0          | 44 / 0        |       531 |           18 ms |          292 |                87.1% |
| random |   45 | 0 / 2          | 56 / 0        |       485 |           10 ms |          256 |                31.9% |
| random |   46 | 0 / 0          | 46 / 0        |       533 |           19 ms |          336 |                35.4% |
| random |   47 | 0 / 1          | 52 / 0        |       507 |           16 ms |          307 |                24.7% |
| random |   48 | 0 / 1          | 39 / 0        |       510 |           21 ms |          321 |                58.3% |
| random |   49 | 0 / 1          | 42 / 0        |       508 |           13 ms |          324 |                23.6% |
| random |   50 | 0 / 0          | 56 / 0        |       535 |           19 ms |          327 |                56.9% |
| random |   51 | 0 / 1          | 89 / 0        |       510 |           15 ms |          296 |                43.4% |

## How the ten-seed runs were made

Both experiments ran at once, from a frozen checkout of commit `f8f7cce` in a
separate worktree, each against its own dev server so they did not share a
rate limiter; arms within each ran one after another. The machine has four
cores. No episode was flagged as lagged: the slowest took 1.9% more wall time
than match time, against the harness's 15% threshold, and no page logged an
error. Overlap barely moved the models' answers: TypeSafe's server-side
median stayed near 145–150 ms, and the browser round trip rose by about 20 ms
under load. The first two Jev episodes of the even-rules run finished before the
direct-control run started.

## Same observations, other minds

Added 2026-10-06 from the archived decision records above; nothing was re-run
and no model was called. A matched seed pairs only the start of a match — the
worlds diverge within seconds — but every decision record holds the exact
observation the seat chose from, and the scripted reference policies are pure
functions of an observation and two counters. So each arm's observations were
shown, in order, to the marksman and the skirmisher, and every axis that offered
more than one option was compared with what the arm chose. Chance is exact: a
uniform chooser over _k_ offered options agrees with any fixed choice with
probability 1/_k_. Means over episodes, the unit.

> Agreement on identical observations, not a counterfactual outcome and not a
> skill score: the reference acted on nothing, and agreeing with a hand-written
> rule is good only where the rule is.

Even rules, with the aiming controller (`glide-jev-even`; cells are agreement,
then chance):

| Arm      | Reference  | Decisions |      move |      turn |       tilt |     weapon |     target |        aim |         go |
| :------- | :--------- | --------: | --------: | --------: | ---------: | ---------: | ---------: | ---------: | ---------: |
| jev      | marksman   |     4,745 |  63% (9%) | 27% (10%) |  60% (14%) |  84% (19%) |  70% (46%) |  65% (33%) |   2% (26%) |
| jev      | skirmisher |     4,745 |  63% (9%) | 27% (10%) |  60% (14%) |  84% (19%) |  70% (46%) |  65% (33%) |  82% (26%) |
| glide    | marksman   |       962 |  89% (9%) | 56% (10%) |  60% (14%) |  83% (18%) |  86% (37%) |   2% (33%) |  19% (28%) |
| glide    | skirmisher |       962 |  89% (9%) | 56% (10%) |  60% (14%) |  83% (18%) |  86% (37%) |   2% (33%) |  59% (28%) |
| marksman | marksman   |     5,304 | 100% (9%) | 97% (10%) | 100% (14%) | 100% (21%) | 100% (45%) | 100% (33%) | 100% (26%) |
| random   | marksman   |     5,024 |  10% (9%) | 10% (10%) |  15% (14%) |  30% (29%) |  35% (34%) |  30% (33%) |  23% (24%) |

What the table can and cannot carry:

- **The instrument checks out.** The random arm sits at chance on every axis,
  which is what a comparison that measured nothing would show for everyone.
  The marksman shown its own observations agrees on every axis but `turn`, at
  97%: each archived episode's records begin at its 15th or 16th decision,
  after the benchmark's warm-up reset, so the policy's sweep counter starts out
  of phase with the one that played. That is the ceiling, and its cause.
- **Both models choose like the scripted rules far more often than chance** on
  firing (84% and 83%, against about 19%) and on which visible enemy to engage
  (70% and 86%, against 46% and 37%). Jev's place choices match the
  skirmisher's 82% of the time (chance 26%). Agreement does not say why: two
  choosers can agree because they apply the same rule, or because both favour
  the option listed first.
- **On where to aim, Glide departs from the rule almost completely.** Where the
  aim region was a real choice, Glide chose `CENTER_MASS` in 94.8% of 193
  decisions; the marksman aims for the head beyond 40 m or wherever the chest is
  hidden, and chose `HEAD` in 97.7% of its 1,326. Glide's agreement there is 2%,
  against a chance of 33%. Jev chose `HEAD` in 63.5% of 301.
- **The marksman never moves**, so agreement on `move` is the share of
  decisions spent holding still: 89% for Glide against 63% for Jev, consistent
  with Glide walking about a third as far.
- **The two references differ only in `go`.** Under places navigation the
  skirmisher is the marksman with a plan for its feet, so each arm's two rows
  match on every other axis.

The two-seed smoke test (`glide-jev-comparison`) shows the same pattern,
Glide's aim agreement included (0% against 33%). Direct control
(`glide-jev-direct`) offers no target or aim axis, so the aim finding cannot
appear there; Glide still holds still (95%) and Jev's place choices still match
the skirmisher's (84%), but Glide's firing agrees with the marksman's less often
(55% against a chance of 20%). Each directory's `shadow.md` has its table, and
`/evaluation` shows them beside the archived evaluation. Reproduce with
`node tools/experiment.mjs --shadow docs/benchmarks/2026-10-05/glide-jev-even`.

## Two seeds, mercy rules: the smoke test

`tools/experiments/glide-jev-comparison.json`, definition `f16d1ec31051870b`,
measured at commit `e097b1f`. Seeds 42 and 43, 60 s each, the default mercy
seat rules, precision control. It came first, and its two short seeds are the
reason for the runs above.

#### Every episode

| Arm    | Seed | Kills / deaths | Rounds / hits | Decisions | Mean round trip | Metres moved | Time in a sight line |
| :----- | ---: | :------------- | :------------ | --------: | --------------: | -----------: | -------------------: |
| jev    |   42 | 3 / 0          | 4 / 3         |       254 |          192 ms |          120 |                33.7% |
| jev    |   43 | 2 / 0          | 3 / 2         |       247 |          205 ms |          166 |                29.0% |
| glide  |   42 | 1 / 0          | 3 / 3         |        57 |        1,027 ms |           43 |                50.1% |
| glide  |   43 | 4 / 0          | 14 / 7        |        58 |        1,009 ms |           69 |                57.6% |
| random |   42 | 0 / 0          | 44 / 0        |       265 |           14 ms |          161 |                88.2% |
| random |   43 | 0 / 1          | 31 / 0        |       243 |           11 ms |          122 |                87.5% |

## Arm totals

#### Arm totals

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

The prediction, that Jev's kills per minute would be at least Glide's on each
seed, failed: Glide won seed 43 four to two, and the arms tied at five kills
each. Glide decided a quarter as often and a fifth of its answers met a
changed world, against one in seventy of Jev's. The first Glide benchmark on
these seeds, forty minutes earlier, recorded nine kills and six upstream
timeouts; this run recorded five and none. Same seeds do not replay the same
match: frame pacing diverges the worlds within seconds.

A first run of this declaration lost its Jev arm: edits to the working tree
remounted the page twice before the match went live, and the arm timed out.
Its partial evaluation is not reported. The declaration was rerun in full with
nothing edited; that run is archived here. The ten-seed runs were served from
a frozen checkout to rule this out.

## Cost

Neither provider's price is configured in `config/pricing.json`, so cost is
unknown for every run, not zero. Token counts as the providers reported them
are in the decision records.

## Reproduce

Start a dev server with `TYPESAFE_API_KEY` and `FASTINO_API_KEY` in its
environment, then:

```sh
JEV_LIVE_TEST=1 FASTINO_LIVE_TEST=1 node tools/experiment.mjs \
  tools/experiments/glide-jev-even.json --require-live
JEV_LIVE_TEST=1 FASTINO_LIVE_TEST=1 node tools/experiment.mjs \
  tools/experiments/glide-jev-direct.json --require-live

# Re-evaluate the archived, compressed decision records without playing:
node tools/experiment.mjs --evaluate docs/benchmarks/2026-10-05/glide-jev-even
node tools/experiment.mjs --evaluate docs/benchmarks/2026-10-05/glide-jev-direct
node tools/experiment.mjs --evaluate docs/benchmarks/2026-10-05/glide-jev-comparison
```

Each directory holds the declaration as run, every episode report, the
evaluation, the CSV, and each episode's decision records and trace, gzipped.
