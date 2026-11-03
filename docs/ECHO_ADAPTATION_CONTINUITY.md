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

Fixed in [`src/bethesda/life/adaptation/benchmarks.ts`](../src/bethesda/life/adaptation/benchmarks.ts),
with the code that judges them (`judgeResearch`, and `judgeOriginals` in
[`originals.ts`](../src/bethesda/life/adaptation/originals.ts)). The generated
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
