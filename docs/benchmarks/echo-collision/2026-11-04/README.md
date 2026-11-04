# The collision repair's cutover, 2026-11-04

What [the cutover's record](../../../ECHO_COLLISION.md#the-cutover-as-it-ran) cites, as each
tool wrote it. No store or archive is here.

| File                     | What it is                                                                                                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live/witness.jsonl.gz`  | The deployed fly's witness, read on the VM about every 5 seconds from 11:06Z to 11:15Z and from 11:28Z to 11:39Z: time, status, tick, position, mode, reserve, meals, checkpoint and the latest reason                                                                     |
| `live/journal.txt.gz`    | The service's journal from 11:00Z, one status line a simulated minute                                                                                                                                                                                                      |
| `live/journal-2.txt.gz`  | The same journal from 12:00Z to 14:39Z, against which the copy is seen to have parted from the deployed fly                                                                                                                                                                |
| `live/journal-3.txt.gz`  | The same journal from 14:30Z to 20:36Z, with its times: the first meals                                                                                                                                                                                                    |
| `copy/forecast.jsonl.gz` | A copy of the backup `bethesda-life-20261104T111755Z-e458f7cb3490.tar.gz`, stepped forward from checkpoint 2557 by [`forecast.ts`](../../../research/echo-collision/forecast.ts), on Windows on ARM64 with Node 24.22.1, up to where it had reached when this was recorded |

A copy is never the individual. The forecast is kept because it was used to decide to keep
watching rather than intervene, and it is not a result about the deployed fly.
