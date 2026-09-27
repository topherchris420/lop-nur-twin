# 27 September 2026 experiments

Written by `tools/experiment.mjs`; each `.json` is the full report (every
episode of every arm), each `.md` the table it printed. Discussed in
[`docs/JEV_BLACKSITE.md`](../../JEV_BLACKSITE.md#the-marksman-exploit).

| File              | Build                             | Question                                           |
| :---------------- | :-------------------------------- | :------------------------------------------------- |
| `exposure-before` | `ea55c93` (a worktree, port 5174) | Does a still marksman farm the bots?               |
| `exposure-after2` | `d77f16a`                         | After the exposure changes, under both seat rules? |
| `places`          | `d77f16a`                         | Places against stepped movement                    |
| `horizon`         | `d77f16a`                         | What does answer latency cost the same policy?     |

**One column is wrong in all four, and is not used.** The "Accuracy" rows (and
the "hits" in the per-seed rows) counted hitbox strikes, not rounds: a round
that passes through an arm into the chest counted twice, which is how some rows
exceed 100 %. The counter now counts a round once (`pilot.ts`, with a test in
`metrics.test.ts`). Kills, deaths, damage, distance and the debrief were never
affected; the write-up uses damage per round instead of accuracy. The
26 September figures used the same definition.
