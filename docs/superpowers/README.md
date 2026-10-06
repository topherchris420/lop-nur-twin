# Planning records

These are dated plans and a design spec written for agent-driven
implementation work. They are records of intent at the time they were written,
not documentation of the system: their unchecked boxes say nothing about
status, and nothing links to them as a description of current behaviour.

| File                                               | What became of it                                                                                                                                                                                                                                                                                                                                               |
| :------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plans/2026-07-23-deterministic-analysis-playground.md` | Partly built, then partly superseded. The perimeter patrol shipped (`PERIMETER_PATROL_ROUTE` in `src/lib/layout.ts`). The construction-year timeline was replaced by the evidence timeline, whose only clock is a snapshot date ([`TEMPORAL_MODEL.md`](../TEMPORAL_MODEL.md)); the screen-space aircraft analysis overlay and its aircraft profiles were removed. |
| `plans/2026-09-04-spatial-query-export.md` and `specs/2026-09-04-spatial-query-export-design.md` | Built: `src/lib/spatialCatalog.ts`, `spatialQuery.ts` and `spatialExport.ts`, on `/analysis`. The current description is [`SPATIAL_ANALYSIS.md`](../SPATIAL_ANALYSIS.md).                                                                                                                                                                                  |

For how the system works now, start at [`SYSTEM_ARCHITECTURE.md`](../SYSTEM_ARCHITECTURE.md).
