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

Two scripts here are not read-only. They are steps of
[the cutover plan](../../ECHO_COLLISION.md#cutover-plan), run as root on the VM, and each
needs the owner's approval for that cutover:

| Script                 | Step | What it does                                                                                                   |
| ---------------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| `vm-physics-check.sh`  | 3    | The continuation's `--check` on a read-only copy of a fresh backup, beside the service, if memory allows       |
| `vm-physics-commit.sh` | 6    | The continuation's `--commit` on the live store, with the service stopped. After it the old release refuses it |

To measure an older fly, copy the script into the same folder of a checkout of that
commit, and run it from there. These results are for the commit named beside them in the
report, on Windows on ARM64 with Node 24.22.1. `survey.ts` was re-run from this folder and
gave the same counts:

```sh
node scripts/run-ts.mjs docs/research/echo-collision/survey.ts
node scripts/run-ts.mjs docs/research/echo-collision/realwall.ts
```
