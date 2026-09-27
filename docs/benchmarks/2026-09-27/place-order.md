### place-order

**Hypothesis.** In the jev-live experiment Jev chose PLACE_0 in 208 of 208 place choices, with places listed nearest first. If that is a preference for the nearest cover, shuffling the list will leave the kinds it chooses unchanged and spread its slots; if it is a preference for the first option shown, it will keep choosing slot 0 and the kinds will follow the shuffle.
**Deciding metric.** The distribution of GO slots chosen, and the kinds of place bound. Spends TypeSafe credit: run with JEV_LIVE_TEST=1.

Build `9ba93e5+placeOrder`, mode tdm, seeds 42, 43, 44, 120 s each.

| Measure (3 × 120 s, matched seeds)               | jev-places-shuffled                               |
| :----------------------------------------------- | :------------------------------------------------ |
| Interface                                        | precision · places-shuffled · 200 ms · seat mercy |
| Kills / deaths                                   | 38 / 0                                            |
| Kills per minute                                 | 6.33                                              |
| Deaths per minute                                | 0.00                                              |
| Accuracy                                         | 51.9%                                             |
| Rounds per kill                                  | 2.8                                               |
| Damage dealt / taken                             | 5894 / 238                                        |
| Mean survival per life                           | 120.1 s                                           |
| Distance moved                                   | 996 m                                             |
| Engagement range at shot, mean                   | 64 m                                              |
| Headshots                                        | 27                                                |
| ADS time share                                   | 5.9%                                              |
| Time in an enemy's sight line                    | 38.5%                                             |
| Longest stretch in a sight line                  | 18.5 s                                            |
| Deaths: never seen / seen, not engaged / engaged | 0 / 0 / 0                                         |
| Deaths on open ground                            | 0 of 0                                            |
| First sight to kill, mean                        | 3.32 s                                            |
| Places chosen                                    | 135                                               |
| Decisions executed                               | 1550                                              |
| Timeouts / stale / invalid / errors              | 0 / 0 / 0 / 0                                     |
| Round trip p50 / p95                             | 171 / 231 ms                                      |

| Seed | jev-places-shuffled         |
| :--- | :-------------------------- |
| 42   | 4/0 K/D, 7/9 hits, 319 m    |
| 43   | 20/0 K/D, 29/63 hits, 360 m |
| 44   | 14/0 K/D, 19/34 hits, 317 m |
