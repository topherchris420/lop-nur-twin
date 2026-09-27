### exposure

**Hypothesis.** A player who holds still in the open at 100 m should not be able to farm the bots: once they stop crossing open ground in a marksman's view and flank through cover instead, the marksman's kill rate falls and it starts taking damage, while a moving seat is not made weaker.
**Deciding metric.** Marksman kills per minute and damage taken; random-precision K/D as the control for 'moving seats are not punished'.

Build `ea55c93 (before)`, mode tdm, seeds 42, 43, 44, 120 s each.

| Measure (3 × 120 s, matched seeds)  | marksman      | skirmisher    | random        |
| :---------------------------------- | :------------ | :------------ | :------------ |
| Kills / deaths                      | 153 / 0       | 168 / 0       | 5 / 2         |
| Kills per minute                    | 25.46         | 29.35         | 0.83          |
| Deaths per minute                   | 0.00          | 0.00          | 0.33          |
| Accuracy                            | 79.8%         | 62.4%         | 15.3%         |
| Rounds per kill                     | 1.6           | 2.5           | 28.8          |
| Damage dealt / taken                | 18509 / 80    | 22165 / 116   | 1186 / 634    |
| Mean survival per life              | 120.2 s       | 114.5 s       | 88.2 s        |
| Distance moved                      | 0 m           | 763 m         | 801 m         |
| Engagement range at shot, mean      | 109 m         | 102 m         | 80 m          |
| Headshots                           | 150           | 153           | 7             |
| ADS time share                      | 19.7%         | 25.7%         | 8.7%          |
| Decisions executed                  | 1582          | 1545          | 1560          |
| Timeouts / stale / invalid / errors | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Round trip p50 / p95                | 1 / 2 ms      | 1 / 2 ms      | 1 / 2 ms      |

| Seed | marksman                   | skirmisher                    | random                     |
| :--- | :------------------------- | :---------------------------- | :------------------------- |
| 42   | 48/0 K/D, 58/76 hits, 0 m  | 58/0 K/D, 97/126 hits, 294 m  | 1/1 K/D, 9/47 hits, 261 m  |
| 43   | 44/0 K/D, 56/68 hits, 0 m  | 65/0 K/D, 102/167 hits, 266 m | 3/1 K/D, 11/54 hits, 264 m |
| 44   | 61/0 K/D, 84/104 hits, 0 m | 45/0 K/D, 65/130 hits, 202 m  | 1/0 K/D, 2/43 hits, 276 m  |
