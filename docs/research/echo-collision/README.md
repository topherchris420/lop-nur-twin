# Measurements behind the collision report

The scripts behind the numbers in [`ECHO_COLLISION.md`](../../ECHO_COLLISION.md), as they
ran, except that each now finds `src/bethesda` from its own folder instead of a path on
one laptop. All are read-only: they open no lease, restore no life and write nothing to a
store. Only this README is written by hand.

| Script         | What it measured                                                                                                        | Input                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `survey.ts`    | Which kinds of solid a ray from a point on their line can miss                                                          | The map                              |
| `realwall.ts`  | How often a fly walked up to each wall of building 1011267786 goes through it                                           | The map                              |
| `journal.ts`   | The deployed fly's position against the map, minute by minute                                                           | A saved, gzipped copy of the journal |
| `read-head.ts` | Where the body is in one checkpoint                                                                                     | An unpacked store                    |
| `timeline.ts`  | The body in the newest checkpoint of each backup (it calls Windows' `tar.exe`, so it runs as it stands only on Windows) | Backup archives                      |

To measure an older fly, copy the script into the same folder of a checkout of that
commit, and run it from there. These results are for the commit named beside them in the
report, on Windows on ARM64 with Node 24.22.1. `survey.ts` was re-run from this folder and
gave the same counts:

```sh
node scripts/run-ts.mjs docs/research/echo-collision/survey.ts
node scripts/run-ts.mjs docs/research/echo-collision/realwall.ts
```
