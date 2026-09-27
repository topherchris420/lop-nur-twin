### exposure

**Hypothesis.** A player who holds still in the open at 100 m should not be able to farm the bots: once they stop crossing open ground in a marksman's view and flank through cover instead, the marksman's kill rate falls and it starts taking damage, while a moving seat is not made weaker.
**Deciding metric.** Marksman kills per minute and damage taken; random-precision K/D as the control for 'moving seats are not punished'.

Build `d77f16a`, mode tdm, seeds 42, 43, 44, 120 s each.

| Measure (3 × 120 s, matched seeds)               | marksman                                | skirmisher                              | random                                  | marksman-even                          |
| :----------------------------------------------- | :-------------------------------------- | :-------------------------------------- | :-------------------------------------- | :------------------------------------- |
| Interface                                        | precision · steps · 200 ms · seat mercy | precision · steps · 200 ms · seat mercy | precision · steps · 200 ms · seat mercy | precision · steps · 200 ms · seat even |
| Kills / deaths                                   | 81 / 0                                  | 107 / 0                                 | 2 / 1                                   | 78 / 0                                 |
| Kills per minute                                 | 13.49                                   | 17.80                                   | 0.33                                    | 12.99                                  |
| Deaths per minute                                | 0.00                                    | 0.00                                    | 0.17                                    | 0.00                                   |
| Accuracy                                         | 74.4%                                   | 90.8%                                   | 9.6%                                    | 77.0%                                  |
| Rounds per kill                                  | 2.5                                     | 2.4                                     | 78.0                                    | 3.6                                    |
| Damage dealt / taken                             | 10394 / 43                              | 15392 / 104                             | 610 / 173                               | 12370 / 108                            |
| Mean survival per life                           | 120.1 s                                 | 120.2 s                                 | 88.9 s                                  | 120.1 s                                |
| Distance moved                                   | 0 m                                     | 880 m                                   | 811 m                                   | 0 m                                    |
| Engagement range at shot, mean                   | 107 m                                   | 77 m                                    | 94 m                                    | 111 m                                  |
| Headshots                                        | 78                                      | 56                                      | 3                                       | 104                                    |
| ADS time share                                   | 10.9%                                   | 13.3%                                   | 8.6%                                    | 13.1%                                  |
| Time in an enemy's sight line                    | 34.7%                                   | 42.6%                                   | 93.0%                                   | 36.2%                                  |
| Longest stretch in a sight line                  | 9.5 s                                   | 17.2 s                                  | 63.8 s                                  | 8.9 s                                  |
| Deaths: never seen / seen, not engaged / engaged | 0 / 0 / 0                               | 0 / 0 / 0                               | 0 / 0 / 1                               | 0 / 0 / 0                              |
| Deaths on open ground                            | 0 of 0                                  | 0 of 0                                  | 1 of 1                                  | 0 of 0                                 |
| First sight to kill, mean                        | 3.42 s                                  | 2.03 s                                  | 19.63 s                                 | 3.45 s                                 |
| Decisions executed                               | 1605                                    | 1600                                    | 1592                                    | 1625                                   |
| Timeouts / stale / invalid / errors              | 0 / 0 / 0 / 0                           | 0 / 0 / 0 / 0                           | 0 / 0 / 0 / 0                           | 0 / 0 / 0 / 0                          |
| Round trip p50 / p95                             | 1 / 3 ms                                | 1 / 2 ms                                | 1 / 3 ms                                | 1 / 3 ms                               |

| Seed | marksman                  | skirmisher                   | random                    | marksman-even              |
| :--- | :------------------------ | :--------------------------- | :------------------------ | :------------------------- |
| 42   | 27/0 K/D, 44/69 hits, 0 m | 34/0 K/D, 70/73 hits, 266 m  | 1/0 K/D, 4/43 hits, 274 m | 32/0 K/D, 91/121 hits, 0 m |
| 43   | 32/0 K/D, 69/79 hits, 0 m | 34/0 K/D, 80/86 hits, 303 m  | 0/1 K/D, 7/73 hits, 261 m | 24/0 K/D, 64/66 hits, 0 m  |
| 44   | 22/0 K/D, 38/55 hits, 0 m | 39/0 K/D, 87/102 hits, 311 m | 1/0 K/D, 4/40 hits, 276 m | 22/0 K/D, 63/96 hits, 0 m  |
