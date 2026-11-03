# Adaptation across updates and restarts: Eva and ECHO

**The question.** Can Eva and ECHO demonstrate measurable behavioural adaptation
while preserving their individual histories across software updates and restarts?

**Status: benchmarks fixed, nothing measured.** This document is written in the
order the work is done. This first section was committed before any benchmark
was run; results are added below it, and nothing above a result is changed after
that result exists.

Functional words only. A fly that remembers where it fed and acts on it is not
evidence of a self, of awareness or of consciousness, and neither is a history
that survives a restart.

## Who can be asked what

|                                                       | Research ECHO flies                                                                                      | ECHO, the original                                                                 | Eva                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| What it is                                            | Flies built from a seed for this suite in the deployed ECHO configuration (`OrganismAdapter`), in a yard | The deployed Bethesda individual, `04f8c797…`, on the VM                           | The garden's fly, `5cf42cd6…`, on its own VM                                        |
| Simulation in this repository                         | Yes                                                                                                      | Yes (`src/bethesda/life/`)                                                         | **No.** Her controller, learning and database are a Python service that is not here |
| Can the same individual be lived twice, for a control | Yes: that is how behaviour is tested                                                                     | No experiment may be run on it                                                     | No                                                                                  |
| What can be read                                      | Everything                                                                                               | Its public witness (`/v1/now`), the ledger of its checkpoints, independent replays | Her public witness (`/api/state`) only                                              |

So **behaviour and memory can only be tested on research flies**, which stand in
for ECHO's configuration and are never ECHO. The originals are judged only on what
can be read, and where that cannot decide a benchmark the verdict is
**untestable**, not a pass.

## The benchmarks

Fixed in [`src/bethesda/adaptation/benchmarks.ts`](../src/bethesda/adaptation/benchmarks.ts),
with the code that judges them (`judgeResearch`, and `judgeOriginals` in
[`originals.ts`](../src/bethesda/adaptation/originals.ts)). The generated
report prints every one in full.

