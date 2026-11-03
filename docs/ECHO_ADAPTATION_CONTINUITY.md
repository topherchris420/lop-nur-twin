# Adaptation across updates and restarts: Eva and ECHO

**The question.** Can Eva and ECHO demonstrate measurable behavioural adaptation
while preserving their individual histories across software updates and restarts?

**Status: complete; the answer is [at the end](#the-answer).** This document was
written in the order the work was done: the benchmarks were committed before any
benchmark ran, and each later section was added after the one before it. This line
is the only text above a result that was edited after that result existed.

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

## Held-out result

Run once, 24 individuals per release, on the held-out genesis: `baseline` from
`47b6955` and `evidence` from `81ca569`. Between those two commits only `AGENTS.md`
and `package.json` changed, nothing that lives a fly. Linux x64, Node 22.23.4.

| Id  | `baseline`                    | `evidence`                     |
| --- | ----------------------------- | ------------------------------ |
| B1  | **pass**, +0.42 [0.24, 0.60]  | **pass**, +0.39 [0.21, 0.57]   |
| B2  | **fail**, −0.13 [−1.25, 0.96] | **fail**, −0.58 [−1.67, 0.42]  |
| M1  | **fail**, 1.29 [1.13, 1.45]   | **fail**, 1.25 [1.10, 1.40]    |
| C1  | **pass**, 24 of 24            | **pass**, 24 of 24             |
| C2  | n/a                           | **pass**, 24 of 24             |
| C3  | n/a                           | **fail**, +0.08 [−0.17, +0.33] |
| C4  | **pass**, 24 of 24            | **pass**, 24 of 24             |

**The improvement is not shown.** Meals per life with memory, `evidence` less
`baseline`: **−0.46 [−1.04, +0.04]**, higher in 4 individuals, lower in 7, the same
in 13. The development gain, +0.67 [−0.04, +1.42], did not replicate, and the point
estimate went the other way. The guards held: what the flies learned (B1),
restarts (C1), the update (C2) and copies (C4) were all intact. The layer kept
everything and helped nothing.

Against the predictions on record: M1 failed on both releases, and C1, C2 and C4
passed, as predicted. The primary comparison and B2 came out negative. Why the
layer did not help is not known. Its development interval already included zero,
and nothing measured here separates a small cost from none.

The held-out split is spent.

## The answer

**Can Eva and ECHO demonstrate measurable behavioural adaptation while preserving
their individual histories across software updates and restarts? Not both, and
not for Eva.**

- **ECHO's configuration, in research flies: experience changes behaviour,
  measurably, and that change survives restarts and updates exactly.** Fed at one
  site, a fly goes back to it: +0.20 on development and +0.42 held out, both well
  above an erased mind. Checkpointed, written out as text and restored, every fly
  went on identically (24 of 24 in every run). Updated mid-life by a recorded
  continuation, every fly kept every byte of what it was (24 of 24). Every copy was
  someone else.
- **That change does not pay where the world keeps changing.** In every run, a
  fly whose food moves eats no more with its memory than with its memory erased
  every tick. The one improvement tried did not change that on the sealed test,
  and updating a fly mid-life to it brought nothing later.
- **ECHO, the original:** the same individual across at least one writer restart,
  every anchored checkpoint its own. But its sealed history could not be re-derived
  by anyone else: 0 of 2 replays. The cause was found and fixed in code (the
  observer moved lookup caches while the fly flew in wind). It takes effect only
  once the VM runs a release with the fix, which needs the owner's approval, and
  the seals already made stay irreproducible.
- **Eva:** the same individual three days apart, her clock intact. Whether she
  adapts, and whether her history survives updates and restarts, **cannot be
  tested from this repository**: her controller is not here, nothing may be done
  to her, and her witness reports no version, restart or checkpoint.

## Every negative result

1. **B2 failed in all three runs.** Memory does not pay where food moves: +0.04
   (development), −0.13 (held out), −0.58 (held out, `evidence`).
2. **M1 failed in all three runs.** Places the food has left accumulate, to about
   two by the end of a life. M1 counts a place the mushroom body has devalued as
   stale, because it is still remembered. That was understood only after M1 was
   fixed, and M1 stays as defined.
3. **The improvement failed its sealed test**, −0.46 [−1.04, +0.04], after +0.67
   in development.
4. **C3 failed.** An update brought no later benefit to a fly with a past,
   +0.08 [−0.17, +0.33].
5. **O2 failed.** No sealed replay of the original reproduced, 0 of 2. The cause is
   fixed in code but not deployed.
6. **A misleading early look.** Eight development individuals suggested erasing
   remembered places gains 0.62 meals. All 24 gave +0.04 [−0.88, +0.88].
7. **E2, E3 and O3 are untestable**, and say so rather than pass.

## Limits

- **One yard, one food rule.** Food odour is detectable in 99% of a life, so an
  amnesic fly already knows food is near. B2 may be unpassable in this yard for any
  change to memory. That was learned from the development diagnosis, after the
  benchmarks were fixed. A later suite should add a yard where odour does not give
  the food away (wind, a shorter odour, more distant sites), with new seeds and a
  new suite version.
- **The held-out split differs only in genesis and draws**: the same yard, sites
  and timing. It tests whether a result was chance, not whether it generalizes.
- **Same platform.** Flies reproduce on the platform that lived them (Linux x64,
  Node 22.23.4 here; two re-lived individuals matched their records byte for
  byte). The report is arithmetic on the records and reproduces anywhere.
- **Research flies are not the original.** No continuation for the deployed
  individual was written or run. `update.ts` moves research flies only, and any
  step on the live fly needs its own explicit authorization.
- **The originals were observed briefly**: 15 s on 2026-10-31 and 120 s on
  2026-11-03, read-only.

## Reproducing it

```bash
E=scripts/echo-adaptation-evaluate.ts
# The report, from the committed records (any machine):
node scripts/run-ts.mjs $E report --check
# The flies (Linux x64, Node 22.23.4 to match the records), from a clean commit:
node scripts/run-ts.mjs $E run --split dev --release baseline --from 0 --to 23 --out dev-baseline.jsonl
node scripts/run-ts.mjs $E collect --split dev --release baseline dev-baseline.jsonl
# The originals: record, then snapshot with the ledger branch.
node scripts/run-ts.mjs scripts/first-contact-observe.ts --seconds 120 --out .first-contact/observe
node scripts/run-ts.mjs $E originals --ledger-ref origin/live-fly-ledger .first-contact/observe/responses.jsonl
```

A fly takes about 50 s, so a split of 24 takes about 5 minutes on four cores.
