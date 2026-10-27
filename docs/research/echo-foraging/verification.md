# Olfactory research verification

Validation on October 27, 2026. These are development results for the research extension, not observations of a new controller deployed to the original individual.

Implementation/evaluation source: `7174595600c91eca3aa335384f88655d258cb6ec`; source fingerprint `4acf7bba15a42d44b84d832525fa9b377180dd656d3d73a1d91a738cb49a8bde`. The published report carries both. A result-row TypeScript annotation followed the first evaluation at `a773e41395a93d4e23535fe68c758081aa0b2516`; regeneration changed only source metadata. No model parameter or criterion changed after evaluation.

| Check                                                                                               | Outcome                                                                                                    |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npx vitest run src/bethesda/life src/bethesda/fly scripts/fly-physics-plan.test.ts --maxWorkers=2` | 247 tests, 19 files passed                                                                                 |
| `npx --yes bun run build`                                                                           | Passed, including strict TypeScript and distribution secret scan; 219 files clean                          |
| Scoped ESLint                                                                                       | Passed for new foraging modules, runner and modified research interfaces                                   |
| Scoped Prettier check                                                                               | Passed                                                                                                     |
| `node scripts/run-ts.mjs scripts/fly-source.ts --check`                                             | Existing 34-file fingerprint unchanged: `a96a496c4c00acead32e208158faf7889c31027b8dccde781059a4eb4481f70b` |
| `npm run echo:foraging:evaluate -- --check`                                                         | Generated JSON and summary reproduced byte-for-byte                                                        |
| `npm run echo:immortal:evaluate -- --check`                                                         | Generated JSON and summary reproduced byte-for-byte                                                        |
| Previous immortal-study outcome comparison                                                          | Every result identical to archive-v1 after excluding commit/fingerprint metadata                           |

The 10 new tests cover temporal adaptation and recovery, independent ODE integration, wind/hunger gating, search without a wind bearing, feeding/escape/landing/edge priorities, invalid-state refusal, exclusion of privileged input, actual body movement, matching ECHO prediction to commanded movement, disabled-path regression, read-only inspection, archived identity/history/weight/RNG restoration and the original v1 graph digest. The existing 237 tests remain green.

The generated report contains all 32 short assay trajectories (eight paired seeds, two conditions), including unfavorable time points. Prespecified orientation and source-approach criteria were met in this synthetic walking rig. The mean closest-distance reduction was 95.5%; all eight paired seeds improved. This is neither real-fly validation nor a general food-seeking success rate. There was no food reward in those assays. Zero commands were rejected and 38,348 walking prediction checks found no mismatch with the actual commanded speed/turn.

A separate persistent research individual retained identity and exact future behavior across restores at 60, 600 and 3,600 computed seconds. Its real simulated feeding uses the existing mushroom-body learning path. This does not turn the earlier four-arm learning result into a success: that study remains inconclusive.

The existing reduced-order body and production model versions are unchanged. Physics-readiness remains blocked as documented in the earlier assessment; this work does not validate MuJoCo locomotion. No production checkpoint, live service, garden rendering, or original individual was modified. Original-specific backup/migration rehearsal and separate deployment approval remain required.