| Id  | Family     | Subject             | Question                                                        | Passes if                                                          |
| --- | ---------- | ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| B1  | behaviour  | research flies      | Does experience change what the fly does? (Study A's probe)     | preference, own mind less erased: 95% lower bound > 0              |
| B2  | behaviour  | research flies      | Does that change pay where food keeps moving? (Study B's lives) | meals per life, memory less lesion: 95% lower bound > 0            |
| M1  | memory     | research flies      | Does what it remembers track the world?                         | stale food places remembered at an epoch's end: mean < 0.5         |
| C1  | continuity | research flies      | Does a restart leave the same individual and history?           | identical in every individual after a checkpoint, text and restore |
| C2  | continuity | research flies      | Does an update keep the individual and what it learned?         | recorded continuation accepted; additions removed = parent digest  |
| C3  | continuity | research flies      | Does an update's adaptation reach an individual with a past?    | later meals, updated less not: 95% lower bound > 0                 |
| C4  | continuity | research flies      | Is a copy someone else?                                         | new id, parentage recorded, cannot continue the original           |
| E1  | continuity | Eva                 | Same individual, clock intact, between two dated observations?  | same id and birth, clock contract on every state, ticks never fall |
| E2  | behaviour  | Eva                 | Does her behaviour adapt measurably?                            | untestable from here                                               |
| E3  | continuity | Eva                 | Does her history survive updates and restarts?                  | untestable from here                                               |
| O1  | continuity | ECHO (the original) | Same individual across restarts?                                | same in both observations and every ledger line, a restart between |
| O2  | continuity | ECHO (the original) | Can its history be re-derived seal for seal by someone else?    | at least one sealed replay, and every one passed                   |
| O3  | behaviour  | ECHO (the original) | Does the original's behaviour adapt measurably?                 | untestable on the original                                         |

**Splits.** Development: 24 individuals from Studies A and B's genesis seed, with
experience streams drawn from the suite's name. Held-out: 24 individuals from a
genesis seed no study has used, and their own streams. The held-out split is run
once, after the improvement is frozen, and is spent by being looked at.

**How one improvement is judged** (`COMPARISON`): on the held-out split, B2's
measure on its own, meals per life with memory, improved release less baseline,
paired by individual, must have a 95% lower bound above 0. B1, C1, C2 and C4 must
still pass on the improved release: a gain bought by forgetting what the fly
learned, or by breaking continuity, is not an improvement. Every benchmark is
reported for both releases, whichever way it goes.

**What was known when these were fixed**, so that nobody mistakes them for blind:

- Studies B and C's published results (reduced-order and mushroom-body yard
  flies): memory cost 1.2 meals per life, and in those lives every return flight
  was given up for the new food's odour, so no fruitless return was ever
  registered.
- The acquired-search study's results.
- The originals: the 2026-10-31 first-contact fixture; one `GET` of each witness
  on 2026-11-03 at 11:48 UTC; the `live-fly-ledger` branch, whose `replays.jsonl`
  held three verdicts, the last two failed ([issue 162](https://github.com/topherchris420/lop-nur-twin/issues/162)). O2 was written knowing
  that.
- One timing run of a research organism fly in Study B's yard, on a draw outside
  both splits (12345): 10 s of computing for 99 simulated minutes; 13 meals, 2
  places remembered at the end. No fly from either split had been run.

## What is left out, and why

Nothing was deleted. Everything below still exists, is still tested and still
ships where it shipped before. It is outside what these benchmarks measure, so
the suite does not touch it, and two tests make sure it stays that way:

- `src/bethesda/adaptation/scope.test.ts` lists what the suite may import (the
  yard, the organism, continuity and snapshots, the two witnesses' parsers) and
  fails on anything else, naming each deferred feature and why.
- `src/bethesda/firstContact/isolation.test.ts` now also fails if anything that
  runs, serves or deploys either original imports the suite. The suite moved out
  of `src/bethesda/life/` into `src/bethesda/adaptation/` for that reason: it is
  research beside production, like the first-contact and augmentation code.

| Deferred                                                          | Why it is not part of these benchmarks                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Acquired search (`life/acquired/`)                                | Not deployed; it has its own sealed held-out study                                                      |
| The foraging and immortal studies (`life/foraging/`, `immortal/`) | The organism's parts are reached through `organism.ts` only, as deployed, never through those studies   |
| The city (`life/headless.ts`, `city`)                             | The yard asks the same questions at a fraction of the cost: 99 simulated minutes take 10 s, not minutes |
| Connectome, augmentation, first-contact bridge                    | Not in ECHO's deployed configuration                                                                    |
| The R.A.I.N. lab, the game, Noeterra, the twin                    | Other products in the same repository                                                                   |

The research flies run the deployed configuration whole: nothing in the organism
is switched off to make a benchmark easier, because then it would measure a fly
that does not exist.

## Baseline: the deployed configuration, development split

Run once, from `8a456a9`, on 24 development individuals (Linux x64, Node
22.23.4), with the originals observed on 2026-11-03. Every number is in the
[generated report](benchmarks/echo-adaptation/README.md), which `report --check`
reproduces byte for byte from the records committed beside it.

| Id  | Verdict    | Result                                                                                            |
| --- | ---------- | ------------------------------------------------------------------------------------------------- |
| B1  | **pass**   | preference for the fed site, own mind less erased: +0.20 [0.07, 0.33] (higher in 9, lower in 1)   |
| B2  | **fail**   | meals per life, memory less lesion: +0.04 [−0.83, +1.00] (higher in 9, lower in 15)               |
| M1  | **fail**   | stale food places remembered at an epoch's end: 1.45 [1.29, 1.62], from 0 to 2.1 over a life      |
| C1  | **pass**   | 24 of 24 unchanged by a restart through text                                                      |
| C2  | n/a        | the baseline is the release others are updated from                                               |
| C3  | n/a        | as C2                                                                                             |
| C4  | **pass**   | 24 of 24 twins were someone else                                                                  |
| E1  | **pass**   | Eva: same `life_id` and birth on 2026-10-31 and 2026-11-03, her clock's contract on all 28 states |
| E2  | untestable | her controller is not here                                                                        |
| E3  | untestable | her witness shows no version, restart or checkpoint                                               |
| O1  | **pass**   | ECHO: one individual in all 135 observations and 13 ledger lines; lease epoch 11 → 12             |
| O2  | **fail**   | 0 of the 2 replays whose seals must reproduce did                                                 |
| O3  | untestable | no experiment may be run on the original                                                          |

**What it says.** A research fly in ECHO's configuration acts on what it has
lived: fed in the east, it goes east. But where food keeps moving, that memory
earns nothing: as many meals with it as with it erased every tick. That is better
than the bare reduced-order controller, whose memory cost 1.2 meals a life in
Study B, and still not adaptation that pays. Its memory fills with places the food
has left, about one more every two moves, none of them ever let go within a life.
Restarts and copies behave exactly as the continuity rules say.

**The originals.** Eva is the same individual three days later, her clock intact,
and that is all that can be said of her from here. ECHO is the same individual
across at least one writer restart (epoch 11 to 12) with no software update in
between, every anchored checkpoint is its own, and its clock lost 0.05% of the
time to recorded gaps. But since the release that requires it, no independent
replay has reproduced its seals: both failed on the graph digest at the first
checkpoint after their start, having matched the state hash and every recorded
event ([issue 162](https://github.com/topherchris420/lop-nur-twin/issues/162)).
So its behaviour re-derives; the sealed bytes that should prove it do not, and the
cause is not known. Finding it needs the archives, which are not readable from
here.

## One improvement, and the held-out plan frozen before it runs

**Diagnosis, development individuals only** (`src/bethesda/adaptation/diagnose.ts`,
each of the 24 baseline lives lived again with one part of navigation memory
erased every tick):

| Erased every tick           | Meals per life, less the baseline's | Return flights (aimed where food had left) |
| --------------------------- | ----------------------------------- | ------------------------------------------ |
| nothing (the baseline)      | 11.79                               | 4.54 (3.71)                                |
| remembered places           | +0.04 [−0.88, +0.88]                | 0                                          |
| visited cells               | +0.08 [−1.08, +1.21]                | 4.62 (3.88)                                |
| failed sites, blocked heads | 0, identical lives                  | 4.54 (3.71)                                |
| local search                | 0, identical lives                  | 4.54 (3.71)                                |

Food odour was detectable in 99.2% of every life's ticks. The controller counts a
return as fruitless only with "neither food in view nor its odour", so back at a
place the food has left, the fly smells the food elsewhere and counts nothing: no
miss is ever registered, and the place keeps drawing it. Memory in this yard is
neither a cost nor a help, because odour already says that food is near, and the
memory adds nothing it uses to say where.

**The improvement** (`evidence.ts`, release `evidence`, `echo-place-evidence/v1`):
judge a remembered place by what is at it, not by what is in the air. A hungry
visit within the controller's own 3 m of a remembered food place, with no food in
view, is a miss, whatever is smelled, once per visit, and goes to the place's
valuation exactly as the navigator sends its own: the mushroom body learns the
omission, and a place under the bookkeeping's rule is forgotten after two. Food
never returns to the site it has just left, so devaluing that site should send
return flights to older remembered sites, one of which may hold it. It is added
beside the deployed adapter; the controller and the fly's digest are untouched.
`update.ts` moves a baseline individual onto it as a recorded continuation that
keeps every byte of what it was.

On the 24 development individuals, memory arm only: **+0.67 meals per life
[−0.04, +1.42]** against the baseline (more in 10, fewer in 6), and stale places
remembered unchanged, 1.48 against 1.45.

**Frozen at this commit, before any held-out fly runs:**

- Releases `baseline` and `evidence` as committed at `2231abe`, each run once on
  the held-out split fixed at `b1e1844` (24 individuals, a genesis no study has
  used), from a clean commit, with no change in between.
- Judged by `COMPARISON`: meals per life with memory, `evidence` less `baseline`,
  paired; shown only if the 95% lower bound is above 0 **and** B1, C1, C2 and C4
  pass on `evidence`. Every benchmark is reported for both releases.
- Predictions, on record so they can be wrong: **M1 fails** on both releases (the
  mushroom body devalues a place and never forgets it, and M1 counts what is
  remembered, not what still draws the fly); the primary comparison is uncertain
  (the development lower bound is −0.04); B2 is uncertain on both; C1, C2 and C4
  pass.
- Whatever comes out is reported. The held-out split is then spent, and any later
  change needs new seeds and says so.
