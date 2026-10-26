# Garden fixtures

`live-2026-10-26.json` holds real `/api/state` responses from the live
garden, recorded read-only on 2026-10-26 (UTC) by polling every 2.5 s and
keeping each tick's response once, unmodified. Four sequences:

| Sequence           | Ticks       | What happens                                                                                                                      |
| ------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `missed-tick`      | 23980–23983 | an arrival at the stone; tick 23982 was never served (the server loop's wake phase wrapped and two steps were published together) |
| `stone-to-flowers` | 23996–24001 | resting, the decision to leave, two flying steps, the arrival and feeding                                                         |
| `drinking`         | 24043–24045 | the last flying step to the saucer, the arrival, drinking                                                                         |
| `fence-to-stone`   | 24133–24144 | resting, the decision, seven flying steps, the arrival, a calibration step                                                        |

The tests that need situations the recording does not contain (a walking
journey, a pause to recover, a failed flight, an unknown place) derive them
from these states and say so where they do.
