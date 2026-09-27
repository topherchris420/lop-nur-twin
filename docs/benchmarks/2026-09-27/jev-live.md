### jev-live

**Hypothesis.** Given places, the live model will make movement decisions it did not make with stepped movement (0 m moved in the first benchmark), and a model that moves between hidden places spends less of its life in enemy sight lines. Whether that costs or gains kills is open.
**Deciding metric.** Distance moved and time in an enemy's sight line; kills, deaths and damage taken as context. Spends TypeSafe credit: run with JEV_LIVE_TEST=1.

Build `9ba93e5`, mode tdm, seeds 42, 43, 44, 120 s each.

| Measure (3 × 120 s, matched seeds)               | jev-places                               | jev-steps                               |
| :----------------------------------------------- | :--------------------------------------- | :-------------------------------------- |
| Interface                                        | precision · places · 200 ms · seat mercy | precision · steps · 200 ms · seat mercy |
| Kills / deaths                                   | 8 / 0                                    | 58 / 0                                  |
| Kills per minute                                 | 1.33                                     | 9.66                                    |
| Deaths per minute                                | 0.00                                     | 0.00                                    |
| Accuracy                                         | 60.0%                                    | 51.5%                                   |
| Rounds per kill                                  | 3.1                                      | 4.0                                     |
| Damage dealt / taken                             | 1265 / 23                                | 7210 / 21                               |
| Mean survival per life                           | 120.2 s                                  | 120.1 s                                 |
| Distance moved                                   | 1085 m                                   | 0 m                                     |
| Engagement range at shot, mean                   | 75 m                                     | 117 m                                   |
| Headshots                                        | 5                                        | 26                                      |
| ADS time share                                   | 1.3%                                     | 11.4%                                   |
| Time in an enemy's sight line                    | 22.0%                                    | 51.5%                                   |
| Longest stretch in a sight line                  | 19.0 s                                   | 25.0 s                                  |
| Deaths: never seen / seen, not engaged / engaged | 0 / 0 / 0                                | 0 / 0 / 0                               |
| Deaths on open ground                            | 0 of 0                                   | 0 of 0                                  |
| First sight to kill, mean                        | 5.28 s                                   | 4.68 s                                  |
| Places chosen                                    | 208                                      | n/a                                     |
| Decisions executed                               | 1590                                     | 1590                                    |
| Timeouts / stale / invalid / errors              | 0 / 0 / 0 / 0                            | 0 / 0 / 0 / 0                           |
| Round trip p50 / p95                             | 168 / 220 ms                             | 163 / 218 ms                            |

| Seed | jev-places                | jev-steps                 |
| :--- | :------------------------ | :------------------------ |
| 42   | 4/0 K/D, 8/15 hits, 359 m | 17/0 K/D, 36/77 hits, 0 m |
| 43   | 2/0 K/D, 3/5 hits, 392 m  | 20/0 K/D, 39/68 hits, 0 m |
| 44   | 2/0 K/D, 4/5 hits, 334 m  | 21/0 K/D, 44/86 hits, 0 m |
