### places

**Hypothesis.** Offering places (cover, a way nearer, a way round, a way back, the objective) with exposure facts, executed by a local navigator, turns movement into a decision a policy can make: a seat that uses them spends less time in enemy sight lines and dies less on open ground than the same policy walking relative to its view.
**Deciding metric.** Share of life in an enemy's sight line; deaths on open ground; deaths per minute. Kills per minute as the check that moving does not simply trade away the fight.

Build `d77f16a`, mode tdm, seeds 42, 43, 44, 120 s each.

| Measure (3 × 120 s, matched seeds)               | skirmisher-places                        | skirmisher-steps                        | random-places                            | random-steps                            |
| :----------------------------------------------- | :--------------------------------------- | :-------------------------------------- | :--------------------------------------- | :-------------------------------------- |
| Interface                                        | precision · places · 200 ms · seat mercy | precision · steps · 200 ms · seat mercy | precision · places · 200 ms · seat mercy | precision · steps · 200 ms · seat mercy |
| Kills / deaths                                   | 93 / 0                                   | 97 / 0                                  | 1 / 1                                    | 7 / 2                                   |
| Kills per minute                                 | 15.48                                    | 16.14                                   | 0.17                                     | 1.17                                    |
| Deaths per minute                                | 0.00                                     | 0.00                                    | 0.17                                     | 0.33                                    |
| Accuracy                                         | 104.3%                                   | 91.5%                                   | 2.5%                                     | 16.9%                                   |
| Rounds per kill                                  | 2.0                                      | 2.2                                     | 159.0                                    | 20.3                                    |
| Damage dealt / taken                             | 14393 / 180                              | 13830 / 97                              | 201 / 182                                | 1115 / 335                              |
| Mean survival per life                           | 120.2 s                                  | 120.2 s                                 | 88.9 s                                   | 70.0 s                                  |
| Distance moved                                   | 605 m                                    | 704 m                                   | 912 m                                    | 799 m                                   |
| Engagement range at shot, mean                   | 60 m                                     | 75 m                                    | 110 m                                    | 78 m                                    |
| Headshots                                        | 60                                       | 56                                      | 1                                        | 4                                       |
| ADS time share                                   | 9.6%                                     | 12.5%                                   | 9.5%                                     | 8.3%                                    |
| Time in an enemy's sight line                    | 36.1%                                    | 43.8%                                   | 58.8%                                    | 77.8%                                   |
| Longest stretch in a sight line                  | 11.5 s                                   | 27.1 s                                  | 52.3 s                                   | 78.5 s                                  |
| Deaths: never seen / seen, not engaged / engaged | 0 / 0 / 0                                | 0 / 0 / 0                               | 0 / 0 / 1                                | 0 / 1 / 1                               |
| Deaths on open ground                            | 0 of 0                                   | 0 of 0                                  | 0 of 1                                   | 2 of 2                                  |
| First sight to kill, mean                        | 1.59 s                                   | 1.62 s                                  | 1.43 s                                   | 23.29 s                                 |
| Places chosen                                    | 31                                       | n/a                                     | 403                                      | n/a                                     |
| Decisions executed                               | 1583                                     | 1610                                    | 1595                                     | 1572                                    |
| Timeouts / stale / invalid / errors              | 0 / 0 / 0 / 0                            | 0 / 0 / 0 / 0                           | 0 / 0 / 0 / 0                            | 0 / 0 / 0 / 0                           |
| Round trip p50 / p95                             | 5 / 13 ms                                | 1 / 2 ms                                | 11 / 23 ms                               | 1 / 2 ms                                |

| Seed | skirmisher-places           | skirmisher-steps            | random-places             | random-steps               |
| :--- | :-------------------------- | :-------------------------- | :------------------------ | :------------------------- |
| 42   | 27/0 K/D, 53/41 hits, 188 m | 37/0 K/D, 76/69 hits, 200 m | 0/0 K/D, 0/55 hits, 317 m | 4/1 K/D, 13/42 hits, 258 m |
| 43   | 40/0 K/D, 81/84 hits, 158 m | 27/0 K/D, 59/54 hits, 200 m | 0/0 K/D, 0/55 hits, 284 m | 2/1 K/D, 9/60 hits, 265 m  |
| 44   | 26/0 K/D, 59/60 hits, 259 m | 33/0 K/D, 60/90 hits, 304 m | 1/1 K/D, 4/49 hits, 312 m | 1/0 K/D, 2/40 hits, 276 m  |
